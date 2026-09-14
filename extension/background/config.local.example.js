// Copy this file to config.local.js (gitignored — your value never gets committed) and fill in
// your own OAuth client ID from Google Cloud Console. See extension/SETUP.md.
//
// The client ID isn't secret (only a client *secret* would be, and the implicit grant this
// extension uses never has one) — it's kept out of the repo anyway just to avoid tying this
// specific published copy of the code to one person's OAuth client.
window.LJF_CONFIG = {
  clientId: '',
};
