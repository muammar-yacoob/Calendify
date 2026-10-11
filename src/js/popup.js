/* The popup: a form, and a model that is invited to fill in its blanks.
 *
 * The AI is never in the way. Every field is editable, Add is gated on title
 * and date and on nothing else, and if there is no key and no built-in model
 * the form still opens prefilled from the page's own markup. That is the whole
 * degradation story: the extension that worked before this change still works
 * exactly as well with the model switched off.
 *
 * This file used to carry its own copy of parseEventDetails, getMonthNumber
 * and isLikelyOnlineEvent, duplicating content.js line for line. Both copies
 * are gone: the worker reads the page and the model reads the prose.
 */

/* $ and the lastError-swallowing send(), copied from
   minutely/src/shared/utils.mjs:107-120. The swallow is not laziness: the
   service worker may be asleep or mid-restart, in which case sendMessage
   rejects with "Could not establish connection". That is a normal state. */
const $ = (id) => document.getElementById(id);

function send(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (reply) => {
        void chrome.runtime.lastError;
        resolve(reply);
      });
    } catch {
      resolve(undefined);
    }
  });
}

const KEY_STORAGE = 'geminiApiKey';   // the kit's own key, shared with his other extensions
const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com/*';

const FIELDS = {
  title: 'eventTitle',
  date: 'eventDate',
  time: 'eventTime',
  location: 'eventLocation',
  description: 'eventDescription'
};

let windowId = null;
let meetingLink = '';

function notice(message, kind = 'is-warn') {
  const el = $('notice');
  el.textContent = message || '';
  el.className = `cal-notice ${kind}`;
  el.hidden = !message;
}

/* Blanks only, which is the single rule that covers both cases worth
   protecting: a field the page already filled from its own markup is a fact
   and outranks the model, and a field the user has typed into is their
   decision. Neither is ever overwritten, so no dirty-tracking is needed. */
function fill(values) {
  for (const [key, id] of Object.entries(FIELDS)) {
    const el = $(id);
    if (el && !el.value && values[key]) el.value = values[key];
  }
  if (!meetingLink && values.meetingLink) meetingLink = values.meetingLink;
  validateForm();
}

function validateForm() {
  const valid = $('eventTitle').value.trim() !== '' && $('eventDate').value.trim() !== '';
  $('addButton').disabled = !valid;
  return valid;
}

// ── engine ──────────────────────────────────────────────────────────────────

/* Copied from minutely/src/panel/settings.mjs:36-108, reworded for a web page
   rather than a meeting, and with the pill dropped. */
const HINTS = {
  cloud: 'Using your Gemini API key. Long pages go in one pass.',
  available: 'Reading happens on this computer. No key, no account, nothing uploaded.',
  downloadable: 'Chrome can read pages here, but has to fetch the model first. A few gigabytes, once.',
  downloading: 'Downloading the built-in model.',
  unsupported: 'This computer cannot run Chrome\'s built-in model. Add a key below, or just fill the form in.'
};

async function refreshEngine() {
  const reply = await send({ type: 'ENGINE_STATUS' });
  const status = reply?.status || {};
  const cloud = status.engine === 'cloud';
  const state = status.state || 'unsupported';

  $('engineHint').textContent = cloud ? HINTS.cloud : (HINTS[state] || HINTS.unsupported);
  $('enableNano').hidden = !(!cloud && state === 'downloadable');

  // Opened only when there is genuinely nothing that can read a page.
  if (!cloud && state === 'unsupported') $('keyDetails').open = true;
  return { cloud, state };
}

$('enableNano').addEventListener('click', async () => {
  $('enableNano').disabled = true;
  $('downloadBar').hidden = false;
  const result = await send({ type: 'ENGINE_ENABLE' });
  $('downloadBar').hidden = true;
  $('enableNano').disabled = false;
  if (result && !result.ok) $('engineHint').textContent = result.message || 'Could not enable the built-in model.';
  refreshEngine();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'ENGINE_DOWNLOAD_PROGRESS') {
    $('downloadBar').hidden = false;
    $('downloadBar').value = message.loaded || 0;
  }
});

// ── api key ─────────────────────────────────────────────────────────────────

