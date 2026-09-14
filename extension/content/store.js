// LinkedIn Jobs Curator — storage shim (content script)
//
// The ported core (curator.js) reads and writes through the synchronous userscript API
// GM_getValue / GM_setValue. Firefox's browser.storage.local is async, so this file backs
// those two names with an in-memory cache that is hydrated once before the core boots.
//
// Content scripts in a tab share one isolated-world scope, so the function declarations
// here are directly visible to curator.js (loaded after this file).

(function () {
  'use strict';

  const api = (typeof browser !== 'undefined' ? browser : chrome);
  const PREFIX = 'ljf_';

  // The only mutable state in this file. Populated by hydrate(), read by GM_getValue,
  // written by GM_setValue, and kept fresh by the storage.onChanged listener.
  const cache = Object.create(null);
  let hydrated = false;

  async function hydrate() {
    if (hydrated) return;
    try {
      const all = await api.storage.local.get(null);
      for (const key of Object.keys(all)) {
        if (key.startsWith(PREFIX)) cache[key] = all[key];
      }
    } catch (e) {
      console.warn('[LJF] storage hydrate failed — starting empty', e);
    }
    hydrated = true;

    // "Pull on open" trigger for the Google Sheets connector (extension/background/): fire-and-
    // forget, a no-op if the background isn't listening or the user hasn't connected a sheet.
    Promise.resolve(api.runtime.sendMessage({ type: 'ljf:tab-open' })).catch(() => {});
  }

  // Same contract the ~30 call sites expect: synchronous, returns the stored string or
  // the supplied default. Stored values are always strings (the core JSON-stringifies).
  function GM_getValue(key, dflt) {
    return key in cache ? cache[key] : dflt;
  }

  // Fire-and-forget: update the cache synchronously, persist in the background.
  function GM_setValue(key, value) {
    cache[key] = value;
    Promise.resolve(api.storage.local.set({ [key]: value }))
      .catch((e) => console.warn('[LJF] storage write failed for', key, e));
  }

  // Keep the cache current when another tab writes, and let the core re-scan.
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const touched = [];
    for (const key of Object.keys(changes)) {
      if (!key.startsWith(PREFIX)) continue;
      const { newValue } = changes[key];
      if (newValue === undefined) delete cache[key];
      else if (cache[key] === newValue) continue; // our own write echoing back
      else cache[key] = newValue;
      touched.push(key);
    }
    if (touched.length && typeof window.__ljfOnExternalChange === 'function') {
      window.__ljfOnExternalChange(touched);
    }
  });

  // curator.js awaits this before reading any setting.
  window.__ljfStore = { hydrate };

  // Expose the shims as globals for curator.js (same isolated world).
  window.GM_getValue = GM_getValue;
  window.GM_setValue = GM_setValue;
})();
