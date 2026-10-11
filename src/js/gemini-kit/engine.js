// Gemini engine - talks to Google Gemini directly. No proxy, no relay, no shared key.
//
// A CLASSIC script: no import/export, everything private, and only
// globalThis.GeminiEngine escapes. That is what lets one file serve every
// consumer - importScripts() in a classic worker, a <script> tag in a popup,
// and `import` from an ES module worker (a file with no module syntax is a
// valid module; engine.mjs side-effect imports this one and re-exports what it
// hung on globalThis). Adding an `export` here forks the kit in half.
//
// Two providers, and the user's own key decides which one runs:
//   nano  - Chrome's built-in Gemini Nano (Prompt API). Zero setup, on-device, free, offline.
//   cloud - Gemini API with the user's OWN AI Studio key. Better prose, works on any machine.
// A key only ever exists because someone deliberately pasted one in, so its presence is
// treated as an explicit choice and wins over the built-in model.
//
// NOTHING here may ever hold a key of ours. That is the whole point of the module: an
// extension built on it has no backend to bill, no quota to meter and no liability for
// what a user generates. If you find yourself adding a fallback that spends our money,
// you have rebuilt the thing this replaced.
//
// The Prompt API is on-device and is NOT tied to the user's Google login. There is no
// consumer OAuth path that bills Gemini to a personal Google account; the pasted key is
// the only way a user can spend their own Gemini quota, and it is theirs, not ours.

