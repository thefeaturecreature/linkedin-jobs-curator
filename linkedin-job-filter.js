// noinspection SpellCheckingInspection,JSUnresolvedVariable,DuplicatedCode,JSCheckFunctionSignatures
// ==UserScript==
// @name         LinkedIn Job Filter
// @namespace    Monkey Scripts
// @version      1.3.0
// @description  DOM-only job card filtering with rule manager overlay
// @match        https://www.linkedin.com/jobs/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────────

  const STORAGE_KEY    = 'ljf_rules';
  const LOG_KEY        = 'ljf_applied_log';
  const SOURCE_URL     = '';

  const CARD_SEL    = 'li.jobs-search-results__list-item, li.scaffold-layout__list-item';
  const TITLE_SEL   = '.job-card-list__title--link, .job-card-container__link';
  const COMPANY_SEL = '.artdeco-entity-lockup__subtitle span';
  const SALARY_SEL  = '.job-card-container__metadata-item, .job-card-container__metadata-wrapper li span';
  const APPLIED_SEL = '.job-card-container__footer-job-state';
  const DISMISS_SEL = 'button.job-card-container__action';
  const UNDO_SEL    = 'button.artdeco-button--circle';   // undo/restore button shown after dismiss

  // Rule type definitions
  // applied / salarybelow / topsalarybelow are rendered as permanent sticky blocks, not listed in dropdown
  const RULE_TYPES = {
    applied:        { label: 'Already Applied',        match: matchApplied        },
    topsalarybelow: { label: 'Top Salary Below ($k)',   match: matchTopSalary      },
    salarybelow:    { label: 'Salary Below ($k)',        match: matchSalary         },
    companydismiss: { label: 'Company to Dismiss',      match: matchCompany         },
    titledismiss:   { label: 'Title to Dismiss',        match: matchTitle           },
    companyhi:      { label: 'Company to Highlight',    match: matchCompanyHi,  highlight: true },
    titlehi:        { label: 'Title to Highlight',      match: matchTitleHi,    highlight: true },
    topsalaryabove: { label: 'Top Salary Above ($k)',   match: matchTopSalaryAbove, highlight: true },
    salaryabove:    { label: 'Salary Above ($k)',        match: matchSalaryAbove,    highlight: true },
  };

  // Types shown in the add-rule dropdown (salary types conditionally disabled)
  const DROPDOWN_TYPES = ['companydismiss', 'titledismiss', 'topsalarybelow', 'salarybelow', 'companyhi', 'titlehi', 'topsalaryabove', 'salaryabove'];

  // ─── Semantic card-overlay colors ─────────────────────────────────────────────
  // Applied as transparent RGBA over LinkedIn's own card backgrounds.
  // Single set — LinkedIn handles its own dark/light theming for the base card.
  const CC = {
    // Dismiss (red)
    dismissBg:       'rgba(200,40,40,0.10)',
    dismissBorder:   'rgba(200,40,40,0.55)',
    dismissBadge:    'rgba(180,30,30,0.80)',
    // Highlight (green)
    highlightBg:     'rgba(40,180,40,0.11)',
    highlightBorder: 'rgba(40,180,40,0.55)',
    highlightBadge:  'rgba(30,150,30,0.82)',
    // Job log — recent company match (yellow)
    recentBg:        'rgba(200,170,0,0.13)',
    recentBorder:    'rgba(200,170,0,0.60)',
    recentBadge:     'rgba(160,130,0,0.88)',
    // Dismissed/undo state (orange)
    dismissedBg:     'rgba(200,120,0,0.12)',
    dismissedBorder: 'rgba(200,120,0,0.55)',
    dismissedBadge:  'rgba(180,100,0,0.85)',
    // Old company-label badge (gray, no card tint)
    staleBadge:      'rgba(80,80,90,0.72)',
  };

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
  let jobLogEnabled         = GM_getValue('ljf_jobLogEnabled', 'true') !== 'false';
  let dismissActionsEnabled = GM_getValue('ljf_dismissActions', 'false') === 'true';
  let panelOpen          = false;
  let editingRuleId      = null;
  let editingOrigType    = null;
  let collapsedSections  = {
    dismissSection:   false,
    companydismiss:   false,
    titledismiss:     false,
    highlightSection: false,
    companyhi:        false,
    titlehi:          false,
  };
  let darkMode           = GM_getValue('ljf_darkMode', 'dark') !== 'light';
  let hoverMenuEnabled   = GM_getValue('ljf_hoverMenu', 'true') !== 'false';

  function t() { return darkMode ? THEMES.dark : THEMES.light; }

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

  // Returns all salary values (annualised) found across all salary elements on a card.
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
    const escaped = entryCompany.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + escaped + '\\b').test(cardCompany.toLowerCase());
  }

  // Returns the first matching log entry if card's company+title match, else null.
  function matchJobLog(card) {
    if (!jobLogEnabled || appliedLog.length === 0) return null;
    const company = cardText(card, COMPANY_SEL).toLowerCase();
    const title   = cardText(card, TITLE_SEL).toLowerCase();
    if (!company && !title) return null;
    return appliedLog.find(e =>
      logCompanyMatches(company, e.company) &&
      e.title && title.includes(e.title.toLowerCase())
    ) || null;
  }

  // Returns the latest date string for this company if company matches but no title matches, else null.
  function matchJobLogCompanyOnly(card) {
    if (!jobLogEnabled || appliedLog.length === 0) return null;
    const company = cardText(card, COMPANY_SEL).toLowerCase();
    if (!company) return null;
    const companyEntries = appliedLog.filter(e => logCompanyMatches(company, e.company));
    if (companyEntries.length === 0) return null;
    const title = cardText(card, TITLE_SEL).toLowerCase();
    const hasTitleMatch = companyEntries.some(e => e.title && title.includes(e.title.toLowerCase()));
    if (hasTitleMatch) return null; // full match — handled by matchJobLog
    const dates = companyEntries.map(e => e.date || '').filter(Boolean).sort();
    return dates.length > 0 ? dates[dates.length - 1] : '';
  }

  // ─── Core: scan & act ────────────────────────────────────────────────────────

  function getCards() {
    return document.querySelectorAll(CARD_SEL);
  }

  // Count how many visible cards a single rule matches (no visual side-effects).
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
      'pointer-events:none', 'z-index:9999',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif', 'line-height:1.4',
    ].join(';');
    card.appendChild(badge);
  }

  // Apply all rules to one card, stacking a badge per matching rule.
  // Returns the number of rules that matched.
  function applyCardRules(card) {
    if (isDismissed(card)) { markDismissed(card); return 0; }
    if (card.dataset.ljfRulesApplied) return 0; // already processed this scan

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

    card.style.position = 'relative';

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

    // Stacked badges: dismiss at the bottom, highlight labels above.
    for (const rule of shownDismiss)   addBadge(card, '\u26F3 ' + rule.label, CC.dismissBadge);
    for (const rule of shownHighlight) addBadge(card, '\u2605 ' + rule.label, CC.highlightBadge);

    card.dataset.ljfRulesApplied = '1';
    return dismissMatches.length + highlightMatches.length;
  }

  function applyAllRules() {
    let total = 0;
    for (const card of getCards()) total += applyCardRules(card);
    applyJobLog();
    updateTabCount();
    return total;
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

  function daysAgo(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d)) return null;
    const diff = Math.round((Date.now() - d.getTime()) / 86400000);
    return diff >= 0 ? diff : null;
  }

  function actJobLogCompanyLabel(card, date) {
    if (isDismissed(card)) return;
    if (card.dataset.ljfJobLogLabel) return; // already labelled
    const days = daysAgo(date);
    const reapplyOk = days !== null && days >= 14;
    const isRecent  = days !== null && days < 14;

    const n = card.querySelectorAll('.ljf-badge').length;
    const badge = document.createElement('span');
    badge.className = 'ljf-badge';
    badge.style.cssText = [
      'position:absolute', `bottom:${6 + n * 20}px`, 'right:20px',
      `background:${isRecent ? CC.recentBadge : CC.staleBadge}`, 'color:#fff',
      'font-size:10px', 'padding:2px 7px', 'border-radius:3px',
      'pointer-events:none', 'z-index:9999',
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
    if (card.dataset.ljfJobLog) return; // already labelled
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

  function markDismissed(card) {
    card.style.setProperty('background-color', CC.dismissedBg, 'important');
    card.style.setProperty('border-left', '3px solid ' + CC.dismissedBorder, 'important');
    card.style.setProperty('box-sizing', 'border-box', 'important');
    card.querySelectorAll('.ljf-badge').forEach(b => b.remove());
    card.style.position = 'relative';
    addBadge(card, '\u2716 dismissed', CC.dismissedBadge);
  }

  function dismissJobLog() {
    let dismissed = 0;
    for (const card of getCards()) {
      const entry = matchJobLog(card);
      if (entry && !isDismissed(card)) {
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

  function updateTabCount() {
    const cards   = [...getCards()];
    const pill    = document.getElementById('ljf-tab-dismiss-pill');
    const countEl = document.getElementById('ljf-tab-count');
    const btn     = document.getElementById('ljf-tab-dismiss');
    const greenEl = document.getElementById('ljf-tab-count-green');

    if (pill && countEl) {
      const n = cards.filter(c => (c.dataset.ljfHighlighted || c.dataset.ljfJobLog) && !isDismissed(c)).length;
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
  }

  function clearHighlights() {
    for (const card of getCards()) {
      card.style.removeProperty('background-color');
      card.style.removeProperty('border-left');
      card.style.removeProperty('box-sizing');
      delete card.dataset.ljfHighlighted;
      delete card.dataset.ljfDismissed;
      delete card.dataset.ljfGreenMatch;
      delete card.dataset.ljfRulesApplied;
      card.querySelectorAll('.ljf-badge').forEach(b => b.remove());
      delete card.dataset.ljfJobLog;
      delete card.dataset.ljfJobLogLabel;
    }
    updateTabCount();
  }

  // Clears ljfDismissed on any card we marked as dismissed but LinkedIn has since restored.
  // Detected by: undo button gone AND dismiss button back — meaning LinkedIn processed the undo.
  function reconcileDismissedCards() {
    for (const card of getCards()) {
      if (card.dataset.ljfDismissed) {
        const hasUndo    = !!card.querySelector(UNDO_SEL);
        const hasDismiss = !!card.querySelector(DISMISS_SEL);
        if (hasDismiss && !hasUndo) {
          // Card was manually undismissed — clear all markers so it gets a fresh pass.
          delete card.dataset.ljfDismissed;
          delete card.dataset.ljfRulesApplied;
          delete card.dataset.ljfJobLog;
          delete card.dataset.ljfJobLogLabel;
          card.style.removeProperty('background-color');
          card.style.removeProperty('border-left');
          card.style.removeProperty('box-sizing');
          card.querySelectorAll('.ljf-badge').forEach(b => b.remove());
        }
      }
    }
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────────

  let scanTimeout = null;
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => { reconcileDismissedCards(); applyAllRules(); }, 700);
  });
  observer.observe(document.body, { childList: true, subtree: true });

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
      '"></span>';
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
      'width:340px',
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
      tab.style.right = panelOpen ? '340px' : '0';
      if (panelOpen) renderRules();
    });

    document.getElementById('ljf-tab-dismiss').addEventListener('click', e => {
      e.stopPropagation();
      let dismissed = 0;
      for (const rule of rules) {
        if (!RULE_TYPES[rule.type]?.highlight) dismissed += dismissRule(rule);
      }
      if (jobLogEnabled) dismissed += dismissJobLog();
      updateTabCount();
      setStatus('\u2014 ' + dismissed + ' card(s) dismissed.');
    });

    buildPanelContent();
  }

  function buildPanelHTML() {
    const th = t();
    return `
<div id="ljf-header" style="
  background:${th.headerBg};padding:12px 14px;
  display:flex;align-items:center;justify-content:space-between;
  border-bottom:1px solid ${th.border1};flex-shrink:0;">
  <strong style="font-size:14px;letter-spacing:.3px;">LinkedIn Job Filter</strong>
  <button id="ljf-gear" title="Settings" style="
    background:none;border:none;color:${th.gearText};cursor:pointer;
    font-size:15px;padding:2px 4px;line-height:1;border-radius:3px;">&#9881;</button>
</div>

${dismissActionsEnabled ? `
<div style="padding:10px 14px;border-bottom:1px solid ${th.border2};flex-shrink:0;">
  <button id="ljf-run-all" style="
    width:100%;background:${th.dismissBg};color:${th.dismissBtnText};border:1px solid ${th.dismissBtnBorder};border-radius:4px;
    padding:8px;cursor:pointer;font-size:12px;font-weight:600;">
    &#10005; Dismiss All
  </button>
</div>` : ''}

<div id="ljf-rules-list" style="flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 14px;"></div>

<div id="ljf-add-form" style="
  border-top:1px solid ${th.border2};padding:12px 14px;flex-shrink:0;background:${th.formBg};">
  <div id="ljf-add-form-title" style="font-size:10px;color:${th.labelText};margin-bottom:7px;text-transform:uppercase;letter-spacing:.6px;">Add Rule</div>
  <select id="ljf-type-sel" style="
    width:100%;background:${th.inputBg};color:${th.inputText};border:1px solid ${th.inputBorder};
    border-radius:4px;padding:5px 8px;margin-bottom:6px;font-size:12px;">
    ${DROPDOWN_TYPES.map(k => `<option value="${k}">${RULE_TYPES[k].label}</option>`).join('')}
  </select>
  <input id="ljf-value-input" type="text"
    placeholder="Value  (e.g. Ethos, 100, Sales...)"
    style="width:100%;box-sizing:border-box;background:${th.inputBg};color:${th.inputText};border:1px solid ${th.inputBorder};
      border-radius:4px;padding:5px 8px;margin-bottom:6px;font-size:12px;"/>
  <input id="ljf-label-input" type="text"
    placeholder="Label  (optional)"
    style="width:100%;box-sizing:border-box;background:${th.inputBg};color:${th.inputText};border:1px solid ${th.inputBorder};
      border-radius:4px;padding:5px 8px;margin-bottom:8px;font-size:12px;"/>
  <button id="ljf-add-btn" style="
    width:100%;background:${th.addBg};color:${th.addBtnText};border:1px solid ${th.dismissBtnBorder};border-radius:4px;
    padding:8px;cursor:pointer;font-size:12px;font-weight:600;">
    + Add Rule
  </button>
</div>

${dismissActionsEnabled ? `
<div style="padding:10px 14px;border-bottom:1px solid ${th.border2};flex-shrink:0;">
  <div style="font-size:10px;color:${th.labelText};margin-bottom:7px;text-transform:uppercase;letter-spacing:.6px;">Quick Dismiss</div>
  <div style="display:flex;gap:6px;align-items:center;">
    <input id="ljf-quick-company" type="text" placeholder="Company name"
      style="flex:1;box-sizing:border-box;background:${th.inputBg};color:${th.inputText};border:1px solid ${th.inputBorder};
        border-radius:4px;padding:5px 8px;font-size:12px;"/>
    <button id="ljf-quick-dismiss" style="
      background:${th.dismissBg};color:${th.dismissBtnText};border:1px solid ${th.dismissBtnBorder};border-radius:4px;
      padding:5px 12px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;">
      Dismiss
    </button>
  </div>
</div>` : ''}

<div id="ljf-status" style="
  background:${th.statusBg};padding:5px 14px;font-size:11px;color:${th.statusText};
  border-top:1px solid ${th.border3};flex-shrink:0;">Ready</div>
`;
  }

  function wirePanelEvents() {
    document.getElementById('ljf-run-all')?.addEventListener('click', () => {
      let dismissed = 0;
      for (const rule of rules) dismissed += dismissRule(rule);
      if (jobLogEnabled) dismissed += dismissJobLog();
      setStatus('\u2014 ' + dismissed + ' card(s) dismissed.');
    });

    document.getElementById('ljf-quick-dismiss')?.addEventListener('click', () => {
      const company = document.getElementById('ljf-quick-company').value.trim();
      if (!company) { setStatus('\u26A0 Enter a company name.'); return; }
      const dismissed = dismissRule({ type: 'companydismiss', value: company, label: 'Quick: ' + company });
      document.getElementById('ljf-quick-company').value = '';
      setStatus('Quick dismiss: ' + dismissed + ' card(s) dismissed.');
    });

    document.getElementById('ljf-quick-company')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('ljf-quick-dismiss').click();
    });

    document.getElementById('ljf-add-btn').addEventListener('click', handleAddRule);

    ['ljf-value-input', 'ljf-label-input'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') handleAddRule();
        if (e.key === 'Escape') cancelEdit();
      });
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
          // Cancel edit; keep newly-selected type, clear filled-in values
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

    // Apply placeholder styling for current theme
    let styleEl = document.getElementById('ljf-placeholder-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'ljf-placeholder-style';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      #ljf-value-input::placeholder, #ljf-label-input::placeholder, #ljf-quick-company::placeholder { color:#999 !important; }
    `;
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
    panel.style.background = th.panelBg;
    panel.style.color = th.panelText;
    panel.innerHTML = buildPanelHTML();
    wirePanelEvents();
    updateTabTheme();
    if (panelOpen) renderRules();
  }

  function toggleDarkMode() {
    editingRuleId   = null;
    editingOrigType = null;
    darkMode = !darkMode;
    GM_setValue('ljf_darkMode', darkMode ? 'dark' : 'light');
    buildPanelContent();
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
    const TABS = ['Settings', 'Backup'];
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
      if (activeTab === 'Settings') {
        const divider = () => {
          const d = document.createElement('div');
          d.style.cssText = `border-top:1px solid ${th.border2};margin:2px 0;`;
          return d;
        };
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
        content.appendChild(mkRow('Dismiss Actions', mkToggle(dismissActionsEnabled, checked => {
          dismissActionsEnabled = checked;
          GM_setValue('ljf_dismissActions', checked ? 'true' : 'false');
          overlay.remove();
          buildPanelContent();
          updateTabCount();
        })));
      } else {
        const grid = document.createElement('div');
        grid.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
        grid.appendChild(mkBackupBtn('\u2197 Export Rules', exportRules));
        grid.appendChild(mkBackupBtn('\u2198 Import Rules', importRules));
        grid.appendChild(mkBackupBtn('\u2197 Export Log',   exportAppliedLog));
        grid.appendChild(mkBackupBtn('\u2198 Import Log',   importAppliedLog));
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
      const id = editingRuleId;
      updateRule(id, value, finalLabel);
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
          if (!Array.isArray(data.rules) || data.rules.length === 0) {
            setStatus('\u26A0 No rules found in file.');
            return;
          }
          showImportDialog(data.rules, data.darkMode, data.jobLogEnabled);
        } catch {
          setStatus('\u26A0 Failed to parse rules file.');
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

  function showImportDialog(incoming, importedDarkMode, importedJobLogEnabled) {
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

  function exportAppliedLog() {
    const payload = {
      script:      'LinkedIn Job Filter',
      exported:    new Date().toISOString(),
      appliedLog:  appliedLog,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'linkedin-applied-log.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Applied log exported (' + appliedLog.length + ' entries).');
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
          if (!incoming || incoming.length === 0) {
            setStatus('\u26A0 No log entries found in file.');
            return;
          }
          showLogImportDialog(incoming);
        } catch {
          setStatus('\u26A0 Failed to parse log file.');
        }
      });
      reader.readAsText(file);
    });
    input.click();
  }

  function showLogImportDialog(incoming) {
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

    const countLabel = incoming.length + ' entr' + (incoming.length !== 1 ? 'ies' : 'y');
    modal.innerHTML = `
<div style="font-size:14px;font-weight:600;margin-bottom:8px;">Import Applied Log</div>
<div style="font-size:12px;color:${th.ruleType};margin-bottom:18px;">
  ${escHtml(countLabel)} found. Overwrite the existing log, or append to it?
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

    modal.querySelector('#ljf-limp-cancel').addEventListener('click', () => overlay.remove());

    modal.querySelector('#ljf-limp-append').addEventListener('click', () => {
      appliedLog.push(...incoming);
      saveAppliedLog();
      overlay.remove();
      clearHighlights();
      applyAllRules();
      if (panelOpen) renderRules();
      setStatus('Log imported \u2014 ' + incoming.length + ' entr' + (incoming.length !== 1 ? 'ies' : 'y') + ' appended.');
    });

    modal.querySelector('#ljf-limp-overwrite').addEventListener('click', () => {
      appliedLog = incoming;
      saveAppliedLog();
      overlay.remove();
      clearHighlights();
      applyAllRules();
      if (panelOpen) renderRules();
      setStatus('Log imported \u2014 ' + incoming.length + ' entr' + (incoming.length !== 1 ? 'ies' : 'y') + ' (replaced).');
    });
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  function renderRules() {
    const list = document.getElementById('ljf-rules-list');
    if (!list) return;
    list.innerHTML = '';

    const companyDismiss = rules.filter(r => r.type === 'companydismiss');
    const titleDismiss   = rules.filter(r => r.type === 'titledismiss');
    const companyHi      = rules.filter(r => r.type === 'companyhi');
    const titleHi        = rules.filter(r => r.type === 'titlehi');

    // ── Dismiss Rules ─────────────────────────────────────────────────────────
    const dCollapsed = collapsedSections.dismissSection;
    list.appendChild(renderSectionHeader('Dismiss Rules', 'dismissSection', ['companydismiss', 'titledismiss']));
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

    // ── Divider ───────────────────────────────────────────────────────────────
    const divider = document.createElement('div');
    divider.style.cssText = `border-top:1px solid ${t().border1};margin:10px 0 2px;`;
    list.appendChild(divider);

    // ── Highlight Rules ───────────────────────────────────────────────────────
    const hCollapsed = collapsedSections.highlightSection;
    list.appendChild(renderSectionHeader('Highlight Rules', 'highlightSection', ['companyhi', 'titlehi']));
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

    updateDropdownBlockedOptions();
    updateLabelVisibility();
  }

  function renderAppliedBlock(rule) {
    const th = t();
    const div = document.createElement('div');
    div.style.cssText = [
      'padding:8px 10px', 'margin-bottom:4px',
      `background:${th.dimRowBg}`, `border:1px solid ${th.dimRowBorder}`, 'border-radius:5px',
    ].join(';');

    const enabled = rule ? rule.enabled : true;
    div.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
  <span style="font-size:12px;color:${th.ruleLabel};font-weight:600;flex:1;">LinkedIn Applied Label</span>
  ${dismissActionsEnabled ? `<button class="ljf-applied-dismiss" title="Dismiss all matching cards" style="
    flex-shrink:0;background:${th.greenBg};color:${th.greenText};border:1px solid ${th.greenBorder};
    border-radius:3px;padding:3px 8px;cursor:pointer;font-size:10px;white-space:nowrap;">✕ dismiss</button>` : ''}
  <button class="ljf-applied-toggle" title="${enabled ? 'Disable rule' : 'Enable rule'}" style="
    flex-shrink:0;border-radius:3px;width:28px;height:22px;padding:0;cursor:pointer;
    font-size:13px;font-weight:900;line-height:1;text-align:center;
    ${enabled
      ? `background:${th.greenBg};color:${th.greenText};border:1px solid ${th.greenBorder};`
      : `background:${th.redBg};color:${th.redText};border:1px solid ${th.redBorder};`
    }">${enabled ? '✓' : '✕'}</button>
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
    const th  = t();
    const count = appliedLog.length;
    const div = document.createElement('div');
    div.style.cssText = [
      'padding:8px 10px', 'margin-bottom:4px',
      `background:${th.logRowBg}`, `border:1px solid ${th.logRowBorder}`, 'border-radius:5px',
    ].join(';');

    div.innerHTML = `
<div style="font-size:12px;color:${th.ruleLabel};font-weight:600;margin-bottom:5px;">Jobs Applied Log</div>
<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
  <span style="font-size:12px;color:${th.ruleLabel};font-weight:600;flex:1;">
    Job Log <span style="font-weight:400;font-size:10px;color:${th.countText};">(${count} entr${count !== 1 ? 'ies' : 'y'})</span>
  </span>
  ${dismissActionsEnabled ? `<button class="ljf-joblog-dismiss" title="Dismiss all matching cards" style="
    flex-shrink:0;background:${th.greenBg};color:${th.greenText};border:1px solid ${th.greenBorder};
    border-radius:3px;padding:3px 8px;cursor:pointer;font-size:10px;white-space:nowrap;">✕ dismiss</button>` : ''}
  <button class="ljf-joblog-toggle" title="${jobLogEnabled ? 'Disable job log matching' : 'Enable job log matching'}" style="
    flex-shrink:0;border-radius:3px;width:28px;height:22px;padding:0;cursor:pointer;
    font-size:13px;font-weight:900;line-height:1;text-align:center;
    ${jobLogEnabled
      ? `background:${th.greenBg};color:${th.greenText};border:1px solid ${th.greenBorder};`
      : `background:${th.redBg};color:${th.redText};border:1px solid ${th.redBorder};`
    }">${jobLogEnabled ? '✓' : '✕'}</button>
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
    const th = t();
    const typeLabel = RULE_TYPES[type].label;
    const hasValue  = !!(rule && rule.value);
    const display   = hasValue ? ('$' + rule.value + 'k') : 'Not set';

    const div = document.createElement('div');
    const activeBg     = isHighlight ? th.hiRowBg     : th.dimRowBg;
    const activeBorder = isHighlight ? th.hiRowBorder  : th.dimRowBorder;
    div.style.cssText = [
      'padding:8px 10px', 'margin-bottom:4px', 'cursor:pointer',
      `background:${hasValue ? activeBg : th.salaryOffBg}`,
      `border:1px solid ${hasValue ? activeBorder : th.salaryOffBorder}`,
      'border-radius:5px',
    ].join(';');

    div.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
  <div style="flex:1;min-width:0;">
    <div style="font-size:12px;color:${hasValue ? th.salaryOnTitle : th.salaryOffTitle};font-weight:600;">${escHtml(typeLabel)}</div>
    <div style="font-size:11px;color:${hasValue ? th.salaryOnVal : th.salaryOffVal};margin-top:2px;">${escHtml(display)}</div>
  </div>
  ${hasValue ? `
  ${(!isHighlight && dismissActionsEnabled) ? `<button class="ljf-salary-dismiss" title="Dismiss all matching cards" style="
    flex-shrink:0;background:${th.greenBg};color:${th.greenText};border:1px solid ${th.greenBorder};
    border-radius:3px;padding:3px 8px;cursor:pointer;font-size:10px;white-space:nowrap;">✕ dismiss</button>` : ''}
  <button class="ljf-salary-clear" title="Remove this rule" style="
    flex-shrink:0;background:${th.redBg};color:${th.redText};border:1px solid ${th.redBorder};
    border-radius:3px;width:28px;height:22px;padding:0;cursor:pointer;
    font-size:13px;font-weight:900;line-height:1;text-align:center;">✕</button>` : ''}
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
    const th = t();
    const sectionCollapsed = collapsedSections[sectionKey];
    const arrow = sectionCollapsed ? '▸' : '▾';
    const div = document.createElement('div');
    div.style.cssText = [
      'display:flex', 'align-items:center', 'gap:6px',
      `font-size:11px;color:${th.panelText}`, 'font-weight:700',
      'text-transform:uppercase', 'letter-spacing:.7px',
      'padding:6px 0 5px', 'cursor:pointer', 'user-select:none',
    ].join(';');
    div.innerHTML =
      `<span>${escHtml(label)}</span>` +
      `<span style="font-size:22px;color:${th.arrowText};margin-left:4px;line-height:0;position:relative;top:-2px;">${arrow}</span>`;
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
    const th = t();
    const collapsed = collapsedSections[sectionKey];
    const arrow = collapsed ? '▸' : '▾';
    const div = document.createElement('div');
    div.style.cssText = [
      'display:flex', 'align-items:center', 'gap:5px',
      `font-size:10px;color:${th.sectionTitle}`, 'text-transform:uppercase',
      'letter-spacing:.6px', 'padding:10px 0 4px',
      'cursor:pointer', 'user-select:none',
    ].join(';');
    div.innerHTML =
      `<span>${escHtml(label)}</span>` +
      `<span style="color:${th.countText};">(${count})</span>` +
      (count > 0 ? `<span style="font-size:22px;color:${th.arrowText};margin-left:4px;line-height:0;position:relative;top:-2px;">${arrow}</span>` : '');
    div.addEventListener('click', () => {
      if (count === 0) return;
      collapsedSections[sectionKey] = !collapsedSections[sectionKey];
      renderRules();
    });
    return div;
  }

  function renderRuleRow(rule) {
    const th = t();
    const isHiRule  = !!RULE_TYPES[rule.type]?.highlight;
    const rowBg     = isHiRule ? th.hiRowBg     : th.dimRowBg;
    const rowBorder = isHiRule ? th.hiRowBorder  : th.dimRowBorder;
    const row = document.createElement('div');
    row.style.cssText = [
      'display:flex', 'align-items:center', 'gap:7px',
      'padding:7px 8px', 'margin-bottom:3px',
      `background:${rowBg}`, `border:1px solid ${rowBorder}`,
      'border-radius:4px',
    ].join(';');

    const safeLabel  = escHtml(rule.label);
    const typeLabel  = escHtml(RULE_TYPES[rule.type]?.label || rule.type);

    row.innerHTML = `
<input type="checkbox" class="ljf-toggle" data-id="${rule.id}"
  ${rule.enabled ? 'checked' : ''}
  style="cursor:pointer;accent-color:#b91c1c;flex-shrink:0;margin:0;"/>
<div class="ljf-row-label" style="flex:1;min-width:0;cursor:pointer;" title="Click to edit">
  <div style="font-size:12px;color:${th.ruleLabel};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
    title="${safeLabel}">${safeLabel}</div>
  <div style="font-size:10px;color:${th.ruleType};margin-top:1px;">${typeLabel}</div>
</div>
${(!isHiRule && dismissActionsEnabled) ? `<button class="ljf-run-one" data-id="${rule.id}" title="Dismiss all matches for this rule" style="
  background:${th.greenBg};color:${th.greenText};border:1px solid ${th.greenBorder};border-radius:3px;
  padding:3px 8px;cursor:pointer;font-size:10px;flex-shrink:0;white-space:nowrap;">✕ dismiss</button>` : ''}
<button class="ljf-del" data-id="${rule.id}" title="Delete rule" style="
  flex-shrink:0;background:${th.redBg};color:${th.redText};border:1px solid ${th.redBorder};
  border-radius:3px;width:28px;height:22px;padding:0;cursor:pointer;
  font-size:13px;font-weight:900;line-height:1;text-align:center;">✕</button>`;

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
    const el = document.getElementById('ljf-status');
    if (el) el.textContent = msg;
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
      'position:fixed', 'z-index:99997',
      'display:none', 'flex-direction:column', 'align-items:center', 'gap:4px',
      'background:none', 'border:none', 'padding:0',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;flex-direction:row;gap:6px;';

    const btnBase = [
      'width:25px', 'height:25px', 'padding:0', 'border-radius:50%',
      'cursor:pointer', 'font-size:14px', 'font-weight:700',
      'line-height:1', 'text-align:center',
      'box-shadow:0 1px 4px rgba(0,0,0,.35)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');

    const dismissPlusBtn = document.createElement('button');
    dismissPlusBtn.title = 'Add to dismiss rules';
    dismissPlusBtn.textContent = '+';
    dismissPlusBtn.style.cssText = btnBase + ';background:#991b1b;color:#fff;border:none;';

    const highlightPlusBtn = document.createElement('button');
    highlightPlusBtn.title = 'Add to highlight rules';
    highlightPlusBtn.textContent = '+';
    highlightPlusBtn.style.cssText = btnBase + ';background:#166534;color:#fff;border:none;';

    const qdBtn = document.createElement('button');
    qdBtn.title = 'Quick dismiss this company';
    qdBtn.textContent = '\u00BB';
    qdBtn.style.cssText = btnBase + ';background:#854d0e;color:#fff;border:none;font-size:11px;';

    topRow.appendChild(dismissPlusBtn);
    topRow.appendChild(highlightPlusBtn);
    menu.appendChild(topRow);
    menu.appendChild(qdBtn);
    document.body.appendChild(menu);

    let currentCard = null;
    let hideTimeout = null;

    function showMenu(btn) {
      clearTimeout(hideTimeout);
      const card = btn.closest(CARD_SEL);
      if (!card) return;
      currentCard = card;
      qdBtn.style.display = dismissActionsEnabled ? 'flex' : 'none';
      menu.style.display = 'flex';
      requestAnimationFrame(() => {
        const rect = btn.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        menu.style.top  = (rect.bottom + 4) + 'px';
        menu.style.left = (centerX - menu.offsetWidth / 2) + 'px';
      });
    }

    function scheduleHide() {
      hideTimeout = setTimeout(() => {
        menu.style.display = 'none';
        currentCard = null;
      }, 200);
    }

    const HOVER_SEL = DISMISS_SEL + ', ' + UNDO_SEL;

    document.addEventListener('mouseover', e => {
      if (!hoverMenuEnabled) return;
      const btn = e.target.closest(HOVER_SEL);
      if (btn) showMenu(btn);
    });

    document.addEventListener('mouseout', e => {
      if (e.target.closest(HOVER_SEL)) scheduleHide();
    });

    menu.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
    menu.addEventListener('mouseleave', scheduleHide);

    document.addEventListener('scroll', () => {
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

    const date = new Date().toISOString().slice(0, 10);

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
    }, true);
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
    setupCardHoverMenu();
    setupApplyCapture();
    setTimeout(() => {
      const n = applyAllRules();
      setStatus('Initial scan \u2014 ' + n + ' card(s) matched.');
    }, 1800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
