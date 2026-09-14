# LinkedIn Jobs Curator

A Firefox extension (`extension/`) that brings rule-based filtering, highlights, and an application
tracker to LinkedIn job search. All new work happens here.

`legacy-monkey-script/linkedin-job-filter.js` is the original Violentmonkey userscript this project
grew out of. It still works and is kept around so existing users aren't stranded, but it is frozen —
**do not edit it**. Fixes, features, and selector updates land only in `extension/`; the two files
are expected to diverge over time.

## Extension layout

- `extension/manifest.json` — Manifest V2. Content script matches `https://www.linkedin.com/*`.
- `extension/content/curator.js` — the core: card scanning, rule matching, the side panel UI,
  application/dismiss logs, settings, backup/restore. Everything described below lives here.
- `extension/content/store.js` — backs `GM_getValue`/`GM_setValue` with an in-memory cache
  hydrated from `browser.storage.local` (see `FUNCTIONS.md` for the shim functions).
- `extension/options/` — the extension's options page: just the local-storage explainer, and a
  pointer to the panel's Backup tab for Sheets sync (see below) — no functional UI of its own.
- `extension/background/` — MV2 background page implementing Sheets sync (see below). Files load
  in manifest order (`auth.js`, `sheets.js`, `sync.js`, `background.js`) sharing one global scope,
  same pattern as the content scripts.
- Dev commands: `npm install`, then `npm start` (runs via `web-ext`), `npm run lint`, `npm run build`.

### Google Sheets sync (`extension/background/`)

Optional, opt-in, per-browser — off until the user authorizes it. Syncs the three array stores
(`ljf_rules`, `ljf_applied_log`, `ljf_dismiss_log`) to one user-provided spreadsheet, one tab each;
settings stay local always. **The connect/disconnect/sync-now UI lives in the in-page panel's
Settings → Backup tab** (`buildSheetsSyncSection()` in `content/curator.js`), not the options page —
a content script can't call `browser.identity` directly, so that UI just messages the background,
which does the actual OAuth/Sheets work.

- `auth.js` — `browser.identity.launchWebAuthFlow` (implicit grant), token cache/refresh. The OAuth
  client ID comes from `window.LJF_CONFIG.clientId`, set by `config.local.js` (gitignored — copy
  `config.local.example.js` per `SETUP.md`; loaded first in `manifest.json`'s background scripts).
  Other config keys are prefixed `ljfs_` (not `ljf_`) so they're never
  mistaken for synced data or touched by `store.js`'s `ljf_`-only hydrate.
- `sheets.js` — Sheets API v4 client: `ensureTabs`/`readTab`/`writeTab`. Fixed column schema per
  tab (`SCHEMAS`), with a trailing `meta` JSON column catching any field not in the schema.
- `sync.js` — pure `mergeStore(local, remote, snapshot, keyFn)`: snapshot-diff merge, local wins
  same-key conflicts. No `updatedAt`/timestamps needed. See `SETUP.md` for the merge semantics.
- `background.js` — wiring: pull-on-open (background startup + a `ljf:tab-open` message each
  content-script hydrate fires), push-on-change (debounced `storage.onChanged`), and the
  `ljf:connect`/`ljf:disconnect`/`ljf:sync-now`/`ljf:get-status` messages the Backup tab sends.
- `SETUP.md` — the one-time Google Cloud OAuth client walkthrough for whoever installs this.

## What it does

- Watches job cards via `MutationObserver`
- Applies user-defined rules to each card (company, title, salary, industry, job ID, applied status)
- Highlights matched cards red (dismiss) or green (highlight) with a badge
- Optionally auto-clicks LinkedIn's native dismiss button for matched cards
- Cross-references cards against an imported application log; badges with date + days elapsed
- Side panel (right edge) for rule management, log viewing, settings, and backup/restore

## Rule types

`RULE_TYPES` constant defines all supported types. To add a new type: add it to `RULE_TYPES` and add a matching function. Types `applied`, `salarybelow`, and `topsalarybelow` are rendered as sticky blocks in the panel, not listed in the add-rule dropdown.

## Key selectors

```js
CARD_SEL    // job card list items
TITLE_SEL   // job title link
COMPANY_SEL // company name
SALARY_SEL  // salary metadata
DISMISS_SEL // LinkedIn's native dismiss button
```

These are the first thing to check when LinkedIn ships a layout change.

## Storage

`GM_setValue` / `GM_getValue` — keys prefixed `ljf_`, backed by `browser.storage.local` via
`extension/content/store.js`.

| Key | Default | Purpose |
|---|---|---|
| `ljf_rules` | `[]` | Rule definitions |
| `ljf_applied_log` | `[]` | Application log entries |
| `ljf_darkMode` | `'dark'` | Theme |
| `ljf_jobLogEnabled` | `'true'` | Log matching on/off |
| `ljf_dismissActions` | `'false'` | Auto-dismiss on/off |
| `ljf_hoverMenu` | `'true'` | Hover action menu on/off |
| `ljf_reapplyDays` | `'14'` | Reapply window threshold |
| `ljf_activePanel` | `'rules'` | Last active panel tab |
| `ljf_onboarded` | `'false'` | Onboarding modal shown |
| `ljf_quickDismissMode` | `'company'` | Quick dismiss mode (`company`, `title`, `location`) |
| `ljf_hideRecentlyApplied` | `'false'` | Hide yellow (recently applied company) cards |
| `ljf_dismiss_log` | `[]` | Dismiss log entries |
| `ljf_dismissLogExpiry` | `'180'` | Days before dismiss log entries expire |
| `ljf_dismissLogMatchLocation` | `'false'` | Match location when re-flagging dismissed jobs |
| `ljf_dismissLogCardsRed` | `'false'` | Show dismiss log cards in red (vs grey) |
| `ljf_flagMatchingCompanies` | `'true'` | Flag cards where company matches applied log but title doesn't |

## Functions reference

See `FUNCTIONS.md` for a full index of notable functions.
