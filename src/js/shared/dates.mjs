/* Turning "by Friday" into a date.
 *
 * Pure, and anchored to the date of the MEETING rather than to today. Minutes
 * get generated days after the call -- on the train home, or the following
 * Monday -- and "Friday" means the Friday after the conversation, not the
 * Friday after whenever someone pressed the button.
 *
 * WHY THIS IS NOT THE MODEL'S JOB. A language model does not know today's date
 * and will happily emit a well-formed one that is eleven months in the past. A
 * regex cannot tell the difference, so the wrong date sails through validation
 * and into a calendar. Here the model's only job is to hand back the phrase it
 * heard, verbatim; this file decides what that phrase means, and wins whenever
 * it fires.
 *
 * TWO THINGS THAT COST REAL MONEY WHEN WRONG:
 *
 *  - "04/10" is 4 October, not 10 April. He is in Manchester. Day-first is the
 *    reading everyone in the room meant, and getting it backwards moves a
 *    deadline by six months in a direction nobody notices until it is missed.
 *
 *  - All arithmetic runs on civil dates in UTC. Adding 86400000 milliseconds to
 *    a local Date is a day-shifting bug twice a year: across 25 October 2026
 *    the clocks go back, that day is 25 hours long, and "tomorrow" lands on
 *    today. Working in UTC keeps a calendar day exactly 24 hours, and since
 *    nothing here needs a wall clock -- the meeting's date arrives already
 *    resolved as a local YYYY-MM-DD -- there is no timezone to get wrong. The
 *    only place a zone matters is the calendar URL, and it lives in calendar.mjs.
 */

const MONTHS = {
	jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
	may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
	sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const DAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const DAY_RE = Object.keys(DAYS).sort((a, b) => b.length - a.length).join('|');

const END_OF_DAY = '17:00';   // "by end of day" in a working context, not midnight
const EVENING = '18:00';

// ── civil date helpers, all UTC so a calendar day is always 24 hours ────────
const toUTC = (iso) => {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
	if (!m) return null;
	const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
	return Number.isNaN(d.getTime()) ? null : d;
};
const toISO = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const c = new Date(d.getTime()); c.setUTCDate(c.getUTCDate() + n); return c; };
const addMonths = (d, n) => {
	const c = new Date(d.getTime());
	const day = c.getUTCDate();
	c.setUTCDate(1);
	c.setUTCMonth(c.getUTCMonth() + n);
	// Clamp, so "in one month" from 31 January is 28/29 February rather than
	// silently rolling into March.
	c.setUTCDate(Math.min(day, new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 0)).getUTCDate()));
	return c;
};
const endOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
const mondayOf = (d) => addDays(d, -((d.getUTCDay() + 6) % 7));

/* Strictly after the anchor: "Friday" said on a Friday means the next one, not
   the one you are standing in. */
const nextWeekday = (from, dow) => addDays(from, ((dow - from.getUTCDay() + 7 - 1) % 7) + 1);

export function addDaysISO(iso, n) {
	const d = toUTC(iso);
	return d ? toISO(addDays(d, n)) : iso;
}

/* Time of day, if the phrase carried one. Returns "HH:MM" or ''. */
function parseTime(s) {
	if (/\bnoon\b|\bmidday\b/.test(s)) return '12:00';
	if (/\bmidnight\b/.test(s)) return '00:00';
	const m = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/.exec(s);
	if (m) {
		let h = +m[1] % 12;
		if (m[3] === 'pm') h += 12;
		return String(h).padStart(2, '0') + ':' + (m[2] || '00');
	}
	const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(s);
	if (h24) return String(+h24[1]).padStart(2, '0') + ':' + h24[2];
	return '';
}

/* When a phrase names a month and day but no year, pick the reading that puts
   it in the future. "14 October" said in November means next October. */
function withYear(anchor, month, day, explicitYear) {
	if (explicitYear != null) {
		const y = explicitYear < 100 ? 2000 + explicitYear : explicitYear;
		return new Date(Date.UTC(y, month, day));
	}
	let d = new Date(Date.UTC(anchor.getUTCFullYear(), month, day));
	if (d < anchor) d = new Date(Date.UTC(anchor.getUTCFullYear() + 1, month, day));
	return d;
}

const NONE = { iso: '', allDay: true, time: '', certainty: 'none', label: '', confidence: 0 };

/**
 * @param {string} dueText  the phrase as it was spoken, verbatim
 * @param {string} meetingISO  the meeting's local date, YYYY-MM-DD
 * @returns {{iso:string, allDay:boolean, time:string, certainty:'stated'|'inferred'|'none', label:string, confidence:number}}
 */
