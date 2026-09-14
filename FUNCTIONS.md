# Functions Reference

Notable functions in `linkedin-job-filter.js` (the userscript) and, where noted, the
Firefox extension under `extension/`.

## Storage shim (extension only — `extension/content/store.js`)
| Function | Description |
|---|---|
| `hydrate()` | Load all `ljf_*` keys from `browser.storage.local` into an in-memory `cache` once, before the core boots; also fires a fire-and-forget `ljf:tab-open` runtime message (the Sheets sync "pull on open" trigger). Exposed as `window.__ljfStore.hydrate`. |
| `GM_getValue(key, dflt)` | Synchronous read from `cache` (same contract the userscript core expects). Exposed as `window.GM_getValue`. |
| `GM_setValue(key, value)` | Write `cache` synchronously, persist to `browser.storage.local` fire-and-forget. Exposed as `window.GM_setValue`. |
| `storage.onChanged` listener | Refresh `cache` on another tab's write, then call `window.__ljfOnExternalChange(keys)` (set by `curator.js` to reload the arrays and re-scan). Self-writes are suppressed. |

## Google Sheets sync (extension only — `extension/background/`)

Files load in manifest order (`auth.js`, `sheets.js`, `sync.js`, `background.js`), sharing one
background-page global scope. `ljfs_*`-prefixed storage keys hold sync config/tokens — local-only,
never synced, never touched by `store.js`'s `ljf_*`-only hydrate.

### `auth.js` — OAuth (`window.LJFAuth`)
| Function | Description |
|---|---|
| `getConfig()` | Returns `{ hasClientId, spreadsheetId, connected }` from local storage + `window.LJF_CONFIG.clientId` (set by `config.local.js`) |
| `getToken({interactive})` | Returns a valid access token — cached if unexpired, else a silent `prompt=none` refresh, else (only if `interactive:true`) a visible consent window (opens in a new tab) |
| `connect(spreadsheetId)` | Saves the spreadsheet ID, runs an interactive auth round-trip (throws on failure/cancel, e.g. missing client ID in `config.local.js`), marks connected |
| `disconnect()` | Clears the token and `connected` flag; keeps `spreadsheetId` for easy reconnect |

### `sheets.js` — Sheets API v4 client (`window.LJFSheets`)
| Function | Description |
|---|---|
| `ensureTabs(spreadsheetId)` | Creates whichever of `rules`/`applied_log`/`dismiss_log` don't exist yet, with a header row; leaves existing tabs untouched |
| `readTab(spreadsheetId, tabName)` | Reads a tab (`valueRenderOption=UNFORMATTED_VALUE`) → array of plain objects, via the tab's fixed `SCHEMAS` column list plus a `meta` JSON catch-all column |
| `writeTab(spreadsheetId, tabName, objects)` | Clears a tab and rewrites header + all rows (`valueInputOption=RAW`) — whole-tab rewrite per sync, not cell-level patching |

### `sync.js` — merge engine (`window.LJFSync`)
| Function | Description |
|---|---|
| `mergeStore(local, remote, snapshot, keyFn)` | Pure: snapshot-diff 3-way merge of one store's arrays — local wins any same-key conflict (edit-vs-edit or edit-vs-delete). No timestamps needed. |
| `syncStore(storeName)` | Reads local + remote + snapshot for one store, merges, writes the result to both local storage and the sheet, saves the new snapshot. Coalesces overlapping calls via an in-flight `Promise` map. |
| `syncAll()` | `ensureTabs()` then `syncStore()` for all three stores in parallel |

### `background.js` — wiring
Runs `syncAll()` on its own load (pull-on-open) and on an `ljf:tab-open` message from a content
script; runs it again (debounced ~3s) on `storage.onChanged` for the three synced keys (push-on-
change). Also answers `ljf:connect`/`ljf:disconnect`/`ljf:sync-now`/`ljf:get-status` messages sent
by the in-page panel's Backup tab (`buildSheetsSyncSection()` in `content/curator.js` — not the
options page, which can't call `browser.identity` directly).

## Rule Management
| Function | Description |
|---|---|
| `loadRules()` | Load rules array from GM storage |
| `saveRules()` | Persist rules to GM storage |
| `addRule(type, value, label)` | Add a new rule and save |
| `updateRule(id, value, label)` | Update rule value/label by ID |
| `removeRule(id)` | Delete rule by ID |
| `toggleRule(id)` | Toggle rule enabled state |

## Applied Log
| Function | Description |
|---|---|
| `loadAppliedLog()` | Load applied log from GM storage |
| `saveAppliedLog()` | Persist applied log, rebuild index |
| `buildLogIndex()` | Build Map of company → regex for O(1) lookup |
| `matchJobLog(card)` | Find exact applied log entry for a card |
| `matchJobLogCompanyOnly(card)` | Find most recent applied date for card's company |
| `logCompanyMatches(cardCompany, entryCompany)` | Test company name against log entry |

