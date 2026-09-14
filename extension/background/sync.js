// LinkedIn Jobs Curator — background: snapshot-diff merge engine
//
// Every sync — whether triggered by a local change or a tab opening — does the same full,
// bidirectional read-both-sides-and-merge. There's no cheaper "push-only" or "pull-only" variant:
// safely detecting a deletion on either side requires seeing both, so skipping one side risks
// clobbering a manual edit made directly in the sheet (or vice versa). "Push on change" / "pull on
// open" (see background.js) describe what *triggers* a sync, not what it reads.

(function () {
  'use strict';

  const STORE_KEYS = {
    rules: 'ljf_rules',
    applied_log: 'ljf_applied_log',
    dismiss_log: 'ljf_dismiss_log',
  };
  const SNAPSHOT_KEYS = {
    rules: 'ljfs_snapshot_rules',
    applied_log: 'ljfs_snapshot_applied_log',
    dismiss_log: 'ljfs_snapshot_dismiss_log',
  };

  function logEntryKey(e) {
    return (e.company || '').toString().toLowerCase() + '\x00' + (e.title || '').toString().toLowerCase();
  }
  const KEY_FNS = {
    rules: (e) => String(e.id),
    applied_log: logEntryKey,
    dismiss_log: (e) => (e.jobId ? 'id:' + e.jobId : logEntryKey(e)),
  };

  function stableStringify(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    return '{' + Object.keys(obj).sort()
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') + '}';
  }

  function toMap(arr, keyFn) {
    const m = new Map();
    for (const item of arr) m.set(keyFn(item), item);
    return m;
  }

  // Applies one side's changes (relative to the snapshot) onto `target`, in place.
  function applyDiff(target, snapMap, sideMap) {
    for (const [key, val] of sideMap) {
      const snapVal = snapMap.get(key);
      if (!snapVal || stableStringify(snapVal) !== stableStringify(val)) target.set(key, val);
    }
    for (const key of snapMap.keys()) {
      if (!sideMap.has(key)) target.delete(key);
    }
  }

  // Pure: (local, remote, snapshot arrays) -> merged array. Local wins any same-key conflict
  // (edited-vs-edited, or edited-vs-deleted) since remote is applied first, local applied on top.
  function mergeStore(local, remote, snapshot, keyFn) {
    const snapMap = toMap(snapshot, keyFn);
    const merged = new Map(snapMap);
    applyDiff(merged, snapMap, toMap(remote, keyFn));
    applyDiff(merged, snapMap, toMap(local, keyFn));
    return [...merged.values()];
  }

  async function loadLocalArray(key) {
    const stored = await browser.storage.local.get(key);
    try { return JSON.parse(stored[key] || '[]'); } catch { return []; }
  }
  async function loadSnapshotArray(key) {
    const stored = await browser.storage.local.get(key);
    try { return JSON.parse(stored[key] || '[]'); } catch { return []; }
  }

  const inFlight = new Map(); // storeName -> Promise, so overlapping triggers share one run

  // Merges one store (by name) between local storage and its sheet tab, writing the result back
  // to both places plus the new snapshot. Returns the merged array.
  function syncStore(storeName) {
    if (inFlight.has(storeName)) return inFlight.get(storeName);
    const p = (async () => {
      const { spreadsheetId } = await window.LJFAuth.getConfig();
      if (!spreadsheetId) throw new Error('No spreadsheet configured');

      const localKey = STORE_KEYS[storeName];
      const snapshotKey = SNAPSHOT_KEYS[storeName];
      const keyFn = KEY_FNS[storeName];

      const [local, remote, snapshot] = await Promise.all([
        loadLocalArray(localKey),
        window.LJFSheets.readTab(spreadsheetId, storeName),
        loadSnapshotArray(snapshotKey),
      ]);

      const merged = mergeStore(local, remote, snapshot, keyFn);
      const mergedJson = JSON.stringify(merged);

      // Only write what actually changed, on either side. This isn't just an optimization: an
      // unconditional local-storage write here would fire storage.onChanged even when nothing
      // changed, which re-arms the debounced push (background.js) and syncs again in 3s — if the
      // sheet write is failing (e.g. rate-limited), that retry does the same no-op local write
      // and loops forever, which is worse than just "slow". Comparing first breaks that loop.
      const writes = [];
      if (mergedJson !== JSON.stringify(local))  writes.push(browser.storage.local.set({ [localKey]: mergedJson }));
      if (mergedJson !== JSON.stringify(remote)) writes.push(window.LJFSheets.writeTab(spreadsheetId, storeName, merged));
      await Promise.all(writes);

      if (mergedJson !== JSON.stringify(snapshot)) {
        await browser.storage.local.set({ [snapshotKey]: mergedJson });
      }

      return merged;
    })();
    inFlight.set(storeName, p);
    // Cleanup runs on both success and failure; `.catch(() => {})` only swallows *this* chain's
    // rejection (the cleanup chain nothing else consumes) — `p` itself, returned below, still
    // rejects normally for whoever's actually awaiting the sync.
    p.finally(() => inFlight.delete(storeName)).catch(() => {});
    return p;
  }

  // Syncs the given stores (default: all three). Pass a specific list — e.g. just the one store
  // that changed — to avoid rewriting every tab when only one needs it (each tab rewrite costs 2
  // of Sheets API's write-quota units, and that quota is shared per-minute across all three).
  async function syncAll(storeNames) {
    const { spreadsheetId } = await window.LJFAuth.getConfig();
    if (!spreadsheetId) throw new Error('No spreadsheet configured');
    const names = storeNames && storeNames.length ? storeNames : Object.keys(STORE_KEYS);
    await window.LJFSheets.ensureTabs(spreadsheetId);
    await Promise.all(names.map(syncStore));
  }

  window.LJFSync = { syncAll, syncStore, mergeStore, STORE_KEYS };
})();