export function resolveDue(dueText, meetingISO) {
	const anchor = toUTC(meetingISO);
	if (!anchor || !dueText) return { ...NONE };

	const raw = String(dueText).trim();
	const s = raw.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ');
	const time = parseTime(s);
	const hit = (d, certainty, confidence, forcedTime) => {
		const clock = forcedTime || time;
		return {
			iso: toISO(d),
			allDay: !clock,
			time: clock,
			certainty,
			label: raw,
			confidence,
		};
	};

	// 1 -- an explicit calendar date, in any of the shapes people say them.
	const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
	if (iso) return hit(new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3])), 'stated', 1);

	const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_RE})\\b(?:\\s+(\\d{4}))?`).exec(s);
	if (dayMonth) return hit(withYear(anchor, MONTHS[dayMonth[2]], +dayMonth[1], dayMonth[3] ? +dayMonth[3] : null), 'stated', 1);

	const monthDay = new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`).exec(s);
	if (monthDay) return hit(withYear(anchor, MONTHS[monthDay[1]], +monthDay[2], monthDay[3] ? +monthDay[3] : null), 'stated', 1);

	// 2 -- DAY-FIRST. 04/10 is 4 October. Only when the second number cannot be
	//      a month do we accept it the American way round, because 10/25 is not
	//      a date at all under the UK reading.
	const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s);
	if (slash) {
		let day = +slash[1], month = +slash[2];
		if (month > 12 && day <= 12) { const swap = day; day = month; month = swap; }
		if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
			return hit(withYear(anchor, month - 1, day, slash[3] ? +slash[3] : null), 'stated', 1);
		}
	}

	// 3 -- "the 14th", with no month: this month, or next if it has passed.
	const bare = /\bthe (\d{1,2})(?:st|nd|rd|th)\b/.exec(s);
	if (bare) {
		const day = +bare[1];
		let d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), day));
		if (d < anchor) d = addMonths(d, 1);
		return hit(d, 'stated', 0.9);
	}

	// 4 -- today, tomorrow, and the end-of-day shorthands.
	if (/\b(today|end of (the )?day|eod|cob|close of (business|play)|by tonight|tonight|this evening)\b/.test(s)) {
		const evening = /\b(tonight|this evening)\b/.test(s);
		return hit(anchor, 'stated', 0.95, time || (evening ? EVENING : END_OF_DAY));
	}
	if (/\btomorrow\b/.test(s)) return hit(addDays(anchor, 1), 'stated', 0.95);
	if (/\bday after tomorrow\b/.test(s)) return hit(addDays(anchor, 2), 'stated', 0.95);

	// 5 -- a named weekday. "next Friday" is the one in the FOLLOWING week,
	//      which is what people mean and what a naive "+7 from today" gets
	//      wrong whenever the meeting is early in the week.
	const weekday = new RegExp(`\\b(next|this|coming|following)?\\s*(${DAY_RE})\\b`).exec(s);
	if (weekday) {
		let d = nextWeekday(anchor, DAYS[weekday[2]]);
		const qualifier = weekday[1];
		if ((qualifier === 'next' || qualifier === 'following') && mondayOf(d).getTime() === mondayOf(anchor).getTime()) {
			d = addDays(d, 7);
		}
		return hit(d, 'stated', 0.9);
	}

	// 6 -- week-shaped phrases. The end of a working week is Friday.
	if (/\b(end of (the |this )?week|eow|by the weekend|this week)\b/.test(s)) {
		return hit(fridayOfWeek(anchor), 'stated', 0.8);
	}
	if (/\bnext week\b/.test(s)) return hit(fridayOfWeek(addDays(anchor, 7)), 'stated', 0.75);

	// 7 -- explicit arithmetic.
	const inN = /\bin (?:(\d+)|a|an|one|two|three|four|five|six) (day|week|month)s?\b/.exec(s);
	if (inN) {
		const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
		const n = inN[1] ? +inN[1] : (words[/\b(a|an|one|two|three|four|five|six)\b/.exec(s)[1]] || 1);
		if (inN[2] === 'day') return hit(addDays(anchor, n), 'stated', 0.95);
		if (inN[2] === 'week') return hit(addDays(anchor, n * 7), 'stated', 0.95);
		return hit(addMonths(anchor, n), 'stated', 0.9);
	}

	// 8 -- month and quarter boundaries.
	if (/\bend of (the )?month\b/.test(s)) return hit(endOfMonth(anchor), 'stated', 0.85);
	if (/\bend of next month\b/.test(s)) return hit(endOfMonth(addMonths(anchor, 1)), 'stated', 0.85);
	const quarter = /\b(?:end of )?q([1-4])\b/.exec(s);
	if (quarter) {
		const q = +quarter[1];
		let d = endOfMonth(new Date(Date.UTC(anchor.getUTCFullYear(), q * 3 - 1, 1)));
		if (d < anchor) d = endOfMonth(new Date(Date.UTC(anchor.getUTCFullYear() + 1, q * 3 - 1, 1)));
		return hit(d, 'stated', 0.8);
	}
	if (/\bend of (the )?year\b/.test(s)) return hit(new Date(Date.UTC(anchor.getUTCFullYear(), 11, 31)), 'stated', 0.85);

	// 9 -- a clock time and no day: "by noon", "at 3pm". They named an hour
	//      while sitting in the meeting, so they meant that hour today.
	if (time) return hit(anchor, 'stated', 0.7);

	// 10 -- urgency is not a date. It gets one anyway, because "asap" plainly
	//      means soon, but it is marked INFERRED so the UI draws it dashed and
	//      the calendar description says a human never said it.
	if (/\b(asap|as soon as possible|right away|straight away|immediately|urgently)\b/.test(s)) {
		return hit(nextWorkingDay(anchor), 'inferred', 0.5);
	}

	// 11 -- nothing recognised. No pill, no calendar button. We do not invent a
	//       deadline that nobody in the room agreed to.
	return { ...NONE, label: raw };
}

function fridayOfWeek(d) {
	const friday = addDays(mondayOf(d), 4);
	// Said on a Saturday or Sunday, "end of the week" means the Friday coming.
	return friday < d ? addDays(friday, 7) : friday;
}

function nextWorkingDay(d) {
	let n = addDays(d, 1);
	while (n.getUTCDay() === 0 || n.getUTCDay() === 6) n = addDays(n, 1);
	return n;
}
