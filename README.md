# LinkedIn Jobs Curator

A Violentmonkey/Greasemonkey userscript for LinkedIn job search. Rule-based filtering, highlights, dismissals, and an application log that automatically flags companies you've already applied to.

## Installation

1. Install [Violentmonkey](https://violentmonkey.github.io/) (recommended), [Tampermonkey](https://www.tampermonkey.net/), or [Greasemonkey](https://addons.mozilla.org/en-US/firefox/addon/greasemonkey/).
2. Install the script from [Greasy Fork](https://greasyfork.org/en/scripts/573971-linkedin-jobs-curator) — or click **Raw** on `linkedin-job-filter.js` above and your userscript manager will prompt you to install it.
3. Navigate to `linkedin.com/jobs` — the panel appears on the right side of the page.

## What it does

A floating side panel lets you define rules that run automatically against every job card on the page:

- **Dismiss** — cards matching dismiss rules are highlighted red and (optionally) auto-clicked away using LinkedIn's native dismiss button
- **Highlight** — cards matching highlight rules are outlined in green so good matches stand out
- **Application log** — cards from companies you've previously applied to are badged with the date and how many days ago, with a checkmark once you're past your reapply window

Rules persist across sessions via your userscript manager's storage.

## Rule types

| Type | What it matches |
|---|---|
| `company` | Company name (substring match) |
| `title` | Job title text (substring match) |
| `salary` | Dismisses cards whose listed max salary is below a threshold |
| `industry` | Searches the full card text for a keyword |
| `job id` | Exact LinkedIn job posting ID |
| `applied` | Cards LinkedIn has already marked as applied |

## Application log

Import a CSV or JSON export of your applied jobs. The script cross-references every card against the log and badges matches with the company name, application date, and days elapsed. Once you're past your configured reapply window (default: 14 days, adjustable in Settings), the badge shows a green checkmark.

## Dismiss log

Every time you dismiss a job card (via the hover menu or a dismiss rule), the company and title are saved to a dismiss log. On future visits, matching cards are automatically re-flagged with a grey badge so previously-dismissed jobs stay visible as such.

The **Jobs** pane has a toggle in the footer to switch between the applied log view and the dismiss log view. In the dismissed view you can inspect all logged entries, add entries manually, edit them inline by clicking a row, or delete them with the ✕ button.

Dismiss log entries expire after a configurable number of days (default: 180). Options in the Settings modal let you match on location in addition to company+title, and optionally show re-flagged cards in red rather than grey.

## Custom colors

The **Colors** tab in the panel lets you override the default highlight colors for each card state:

| State | Default | What it tints |
|---|---|---|
| Dismiss | red | Cards matched by a dismiss rule |
| Highlight | green | Cards matched by a highlight rule |
| Recently applied | yellow | Cards from companies in your applied log |
| Dismissed | orange | Cards you've manually dismissed this session |
| Dismiss log | grey | Cards re-flagged from the dismiss log |

Each color has a live dark/light preview swatch. A **Reset** button restores all defaults. Colors are persisted across sessions and included in the backup export.

## Settings

Open the gear icon in the panel header to access:

- **Dark / light mode**
- **Reapply after (days)** — threshold for the application log checkmark
- **Quick hover menu** — a small action menu that appears when hovering a card
- **Dismiss actions** — enables auto-clicking LinkedIn's dismiss button (see note below)
- **Dismiss log expiry** — days before dismiss log entries are pruned
- **Match location** — include location when re-flagging dismissed jobs
- **Show dismissed cards in red** — use red instead of grey for dismiss log re-flags

## Dismiss actions note

The dismiss feature automates clicks on LinkedIn's native dismiss button. This constitutes automated interaction with their platform and likely violates the LinkedIn User Agreement. It is disabled by default and requires explicit opt-in. Use at your own discretion.

## Export / import

Rules and settings can be exported and re-imported as JSON from the Backup tab in the panel. The application log can be exported as JSON or CSV.

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).