$('saveKey').addEventListener('click', async () => {
  const value = $('apiKey').value.trim();
  if (!value) return;

  /* The host permission is OPTIONAL in the manifest and asked for here, on a
     real user gesture, rather than declared up front.
     Declaring it would have been a permission increase on an extension that
     already has users: Chrome disables an extension whose update adds a host
     warning until each user re-approves it, so every existing install would
     have gone dark on update. Asking at the moment somebody opts into the
     cloud model costs one prompt and breaks nobody. */
  const granted = await chrome.permissions.request({ origins: [GEMINI_ORIGIN] }).catch(() => false);
  if (!granted) {
    notice('Calendify needs permission to reach Google\'s Gemini API before a key can be used.', 'is-bad');
    return;
  }

  await chrome.storage.local.set({ [KEY_STORAGE]: value });
  $('apiKey').value = '';
  // Never re-displayed, only acknowledged.
  $('apiKey').placeholder = 'Saved';
  notice('');
  refreshEngine();
});

$('clearKey').addEventListener('click', async () => {
  await chrome.storage.local.remove(KEY_STORAGE);
  $('apiKey').value = '';
  $('apiKey').placeholder = 'AIza…';
  refreshEngine();
});

// ── the event ───────────────────────────────────────────────────────────────

$('addButton').addEventListener('click', async () => {
  if (!validateForm()) {
    notice('A title and a date are required.', 'is-bad');
    return;
  }
  const reply = await send({
    type: 'ADD_TO_CALENDAR',
    event: {
      title: $('eventTitle').value,
      date: $('eventDate').value,
      time: $('eventTime').value,
      location: $('eventLocation').value,
      description: $('eventDescription').value,
      meetingLink,
      certainty: $('eventDate').dataset.certainty || 'stated'
    }
  });
  if (reply?.ok) window.close();
  else notice(reply?.message || 'Could not open Google Calendar.', 'is-bad');
});

for (const id of ['eventTitle', 'eventDate']) {
  $(id).addEventListener('input', validateForm);
}

// ── start ───────────────────────────────────────────────────────────────────

(async function start() {
  const win = await chrome.windows.getCurrent();
  windowId = win.id;

  const pending = await send({ type: 'PENDING', windowId });
  fill(pending?.form || {});

  const { cloud, state } = await refreshEngine();

  /* The model is asked ONLY when the page's own markup left the two fields that
     matter empty, and never otherwise.
     Two reasons, and the privacy one is the important one: a toolbar click
     carries no selection, so an ungated extract would upload a slice of
     whatever page is open, including a private inbox, every single time the
     icon is pressed. This keeps "nothing leaves until you ask for an event"
     literally true, and it does not spend the user's own cloud quota
     re-reading a page that already said what it was. */
  const needsHelp = !$('eventTitle').value || !$('eventDate').value;
  if (!needsHelp || !pending?.hasAi) return;
  if (!cloud && state !== 'available') return;   // nothing that could answer

  notice('Reading the page…', 'is-warn');
  const result = await send({ type: 'EXTRACT', windowId });

  if (result?.ok) {
    notice('');
    fill(result.event);
    if (result.event.certainty && result.event.certainty !== 'stated') {
      $('eventDate').dataset.certainty = result.event.certainty;
      notice('Calendify read this date off the page rather than being told it. Please check it.', 'is-warn');
    }
  } else {
    // The form is untouched and still perfectly usable.
    notice(result?.message || 'Could not read the page. Fill the form in yourself.', 'is-bad');
  }
})();

// ── support strip ───────────────────────────────────────────────────────────

(async function loadSupportLinks() {
  try {
    const links = await import('./utils/supportLinks.js');
    const picked = links.getRandomCategory(['rate', 'github', 'website', 'donate']);
    if (!picked) return;
    const { category } = picked;
    $('supportText').textContent = links.getRandomMessage(category.messages);
    $('supportButton').textContent = `${category.title} ${category.emoji}`;
    $('supportButton').href = category.getUrl();
    $('supportButton').rel = 'noopener noreferrer';
  } catch (error) {
    console.error('Calendify: support links unavailable', error);
    $('supportText').textContent = 'Thanks for using Calendify! ⭐';
  }
})();
