/* Turning a page into one proposed calendar event.
 *
 * This file is the merge rule and nothing else: the schema the model answers
 * in, the prompt that asks, and how the answer is reconciled with what the DOM
 * already told us. DOM-free and chrome-free on purpose, so test/extract.test.mjs
 * can drive it under plain node.
 *
 * THE DIVISION OF LABOUR, which is the whole design:
 *
 *   The model reads prose and says WHAT the event is. It is good at that.
 *   It never resolves a date. resolveDue() in shared/dates.mjs does that,
 *   day-first and anchored to today, because a model asked for YYYY-MM-DD will
 *   cheerfully answer one for "Sunday 2 Nov" and be a year out without ever
 *   saying so. So the model copies the phrase verbatim into whenText and the
 *   resolver turns it into a date, which is also how Minutely does it.
 */
import { resolveDue } from './shared/dates.mjs';

/* Nine strings and nothing else. Every property is `required` and the null is
   '' rather than an absent key, because a schema-constrained decoder cannot
   omit a required field and a partial object would need a repair path.
   Stay inside the subset both providers accept: object/array/string/enum,
   properties, required, additionalProperties. No number, no boolean, no format
   -- the cloud endpoint answers an unsupported keyword with HTTP 400, which the
   kit maps to 'bad_key' (engine.js:167), i.e. it would accuse a working key. */
export const EVENT_SCHEMA = {
	type: 'object',
	properties: {
		title: { type: 'string' },
		whenText: { type: 'string' },   // the date/time phrase as written, verbatim
		date: { type: 'string' },       // YYYY-MM-DD, the model's own guess, '' if unknown
		startTime: { type: 'string' },  // HH:MM 24h, '' if unknown
		location: { type: 'string' },
		meetingUrl: { type: 'string' },
		description: { type: 'string' },
		certainty: { type: 'string', enum: ['stated', 'inferred', 'none'] },
	},
	required: ['title', 'whenText', 'date', 'startTime', 'location', 'meetingUrl', 'description', 'certainty'],
	additionalProperties: false,
};

/* Local calendar day as YYYY-MM-DD, ported from minutely/src/shared/utils.mjs.
   en-CA is the shortest route to ISO order out of toLocaleDateString and it is
   LOCAL: toISOString would give UTC and file a 00:30 event under yesterday for
   half the year. */
export const todayISO = (ms = Date.now()) => new Date(ms).toLocaleDateString('en-CA');

/**
 * @param {{todayISO:string, tz:string, pageUrl:string, pageTitle:string, selection:string, pageText:string}} input
 * @returns {string}
 */
export function buildEventPrompt({ todayISO: today, tz, pageUrl, pageTitle, selection, pageText }) {
	const lines = [
		// Pinned, not assumed. "Sun, 2 Nov" has no year in it, and the old
		// Calendify hardcoded new Date().getFullYear(), which put every
		// November event in the current year whatever the page meant.
		`TODAY: ${today} (${tz})`,
		`PAGE URL: ${pageUrl || '(unknown)'}`,
		`PAGE TITLE: ${pageTitle || '(none)'}`,
		'',
	];

	// The selection is the user pointing at the event. When there is one it is
	// the whole input: it is both far more likely to be right than the page,
	// and far less of the page to hand to a third party.
	if (selection) {
		lines.push('The user selected this text. The event is in here:', '"""', selection.trim(), '"""');
	} else {
		lines.push('No text was selected. This is the visible text of the page:', '"""', (pageText || '').trim(), '"""');
	}

	lines.push(
		'',
		'Return the one event this describes. Rules:',
		'- title: what a calendar entry should be called. Short. No site name, no boilerplate.',
		'- whenText: the date and time phrase COPIED VERBATIM from the text above, however it is',
		'  written ("Sun, 2 Nov, 10:00", "next Friday", "14th March 2027"). Do not reformat it.',
		'  Leave it empty if the text states no date.',
		'- date / startTime: your own best reading, YYYY-MM-DD and HH:MM 24-hour. Empty if unsure.',
		'- location: the venue or address. Empty for an online-only event.',
		'- meetingUrl: a Zoom, Teams, Meet or Webex joining link if the text contains one.',
		'- description: at most 400 characters of what the event actually is.',
		'- certainty: "stated" if the text gives a date outright, "inferred" if you worked it out,',
		'  "none" if there is no date at all.',
	);
	return lines.join('\n');
}

/* The model's date is the LAST resort, and only inside a sane window.
 *
 * Precedence, after minutely/src/shared/minutes.mjs:133-157:
 *   1. the resolver, on the verbatim phrase -- deterministic and day-first;
 *   2. the model's own YYYY-MM-DD, if it is well formed and plausible;
 *   3. nothing, which leaves the form's date empty and Add disabled.
 *
 * The 0.75 floor on the resolver is not cosmetic. Two of resolveDue's branches
 * resolve to the ANCHOR rather than to anything in the text: a bare clock time
 * (dates.mjs:209, confidence 0.7) and "asap" (:214, 0.5). In Minutely the
 * anchor is the meeting, so "3pm" meaning today is exactly right. Here the
 * anchor is the moment of the right-click, so a page that merely mentions a
 * time and no date would book TODAY and label it stated. Every genuine date
 * branch scores 0.75 or better, so one floor cuts precisely those two.
 */
export function pickDate({ ai = {}, todayISO: today, horizonDays = 550 }) {
	const resolved = resolveDue(ai.whenText || '', today);
	if (resolved.iso && resolved.confidence >= 0.75) {
		return { iso: resolved.iso, time: resolved.time, allDay: resolved.allDay, certainty: resolved.certainty };
	}

	const guess = String(ai.date || '');
	if (/^\d{4}-\d{2}-\d{2}$/.test(guess) && guess >= today && guess <= addDays(today, horizonDays)) {
		const time = /^\d{2}:\d{2}$/.test(ai.startTime || '') ? ai.startTime : '';
		// Never 'stated': nothing deterministic agreed with it.
		return { iso: guess, time, allDay: !time, certainty: 'inferred' };
	}

	return { iso: '', time: '', allDay: true, certainty: 'none' };
}

/* Deliberately not addDaysISO from dates.mjs: that one is for real calendar
   arithmetic, this is a lexicographic horizon on a string. */
function addDays(iso, days) {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}