## Dismiss Log
| Function | Description |
|---|---|
| `loadDismissLog()` | Load dismiss log from GM storage |
| `saveDismissLog()` | Persist dismiss log, prune expired entries, rebuild index |
| `buildDismissLogIndex()` | Build Map with `id:<jobId>` and `ct:<company>\x00<title>` keys |
| `matchDismissLog(card)` | Find dismiss log entry for a card (jobId first, then company+title) |
| `logDismissal(card)` | Add/update dismiss log entry for a card; calls `refreshDismissUI` on save |
| `refreshDismissUI()` | Update dismiss log count badge and re-render the dismiss log pane if it's open |
| `undoLogDismissal(card)` | Remove dismiss log entry for a card (called on undo) |
| `actDismissLog(card, entry)` | Apply grey (or red) tint + badge to a previously-dismissed card |
| `applyDismissLog()` | Run `matchDismissLog`/`actDismissLog` on all cards |
| `resetCard(card)` | Strip all script-applied styles/badges/dataset markers from one card (used on undo) |
| `setupDismissCapture()` | Document-level click listener: restores a card on LinkedIn's native undo click, and logs a dismissal on LinkedIn's native X click (list card or job detail panel) |

## Color Management
| Function | Description |
|---|---|
| `hexToRgb(hex)` | Parse hex color string to `[r, g, b]` array |
| `rowTint(hex, alpha)` | Return `rgba(...)` string from a hex color and alpha, for panel row tints |
| `buildCC(colors)` | Build the `CC` overlay-color object from a `userColors`-shaped input |
| `saveColors()` | Persist `userColors` to GM storage |

## Card Helpers
| Function | Description |
|---|---|
| `cacheCardIdentity(card)` | Cache company/title/jobId/location on card dataset so `logDismissal` can read them after LinkedIn collapses the DOM |
| `cardText(card, sel)` | Extract text content from first matching element in card |
| `cardJobId(card)` | Extract LinkedIn job ID from card title link href |
| `cardLocationText(card)` | Extract non-salary metadata text (location) from card |
| `isDismissed(card)` | True if card has been dismissed (by us or LinkedIn) |
| `getCards()` | Return all job card elements currently in the DOM |
| `countMatches(rule)` | Count cards matching a given rule |

## Card Matchers
| Function | Description |
|---|---|
| `matchApplied(card)` | Matches cards with LinkedIn's "Applied" footer badge |
| `matchCompany(card, rule)` | Company name substring match |
| `matchTitle(card, rule)` | Title keyword match (normalizes "Sr." → "Senior") |
| `matchLocation(card, rule)` | Location keyword match via SALARY_SEL metadata |
| `parseSalaries(card)` | Parse annualized salary values from card DOM; falls back to `ljfDetailSalaries` dataset cache if card has none |
| `parseSalaryDisplayText(text)` | Formats salary matches from raw text into a compact display string (e.g. `$154k - $190k`, `$34/hr`) |
| `getSalaryDisplay(card)` | Returns compact display string from card DOM salary elements or `ljfDetailSalaryDisplay` cache |
| `salaryBadgeLabel(rule, display)` | Appends detected salary in parens to salary rule badge labels |
| `matchSalary(card, rule)` / `matchTopSalary` | Salary floor checks |
| `matchSalaryAbove(card, rule)` / `matchTopSalaryAbove` | Salary ceiling checks |

## Card Styling
| Function | Description |
|---|---|
| `addBadge(card, text, bg)` | Add a positioned label badge to a card |
| `markDismissed(card)` | Apply orange tint + "dismissed" badge; logs to dismiss log; hides if toggle on |
| `actJobLog(card, entry)` | Apply red tint + "Applied on [date]" badge |
| `actJobLogCompanyLabel(card, date)` | Apply yellow tint + "Last applied" company badge |
| `clearInnerBorder(card)` | Remove LinkedIn's inner card border-left override |

