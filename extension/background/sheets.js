// LinkedIn Jobs Curator — background: Google Sheets API v4 client
//
// One spreadsheet, three tabs — schema (column order) for each is fixed here; anything on an
// object that isn't a named column round-trips through a trailing `meta` JSON column instead of
// being dropped, so a future field added to the JS shape doesn't lose data on sync.
//
// Reads use valueRenderOption=UNFORMATTED_VALUE and writes use valueInputOption=RAW, so a number
// or boolean written from JS comes back as the same JS type — no manual type coercion needed.

(function () {
  'use strict';

  const API = 'https://sheets.googleapis.com/v4/spreadsheets';

  const SCHEMAS = {
    rules: ['id', 'type', 'value', 'label', 'enabled'],
    applied_log: ['company', 'title', 'date', 'status', 'statusDate', 'url'],
    dismiss_log: ['jobId', 'company', 'title', 'location', 'date'],
  };
  const TAB_NAMES = Object.keys(SCHEMAS);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // One retry on 429 (Sheets' per-minute write quota is shared across all three tabs, so a burst
  // of activity — several edits plus a manual "Sync now" in quick succession — can trip it
  // briefly). Anything else fails immediately; a second 429 in a row isn't going to clear itself
  // in a couple seconds.
  async function sheetsFetch(spreadsheetId, path, options = {}, _retried = false) {
    const token = await window.LJFAuth.getToken();
    const res = await fetch(API + '/' + spreadsheetId + path, {
      ...options,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (res.status === 429 && !_retried) {
      await sleep(2000);
      return sheetsFetch(spreadsheetId, path, options, true);
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch {}
      throw new Error('Sheets API ' + res.status + (detail ? ': ' + detail : ''));
    }
    return res.status === 204 ? null : res.json();
  }

  // One object -> one row, in schema column order, with anything else JSON-packed into `meta`.
  function objectToRow(obj, columns) {
    const extra = {};
    for (const key of Object.keys(obj)) {
      if (!columns.includes(key)) extra[key] = obj[key];
    }
    const row = columns.map((c) => (obj[c] === undefined ? '' : obj[c]));
    row.push(Object.keys(extra).length ? JSON.stringify(extra) : '');
    return row;
  }

  // One row -> one object. Blank cells for known columns are omitted (not stored as '') so the
  // merge engine's equality checks don't see '' vs undefined as a difference.
  function rowToObject(row, columns) {
    const obj = {};
    columns.forEach((c, i) => {
      const v = row[i];
      if (v !== undefined && v !== '') obj[c] = v;
    });
    const metaCell = row[columns.length];
    if (metaCell) {
      try { Object.assign(obj, JSON.parse(metaCell)); } catch {}
    }
    return obj;
  }

  // Creates whichever of the three tabs don't already exist, with a header row. Existing tabs and
  // their data are left untouched.
  async function ensureTabs(spreadsheetId) {
    const meta = await sheetsFetch(spreadsheetId, '?fields=sheets.properties.title');
    const existing = new Set((meta.sheets || []).map((s) => s.properties.title));
    const missing = TAB_NAMES.filter((name) => !existing.has(name));
    if (!missing.length) return;

    await sheetsFetch(spreadsheetId, ':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      }),
    });
    for (const name of missing) {
      const header = [...SCHEMAS[name], 'meta'];
      await sheetsFetch(
        spreadsheetId,
        '/values/' + encodeURIComponent(name + '!A1') + '?valueInputOption=RAW',
        { method: 'PUT', body: JSON.stringify({ values: [header] }) }
      );
    }
  }

  // Reads one tab -> array of plain objects (schema columns + any meta fields).
  async function readTab(spreadsheetId, tabName) {
    const columns = SCHEMAS[tabName];
    const range = encodeURIComponent(tabName + '!A1:Z100000');
    const data = await sheetsFetch(spreadsheetId, '/values/' + range + '?valueRenderOption=UNFORMATTED_VALUE');
    const rows = data.values || [];
    return rows.slice(1).map((row) => rowToObject(row, columns)); // slice(1): skip header
  }

  // Replaces one tab's entire contents (header + data rows) with the given objects.
  async function writeTab(spreadsheetId, tabName, objects) {
    const columns = SCHEMAS[tabName];
    const header = [...columns, 'meta'];
    const values = [header, ...objects.map((o) => objectToRow(o, columns))];
    const range = encodeURIComponent(tabName + '!A1:' + 'Z' + (values.length + 10));
    await sheetsFetch(spreadsheetId, '/values/' + range + ':clear', { method: 'POST', body: '{}' });
    await sheetsFetch(
      spreadsheetId,
      '/values/' + encodeURIComponent(tabName + '!A1') + '?valueInputOption=RAW',
      { method: 'PUT', body: JSON.stringify({ values }) }
    );
  }

  window.LJFSheets = { TAB_NAMES, ensureTabs, readTab, writeTab };
})();
