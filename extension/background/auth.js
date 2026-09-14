// LinkedIn Jobs Curator — background: Google OAuth token management (MV2, launchWebAuthFlow)
//
// The OAuth client ID comes from window.LJF_CONFIG, set by config.local.js (loaded right before
// this file — see manifest.json). That file is gitignored; config.local.example.js is the
// committed template. Not that the client ID is secret (only a client *secret* would be, and the
// implicit grant used here never has one) — it's kept out of the repo anyway so this published
// copy of the code isn't tied to one person's OAuth client. See extension/SETUP.md.
//
// Everything else lives under these local-only keys, deliberately prefixed `ljfs_` (not `ljf_`)
// so content/store.js's ljf_*-only hydrate never touches them and they're never mistaken for one
// of the three synced data stores.
//   ljfs_spreadsheetId  — target spreadsheet ID, pasted (as a URL or bare ID) in the panel's
//                         Settings → Backup tab
//   ljfs_connected      — 'true' once the user has connected; independent of token expiry
//   ljfs_token          — current access token (implicit-flow, short-lived, ~1hr)
//   ljfs_tokenExpiry    — ms-epoch when ljfs_token expires
//
// Background scripts share one global scope (like content scripts do), loaded in manifest order —
// this file defines window.LJFAuth for sheets.js/sync.js/background.js to use.

(function () {
  'use strict';

  const CLIENT_ID = (window.LJF_CONFIG && window.LJF_CONFIG.clientId) || '';

  const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

  async function getConfig() {
    const stored = await browser.storage.local.get(['ljfs_spreadsheetId', 'ljfs_connected']);
    return {
      hasClientId: Boolean(CLIENT_ID),
      spreadsheetId: stored.ljfs_spreadsheetId || '',
      connected: stored.ljfs_connected === 'true',
    };
  }

  function buildAuthUrl({ silent }) {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'token',
      redirect_uri: browser.identity.getRedirectURL(),
      scope: SCOPE,
    });
    if (silent) params.set('prompt', 'none'); // fail fast instead of showing anything
    return 'https://accounts.google.com/o/oauth2/auth?' + params.toString();
  }

  // Parses the implicit-flow redirect URL's #fragment into { access_token, expires_in, ... }
  // (or { error, ... } on failure/denial).
  function parseRedirect(redirectUrl) {
    const hash = new URL(redirectUrl).hash.replace(/^#/, '');
    return Object.fromEntries(new URLSearchParams(hash));
  }

  async function storeToken(params) {
    const expiresInMs = (parseInt(params.expires_in, 10) || 3600) * 1000;
    await browser.storage.local.set({
      ljfs_token: params.access_token,
      ljfs_tokenExpiry: Date.now() + expiresInMs - 60000, // refresh a minute early
    });
  }

  // Runs one OAuth round-trip. `interactive` controls whether Firefox shows a visible window (a
  // new tab, per the launchWebAuthFlow contract — expected, not a bug); `silent` additionally
  // tells Google (via prompt=none) not to show anything on its end either. The two are almost
  // always used together (interactive:false + silent:true, or the reverse).
  async function requestToken({ interactive, silent }) {
    const url = buildAuthUrl({ silent });
    const redirectUrl = await browser.identity.launchWebAuthFlow({ url, interactive });
    const params = parseRedirect(redirectUrl);
    if (params.error) throw new Error('OAuth error: ' + params.error);
    if (!params.access_token) throw new Error('OAuth response had no access_token');
    await storeToken(params);
    return params.access_token;
  }

  // Returns a usable access token, refreshing/re-authing as needed. Only pops a visible window
  // when explicitly told to (the "Authorize" button) — background-triggered syncs never prompt on
  // their own; they either get a token silently or give up and report "not connected".
  async function getToken({ interactive = false } = {}) {
    if (!CLIENT_ID) throw new Error('No Google client ID configured (extension/background/config.local.js)');

    const stored = await browser.storage.local.get(['ljfs_token', 'ljfs_tokenExpiry']);
    if (stored.ljfs_token && stored.ljfs_tokenExpiry && Date.now() < stored.ljfs_tokenExpiry) {
      return stored.ljfs_token;
    }
    try {
      return await requestToken({ interactive: false, silent: true });
    } catch (e) {
      if (!interactive) throw e;
      return await requestToken({ interactive: true, silent: false });
    }
  }

  // Saves the spreadsheet ID, then runs an interactive auth round-trip so "Authorize" fails
  // loudly (missing client ID, user cancels, etc.) instead of silently leaving `connected` stale.
  async function connect(spreadsheetId) {
    await browser.storage.local.set({ ljfs_spreadsheetId: spreadsheetId });
    await getToken({ interactive: true });
    await browser.storage.local.set({ ljfs_connected: 'true' });
  }

  async function disconnect() {
    await browser.storage.local.set({ ljfs_connected: 'false' });
    await browser.storage.local.remove(['ljfs_token', 'ljfs_tokenExpiry']);
    // spreadsheetId deliberately left in place, so reconnecting doesn't need retyping.
  }

  window.LJFAuth = { getConfig, getToken, connect, disconnect };
})();