## Rule Application
| Function | Description |
|---|---|
| `applyCardRules(card)` | Apply all rules to one card; returns match count |
| `parseSearchDetailSalaries()` | Extract salary from the search page detail panel; returns `{ values, display }` — values are annualized, display is a compact string like `$154k - $190k` |
| `getViewPageSalaryDisplay(hero)` | Returns compact salary display string for the view page hero (checks hero text first, then description) |
| `applyDetailPanelSalary()` | On list/search pages, extract salary from the right-side detail panel and cache both `ljfDetailSalaries` (annualized) and `ljfDetailSalaryDisplay` (formatted) on the active card |
| `applyAllRules()` | Full pass: detail-panel salary → rules → job log → dismiss log → visibility → tab count |
| `applyJobLog()` | Apply applied log matching to all cards |
| `applyDismissLog()` | Apply dismiss log matching to all cards |
| `applyRecentlyAppliedVisibility()` | Hide/show yellow+dismissed+grey-dismisslog cards per toggle |
| `applyViewHeroRules()` | Apply rules to the job detail page hero banner |
| `applySavedJobRules()` | Apply rules to saved jobs page cards |
| `dismissRule(rule)` | Click X on all cards matching a rule |
| `dismissJobLog()` | Click X on all cards matching an applied log entry |
| `dismissDismissLog()` | Click X on all cards flagged by the dismiss log (grey or red) |
| `clearHighlights()` | Remove all script-applied styles and dataset markers from all cards |
| `reconcileDismissedCards()` | Clear `ljfDismissed` from cards that LinkedIn has since restored |
| `captureBypassedDismissals(mutations)` | Detect dismissals bypassing the click handler by scanning childList added nodes AND attribute mutations (classList.add) for `.job-card-list--is-dismissed` |

## UI
| Function | Description |
|---|---|
| `buildUI()` | Create the side tab, panel, wire all events |
| `buildPanelHTML()` | Return the panel innerHTML template string |
| `buildPanelContent()` | Rebuild panel HTML, styles, and events |
| `wirePanelEvents()` | Attach event listeners for all panel controls |
| `buildPanelStyles()` | Inject/update the `<style id="ljf-styles">` tag |
| `setPanelVars()` | Set CSS custom properties on the panel element |
| `updateTabCount()` | Update red/green/yellow pill counts on the side tab |
| `updateDismissLogCount()` | Update dismiss log count display in the status bar |
| `renderRules()` | Re-render the rules panel pane |
| `renderJobsPane()` | Re-render the jobs pane; toggles between applied log and dismiss log views via `activeLogView`. Jobs-view footer has a blank-add button (`_`) and an autofill button (`+`) that fills the add-job form from `detectCurrentJobListing()` |
| `openSettingsModal()` | Open settings/backup modal dialog |
| `buildSheetsSyncSection()` | Backup tab's Google Sheets sync controls (spreadsheet field, Authorize/Disconnect, Sync now, status line); messages the background page (`ljf:connect`/`ljf:disconnect`/`ljf:sync-now`/`ljf:get-status`) rather than touching `browser.identity` itself |
| `openOnboardingModal()` | Show first-run onboarding modal |
| `setStatus(msg)` | Set panel status bar message |
| `setupCardHoverMenu()` | Build and wire the hover-over-X quick action menu |

## Export / Import
| Function | Description |
|---|---|
| `exportRules()` | Download rules as JSON |
| `importRules()` | Upload and parse rules JSON |
| `exportAppliedLog(withDismissLog?)` | Download applied log (+ optional dismiss log) as JSON |
| `importAppliedLog()` | Upload applied log JSON; routes dismiss log if present |
| `showLogImportDialog(incoming, incomingDismiss?)` | Show append/overwrite modal for log import |
| `exportAppliedLogCsv(withDismissLog?)` | Download log as CSV with `type` column |
| `importAppliedLogCsv()` | Upload log CSV; routes dismissed rows to dismiss log |
| `downloadLogCsvTemplate()` | Download sample CSV for manual data entry |

## Job Listing Detection

LinkedIn's job-detail markup is atomic-CSS (every class name is a short hash, regenerated per
deploy) — no classname selector survives it. Detection instead keys off the job ID in the URL
(`/jobs/view/<id>` or `?currentJobId=<id>`), which is stable.

| Function | Description |
|---|---|
| `dlog(...args)` | Console-log with `[LJF debug]` prefix, gated by the `DEBUG` constant (off by default) |
| `nearestCompanyLink(fromEl, maxHops)` | Walk up from a title anchor to the nearest ancestor containing a company-profile link with visible text; skips text-less matches caused by LinkedIn's invalid nested-`<a>` markup (browsers auto-close the outer one) |
| `detectCurrentJobListing()` | Find the job ID from the URL, locate the (unique) title anchor via `a[href*="/jobs/view/<id>"]`, pair it with `nearestCompanyLink()` for the company; fills in anything still missing from `document.title` (`"<Title> \| <Company> \| LinkedIn"`). Returns `{ title, company, url }` with `url` normalized to `https://www.linkedin.com/jobs/view/<id>/` (tracking query params stripped), or `null` if nothing is detected. Backs the Jobs tab's autofill button (see `renderJobsPane` under UI) |

There used to be an automatic apply-capture hook here (`setupApplyCapture`'s Easy-Apply/"Yes, applied"
click listener, `captureAppliedJob()`, `setupViewPageApplyCapture()`'s MutationObserver on the
post-apply panel). It was removed — LinkedIn kept renaming the selectors it depended on (see
`project_apply_capture_fragility` in memory) — in favor of the manual autofill button, which uses
the same `detectCurrentJobListing()`.
