/* Calendify's AI persona.
 *
 * The engine itself is src/js/gemini-kit/engine.js, copied byte-for-byte from
 * TextPert and shared with bumboo, minutely, still-applying and BotOrNot: never
 * edit the kit to suit this app, or the copies fork and the next fix has to be
 * made six times. Everything app-flavoured belongs here.
 *
 * Loaded by background.js immediately after the kit, for its side effect.
 */
import { configure } from './gemini-kit/engine.mjs';

configure({
	// The persona has to go through configure() rather than per-call opts:
	// opts.systemPrompt is cloud-only (engine.js:190), while Nano answers from
	// the cached root session built out of config.systemPrompt (engine.js:253).
	systemPrompt:
		'You read one web page, or one piece of text selected on it, and pull out the single ' +
		'calendar event it describes. Work only from the text you are given: never invent a ' +
		'title, a date, a time, a place or a link. Copy the date and time phrase into whenText ' +
		'exactly as it is written on the page, and do not convert it to a date yourself. Leave ' +
		'a field as an empty string rather than guessing. Return only the JSON you were asked for.',

	cloudModel: 'gemini-2.5-flash',

	// Low, deliberately. The one thing this model must not do is write a
	// plausible date over a page that never stated one. Invention is the
	// failure mode; an empty field is not.
	temperature: 0.2,

	// Nine short strings, one of which is a page description. Truncation comes
	// back as EngineError('empty'), not as a partial object, so this has to
	// clear the whole object rather than merely most of it.
	maxOutputTokens: 700,

	// 2.5 Flash would otherwise spend the entire budget thinking and return an
	// empty candidate. Nothing here reasons.
	thinkingBudget: 0,

	// The kit's default, and shared on purpose: someone who has already pasted
	// a key into one of these extensions does not have to paste it again.
	storageKey: 'geminiApiKey',
});
