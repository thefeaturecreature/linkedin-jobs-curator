// ==UserScript==
// @name         LinkedIn Jobs Curator
// @namespace    https://github.com/thefeaturecreature/linkedin-jobs-curator
// @version      1.6.5
// @author       Evan Dierlam
// @description  Rule-based job card filter for LinkedIn. Flag jobs by company, title, salary floor, or industry — highlight the good ones green, dismiss the noise, and track applications in a built-in log that automatically flags companies you've already applied to.
// @license      GPL-3.0
// @homepageURL  https://github.com/thefeaturecreature/linkedin-jobs-curator
// @supportURL   https://github.com/thefeaturecreature/linkedin-jobs-curator/issues
// @downloadURL  https://update.greasyfork.org/scripts/573971/LinkedIn%20Jobs%20Curator.user.js
// @updateURL    https://update.greasyfork.org/scripts/573971/LinkedIn%20Jobs%20Curator.meta.js
// @icon         https://raw.githubusercontent.com/thefeaturecreature/linkedin-jobs-curator/main/icon.png
// @match        https://www.linkedin.com/jobs/*
// @match        https://www.linkedin.com/my-items/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────────

  const STORAGE_KEY      = 'ljf_rules';
  const LOG_KEY          = 'ljf_applied_log';
  const DISMISS_LOG_KEY  = 'ljf_dismiss_log';
  const SOURCE_URL       = 'https://github.com/thefeaturecreature/linkedin-jobs-curator';

  const CARD_SEL    = 'li.jobs-search-results__list-item, li.scaffold-layout__list-item, li.discovery-templates-entity-item, a[componentkey]:has(div[data-display-contents] > p[style]), div[role="button"][componentkey]:has(div[data-display-contents] > p[style])';
  const TITLE_SEL   = '.job-card-list__title--link, .job-card-container__link, div[data-display-contents] > p[style] > span[aria-hidden="true"]';
  const COMPANY_SEL = '.artdeco-entity-lockup__subtitle span, div[data-display-contents] + div > p:first-child';
  const SALARY_SEL  = '.job-card-container__metadata-item, .job-card-container__metadata-wrapper li span, div[data-display-contents] + div > p';
  const APPLIED_SEL = '.job-card-container__footer-job-state';
  const DISMISS_SEL = 'button.job-card-container__action, button[aria-label^="Dismiss"]';
  const UNDO_SEL    = 'button.artdeco-button--circle';   // undo/restore button shown after dismiss

  // Saved-jobs page (/my-items/saved-jobs/)
  const SAVED_CARD_SEL    = '[data-chameleon-result-urn^="urn:li:fsd_jobPosting:"]';
  const SAVED_TITLE_SEL   = '.t-16 a';
  const SAVED_COMPANY_SEL = '.t-14.t-black.t-normal';

  // Rule type definitions
  // applied / salarybelow / topsalarybelow are rendered as permanent sticky blocks, not listed in dropdown
  const RULE_TYPES = {
    applied:          { label: 'Already Applied',          match: matchApplied          },
    topsalarybelow:   { label: 'Top Salary Below ($k)',     match: matchTopSalary        },
    salarybelow:      { label: 'Salary Below ($k)',          match: matchSalary           },
    companydismiss:   { label: 'Company to Dismiss',        match: matchCompany           },
    titledismiss:     { label: 'Title to Dismiss',          match: matchTitle             },
    locationdismiss:  { label: 'Location to Dismiss',       match: matchLocation          },
    companyhi:        { label: 'Company to Highlight',      match: matchCompanyHi,    highlight: true },
    titlehi:          { label: 'Title to Highlight',        match: matchTitleHi,      highlight: true },
    locationhi:       { label: 'Location to Highlight',     match: matchLocationHi,   highlight: true },
    topsalaryabove:   { label: 'Top Salary Above ($k)',     match: matchTopSalaryAbove,  highlight: true },
    salaryabove:      { label: 'Salary Above ($k)',          match: matchSalaryAbove,     highlight: true },
  };

  // Types shown in the add-rule dropdown (salary types conditionally disabled)
  const DROPDOWN_TYPES = ['companydismiss', 'titledismiss', 'locationdismiss', 'topsalarybelow', 'salarybelow', 'companyhi', 'titlehi', 'locationhi', 'topsalaryabove', 'salaryabove'];

  // ─── Semantic card-overlay colors ─────────────────────────────────────────────
  // Applied as transparent RGBA over LinkedIn's own card backgrounds.
  // Single set — LinkedIn handles its own dark/light theming for the base card.
  const COLOR_DEFAULTS = {
    dismiss:    '#c82828',
    highlight:  '#28b428',
    recent:     '#c8aa00',
    dismissed:  '#c87800',
    dismissLog: '#64646e',
  };

  const ROLE_ALPHAS = {
    dismiss:    { bg: 0.10, border: 0.55, badge: 0.80 },
    highlight:  { bg: 0.11, border: 0.55, badge: 0.82 },
    recent:     { bg: 0.13, border: 0.60, badge: 0.88 },
    dismissed:  { bg: 0.12, border: 0.55, badge: 0.85 },
    dismissLog: { bg: 0.10, border: 0.45, badge: 0.82 },
  };

  let CC = buildCC(COLOR_DEFAULTS);

  const THEMES = {
    dark: {
      panelBg:'#1c1c1c', panelText:'#e0e0e0',
      headerBg:'#111', formBg:'#151515', statusBg:'#111',
      border1:'#2e2e2e', border2:'#282828', border3:'#222',
      labelText:'#fff', sectionTitle:'#fff', countText:'#888', arrowText:'#888',
      ruleLabel:'#fff', ruleType:'#888', emptyText:'#555',
      rowBg:'#222', rowBorder:'#2a2a2a',
      // panel row tints — mirror card overlay categories
      dimRowBg:'rgba(200,40,40,0.10)',    dimRowBorder:'rgba(200,40,40,0.38)',
      hiRowBg:'rgba(40,180,40,0.10)',     hiRowBorder:'rgba(40,180,40,0.38)',
      logRowBg:'rgba(200,170,0,0.10)',    logRowBorder:'rgba(200,170,0,0.35)',
      salaryOffBg:'#181818', salaryOffBorder:'#282828', salaryOffTitle:'#555', salaryOffVal:'#3a3a3a',
      salaryOnTitle:'#88bb88', salaryOnVal:'#5a8a5a',
      inputBg:'#fff', inputText:'#000', inputBorder:'#ccc',
      tabBg:'#111', tabAccent:'#888',
      dismissBg:'#1e3d7a', dismissBtnText:'#93c5fd', dismissBtnBorder:'#2d5299',
      addBg:'#1e3d7a', addBtnText:'#93c5fd',
      greenBg:'#1a304e', greenText:'#7ab0ff', greenBorder:'#284070',
      redBg:'#2a1010', redText:'#c66', redBorder:'#3a1a1a',
      gearText:'#555', gearMenuBg:'#1a1a1a', gearMenuBorder:'#333',
      gearMenuText:'#ccc', gearMenuDivider:'#2a2a2a',
      statusText:'#666',
    },
    light: {
      panelBg:'#f5f7fa', panelText:'#111',
      headerBg:'#e8ecf0', formBg:'#edf0f5', statusBg:'#e8ecf0',
      border1:'#c8d0dc', border2:'#d0d8e4', border3:'#dce4f0',
      labelText:'#111', sectionTitle:'#111', countText:'#666', arrowText:'#666',
      ruleLabel:'#111', ruleType:'#666', emptyText:'#888',
      rowBg:'#fff', rowBorder:'#d0d8e4',
      // panel row tints — mirror card overlay categories
      dimRowBg:'rgba(200,40,40,0.07)',    dimRowBorder:'rgba(200,40,40,0.32)',
      hiRowBg:'rgba(40,180,40,0.07)',     hiRowBorder:'rgba(40,180,40,0.32)',
      logRowBg:'rgba(200,170,0,0.09)',    logRowBorder:'rgba(200,170,0,0.38)',
      salaryOffBg:'#f5f5f5', salaryOffBorder:'#d0d0d0', salaryOffTitle:'#999', salaryOffVal:'#bbb',
      salaryOnTitle:'#226622', salaryOnVal:'#448844',
      inputBg:'#fff', inputText:'#000', inputBorder:'#bbb',
      tabBg:'#fff', tabAccent:'#bbb',
      dismissBg:'#dbeafe', dismissBtnText:'#1d4ed8', dismissBtnBorder:'#93c5fd',
      addBg:'#dbeafe', addBtnText:'#1d4ed8',
      greenBg:'#eff6ff', greenText:'#1d4ed8', greenBorder:'#bfdbfe',
      redBg:'#ecc0c0', redText:'#3a1010', redBorder:'#d09090',
      gearText:'#777', gearMenuBg:'#fff', gearMenuBorder:'#ccc',
      gearMenuText:'#333', gearMenuDivider:'#eee',
      statusText:'#888',
    },
  };

  // ─── State ────────────────────────────────────────────────────────────────────

  let rules              = loadRules();
  let appliedLog         = loadAppliedLog();
  let logIndex           = buildLogIndex();
  let jobLogEnabled         = GM_getValue('ljf_jobLogEnabled', 'true') !== 'false';
  let dismissActionsEnabled = GM_getValue('ljf_dismissActions', 'false') === 'true';
  let panelOpen          = false;
  let activePanel        = GM_getValue('ljf_activePanel', 'rules');
  let jobSort            = { col: 'date', dir: 'desc' };
  let companyFilter      = '';
  let companyFilterOpen  = false;
  let editingLogIdx        = null;
  let editingDismissLogIdx = null;
  let activeLogView        = 'jobs';   // 'jobs' | 'dismissed'
  let editingRuleId      = null;
  let editingOrigType    = null;
  let collapsedSections  = {
    dismissSection:   false,
    companydismiss:   false,
    titledismiss:     false,
    locationdismiss:  false,
    highlightSection: false,
    companyhi:        false,
    titlehi:          false,
    locationhi:       false,
  };
  let darkMode           = GM_getValue('ljf_darkMode', 'dark') !== 'light';
  let hoverMenuEnabled   = GM_getValue('ljf_hoverMenu', 'true') !== 'false';
  let reapplyDays           = Math.max(1, parseInt(GM_getValue('ljf_reapplyDays', '14'), 10) || 14);
  let quickDismissMode      = GM_getValue('ljf_quickDismissMode', 'company');
  let hideRecentlyApplied   = GM_getValue('ljf_hideRecentlyApplied', 'false') !== 'false';
  let dismissLog            = loadDismissLog();
  let dismissLogIndex       = buildDismissLogIndex();
  let dismissLogExpiry      = Math.max(1, parseInt(GM_getValue('ljf_dismissLogExpiry', '180'), 10) || 180);
  let dismissLogMatchLocation = GM_getValue('ljf_dismissLogMatchLocation', 'false') === 'true';
  let dismissLogCardsRed    = GM_getValue('ljf_dismissLogCardsRed', 'false') === 'true';
  let userColors = (() => {
    try { return { ...COLOR_DEFAULTS, ...JSON.parse(GM_getValue('ljf_colors', '{}')) }; }
    catch (e) { return { ...COLOR_DEFAULTS }; }
  })();
  CC = buildCC(userColors);

  function t() { return darkMode ? THEMES.dark : THEMES.light; }

  const PANEL_WIDTHS = { rules: 340, jobs: 630 };
  function panelWidthPx() { return (PANEL_WIDTHS[activePanel] || 340) + 'px'; }

  // ─── Panel styles ─────────────────────────────────────────────────────────────

  function buildPanelStyles() {
    let el = document.getElementById('ljf-styles');
    if (!el) { el = document.createElement('style'); el.id = 'ljf-styles'; }
    if (!el.isConnected) { (document.head || document.documentElement).appendChild(el); }
    el.textContent = `
/* LinkedIn Job Filter — all selectors scoped to #ljf-panel */
#ljf-panel .ljf-header {
  display:flex;align-items:center;justify-content:space-between;
  padding:12px 14px;flex-shrink:0;cursor:pointer;
  background:var(--ljf-header-bg);border-bottom:1px solid var(--ljf-border1); }
#ljf-panel .ljf-header strong { font-size:14px;letter-spacing:.3px; }
#ljf-panel .ljf-header-btns { display:flex;align-items:center;gap:2px; }
#ljf-panel .ljf-gear {
  background:none;border:none;cursor:pointer;
  font-size:15px;padding:2px 4px;line-height:1;border-radius:3px;
  color:var(--ljf-gear-text); }
#ljf-panel .ljf-help {
  background:none;border:none;cursor:pointer;
  font-size:12px;font-weight:700;padding:2px 5px;line-height:1;border-radius:3px;
  color:var(--ljf-gear-text); }
#ljf-panel .ljf-tab-bar {
  display:flex;flex-shrink:0;
  background:var(--ljf-header-bg);border-bottom:1px solid var(--ljf-border1); }
#ljf-panel .ljf-tab-btn {
  flex:1;padding:8px 4px;border:none;border-bottom:2px solid transparent;
  background:transparent;color:var(--ljf-count-text);
  cursor:pointer;font-size:12px;font-weight:600;letter-spacing:.2px;
  transition:color .15s,border-color .15s; }
#ljf-panel .ljf-tab-btn.ljf-active {
  border-bottom-color:var(--ljf-tab-accent);
  background:var(--ljf-panel-bg);color:var(--ljf-label-text); }
#ljf-panel .ljf-pane { display:none;flex-direction:column;flex:1;min-height:0; }
#ljf-panel .ljf-pane.ljf-active { display:flex; }
#ljf-panel .ljf-status-bar {
  padding:5px 14px;font-size:11px;flex-shrink:0;
  background:var(--ljf-status-bg);color:var(--ljf-status-text);
  border-top:1px solid var(--ljf-border3); }
#ljf-panel .ljf-action-bar {
  padding:10px 14px;border-bottom:1px solid var(--ljf-border2);flex-shrink:0; }
#ljf-panel .ljf-action-btn {
  width:100%;border-radius:4px;padding:8px;cursor:pointer;font-size:12px;font-weight:600;border:1px solid;
  background:var(--ljf-dismiss-bg);color:var(--ljf-dismiss-btn-text);border-color:var(--ljf-dismiss-btn-border); }
#ljf-panel .ljf-rules-list { flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 14px; }
#ljf-panel .ljf-add-form {
  padding:12px 14px;flex-shrink:0;
  background:var(--ljf-form-bg);border-top:1px solid var(--ljf-border2); }
#ljf-panel .ljf-form-label {
  font-size:10px;margin-bottom:7px;text-transform:uppercase;letter-spacing:.6px;
  color:var(--ljf-label-text); }
#ljf-panel .ljf-form-control {
  width:100%;box-sizing:border-box;border-radius:4px;
  padding:5px 8px;margin-bottom:6px;font-size:12px;border:1px solid;
  background:var(--ljf-input-bg);color:var(--ljf-input-text);border-color:var(--ljf-input-border); }
#ljf-panel .ljf-form-control.ljf-mb8 { margin-bottom:8px; }
#ljf-panel .ljf-add-btn {
  width:100%;border-radius:4px;padding:8px;cursor:pointer;font-size:12px;font-weight:600;border:1px solid;
  background:var(--ljf-add-bg);color:var(--ljf-add-btn-text);border-color:var(--ljf-dismiss-btn-border); }
#ljf-panel .ljf-quick-bar {
  padding:10px 14px;border-bottom:1px solid var(--ljf-border2);flex-shrink:0; }
#ljf-panel .ljf-quick-row { display:flex;gap:6px;align-items:center; }
#ljf-panel .ljf-quick-input {
  flex:1;box-sizing:border-box;border-radius:4px;padding:5px 8px;font-size:12px;border:1px solid;
  background:var(--ljf-input-bg);color:var(--ljf-input-text);border-color:var(--ljf-input-border); }
#ljf-panel .ljf-quick-btn {
  padding:5px 12px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;border-radius:4px;border:1px solid;
  background:var(--ljf-dismiss-bg);color:var(--ljf-dismiss-btn-text);border-color:var(--ljf-dismiss-btn-border); }
#ljf-panel .ljf-block { padding:8px 10px;margin-bottom:4px;border-radius:5px;border:1px solid; }
#ljf-panel .ljf-block.ljf-dim  { background:var(--ljf-dim-row-bg); border-color:var(--ljf-dim-row-border); }
#ljf-panel .ljf-block.ljf-hi   { background:var(--ljf-hi-row-bg);  border-color:var(--ljf-hi-row-border);  }
#ljf-panel .ljf-block.ljf-log  { background:var(--ljf-log-row-bg); border-color:var(--ljf-log-row-border); }
#ljf-panel .ljf-block.ljf-salary-off {
  background:var(--ljf-salary-off-bg);border-color:var(--ljf-salary-off-border);cursor:pointer; }
#ljf-panel .ljf-block-row { display:flex;align-items:center;justify-content:space-between;gap:6px; }
#ljf-panel .ljf-block-left { flex:1;min-width:0; }
#ljf-panel .ljf-block-title { font-size:12px;font-weight:600;color:var(--ljf-rule-label); }
#ljf-panel .ljf-block-title.ljf-mb5 { margin-bottom:5px; }
#ljf-panel .ljf-block-title.ljf-salary-on  { color:var(--ljf-salary-on-title);  }
#ljf-panel .ljf-block-title.ljf-salary-off { color:var(--ljf-salary-off-title); }
#ljf-panel .ljf-block-val { font-size:11px;margin-top:2px; }
#ljf-panel .ljf-block-val.ljf-salary-on  { color:var(--ljf-salary-on-val);  }
#ljf-panel .ljf-block-val.ljf-salary-off { color:var(--ljf-salary-off-val); }
#ljf-panel .ljf-rule-row {
  display:flex;align-items:center;gap:7px;
  padding:7px 8px;margin-bottom:3px;border-radius:4px;border:1px solid; }
#ljf-panel .ljf-rule-row.ljf-dim { background:var(--ljf-dim-row-bg);border-color:var(--ljf-dim-row-border); }
#ljf-panel .ljf-rule-row.ljf-hi  { background:var(--ljf-hi-row-bg); border-color:var(--ljf-hi-row-border);  }
#ljf-panel .ljf-row-label { flex:1;min-width:0;cursor:pointer; }
#ljf-panel .ljf-row-value {
  font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ljf-rule-label); }
#ljf-panel .ljf-row-type { font-size:10px;margin-top:1px;color:var(--ljf-rule-type); }
#ljf-panel .ljf-section-hdr {
  display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;
  text-transform:uppercase;letter-spacing:.7px;padding:6px 0 5px;
  cursor:pointer;user-select:none;color:var(--ljf-panel-text); }
#ljf-panel .ljf-group-hdr {
  display:flex;align-items:center;gap:5px;font-size:10px;
  text-transform:uppercase;letter-spacing:.6px;padding:10px 0 4px;
  cursor:pointer;user-select:none;color:var(--ljf-section-title); }
#ljf-panel .ljf-hdr-count { color:var(--ljf-count-text); }
#ljf-panel .ljf-hdr-arrow {
  font-size:22px;margin-left:4px;line-height:0;position:relative;top:-2px;color:var(--ljf-arrow-text); }
#ljf-panel .ljf-divider { border-top:1px solid var(--ljf-border1);margin:10px 0 2px; }
#ljf-panel .ljf-btn-dismiss {
  flex-shrink:0;border-radius:3px;padding:3px 8px;cursor:pointer;font-size:10px;white-space:nowrap;border:1px solid;
  background:var(--ljf-green-bg);color:var(--ljf-green-text);border-color:var(--ljf-green-border); }
#ljf-panel .ljf-btn-toggle {
  flex-shrink:0;border-radius:3px;width:28px;height:22px;
  padding:0;cursor:pointer;font-size:13px;font-weight:900;line-height:1;text-align:center;border:1px solid; }
#ljf-panel .ljf-btn-toggle.ljf-on  {
  background:var(--ljf-green-bg);color:var(--ljf-green-text);border-color:var(--ljf-green-border); }
#ljf-panel .ljf-btn-toggle.ljf-off {
  background:var(--ljf-red-bg);color:var(--ljf-red-text);border-color:var(--ljf-red-border); }
#ljf-panel .ljf-btn-del {
  flex-shrink:0;border-radius:3px;width:28px;height:22px;
  padding:0;cursor:pointer;font-size:13px;font-weight:900;line-height:1;text-align:center;border:1px solid;
  background:var(--ljf-red-bg);color:var(--ljf-red-text);border-color:var(--ljf-red-border); }
#ljf-panel .ljf-jobs-scroll { overflow-y:auto;flex:1;min-height:0;scrollbar-gutter:stable; }
#ljf-panel .ljf-jobs-table {
  width:615px;margin-right:15px;border-collapse:collapse;table-layout:fixed;
  font-size:11px;color:var(--ljf-panel-text);background:var(--ljf-row-bg); }
#ljf-panel .ljf-jobs-table thead {
  font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap; }
#ljf-panel .ljf-jobs-table th {
  padding:4px 6px;text-align:left;
  background:var(--ljf-header-bg);color:var(--ljf-count-text);
  border-bottom:2px solid var(--ljf-border1);
  position:sticky;top:0;z-index:10;overflow:hidden;text-overflow:ellipsis; }
#ljf-panel .ljf-jobs-table th.ljf-sort-active {
  color:var(--ljf-label-text);border-bottom-color:var(--ljf-tab-accent); }
#ljf-panel .ljf-jobs-table th.ljf-sortable { cursor:pointer;user-select:none; }
#ljf-panel .ljf-jobs-table th.ljf-center,
#ljf-panel .ljf-jobs-table td.ljf-center { text-align:center; }
#ljf-panel .ljf-jobs-table tbody tr { border-bottom:1px solid var(--ljf-row-border); }
#ljf-panel .ljf-jobs-table tbody tr[data-log-idx] { cursor:pointer; }
#ljf-panel .ljf-jobs-table tbody tr.ljf-row-editing { background:var(--ljf-dismiss-bg) !important;outline:1px solid var(--ljf-tab-accent);outline-offset:-1px; }
#ljf-panel .ljf-jobs-table td { padding:1px 5px; }
#ljf-panel .ljf-col-trunc { white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:0; }
#ljf-panel .ljf-col-muted { color:var(--ljf-count-text);white-space:nowrap; }
#ljf-panel .ljf-col-icon { padding-bottom:2px;text-align:center;vertical-align:middle; }
#ljf-panel .ljf-li-link { line-height:0;position:relative;bottom:1px; }
#ljf-panel .ljf-li-icon { display:inline-block;vertical-align:middle; }
#ljf-panel .ljf-status-sel {
  width:100%;font-size:10px;padding:2px 4px;border-radius:3px;
  border:none !important;outline:none !important;box-shadow:none !important;
  -webkit-appearance:none;appearance:none;cursor:pointer;
  position:relative;z-index:0; }
#ljf-panel .ljf-log-del {
  border-radius:3px;width:22px;height:18px;padding:0;
  cursor:pointer;font-weight:900;line-height:1;text-align:center;border:1px solid;
  background:var(--ljf-red-bg);color:var(--ljf-red-text);border-color:var(--ljf-red-border); }
#ljf-panel .ljf-co-filter-btn {
  display:inline-flex;align-items:center;justify-content:center;
  width:13px;height:13px;border-radius:50%;
  border:1px solid var(--ljf-border1);background:transparent;cursor:pointer;
  color:var(--ljf-count-text);padding:0;margin-left:4px;vertical-align:middle;flex-shrink:0; }
#ljf-panel .ljf-co-filter-btn.ljf-co-filter-active { color:var(--ljf-tab-accent);border-color:var(--ljf-tab-accent); }
#ljf-panel #ljf-co-filter-row td {
  background:var(--ljf-header-bg);border-bottom:1px solid var(--ljf-border1);
  padding:3px 6px;position:sticky;top:24px;z-index:10; }
#ljf-panel .ljf-co-filter-wrap { display:flex;align-items:center;gap:4px; }
#ljf-panel #ljf-co-filter-input {
  flex:1;min-width:0;font-size:11px;padding:2px 6px;
  border:1px solid var(--ljf-border2);border-radius:3px;
  background:var(--ljf-form-bg);color:var(--ljf-panel-text);outline:none; }
#ljf-panel .ljf-co-filter-clear {
  flex-shrink:0;width:15px;height:15px;border-radius:50%;
  border:1px solid var(--ljf-border1);background:transparent;cursor:pointer;
  color:var(--ljf-count-text);font-size:9px;font-weight:900;
  display:flex;align-items:center;justify-content:center;padding:0; }
#ljf-panel .ljf-jobs-footer {
  display:flex;justify-content:space-between;align-items:center;
  flex-shrink:0;padding:5px 10px;font-size:10px;
  background:var(--ljf-status-bg);border-top:1px solid var(--ljf-border1);color:var(--ljf-count-text); }
#ljf-panel .ljf-footer-add {
  background:var(--ljf-green-bg);border:1px solid var(--ljf-green-border);cursor:pointer;
  font-size:13px;font-weight:700;line-height:1;
  width:18px;height:18px;padding:0;border-radius:3px;
  color:var(--ljf-green-text);display:inline-flex;align-items:center;justify-content:center; }
#ljf-panel .ljf-footer-add:hover { filter:brightness(1.1); }
#ljf-panel .ljf-add-job-row {
  display:none;flex-shrink:0;align-items:center;gap:2px;
  width:615px;margin-right:15px;padding:4px 0;
  border-top:1px solid var(--ljf-border1);background:var(--ljf-form-bg); }
#ljf-panel .ljf-add-job-row.ljf-open { display:flex; }
#ljf-panel .ljf-add-job-input {
  box-sizing:border-box;font-size:11px;padding:2px 4px;border-radius:3px;min-width:0;
  border:1px solid var(--ljf-input-border);background:var(--ljf-input-bg);color:var(--ljf-input-text); }
#ljf-panel .ljf-add-job-sel {
  box-sizing:border-box;font-size:10px;padding:2px 4px;border-radius:3px;min-width:0;
  border:1px solid var(--ljf-input-border) !important;outline:none !important;
  background:var(--ljf-input-bg);color:var(--ljf-input-text);
  -webkit-appearance:none;appearance:none;cursor:pointer; }
#ljf-panel .ljf-add-job-submit {
  flex-shrink:0;padding:2px 7px;border-radius:3px;cursor:pointer;
  font-size:11px;font-weight:600;white-space:nowrap;border:1px solid;
  background:var(--ljf-add-bg);color:var(--ljf-add-btn-text);border-color:var(--ljf-dismiss-btn-border); }
#ljf-panel .ljf-sort-arrow { opacity:.7;font-weight:400; }
#ljf-panel .ljf-jobs-empty { padding:24px;text-align:center;font-size:12px;color:var(--ljf-empty-text); }
#ljf-panel #ljf-value-input::placeholder,
#ljf-panel #ljf-label-input::placeholder,
#ljf-panel #ljf-quick-company::placeholder { color:#999 !important; }
#ljf-panel .ljf-footer-stats { display:flex;align-items:center;gap:8px; }
#ljf-panel .ljf-stat-pill { padding:1px 6px;border-radius:10px;font-size:9px;background:var(--ljf-header-bg);border:1px solid var(--ljf-border1); }
#ljf-panel #ljf-jcp { position:fixed;z-index:99998;display:none;min-width:180px;max-width:260px;border-radius:5px;padding:8px;background:var(--ljf-panel-bg);color:var(--ljf-panel-text);border:1px solid var(--ljf-border1);box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:auto;font-size:11px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
#ljf-panel #ljf-jcp .ljf-jcp-company { font-weight:700;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
#ljf-panel #ljf-jcp .ljf-jcp-titles { margin:0 0 4px;padding:0 0 0 12px;list-style:disc; }
#ljf-panel #ljf-jcp .ljf-jcp-title { margin:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px; }
#ljf-panel #ljf-jcp .ljf-jcp-meta { color:var(--ljf-count-text);margin-bottom:5px; }
#ljf-panel #ljf-jcp .ljf-jcp-hi-btn { width:100%;padding:3px 6px;border-radius:3px;cursor:pointer;font-size:10px;border:1px solid var(--ljf-green-border);background:var(--ljf-green-bg);color:var(--ljf-green-text); }
#ljf-panel #ljf-jcp .ljf-jcp-hi-btn:disabled { opacity:.5;cursor:default; }
`;
  }

  function setPanelVars() {
    const panel = document.getElementById('ljf-panel');
    if (!panel) return;
    const th = t();
    const vars = {
      '--ljf-panel-bg':           th.panelBg,
      '--ljf-header-bg':          th.headerBg,
      '--ljf-form-bg':            th.formBg,
      '--ljf-status-bg':          th.statusBg,
      '--ljf-row-bg':             darkMode ? '#1c1c1c' : '#fff',
      '--ljf-dim-row-bg':         rowTint(userColors.dismiss,    darkMode ? 0.10 : 0.07),
      '--ljf-hi-row-bg':          rowTint(userColors.highlight,  darkMode ? 0.10 : 0.07),
      '--ljf-log-row-bg':         rowTint(userColors.recent,     darkMode ? 0.10 : 0.09),
      '--ljf-salary-off-bg':      th.salaryOffBg,
      '--ljf-input-bg':           th.inputBg,
      '--ljf-dismiss-bg':         th.dismissBg,
      '--ljf-add-bg':             th.addBg,
      '--ljf-green-bg':           th.greenBg,
      '--ljf-red-bg':             th.redBg,
      '--ljf-panel-text':         th.panelText,
      '--ljf-label-text':         th.labelText,
      '--ljf-rule-label':         th.ruleLabel,
      '--ljf-rule-type':          th.ruleType,
      '--ljf-section-title':      th.sectionTitle,
      '--ljf-count-text':         th.countText,
      '--ljf-empty-text':         th.emptyText,
      '--ljf-input-text':         th.inputText,
      '--ljf-gear-text':          th.gearText,
      '--ljf-dismiss-btn-text':   th.dismissBtnText,
      '--ljf-add-btn-text':       th.addBtnText,
      '--ljf-green-text':         th.greenText,
      '--ljf-red-text':           th.redText,
      '--ljf-status-text':        th.statusText,
      '--ljf-arrow-text':         th.arrowText,
      '--ljf-salary-on-title':    th.salaryOnTitle,
      '--ljf-salary-on-val':      th.salaryOnVal,
      '--ljf-salary-off-title':   th.salaryOffTitle,
      '--ljf-salary-off-val':     th.salaryOffVal,
      '--ljf-border1':            th.border1,
      '--ljf-border2':            th.border2,
      '--ljf-border3':            th.border3,
      '--ljf-row-border':         th.rowBorder,
      '--ljf-dim-row-border':     rowTint(userColors.dismiss,    darkMode ? 0.38 : 0.32),
      '--ljf-hi-row-border':      rowTint(userColors.highlight,  darkMode ? 0.38 : 0.32),
      '--ljf-log-row-border':     rowTint(userColors.recent,     darkMode ? 0.35 : 0.38),
      '--ljf-salary-off-border':  th.salaryOffBorder,
      '--ljf-input-border':       th.inputBorder,
      '--ljf-tab-accent':         th.tabAccent,
      '--ljf-dismiss-btn-border': th.dismissBtnBorder,
      '--ljf-green-border':       th.greenBorder,
      '--ljf-red-border':         th.redBorder,
    };
    for (const [k, v] of Object.entries(vars)) panel.style.setProperty(k, v);
  }

  // ─── Jobs pane helpers ────────────────────────────────────────────────────────

  function daysAgo(dateStr) {
    if (!dateStr) return '—';
    const days = Math.floor((Date.now() - new Date(dateStr + 'T00:00:00').getTime()) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return '1d';
    return days + 'd';
  }

  function statusStyle(status) {
    const s = status || 'applied';
    const map = darkMode ? {
      applied:      { bg:'#2a2a2a', text:'#aaa',    bdr:'#444'    },
      interviewing: { bg:'#332800', text:'#d4a800', bdr:'#554400' },
      offer:        { bg:'#0a2a0a', text:'#5cb85c', bdr:'#1a5a1a' },
      rejected:     { bg:'#2a0a0a', text:'#c05555', bdr:'#5a1a1a' },
      closed:       { bg:'#1a1220', text:'#9966cc', bdr:'#442266' },
      withdrawn:    { bg:'#1a1a1a', text:'#666',    bdr:'#333'    },
    } : {
      applied:      { bg:'#f0f0f0', text:'#555',    bdr:'#ccc'    },
      interviewing: { bg:'#fffbe6', text:'#7a5c00', bdr:'#c8a200' },
      offer:        { bg:'#edfaed', text:'#1a6b1a', bdr:'#5cb85c' },
      rejected:     { bg:'#faeded', text:'#8b0000', bdr:'#c05555' },
      closed:       { bg:'#f3eefa', text:'#6633aa', bdr:'#c9a0e8' },
      withdrawn:    { bg:'#f5f5f5', text:'#888',    bdr:'#ccc'    },
    };
    return map[s] || map.applied;
  }

  function computeStats(log) {
    const total = log.length;
    if (total === 0) return '';
    const counts = { applied: 0, interviewing: 0, offer: 0, rejected: 0, closed: 0, withdrawn: 0 };
    for (const e of log) counts[e.status || 'applied']++;
    const responded = counts.interviewing + counts.offer + counts.closed;
    const pills = [];
    pills.push(total + ' apps');
    if (responded > 0) pills.push(Math.round(responded / total * 100) + '% response');
    if (counts.rejected > 0) pills.push(Math.round(counts.rejected / total * 100) + '% ghosted');
    if (counts.interviewing > 0) pills.push(counts.interviewing + ' interviewing');
    return pills.map(p => `<span class="ljf-stat-pill">${p}</span>`).join('');
  }

  function renderJobsPane() {
    const pane = document.getElementById('ljf-pane-jobs');
    if (!pane) return;

    const isDismView = activeLogView === 'dismissed';

    const COLS = isDismView
      ? ['company', 'title', 'location', 'date', 'days', 'del']
      : ['company', 'title', 'date', 'days', 'status', 'link', 'del'];
    const LABELS = isDismView
      ? { company:'Company', title:'Title', location:'Location', date:'Dismissed', days:'Age', del:'' }
      : { company:'Company', title:'Title', date:'Applied', days:'Age', status:'Status', link:'', del:'' };
    const WIDTHS = isDismView
      ? { company:'25%', title:'28%', location:'22%', date:'11%', days:'8%', del:'6%' }
      : { company:'26%', title:'33%', date:'12%', days:'7%', status:'12%', link:'5%', del:'5%' };
    const SORTABLE = isDismView
      ? new Set(['company', 'title', 'date'])
      : new Set(['company', 'title', 'date', 'status']);

    if (!SORTABLE.has(jobSort.col)) jobSort.col = 'date';

    const dataLog = isDismView ? dismissLog : appliedLog;
    const colCount = COLS.length;

    const indexed = dataLog.map((e, i) => ({ e, i }));
    indexed.sort(({ e: a, i: ai }, { e: b, i: bi }) => {
      let av, bv;
      const col = jobSort.col;
      if (col === 'date')         { av = a.date    || ''; bv = b.date    || ''; }
      else if (col === 'company') { av = (a.company || '').toLowerCase(); bv = (b.company || '').toLowerCase(); }
      else if (col === 'title')   { av = (a.title   || '').toLowerCase(); bv = (b.title   || '').toLowerCase(); }
      else if (col === 'status')  { av = a.status  || 'applied';          bv = b.status  || 'applied'; }
      else { av = ''; bv = ''; }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp !== 0) return jobSort.dir === 'asc' ? cmp : -cmp;
      return jobSort.dir === 'asc' ? ai - bi : bi - ai;
    });

    const STATUS_OPTIONS = ['applied','interviewing','offer','rejected','closed','withdrawn'];
    const _now = new Date();
    const today = [_now.getFullYear(), String(_now.getMonth() + 1).padStart(2, '0'), String(_now.getDate()).padStart(2, '0')].join('-');
    const companies = [...new Set(dataLog.map(e => e.company).filter(Boolean))].sort();
    const titles    = [...new Set(dataLog.map(e => e.title).filter(Boolean))].sort();

    function mk(tag, id, cls) {
      const el = document.createElement(tag);
      if (id)  el.id        = id;
      if (cls) el.className = cls;
      return el;
    }

    // Datalists
    const coList = mk('datalist', 'ljf-co-list');
    companies.forEach(c => { const o = document.createElement('option'); o.value = c; coList.appendChild(o); });
    const tiList = mk('datalist', 'ljf-ti-list');
    titles.forEach(ti => { const o = document.createElement('option'); o.value = ti; tiList.appendChild(o); });

    // Table
    const scrollDiv = mk('div', null, 'ljf-jobs-scroll');
    const table = mk('table', null, 'ljf-jobs-table');
    const thead = document.createElement('thead');

    // Header row — each th is fresh, innerHTML is safe
    const headerTr = document.createElement('tr');
    for (const col of COLS) {
      const active   = jobSort.col === col;
      const sortable = SORTABLE.has(col);
      const arrow    = active ? (jobSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      const th = document.createElement('th');
      th.dataset.sort = col;
      th.style.width = WIDTHS[col];
      const clsParts = [active ? 'ljf-sort-active' : '', sortable ? 'ljf-sortable' : '', col === 'days' ? 'ljf-center' : ''].filter(Boolean);
      if (clsParts.length) th.className = clsParts.join(' ');
      th.appendChild(document.createTextNode(LABELS[col]));
      if (arrow) {
        const arrowSpan = document.createElement('span');
        arrowSpan.className = 'ljf-sort-arrow';
        arrowSpan.textContent = arrow;
        th.appendChild(arrowSpan);
      }
      if (col === 'company') {
        const filterBtn = document.createElement('button');
        filterBtn.className = 'ljf-co-filter-btn' + (companyFilter || companyFilterOpen ? ' ljf-co-filter-active' : '');
        filterBtn.title = 'Filter by company';
        const svgNS = 'http://www.w3.org/2000/svg';
        const fbSvg = document.createElementNS(svgNS, 'svg');
        fbSvg.setAttribute('viewBox', '0 0 16 16'); fbSvg.setAttribute('width', '9'); fbSvg.setAttribute('height', '9');
        fbSvg.setAttribute('fill', 'none'); fbSvg.setAttribute('stroke', 'currentColor');
        fbSvg.setAttribute('stroke-width', '1.8'); fbSvg.setAttribute('stroke-linecap', 'round');
        const fbCircle = document.createElementNS(svgNS, 'circle');
        fbCircle.setAttribute('cx', '6.5'); fbCircle.setAttribute('cy', '6.5'); fbCircle.setAttribute('r', '4');
        const fbLine = document.createElementNS(svgNS, 'line');
        fbLine.setAttribute('x1', '10'); fbLine.setAttribute('y1', '10'); fbLine.setAttribute('x2', '14'); fbLine.setAttribute('y2', '14');
        fbSvg.appendChild(fbCircle); fbSvg.appendChild(fbLine);
        filterBtn.appendChild(fbSvg);
        th.appendChild(filterBtn);
      }
      headerTr.appendChild(th);
    }
    thead.appendChild(headerTr);

    // Filter row
    const filterTr = mk('tr', 'ljf-co-filter-row');
    if (!companyFilterOpen && !companyFilter) filterTr.style.display = 'none';
    const filterTd = document.createElement('td');
    filterTd.colSpan = colCount;
    const filterWrap = mk('div', null, 'ljf-co-filter-wrap');
    const filterInput = mk('input', 'ljf-co-filter-input');
    filterInput.type = 'text'; filterInput.placeholder = 'Filter by company…';
    filterInput.value = companyFilter; filterInput.autocomplete = 'off';
    const filterClear = mk('button', null, 'ljf-co-filter-clear');
    filterClear.title = 'Clear filter'; filterClear.textContent = '✕';
    filterWrap.appendChild(filterInput); filterWrap.appendChild(filterClear);
    filterTd.appendChild(filterWrap); filterTr.appendChild(filterTd);
    thead.appendChild(filterTr);

    // Tbody — each tr is fresh, innerHTML is safe
    const tbody = document.createElement('tbody');
    if (indexed.length === 0) {
      const emptyTr = document.createElement('tr');
      const emptyTd = document.createElement('td');
      emptyTd.colSpan = colCount;
      emptyTd.className = 'ljf-jobs-empty';
      emptyTd.textContent = isDismView ? 'No dismissed jobs logged yet.' : 'No applications logged yet.';
      emptyTr.appendChild(emptyTd);
      tbody.appendChild(emptyTr);
    } else if (isDismView) {
      function mkTd(cls, titleVal, text) {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        if (titleVal) td.title = titleVal;
        td.textContent = text;
        return td;
      }
      for (const { e: entry, i: logIdx } of indexed) {
        const tr = document.createElement('tr');
        tr.dataset.dmIdx   = logIdx;
        tr.dataset.company = (entry.company || '').toLowerCase();
        const co  = entry.company  || '—';
        const ti  = entry.title    || '—';
        const loc = entry.location || '';
        const dt  = entry.date     || '';
        tr.appendChild(mkTd('ljf-col-trunc', co, co));
        tr.appendChild(mkTd('ljf-col-trunc', ti, ti));
        tr.appendChild(mkTd('ljf-col-trunc ljf-col-muted', loc, loc || '—'));
        tr.appendChild(mkTd('ljf-col-muted', '', dt || '—'));
        tr.appendChild(mkTd('ljf-col-muted ljf-center', '', daysAgo(entry.date || '')));
        const delTd = document.createElement('td'); delTd.className = 'ljf-col-icon';
        const delBtn = document.createElement('button');
        delBtn.className = 'ljf-log-del'; delBtn.dataset.dmIdx = logIdx;
        delBtn.title = 'Delete entry'; delBtn.textContent = '✕';
        delTd.appendChild(delBtn); tr.appendChild(delTd);
        tbody.appendChild(tr);
      }
    } else {
      const liSvgNS = 'http://www.w3.org/2000/svg';
      function buildLiIcon() {
        const s = document.createElementNS(liSvgNS, 'svg');
        s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', '14'); s.setAttribute('height', '14');
        s.setAttribute('focusable', 'false'); s.setAttribute('class', 'ljf-li-icon');
        const p = document.createElementNS(liSvgNS, 'path');
        p.setAttribute('d', 'M15 2v12a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1h12a1 1 0 011 1zM5 6H3v7h2zm.25-2A1.25 1.25 0 104 5.25 1.25 1.25 0 005.25 4zM13 9.29c0-2.2-.73-3.49-2.86-3.49A2.71 2.71 0 007.89 7V6H6v7h2V9.73a1.73 1.73 0 011.52-1.92h.14C10.82 7.8 11 8.94 11 9.73V13h2z');
        p.setAttribute('fill', '#0a66c2');
        s.appendChild(p);
        return s;
      }
      for (const { e: entry, i: logIdx } of indexed) {
        const tr = document.createElement('tr');
        tr.dataset.logIdx  = logIdx;
        tr.dataset.company = (entry.company || '').toLowerCase();
        const status = entry.status || 'applied';
        const sc     = statusStyle(status);
        const co     = entry.company || '—';
        const ti     = entry.title   || '—';
        const url    = entry.url || '';
        const dt     = entry.date    || '';
        // Company cell
        const coTd = document.createElement('td');
        coTd.className = 'ljf-col-trunc ljf-co-cell'; coTd.dataset.company = co; coTd.title = co; coTd.textContent = co;
        tr.appendChild(coTd);
        // Title cell
        const tiTd = document.createElement('td');
        tiTd.className = 'ljf-col-trunc'; tiTd.title = ti; tiTd.textContent = ti;
        tr.appendChild(tiTd);
        // Date cell
        const dtTd = document.createElement('td');
        dtTd.className = 'ljf-col-muted'; dtTd.textContent = dt || '—';
        tr.appendChild(dtTd);
        // Days cell
        const daysTd = document.createElement('td');
        daysTd.className = 'ljf-col-muted ljf-center'; daysTd.textContent = daysAgo(entry.date || '');
        tr.appendChild(daysTd);
        // Status cell
        const statusTd = document.createElement('td');
        statusTd.style.padding = '1px 3px';
        const sel = document.createElement('select');
        sel.className = 'ljf-status-sel'; sel.dataset.logIdx = logIdx;
        sel.style.background = sc.bg; sel.style.color = sc.text;
        for (const s of STATUS_OPTIONS) {
          const opt = document.createElement('option');
          opt.value = s; opt.textContent = s.charAt(0).toUpperCase() + s.slice(1);
          if (s === status) opt.selected = true;
          sel.appendChild(opt);
        }
        statusTd.appendChild(sel); tr.appendChild(statusTd);
        // LinkedIn link cell
        const linkTd = document.createElement('td');
        linkTd.className = 'ljf-col-icon';
        if (url) {
          const a = document.createElement('a');
          a.href = url; a.target = '_blank'; a.rel = 'noopener';
          a.className = 'ljf-li-link'; a.title = 'Open listing';
          a.appendChild(buildLiIcon());
          linkTd.appendChild(a);
        }
        tr.appendChild(linkTd);
        // Delete cell
        const delTd2 = document.createElement('td'); delTd2.className = 'ljf-col-icon';
        const delBtn2 = document.createElement('button');
        delBtn2.className = 'ljf-log-del'; delBtn2.dataset.logIdx = logIdx;
        delBtn2.title = 'Delete entry'; delBtn2.textContent = '✕';
        delTd2.appendChild(delBtn2); tr.appendChild(delTd2);
        tbody.appendChild(tr);
      }
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    scrollDiv.appendChild(table);

    // Add form row
    const addFormEl = mk('div', 'ljf-add-job-row', 'ljf-add-job-row');
    if (isDismView) {
      const coInp = mk('input', 'ljf-aj-company', 'ljf-add-job-input');
      coInp.type = 'text'; coInp.placeholder = 'Company';
      coInp.setAttribute('list', 'ljf-co-list'); coInp.autocomplete = 'off'; coInp.style.flex = '0 0 25%';
      const tiInp = mk('input', 'ljf-aj-title', 'ljf-add-job-input');
      tiInp.type = 'text'; tiInp.placeholder = 'Title';
      tiInp.setAttribute('list', 'ljf-ti-list'); tiInp.autocomplete = 'off'; tiInp.style.flex = '0 0 28%';
      const locInp = mk('input', 'ljf-aj-location', 'ljf-add-job-input');
      locInp.type = 'text'; locInp.placeholder = 'Location';
      locInp.autocomplete = 'off'; locInp.style.flex = '1'; locInp.style.minWidth = '0';
      const dateInp = mk('input', 'ljf-aj-date', 'ljf-add-job-input');
      dateInp.type = 'date'; dateInp.value = today; dateInp.style.flex = '0 0 14%';
      addFormEl.appendChild(coInp); addFormEl.appendChild(tiInp);
      addFormEl.appendChild(locInp); addFormEl.appendChild(dateInp);
    } else {
      const coInp = mk('input', 'ljf-aj-company', 'ljf-add-job-input');
      coInp.type = 'text'; coInp.placeholder = 'Company';
      coInp.setAttribute('list', 'ljf-co-list'); coInp.autocomplete = 'off'; coInp.style.flex = '0 0 26%';
      const tiInp = mk('input', 'ljf-aj-title', 'ljf-add-job-input');
      tiInp.type = 'text'; tiInp.placeholder = 'Title';
      tiInp.setAttribute('list', 'ljf-ti-list'); tiInp.autocomplete = 'off'; tiInp.style.flex = '0 0 33%';
      const dateInp = mk('input', 'ljf-aj-date', 'ljf-add-job-input');
      dateInp.type = 'date'; dateInp.value = today; dateInp.style.flex = '0 0 17%';
      const statusSel = mk('select', 'ljf-aj-status', 'ljf-add-job-sel');
      statusSel.style.flex = '0 0 12%';
      for (const s of STATUS_OPTIONS) {
        const o = document.createElement('option'); o.value = s;
        o.textContent = s.charAt(0).toUpperCase() + s.slice(1);
        statusSel.appendChild(o);
      }
      const urlInp = mk('input', 'ljf-aj-url', 'ljf-add-job-input');
      urlInp.type = 'url'; urlInp.placeholder = 'Job URL';
      urlInp.autocomplete = 'off'; urlInp.style.flex = '1'; urlInp.style.minWidth = '0';
      addFormEl.appendChild(coInp); addFormEl.appendChild(tiInp); addFormEl.appendChild(dateInp);
      addFormEl.appendChild(statusSel); addFormEl.appendChild(urlInp);
    }
    const saveBtn = mk('button', 'ljf-aj-add', 'ljf-add-job-submit');
    saveBtn.textContent = 'Save';
    addFormEl.appendChild(saveBtn);

    // Footer
    const toggleOn = activeLogView === 'jobs';
    const footer = mk('div', 'ljf-jobs-footer', 'ljf-jobs-footer');

    const statsDiv = mk('div', null, 'ljf-footer-stats');
    const statsSpan = document.createElement('span');
    statsSpan.textContent = isDismView
      ? indexed.length + ' dismissed'
      : indexed.length + ' application' + (indexed.length === 1 ? '' : 's');
    statsDiv.appendChild(statsSpan);
    if (!isDismView && appliedLog.length > 0) {
      const counts = { applied:0, interviewing:0, offer:0, rejected:0, closed:0, withdrawn:0 };
      for (const e of appliedLog) counts[e.status || 'applied']++;
      const total     = appliedLog.length;
      const responded = counts.interviewing + counts.offer + counts.closed;
      const pills = [total + ' apps'];
      if (responded > 0)          pills.push(Math.round(responded / total * 100) + '% response');
      if (counts.rejected > 0)    pills.push(Math.round(counts.rejected / total * 100) + '% ghosted');
      if (counts.interviewing > 0) pills.push(counts.interviewing + ' interviewing');
      for (const p of pills) {
        const pill = document.createElement('span');
        pill.className = 'ljf-stat-pill'; pill.textContent = p;
        statsDiv.appendChild(pill);
      }
    }
    footer.appendChild(statsDiv);

    const footerRight = document.createElement('div');
    footerRight.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const toggleDiv = mk('div', 'ljf-log-view-toggle');
    toggleDiv.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:10px;color:var(--ljf-count-text);cursor:pointer;';
    const tLeft = document.createElement('span'); tLeft.textContent = 'Log';
    const tTrack = document.createElement('div');
    tTrack.style.cssText = `position:relative;width:28px;height:16px;border-radius:8px;flex-shrink:0;background:${toggleOn ? '#4e7af7' : (darkMode ? '#444' : '#bbb')};`;
    const tThumb = document.createElement('div');
    tThumb.style.cssText = `position:absolute;top:2px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);left:${toggleOn ? '14px' : '2px'};transition:left .15s;`;
    tTrack.appendChild(tThumb);
    const tRight = document.createElement('span'); tRight.textContent = toggleOn ? 'Jobs' : 'Dismissed';
    toggleDiv.appendChild(tLeft); toggleDiv.appendChild(tTrack); toggleDiv.appendChild(tRight);
    const footerAddBtn = mk('button', 'ljf-footer-add', 'ljf-footer-add');
    footerAddBtn.title = isDismView ? 'Add dismissed entry' : 'Add job manually';
    footerAddBtn.textContent = '+';
    footerRight.appendChild(toggleDiv); footerRight.appendChild(footerAddBtn);
    footer.appendChild(footerRight);

    // Replace pane content
    while (pane.firstChild) pane.removeChild(pane.firstChild);
    pane.appendChild(coList); pane.appendChild(tiList);
    pane.appendChild(scrollDiv); pane.appendChild(addFormEl); pane.appendChild(footer);

    // Sort header click handlers
    pane.querySelectorAll('th[data-sort]').forEach(thEl => {
      const col = thEl.dataset.sort;
      if (!SORTABLE.has(col)) return;
      thEl.addEventListener('click', () => {
        if (jobSort.col === col) {
          jobSort.dir = jobSort.dir === 'desc' ? 'asc' : 'desc';
        } else {
          jobSort.col = col;
          jobSort.dir = col === 'date' ? 'desc' : 'asc';
        }
        renderJobsPane();
      });
    });

    // Log view toggle
    pane.querySelector('#ljf-log-view-toggle')?.addEventListener('click', () => {
      activeLogView = activeLogView === 'jobs' ? 'dismissed' : 'jobs';
      editingLogIdx = null;
      editingDismissLogIdx = null;
      companyFilter = '';
      companyFilterOpen = false;
      jobSort.col = 'date';
      jobSort.dir = 'desc';
      renderJobsPane();
    });

    // Company filter
    function applyCompanyFilter() {
      const q = companyFilter.toLowerCase();
      const rowSel = isDismView ? 'tbody tr[data-dm-idx]' : 'tbody tr[data-log-idx]';
      let visible = 0;
      pane.querySelectorAll(rowSel).forEach(tr => {
        const show = !q || (tr.dataset.company || '').includes(q);
        tr.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      const countEl = pane.querySelector('.ljf-footer-stats span');
      if (countEl) {
        const total = dataLog.length;
        const label = isDismView ? 'dismissed' : ('application' + (total === 1 ? '' : 's'));
        countEl.textContent = q ? `${visible} of ${total} ${label}` : `${total} ${label}`;
      }
    }

    pane.querySelector('.ljf-co-filter-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      companyFilterOpen = !companyFilterOpen;
      const filterRow = pane.querySelector('#ljf-co-filter-row');
      if (filterRow) filterRow.style.display = companyFilterOpen || companyFilter ? '' : 'none';
      if (companyFilterOpen) pane.querySelector('#ljf-co-filter-input')?.focus();
    });

    pane.querySelector('#ljf-co-filter-input')?.addEventListener('input', e => {
      companyFilter = e.target.value;
      applyCompanyFilter();
    });

    pane.querySelector('.ljf-co-filter-clear')?.addEventListener('click', () => {
      companyFilter = '';
      companyFilterOpen = false;
      const filterRow = pane.querySelector('#ljf-co-filter-row');
      if (filterRow) filterRow.style.display = 'none';
      applyCompanyFilter();
    });

    applyCompanyFilter();

    // Status dropdowns (jobs view only)
    if (!isDismView) {
      pane.querySelectorAll('.ljf-status-sel').forEach(sel => {
        sel.addEventListener('change', () => {
          const idx = +sel.dataset.logIdx;
          if (!appliedLog[idx]) return;
          appliedLog[idx].status     = sel.value;
          appliedLog[idx].statusDate = localDateStr();
          saveAppliedLog();
          const sc = statusStyle(sel.value);
          sel.style.background  = sc.bg;
          sel.style.color       = sc.text;
          sel.style.borderColor = sc.bdr;
        });
      });
    }

    // Delete buttons
    pane.querySelectorAll('.ljf-log-del').forEach(btn => {
      btn.addEventListener('click', () => {
        if (isDismView) {
          const idx = +btn.dataset.dmIdx;
          const entry = dismissLog[idx];
          if (!entry) return;
          const label = [entry.company, entry.title].filter(Boolean).join(' — ') || 'this entry';
          if (!confirm('Delete "' + label + '" from the dismiss log?')) return;
          dismissLog.splice(idx, 1);
          saveDismissLog();
          clearHighlights();
          applyAllRules();
          renderJobsPane();
        } else {
          const idx = +btn.dataset.logIdx;
          const entry = appliedLog[idx];
          if (!entry) return;
          const label = [entry.company, entry.title].filter(Boolean).join(' — ') || 'this entry';
          if (!confirm('Delete "' + label + '" from the job log?')) return;
          appliedLog.splice(idx, 1);
          saveAppliedLog();
          clearHighlights();
          applyAllRules();
          renderJobsPane();
        }
      });
    });

    // Row click → populate form for editing
    if (isDismView) {
      pane.querySelectorAll('tbody tr[data-dm-idx]').forEach(tr => {
        tr.addEventListener('click', e => {
          if (e.target.closest('button')) return;
          const idx = +tr.dataset.dmIdx;
          const entry = dismissLog[idx];
          if (!entry) return;
          editingDismissLogIdx = idx;
          const formRow = pane.querySelector('#ljf-add-job-row');
          formRow.classList.add('ljf-open');
          pane.querySelector('#ljf-aj-company').value  = entry.company  || '';
          pane.querySelector('#ljf-aj-title').value    = entry.title    || '';
          pane.querySelector('#ljf-aj-location').value = entry.location || '';
          pane.querySelector('#ljf-aj-date').value     = entry.date     || '';
          pane.querySelectorAll('tbody tr[data-dm-idx]').forEach(r => r.classList.remove('ljf-row-editing'));
          tr.classList.add('ljf-row-editing');
          pane.querySelector('#ljf-aj-company')?.focus();
        });
      });
    } else {
      pane.querySelectorAll('tbody tr[data-log-idx]').forEach(tr => {
        tr.addEventListener('click', e => {
          if (e.target.closest('select, button, a')) return;
          const idx = +tr.dataset.logIdx;
          const entry = appliedLog[idx];
          if (!entry) return;
          editingLogIdx = idx;
          const formRow = pane.querySelector('#ljf-add-job-row');
          formRow.classList.add('ljf-open');
          pane.querySelector('#ljf-aj-company').value = entry.company || '';
          pane.querySelector('#ljf-aj-title').value   = entry.title   || '';
          pane.querySelector('#ljf-aj-date').value    = entry.date    || '';
          pane.querySelector('#ljf-aj-status').value  = entry.status  || 'applied';
          pane.querySelector('#ljf-aj-url').value     = entry.url     || '';
          pane.querySelectorAll('tbody tr[data-log-idx]').forEach(r => r.classList.remove('ljf-row-editing'));
          tr.classList.add('ljf-row-editing');
          pane.querySelector('#ljf-aj-company')?.focus();
        });
      });
    }

    // Add form toggle — resets to Add mode
    pane.querySelector('#ljf-footer-add')?.addEventListener('click', () => {
      const formRow = pane.querySelector('#ljf-add-job-row');
      const isOpen = formRow.classList.toggle('ljf-open');
      if (isOpen) {
        editingLogIdx = null;
        editingDismissLogIdx = null;
        pane.querySelector('#ljf-aj-company').value  = '';
        pane.querySelector('#ljf-aj-title').value    = '';
        pane.querySelector('#ljf-aj-date').value     = today;
        if (isDismView) {
          pane.querySelector('#ljf-aj-location').value = '';
        } else {
          pane.querySelector('#ljf-aj-status').value = 'applied';
          pane.querySelector('#ljf-aj-url').value    = '';
        }
        const rowSel = isDismView ? 'tbody tr[data-dm-idx]' : 'tbody tr[data-log-idx]';
        pane.querySelectorAll(rowSel).forEach(r => r.classList.remove('ljf-row-editing'));
        pane.querySelector('#ljf-aj-company')?.focus();
      }
    });

    // Add / Update submit
    function submitAddJob() {
      const company  = pane.querySelector('#ljf-aj-company')?.value.trim();
      const title    = pane.querySelector('#ljf-aj-title')?.value.trim();
      const date     = pane.querySelector('#ljf-aj-date')?.value;
      if (!company || !title || !date) return;
      if (isDismView) {
        const location = pane.querySelector('#ljf-aj-location')?.value.trim() || '';
        if (editingDismissLogIdx !== null && dismissLog[editingDismissLogIdx]) {
          Object.assign(dismissLog[editingDismissLogIdx], { company, title, location, date });
          editingDismissLogIdx = null;
        } else {
          dismissLog.push({ jobId: null, company, title, location, date });
        }
        saveDismissLog();
      } else {
        const status = pane.querySelector('#ljf-aj-status')?.value || 'applied';
        const url    = pane.querySelector('#ljf-aj-url')?.value.trim();
        if (editingLogIdx !== null && appliedLog[editingLogIdx]) {
          Object.assign(appliedLog[editingLogIdx], { company, title, date, url, status });
          editingLogIdx = null;
        } else {
          appliedLog.push({ company, title, date, url, status, statusDate: today });
        }
        saveAppliedLog();
      }
      clearHighlights();
      applyAllRules();
      renderJobsPane();
      const formRow = pane.querySelector('#ljf-add-job-row');
      if (formRow) {
        formRow.classList.add('ljf-open');
        pane.querySelector('#ljf-aj-company')?.focus();
      }
    }

    pane.querySelector('#ljf-aj-add')?.addEventListener('click', submitAddJob);
    const lastEnterInput = isDismView ? pane.querySelector('#ljf-aj-date') : pane.querySelector('#ljf-aj-url');
    lastEnterInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitAddJob();
    });
  }

  // ─── Storage helpers ─────────────────────────────────────────────────────────

  function loadRules() {
    try { return JSON.parse(GM_getValue(STORAGE_KEY, '[]')); }
    catch { return []; }
  }

  function saveRules() {
    GM_setValue(STORAGE_KEY, JSON.stringify(rules));
  }

  function loadAppliedLog() {
    try { return JSON.parse(GM_getValue(LOG_KEY, '[]')); }
    catch { return []; }
  }

  function saveAppliedLog() {
    GM_setValue(LOG_KEY, JSON.stringify(appliedLog));
    logIndex = buildLogIndex();
  }

  function buildLogIndex() {
    const idx = new Map();
    for (const e of appliedLog) {
      if (!e.company || e.company.length < 2) continue;
      const key = e.company.toLowerCase();
      if (!idx.has(key)) {
        const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        idx.set(key, new RegExp('(?<![\\w])' + esc + '(?![\\w])'));
      }
    }
    return idx;
  }

  function loadDismissLog() {
    try { return JSON.parse(GM_getValue(DISMISS_LOG_KEY, '[]')); }
    catch { return []; }
  }

  function saveDismissLog() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - dismissLogExpiry);
    const cutoffStr = [cutoff.getFullYear(), String(cutoff.getMonth() + 1).padStart(2, '0'), String(cutoff.getDate()).padStart(2, '0')].join('-');
    dismissLog = dismissLog.filter(e => !e.date || e.date >= cutoffStr);
    GM_setValue(DISMISS_LOG_KEY, JSON.stringify(dismissLog));
    dismissLogIndex = buildDismissLogIndex();
    updateDismissLogCount();
  }

  function buildDismissLogIndex() {
    const idx = new Map();
    for (const e of dismissLog) {
      if (e.jobId) idx.set('id:' + e.jobId, e);
      const ctKey = 'ct:' + (e.company || '').toLowerCase() + '\x00' + normalizeSenior((e.title || '').toLowerCase());
      if (!idx.has(ctKey)) idx.set(ctKey, []);
      idx.get(ctKey).push(e);
    }
    return idx;
  }

  function addRule(type, value, label) {
    const rule = { id: Date.now(), type, value: value.trim(), label: label || value.trim(), enabled: true };
    rules.push(rule);
    saveRules();
    return rule;
  }

  function updateRule(id, value, label) {
    const r = rules.find(r => r.id === id);
    if (r) { r.value = value.trim(); r.label = label || value.trim(); saveRules(); }
  }

  function removeRule(id) {
    rules = rules.filter(r => r.id !== id);
    saveRules();
  }

  function toggleRule(id) {
    const r = rules.find(r => r.id === id);
    if (r) { r.enabled = !r.enabled; saveRules(); }
  }

  // ─── Matchers ─────────────────────────────────────────────────────────────────

  function cardText(card, sel) {
    const el = card.querySelector(sel);
    return el ? el.textContent.trim() : '';
  }

  function cardJobId(card) {
    const link = card.querySelector(TITLE_SEL);
    if (!link) return null;
    const m = (link.getAttribute('href') || '').match(/\/jobs\/view\/(\d+)/);
    return m ? m[1] : null;
  }

  function cardLocationText(card) {
    return Array.from(card.querySelectorAll(SALARY_SEL))
      .map(el => el.textContent.trim())
      .filter(s => s && !s.includes('$'))
      .join(' | ');
  }

  function isDismissed(card) {
    return card.dataset.ljfDismissed || !!card.querySelector('.job-card-list--is-dismissed');
  }

  function matchApplied(card) {
    const el = card.querySelector(APPLIED_SEL);
    return !!el && /applied/i.test(el.textContent);
  }

  function matchCompany(card, rule) {
    return cardText(card, COMPANY_SEL).toLowerCase().includes(rule.value.toLowerCase());
  }

  function normalizeSenior(str) {
    return str.replace(/\bsr\.?\s*/gi, 'senior ').replace(/\s+/g, ' ').trim();
  }

  function matchTitle(card, rule) {
    const title = normalizeSenior(cardText(card, TITLE_SEL));
    const value = normalizeSenior(rule.value);
    return title.toLowerCase().includes(value.toLowerCase());
  }

  function matchCompanyHi(card, rule) {
    return matchCompany(card, rule);
  }

  function matchTitleHi(card, rule) {
    return matchTitle(card, rule);
  }

  function matchLocation(card, rule) {
    const kw = rule.value.toLowerCase();
    return Array.from(card.querySelectorAll(SALARY_SEL)).some(el => el.textContent.trim().toLowerCase().includes(kw));
  }

  function matchLocationHi(card, rule) {
    return matchLocation(card, rule);
  }

  function matchSalaryAbove(card, rule) {
    const threshold = parseFloat(rule.value) * 1000;
    if (isNaN(threshold)) return false;
    const s = parseSalaries(card);
    return s.length > 0 && Math.min(...s) >= threshold;
  }

  function matchTopSalaryAbove(card, rule) {
    const threshold = parseFloat(rule.value) * 1000;
    if (isNaN(threshold)) return false;
    const s = parseSalaries(card);
    return s.length > 0 && Math.max(...s) >= threshold;
  }

  function normalizeUnit(unit) {
    if (!unit) return 'yr';
    const u = unit.toLowerCase();
    if (u.startsWith('hr') || u.startsWith('hour')) return 'hr';
    if (u.startsWith('mo') || u.startsWith('month')) return 'mo';
    return 'yr';
  }

  function toAnnual(amount, unit) {
    if (unit === 'hr') return amount * 40 * 52;
    if (unit === 'mo') return amount * 12;
    return amount;
  }

  // Returns all salary values (annualized) found across all salary elements on a card.
  function parseSalaries(card) {
    const items = card.querySelectorAll(SALARY_SEL);
    const all = [];
    const regex = /\$([\d,]+(?:\.\d+)?)([Kk]?)(?:\s*(?:[\/\\]\s*)?(yr|year|mo|month|hr|hour))?/g;
    for (const el of items) {
      let m;
      regex.lastIndex = 0;
      while ((m = regex.exec(el.textContent))) {
        let amount = parseFloat(m[1].replace(/,/g, ''));
        if (isNaN(amount)) continue;
        if (m[2] && /[Kk]/.test(m[2])) amount *= 1000;
        all.push(toAnnual(amount, normalizeUnit(m[3])));
      }
    }
    return all;
  }

  // Applies the same salary regex to a raw text string (for view-page salary extraction).
  function parseSalaryText(text) {
    const all = [];
    // Two anchored patterns to avoid matching arbitrary dollar amounts in description text:
    //   1) K-suffix:      $175K, $175.5k
    //   2) Comma-grouped: $200,000  $1,250,000
    const regex = /\$([\d,]+(?:\.\d+)?)([Kk])(?:\s*(?:[\/\\]\s*)?(yr|year|mo|month|hr|hour))?|\$(\d{1,3}(?:,\d{3})+)(?:\s*(?:[\/\\]\s*)?(yr|year|mo|month|hr|hour))?/g;
    let m;
    while ((m = regex.exec(text))) {
      let amount, unit;
      if (m[2]) {
        amount = parseFloat(m[1].replace(/,/g, '')) * 1000;
        unit = m[3];
      } else {
        amount = parseFloat(m[4].replace(/,/g, ''));
        unit = m[5];
      }
      if (isNaN(amount)) continue;
      all.push(toAnnual(amount, normalizeUnit(unit)));
    }
    return all;
  }

  // For job view pages: checks hero textContent first (salary pill), then the job description body.
  function parseViewPageSalaries(hero) {
    const heroSalaries = parseSalaryText(hero ? hero.textContent : '');
    if (heroSalaries.length > 0) return heroSalaries;
    const aboutEl = document.querySelector('[componentkey^="JobDetails_AboutTheJob_"]');
    return aboutEl ? parseSalaryText(aboutEl.textContent) : [];
  }

  function matchSalary(card, rule) {
    const threshold = parseFloat(rule.value) * 1000;
    if (isNaN(threshold)) return false;
    const s = parseSalaries(card);
    return s.length > 0 && Math.min(...s) < threshold;
  }

  function matchTopSalary(card, rule) {
    const threshold = parseFloat(rule.value) * 1000;
    if (isNaN(threshold)) return false;
    const s = parseSalaries(card);
    return s.length > 0 && Math.max(...s) < threshold;
  }

  // Word-boundary company match: "Flex" won't match "Flexible", "Ro" won't match "ProKatchers", etc.
  function logCompanyMatches(cardCompany, entryCompany) {
    if (!entryCompany || entryCompany.length < 2) return false;
    const rx = logIndex.get(entryCompany.toLowerCase());
    return rx ? rx.test(cardCompany.toLowerCase()) : false;
  }

  // Returns the first matching log entry if card's company+title match, else null.
  function matchJobLog(card) {
    if (!jobLogEnabled || appliedLog.length === 0) return null;
    const company = cardText(card, COMPANY_SEL).toLowerCase();
    const title   = normalizeSenior(cardText(card, TITLE_SEL)).toLowerCase();
    if (!company && !title) return null;
    return appliedLog.find(e =>
      logCompanyMatches(company, e.company) &&
      e.title && title.includes(normalizeSenior(e.title).toLowerCase())
    ) || null;
  }

  // Returns the latest date string for this company if company matches but no title matches, else null.
  function matchJobLogCompanyOnly(card) {
    if (!jobLogEnabled || appliedLog.length === 0) return null;
    const company = cardText(card, COMPANY_SEL).toLowerCase();
    if (!company) return null;
    const companyEntries = appliedLog.filter(e => logCompanyMatches(company, e.company));
    if (companyEntries.length === 0) return null;
    const title = normalizeSenior(cardText(card, TITLE_SEL)).toLowerCase();
    const hasTitleMatch = companyEntries.some(e => e.title && title.includes(normalizeSenior(e.title).toLowerCase()));
    if (hasTitleMatch) return null; // full match — handled by matchJobLog
    const dates = companyEntries.map(e => e.date || '').filter(Boolean).sort();
    return dates.length > 0 ? dates[dates.length - 1] : '';
  }

  // ─── Core: scan & act ────────────────────────────────────────────────────────

  function getCards() {
    return document.querySelectorAll(CARD_SEL);
  }

  // Count how many visible cards a single rule matches (no visual side effects).
  function countMatches(rule) {
    if (!rule.enabled) return 0;
    const typeDef = RULE_TYPES[rule.type];
    if (!typeDef) return 0;
    let n = 0;
    for (const card of getCards()) { if (typeDef.match(card, rule)) n++; }
    return n;
  }

  // Add a single badge to a card, stacking above any already-present badges.
  function addBadge(card, text, bg) {
    const n = card.querySelectorAll('.ljf-badge').length;
    const badge = document.createElement('span');
    badge.className = 'ljf-badge';
    badge.textContent = text;
    badge.style.cssText = [
      'position:absolute', `bottom:${6 + n * 20}px`, 'right:20px',
      `background:${bg}`, 'color:#fff',
      'font-size:10px', 'padding:2px 7px', 'border-radius:3px',
      'pointer-events:none', 'z-index:2',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif', 'line-height:1.4',
    ].join(';');
    card.appendChild(badge);
  }

  // Cache company/title/jobId/location on the card element so logDismissal can
  // read them after LinkedIn collapses the card DOM on dismiss.
  function cacheCardIdentity(card) {
    if (card.dataset.ljfCardCached) return;
    const jobId    = cardJobId(card);
    const company  = cardText(card, COMPANY_SEL);
    const title    = normalizeSenior(cardText(card, TITLE_SEL));
    const location = cardLocationText(card);
    if (!company && !title) return;
    if (jobId)    card.dataset.ljfCardJobId    = jobId;
    if (company)  card.dataset.ljfCardCompany  = company;
    if (title)    card.dataset.ljfCardTitle    = title;
    if (location) card.dataset.ljfCardLocation = location;
    card.dataset.ljfCardCached = '1';
  }

  // Apply all rules to one card, stacking a badge per matching rule.
  // Returns the number of rules that matched.
  function applyCardRules(card) {
    if (isDismissed(card)) { markDismissed(card); return 0; }
    cacheCardIdentity(card);
    if (card.dataset.ljfRulesApplied) {
      // Re-enforce color in case the SPA re-rendered and cleared inline styles.
      if (card.dataset.ljfHighlighted) {
        card.style.setProperty('background-color', CC.dismissBg, 'important');
        card.style.setProperty('border-left', '3px solid ' + CC.dismissBorder, 'important');
        card.style.setProperty('box-sizing', 'border-box', 'important');
      } else if (card.dataset.ljfGreenMatch) {
        card.style.setProperty('background-color', CC.highlightBg, 'important');
        card.style.setProperty('border-left', '3px solid ' + CC.highlightBorder, 'important');
        card.style.setProperty('box-sizing', 'border-box', 'important');
      }
      return 0;
    }

    const dismissMatches   = [];
    const highlightMatches = [];
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const typeDef = RULE_TYPES[rule.type];
      if (!typeDef) continue;
      if (typeDef.match(card, rule)) {
        if (typeDef.highlight) highlightMatches.push(rule);
        else                   dismissMatches.push(rule);
      }
    }
    if (!dismissMatches.length && !highlightMatches.length) return 0;

    // Salary-pair deduplication:
    //   highlight: both salaryabove + topsalaryabove → keep only salaryabove
    //   dismiss:   both salarybelow + topsalarybelow → keep only topsalarybelow
    let shownHighlight = highlightMatches;
    let shownDismiss   = dismissMatches;
    if (highlightMatches.some(r => r.type === 'salaryabove') &&
        highlightMatches.some(r => r.type === 'topsalaryabove')) {
      shownHighlight = highlightMatches.filter(r => r.type !== 'topsalaryabove');
    }
    if (dismissMatches.some(r => r.type === 'salarybelow') &&
        dismissMatches.some(r => r.type === 'topsalarybelow')) {
      shownDismiss = dismissMatches.filter(r => r.type !== 'salarybelow');
    }

    // If a job log entry exists for this card, suppress the 'applied' rule badge —
    // actJobLog will render "Applied on [date]" and handle card color itself.
    const hasLogEntry = shownDismiss.some(r => r.type === 'applied') && matchJobLog(card);
    if (hasLogEntry) {
      shownDismiss = shownDismiss.filter(r => r.type !== 'applied');
    }

    if (!shownDismiss.length && !shownHighlight.length) {
      card.dataset.ljfRulesApplied = '1';
      return dismissMatches.length + highlightMatches.length;
    }

    card.style.position = 'relative';

    // Add badges first — their DOM mutation may trigger a LinkedIn SPA re-render
    // that clears inline styles, so we set background-color after.
    for (const rule of shownDismiss)   addBadge(card, '\u26F3 ' + rule.label, CC.dismissBadge);
    for (const rule of shownHighlight) addBadge(card, '\u2605 ' + rule.label, CC.highlightBadge);

    // Card color: dismiss (red) beats highlight (green).
    if (shownDismiss.length) {
      card.style.setProperty('background-color', CC.dismissBg, 'important');
      card.style.setProperty('border-left', '3px solid ' + CC.dismissBorder, 'important');
      card.style.setProperty('box-sizing', 'border-box', 'important');
      clearInnerBorder(card);
      card.dataset.ljfHighlighted = shownDismiss[0].id;
    } else {
      card.style.setProperty('background-color', CC.highlightBg, 'important');
      card.style.setProperty('border-left', '3px solid ' + CC.highlightBorder, 'important');
      card.style.setProperty('box-sizing', 'border-box', 'important');
      clearInnerBorder(card);
      card.dataset.ljfGreenMatch = shownHighlight[0].id;
    }

    card.dataset.ljfRulesApplied = '1';
    return dismissMatches.length + highlightMatches.length;
  }

  function applyAllRules() {
    let total = 0;
    for (const card of getCards()) total += applyCardRules(card);
    applyJobLog();
    applyDismissLog();
    applyRecentlyAppliedVisibility();
    applyViewHeroRules();
    applySavedJobRules();
    updateTabCount();
    return total;
  }

  function applyRecentlyAppliedVisibility() {
    for (const card of getCards()) {
      const isYellow     = !!(card.dataset.ljfJobLog && card.dataset.ljfJobLogLabel);
      const isDism       = !!card.dataset.ljfDismissed;
      const isDismLog    = card.dataset.ljfDismissLog === 'grey';
      if (isYellow || isDism || isDismLog) {
        card.style.display = hideRecentlyApplied ? 'none' : '';
      }
    }
  }

  function applyJobLog() {
    if (!jobLogEnabled) return;
    for (const card of getCards()) {
      const entry = matchJobLog(card);
      if (entry) {
        actJobLog(card, entry);
      } else {
        const latestDate = matchJobLogCompanyOnly(card);
        if (latestDate !== null) actJobLogCompanyLabel(card, latestDate);
      }
    }
  }

  function daysSince(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return null;
    const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
    return diff >= 0 ? diff : null;
  }

  function actJobLogCompanyLabel(card, date) {
    if (isDismissed(card)) return;
    if (card.dataset.ljfJobLogLabel) return; // already labeled
    const days = daysSince(date);
    const reapplyOk = days !== null && days >= reapplyDays;
    const isRecent  = days !== null && days < reapplyDays;

    const n = card.querySelectorAll('.ljf-badge').length;
    const badge = document.createElement('span');
    badge.className = 'ljf-badge';
    badge.style.cssText = [
      'position:absolute', `bottom:${6 + n * 20}px`, 'right:20px',
      `background:${isRecent ? CC.recentBadge : CC.staleBadge}`, 'color:#fff',
      'font-size:10px', 'padding:2px 7px', 'border-radius:3px',
      'pointer-events:none', 'z-index:2',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif', 'line-height:1.4',
      'display:inline-flex', 'align-items:center', 'gap:4px',
    ].join(';');

    const textNode = document.createTextNode(
      'Last applied' + (date ? ' ' + date : '') +
      (days !== null ? ' | ' + days + ' days ago' : '')
    );
    badge.appendChild(textNode);

    if (days !== null) {
      const icon = document.createElement('span');
      icon.textContent = reapplyOk ? '\u2714' : '\u2716';
      icon.style.cssText = 'font-size:11px;font-weight:900;line-height:1;';
      icon.style.setProperty('color', reapplyOk ? '#4ade80' : '#f87171', 'important');
      badge.appendChild(icon);
    }

    // Yellow tint overrides green (highlight) but not red (dismiss).
    if (isRecent && !card.dataset.ljfHighlighted) {
      card.style.setProperty('background-color', CC.recentBg, 'important');
      card.style.setProperty('border-left', '3px solid ' + CC.recentBorder, 'important');
      card.style.setProperty('box-sizing', 'border-box', 'important');
      delete card.dataset.ljfGreenMatch;
      card.dataset.ljfJobLog = '1';
    }

    card.style.position = 'relative';
    card.appendChild(badge);
    card.dataset.ljfJobLogLabel = '1';
  }

  function clearInnerBorder(card) {
    const inner = card.querySelector('.job-card-container');
    if (inner) inner.style.setProperty('border-left', 'none', 'important');
  }

  function actJobLog(card, entry) {
    if (isDismissed(card)) { markDismissed(card); return; }
    if (card.dataset.ljfJobLog) return; // already labeled
    const alreadyDismissRule = !!card.dataset.ljfHighlighted;
    const dateStr   = entry.date || '';
    const badgeText = 'Applied' + (dateStr ? ' on ' + dateStr : '');

    card.style.position = 'relative';
    addBadge(card, badgeText, CC.dismissBadge);

    if (!alreadyDismissRule) {
      // exact applied match always overrides green — you already applied to this job
      delete card.dataset.ljfGreenMatch;
      card.style.setProperty('background-color', CC.dismissBg, 'important');
      card.style.setProperty('border-left', '3px solid ' + CC.dismissBorder, 'important');
      card.style.setProperty('box-sizing', 'border-box', 'important');
    }
    card.dataset.ljfJobLog = '1';
  }

  function matchDismissLog(card) {
    if (!dismissLog.length) return null;
    const jobId = cardJobId(card);
    if (jobId) {
      const byId = dismissLogIndex.get('id:' + jobId);
      if (byId) return byId;
    }
    const company = cardText(card, COMPANY_SEL).toLowerCase();
    const title   = normalizeSenior(cardText(card, TITLE_SEL)).toLowerCase();
    if (!company && !title) return null;
    const ctKey  = 'ct:' + company + '\x00' + title;
    const entries = dismissLogIndex.get(ctKey);
    if (!entries || !entries.length) return null;
    if (!dismissLogMatchLocation) return entries[0];
    const loc = cardLocationText(card).toLowerCase();
    return entries.find(e => (e.location || '').toLowerCase() === loc) || null;
  }

  function refreshDismissUI() {
    updateDismissLogCount();
    if (panelOpen && activePanel === 'jobs' && activeLogView === 'dismissed') renderJobsPane();
  }

  function logDismissal(card) {
    const jobId    = cardJobId(card)    || card.dataset.ljfCardJobId    || null;
    const company  = cardText(card, COMPANY_SEL)  || card.dataset.ljfCardCompany  || '';
    const title    = normalizeSenior(cardText(card, TITLE_SEL) || card.dataset.ljfCardTitle || '');
    const location = cardLocationText(card) || card.dataset.ljfCardLocation || '';
    const date     = localDateStr();
    if (!company && !title) return;

    // Cache identity so undoLogDismissal can read it after LinkedIn collapses the card DOM
    if (jobId)   card.dataset.ljfLoggedJobId   = jobId;
    if (company) card.dataset.ljfLoggedCompany = company;
    if (title)   card.dataset.ljfLoggedTitle   = title;

    // Same jobId → update date
    if (jobId) {
      const existing = dismissLog.find(e => e.jobId === jobId);
      if (existing) { existing.date = date; saveDismissLog(); refreshDismissUI(); return; }
    }

    // Same company+title → update if location matches (or setting off), else new entry
    const compLow  = company.toLowerCase();
    const titleLow = title.toLowerCase();
    const match = dismissLog.find(e =>
      (e.company || '').toLowerCase() === compLow &&
      normalizeSenior(e.title || '').toLowerCase() === titleLow
    );
    if (match) {
      if (!dismissLogMatchLocation || (match.location || '').toLowerCase() === location.toLowerCase()) {
        match.date = date;
        if (jobId && !match.jobId) match.jobId = jobId;
        saveDismissLog(); refreshDismissUI();
        return;
      }
    }

    dismissLog.push({ jobId: jobId || null, company, title, location, date });
    saveDismissLog(); refreshDismissUI();
  }

  function undoLogDismissal(card) {
    // Prefer cached values set at logDismissal time — card DOM may be collapsed by LinkedIn
    const jobId   = card.dataset.ljfLoggedJobId   || cardJobId(card);
    const company = (card.dataset.ljfLoggedCompany || cardText(card, COMPANY_SEL)).toLowerCase();
    const title   = normalizeSenior(card.dataset.ljfLoggedTitle || cardText(card, TITLE_SEL)).toLowerCase();
    const before  = dismissLog.length;
    if (jobId) dismissLog = dismissLog.filter(e => e.jobId !== jobId);
    if (company || title) {
      dismissLog = dismissLog.filter(e =>
        (e.company || '').toLowerCase() !== company ||
        normalizeSenior(e.title || '').toLowerCase() !== title
      );
    }
    if (dismissLog.length !== before) { saveDismissLog(); refreshDismissUI(); }
    delete card.dataset.ljfLoggedJobId;
    delete card.dataset.ljfLoggedCompany;
    delete card.dataset.ljfLoggedTitle;
  }

  function actDismissLog(card, entry) {
    if (isDismissed(card) || card.dataset.ljfHighlighted || card.dataset.ljfJobLog || card.dataset.ljfDismissLog) return;
    card.dataset.ljfDismissLog = dismissLogCardsRed ? 'red' : 'grey';
    const isRed = dismissLogCardsRed;
    if (!card.dataset.ljfGreenMatch) {
      card.style.setProperty('background-color', isRed ? CC.dismissBg     : CC.prevDismissedBg,     'important');
      card.style.setProperty('border-left',      '3px solid ' + (isRed ? CC.dismissBorder  : CC.prevDismissedBorder), 'important');
      card.style.setProperty('box-sizing',        'border-box', 'important');
    }
    card.style.position = 'relative';
    const days = daysSince(entry.date);
    const label = '\u2716 dismissed' + (days !== null ? ' ' + days + 'd ago' : '');
    addBadge(card, label, isRed ? CC.dismissBadge : CC.prevDismissedBadge);
  }

  function applyDismissLog() {
    for (const card of getCards()) {
      if (card.dataset.ljfDismissLog) continue;
      const entry = matchDismissLog(card);
      if (entry) actDismissLog(card, entry);
    }
  }

  function markDismissed(card) {
    card.style.setProperty('background-color', CC.dismissedBg, 'important');
    card.style.setProperty('border-left', '3px solid ' + CC.dismissedBorder, 'important');
    card.style.setProperty('box-sizing', 'border-box', 'important');
    card.querySelectorAll('.ljf-badge').forEach(b => b.remove());
    card.style.position = 'relative';
    addBadge(card, '\u2716 dismissed', CC.dismissedBadge);
    card.style.display = hideRecentlyApplied ? 'none' : '';
  }

  function dismissJobLog() {
    let dismissed = 0;
    for (const card of getCards()) {
      const entry = matchJobLog(card);
      if (entry && !isDismissed(card)) {
        const btn = card.querySelector(DISMISS_SEL);
        if (btn) {
          logDismissal(card);
          card.dataset.ljfDismissed = '1';
          btn.click();
          markDismissed(card);
          dismissed++;
          updateTabCount();
        }
      }
    }
    return dismissed;
  }

  function dismissDismissLog() {
    let dismissed = 0;
    for (const card of getCards()) {
      if (card.dataset.ljfDismissLog && !isDismissed(card)) {
        const btn = card.querySelector(DISMISS_SEL);
        if (btn) {
          card.dataset.ljfDismissed = '1';
          btn.click();
          markDismissed(card);
          dismissed++;
          updateTabCount();
        }
      }
    }
    return dismissed;
  }

  function dismissRule(rule) {
    const matcher = RULE_TYPES[rule.type]?.match;
    if (!matcher) return 0;
    let dismissed = 0;
    for (const card of getCards()) {
      if (matcher(card, rule) && !isDismissed(card)) {
        const btn = card.querySelector(DISMISS_SEL);
        if (btn) {
          logDismissal(card);
          card.dataset.ljfDismissed = '1';
          btn.click();
          markDismissed(card);
          dismissed++;
          updateTabCount();
        }
      }
    }
    return dismissed;
  }

  // ─── View page hero highlighting ─────────────────────────────────────────────

  function getViewHero() {
    const banner = document.querySelector('[componentkey^="JobDetails_ManageJobBanner_"]');
    return banner ? banner.nextElementSibling : null;
  }

  function addViewBadge(hero, text, bg) {
    const n = hero.querySelectorAll('.ljf-badge').length;
    const badge = document.createElement('span');
    badge.className = 'ljf-badge';
    badge.textContent = text;
    badge.style.cssText = [
      'position:absolute', `top:${52 + n * 20}px`, 'right:20px',
      `background:${bg}`, 'color:#fff',
      'font-size:10px', 'padding:2px 7px', 'border-radius:3px',
      'pointer-events:none', 'z-index:2',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif', 'line-height:1.4',
    ].join(';');
    hero.appendChild(badge);
  }

  function matchViewRule(rule, company, title, salaries) {
    switch (rule.type) {
      case 'companydismiss': case 'companyhi':
        return company.toLowerCase().includes(rule.value.toLowerCase());
      case 'titledismiss': case 'titlehi': {
        const normT = normalizeSenior(title);
        const normV = normalizeSenior(rule.value);
        return normT.toLowerCase().includes(normV.toLowerCase());
      }
      case 'salarybelow': case 'topsalarybelow': case 'salaryabove': case 'topsalaryabove': {
        const threshold = parseFloat(rule.value) * 1000;
        if (isNaN(threshold)) return false;
        if (salaries.length === 0) return false;
        if (rule.type === 'salarybelow')    return Math.min(...salaries) < threshold;
        if (rule.type === 'topsalarybelow') return Math.max(...salaries) < threshold;
        if (rule.type === 'salaryabove')    return Math.min(...salaries) >= threshold;
        if (rule.type === 'topsalaryabove') return Math.max(...salaries) >= threshold;
        return false;
      }
      default: return false;
    }
  }

  function applyViewHeroRules() {
    if (!/\/jobs\/view\/\d+/.test(window.location.pathname)) return;
    const hero = getViewHero();
    if (!hero) return;
    if (hero.dataset.ljfViewProcessed) return; // already done this render cycle

    hero.querySelectorAll('.ljf-badge').forEach(b => b.remove());
    hero.style.removeProperty('background-color');
    hero.style.removeProperty('border-left');
    hero.style.removeProperty('box-sizing');
    delete hero.dataset.ljfHero;

    const parts    = document.title.split(' | ');
    const title    = (parts[0] || '').trim();
    const company  = (parts[1] || '').trim();
    if (!title && !company) return;

    const salaries = parseViewPageSalaries(hero);

    const dismissMatches   = [];
    const highlightMatches = [];
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const typeDef = RULE_TYPES[rule.type];
      if (!typeDef) continue;
      if (matchViewRule(rule, company, title, salaries)) {
        if (typeDef.highlight) highlightMatches.push(rule);
        else                   dismissMatches.push(rule);
      }
    }

    // Salary-pair deduplication (mirrors applyCardRules)
    let shownHighlight = highlightMatches;
    let shownDismiss   = dismissMatches;
    if (highlightMatches.some(r => r.type === 'salaryabove') && highlightMatches.some(r => r.type === 'topsalaryabove'))
      shownHighlight = highlightMatches.filter(r => r.type !== 'topsalaryabove');
    if (dismissMatches.some(r => r.type === 'salarybelow') && dismissMatches.some(r => r.type === 'topsalarybelow'))
      shownDismiss = dismissMatches.filter(r => r.type !== 'salarybelow');

    // Job log — exact match
    const normTitle = normalizeSenior(title).toLowerCase();
    const logEntry = jobLogEnabled ? (appliedLog.find(e =>
      logCompanyMatches(company.toLowerCase(), e.company) &&
      e.title && normTitle.includes(normalizeSenior(e.title).toLowerCase())
    ) || null) : null;

    // Job log — company-only match
    const logCompanyDate = (!logEntry && jobLogEnabled) ? (() => {
      const entries = appliedLog.filter(e => logCompanyMatches(company.toLowerCase(), e.company));
      if (!entries.length) return null;
      const dates = entries.map(e => e.date || '').filter(Boolean).sort();
      return dates.length ? dates[dates.length - 1] : '';
    })() : null;

    if (!shownDismiss.length && !shownHighlight.length && !logEntry && logCompanyDate === null) return;

    hero.style.position = 'relative';
    let dismissed = false;

    // Tint: dismiss > highlight; log exact and recent-company handled below
    if (shownDismiss.length) {
      hero.style.setProperty('background-color', CC.dismissBg, 'important');
      hero.style.setProperty('border-left', '3px solid ' + CC.dismissBorder, 'important');
      hero.style.setProperty('box-sizing', 'border-box', 'important');
      hero.dataset.ljfHero = 'dismiss';
      dismissed = true;
    } else if (shownHighlight.length) {
      hero.style.setProperty('background-color', CC.highlightBg, 'important');
      hero.style.setProperty('border-left', '3px solid ' + CC.highlightBorder, 'important');
      hero.style.setProperty('box-sizing', 'border-box', 'important');
      hero.dataset.ljfHero = 'highlight';
    }

    // Rule badges
    for (const rule of shownDismiss)   addViewBadge(hero, '\u26F3 ' + rule.label, CC.dismissBadge);
    for (const rule of shownHighlight) addViewBadge(hero, '\u2605 ' + rule.label, CC.highlightBadge);

    // Job log — exact match badge + tint
    if (logEntry) {
      addViewBadge(hero, 'Applied' + (logEntry.date ? ' on ' + logEntry.date : ''), CC.dismissBadge);
      if (!dismissed) {
        hero.style.setProperty('background-color', CC.dismissBg, 'important');
        hero.style.setProperty('border-left', '3px solid ' + CC.dismissBorder, 'important');
        hero.style.setProperty('box-sizing', 'border-box', 'important');
        hero.dataset.ljfHero = 'dismiss';
      }
    } else if (logCompanyDate !== null) {
      // Company-only badge (mirrors actJobLogCompanyLabel)
      const days = daysSince(logCompanyDate);
      const reapplyOk = days !== null && days >= reapplyDays;
      const isRecent  = days !== null && days < reapplyDays;
      const badge = document.createElement('span');
      badge.className = 'ljf-badge';
      const bCount = hero.querySelectorAll('.ljf-badge').length;
      badge.style.cssText = [
        'position:absolute', `top:${52 + bCount * 20}px`, 'right:20px',
        `background:${isRecent ? CC.recentBadge : CC.staleBadge}`, 'color:#fff',
        'font-size:10px', 'padding:2px 7px', 'border-radius:3px',
        'pointer-events:none', 'z-index:2',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif', 'line-height:1.4',
        'display:inline-flex', 'align-items:center', 'gap:4px',
      ].join(';');
      badge.appendChild(document.createTextNode(
        'Last applied' + (logCompanyDate ? ' ' + logCompanyDate : '') +
        (days !== null ? ' | ' + String(days) + ' days ago' : '')
      ));
      if (days !== null) {
        const icon = document.createElement('span');
        icon.textContent = reapplyOk ? '\u2714' : '\u2716';
        icon.style.cssText = 'font-size:11px;font-weight:900;line-height:1;';
        icon.style.setProperty('color', reapplyOk ? '#4ade80' : '#f87171', 'important');
        badge.appendChild(icon);
      }
      hero.appendChild(badge);
      // Yellow tint for recent company match overrides green, not red
      if (isRecent && !dismissed) {
        hero.style.setProperty('background-color', CC.recentBg, 'important');
        hero.style.setProperty('border-left', '3px solid ' + CC.recentBorder, 'important');
        hero.style.setProperty('box-sizing', 'border-box', 'important');
      }
    }

    hero.dataset.ljfViewProcessed = '1';
  }

  // ─── Saved-jobs page highlighting ────────────────────────────────────────────

  function applySavedJobRules() {
    if (!/\/my-items\/saved-jobs/.test(window.location.pathname)) return;

    for (const card of document.querySelectorAll(SAVED_CARD_SEL)) {
      if (card.dataset.ljfSavedApplied) continue;

      const titleEl   = card.querySelector(SAVED_TITLE_SEL);
      const companyEl = card.querySelector(SAVED_COMPANY_SEL);
      const title     = titleEl   ? titleEl.textContent.trim()   : '';
      const company   = companyEl ? companyEl.textContent.trim() : '';
      if (!title && !company) continue;

      const salaries = parseSalaries(card);

      const dismissMatches   = [];
      const highlightMatches = [];
      for (const rule of rules) {
        if (!rule.enabled) continue;
        const typeDef = RULE_TYPES[rule.type];
        if (!typeDef) continue;
        if (matchViewRule(rule, company, title, salaries)) {
          if (typeDef.highlight) highlightMatches.push(rule);
          else                   dismissMatches.push(rule);
        }
      }

      // Salary-pair deduplication (mirrors applyCardRules)
      let shownHighlight = highlightMatches;
      let shownDismiss   = dismissMatches;
      if (highlightMatches.some(r => r.type === 'salaryabove') && highlightMatches.some(r => r.type === 'topsalaryabove'))
        shownHighlight = highlightMatches.filter(r => r.type !== 'topsalaryabove');
      if (dismissMatches.some(r => r.type === 'salarybelow') && dismissMatches.some(r => r.type === 'topsalarybelow'))
        shownDismiss = dismissMatches.filter(r => r.type !== 'salarybelow');

      // Job log — exact match
      const normTitle = normalizeSenior(title).toLowerCase();
      const logEntry = jobLogEnabled ? (appliedLog.find(e =>
        logCompanyMatches(company.toLowerCase(), e.company) &&
        e.title && normTitle.includes(normalizeSenior(e.title).toLowerCase())
      ) || null) : null;

      // Job log — company-only match
      const logCompanyDate = (!logEntry && jobLogEnabled) ? (() => {
        const entries = appliedLog.filter(e => logCompanyMatches(company.toLowerCase(), e.company));
        if (!entries.length) return null;
        const dates = entries.map(e => e.date || '').filter(Boolean).sort();
        return dates.length ? dates[dates.length - 1] : '';
      })() : null;

      if (!shownDismiss.length && !shownHighlight.length && !logEntry && logCompanyDate === null) {
        card.dataset.ljfSavedApplied = '1';
        continue;
      }

      card.style.position = 'relative';
      let wasDismissed = false;

      if (shownDismiss.length) {
        card.style.setProperty('background-color', CC.dismissBg, 'important');
        card.style.setProperty('border-left', '3px solid ' + CC.dismissBorder, 'important');
        card.style.setProperty('box-sizing', 'border-box', 'important');
        wasDismissed = true;
      } else if (shownHighlight.length) {
        card.style.setProperty('background-color', CC.highlightBg, 'important');
        card.style.setProperty('border-left', '3px solid ' + CC.highlightBorder, 'important');
        card.style.setProperty('box-sizing', 'border-box', 'important');
      }

      for (const rule of shownDismiss)   addViewBadge(card, '\u26F3 ' + rule.label, CC.dismissBadge);
      for (const rule of shownHighlight) addViewBadge(card, '\u2605 ' + rule.label, CC.highlightBadge);

      if (logEntry) {
        addViewBadge(card, 'Applied' + (logEntry.date ? ' on ' + logEntry.date : ''), CC.dismissBadge);
        if (!wasDismissed) {
          card.style.setProperty('background-color', CC.dismissBg, 'important');
          card.style.setProperty('border-left', '3px solid ' + CC.dismissBorder, 'important');
          card.style.setProperty('box-sizing', 'border-box', 'important');
          wasDismissed = true;
        }
      } else if (logCompanyDate !== null) {
        const days      = daysSince(logCompanyDate);
        const reapplyOk = days !== null && days >= reapplyDays;
        const isRecent  = days !== null && days < reapplyDays;
        const badge = document.createElement('span');
        badge.className = 'ljf-badge';
        const bCount = card.querySelectorAll('.ljf-badge').length;
        badge.style.cssText = [
          'position:absolute', `bottom:${6 + bCount * 20}px`, 'right:20px',
          `background:${isRecent ? CC.recentBadge : CC.staleBadge}`, 'color:#fff',
          'font-size:10px', 'padding:2px 7px', 'border-radius:3px',
          'pointer-events:none', 'z-index:2',
          'font-family:-apple-system,BlinkMacSystemFont,sans-serif', 'line-height:1.4',
          'display:inline-flex', 'align-items:center', 'gap:4px',
        ].join(';');
        badge.appendChild(document.createTextNode(
          'Last applied' + (logCompanyDate ? ' ' + logCompanyDate : '') +
          (days !== null ? ' | ' + String(days) + ' days ago' : '')
        ));
        if (days !== null) {
          const icon = document.createElement('span');
          icon.textContent = reapplyOk ? '\u2714' : '\u2716';
          icon.style.cssText = 'font-size:11px;font-weight:900;line-height:1;';
          icon.style.setProperty('color', reapplyOk ? '#4ade80' : '#f87171', 'important');
          badge.appendChild(icon);
        }
        card.appendChild(badge);
        if (isRecent && !wasDismissed) {
          card.style.setProperty('background-color', CC.recentBg, 'important');
          card.style.setProperty('border-left', '3px solid ' + CC.recentBorder, 'important');
          card.style.setProperty('box-sizing', 'border-box', 'important');
        }
      }

      card.dataset.ljfSavedApplied = '1';
    }
  }

  function updateTabCount() {
    const cards   = [...getCards()];
    const pill    = document.getElementById('ljf-tab-dismiss-pill');
    const countEl = document.getElementById('ljf-tab-count');
    const btn     = document.getElementById('ljf-tab-dismiss');
    const greenEl = document.getElementById('ljf-tab-count-green');

    if (pill && countEl) {
      const n = cards.filter(c =>
        !isDismissed(c) && (c.dataset.ljfHighlighted || (c.dataset.ljfJobLog && !c.dataset.ljfJobLogLabel) || c.dataset.ljfDismissLog === 'red')
      ).length;
      if (n > 0) {
        countEl.textContent = n;
        pill.style.display = 'flex';
        if (dismissActionsEnabled) {
          // vertical capsule: count on top, X circle below
          pill.style.borderRadius = '10px';
          pill.style.padding = '4px 1px 1px';
          pill.style.width = '20px';
          pill.style.height = '';
          if (btn) btn.style.display = 'flex';
        } else {
          // circle: count only, no X
          pill.style.borderRadius = '50%';
          pill.style.padding = '0';
          pill.style.width = '20px';
          pill.style.height = '20px';
          if (btn) btn.style.display = 'none';
        }
      } else {
        pill.style.display = 'none';
      }
    }

    if (greenEl) {
      const n = cards.filter(c => c.dataset.ljfGreenMatch && !isDismissed(c)).length;
      greenEl.textContent = n > 0 ? n : '';
      greenEl.style.display = n > 0 ? 'flex' : 'none';
    }

    const yellowPill    = document.getElementById('ljf-tab-yellow-pill');
    const yellowCountEl = document.getElementById('ljf-tab-count-yellow');
    const eyeBtn        = document.getElementById('ljf-tab-hide-recent');
    if (yellowPill && yellowCountEl) {
      const n = cards.filter(c =>
        !isDismissed(c) && ((c.dataset.ljfJobLog && c.dataset.ljfJobLogLabel) || c.dataset.ljfDismissLog === 'grey')
      ).length;
      if (n > 0) {
        yellowCountEl.textContent = n;
        yellowPill.style.display = 'flex';
        if (eyeBtn) eyeBtn.textContent = hideRecentlyApplied ? '\u25cf' : '\u25cb';
      } else {
        yellowPill.style.display = 'none';
      }
    }
  }

  function clearHighlights() {
    for (const card of getCards()) {
      card.style.removeProperty('background-color');
      card.style.removeProperty('border-left');
      card.style.removeProperty('box-sizing');
      card.style.removeProperty('display');
      delete card.dataset.ljfHighlighted;
      delete card.dataset.ljfDismissed;
      delete card.dataset.ljfGreenMatch;
      delete card.dataset.ljfRulesApplied;
      delete card.dataset.ljfDismissLog;
      card.querySelectorAll('.ljf-badge').forEach(b => b.remove());
      delete card.dataset.ljfJobLog;
      delete card.dataset.ljfJobLogLabel;
    }
    const hero = getViewHero();
    if (hero) {
      hero.querySelectorAll('.ljf-badge').forEach(b => b.remove());
      hero.style.removeProperty('background-color');
      hero.style.removeProperty('border-left');
      hero.style.removeProperty('box-sizing');
      delete hero.dataset.ljfHero;
      delete hero.dataset.ljfViewProcessed;
    }
    for (const card of document.querySelectorAll(SAVED_CARD_SEL)) {
      card.querySelectorAll('.ljf-badge').forEach(b => b.remove());
      card.style.removeProperty('background-color');
      card.style.removeProperty('border-left');
      card.style.removeProperty('box-sizing');
      delete card.dataset.ljfSavedApplied;
    }
    updateTabCount();
  }

  // Clears ljfDismissed on any card we marked as dismissed but LinkedIn has since restored.
  // Detected by: undo button gone AND dismiss button back — meaning LinkedIn processed the undo.
  function reconcileDismissedCards() {
    for (const card of getCards()) {
      if (card.dataset.ljfDismissed) {
        // If LinkedIn's own dismissed class is present the card is still dismissed — the undo
        // button shares the job-card-container__action class with DISMISS_SEL, so hasDismiss
        // would be true even on a freshly-dismissed card. Skip it.
        if (card.querySelector('.job-card-list--is-dismissed')) continue;
        const hasUndo    = !!card.querySelector(UNDO_SEL);
        const hasDismiss = !!card.querySelector(DISMISS_SEL);
        if (hasDismiss && !hasUndo) {
          // Card was undismissed — DOM is restored here so selectors work.
          undoLogDismissal(card);
          delete card.dataset.ljfDismissed;
          delete card.dataset.ljfRulesApplied;
          delete card.dataset.ljfJobLog;
          delete card.dataset.ljfJobLogLabel;
          delete card.dataset.ljfDismissLog;
          card.style.removeProperty('background-color');
          card.style.removeProperty('border-left');
          card.style.removeProperty('box-sizing');
          card.querySelectorAll('.ljf-badge').forEach(b => b.remove());
        }
      }
    }
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────────

  // Detect dismissals that bypassed click capture (e.g. "Not interested" overflow menu).
  // LinkedIn adds .job-card-list--is-dismissed to an inner element when a card is dismissed.
  // We check added nodes in each mutation batch so we catch it before the card text is gone.
  function captureBypassedDismissals(mutations) {
    for (const mut of mutations) {
      if (mut.type === 'childList') {
        for (const node of mut.addedNodes) {
          if (node.nodeType !== 1) continue;
          const targets = node.classList?.contains('job-card-list--is-dismissed')
            ? [node]
            : [...node.querySelectorAll('.job-card-list--is-dismissed')];
          for (const el of targets) {
            const card = el.closest(CARD_SEL) || (el.matches && el.matches(CARD_SEL) ? el : null);
            if (!card || card.dataset.ljfDismissed) continue;
            logDismissal(card);
            card.dataset.ljfDismissed = '1';
            updateTabCount();
          }
        }
      } else if (mut.type === 'attributes') {
        // LinkedIn may add .job-card-list--is-dismissed via classList.add (attribute mutation)
        const el = mut.target;
        if (el.nodeType !== 1 || !el.classList?.contains('job-card-list--is-dismissed')) continue;
        const card = el.closest(CARD_SEL) || (el.matches && el.matches(CARD_SEL) ? el : null);
        if (!card || card.dataset.ljfDismissed) continue;
        logDismissal(card);
        card.dataset.ljfDismissed = '1';
        updateTabCount();
      }
    }
  }

  let scanTimeout = null;
  const observer = new MutationObserver(mutations => {
    captureBypassedDismissals(mutations);
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => { reconcileDismissedCards(); applyAllRules(); }, 700);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  // ─── UI ───────────────────────────────────────────────────────────────────────

  function buildUI() {
    const tab = document.createElement('div');
    tab.id = 'ljf-tab';
    tab.title = 'LinkedIn Job Filter';
    tab.innerHTML =
      '<span id="ljf-tab-flag" style="font-size:15px;line-height:1;">&#9873;</span>' +
      '<div id="ljf-tab-dismiss-pill" title="Dismiss All" style="' +
        'display:none;flex-direction:column;align-items:center;justify-content:center;' +
        'background:#b41e1e;color:#fff;gap:3px;cursor:default;' +
        'border-radius:10px;padding:4px 1px 2px 1px;width:20px;box-sizing:border-box;' +
      '">' +
        '<span id="ljf-tab-count" style="font-size:10px;font-weight:700;line-height:1;"></span>' +
        '<button id="ljf-tab-dismiss" title="Dismiss All" style="' +
          'background:#ecc0c0 !important;border:none !important;border-radius:50% !important;' +
          'width:16px !important;height:16px !important;min-width:16px !important;max-width:16px !important;color:#8b0e0e !important;cursor:pointer;' +
          'font-size:9px !important;font-weight:700;line-height:1;padding:0 !important;box-sizing:border-box !important;' +
          'display:flex;align-items:center;justify-content:center;' +
        '">&#10005;</button>' +
      '</div>' +
      '<span id="ljf-tab-count-green" title="Highlighted cards" style="' +
        'display:none;align-items:center;justify-content:center;' +
        'background:#1a8c1a;color:#fff;border-radius:50%;' +
        'width:20px;height:20px;min-width:20px;' +
        'font-size:10px;font-weight:700;line-height:1;' +
      '"></span>' +
      '<div id="ljf-tab-yellow-pill" title="Recently applied companies" style="' +
        'display:none;flex-direction:column;align-items:center;justify-content:center;' +
        'background:#8a7000;color:#fff;gap:3px;cursor:default;' +
        'border-radius:10px;padding:4px 1px 2px 1px;width:20px;box-sizing:border-box;' +
      '">' +
        '<span id="ljf-tab-count-yellow" style="font-size:10px;font-weight:700;line-height:1;"></span>' +
        '<button id="ljf-tab-hide-recent" title="Toggle recently applied visibility" style="' +
          'background:#f5e07a !important;border:none !important;border-radius:50% !important;' +
          'width:16px !important;height:16px !important;min-width:16px !important;max-width:16px !important;color:#5a4800 !important;cursor:pointer;' +
          'font-size:9px !important;font-weight:700;line-height:1;padding:0 !important;box-sizing:border-box !important;' +
          'display:flex;align-items:center;justify-content:center;' +
        '">\u25cb</button>' +
      '</div>';
    tab.style.cssText = [
      'position:fixed', 'right:0', 'top:50%',
      'transform:translateY(-50%)',
      'width:26px', 'min-height:54px',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center', 'gap:3px',
      'padding:8px 0',
      'cursor:pointer',
      'border:none',
      'border-radius:10px 0 0 10px',
      'z-index:99999',
      'box-shadow:-2px 2px 8px rgba(0,0,0,.35)',
      'user-select:none',
      'transition:right .2s ease',
    ].join(';');

    const panel = document.createElement('div');
    panel.id = 'ljf-panel';
    panel.style.cssText = [
      'position:fixed', 'right:0', 'top:0', 'bottom:0',
      'width:' + panelWidthPx(),
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:13px',
      'box-shadow:-4px 0 24px rgba(0,0,0,.55)',
      'z-index:99998',
      'display:none',
      'flex-direction:column',
      'box-sizing:border-box',
      'height:100vh',
      'max-height:100vh',
      'overflow:hidden',
    ].join(';');

    document.body.appendChild(tab);
    document.body.appendChild(panel);

    // ── Tab events (static, never rebuilt) ───────────────────────────────────

    tab.addEventListener('click', () => {
      panelOpen = !panelOpen;
      panel.style.display = panelOpen ? 'flex' : 'none';
      panel.style.width = panelWidthPx();
      tab.style.right = panelOpen ? panelWidthPx() : '0';
      if (panelOpen && activePanel === 'rules') renderRules();
      if (panelOpen && activePanel === 'jobs')  renderJobsPane();
    });

    document.getElementById('ljf-tab-dismiss').addEventListener('click', e => {
      e.stopPropagation();
      let dismissed = 0;
      for (const rule of rules) {
        if (!RULE_TYPES[rule.type]?.highlight) dismissed += dismissRule(rule);
      }
      if (jobLogEnabled) dismissed += dismissJobLog();
      dismissed += dismissDismissLog();
      updateTabCount();
      setStatus('\u2014 ' + dismissed + ' card(s) dismissed.');
    });

    document.getElementById('ljf-tab-hide-recent').addEventListener('click', e => {
      e.stopPropagation();
      hideRecentlyApplied = !hideRecentlyApplied;
      GM_setValue('ljf_hideRecentlyApplied', hideRecentlyApplied ? 'true' : 'false');
      applyRecentlyAppliedVisibility();
      updateTabCount();
    });

    buildPanelContent();
  }

  function buildPanelDOM(panel) {
    function mk(tag, id, cls) {
      const el = document.createElement(tag);
      if (id)  el.id        = id;
      if (cls) el.className = cls;
      return el;
    }

    // Header
    const header = mk('div', 'ljf-header', 'ljf-header');
    const titleEl = mk('strong');
    titleEl.textContent = 'LinkedIn Job Filter';
    header.appendChild(titleEl);
    const headerBtns = mk('div', null, 'ljf-header-btns');
    const helpBtn = mk('button', 'ljf-help', 'ljf-help');
    helpBtn.title = 'Help / About'; helpBtn.textContent = '?';
    headerBtns.appendChild(helpBtn);
    const gearBtn = mk('button', 'ljf-gear', 'ljf-gear');
    gearBtn.title = 'Settings'; gearBtn.textContent = '⚙';
    headerBtns.appendChild(gearBtn);
    header.appendChild(headerBtns);
    panel.appendChild(header);

    // Tab bar
    const tabBar = mk('div', 'ljf-tab-bar', 'ljf-tab-bar');
    for (const p of ['rules', 'jobs']) {
      const btn = mk('button', 'ljf-pane-btn-' + p, 'ljf-tab-btn' + (activePanel === p ? ' ljf-active' : ''));
      btn.textContent = p.charAt(0).toUpperCase() + p.slice(1);
      tabBar.appendChild(btn);
    }
    panel.appendChild(tabBar);

    // Rules pane
    const rulesPane = mk('div', 'ljf-pane-rules', 'ljf-pane' + (activePanel === 'rules' ? ' ljf-active' : ''));

    if (dismissActionsEnabled) {
      const actionBar = mk('div', null, 'ljf-action-bar');
      const runAllBtn = mk('button', 'ljf-run-all', 'ljf-action-btn');
      runAllBtn.textContent = '✕ Dismiss All';
      actionBar.appendChild(runAllBtn);
      rulesPane.appendChild(actionBar);
    }

    rulesPane.appendChild(mk('div', 'ljf-rules-list', 'ljf-rules-list'));

    const addForm = mk('div', 'ljf-add-form', 'ljf-add-form');
    const addFormTitle = mk('div', 'ljf-add-form-title', 'ljf-form-label');
    addFormTitle.textContent = 'Add Rule';
    addForm.appendChild(addFormTitle);

    const typeSel = mk('select', 'ljf-type-sel', 'ljf-form-control');
    for (const k of DROPDOWN_TYPES) {
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = RULE_TYPES[k].label;
      typeSel.appendChild(opt);
    }
    addForm.appendChild(typeSel);

    const valueInput = mk('input', 'ljf-value-input', 'ljf-form-control');
    valueInput.type = 'text'; valueInput.placeholder = 'Value  (e.g. Ethos, 100, Sales...)';
    addForm.appendChild(valueInput);

    const labelInput = mk('input', 'ljf-label-input', 'ljf-form-control ljf-mb8');
    labelInput.type = 'text'; labelInput.placeholder = 'Label  (optional)';
    addForm.appendChild(labelInput);

    const addBtn = mk('button', 'ljf-add-btn', 'ljf-add-btn');
    addBtn.textContent = '+ Add Rule';
    addForm.appendChild(addBtn);
    rulesPane.appendChild(addForm);

    if (dismissActionsEnabled) {
      const QD_LABELS = { company: 'Company', title: 'Title Keywords', location: 'Location Keywords' };
      const QD_PH     = { company: 'Company name', title: 'Title keyword', location: 'Location keyword' };
      const quickBar  = mk('div', null, 'ljf-quick-bar');
      const qdLabel   = mk('div', 'ljf-qdmode-label', 'ljf-form-label ljf-qdmode-label');
      qdLabel.title = 'Click to cycle mode';
      qdLabel.style.cssText = 'cursor:pointer;user-select:none';
      qdLabel.appendChild(document.createTextNode('Quick Dismiss ('));
      const qdText = mk('span', 'ljf-qdmode-text');
      qdText.textContent = QD_LABELS[quickDismissMode];
      qdLabel.appendChild(qdText);
      qdLabel.appendChild(document.createTextNode(')'));
      quickBar.appendChild(qdLabel);
      const quickRow = mk('div', null, 'ljf-quick-row');
      const quickInput = mk('input', 'ljf-quick-value', 'ljf-quick-input');
      quickInput.type = 'text'; quickInput.placeholder = QD_PH[quickDismissMode];
      quickRow.appendChild(quickInput);
      const qdBtn = mk('button', 'ljf-quick-dismiss', 'ljf-quick-btn');
      qdBtn.textContent = 'Dismiss';
      quickRow.appendChild(qdBtn);
      quickBar.appendChild(quickRow);
      rulesPane.appendChild(quickBar);
    }
    panel.appendChild(rulesPane);

    // Jobs pane
    panel.appendChild(mk('div', 'ljf-pane-jobs', 'ljf-pane' + (activePanel === 'jobs' ? ' ljf-active' : '')));

    // Status bar
    const statusBar = mk('div', 'ljf-status', 'ljf-status-bar');
    statusBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
    const statusMsg = mk('span', 'ljf-status-msg');
    statusMsg.textContent = 'Ready';
    statusBar.appendChild(statusMsg);
    const dlCount = mk('span', 'ljf-dismiss-log-count');
    dlCount.style.cssText = 'font-size:10px;opacity:.6;white-space:nowrap;flex-shrink:0;';
    statusBar.appendChild(dlCount);
    panel.appendChild(statusBar);
  }

  function wirePanelEvents() {
    document.getElementById('ljf-run-all')?.addEventListener('click', () => {
      let dismissed = 0;
      for (const rule of rules) dismissed += dismissRule(rule);
      if (jobLogEnabled) dismissed += dismissJobLog();
      dismissed += dismissDismissLog();
      setStatus('\u2014 ' + dismissed + ' card(s) dismissed.');
    });

    const QD_MODE_LABELS = { company: 'Company', title: 'Title Keywords', location: 'Location Keywords' };
    const QD_PLACEHOLDERS = { company: 'Company name', title: 'Title keyword', location: 'Location keyword' };

    document.getElementById('ljf-qdmode-label')?.addEventListener('click', () => {
      const modes = ['company', 'title', 'location'];
      quickDismissMode = modes[(modes.indexOf(quickDismissMode) + 1) % modes.length];
      GM_setValue('ljf_quickDismissMode', quickDismissMode);
      document.getElementById('ljf-qdmode-text').textContent = QD_MODE_LABELS[quickDismissMode];
      document.getElementById('ljf-quick-value').placeholder = QD_PLACEHOLDERS[quickDismissMode];
    });

    document.getElementById('ljf-quick-dismiss')?.addEventListener('click', () => {
      const value = document.getElementById('ljf-quick-value').value.trim();
      if (!value) { setStatus('\u26A0 Enter a value.'); return; }
      let dismissed = 0;
      if (quickDismissMode === 'company') {
        dismissed = dismissRule({ type: 'companydismiss', value, label: 'Quick: ' + value });
      } else if (quickDismissMode === 'title') {
        dismissed = dismissRule({ type: 'titledismiss', value, label: 'Quick: ' + value });
      } else {
        dismissed = dismissRule({ type: 'locationdismiss', value, label: 'Quick: ' + value });
      }
      document.getElementById('ljf-quick-value').value = '';
      setStatus('Quick dismiss: ' + dismissed + ' card(s) dismissed.');
    });

    document.getElementById('ljf-quick-value')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('ljf-quick-dismiss').click();
    });

    document.getElementById('ljf-add-btn').addEventListener('click', handleAddRule);

    ['ljf-value-input', 'ljf-label-input'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') handleAddRule();
        if (e.key === 'Escape') cancelEdit();
      });
    });

    // ── Header bar → collapse panel (same as clicking the tab) ───────────────
    document.getElementById('ljf-header').addEventListener('click', () => {
      const tab = document.getElementById('ljf-tab');
      const panel = document.getElementById('ljf-panel');
      panelOpen = false;
      panel.style.display = 'none';
      tab.style.right = '0';
    });

    // ── Tab bar → switch panes ────────────────────────────────────────────────
    ['rules', 'jobs'].forEach(pane => {
      document.getElementById('ljf-pane-btn-' + pane)?.addEventListener('click', () => {
        activePanel = pane;
        GM_setValue('ljf_activePanel', pane);
        const panel = document.getElementById('ljf-panel');
        const tab   = document.getElementById('ljf-tab');
        panel.style.width = panelWidthPx();
        if (panelOpen && tab) tab.style.right = panelWidthPx();
        ['rules', 'jobs'].forEach(p => {
          document.getElementById('ljf-pane-' + p)?.classList.toggle('ljf-active', p === pane);
          document.getElementById('ljf-pane-btn-' + p)?.classList.toggle('ljf-active', p === pane);
        });
        if (pane === 'rules') renderRules();
        if (pane === 'jobs')  renderJobsPane();
      });
    });

    // ── Help button → onboarding modal ───────────────────────────────────────
    document.getElementById('ljf-help').addEventListener('click', e => {
      e.stopPropagation();
      openOnboardingModal();
    });

    // ── Gear button → settings modal ──────────────────────────────────────────
    document.getElementById('ljf-gear').addEventListener('click', e => {
      e.stopPropagation();
      openSettingsModal();
    });

    document.getElementById('ljf-type-sel').addEventListener('change', () => {
      if (editingRuleId !== null) {
        const sel = document.getElementById('ljf-type-sel');
        if (sel.value !== editingOrigType) {
          editingRuleId   = null;
          editingOrigType = null;
          document.getElementById('ljf-value-input').value = '';
          document.getElementById('ljf-label-input').value = '';
          document.getElementById('ljf-add-btn').textContent = '+ Add Rule';
          document.getElementById('ljf-add-form-title').textContent = 'Add Rule';
        }
      }
      updateDropdownBlockedOptions();
      updateLabelVisibility();
    });

    // ── Jobs tab — company hover popover ─────────────────────────────────────
    const oldJcp = document.getElementById('ljf-jcp');
    if (oldJcp) oldJcp.remove();
    const jcp = document.createElement('div');
    jcp.id = 'ljf-jcp';
    document.getElementById('ljf-panel').appendChild(jcp);

    let jcpHide = null;

    function showCompanyPopover(cell) {
      clearTimeout(jcpHide);
      const company = cell.dataset.company;
      if (!company) return;
      const entries = appliedLog.filter(e => e.company && e.company.toLowerCase() === company.toLowerCase());
      if (!entries.length) return;

      const titles   = [...new Set(entries.map(e => e.title).filter(Boolean))];
      const lastDate = entries.map(e => e.date || '').filter(Boolean).sort().at(-1) || '';
      const hasHiRule = rules.some(r => r.type === 'companyhi' && r.value.toLowerCase() === company.toLowerCase());

      while (jcp.firstChild) jcp.removeChild(jcp.firstChild);
      const jcpCo = document.createElement('div');
      jcpCo.className = 'ljf-jcp-company'; jcpCo.textContent = company;
      jcp.appendChild(jcpCo);
      const jcpUl = document.createElement('ul');
      jcpUl.className = 'ljf-jcp-titles';
      for (const ti of titles) {
        const li = document.createElement('li');
        li.className = 'ljf-jcp-title'; li.textContent = ti;
        jcpUl.appendChild(li);
      }
      jcp.appendChild(jcpUl);
      if (lastDate) {
        const jcpMeta = document.createElement('div');
        jcpMeta.className = 'ljf-jcp-meta';
        jcpMeta.textContent = 'Last applied: ' + lastDate;
        jcp.appendChild(jcpMeta);
      }
      const jcpHiBtn = document.createElement('button');
      jcpHiBtn.className = 'ljf-jcp-hi-btn';
      if (hasHiRule) { jcpHiBtn.textContent = '\u2713 Highlight rule exists'; jcpHiBtn.disabled = true; }
      else { jcpHiBtn.textContent = '+ Add highlight rule'; }
      jcp.appendChild(jcpHiBtn);

      jcp.querySelector('.ljf-jcp-hi-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        jcp.style.display = 'none';
        if (rules.some(r => r.type === 'companyhi' && r.value.toLowerCase() === company.toLowerCase())) {
          setStatus('\u26A0 Highlight rule already exists for: ' + company);
          return;
        }
        addRule('companyhi', company, 'Company to Highlight: ' + company);
        clearHighlights();
        applyAllRules();
        if (panelOpen) renderRules();
        setStatus('Highlight rule added for ' + company);
      });

      jcp.style.display = 'block';
      requestAnimationFrame(() => {
        const rect = cell.getBoundingClientRect();
        const pw = jcp.offsetWidth, ph = jcp.offsetHeight;
        let left = rect.left;
        let top  = rect.bottom + 4;
        if (left + pw > window.innerWidth - 8)  left = window.innerWidth  - pw - 8;
        if (top  + ph > window.innerHeight - 8) top  = rect.top - ph - 4;
        jcp.style.left = Math.max(4, left) + 'px';
        jcp.style.top  = Math.max(4, top)  + 'px';
      });
    }

    jcp.addEventListener('mouseenter', () => clearTimeout(jcpHide));
    jcp.addEventListener('mouseleave', () => { jcpHide = setTimeout(() => { jcp.style.display = 'none'; }, 200); });

    const jobsPane = document.getElementById('ljf-pane-jobs');
    if (jobsPane) {
      jobsPane.addEventListener('mouseover', e => {
        const cell = e.target.closest('.ljf-co-cell');
        if (cell) showCompanyPopover(cell);
      });
      jobsPane.addEventListener('mouseout', e => {
        if (e.target.closest('.ljf-co-cell')) {
          jcpHide = setTimeout(() => { jcp.style.display = 'none'; }, 200);
        }
      });
    }
  }

  function updateTabTheme() {
    const tab  = document.getElementById('ljf-tab');
    const flag = document.getElementById('ljf-tab-flag');
    if (!tab) return;
    const th = t();
    tab.style.background = th.tabBg;
    tab.style.boxShadow  = darkMode
      ? '-2px 2px 8px rgba(0,0,0,.7)'
      : '-2px 2px 8px rgba(0,0,0,.18)';
    if (flag) flag.style.color = th.tabAccent;
  }

  function buildPanelContent() {
    const panel = document.getElementById('ljf-panel');
    if (!panel) return;
    const th = t();
    buildPanelStyles();
    panel.style.background = th.panelBg;
    panel.style.color = th.panelText;
    panel.style.width = panelWidthPx();
    if (panelOpen) {
      const tab = document.getElementById('ljf-tab');
      if (tab) tab.style.right = panelWidthPx();
    }
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    buildPanelDOM(panel);
    setPanelVars();
    wirePanelEvents();
    updateTabTheme();
    if (panelOpen && activePanel === 'rules') renderRules();
    if (panelOpen && activePanel === 'jobs')  renderJobsPane();
  }

  function toggleDarkMode() {
    editingRuleId   = null;
    editingOrigType = null;
    darkMode = !darkMode;
    GM_setValue('ljf_darkMode', darkMode ? 'dark' : 'light');
    buildPanelContent();
  }

  // ─── Onboarding modal ────────────────────────────────────────────────────────

  function openOnboardingModal() {
    if (document.getElementById('ljf-onboard-modal')) return;
    const th = t();
    const warnBg  = darkMode ? 'rgba(234,179,8,.12)' : '#fef9c3';
    const warnBdr = darkMode ? 'rgba(234,179,8,.4)'  : '#ca8a04';
    const warnClr = darkMode ? '#fde68a'             : '#7c2d12';

    const overlay = document.createElement('div');
    overlay.id = 'ljf-onboard-modal';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:100003',
      'background:rgba(0,0,0,.65)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');

    const modal = document.createElement('div');
    modal.style.cssText = [
      `background:${th.panelBg}`, `color:${th.panelText}`,
      `border:1px solid ${th.border1}`, 'border-radius:8px',
      'max-width:420px', 'width:92%', 'max-height:85vh',
      'display:flex', 'flex-direction:column',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'box-shadow:0 8px 32px rgba(0,0,0,.6)',
    ].join(';');

    const s = (size, color, extra = '') =>
      `font-size:${size}px;color:${color};${extra}`;

    // TODO (2026-04-12): QA and revise all onboarding copy below
    modal.innerHTML = `
<div style="padding:18px 20px 14px;flex-shrink:0;border-bottom:1px solid ${th.border1};">
  <div style="${s(15, th.panelText, 'font-weight:700;margin-bottom:3px;')}">Welcome to LinkedIn Job Filter</div>
  <div style="${s(11, th.countText)}">A quick overview — you can re-open this any time with the <strong>?</strong> button.</div>
</div>

<div style="overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:14px;">

  <div>
    <div style="${s(11, th.labelText, 'font-weight:700;margin-bottom:4px;')}">What it does</div>
    <div style="${s(12, th.panelText, 'line-height:1.5;')}">This script runs in your browser on LinkedIn job search pages. It scans job cards and highlights or hides them based on rules you define — so you stop wading through roles you've already dismissed or aren't interested in.</div>
  </div>

  <div>
    <div style="${s(11, th.labelText, 'font-weight:700;margin-bottom:4px;')}">✦ Highlight rules</div>
    <div style="${s(12, th.panelText, 'line-height:1.5;')}">Add company or title rules to make matching cards stand out in <strong>green</strong>. Add them in the Rules tab, or hover a job card's dismiss button for a quick-add menu that lets you create a rule straight from the card.</div>
  </div>

  <div>
    <div style="${s(11, th.labelText, 'font-weight:700;margin-bottom:4px;')}">✕ Dismiss rules</div>
    <div style="${s(12, th.panelText, 'line-height:1.5;')}">Mark companies, job titles, or low-salary cards in <strong>red</strong>. With Dismiss Actions enabled, the script can also click LinkedIn's native dismiss button to remove matched cards from your feed — but read the note below first.</div>
  </div>

  <div style="background:${warnBg};border:1px solid ${warnBdr};border-radius:5px;padding:10px 12px;">
    <div style="${s(11, warnClr, 'font-weight:700;margin-bottom:4px;')}">⚠ Dismiss Actions &amp; LinkedIn's Terms of Service</div>
    <div style="${s(11, warnClr, 'line-height:1.5;')}">Automating clicks on LinkedIn's dismiss button is automated interaction with their platform and likely violates the <strong>LinkedIn User Agreement</strong>. This feature is <strong>off by default</strong>. Only enable it if you understand and accept that risk — you're responsible for how you use it.</div>
  </div>

  <div>
    <div style="${s(11, th.labelText, 'font-weight:700;margin-bottom:4px;')}">Job log</div>
    <div style="${s(12, th.panelText, 'line-height:1.5;')}">When you apply to a job — via Easy Apply or an external apply flow — the script logs it automatically. You can also add entries manually in the Jobs tab. Track application status, see every role you've applied to at a given company, and review stats in the footer.</div>
  </div>

  <div>
    <div style="${s(11, th.labelText, 'font-weight:700;margin-bottom:4px;')}">Export &amp; import</div>
    <div style="${s(12, th.panelText, 'line-height:1.5;')}">Back up your rules and job log any time via <strong>Settings → Backup</strong>. A CSV export is also available for the job log if you want to work with your data in a spreadsheet.</div>
  </div>

</div>

<div style="padding:14px 20px;flex-shrink:0;border-top:1px solid ${th.border1};display:flex;justify-content:flex-end;">
  <button id="ljf-onboard-done" style="
    background:#4e7af7;color:#fff;border:none;border-radius:4px;
    padding:8px 18px;cursor:pointer;font-size:13px;font-weight:600;">Got it, let's go</button>
</div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(); });
    modal.querySelector('#ljf-onboard-done').addEventListener('click', dismiss);

    function dismiss() {
      GM_setValue('ljf_onboarded', 'true');
      overlay.remove();
    }
  }

  // ─── Dismiss Actions TOS confirm ─────────────────────────────────────────────

  function confirmDismissActionsEnable(onConfirm) {
    if (document.getElementById('ljf-dismiss-confirm')) return;
    const th = t();
    const warnBg  = darkMode ? 'rgba(234,179,8,.12)' : '#fef9c3';
    const warnBdr = darkMode ? 'rgba(234,179,8,.4)'  : '#ca8a04';
    const warnClr = darkMode ? '#fde68a'             : '#7c2d12';

    const overlay = document.createElement('div');
    overlay.id = 'ljf-dismiss-confirm';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:100004',
      'background:rgba(0,0,0,.65)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');

    const modal = document.createElement('div');
    modal.style.cssText = [
      `background:${th.panelBg}`, `color:${th.panelText}`,
      `border:1px solid ${th.border1}`, 'border-radius:8px',
      'padding:20px 22px', 'max-width:340px', 'width:90%',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'box-shadow:0 8px 32px rgba(0,0,0,.6)',
    ].join(';');

    modal.innerHTML = `
