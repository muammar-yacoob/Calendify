/* Turning an action item into a calendar event.
 *
 * Pure string building. No OAuth, no Google Cloud project, no token to refresh,
 * no sensitive-scope review: the button opens Google's own event composer with
 * the fields already filled and a human presses Save.
 *
 * COPIED from minutely/src/panel/calendar.mjs. One deliberate deviation, marked
 * below: `location`. A meeting has no venue, a web page's event does, and
 * Calendify's popup has had a Location field since 1.0. Everything else here is
 * the donor's, byte for byte, so a fix there copies cleanly back over this.
 *
 * That last part is the point rather than a limitation. Some of these deadlines
 * were inferred by a model from a sentence someone half-said on a call. Writing
 * them silently into a calendar is precisely the wrong property for this
 * product; showing someone the event and letting them agree to it is the right
 * one. If confirmed writes are ever genuinely needed, this file is the only
 * thing that changes.
 *
 * TWO THINGS THAT ARE SILENTLY WRONG WHEN WRONG, both asserted in
 * test/calendar.test.mjs because neither announces itself:
 *
 *  1. Google's all-day end date is EXCLUSIVE. A one-day event on 14 October is
 *     20261014/20261015. Passing the same date twice yields an event on the
 *     wrong day or no event at all, and the UI has no way to find out.
 *
 *  2. Timed events must be FLOATING LOCAL plus a ctz parameter, never a UTC
 *     Z-stamp. 20261014T140000 with ctz=Europe/London is unambiguous and
 *     survives the BST/GMT switch. Hand-converting to Z is where every
 *     off-by-an-hour bug in calendar code comes from.
 */
import { addDaysISO } from './dates.mjs';

const compact = (iso) => iso.replace(/-/g, '');
const stamp = (iso, time) => compact(iso) + 'T' + time.replace(':', '') + '00';

/* End of a timed event: start plus the duration, rolling into the next day if
   a late-afternoon task with a long default would otherwise run past midnight. */
function endStamp(iso, time, durationMin) {
	const [h, m] = time.split(':').map(Number);
	const total = h * 60 + m + durationMin;
	const dayShift = Math.floor(total / 1440);
	const mins = ((total % 1440) + 1440) % 1440;
	const endIso = dayShift ? addDaysISO(iso, dayShift) : iso;
	const clock = String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
	return stamp(endIso, clock);
}

/**
 * The description that travels with the event.
 *
 * The inferred-deadline disclosure is mandatory and is not decoration. In the
 * panel an inferred deadline is drawn as a dashed amber pill, but a pill does
 * not travel into Google Calendar -- the description does, and the description
 * is what he will actually read in six weeks when the reminder fires. Anything
 * the model guessed has to say so at the point of use.
 */
export function buildDetails({ owner, meetingTitle, meetingDate, quote, certainty }) {
	const lines = [];
	if (owner) lines.push(`Owner: ${owner}`);
	if (meetingTitle || meetingDate) lines.push(`From: ${[meetingTitle, meetingDate].filter(Boolean).join(' · ')}`);
	if (quote) lines.push(`Said: "${quote}"`);
	if (certainty && certainty !== 'stated') {
		lines.push('(deadline inferred by Minutely, not stated in the meeting)');
	}
	lines.push('---', 'Captured by Minutely');
	return lines.join('\n');
}

/**
 * @param {{title:string, details?:string, location?:string, iso:string, allDay?:boolean, time?:string, durationMin?:number, tz?:string}} event
 * @returns {string} a Google Calendar event-composer URL, or '' with no date
 */
export function calendarUrl({ title, details = '', location = '', iso, allDay = true, time = '', durationMin = 30, tz = 'Europe/London' }) {
	if (!iso) return '';
	const params = new URLSearchParams({
		action: 'TEMPLATE',
		text: String(title || 'Action item').slice(0, 120),
	});
	if (details) params.set('details', details);
	// The Calendify deviation. Omitted entirely when empty: a blank location
	// parameter makes Google show an empty Where row rather than no row.
	if (location) params.set('location', location);

	if (allDay || !time) {
		params.set('dates', `${compact(iso)}/${compact(addDaysISO(iso, 1))}`);
	} else {
		params.set('dates', `${stamp(iso, time)}/${endStamp(iso, time, durationMin)}`);
		// ctz only means anything for a timed event; on an all-day one Google
		// ignores it, and sending it anyway just makes the URL longer.
		params.set('ctz', tz);
	}
	return 'https://calendar.google.com/calendar/render?' + params.toString();
}

// ── .ics export ─────────────────────────────────────────────────────────────

/* RFC 5545 wants COMMA, SEMICOLON, BACKSLASH and newlines escaped in a text
   value. Miss the escaping and one task containing a comma silently truncates
   every field after it. */
const esc = (s) => String(s || '')
	.replace(/\\/g, '\\\\')
	.replace(/;/g, '\\;')
	.replace(/,/g, '\\,')
	.replace(/\r?\n/g, '\\n');

/* Content lines are limited to 75 octets, continued with a leading space.
   Folding on characters rather than bytes would split a multi-byte character
   in half, so the count is done on the UTF-8 length. */
function fold(line) {
	const enc = new TextEncoder();
	if (enc.encode(line).length <= 75) return line;
	const out = [];
	let current = '';
	let bytes = 0;
	for (const ch of line) {
		const size = enc.encode(ch).length;
		// 74 on continuation lines, to leave room for the leading space.
		if (bytes + size > (out.length ? 74 : 75)) { out.push(current); current = ''; bytes = 0; }
		current += ch;
		bytes += size;
	}
	if (current) out.push(current);
	return out.shift() + out.map((l) => '\r\n ' + l).join('');
}

/**
 * One VCALENDAR holding every action item that has a date.
 * @param {Array} items  {title, details, iso, allDay, time, durationMin, uid}
 * @param {{name?:string, stampedAt?:string}} meta  stampedAt as YYYYMMDDTHHMMSSZ
 */
export function buildIcs(items, meta = {}) {
	const stamped = meta.stampedAt || '19700101T000000Z';
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Spark Apps//Minutely//EN',
		'CALSCALE:GREGORIAN',
	];
	let n = 0;
	for (const it of items || []) {
		if (!it.iso) continue;
		n++;
		lines.push('BEGIN:VEVENT');
		lines.push(`UID:${esc(it.uid || `minutely-${n}-${stamped}`)}`);
		lines.push(`DTSTAMP:${stamped}`);
		if (it.allDay || !it.time) {
			// Exclusive end, exactly as in the Google URL above.
			lines.push(`DTSTART;VALUE=DATE:${compact(it.iso)}`);
			lines.push(`DTEND;VALUE=DATE:${compact(addDaysISO(it.iso, 1))}`);
		} else {
			// Floating local time: no TZID, no Z. A TZID without an accompanying
			// VTIMEZONE block is what some clients reject outright, and floating
			// is the correct reading for "3pm" said in a meeting anyway.
			lines.push(`DTSTART:${stamp(it.iso, it.time)}`);
			lines.push(`DTEND:${endStamp(it.iso, it.time, it.durationMin || 30)}`);
		}
		lines.push(`SUMMARY:${esc(it.title)}`);
		if (it.details) lines.push(`DESCRIPTION:${esc(it.details)}`);
		lines.push('END:VEVENT');
	}
	lines.push('END:VCALENDAR');
	return lines.map(fold).join('\r\n') + '\r\n';
}
