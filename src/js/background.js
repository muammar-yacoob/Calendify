/* The service worker: the only context that reads page text or talks to Google.
 *
 * Deliberately so. The popup holds a form and a key field and never sees the
 * page, which is why the payload travels through chrome.storage.session rather
 * than the URL. The old version put the whole page description in the popup's
 * query string, where it was visible in the window title and capped by whatever
 * the URL length happened to be.
 *
 * "type": "module" is already declared in the manifest, so these are real ES
 * imports. Order matters: engine.mjs side-effect imports the classic engine.js
 * and hangs GeminiEngine on globalThis, and gemini-config.js then configures
 * it. ES imports evaluate in source order, so this is the right order.
 */
import { generate, getStatus, createNanoSession, EngineError } from './gemini-kit/engine.mjs';
import './gemini-config.js';
import { EVENT_SCHEMA, buildEventPrompt, pickDate, todayISO } from './extract.mjs';
import { calendarUrl } from './shared/calendar.mjs';

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'addToCalendar',
    title: 'Calendify',
    contexts: ['selection', 'page']
  });
});

// ── keeping the worker up ───────────────────────────────────────────────────

/* Copied from minutely/background.js:248-256, itself from bumboo. Waiting on a
   model is not work as far as Chrome is concerned: nothing calls into the
   extension while a prompt is in flight, so a run that outlasts the thirty
   second idle timer is torn down along with the callback that would have
   delivered it. Touching an extension API every twenty seconds keeps it up. */
const jobs = new Set();
let keepAliveTimer = null;

function holdWorkerAwake() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    if (!jobs.size) { clearInterval(keepAliveTimer); keepAliveTimer = null; return; }
    chrome.runtime.getPlatformInfo().catch(() => { });
  }, 20_000);
}

// ── page data ───────────────────────────────────────────────────────────────

async function getPageData(tabId) {
  if (!tabId) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url.startsWith('chrome:') || tab.url.startsWith('chrome-extension:')) return null;

    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['src/js/content.js'] });
    } catch {
      // Already injected is the common case here, and is fine.
    }

    return await new Promise((resolve) => {
      const done = setTimeout(() => resolve(null), 1500);
      chrome.tabs.sendMessage(tabId, { action: 'getSelection' }, (response) => {
        clearTimeout(done);
        void chrome.runtime.lastError;
        resolve(response?.success ? response.data : null);
      });
    });
  } catch (error) {
    console.error('Calendify: could not read the page', error);
    return null;
  }
}

/* One pending payload PER POPUP WINDOW, not one global.
 *
 * Both entry points call chrome.windows.create, so two popups can be open at
 * once; a single fixed key means the second write replaces the first and the
 * first popup then asks the model about the second page. The row is removed as
 * soon as its popup has used it, so the last page read does not sit in session
 * storage for the rest of the browser session. */
const pendingKey = (windowId) => `pending:${windowId}`;

async function openPopup(data, selectionText) {
  const payload = data || {
    form: { title: selectionText ? selectionText.split('\n')[0] : '', date: '', time: '', location: '', meetingLink: '', description: selectionText || '' },
    ai: { pageUrl: '', pageTitle: '', selection: selectionText || '', pageText: '' }
  };
  if (selectionText && !payload.ai.selection) payload.ai.selection = selectionText;

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('src/html/popup.html'),
    type: 'popup',
    // 560, not the old 400: the engine row and the API key disclosure live
    // below the form now, and at 400 the key field was clipped in a window
    // that cannot scroll.
    width: 400,
    height: 560,
    focused: true
  });
  await chrome.storage.session.set({ [pendingKey(win.id)]: payload });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'addToCalendar') return;
  openPopup(await getPageData(tab?.id), info.selectionText || '');
});

chrome.action.onClicked.addListener(async (tab) => {
  // No default_popup in the manifest, deliberately: declaring one stops this
  // event firing at all.
  openPopup(await getPageData(tab?.id), '');
});

// ── messages ────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message || typeof message !== 'object') return;
  handle(message, sender)
    .then(reply)
    .catch((err) => reply({ ok: false, message: String(err?.message || err) }));
  return true;   // every reply here is async
});

async function handle(message, sender) {
  switch (message.type) {
    case 'PENDING': return takePending(message.windowId);
    case 'EXTRACT': return runExtract(message.windowId);
    case 'ENGINE_STATUS': return { ok: true, status: await getStatus() };
    case 'ENGINE_ENABLE': return enableNano();
    case 'ADD_TO_CALENDAR': return addToCalendar(message.event);
    default: return { ok: false, message: `unknown message ${message.type}` };
  }
}

/* Read once and keep it: the popup needs the AI half for a later EXTRACT, and
   the worker may well have been unloaded in between, so the row stays until
   the popup is finished with it. */
async function takePending(windowId) {
  const key = pendingKey(windowId);
  const stored = await chrome.storage.session.get(key);
  const pending = stored[key] || {};
  return { ok: true, form: pending.form || {}, hasAi: Boolean(pending.ai) };
}

