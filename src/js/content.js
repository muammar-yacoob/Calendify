/* What the DOM can tell us about an event, which is less than it used to claim.
 *
 * This file used to hold ~300 lines of prose guessing: findTime took the first
 * \d{1,2}:\d{2} anywhere on the page (a price, a comment timestamp),
 * checkIfOnlineEvent scored +1 for the bare word "meet" or "web" appearing
 * anywhere in document.body.textContent, so nearly every page scored online,
 * and three separate date readers stamped new Date().getFullYear() onto a
 * month and day that never stated a year. A model reads prose better than any
 * of that, so the prose guessing is gone and extract.mjs asks Gemini instead.
 *
 * What stayed is the half a model CANNOT do, because it never sees the markup:
 * href attributes, <time datetime>, itemprop and og: tags. Those are facts, not
 * readings, and they outrank anything the model says.
 *
 * Injected with chrome.scripting.executeScript({files}), which has no module
 * mode, so this stays a CLASSIC script. No imports.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'ping') {
    sendResponse({ success: true });
  } else if (message.action === 'getSelection') {
    try {
      sendResponse({ success: true, data: collect() });
    } catch (error) {
      // A failed scrape must not cost the user the popup: an empty form that
      // opens beats a working form that does not.
      console.error('Calendify: extraction failed', error);
      sendResponse({
        success: true,
        data: {
          form: { title: document.title, date: '', time: '', location: '', meetingLink: '', description: '' },
          ai: { pageUrl: location.href, pageTitle: document.title, selection: selectedText(), pageText: '' }
        }
      });
    }
  }
  return true;
});

const selectedText = () => (window.getSelection()?.toString() || '').trim();

/* Visible page text, capped. The cap is not an optimisation: Gemini Nano's
   input window is small and an oversized prompt rejects outright rather than
   truncating (EngineError 'too_large'), and this is also the text that leaves
   the computer when a cloud key is set, so less of it is better on both
   counts. Only sent when nothing is selected. */
const PAGE_TEXT_CAP = 4000;

function collect() {
  const selection = selectedText();

  // The form half: only what the markup actually states. Anything empty here
  // is a blank the model is invited to fill, in popup.js.
  const form = {
    title: structuredTitle(),
    date: structuredDate(),
    time: '',
    location: structuredLocation(),
    meetingLink: findMeetingLink()?.url || '',
    description: selection || structuredDescription()
  };

  return {
    form,
    ai: {
      pageUrl: location.href,
      pageTitle: document.title,
      selection,
      pageText: selection ? '' : (document.body?.innerText || '').slice(0, PAGE_TEXT_CAP)
    }
  };
}

function textOf(selector) {
  const el = document.querySelector(selector);
  return el ? el.textContent.trim() : '';
}

function structuredTitle() {
  return textOf('[itemprop="name"]') ||
    textOf('h1') ||
    document.title.replace(/\s*[|\-:—].*$/, '').trim();
}

/* A machine-readable start date, and only that. Returns YYYY-MM-DD or ''.
 *
 * The LOCAL civil date, which is the bug that was here before: a 00:30 event
 * written as 2026-10-15T00:30+01:00 goes through toISOString() as
 * 2026-10-14T23:30Z and lands on the previous day. A bare YYYY-MM-DD is used
 * as written rather than parsed at all, since parsing it only risks a shift. */
function structuredDate() {
  const el = document.querySelector('[itemprop="startDate"], time[datetime], [datetime]');
  if (!el) return '';
  const raw = el.getAttribute('datetime') || el.getAttribute('content') || '';
  const bare = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (bare && !/[T ]/.test(raw)) return bare[1];
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return bare ? bare[1] : '';
  return d.toLocaleDateString('en-CA');
}

/* Microdata and schema.org addresses only. The postal-code and "Location: X"
   regex scans that used to live here returned whole paragraphs as addresses. */
function structuredLocation() {
  const clean = (t) => t.replace(/Show map.*$/i, '').replace(/Get directions.*$/i, '').replace(/\s+/g, ' ').trim();

  for (const el of document.querySelectorAll('[itemtype*="PostalAddress"], [itemprop="address"], [itemprop="location"]')) {
    if (el.offsetParent === null) continue;

    const parts = ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode']
      .map((prop) => el.querySelector(`[itemprop="${prop}"]`))
      .filter(Boolean)
      .map((part) => part.textContent.trim());
    if (parts.length) return parts.join(', ');

    const text = clean(el.textContent);
    if (text.length > 5 && text.length < 300) return text;
  }
  return '';
}

function structuredDescription() {
  const el = document.querySelector('[itemprop="description"], meta[property="og:description"], meta[name="description"]');
  const content = el ? (el.getAttribute('content') || el.textContent || '') : '';
  return content.trim().length > 20 ? content.trim() : '';
}

/* Joining links, kept whole and unchanged.
 *
 * This is the clearest case for staying deterministic: the URL lives in an
 * href the model never sees, and a hallucinated meeting link is worse than no
 * meeting link. Five platform patterns, then an href whose own anchor text
 * says it is a joining link. */
function findMeetingLink() {
  const patterns = [
    { platform: 'Zoom', regex: /zoom\.us\/(j|w|webinar|meeting|register)\/([a-zA-Z0-9?=_-]+)/i },
    { platform: 'Teams', regex: /teams\.microsoft\.com\/l\/(meetup-join|meet|meeting)/i },
    { platform: 'Meet', regex: /meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+/i },
    { platform: 'Webex', regex: /webex\.com\/(meet|j|join|meeting)/i },
    { platform: 'GoToMeeting', regex: /goto(meeting|webinar)\.com/i }
  ];

  for (const link of document.getElementsByTagName('a')) {
    const href = link.href;
    if (!href || href.length < 10) continue;
    if (/facebook\.com|twitter\.com|instagram\.com|linkedin\.com/i.test(href)) continue;

    for (const { platform, regex } of patterns) {
      if (regex.test(href)) return { platform, url: href };
    }
    if (/\b(join|register|online|virtual|zoom|teams|meet|webinar)\b/i.test(link.textContent)) {
      return { platform: 'Conference', url: href };
    }
  }
  return null;
}
