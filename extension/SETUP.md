# Google Sheets sync — one-time setup

This is a personal OAuth client, not a published app — a few minutes in Google Cloud Console, done
once. Nobody but you needs to do this for your own install.

## 1. Get the extension's redirect URI

1. Load the extension (`about:debugging` → *This Firefox* → *Load Temporary Add-on* → pick
   `extension/manifest.json`, or your normal install method).
2. On the same `about:debugging` page, find "LinkedIn Jobs Curator" and click **Inspect** — this
   opens DevTools for the background page.
3. In its Console tab, run:
   ```js
   browser.identity.getRedirectURL()
   ```
4. Copy the result — it looks like `https://<some-uuid>.extensions.allizom.org/`. You'll paste this
   into Google Cloud Console in step 3 below. It stays stable across reloads for the same install
   (tied to the extension's id in `manifest.json`), but changes if you switch to loading it from a
   different Firefox profile.

## 2. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create a new project (or
   reuse an existing personal one).
2. **APIs & Services → Library** → search for **Google Sheets API** → **Enable**.

## 3. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External**. (Internal requires a Google Workspace org.)
3. Fill in the required fields (app name, your email) — anything reasonable, this is never seen by
   anyone but you.
4. Scopes: you can skip adding scopes here — the extension requests
   `https://www.googleapis.com/auth/spreadsheets` at auth time.
5. Test users: add your own Google account email. **Publishing status stays "Testing"** — no Google
   review needed, and only accounts you list as test users can authorize this client. Google will
   show an "unverified app" warning during connect; that's expected for a personal client — click
   through it ("Advanced" → "Go to \<app name> (unsafe)").

## 4. Create the OAuth client ID

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorized redirect URIs**, add the exact value you copied in step 1.
4. Create it, then copy the **Client ID** (you don't need the client secret — the extension uses the
   implicit grant, which doesn't use one).

## 5. Put the client ID in the extension

The client ID isn't secret (only a client *secret* would be, and this flow never uses one), but
it's kept out of a config file rather than the UI or a tracked source file, so it's easy to keep
out of git too:

1. Copy `extension/background/config.local.example.js` to
   `extension/background/config.local.js` (already gitignored — `git status` should show nothing
   new after this).
2. Open `config.local.js` and set `clientId` to the **Client ID** you copied in step 4 — it looks
   like `1234567890-abc...apps.googleusercontent.com`. **Not** the redirect URI from step 1 — that
   one only ever goes into Google Cloud Console, never into this file.
3. Reload the extension (`about:debugging` → **Reload**).

## 6. Connect

1. On any `linkedin.com/jobs` page, open the panel → gear icon → **Settings → Backup**.
2. Under **Google Sheets Sync**, paste the URL of a blank Google Sheet (or reuse one) into the
   spreadsheet field.
3. Click **Authorize** and approve the consent screen — it opens in a new tab. The extension
   creates the `rules`, `applied_log`, and `dismiss_log` tabs in that spreadsheet if they aren't
   already there.

## Notes

- The access token is short-lived (~1 hour) and refreshes silently in the background; you generally
  shouldn't need to reconnect.
- **Disconnect** clears the stored token but leaves the spreadsheet field filled in, so reconnecting
  later doesn't need re-pasting it.
- Nothing about your Google account beyond that one spreadsheet is ever touched — the OAuth scope
  is `.../auth/spreadsheets` only (no Drive access, no ability to create or list other files).
