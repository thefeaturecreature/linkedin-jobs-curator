// LinkedIn Jobs Curator — background page: message hub + sync triggers
//
// Two triggers, per the design: a debounced "push" when local data changes, and a "pull" each
// time something opens (this background page itself starting, or a LinkedIn tab announcing it
// just loaded). Both actually run the same full bidirectional merge (see sync.js) — "push"/"pull"
// describe the trigger, not a partial operation.

(function () {
  'use strict';

  const PUSH_DEBOUNCE_MS = 3000;
  let pushTimer = null;
  let lastStatus = { lastSyncAt: null, lastError: null };

  async function isConnected() {
    const { connected, hasClientId, spreadsheetId } = await window.LJFAuth.getConfig();
    return Boolean(connected && hasClientId && spreadsheetId);
  }

  // storeNames: which tabs to sync (default: all three — used for pull-on-open and manual sync,
  // where we don't know what might have changed remotely). The change-triggered push passes just
  // the store(s) that actually changed, since each tab rewrite spends 2 of Sheets API's shared
  // per-minute write quota — no reason to spend 6 when 2 will do.
  async function runSync(label, storeNames) {
    if (!(await isConnected())) return;
    try {
      await window.LJFSync.syncAll(storeNames);
      lastStatus = { lastSyncAt: Date.now(), lastError: null };
    } catch (e) {
      console.warn('[LJF] sync (' + label + ') failed:', e);
      lastStatus = { lastSyncAt: lastStatus.lastSyncAt, lastError: String((e && e.message) || e) };
    }
  }

  async function getStatus() {
    const config = await window.LJFAuth.getConfig();
    return { ...config, ...lastStatus };
  }

  // Pull, on open — this page loading counts as an "open" (browser launch, extension
  // install/reload).
  runSync('startup');

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return undefined;
    switch (msg.type) {
      // Pull, on open — a LinkedIn tab just hydrated (see content/store.js).
      case 'ljf:tab-open':
        runSync('tab-open');
        return undefined;

      case 'ljf:connect':
        return window.LJFAuth.connect(msg.spreadsheetId)
          .then(() => runSync('connect'))
          .catch((e) => {
            lastStatus = { ...lastStatus, lastError: String((e && e.message) || e) };
          })
          .then(getStatus);

      case 'ljf:disconnect':
        return window.LJFAuth.disconnect().then(getStatus);

      case 'ljf:sync-now':
        return runSync('manual').then(getStatus);

      case 'ljf:get-status':
        return getStatus();

      default:
        return undefined;
    }
  });

  // Push, on change — debounced, and scoped to just the store(s) that changed. Key -> store-name
  // reverse lookup, and the set of stores touched since the last debounce fire (so e.g. editing a
  // rule and the dismiss log within the same few seconds still syncs both in one pass, not two).
  const KEY_TO_STORE = Object.fromEntries(
    Object.entries(window.LJFSync.STORE_KEYS).map(([name, key]) => [key, name])
  );
  const pendingStores = new Set();
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const touched = Object.keys(changes).filter((k) => k in KEY_TO_STORE);
    if (!touched.length) return;
    touched.forEach((k) => pendingStores.add(KEY_TO_STORE[k]));
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      const names = [...pendingStores];
      pendingStores.clear();
      runSync('change', names);
    }, PUSH_DEBOUNCE_MS);
  });
})();