async function runExtract(windowId) {
  const key = pendingKey(windowId);
  const stored = await chrome.storage.session.get(key);
  const ai = stored[key]?.ai;
  if (!ai) return { ok: false, message: 'Nothing to read on this page.' };

  const today = todayISO();
  const tz = timeZone();
  const job = `extract:${windowId}`;
  jobs.add(job);
  holdWorkerAwake();

  try {
    const answer = await ask({ ...ai, todayISO: today, tz });
    const when = pickDate({ ai: answer, todayISO: today });
    return {
      ok: true,
      event: {
        title: answer.title || '',
        date: when.iso,
        time: when.time,
        location: answer.location || '',
        meetingLink: answer.meetingUrl || '',
        description: answer.description || '',
        certainty: when.certainty
      }
    };
  } catch (err) {
    return { ok: false, ...classify(err) };
  } finally {
    jobs.delete(job);
  }
}

/* One retry, shedding the only sheddable input.
 *
 * Nano's window is small and rejects rather than truncating. pageText is the
 * one large field; the selection is the user pointing at the event and is never
 * dropped. If there was no pageText to begin with there is nothing to shed and
 * the error stands. */
async function ask(input) {
  try {
    return await generate(buildEventPrompt(input), { json: true, schema: EVENT_SCHEMA });
  } catch (err) {
    if (err?.code !== 'too_large' || !input.pageText) throw err;
    return generate(buildEventPrompt({ ...input, pageText: input.pageText.slice(0, 1200) }), { json: true, schema: EVENT_SCHEMA });
  }
}

async function enableNano() {
  /* Has to be the worker that calls this, not the popup that asked. The kit
     broadcasts progress with chrome.runtime.sendMessage, which does NOT
     dispatch to the sender's own context, so a popup calling it would never
     receive its own progress events and the bar would sit at zero for the
     length of a multi-gigabyte download. */
  jobs.add('nano-download');
  holdWorkerAwake();
  try {
    await createNanoSession(true);
    return { ok: true };
  } catch (err) {
    return { ok: false, ...classify(err) };
  } finally {
    jobs.delete('nano-download');
  }
}

/* The kit maps HTTP 400, 401 and 403 all to 'bad_key'. 400 is also what the
   endpoint returns for a schema it does not accept, so without this branch a
   schema fault would tell the user their perfectly good AI Studio key had been
   rejected and they would go and make another one.
   Copied from minutely/background.js:560-586, reworded for a web page. */
const SCHEMA_FAULT = /schema|invalid json payload|unknown name|responseschema|exceeds|token/i;

function classify(err) {
  const message = String(err?.message || err);
  const code = err instanceof EngineError ? err.code : 'unknown';
  if (code === 'bad_key' && SCHEMA_FAULT.test(message)) {
    return { code: 'schema', message: `Calendify sent something the model rejected: ${message}` };
  }
  const friendly = {
    unsupported: 'This copy of Chrome has no built-in AI. Add a Gemini API key below, or fill the form in yourself.',
    downloadable: 'Chrome\'s built-in model needs downloading first. Press Download it.',
    downloading: 'The built-in model is still downloading. Try again when it finishes.',
    bad_key: 'Google rejected the API key. Check it below.',
    rate_limit: 'Too many requests for now. Wait a minute and try again.',
    network: 'Could not reach Google. Check your connection.',
    blocked: 'The model declined to read this page.',
    empty: 'The model returned nothing usable.',
    timeout: 'The model took too long.',
    too_large: 'This page is too long for the on-device model. Select just the event text, or add a Gemini API key.'
  };
  return { code, message: friendly[code] || message };
}

// ── the calendar ────────────────────────────────────────────────────────────

async function addToCalendar(event) {
  if (!event?.date) return { ok: false, message: 'An event needs a date.' };

  /* Everything that is not a stated date says so IN THE DESCRIPTION. A warning
     in the popup does not travel into Google Calendar; the description does,
     and the description is what gets read six weeks later when the reminder
     fires. This is minutely/src/panel/calendar.mjs's doctrine and it matters
     more here, where a model proposed the date. */
  const details = [
    event.description || '',
    event.meetingLink ? `Meeting Link: ${event.meetingLink}` : '',
    event.certainty && event.certainty !== 'stated'
      ? '(date read by Calendify from the page, not stated outright. Please check it.)'
      : ''
  ].filter(Boolean).join('\n\n');

  const url = calendarUrl({
    title: event.title || 'New Event',
    details,
    location: event.location || '',
    iso: event.date,
    allDay: !event.time,
    time: event.time || '',
    durationMin: 60,
    tz: timeZone()
  });

  await chrome.tabs.create({ url });
  notify('Event ready in Google Calendar', `Check "${event.title || 'the event'}" and press Save.`);
  return { ok: true };
}

/* The only visible confirmation there is, which is why it survived: the
   popup's own toast had opacity:0 and no rule ever added the class that would
   have shown it, so it had never once been seen. */
function notify(title, message) {
  const id = `calendify-${Date.now()}`;
  chrome.notifications.create(id, {
    type: 'basic',
    title,
    message,
    iconUrl: chrome.runtime.getURL('res/icons/icon128.png'),
    priority: 2
  }, () => setTimeout(() => chrome.notifications.clear(id), 5000));
}

/* The popup's row is its own, so it goes when the window does. */
chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.session.remove(pendingKey(windowId)).catch(() => { });
});
