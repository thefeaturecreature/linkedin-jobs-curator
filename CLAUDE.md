# LinkedIn Jobs Curator

Single-file Violentmonkey userscript. All logic, UI, and storage live in `linkedin-job-filter.js`.

## Script metadata

- **Name**: `LinkedIn Jobs Curator`
- **Match**: `https://www.linkedin.com/jobs/*`, `https://www.linkedin.com/my-items/*`
- **Storage**: `GM_setValue` / `GM_getValue` — keys prefixed `ljf_`

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

## Settings storage keys

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

## Functions reference

See `FUNCTIONS.md` for a full index of notable functions.