(() => {
  const CLOUD_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

  // Roasting is the product in one of the three consumers. Only block what is genuinely
  // harmful, or half that app 404s on itself.
  const SAFETY_SETTINGS = [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT'
  ].map(category => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

  // Every failure carries a code so the UI can say something useful instead of "something failed".
  class EngineError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'EngineError';
      this.code = code;
    }
  }

  /* --------------------------------------------------------------- config -- */

  // Per-app settings. The kit is copied verbatim between extensions, so everything
  // app-flavoured (the persona, the token ceiling, the storage key) is configured by
  // the caller rather than edited into the copy - an edited copy is a forked copy.
  const config = {
    systemPrompt: 'You are a helpful assistant. Return only the requested text: no preamble, no surrounding quotes, no explanation.',
    cloudModel: 'gemini-2.5-flash',
    temperature: 1.0,
    maxOutputTokens: 400,
    // 2.5 Flash thinks by default and would spend the whole token budget doing it,
    // returning an empty candidate. Raise this only for a task that genuinely reasons.
    thinkingBudget: 0,
    storageKey: 'geminiApiKey',
    timeoutMs: 45000
  };

  function configure(overrides = {}) {
    Object.assign(config, overrides);
  }

  function getStorageKey() {
    return config.storageKey;
  }

  // Reads from chrome.storage in an extension and localStorage in a plain page:
  // the same engine backs Bot or Not's extension and its PWA, and a kit that
  // only works in one of them would have been copied and edited to serve the
  // other, which is the fork this directory exists to prevent.
  async function getApiKey() {
    if (globalThis.chrome?.storage?.local) {
      const stored = await chrome.storage.local.get([config.storageKey]);
      return (stored[config.storageKey] || '').trim();
    }
    try {
      return (globalThis.localStorage?.getItem(config.storageKey) || '').trim();
    } catch {
      // Storage can throw outright (private mode, blocked site data). No key is
      // the right answer then: it falls through to the on-device model.
      return '';
    }
  }

  /* --------------------------------------------------------------- status -- */

  const nanoSupported = () => typeof LanguageModel !== 'undefined';

  // Chrome answers the first availability() probe of a cold service worker before it has
  // finished checking the hardware, and optimistically guesses 'downloadable'; the settled
  // answer arrives ~1.4s later and every call after that is instant. Trusting the guess
  // either offers an Enable button that cannot work, or tells a user who already has the
  // model to download it. One confirming read is enough to settle it.
  async function settledAvailability() {
    const first = await LanguageModel.availability();
    return first === 'downloadable' ? LanguageModel.availability() : first;
  }

  /**
   * Which engine will serve the next request, and is it ready?
   * state: 'available' | 'downloadable' | 'downloading' | 'unsupported'
   */
  async function getStatus() {
    const apiKey = await getApiKey();
    if (apiKey) return { engine: 'cloud', state: 'available', model: config.cloudModel };
    if (!nanoSupported()) return { engine: 'nano', state: 'unsupported', model: 'Gemini Nano' };

    try {
      const state = await settledAvailability();
      return { engine: 'nano', state: state === 'unavailable' ? 'unsupported' : state, model: 'Gemini Nano' };
    } catch {
      return { engine: 'nano', state: 'unsupported', model: 'Gemini Nano' };
    }
  }

  /* ------------------------------------------------------------- generate -- */

  /**
   * @param {string} prompt
   * @param {object} [opts]
   * @param {boolean} [opts.json]   Parse the answer as JSON and return the object.
   * @param {object}  [opts.schema] JSON Schema. Constrains the decoder on BOTH providers,
   *   which is what makes JSON safe to rely on: a schema-constrained answer cannot come
   *   back as prose with a code fence around it, so there is no repair path to maintain.
   * @param {number}  [opts.temperature]
   * @param {number}  [opts.maxOutputTokens]
   */
  async function generate(prompt, opts = {}) {
    const apiKey = await getApiKey();
    const work = apiKey ? cloudGenerate(prompt, apiKey, opts) : nanoGenerate(prompt, opts);

    let timer;
    let text;
    try {
      text = await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new EngineError('timeout', 'Gemini took too long to answer.')), config.timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }

    if (!opts.json) return text;
    try {
      return JSON.parse(stripFence(text));
    } catch (e) {
      throw new EngineError('empty', `Expected JSON, got: ${text.slice(0, 120)}`);
    }
  }

  // A schema-constrained decoder does not fence its output, but an unconstrained
  // json:true call (no schema passed) still can.
  function stripFence(text) {
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    return fenced ? fenced[1] : text;
  }

  /* ---------------------------------------------------------------- cloud -- */

  function cloudErrorCode(status) {
    if (status === 400 || status === 401 || status === 403) return 'bad_key';
    if (status === 429) return 'rate_limit';
    if (status >= 500) return 'network';
    return 'unknown';
  }

  async function cloudGenerate(prompt, apiKey, opts) {
    const generationConfig = {
      temperature: opts.temperature ?? config.temperature,
      maxOutputTokens: opts.maxOutputTokens ?? config.maxOutputTokens,
      thinkingConfig: { thinkingBudget: config.thinkingBudget }
    };
    if (opts.json) {
      generationConfig.responseMimeType = 'application/json';
      if (opts.schema) generationConfig.responseSchema = opts.schema;
    }

    let res;
    try {
      res = await fetch(`${CLOUD_ENDPOINT}/${config.cloudModel}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.systemPrompt || config.systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          safetySettings: SAFETY_SETTINGS,
          generationConfig
        })
      });
    } catch (e) {
      throw new EngineError('network', e.message);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new EngineError(cloudErrorCode(res.status), data?.error?.message || `HTTP ${res.status}`);
    }

    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map(part => part.text)
      .filter(Boolean)
      .join('')
      .trim();

    if (!text) {
      const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || 'no candidates';
      throw new EngineError(reason === 'SAFETY' ? 'blocked' : 'empty', reason);
    }
    return text;
  }

  /* ----------------------------------------------------------------- nano -- */

  // One long-lived session holds the system prompt; each request gets a clone, so one
  // answer never leaks into the next as conversation history.
  let nanoRoot = null;

  function broadcastProgress(loaded) {
    chrome.runtime
      .sendMessage({ type: 'ENGINE_DOWNLOAD_PROGRESS', loaded })
      .catch(() => { /* nothing listening - the popup is usually closed */ });
  }

  /**
   * @param {boolean} allowDownload Only the popup's explicit Enable button passes true.
   *   Generation must never pass it: when the model is not on disk, create() does not
   *   reject - it resolves only once a multi-gigabyte download has finished. Awaiting
   *   that from a right-click is what left the modal spinning silently forever.
   */
  async function createNanoSession(allowDownload = false) {
    if (nanoRoot) return nanoRoot;
    if (!nanoSupported()) {
      throw new EngineError('unsupported', 'This Chrome build has no built-in AI. Update to Chrome 138+.');
    }

    const state = await settledAvailability();
    if (state === 'unavailable') {
      throw new EngineError('unsupported', 'Gemini Nano cannot run on this device.');
    }
    if (state !== 'available' && !allowDownload) {
      // 'downloadable' or 'downloading' - hand the state back so the UI can offer the download.
      throw new EngineError(state, 'Gemini has not finished downloading yet.');
    }

    try {
      nanoRoot = await LanguageModel.create({
        initialPrompts: [{ role: 'system', content: config.systemPrompt }],
        monitor(m) {
          m.addEventListener('downloadprogress', e => broadcastProgress(e.loaded));
        }
      });
    } catch (e) {
      nanoRoot = null;
      throw new EngineError('unsupported', e.message);
    }
    return nanoRoot;
  }

  // Changing the persona has to drop the cached root, or every later call keeps answering
  // with the system prompt the first caller happened to configure.
  function resetNanoSession() {
    nanoRoot?.destroy?.();
    nanoRoot = null;
  }

  async function nanoGenerate(prompt, opts) {
    const root = await createNanoSession();

    let session;
    try {
      session = await root.clone();
    } catch {
      // A stale root survives extension reloads and GPU resets; rebuild once.
      nanoRoot = null;
      session = await (await createNanoSession()).clone();
    }

    const promptOpts = {};
    if (opts.json && opts.schema) promptOpts.responseConstraint = opts.schema;

    try {
      const text = (await session.prompt(prompt, promptOpts)).trim();
      if (!text) throw new EngineError('blocked', 'Gemini Nano declined to answer.');
      return text;
    } catch (e) {
      if (e instanceof EngineError) throw e;
      // Nano's input window is small next to a cloud model's, and an oversized
      // prompt rejects rather than truncating. The caller can shed fields and
      // retry, but only if it can tell this apart from a refusal to answer.
      if (e?.name === 'QuotaExceededError') throw new EngineError('too_large', e.message);
      throw new EngineError('blocked', e.message);
    } finally {
      session.destroy();
    }
  }

  globalThis.GeminiEngine = {
    EngineError,
    configure,
    getStorageKey,
    getApiKey,
    getStatus,
    generate,
    createNanoSession,
    resetNanoSession,
  };
})();