<div style="font-size:14px;font-weight:700;margin-bottom:10px;">Enable Dismiss Actions?</div>
<div style="background:${warnBg};border:1px solid ${warnBdr};border-radius:5px;padding:10px 12px;margin-bottom:14px;">
  <div style="font-size:11px;color:${warnClr};font-weight:700;margin-bottom:4px;">⚠ LinkedIn Terms of Service</div>
  <div style="font-size:11px;color:${warnClr};line-height:1.5;">
    Dismiss Actions automates clicks on LinkedIn's native dismiss button. This constitutes automated interaction with their platform and <strong>likely violates the LinkedIn User Agreement</strong>.<br><br>
    Only enable this if you understand and accept that risk. You are solely responsible for your use of this feature.
  </div>
</div>
<div style="display:flex;gap:8px;justify-content:flex-end;">
  <button id="ljf-dc-cancel" style="
    background:${th.rowBg};color:${th.ruleType};border:1px solid ${th.rowBorder};
    border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;">Cancel</button>
  <button id="ljf-dc-confirm" style="
    background:#b91c1c;color:#fff;border:none;
    border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;">I understand — Enable</button>
</div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.querySelector('#ljf-dc-cancel').addEventListener('click',  () => overlay.remove());
    modal.querySelector('#ljf-dc-confirm').addEventListener('click', () => { overlay.remove(); onConfirm(); });
  }

  // ─── Settings modal ───────────────────────────────────────────────────────────

  function openSettingsModal() {
    if (document.getElementById('ljf-settings-modal')) return; // already open
    const th = t();

    const overlay = document.createElement('div');
    overlay.id = 'ljf-settings-modal';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:100002',
      'background:rgba(0,0,0,.65)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');

    const modal = document.createElement('div');
    modal.style.cssText = [
      `background:${th.panelBg}`, `color:${th.panelText}`,
      `border:1px solid ${th.border1}`, 'border-radius:8px',
      'width:320px', 'overflow:hidden',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'box-shadow:0 8px 32px rgba(0,0,0,.6)',
    ].join(';');

    // ── Header ────────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = [
      `background:${th.headerBg}`, `border-bottom:1px solid ${th.border1}`,
      'display:flex', 'align-items:center', 'justify-content:space-between',
      'padding:11px 14px',
    ].join(';');
    const title = document.createElement('strong');
    title.style.cssText = `font-size:13px;letter-spacing:.3px;color:${th.panelText};`;
    title.textContent = 'Settings';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = `background:none;border:none;color:${th.ruleType};cursor:pointer;font-size:13px;padding:2px 4px;line-height:1;`;
    closeBtn.addEventListener('click', () => overlay.remove());
    header.appendChild(title);
    header.appendChild(closeBtn);

    // ── Tab bar ───────────────────────────────────────────────────────────────
    const TABS = ['Settings', 'Colors', 'Backup'];
    let activeTab = 'Settings';

    const tabBar = document.createElement('div');
    tabBar.style.cssText = `display:flex;border-bottom:1px solid ${th.border1};padding:0 8px;`;

    const content = document.createElement('div');
    content.style.cssText = 'padding:16px 18px;min-height:140px;';

    function mkRow(labelText, control) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 0;cursor:pointer;';
      const lbl = document.createElement('span');
      lbl.style.cssText = `font-size:12px;color:${th.panelText};`;
      lbl.textContent = labelText;
      row.appendChild(lbl);
      row.appendChild(control);
      return row;
    }

    function mkToggle(checked, onChange) {
      let on = checked;
      const track = document.createElement('div');
      const knob  = document.createElement('div');
      track.style.cssText = 'position:relative;width:32px;height:18px;border-radius:9px;cursor:pointer;transition:background .2s;flex-shrink:0;';
      knob.style.cssText  = 'position:absolute;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:left .15s;';
      track.appendChild(knob);
      function refresh() {
        track.style.background = on ? '#4e7af7' : (darkMode ? '#444' : '#bbb');
        knob.style.left = on ? '16px' : '2px';
      }
      refresh();
      track.addEventListener('click', () => { on = !on; refresh(); onChange(on); });
      return track;
    }

    function mkBackupBtn(label, onClick) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = [
        `background:${th.rowBg}`, `color:${th.panelText}`,
        `border:1px solid ${th.rowBorder}`, 'border-radius:4px',
        'padding:8px 10px', 'cursor:pointer', 'font-size:12px',
        'text-align:left', 'width:100%',
      ].join(';');
      btn.addEventListener('click', () => { overlay.remove(); onClick(); });
      return btn;
    }

    function renderContent() {
      content.innerHTML = '';
      const divider = () => {
        const d = document.createElement('div');
        d.style.cssText = `border-top:1px solid ${th.border2};margin:2px 0;`;
        return d;
      };
      if (activeTab === 'Colors') {
        const COLOR_LABELS = [
          ['dismiss',    'Dismiss'],
          ['highlight',  'Highlight'],
          ['recent',     'Recently applied'],
          ['dismissed',  'Dismissed'],
          ['dismissLog', 'Prev dismissed'],
        ];
        function makePreviewBox(hex, bgCard, key) {
          const alphas   = ROLE_ALPHAS[key] || { bg: 0.10, border: 0.55 };
          const [r, g, b] = hexToRgb(hex);
          const isDark   = bgCard === '#1b1b1b';
          const textColor = isDark ? '#e0e0e0' : '#111';
          const outer = document.createElement('div');
          outer.style.cssText = `width:48px;height:24px;border-radius:3px;background:${bgCard};overflow:hidden;flex-shrink:0;`;
          const inner = document.createElement('div');
          inner.style.cssText = `width:100%;height:100%;background:rgba(${r},${g},${b},${alphas.bg});border-left:3px solid rgba(${r},${g},${b},${alphas.border});display:flex;align-items:center;padding-left:4px;box-sizing:border-box;`;
          const lbl = document.createElement('span');
          lbl.style.cssText = `font-size:8px;line-height:1;color:${textColor};font-family:-apple-system,BlinkMacSystemFont,sans-serif;`;
          lbl.textContent = isDark ? 'Dark' : 'Light';
          inner.appendChild(lbl);
          outer.appendChild(inner);
          return { wrap: outer, inner };
        }

        for (const [key, label] of COLOR_LABELS) {
          const inp = document.createElement('input');
          inp.type  = 'color';
          inp.value = userColors[key];
          inp.style.cssText = 'width:32px;height:24px;border:none;padding:0;cursor:pointer;border-radius:4px;background:none;flex-shrink:0;-webkit-appearance:none;appearance:none;outline:none;';

          const darkPreview  = makePreviewBox(userColors[key], '#1b1b1b', key);
          const lightPreview = makePreviewBox(userColors[key], '#ffffff', key);

          const previews = document.createElement('div');
          previews.style.cssText = 'display:flex;gap:4px;align-items:flex-end;flex-shrink:0;pointer-events:none;';
          previews.appendChild(darkPreview.wrap);
          previews.appendChild(lightPreview.wrap);

          const control = document.createElement('div');
          control.style.cssText = 'display:flex;align-items:center;gap:8px;';
          control.appendChild(previews);
          control.appendChild(inp);

          inp.addEventListener('input', () => {
            userColors[key] = inp.value;
            const [r, g, b] = hexToRgb(inp.value);
            const alphas = ROLE_ALPHAS[key] || { bg: 0.10, border: 0.55 };
            const bg     = `rgba(${r},${g},${b},${alphas.bg})`;
            const border = `rgba(${r},${g},${b},${alphas.border})`;
            for (const preview of [darkPreview, lightPreview]) {
              preview.inner.style.background  = bg;
              preview.inner.style.borderLeft  = `3px solid ${border}`;
            }
            saveColors();
            CC = buildCC(userColors);
            setPanelVars();
            clearHighlights();
            applyAllRules();
          });
          content.appendChild(mkRow(label, control));
          content.appendChild(divider());
        }
        const restoreBtn = document.createElement('button');
        restoreBtn.textContent = 'Restore Defaults';
        restoreBtn.style.cssText = [
          `background:${th.rowBg}`, `color:${th.ruleType}`,
          `border:1px solid ${th.rowBorder}`, 'border-radius:4px',
          'padding:6px 12px', 'cursor:pointer', 'font-size:11px', 'margin-top:6px',
        ].join(';');
        restoreBtn.addEventListener('click', () => {
          userColors = { ...COLOR_DEFAULTS };
          saveColors();
          CC = buildCC(userColors);
          setPanelVars();
          clearHighlights();
          applyAllRules();
          renderContent();
        });
        content.appendChild(restoreBtn);
      } else if (activeTab === 'Settings') {
        content.appendChild(mkRow('Dark Mode', mkToggle(darkMode, checked => {
          if (checked !== darkMode) { overlay.remove(); toggleDarkMode(); }
        })));
        content.appendChild(divider());
        content.appendChild(divider());
        content.appendChild(mkRow('Quick Hover Menu', mkToggle(hoverMenuEnabled, checked => {
          hoverMenuEnabled = checked;
          GM_setValue('ljf_hoverMenu', checked ? 'true' : 'false');
        })));
        content.appendChild(divider());
        (() => {
          const inp = document.createElement('input');
          inp.type  = 'number';
          inp.min   = '1';
          inp.max   = '365';
          inp.value = String(reapplyDays);
          inp.style.cssText = [
            'width:52px', 'text-align:center', 'border-radius:4px',
            `border:1px solid ${th.rowBorder}`, `background:${th.rowBg}`,
            `color:${th.panelText}`, 'font-size:12px', 'padding:3px 6px',
          ].join(';');
          inp.addEventListener('change', () => {
            const v = Math.max(1, parseInt(inp.value, 10) || 14);
            inp.value   = String(v);
            reapplyDays = v;
            GM_setValue('ljf_reapplyDays', String(v));
            clearHighlights();
            applyAllRules();
          });
          content.appendChild(mkRow('Reapply after (days)', inp));
        })();
        content.appendChild(divider());
        content.appendChild(mkRow('Hide recently applied companies', mkToggle(hideRecentlyApplied, checked => {
          hideRecentlyApplied = checked;
          GM_setValue('ljf_hideRecentlyApplied', checked ? 'true' : 'false');
          applyRecentlyAppliedVisibility();
          updateTabCount();
        })));
        content.appendChild(divider());
        (() => {
          const inp = document.createElement('input');
          inp.type  = 'number';
          inp.min   = '1';
          inp.max   = '3650';
          inp.value = String(dismissLogExpiry);
          inp.style.cssText = [
            'width:52px', 'text-align:center', 'border-radius:4px',
            `border:1px solid ${th.rowBorder}`, `background:${th.rowBg}`,
            `color:${th.panelText}`, 'font-size:12px', 'padding:3px 6px',
          ].join(';');
          inp.addEventListener('change', () => {
            const v = Math.max(1, parseInt(inp.value, 10) || 180);
            inp.value = String(v);
            dismissLogExpiry = v;
            GM_setValue('ljf_dismissLogExpiry', String(v));
          });
          content.appendChild(mkRow('Dismiss log expiry (days)', inp));
        })();
        content.appendChild(divider());
        content.appendChild(mkRow('Match location when re-flagging', mkToggle(dismissLogMatchLocation, checked => {
          dismissLogMatchLocation = checked;
          GM_setValue('ljf_dismissLogMatchLocation', checked ? 'true' : 'false');
        })));
        content.appendChild(divider());
        content.appendChild(mkRow('Dismissed log cards red', mkToggle(dismissLogCardsRed, checked => {
          dismissLogCardsRed = checked;
          GM_setValue('ljf_dismissLogCardsRed', checked ? 'true' : 'false');
          clearHighlights();
          applyAllRules();
        })));
        content.appendChild(divider());
        content.appendChild(mkRow('Dismiss Actions', mkToggle(dismissActionsEnabled, checked => {
          if (checked && !dismissActionsEnabled) {
            overlay.remove();
            confirmDismissActionsEnable(() => {
              dismissActionsEnabled = true;
              GM_setValue('ljf_dismissActions', 'true');
              buildPanelContent();
              updateTabCount();
            });
          } else {
            dismissActionsEnabled = checked;
            GM_setValue('ljf_dismissActions', checked ? 'true' : 'false');
            overlay.remove();
            buildPanelContent();
            updateTabCount();
          }
        })));
      } else {
        const grid = document.createElement('div');
        grid.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
        grid.appendChild(mkBackupBtn('\u2197 Export Rules',    exportRules));
        grid.appendChild(mkBackupBtn('\u2198 Import Rules',    importRules));

        let includeDismissLog = false;
        grid.appendChild(mkRow('Include dismiss log', mkToggle(false, checked => { includeDismissLog = checked; })));

        grid.appendChild(mkBackupBtn('\u2197 Export Log',   () => exportAppliedLog(includeDismissLog)));
        grid.appendChild(mkBackupBtn('\u2198 Import Log',   importAppliedLog));

        const csvLabel = document.createElement('div');
        csvLabel.textContent = 'Job Log — CSV';
        csvLabel.style.cssText = [
          `color:${th.countText}`, 'font-size:10px', 'font-weight:600',
          'letter-spacing:.5px', 'text-transform:uppercase',
          `border-top:1px solid ${th.border2}`, 'padding-top:8px', 'margin-top:2px',
        ].join(';');
        grid.appendChild(csvLabel);
        grid.appendChild(mkBackupBtn('\u2197 Export Log CSV',   () => exportAppliedLogCsv(includeDismissLog)));
        grid.appendChild(mkBackupBtn('\u2198 Import Log CSV',   importAppliedLogCsv));
        grid.appendChild(mkBackupBtn('\u2B07 Download CSV Template', downloadLogCsvTemplate));
        content.appendChild(grid);
      }
    }

    function renderTabs() {
      tabBar.innerHTML = '';
      for (const tab of TABS) {
        const btn = document.createElement('button');
        btn.textContent = tab;
        const isActive = tab === activeTab;
        btn.style.cssText = [
          'background:none', 'border:none', 'cursor:pointer',
          'font-size:12px', 'padding:9px 12px', 'line-height:1',
          `color:${isActive ? th.panelText : th.ruleType}`,
          `font-weight:${isActive ? '700' : '400'}`,
          `border-bottom:2px solid ${isActive ? '#4e7af7' : 'transparent'}`,
          'margin-bottom:-1px',
        ].join(';');
        btn.addEventListener('click', () => { activeTab = tab; renderTabs(); renderContent(); });
        tabBar.appendChild(btn);
      }
    }

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    modal.appendChild(header);
    modal.appendChild(tabBar);
    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    renderTabs();
    renderContent();
  }

  // ─── Form edit-state helpers ──────────────────────────────────────────────────

  function cancelEdit() {
    editingRuleId   = null;
    editingOrigType = null;
    const vi = document.getElementById('ljf-value-input');
    const li = document.getElementById('ljf-label-input');
    const ab = document.getElementById('ljf-add-btn');
    const ft = document.getElementById('ljf-add-form-title');
    if (vi) vi.value = '';
    if (li) li.value = '';
    if (ab) ab.textContent = '+ Add Rule';
    if (ft) ft.textContent = 'Add Rule';
    updateDropdownBlockedOptions();
    updateLabelVisibility();
  }

  function populateFormForEdit(rule) {
    editingRuleId   = rule.id;
    editingOrigType = rule.type;
    const sel = document.getElementById('ljf-type-sel');
    sel.value = rule.type;
    document.getElementById('ljf-value-input').value = rule.value;
    document.getElementById('ljf-label-input').value = rule.label || '';
    document.getElementById('ljf-add-btn').textContent = '+ Update Rule';
    document.getElementById('ljf-add-form-title').textContent = 'Update Rule';
    updateDropdownBlockedOptions();
    updateLabelVisibility();
    document.getElementById('ljf-value-input').focus();
  }

  // Disable salary-type options in the dropdown when a rule already exists for them
  // (unless we're currently editing that rule, in which case it must stay selectable)
  function updateDropdownBlockedOptions() {
    const sel = document.getElementById('ljf-type-sel');
    if (!sel) return;
    for (const opt of sel.options) {
      if (opt.value === 'salarybelow' || opt.value === 'topsalarybelow' || opt.value === 'salaryabove' || opt.value === 'topsalaryabove') {
        const existing = rules.find(r => r.type === opt.value);
        opt.disabled = !!(existing && editingRuleId !== existing.id);
      }
    }
  }

  function updateLabelVisibility() {
    const sel = document.getElementById('ljf-type-sel');
    const labelInput = document.getElementById('ljf-label-input');
    if (!sel || !labelInput) return;
    const hide = sel.value === 'salarybelow' || sel.value === 'topsalarybelow' || sel.value === 'salaryabove' || sel.value === 'topsalaryabove';
    labelInput.style.display = hide ? 'none' : '';
  }

  // ─── Add / update rule handler ────────────────────────────────────────────────

  function handleAddRule() {
    const type  = document.getElementById('ljf-type-sel').value;
    const value = document.getElementById('ljf-value-input').value.trim();
    const label = document.getElementById('ljf-label-input').value.trim();

    if (!value) { setStatus('\u26A0 Enter a value first.'); return; }

    const typeLabel  = RULE_TYPES[type]?.label || type;
    const isSalary   = type === 'salarybelow' || type === 'topsalarybelow' || type === 'salaryabove' || type === 'topsalaryabove';
    const finalLabel = isSalary
      ? typeLabel + ': ' + value
      : (label || typeLabel + ': ' + value);

    if (editingRuleId !== null) {
      updateRule(editingRuleId, value, finalLabel);
      cancelEdit();
      clearHighlights();
      applyAllRules();
      renderRules();
      setStatus('Rule updated.');
    } else {
      addRule(type, value, finalLabel);
      document.getElementById('ljf-value-input').value = '';
      document.getElementById('ljf-label-input').value = '';
      renderRules();
      const matched = countMatches(rules[rules.length - 1]);
      clearHighlights();
      applyAllRules();
      setStatus('Rule added \u2014 ' + matched + ' card(s) matched.');
    }
    updateDropdownBlockedOptions();
  }

  // ─── Export / Import ─────────────────────────────────────────────────────────

  function exportRules() {
    const payload = {
      script:        'LinkedIn Job Filter',
      source:        SOURCE_URL,
      exported:      new Date().toISOString(),
      darkMode:      darkMode ? 'dark' : 'light',
      jobLogEnabled: jobLogEnabled,
      reapplyDays:   reapplyDays,
      colors:        userColors,
      rules:         rules,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'linkedin-job-filter-rules.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Rules exported.');
  }

  function importRules() {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data || typeof data !== 'object' || Array.isArray(data)) {
            setStatus('\u26A0 Invalid rules file: expected an object with a "rules" array.');
            return;
          }
          if (!Array.isArray(data.rules)) {
            setStatus('\u26A0 Invalid rules file: no "rules" array found.');
            return;
          }
          if (data.rules.length === 0) {
            setStatus('\u26A0 No rules found in file.');
            return;
          }
          showImportDialog(data.rules, data.darkMode, data.jobLogEnabled, data.reapplyDays, data.colors);
        } catch (e) {
          setStatus('\u26A0 Invalid rules file: ' + e.message);
        }
      });
      reader.readAsText(file);
    });
    input.click();
  }

  function deduplicateRules(arr) {
    const seen = new Set();
    return arr.filter(r => {
      // For singleton types, keep only the first occurrence (prefer enabled)
      const singletonTypes = ['applied', 'salarybelow', 'topsalarybelow', 'salaryabove', 'topsalaryabove'];
      if (singletonTypes.includes(r.type)) {
        if (seen.has(r.type)) return false;
        seen.add(r.type);
        return true;
      }
      // For value-based types, deduplicate by type+value
      const key = r.type + '|' + r.value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function showImportDialog(incoming, importedDarkMode, importedJobLogEnabled, importedReapplyDays, importedColors) {
    const th = t();
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:100002',
      'background:rgba(0,0,0,.65)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');

    const modal = document.createElement('div');
    modal.style.cssText = [
      `background:${th.panelBg}`, `color:${th.panelText}`,
      `border:1px solid ${th.border1}`, 'border-radius:8px',
      'padding:20px 22px', 'max-width:310px', 'width:90%',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'box-shadow:0 8px 32px rgba(0,0,0,.6)',
    ].join(';');

    const countLabel = incoming.length + ' rule' + (incoming.length !== 1 ? 's' : '');
    modal.innerHTML = `
<div style="font-size:14px;font-weight:600;margin-bottom:8px;">Import Rules</div>
<div style="font-size:12px;color:${th.ruleType};margin-bottom:18px;">
  ${escHtml(countLabel)} found. Overwrite all existing rules, or append to them?
</div>
<div style="display:flex;gap:8px;justify-content:flex-end;">
  <button id="ljf-imp-cancel" style="
    background:${th.rowBg};color:${th.ruleType};border:1px solid ${th.rowBorder};
    border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;">Cancel</button>
  <button id="ljf-imp-append" style="
    background:${th.greenBg};color:${th.greenText};border:1px solid ${th.greenBorder};
    border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;">Append</button>
  <button id="ljf-imp-overwrite" style="
    background:${th.dismissBg};color:${th.dismissBtnText};border:none;
    border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;">Overwrite</button>
</div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const freshIds = (arr) => {
      let id = Date.now();
      return arr.map(r => ({ ...r, id: ++id }));
    };

    const applyImportedSettings = () => {
      if (importedDarkMode === 'dark' || importedDarkMode === 'light') {
        const newDark = importedDarkMode !== 'light';
        if (newDark !== darkMode) {
          darkMode = newDark;
          GM_setValue('ljf_darkMode', importedDarkMode);
        }
      }
      if (importedJobLogEnabled === true || importedJobLogEnabled === false) {
        jobLogEnabled = importedJobLogEnabled;
        GM_setValue('ljf_jobLogEnabled', jobLogEnabled ? 'true' : 'false');
      }
      if (typeof importedReapplyDays === 'number' && importedReapplyDays >= 1) {
        reapplyDays = importedReapplyDays;
        GM_setValue('ljf_reapplyDays', String(reapplyDays));
      }
      if (importedColors && typeof importedColors === 'object' && !Array.isArray(importedColors)) {
        userColors = { ...COLOR_DEFAULTS, ...importedColors };
        saveColors();
        CC = buildCC(userColors);
      }
    };

    modal.querySelector('#ljf-imp-cancel').addEventListener('click', () => overlay.remove());

    modal.querySelector('#ljf-imp-append').addEventListener('click', () => {
      rules.push(...freshIds(incoming));
      rules = deduplicateRules(rules);
      saveRules();
      applyImportedSettings();
      overlay.remove();
      buildPanelContent();
      clearHighlights();
      applyAllRules();
      setStatus('Imported ' + incoming.length + ' rule(s) — appended.');
    });

    modal.querySelector('#ljf-imp-overwrite').addEventListener('click', () => {
      rules = deduplicateRules(freshIds(incoming));
      saveRules();
      applyImportedSettings();
      overlay.remove();
      buildPanelContent();
      clearHighlights();
      applyAllRules();
      setStatus('Imported ' + incoming.length + ' rule(s) — rules replaced.');
    });
  }

  // ─── Applied Log Export / Import ─────────────────────────────────────────────

  function exportAppliedLog(withDismissLog) {
    const payload = {
      script:      'LinkedIn Job Filter',
      exported:    new Date().toISOString(),
      appliedLog:  appliedLog,
    };
    if (withDismissLog) payload.dismissLog = dismissLog;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'linkedin-applied-log.json';
    a.click();
    URL.revokeObjectURL(url);
    const extra = withDismissLog ? ' + ' + dismissLog.length + ' dismissed' : '';
    setStatus('Applied log exported (' + appliedLog.length + ' applied' + extra + ').');
  }

  function importAppliedLog() {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        try {
          const data = JSON.parse(reader.result);
          // Accept { appliedLog: [...] } or a bare array
          const incoming = Array.isArray(data) ? data : (Array.isArray(data.appliedLog) ? data.appliedLog : null);
          if (incoming === null) {
            setStatus('\u26A0 Invalid log file: expected an array or an object with an "appliedLog" array.');
            return;
          }
          if (incoming.length === 0 && !Array.isArray(data.dismissLog)) {
            setStatus('\u26A0 No log entries found in file.');
            return;
          }
          const incomingDismiss = Array.isArray(data.dismissLog) ? data.dismissLog : null;
          showLogImportDialog(incoming, incomingDismiss);
        } catch (e) {
          setStatus('\u26A0 Invalid log file: ' + e.message);
        }
      });
      reader.readAsText(file);
    });
    input.click();
  }

  function showLogImportDialog(incoming, incomingDismiss) {
    const th = t();
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:100002',
      'background:rgba(0,0,0,.65)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');

    const modal = document.createElement('div');
    modal.style.cssText = [
      `background:${th.panelBg}`, `color:${th.panelText}`,
      `border:1px solid ${th.border1}`, 'border-radius:8px',
      'padding:20px 22px', 'max-width:310px', 'width:90%',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'box-shadow:0 8px 32px rgba(0,0,0,.6)',
    ].join(';');

    const countLabel = incoming.length + ' applied';
    const dismissLabel = incomingDismiss ? ' + ' + incomingDismiss.length + ' dismissed' : '';
    modal.innerHTML = `
<div style="font-size:14px;font-weight:600;margin-bottom:8px;">Import Log</div>
<div style="font-size:12px;color:${th.ruleType};margin-bottom:18px;">
  ${escHtml(countLabel + dismissLabel)} found. Overwrite the existing log, or append to it?
</div>
<div style="display:flex;gap:8px;justify-content:flex-end;">
  <button id="ljf-limp-cancel" style="
    background:${th.rowBg};color:${th.ruleType};border:1px solid ${th.rowBorder};
    border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;">Cancel</button>
  <button id="ljf-limp-append" style="
    background:${th.greenBg};color:${th.greenText};border:1px solid ${th.greenBorder};
    border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;">Append</button>
  <button id="ljf-limp-overwrite" style="
    background:${th.dismissBg};color:${th.dismissBtnText};border:none;
    border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;">Overwrite</button>
</div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function applyDismissImport(mode) {
      if (!incomingDismiss || !incomingDismiss.length) return;
      if (mode === 'append') {
        dismissLog.push(...incomingDismiss);
      } else {
        dismissLog = incomingDismiss;
      }
      saveDismissLog();
    }

    modal.querySelector('#ljf-limp-cancel').addEventListener('click', () => overlay.remove());

    modal.querySelector('#ljf-limp-append').addEventListener('click', () => {
      appliedLog.push(...incoming);
      saveAppliedLog();
      applyDismissImport('append');
      overlay.remove();
      clearHighlights();
      applyAllRules();
      if (panelOpen) { renderRules(); renderJobsPane(); }
      const extra = incomingDismiss ? ' + ' + incomingDismiss.length + ' dismissed' : '';
      setStatus('Log imported \u2014 ' + incoming.length + ' applied' + extra + ' appended.');
    });

    modal.querySelector('#ljf-limp-overwrite').addEventListener('click', () => {
      appliedLog = incoming;
      saveAppliedLog();
      applyDismissImport('overwrite');
      overlay.remove();
      clearHighlights();
      applyAllRules();
      if (panelOpen) { renderRules(); renderJobsPane(); }
      const extra = incomingDismiss ? ' + ' + incomingDismiss.length + ' dismissed' : '';
      setStatus('Log imported \u2014 ' + incoming.length + ' applied' + extra + ' (replaced).');
    });
  }

  // ─── Applied Log CSV Export / Import ─────────────────────────────────────────

  const LOG_CSV_HEADERS = ['company', 'title', 'date', 'status', 'statusDate', 'url', 'notes'];

  function csvEscape(val) {
    const s = String(val == null ? '' : val);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  }

  function parseCsvLine(line) {
    const fields = [];
    let i = 0;
    while (i <= line.length) {
      if (line[i] === '"') {
        let val = '';
        i++;
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; }
          else if (line[i] === '"') { i++; break; }
          else { val += line[i++]; }
        }
        fields.push(val);
        if (line[i] === ',') i++;
      } else {
        const end = line.indexOf(',', i);
        if (end === -1) { fields.push(line.slice(i)); break; }
        fields.push(line.slice(i, end));
        i = end + 1;
      }
    }
    return fields;
  }

  function parseCsv(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      .split('\n').filter(l => l.trim()).map(parseCsvLine);
  }

  function exportAppliedLogCsv(withDismissLog) {
    const headers = [...LOG_CSV_HEADERS, 'type'];
    const rows = [headers.join(',')];
    for (const e of appliedLog) {
      rows.push([e.company, e.title, e.date, e.status || 'applied',
                 e.statusDate || '', e.url || '', e.notes || '', 'applied'].map(csvEscape).join(','));
    }
    if (withDismissLog) {
      for (const e of dismissLog) {
        rows.push([e.company || '', e.title || '', e.date || '', '', '',
                   '', '', 'dismissed'].map(csvEscape).join(','));
      }
    }
    const blob = new Blob([rows.join('\n') + '\n'], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'linkedin-applied-log.csv';
    a.click();
    URL.revokeObjectURL(url);
    const total = appliedLog.length + (withDismissLog ? dismissLog.length : 0);
    setStatus('Log exported as CSV (' + total + ' entr' + (total !== 1 ? 'ies' : 'y') + ').');
  }

  function importAppliedLogCsv() {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = '.csv,text/csv';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        try {
          const rows = parseCsv(reader.result);
          if (rows.length < 2) { setStatus('\u26A0 CSV has no data rows.'); return; }
          const headers = rows[0].map(h => h.trim().toLowerCase());
          const get = (row, name) => {
            const idx = headers.indexOf(name);
            return idx >= 0 ? (row[idx] || '').trim() : '';
          };
          const allEntries = rows.slice(1).filter(row => get(row, 'company') && get(row, 'title') && get(row, 'date'));
          if (!allEntries.length) { setStatus('\u26A0 No valid entries in CSV (need company + title + date).'); return; }

          const incomingApplied = allEntries
            .filter(row => get(row, 'type').toLowerCase() !== 'dismissed')
            .map(row => ({
              company: get(row, 'company'), title: get(row, 'title'), date: get(row, 'date'),
              status: (get(row, 'status') || 'applied').toLowerCase(),
              statusDate: get(row, 'statusdate'), url: get(row, 'url'), notes: get(row, 'notes'),
            }));
          const incomingDismiss = allEntries
            .filter(row => get(row, 'type').toLowerCase() === 'dismissed')
            .map(row => ({
              company: get(row, 'company'), title: get(row, 'title'), date: get(row, 'date'),
              jobId: null, location: '',
            }));

          showLogImportDialog(incomingApplied, incomingDismiss.length ? incomingDismiss : null);
        } catch {
          setStatus('\u26A0 Failed to parse CSV file.');
        }
      });
      reader.readAsText(file);
    });
    input.click();
  }

  function downloadLogCsvTemplate() {
    const today = localDateStr();
    const samples = [
      ['Acme Corp',    'Software Engineer', today, 'applied',      '',      'https://www.linkedin.com/jobs/view/123456789', ''],
      ['Beta Inc',     'Senior Engineer',   today, 'interviewing', today,   'https://www.linkedin.com/jobs/view/234567890', 'Phone screen done'],
      ['Gamma LLC',    'Staff Engineer',    today, 'offer',        today,   'https://www.linkedin.com/jobs/view/345678901', ''],
      ['Delta Co',     'Engineering Lead',  today, 'rejected',     today,   'https://www.linkedin.com/jobs/view/456789012', 'No response after apply'],
      ['Epsilon Ltd',  'Principal Eng',     today, 'closed',       today,   'https://www.linkedin.com/jobs/view/567890123', 'Rejected after final round'],
      ['Zeta Group',   'IC5 Engineer',      today, 'withdrawn',    today,   'https://www.linkedin.com/jobs/view/678901234', 'Withdrew before offer'],
    ];
    const csv = LOG_CSV_HEADERS.join(',') + '\n' + samples.map(row => row.map(csvEscape).join(',')).join('\n') + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'linkedin-job-log-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  function renderRules() {
    const list = document.getElementById('ljf-rules-list');
    if (!list) return;
    list.innerHTML = '';
    updateDismissLogCount();

    const companyDismiss   = rules.filter(r => r.type === 'companydismiss');
    const titleDismiss     = rules.filter(r => r.type === 'titledismiss');
    const locationDismiss  = rules.filter(r => r.type === 'locationdismiss');
    const companyHi        = rules.filter(r => r.type === 'companyhi');
    const titleHi          = rules.filter(r => r.type === 'titlehi');
    const locationHi       = rules.filter(r => r.type === 'locationhi');

    // ── Dismiss Rules ─────────────────────────────────────────────────────────
    const dCollapsed = collapsedSections.dismissSection;
    list.appendChild(renderSectionHeader('Dismiss Rules', 'dismissSection', ['companydismiss', 'titledismiss', 'locationdismiss']));
    if (!dCollapsed) {
      list.appendChild(renderAppliedBlock(rules.find(r => r.type === 'applied')));
      list.appendChild(renderJobLogBlock());
      list.appendChild(renderSalaryBlock('topsalarybelow', rules.find(r => r.type === 'topsalarybelow')));
      list.appendChild(renderSalaryBlock('salarybelow',    rules.find(r => r.type === 'salarybelow')));
    }
    list.appendChild(renderGroupHeader('Companies', companyDismiss.length, 'companydismiss'));
    if (!collapsedSections.companydismiss) {
      for (const rule of companyDismiss) list.appendChild(renderRuleRow(rule));
    }
    list.appendChild(renderGroupHeader('Title Keywords', titleDismiss.length, 'titledismiss'));
    if (!collapsedSections.titledismiss) {
      for (const rule of titleDismiss) list.appendChild(renderRuleRow(rule));
    }
    list.appendChild(renderGroupHeader('Location Keywords', locationDismiss.length, 'locationdismiss'));
    if (!collapsedSections.locationdismiss) {
      for (const rule of locationDismiss) list.appendChild(renderRuleRow(rule));
    }

    // ── Divider ───────────────────────────────────────────────────────────────
    const divider = document.createElement('div');
    divider.style.cssText = `border-top:1px solid ${t().border1};margin:10px 0 2px;`;
    list.appendChild(divider);

    // ── Highlight Rules ───────────────────────────────────────────────────────
    const hCollapsed = collapsedSections.highlightSection;
    list.appendChild(renderSectionHeader('Highlight Rules', 'highlightSection', ['companyhi', 'titlehi', 'locationhi']));
    if (!hCollapsed) {
      list.appendChild(renderSalaryBlock('topsalaryabove', rules.find(r => r.type === 'topsalaryabove'), true));
      list.appendChild(renderSalaryBlock('salaryabove',    rules.find(r => r.type === 'salaryabove'),    true));
    }
    list.appendChild(renderGroupHeader('Companies', companyHi.length, 'companyhi'));
    if (!collapsedSections.companyhi) {
      for (const rule of companyHi) list.appendChild(renderRuleRow(rule));
    }
    list.appendChild(renderGroupHeader('Title Keywords', titleHi.length, 'titlehi'));
    if (!collapsedSections.titlehi) {
      for (const rule of titleHi) list.appendChild(renderRuleRow(rule));
    }
    list.appendChild(renderGroupHeader('Location Keywords', locationHi.length, 'locationhi'));
    if (!collapsedSections.locationhi) {
      for (const rule of locationHi) list.appendChild(renderRuleRow(rule));
    }

    updateDropdownBlockedOptions();
    updateLabelVisibility();
  }

  function renderAppliedBlock(rule) {
    const div = document.createElement('div');
    div.className = 'ljf-block ljf-dim';

    const enabled = rule ? rule.enabled : true;
    div.innerHTML = `
<div class="ljf-block-row">
  <span class="ljf-block-title" style="flex:1;">LinkedIn Applied Label</span>
  ${dismissActionsEnabled ? `<button class="ljf-applied-dismiss ljf-btn-dismiss" title="Dismiss all matching cards">✕ dismiss</button>` : ''}
  <button class="ljf-applied-toggle ljf-btn-toggle ${enabled ? 'ljf-on' : 'ljf-off'}" title="${enabled ? 'Disable rule' : 'Enable rule'}">${enabled ? '✓' : '✕'}</button>
</div>`;

    div.querySelector('.ljf-applied-toggle').addEventListener('click', e => {
      e.stopPropagation();
      if (rule) {
        rule.enabled = !rule.enabled;
        saveRules();
        clearHighlights();
        applyAllRules();
        renderRules();
      }
    });

    div.querySelector('.ljf-applied-dismiss')?.addEventListener('click', e => {
      e.stopPropagation();
      if (rule) {
        const dismissed = dismissRule(rule);
        setStatus('Already Applied \u2014 ' + dismissed + ' card(s) dismissed.');
      }
    });

    return div;
  }

  function renderJobLogBlock() {
    const count = appliedLog.length;
    const div = document.createElement('div');
    div.className = 'ljf-block ljf-log';

    div.innerHTML = `
<div class="ljf-block-title ljf-mb5">Jobs Applied Log</div>
<div class="ljf-block-row">
  <span class="ljf-block-title" style="flex:1;">
    Job Log <span style="font-weight:400;font-size:10px;" class="ljf-hdr-count">(${count} entr${count !== 1 ? 'ies' : 'y'})</span>
  </span>
  ${dismissActionsEnabled ? `<button class="ljf-joblog-dismiss ljf-btn-dismiss" title="Dismiss all matching cards">✕ dismiss</button>` : ''}
  <button class="ljf-joblog-toggle ljf-btn-toggle ${jobLogEnabled ? 'ljf-on' : 'ljf-off'}" title="${jobLogEnabled ? 'Disable job log matching' : 'Enable job log matching'}">${jobLogEnabled ? '✓' : '✕'}</button>
</div>`;

    div.querySelector('.ljf-joblog-toggle').addEventListener('click', e => {
      e.stopPropagation();
      jobLogEnabled = !jobLogEnabled;
      GM_setValue('ljf_jobLogEnabled', jobLogEnabled ? 'true' : 'false');
      clearHighlights();
      applyAllRules();
      renderRules();
    });

    div.querySelector('.ljf-joblog-dismiss')?.addEventListener('click', e => {
      e.stopPropagation();
      const dismissed = dismissJobLog();
      setStatus('Job log \u2014 ' + dismissed + ' card(s) dismissed.');
    });

    return div;
  }

  function renderSalaryBlock(type, rule, isHighlight = false) {
    const typeLabel = RULE_TYPES[type].label;
    const hasValue  = !!(rule && rule.value);
    const display   = hasValue ? ('$' + rule.value + 'k') : 'Not set';
    const blockMod  = hasValue ? (isHighlight ? 'ljf-hi' : 'ljf-dim') : 'ljf-salary-off';

    const div = document.createElement('div');
    div.className = 'ljf-block ' + blockMod;

    div.innerHTML = `
<div class="ljf-block-row">
  <div class="ljf-block-left">
    <div class="ljf-block-title ${hasValue ? 'ljf-salary-on' : 'ljf-salary-off'}">${escHtml(typeLabel)}</div>
    <div class="ljf-block-val ${hasValue ? 'ljf-salary-on' : 'ljf-salary-off'}">${escHtml(display)}</div>
  </div>
  ${hasValue ? `
  ${(!isHighlight && dismissActionsEnabled) ? `<button class="ljf-salary-dismiss ljf-btn-dismiss" title="Dismiss all matching cards">✕ dismiss</button>` : ''}
  <button class="ljf-salary-clear ljf-btn-del" title="Remove this rule">✕</button>` : ''}
</div>`;

    div.addEventListener('click', e => {
      if (e.target.classList.contains('ljf-salary-clear')) return;
      if (rule) {
        populateFormForEdit(rule);
      } else {
        const sel = document.getElementById('ljf-type-sel');
        sel.value = type;
        updateDropdownBlockedOptions();
        updateLabelVisibility();
        document.getElementById('ljf-value-input').focus();
      }
    });

    const dismissBtn = div.querySelector('.ljf-salary-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', e => {
        e.stopPropagation();
        const dismissed = dismissRule(rule);
        setStatus(typeLabel + ' \u2014 ' + dismissed + ' card(s) dismissed.');
      });
    }

    const clearBtn = div.querySelector('.ljf-salary-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (editingRuleId === rule.id) cancelEdit();
        removeRule(rule.id);
        clearHighlights();
        applyAllRules();
        renderRules();
        setStatus(typeLabel + ' rule removed.');
      });
    }

    return div;
  }

  // subKeys: the two group keys controlled by this section header
  function renderSectionHeader(label, sectionKey, subKeys) {
    const sectionCollapsed = collapsedSections[sectionKey];
    const arrow = sectionCollapsed ? '▸' : '▾';
    const div = document.createElement('div');
    div.className = 'ljf-section-hdr';
    div.innerHTML =
      `<span>${escHtml(label)}</span>` +
      `<span class="ljf-hdr-arrow">${arrow}</span>`;
    div.addEventListener('click', () => {
      if (sectionCollapsed) {
        // expand section and all subgroups
        collapsedSections[sectionKey] = false;
        for (const k of subKeys) collapsedSections[k] = false;
      } else {
        // collapse section (hides stickies + all subgroup rows)
        collapsedSections[sectionKey] = true;
        for (const k of subKeys) collapsedSections[k] = true;
      }
      renderRules();
    });
    return div;
  }

  function renderGroupHeader(label, count, sectionKey) {
    const collapsed = collapsedSections[sectionKey];
    const arrow = collapsed ? '▸' : '▾';
    const div = document.createElement('div');
    div.className = 'ljf-group-hdr';
    div.innerHTML =
      `<span>${escHtml(label)}</span>` +
      `<span class="ljf-hdr-count">(${count})</span>` +
      (count > 0 ? `<span class="ljf-hdr-arrow">${arrow}</span>` : '');
    div.addEventListener('click', () => {
      if (count === 0) return;
      collapsedSections[sectionKey] = !collapsedSections[sectionKey];
      renderRules();
    });
    return div;
  }

  function renderRuleRow(rule) {
    const isHiRule = !!RULE_TYPES[rule.type]?.highlight;
    const row = document.createElement('div');
    row.className = 'ljf-rule-row ' + (isHiRule ? 'ljf-hi' : 'ljf-dim');

    const safeLabel = escHtml(rule.label);
    const typeLabel = escHtml(RULE_TYPES[rule.type]?.label || rule.type);

    row.innerHTML = `
<input type="checkbox" class="ljf-toggle" data-id="${rule.id}"
  ${rule.enabled ? 'checked' : ''}
  style="cursor:pointer;accent-color:#b91c1c;flex-shrink:0;margin:0;"/>
<div class="ljf-row-label" title="Click to edit">
  <div class="ljf-row-value" title="${safeLabel}">${safeLabel}</div>
  <div class="ljf-row-type">${typeLabel}</div>
</div>
${(!isHiRule && dismissActionsEnabled) ? `<button class="ljf-run-one ljf-btn-dismiss" data-id="${rule.id}" title="Dismiss all matches for this rule">✕ dismiss</button>` : ''}
<button class="ljf-del ljf-btn-del" data-id="${rule.id}" title="Delete rule">✕</button>`;

    row.querySelector('.ljf-row-label').addEventListener('click', () => populateFormForEdit(rule));

    row.querySelector('.ljf-toggle').addEventListener('change', e => {
      e.stopPropagation();
      toggleRule(Number(e.currentTarget.dataset.id));
      clearHighlights();
      applyAllRules();
    });

    row.querySelector('.ljf-run-one')?.addEventListener('click', e => {
      e.stopPropagation();
      const dismissed = dismissRule(rule);
      setStatus('"' + rule.label + '" \u2014 ' + dismissed + ' card(s) dismissed.');
    });

    row.querySelector('.ljf-del').addEventListener('click', e => {
      e.stopPropagation();
      if (editingRuleId === rule.id) cancelEdit();
      removeRule(rule.id);
      clearHighlights();
      applyAllRules();
      renderRules();
      setStatus('Rule removed.');
    });

    return row;
  }

  function setStatus(msg) {
    const el = document.getElementById('ljf-status-msg');
    if (el) el.textContent = msg;
  }

  function updateDismissLogCount() {
    const el = document.getElementById('ljf-dismiss-log-count');
    if (!el) return;
    el.textContent = dismissLog.length ? dismissLog.length + ' dismissed' : '';
  }

  function localDateStr() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }

  function rowTint(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function buildCC(colors) {
    function role(hex, a) {
      const [r, g, b] = hexToRgb(hex);
      const dr = Math.round(r * 0.85), dg = Math.round(g * 0.85), db = Math.round(b * 0.85);
      return {
        bg:     `rgba(${r},${g},${b},${a.bg})`,
        border: `rgba(${r},${g},${b},${a.border})`,
        badge:  `rgba(${dr},${dg},${db},${a.badge})`,
      };
    }
    const dm = role(colors.dismiss,    ROLE_ALPHAS.dismiss);
    const hi = role(colors.highlight,  ROLE_ALPHAS.highlight);
    const rc = role(colors.recent,     ROLE_ALPHAS.recent);
    const di = role(colors.dismissed,  ROLE_ALPHAS.dismissed);
    const dl = role(colors.dismissLog, ROLE_ALPHAS.dismissLog);
    const [dlr, dlg, dlb] = hexToRgb(colors.dismissLog);
    const dldr = Math.round(dlr * 0.85), dldg = Math.round(dlg * 0.85), dldb = Math.round(dlb * 0.85);
    return {
      dismissBg: dm.bg, dismissBorder: dm.border, dismissBadge: dm.badge,
      highlightBg: hi.bg, highlightBorder: hi.border, highlightBadge: hi.badge,
      recentBg: rc.bg, recentBorder: rc.border, recentBadge: rc.badge,
      dismissedBg: di.bg, dismissedBorder: di.border, dismissedBadge: di.badge,
      prevDismissedBg: dl.bg, prevDismissedBorder: dl.border, prevDismissedBadge: dl.badge,
      staleBadge: `rgba(${dldr},${dldg},${dldb},0.72)`,
    };
  }

  function saveColors() {
    GM_setValue('ljf_colors', JSON.stringify(userColors));
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Card hover menu ─────────────────────────────────────────────────────────

  function setupCardHoverMenu() {
    const menu = document.createElement('div');
    menu.id = 'ljf-hover-menu';
    menu.style.cssText = [
      'position:fixed', 'z-index:2147483647',
      'display:none', 'flex-direction:row', 'align-items:center', 'gap:2px',
      'background:#f2f2f2', 'border:1px solid #bbb', 'padding:3px',
      'border-radius:999px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');

    function makeBtn(char, title, hoverBg, hoverColor) {
      const btn = document.createElement('button');
      btn.title       = title;
      btn.textContent = char;
      btn.style.cssText = [
        'width:28px', 'height:28px', 'padding:0', 'border-radius:50%',
        'cursor:pointer', 'font-size:20px', 'font-weight:400',
        'line-height:1', 'border:none',
        'background:transparent', 'color:#555',
        'display:flex', 'align-items:center', 'justify-content:center',
        'transition:background 0.1s,color 0.1s',
      ].join(';');
      btn.addEventListener('mouseenter', () => { btn.style.background = hoverBg; btn.style.color = hoverColor; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = '#555'; });
      return btn;
    }

    const qdBtn            = makeBtn('\u00BB', 'Quick dismiss this company', '#d4b896', '#6b3a1f');
    const dismissPlusBtn   = makeBtn('\u2212', 'Add to dismiss rules',        '#fecaca', '#991b1b');
    const highlightPlusBtn = makeBtn('+',      'Add to highlight rules',       '#bbf7d0', '#166534');

    menu.appendChild(highlightPlusBtn);
    menu.appendChild(dismissPlusBtn);
    menu.appendChild(qdBtn);
    document.body.appendChild(menu);

    let currentCard = null;
    let hideTimeout = null;
    let showTimeout = null;

    function showMenu(triggerBtn) {
      clearTimeout(hideTimeout);
      const card = triggerBtn.closest(CARD_SEL);
      if (!card) return;
      currentCard = card;
      qdBtn.style.display = dismissActionsEnabled ? 'flex' : 'none';
      menu.style.visibility = 'hidden';
      menu.style.display = 'flex';
      requestAnimationFrame(() => {
        const rect = triggerBtn.getBoundingClientRect();
        const size = Math.round(rect.height);
        [qdBtn, dismissPlusBtn, highlightPlusBtn].forEach(b => {
          b.style.width = b.style.height = size + 'px';
        });
        menu.style.top  = rect.top + 'px';
        menu.style.left = (rect.left - menu.offsetWidth) + 'px';
        menu.style.visibility = 'visible';
      });
    }

    function scheduleShow(triggerBtn) {
      clearTimeout(showTimeout);
      clearTimeout(hideTimeout);
      showTimeout = setTimeout(() => showMenu(triggerBtn), 500);
    }

    function cancelShow() {
      clearTimeout(showTimeout);
    }

    function scheduleHide() {
      cancelShow();
      hideTimeout = setTimeout(() => {
        menu.style.display = 'none';
        currentCard = null;
      }, 200);
    }

    const HOVER_SEL = DISMISS_SEL + ', ' + UNDO_SEL;

    document.addEventListener('mouseover', e => {
      if (!hoverMenuEnabled) return;
      const btn = e.target.closest(HOVER_SEL);
      if (btn) scheduleShow(btn);
    });

    document.addEventListener('mouseout', e => {
      if (e.target.closest(HOVER_SEL)) scheduleHide();
    });

    menu.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
    menu.addEventListener('mouseleave', scheduleHide);

    document.addEventListener('scroll', () => {
      cancelShow();
      menu.style.display = 'none';
      currentCard = null;
    }, { passive: true, capture: true });

    dismissPlusBtn.addEventListener('click', e => {
      e.stopPropagation();
      menu.style.display = 'none';
      if (!currentCard) return;
      const company = cardText(currentCard, COMPANY_SEL);
      if (!company) { setStatus('\u26A0 Could not detect company name.'); return; }
      if (rules.find(r => r.type === 'companydismiss' && r.value.toLowerCase() === company.toLowerCase())) {
        setStatus('\u26A0 Dismiss rule already exists for: ' + company);
        return;
      }
      const newRule = addRule('companydismiss', company, 'Company Name: ' + company);
      clearHighlights();
      applyAllRules();
      const dismissed = dismissRule(newRule);
      if (panelOpen) renderRules();
      setStatus('Dismiss rule added \u2014 ' + dismissed + ' card(s) dismissed for ' + company);
    });

    highlightPlusBtn.addEventListener('click', e => {
      e.stopPropagation();
      menu.style.display = 'none';
      if (!currentCard) return;
      const company = cardText(currentCard, COMPANY_SEL);
      if (!company) { setStatus('\u26A0 Could not detect company name.'); return; }
      if (rules.find(r => r.type === 'companyhi' && r.value.toLowerCase() === company.toLowerCase())) {
        setStatus('\u26A0 Highlight rule already exists for: ' + company);
        return;
      }
      addRule('companyhi', company, 'Company to Highlight: ' + company);
      clearHighlights();
      applyAllRules();
      if (panelOpen) renderRules();
      setStatus('Highlight rule added for ' + company);
    });

    qdBtn.addEventListener('click', e => {
      e.stopPropagation();
      menu.style.display = 'none';
      if (!currentCard) return;
      const company = cardText(currentCard, COMPANY_SEL);
      if (!company) { setStatus('\u26A0 Could not detect company name.'); return; }
      const dismissed = dismissRule({ type: 'companydismiss', value: company, label: 'Quick: ' + company });
      setStatus('Quick dismiss \u2014 ' + dismissed + ' card(s) for ' + company);
    });
  }

  // ─── Apply capture ────────────────────────────────────────────────────────────

  const DETAIL_TITLE_SEL   = '.jobs-unified-top-card__job-title h1 a, .job-details-jobs-unified-top-card__job-title h1 a';
  const DETAIL_COMPANY_SEL = '.jobs-unified-top-card__company-name a, .job-details-jobs-unified-top-card__company-name a';
  const YES_BTN_SEL        = '[data-view-name="offsite-apply-confirmation-banner-reply-yes"]';
  const EASY_APPLY_SUBMIT  = '[data-live-test-easy-apply-submit-button]';
  const VIEW_CONFIRM_SEL   = '[componentkey="AppliedHowYouFitSlot"]';

  function captureAppliedJob() {
    const titleEl   = document.querySelector(DETAIL_TITLE_SEL);
    const companyEl = document.querySelector(DETAIL_COMPANY_SEL);

    const title   = titleEl   ? titleEl.textContent.trim()   : '';
    const company = companyEl ? companyEl.textContent.trim() : '';
    if (!title && !company) return;

    const href   = titleEl ? (titleEl.getAttribute('href') || '') : '';
    const jobIdM = href.match(/\/jobs\/view\/(\d+)/);
    const url    = jobIdM
      ? 'https://www.linkedin.com/jobs/view/' + jobIdM[1] + '/'
      : window.location.href;

    const date = localDateStr();

    const dup = appliedLog.find(e =>
      e.company.toLowerCase() === company.toLowerCase() &&
      e.title.toLowerCase()   === title.toLowerCase()
    );
    if (dup) {
      setStatus('\u2139 Already in log: ' + (title || company));
      return;
    }

    appliedLog.push({ company, title, date, url });
    saveAppliedLog();
    clearHighlights();
    applyAllRules();
    if (panelOpen) renderRules();

    const htmlText = '<table><tr><td>' + company + '</td><td>' + title + '</td><td><a href="' + url + '">' + url + '</a></td></tr></table>';
    const plainText = company + '\t' + title + '\t' + url;
    navigator.clipboard.write([
      new ClipboardItem({
        'text/html':  new Blob([htmlText],  { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      }),
    ]).catch(() => navigator.clipboard.writeText(plainText));

    setStatus('\u2713 Logged & copied: ' + (title || company));
  }

  function resetCard(card) {
    card.style.removeProperty('background-color');
    card.style.removeProperty('border-left');
    card.style.removeProperty('box-sizing');
    delete card.dataset.ljfHighlighted;
    delete card.dataset.ljfDismissed;
    delete card.dataset.ljfGreenMatch;
    delete card.dataset.ljfRulesApplied;
    delete card.dataset.ljfJobLog;
    delete card.dataset.ljfJobLogLabel;
    delete card.dataset.ljfDismissLog;
    card.querySelectorAll('.ljf-badge').forEach(b => b.remove());
    const inner = card.querySelector('.job-card-container');
    if (inner) inner.style.removeProperty('border-left');
  }

function setupApplyCapture() {
    document.addEventListener('click', e => {
      if (e.target.closest(YES_BTN_SEL) || e.target.closest(EASY_APPLY_SUBMIT)) captureAppliedJob();
      const undoBtn = e.target.closest(UNDO_SEL);
      if (undoBtn) {
        const card = undoBtn.closest(CARD_SEL);
        if (card) resetCard(card);
        setTimeout(() => { clearHighlights(); applyAllRules(); }, 400);
      }
      // Capture native X dismiss button clicks to log the dismissal
      const dismissBtn = e.target.closest(DISMISS_SEL);
      if (dismissBtn) {
        const card = dismissBtn.closest(CARD_SEL);
        if (card && !isDismissed(card)) {
          logDismissal(card);
          card.dataset.ljfDismissed = '1';
          updateTabCount();
        } else if (!card) {
          // Dismissed from the job detail panel — the button has no card ancestor.
          // Locate the matching list card by the job ID in the URL.
          const jobId = new URLSearchParams(window.location.search).get('currentJobId');
          const link = jobId ? document.querySelector('a[href*="/jobs/view/' + jobId + '"]') : null;
          const listCard = link ? link.closest(CARD_SEL) : null;
          if (listCard && !isDismissed(listCard)) {
            logDismissal(listCard);
            listCard.dataset.ljfDismissed = '1';
            updateTabCount();
          }
        }
      }
    }, true);
  }

  function captureViewPageAppliedJob() {
    // Parse "Job Title | Company Name | LinkedIn" from document.title
    const parts   = document.title.split(' | ');
    const title   = (parts[0] || '').trim();
    const company = (parts[1] || '').trim();
    if (!title && !company) return;

    const jobIdM = window.location.pathname.match(/\/jobs\/view\/(\d+)/);
    const url    = jobIdM
      ? 'https://www.linkedin.com/jobs/view/' + jobIdM[1] + '/'
      : window.location.href;

    const dup = appliedLog.find(e =>
      e.company.toLowerCase() === company.toLowerCase() &&
      e.title.toLowerCase()   === title.toLowerCase()
    );
    if (dup) {
      setStatus('\u2139 Already in log: ' + (title || company));
      return;
    }

    const date = localDateStr();
    appliedLog.push({ company, title, date, url });
    saveAppliedLog();
    clearHighlights();
    applyAllRules();
    if (panelOpen) renderRules();

    const htmlText  = '<table><tr><td>' + company + '</td><td>' + title + '</td><td><a href="' + url + '">' + url + '</a></td></tr></table>';
    const plainText = company + '\t' + title + '\t' + url;
    navigator.clipboard.write([
      new ClipboardItem({
        'text/html':  new Blob([htmlText],  { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      }),
    ]).catch(() => navigator.clipboard.writeText(plainText));

    setStatus('\u2713 Logged & copied: ' + (title || company));
  }

  function setupViewPageApplyCapture() {
    if (!/\/jobs\/view\/\d+/.test(window.location.pathname)) return;

    let captured = false;
    const observer = new MutationObserver(() => {
      if (captured) return;
      if (!document.querySelector(VIEW_CONFIRM_SEL)) return;
      captured = true;
      observer.disconnect();
      captureViewPageAppliedJob();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────────────

  function maybeBootstrap() {
    if (!rules.find(r => r.type === 'applied')) {
      addRule('applied', '_applied_', 'Already Applied');
    }
  }

  function init() {
    maybeBootstrap();
    buildUI();
    if (document.head) {
      new MutationObserver(() => {
        if (!document.getElementById('ljf-styles')) { buildPanelStyles(); setPanelVars(); }
      }).observe(document.head, { childList: true });
    }
    setupCardHoverMenu();
    setupApplyCapture();
    setupViewPageApplyCapture();
    setTimeout(() => {
      const n = applyAllRules();
      setStatus('Initial scan \u2014 ' + n + ' card(s) matched.');
    }, 1800);
    if (GM_getValue('ljf_onboarded', 'false') !== 'true') {
      setTimeout(openOnboardingModal, 600);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
