// ES module view of engine.js, for consumers whose service worker is
// "type": "module". The import below is for its side effect: engine.js has no
// module syntax, so it evaluates as a module and hangs its API on globalThis,
// which this file then re-exports under the names an importer expects.
//
// Keep this file a re-export and nothing else. Any logic here exists in one
// half of the kit and not the other, which is the fork it is meant to prevent.

import './engine.js';

const E = globalThis.GeminiEngine;

export const EngineError = E.EngineError;
export const configure = E.configure;
export const getStorageKey = E.getStorageKey;
export const getApiKey = E.getApiKey;
export const getStatus = E.getStatus;
export const generate = E.generate;
export const createNanoSession = E.createNanoSession;
export const resetNanoSession = E.resetNanoSession;
