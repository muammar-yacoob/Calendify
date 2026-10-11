Gemini Kit
==========

Shared verbatim across textpert, still-applying, sellular-toolkit and bumboo.
This directory is copied, not forked. Change it in one place (TextPert, the
donor) and copy it across.

Files
-----
engine.js   The whole engine. A CLASSIC script, browser-only, zero dependencies.
            Everything is private; only globalThis.GeminiEngine escapes.
engine.mjs  A re-export of the above, for "type": "module" consumers. Nothing
            else belongs in it: logic there would live in one half of the kit
            and not the other, which is the fork this arrangement prevents.
readme.txt  This file.


One file, three ways of loading it
----------------------------------
Extensions in this portfolio load scripts differently, and rewriting one to
suit the other is not worth a fork of the engine. A file with no import/export
syntax is legal in all three worlds:

  importScripts('gemini-kit/engine.js')     classic service worker (bumboo)
  <script src="gemini-kit/engine.js">       popup, classic
  import { generate } from './gemini-kit/engine.mjs'   module worker

The first two get globalThis.GeminiEngine; the third gets named exports.
Never add an `export` to engine.js - that breaks both classic paths at once.


The rule that matters
---------------------
No key of ours is ever in here, and no request from here reaches a server we
pay for. An extension built on this kit has no backend to bill, no quota to
meter and no liability for what a user generates. A "fallback to our API when
Nano is missing" is the one change that must never be made: it re-creates the
shared Groq budget this replaced, and it re-creates the paywall that had to
exist to defend it.


Two providers, one rule for choosing
------------------------------------
  nano   Chrome's built-in Gemini Nano (Prompt API). On-device, free, offline,
         no account, no key. Chrome 138+ and roughly 22 GB of free disk.
  cloud  The Gemini API with a key the USER pasted into settings. Theirs, not
         ours. Works on any machine, better prose.

A key only exists because somebody deliberately pasted one in, so its presence
is read as an explicit choice and beats the built-in model.

Gemini Nano is NOT tied to the user's Google login, and nothing here can bill
Gemini to a consumer Google account: no such OAuth path exists. The pasted key
is the only way a user spends their own Gemini quota.


Using it
--------
  import { configure, generate, getStatus } from './gemini-kit/engine.mjs';
  // or, classic:  importScripts('gemini-kit/engine.js'); const { generate } = GeminiEngine;

  configure({ systemPrompt: '...', maxOutputTokens: 1000 });
  const text = await generate('Rewrite this: ...');
  const obj  = await generate(prompt, { json: true, schema: MY_SCHEMA });

Pass a schema whenever you need JSON. It constrains the decoder on both
providers, so the answer cannot come back as prose in a code fence and there is
no repair path to maintain. json:true without a schema is a best effort: the
kit strips a fence and parses, and throws EngineError('empty') if it cannot.

Every failure is an EngineError with a code the UI can act on:
  unsupported | downloadable | downloading | bad_key | rate_limit |
  network | blocked | empty | timeout | too_large | unknown

too_large is Nano only: its input window is small next to a cloud model's and
an oversized prompt rejects rather than truncating. Shed fields and retry.


Service worker notes
--------------------
The kit runs in an MV3 service worker, which is where all three consumers call
it from. That needs "type": "module" on the background entry in manifest.json.

createNanoSession(true) is for an explicit Enable button ONLY. create() does not
reject when the model is absent; it resolves when a multi-gigabyte download has
finished, so a generation path that allowed the download would hang silently for
as long as the download takes. Generation always passes false and lets the
'downloadable' error reach the UI.

Download progress is broadcast as a runtime message, ENGINE_DOWNLOAD_PROGRESS,
with a `loaded` fraction. The popup is usually closed, so the send is allowed to
reject and is swallowed.
