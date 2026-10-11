/* The merge rule, which is the only thing here nobody else has already tested.
 *
 * pickDate decides whether a date came from the page, from the resolver or from
 * the model, and it is silent when it gets that wrong: a wrong date still opens
 * a perfectly valid Google Calendar URL. The calendar URL building itself is
 * asserted upstream in minutely/test/calendar.test.mjs against a byte-identical
 * copy of shared/calendar.mjs, so it is not re-asserted here.
 *
 *   node test/extract.test.mjs
 */
import assert from 'node:assert/strict';
import { pickDate, EVENT_SCHEMA, buildEventPrompt, todayISO } from '../src/js/extract.mjs';

const TODAY = '2026-10-11';
const pick = (ai) => pickDate({ ai, todayISO: TODAY });

/* The resolver owns real dates. "Sun, 2 Nov" carries no year, and the version
   this replaced stamped new Date().getFullYear() on it. */
assert.deepEqual(pick({ whenText: 'Sun, 2 Nov, 10:00' }),
  { iso: '2026-11-02', time: '10:00', allDay: false, certainty: 'stated' },
  'a verbatim phrase with no year resolves forward, not into the current year');

assert.equal(pick({ whenText: '14 March 2027' }).iso, '2027-03-14');
assert.equal(pick({ whenText: 'next Friday' }).certainty, 'stated');

/* THE IMPORTANT ONE. resolveDue resolves a bare clock time to its anchor with
   confidence 0.7, which is right in Minutely (the anchor is the meeting) and
   wrong here (the anchor is the moment of the right-click). Without the 0.75
   floor, any page merely mentioning a time books today and calls it stated. */
assert.notEqual(pick({ whenText: 'Doors 19:30', date: '2027-03-14' }).iso, TODAY,
  'a page that only mentions a time must not book today');
assert.equal(pick({ whenText: 'Doors 19:30', date: '2027-03-14' }).certainty, 'inferred');
assert.equal(pick({ whenText: 'asap' }).iso, '', 'urgency is not a date on a web page');

/* The model's own date is a last resort, inside a sane window, never 'stated'. */
assert.deepEqual(pick({ whenText: '', date: '2027-03-14', startTime: '19:00' }),
  { iso: '2027-03-14', time: '19:00', allDay: false, certainty: 'inferred' });
assert.equal(pick({ whenText: '', date: '2020-01-01' }).iso, '', 'a past date is rejected');
assert.equal(pick({ whenText: '', date: '2099-01-01' }).iso, '', 'a date beyond the horizon is rejected');
assert.equal(pick({ whenText: '', date: '14/03/2027' }).iso, '', 'a malformed date is rejected');
assert.equal(pick({}).iso, '', 'nothing in means nothing out');

/* The schema has to stay inside the subset both decoders accept: the cloud
   endpoint answers an unsupported keyword with HTTP 400, which the kit maps to
   'bad_key', so a schema typo would accuse a working key. */
const ALLOWED = new Set(['object', 'array', 'string']);
for (const [name, node] of Object.entries(EVENT_SCHEMA.properties)) {
  assert.ok(ALLOWED.has(node.type), `${name} uses an unsupported type: ${node.type}`);
  assert.ok(EVENT_SCHEMA.required.includes(name), `${name} must be required, so '' is the only null`);
  if (node.enum) assert.equal(node.type, 'string', `${name}: an enum node still needs its type`);
}
assert.equal(EVENT_SCHEMA.additionalProperties, false);

/* Today has to reach the model, or an undated phrase has nothing to anchor to. */
const prompt = buildEventPrompt({
  todayISO: TODAY, tz: 'Europe/London', pageUrl: 'https://e.example/gig',
  pageTitle: 'A Gig', selection: 'Sun, 2 Nov, 10:00', pageText: 'ignored'
});
assert.ok(prompt.includes(`TODAY: ${TODAY} (Europe/London)`), 'the prompt must pin today and the timezone');
assert.ok(prompt.includes('Sun, 2 Nov, 10:00'));
assert.ok(!prompt.includes('ignored'), 'a selection replaces the page text rather than joining it');
assert.ok(buildEventPrompt({ todayISO: TODAY, tz: 'UTC', selection: '', pageText: 'body copy' }).includes('body copy'));

assert.match(todayISO(Date.parse('2026-10-11T12:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);

console.log('extract: all assertions passed');
