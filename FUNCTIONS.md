# Functions Reference

Notable functions in `linkedin-job-filter.js`.

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
| `logDismissal(card)` | Add/update dismiss log entry for a card |
| `actDismissLog(card, entry)` | Apply grey (or red) tint + badge to a previously-dismissed card |
| `applyDismissLog()` | Run `matchDismissLog`/`actDismissLog` on all cards |

## Card Helpers
| Function | Description |
|---|---|
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
| `applyAllRules()` | Full pass: rules → job log → dismiss log → visibility → tab count |
| `applyJobLog()` | Apply applied log matching to all cards |
| `applyDismissLog()` | Apply dismiss log matching to all cards |
| `applyRecentlyAppliedVisibility()` | Hide/show yellow+dismissed+grey-dismisslog cards per toggle |
| `applyViewHeroRules()` | Apply rules to the job detail page hero banner |
| `applySavedJobRules()` | Apply rules to saved jobs page cards |
| `dismissRule(rule)` | Click X on all cards matching a rule |
| `dismissJobLog()` | Click X on all cards matching an applied log entry |
| `clearHighlights()` | Remove all script-applied styles and dataset markers from all cards |
| `reconcileDismissedCards()` | Clear `ljfDismissed` from cards that LinkedIn has since restored |

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
| `renderJobsPane()` | Re-render the jobs log pane |
| `openSettingsModal()` | Open settings/backup modal dialog |
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

## Apply Capture
| Function | Description |
|---|---|
| `setupApplyCapture()` | Listen for "Yes, applied" clicks, undo clicks, and native dismiss clicks |
| `captureAppliedJob()` | Log a job as applied from the current detail pane |
| `captureViewPageAppliedJob()` | Log an applied job from a job view page URL |
| `setupViewPageApplyCapture()` | Set up MutationObserver for view-page apply confirmation |
