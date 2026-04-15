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

## Settings

Open the gear icon in the panel header to access:

- **Dark / light mode**
- **Reapply after (days)** — threshold for the application log checkmark
- **Quick hover menu** — a small action menu that appears when hovering a card
- **Dismiss actions** — enables auto-clicking LinkedIn's dismiss button (see note below)

## Dismiss actions note

The dismiss feature automates clicks on LinkedIn's native dismiss button. This constitutes automated interaction with their platform and likely violates the LinkedIn User Agreement. It is disabled by default and requires explicit opt-in. Use at your own discretion.

## Export / import

Rules and settings can be exported and re-imported as JSON from the Backup tab in the panel. The application log can be exported as JSON or CSV.

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).
