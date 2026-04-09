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
  // applied / salary / topsalary are rendered as permanent sticky blocks, not listed in dropdown
  const RULE_TYPES = {
    applied:   { label: 'Already Applied',       match: matchApplied    },
    topsalary: { label: 'Top Salary Below ($k)',  match: matchTopSalary  },
    salary:    { label: 'Salary Below ($k)',      match: matchSalary     },
    company:   { label: 'Company Name',           match: matchCompany    },
    title:     { label: 'Title Keyword',          match: matchTitle      },
  };

  // Types shown in the add-rule dropdown (salary types conditionally disabled)
  const DROPDOWN_TYPES = ['company', 'title', 'topsalary', 'salary'];

  const THEMES = {
    dark: {
      panelBg:'#1c1c1c', panelText:'#e0e0e0',
      headerBg:'#111', formBg:'#151515', statusBg:'#111',
      border1:'#2e2e2e', border2:'#282828', border3:'#222',
      labelText:'#fff', sectionTitle:'#fff', countText:'#888', arrowText:'#888',
      ruleLabel:'#fff', ruleType:'#888', emptyText:'#555',
      rowBg:'#222', rowBorder:'#2a2a2a',
      appliedBg:'#1a1a2e', appliedBorder:'#2a2a4a', appliedText:'#a0a0c0',
      salaryOnBg:'#182018', salaryOnBorder:'#2a422a', salaryOnTitle:'#88bb88', salaryOnVal:'#5a8a5a',
      salaryOffBg:'#181818', salaryOffBorder:'#282828', salaryOffTitle:'#555', salaryOffVal:'#3a3a3a',
      inputBg:'#fff', inputText:'#000', inputBorder:'#ccc',
      tabBg:'#1a2d5a', tabAccent:'#7ab0ff',
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
      appliedBg:'#eef0ff', appliedBorder:'#b8c0f0', appliedText:'#3a4a9a',
      salaryOnBg:'#edfaed', salaryOnBorder:'#aad4aa', salaryOnTitle:'#226622', salaryOnVal:'#448844',
      salaryOffBg:'#f5f5f5', salaryOffBorder:'#d0d0d0', salaryOffTitle:'#999', salaryOffVal:'#bbb',
      inputBg:'#fff', inputText:'#000', inputBorder:'#bbb',
      tabBg:'#c7d6ff', tabAccent:'#4e7af7',
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
  let jobLogEnabled      = GM_getValue('ljf_jobLogEnabled', 'true') !== 'false';
  let panelOpen          = false;
  let editingRuleId      = null;
  let editingOrigType    = null;
  let collapsedSections  = { company: false, title: false };
  let darkMode           = GM_getValue('ljf_darkMode', 'dark') !== 'light';

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

  function applyRule(rule) {
    if (!rule.enabled) return { matched: 0 };
    const matcher = RULE_TYPES[rule.type]?.match;
    if (!matcher) return { matched: 0 };
    let matched = 0;
    for (const card of getCards()) {
      if (matcher(card, rule)) { matched++; act(card, rule); }
    }
    return { matched };
  }

  function applyAllRules() {
    let total = 0;
    for (const rule of rules) total += applyRule(rule).matched;
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
    if (card.querySelector('.ljf-badge')) return; // don't overwrite a real match badge
    const days = daysAgo(date);
    const reapplyOk = days !== null && days >= 14;
    const badge = document.createElement('span');
    badge.className = 'ljf-badge';
    badge.style.cssText = [
      'position:absolute', 'bottom:6px', 'right:5px',
      'background:rgba(80,80,90,0.72)', 'color:#fff',
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

    card.style.position = 'relative';
    card.appendChild(badge);
    card.dataset.ljfJobLogLabel = '1';
  }

  function act(card, rule) {
    if (!card.querySelector('.ljf-badge')) {
      const badge = document.createElement('span');
      badge.className = 'ljf-badge';
      badge.textContent = '\u26F3 ' + rule.label;
      badge.style.cssText = [
        'position:absolute', 'bottom:6px', 'right:5px',
        'background:rgba(180,30,30,0.80)', 'color:#fff',
        'font-size:10px', 'padding:2px 7px', 'border-radius:3px',
        'pointer-events:none', 'z-index:9999',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
        'line-height:1.4',
      ].join(';');
      card.style.position = 'relative';
      card.appendChild(badge);
    }
    if (isDismissed(card)) {
      markDismissed(card);
    } else {
      card.style.setProperty('background-color', 'rgba(200,40,40,0.10)', 'important');
      card.style.setProperty('border-left', '3px solid rgba(200,40,40,0.55)', 'important');
      card.style.setProperty('box-sizing', 'border-box', 'important');
      card.dataset.ljfHighlighted = rule.id;
    }
  }

  function actJobLog(card, entry) {
    if (isDismissed(card)) { markDismissed(card); return; }
    const alreadyRed = !!card.dataset.ljfHighlighted;
    const dateStr    = entry.date || '';
    const badgeText  = 'Applied' + (dateStr ? ' on ' + dateStr : '');
    const badgeBg    = alreadyRed ? 'rgba(180,30,30,0.80)' : 'rgba(160,130,0,0.88)';

    let badge = card.querySelector('.ljf-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ljf-badge';
      badge.style.cssText = [
        'position:absolute', 'bottom:6px', 'right:5px',
        'color:#fff', 'font-size:10px', 'padding:2px 7px', 'border-radius:3px',
        'pointer-events:none', 'z-index:9999',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif', 'line-height:1.4',
      ].join(';');
      card.style.position = 'relative';
      card.appendChild(badge);
    }
    badge.textContent = badgeText;
    badge.style.background = badgeBg;

    if (!alreadyRed) {
      card.style.setProperty('background-color', 'rgba(200,170,0,0.13)', 'important');
      card.style.setProperty('border-left', '3px solid rgba(200,170,0,0.60)', 'important');
      card.style.setProperty('box-sizing', 'border-box', 'important');
    }
    card.dataset.ljfJobLog = '1';
  }

  function markDismissed(card) {
    card.style.setProperty('background-color', 'rgba(200,120,0,0.12)', 'important');
    card.style.setProperty('border-left', '3px solid rgba(200,120,0,0.55)', 'important');
    card.style.setProperty('box-sizing', 'border-box', 'important');
    const badge = card.querySelector('.ljf-badge');
    if (badge) { badge.style.background = 'rgba(180,100,0,0.85)'; badge.textContent = '\u2716 dismissed'; }
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
    const el = document.getElementById('ljf-tab-count');
    if (!el) return;
    const n = [...getCards()].filter(c => (c.dataset.ljfHighlighted || c.dataset.ljfJobLog) && !isDismissed(c)).length;
    el.textContent = n > 0 ? n : '';
  }

  function clearHighlights() {
    for (const card of getCards()) {
      card.style.removeProperty('background-color');
      card.style.removeProperty('border-left');
      card.style.removeProperty('box-sizing');
      delete card.dataset.ljfHighlighted;
      delete card.dataset.ljfDismissed;
      card.querySelector('.ljf-badge')?.remove();
      delete card.dataset.ljfJobLog;
      delete card.dataset.ljfJobLogLabel;
    }
    updateTabCount();
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────────

  let scanTimeout = null;
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(applyAllRules, 700);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ─── UI ───────────────────────────────────────────────────────────────────────

  function buildUI() {
    const tab = document.createElement('div');
    tab.id = 'ljf-tab';
    tab.title = 'LinkedIn Job Filter';
    tab.innerHTML =
      '<span id="ljf-tab-flag" style="font-size:15px;line-height:1;color:#4e7af7;">&#9873;</span>' +
      '<span id="ljf-tab-count" style="font-size:10px;font-weight:700;line-height:1;margin-top:2px;"></span>' +
      '<button id="ljf-tab-dismiss" title="Dismiss All" style="' +
        'margin-top:5px;margin-left:1px;background:#4e7af7;color:#c7d6ff;border:none;' +
        'border-radius:10px;width:20px;height:20px;cursor:pointer;' +
        'font-size:11px;font-weight:700;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;' +
      '">&#10005;</button>';
    tab.style.cssText = [
      'position:fixed', 'right:0', 'top:50%',
      'transform:translateY(-50%)',
      'width:26px', 'min-height:54px',
      'background:#c7d6ff', 'color:#4e7af7',
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
      for (const rule of rules) dismissed += dismissRule(rule);
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
  <div style="position:relative;">
    <button id="ljf-gear" title="Settings" style="
      background:none;border:none;color:${th.gearText};cursor:pointer;
      font-size:15px;padding:2px 4px;line-height:1;border-radius:3px;">&#9881;</button>
    <div id="ljf-gear-menu" style="
      display:none;position:absolute;right:0;top:calc(100% + 4px);
      background:${th.gearMenuBg};border:1px solid ${th.gearMenuBorder};border-radius:4px;
      min-width:158px;z-index:100001;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.5);">
      <button class="ljf-gear-item" data-action="export" style="
        display:block;width:100%;background:none;color:${th.gearMenuText};border:none;
        text-align:left;padding:8px 12px;cursor:pointer;font-size:12px;">
        &#8599; Export Rules
      </button>
      <button class="ljf-gear-item" data-action="import" style="
        display:block;width:100%;background:none;color:${th.gearMenuText};border:none;
        text-align:left;padding:8px 12px;cursor:pointer;font-size:12px;
        border-top:1px solid ${th.gearMenuDivider};">
        &#8600; Import Rules
      </button>
      <button class="ljf-gear-item" data-action="exportlog" style="
        display:block;width:100%;background:none;color:${th.gearMenuText};border:none;
        text-align:left;padding:8px 12px;cursor:pointer;font-size:12px;
        border-top:1px solid ${th.gearMenuDivider};">
        &#8599; Export Log
      </button>
      <button class="ljf-gear-item" data-action="importlog" style="
        display:block;width:100%;background:none;color:${th.gearMenuText};border:none;
        text-align:left;padding:8px 12px;cursor:pointer;font-size:12px;
        border-top:1px solid ${th.gearMenuDivider};">
        &#8600; Import Log
      </button>
      <button class="ljf-gear-item" data-action="theme" style="
        display:block;width:100%;background:none;color:${th.gearMenuText};border:none;
        text-align:left;padding:8px 12px;cursor:pointer;font-size:12px;
        border-top:1px solid ${th.gearMenuDivider};">
        ${darkMode ? '&#9728; Light Mode' : '&#9790; Dark Mode'}
      </button>
    </div>
  </div>
</div>

<div style="padding:10px 14px;border-bottom:1px solid ${th.border2};flex-shrink:0;">
  <button id="ljf-run-all" style="
    width:100%;background:${th.dismissBg};color:${th.dismissBtnText};border:1px solid ${th.dismissBtnBorder};border-radius:4px;
    padding:8px;cursor:pointer;font-size:12px;font-weight:600;">
    &#10005; Dismiss All
  </button>
</div>

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
</div>

<div id="ljf-status" style="
  background:${th.statusBg};padding:5px 14px;font-size:11px;color:${th.statusText};
  border-top:1px solid ${th.border3};flex-shrink:0;">Ready</div>
`;
  }

  function wirePanelEvents() {
    document.getElementById('ljf-run-all').addEventListener('click', () => {
      let dismissed = 0;
      for (const rule of rules) dismissed += dismissRule(rule);
      if (jobLogEnabled) dismissed += dismissJobLog();
      setStatus('\u2014 ' + dismissed + ' card(s) dismissed.');
    });

    document.getElementById('ljf-quick-dismiss').addEventListener('click', () => {
      const company = document.getElementById('ljf-quick-company').value.trim();
      if (!company) { setStatus('\u26A0 Enter a company name.'); return; }
      const dismissed = dismissRule({ type: 'company', value: company, label: 'Quick: ' + company });
      document.getElementById('ljf-quick-company').value = '';
      setStatus('Quick dismiss: ' + dismissed + ' card(s) dismissed.');
    });

    document.getElementById('ljf-quick-company').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('ljf-quick-dismiss').click();
    });

    document.getElementById('ljf-add-btn').addEventListener('click', handleAddRule);

    ['ljf-value-input', 'ljf-label-input'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') handleAddRule();
        if (e.key === 'Escape') cancelEdit();
      });
    });

    // ── Gear menu ─────────────────────────────────────────────────────────────
    const gearBtn  = document.getElementById('ljf-gear');
    const gearMenu = document.getElementById('ljf-gear-menu');

    gearBtn.addEventListener('click', e => {
      e.stopPropagation();
      gearMenu.style.display = gearMenu.style.display === 'none' ? 'block' : 'none';
    });

    document.addEventListener('click', () => { gearMenu.style.display = 'none'; });
    gearMenu.addEventListener('click', e => e.stopPropagation());

    gearMenu.querySelectorAll('.ljf-gear-item').forEach(btn => {
      btn.addEventListener('click', () => {
        gearMenu.style.display = 'none';
        if (btn.dataset.action === 'export') exportRules();
        else if (btn.dataset.action === 'import') importRules();
        else if (btn.dataset.action === 'exportlog') exportAppliedLog();
        else if (btn.dataset.action === 'importlog') importAppliedLog();
        else if (btn.dataset.action === 'theme') toggleDarkMode();
      });
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
    const tab        = document.getElementById('ljf-tab');
    const flag       = document.getElementById('ljf-tab-flag');
    const dismissBtn = document.getElementById('ljf-tab-dismiss');
    if (!tab) return;
    const th = t();
    tab.style.background = th.tabBg;
    tab.style.color      = th.tabAccent;
    if (flag)       flag.style.color = th.tabAccent;
    if (dismissBtn) { dismissBtn.style.background = th.tabAccent; dismissBtn.style.color = th.tabBg; }
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
      if (opt.value === 'salary' || opt.value === 'topsalary') {
        const existing = rules.find(r => r.type === opt.value);
        opt.disabled = !!(existing && editingRuleId !== existing.id);
      }
    }
  }

  function updateLabelVisibility() {
    const sel = document.getElementById('ljf-type-sel');
    const labelInput = document.getElementById('ljf-label-input');
    if (!sel || !labelInput) return;
    const hide = sel.value === 'salary' || sel.value === 'topsalary';
    labelInput.style.display = hide ? 'none' : '';
  }

  // ─── Add / update rule handler ────────────────────────────────────────────────

  function handleAddRule() {
    const type  = document.getElementById('ljf-type-sel').value;
    const value = document.getElementById('ljf-value-input').value.trim();
    const label = document.getElementById('ljf-label-input').value.trim();

    if (!value) { setStatus('\u26A0 Enter a value first.'); return; }

    const typeLabel  = RULE_TYPES[type]?.label || type;
    const isSalary   = type === 'salary' || type === 'topsalary';
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
      clearHighlights();
      const { matched } = applyRule(rules[rules.length - 1]);
      setStatus('Rule added \u2014 ' + matched + ' card(s) matched.');
    }
    updateDropdownBlockedOptions();
  }

  // ─── Export / Import ─────────────────────────────────────────────────────────

  function exportRules() {
    const payload = {
      script:   'LinkedIn Job Filter',
      source:   SOURCE_URL,
      exported: new Date().toISOString(),
      darkMode: darkMode ? 'dark' : 'light',
      rules:    rules,
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
          showImportDialog(data.rules, data.darkMode);
        } catch {
          setStatus('\u26A0 Failed to parse rules file.');
        }
      });
      reader.readAsText(file);
    });
    input.click();
  }

  function showImportDialog(incoming, importedDarkMode) {
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

    const applyImportedTheme = () => {
      if (importedDarkMode === 'dark' || importedDarkMode === 'light') {
        const newDark = importedDarkMode !== 'light';
        if (newDark !== darkMode) {
          darkMode = newDark;
          GM_setValue('ljf_darkMode', importedDarkMode);
        }
      }
    };

    modal.querySelector('#ljf-imp-cancel').addEventListener('click', () => overlay.remove());

    modal.querySelector('#ljf-imp-append').addEventListener('click', () => {
      rules.push(...freshIds(incoming));
      saveRules();
      applyImportedTheme();
      overlay.remove();
      buildPanelContent();
      clearHighlights();
      applyAllRules();
      setStatus('Imported ' + incoming.length + ' rule(s) — appended.');
    });

    modal.querySelector('#ljf-imp-overwrite').addEventListener('click', () => {
      rules = freshIds(incoming);
      saveRules();
      applyImportedTheme();
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

    // ── 1. Always-visible sticky blocks ──────────────────────────────────────
    list.appendChild(renderAppliedBlock(rules.find(r => r.type === 'applied')));
    list.appendChild(renderJobLogBlock());
    list.appendChild(renderSalaryBlock('topsalary', rules.find(r => r.type === 'topsalary')));
    list.appendChild(renderSalaryBlock('salary',    rules.find(r => r.type === 'salary')));

    // ── 2. Dynamic rules grouped by type ─────────────────────────────────────
    const companyRules = rules.filter(r => r.type === 'company');
    const titleRules   = rules.filter(r => r.type === 'title');

    if (companyRules.length === 0 && titleRules.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `color:${t().emptyText};font-size:12px;padding:10px 0;`;
      empty.textContent = 'No rules yet. Add one below.';
      list.appendChild(empty);
    } else {
      if (companyRules.length > 0) {
        list.appendChild(renderGroupHeader('Companies', companyRules.length, 'company'));
        if (!collapsedSections.company) {
          for (const rule of companyRules) list.appendChild(renderRuleRow(rule));
        }
      }
      if (titleRules.length > 0) {
        list.appendChild(renderGroupHeader('Title Keywords', titleRules.length, 'title'));
        if (!collapsedSections.title) {
          for (const rule of titleRules) list.appendChild(renderRuleRow(rule));
        }
      }
    }

    updateDropdownBlockedOptions();
    updateLabelVisibility();
  }

  function renderAppliedBlock(rule) {
    const th = t();
    const div = document.createElement('div');
    div.style.cssText = [
      'padding:8px 10px', 'margin-bottom:4px',
      `background:${th.appliedBg}`, `border:1px solid ${th.appliedBorder}`, 'border-radius:5px',
    ].join(';');

    const enabled = rule ? rule.enabled : true;
    div.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
  <span style="font-size:12px;color:${th.appliedText};font-weight:600;flex:1;">LinkedIn Applied Label</span>
  <button class="ljf-applied-dismiss" title="Dismiss all matching cards" style="
    flex-shrink:0;background:${th.greenBg};color:${th.greenText};border:1px solid ${th.greenBorder};
    border-radius:3px;padding:3px 8px;cursor:pointer;font-size:10px;white-space:nowrap;">✕ dismiss</button>
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

    div.querySelector('.ljf-applied-dismiss').addEventListener('click', e => {
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
      `background:${th.appliedBg}`, `border:1px solid ${th.appliedBorder}`, 'border-radius:5px',
    ].join(';');

    div.innerHTML = `
<div style="font-size:12px;color:${th.appliedText};font-weight:600;margin-bottom:5px;">Jobs Applied Log</div>
<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
  <span style="font-size:12px;color:${th.appliedText};font-weight:600;flex:1;">
    Job Log <span style="font-weight:400;font-size:10px;color:${th.countText};">(${count} entr${count !== 1 ? 'ies' : 'y'})</span>
  </span>
  <button class="ljf-joblog-dismiss" title="Dismiss all matching cards" style="
    flex-shrink:0;background:${th.greenBg};color:${th.greenText};border:1px solid ${th.greenBorder};
    border-radius:3px;padding:3px 8px;cursor:pointer;font-size:10px;white-space:nowrap;">✕ dismiss</button>
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

    div.querySelector('.ljf-joblog-dismiss').addEventListener('click', e => {
      e.stopPropagation();
      const dismissed = dismissJobLog();
      setStatus('Job log \u2014 ' + dismissed + ' card(s) dismissed.');
    });

    return div;
  }

  function renderSalaryBlock(type, rule) {
    const th = t();
    const typeLabel = RULE_TYPES[type].label;
    const hasValue  = !!(rule && rule.value);
    const display   = hasValue ? ('$' + rule.value + 'k') : 'Not set';

    const div = document.createElement('div');
    div.style.cssText = [
      'padding:8px 10px', 'margin-bottom:4px', 'cursor:pointer',
      `background:${hasValue ? th.salaryOnBg : th.salaryOffBg}`,
      `border:1px solid ${hasValue ? th.salaryOnBorder : th.salaryOffBorder}`,
      'border-radius:5px',
    ].join(';');

    div.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
  <div style="flex:1;min-width:0;">
    <div style="font-size:12px;color:${hasValue ? th.salaryOnTitle : th.salaryOffTitle};font-weight:600;">${escHtml(typeLabel)}</div>
    <div style="font-size:11px;color:${hasValue ? th.salaryOnVal : th.salaryOffVal};margin-top:2px;">${escHtml(display)}</div>
  </div>
  ${hasValue ? `
  <button class="ljf-salary-dismiss" title="Dismiss all matching cards" style="
    flex-shrink:0;background:${th.greenBg};color:${th.greenText};border:1px solid ${th.greenBorder};
    border-radius:3px;padding:3px 8px;cursor:pointer;font-size:10px;white-space:nowrap;">✕ dismiss</button>
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
      `<span style="margin-left:auto;font-size:9px;color:${th.arrowText};">${arrow}</span>`;
    div.addEventListener('click', () => {
      collapsedSections[sectionKey] = !collapsedSections[sectionKey];
      renderRules();
    });
    return div;
  }

  function renderRuleRow(rule) {
    const th = t();
    const row = document.createElement('div');
    row.style.cssText = [
      'display:flex', 'align-items:center', 'gap:7px',
      'padding:7px 8px', 'margin-bottom:3px',
      `background:${th.rowBg}`, `border:1px solid ${th.rowBorder}`,
      'border-radius:4px',
    ].join(';');

    const safeLabel = escHtml(rule.label);
    const typeLabel = escHtml(RULE_TYPES[rule.type]?.label || rule.type);

    row.innerHTML = `
<input type="checkbox" class="ljf-toggle" data-id="${rule.id}"
  ${rule.enabled ? 'checked' : ''}
  style="cursor:pointer;accent-color:#b91c1c;flex-shrink:0;margin:0;"/>
<div class="ljf-row-label" style="flex:1;min-width:0;cursor:pointer;" title="Click to edit">
  <div style="font-size:12px;color:${th.ruleLabel};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
    title="${safeLabel}">${safeLabel}</div>
  <div style="font-size:10px;color:${th.ruleType};margin-top:1px;">${typeLabel}</div>
</div>
<button class="ljf-run-one" data-id="${rule.id}" title="Dismiss all matches for this rule" style="
  background:${th.greenBg};color:${th.greenText};border:1px solid ${th.greenBorder};border-radius:3px;
  padding:3px 8px;cursor:pointer;font-size:10px;flex-shrink:0;white-space:nowrap;">✕ dismiss</button>
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

    row.querySelector('.ljf-run-one').addEventListener('click', e => {
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
      'display:none', 'flex-direction:column', 'gap:4px',
      'background:none', 'border:none', 'padding:0',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');

    const btnBase = [
      'width:25px', 'height:25px', 'padding:0', 'border-radius:50%',
      'cursor:pointer', 'font-size:11px', 'font-weight:700',
      'line-height:1', 'text-align:center',
      'box-shadow:0 1px 4px rgba(0,0,0,.35)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');

    const addBtn = document.createElement('button');
    addBtn.title = 'Add company rule';
    addBtn.textContent = '+';
    addBtn.style.cssText = btnBase + ';background:#166534;color:#fff;border:none;font-size:14px;';

    const qdBtn = document.createElement('button');
    qdBtn.title = 'Quick dismiss this company';
    qdBtn.textContent = '\u00BB';
    qdBtn.style.cssText = btnBase + ';background:#854d0e;color:#fff;border:none;';

    menu.appendChild(addBtn);
    menu.appendChild(qdBtn);
    document.body.appendChild(menu);

    let currentCard = null;
    let hideTimeout = null;

    function showMenu(btn) {
      clearTimeout(hideTimeout);
      const card = btn.closest(CARD_SEL);
      if (!card) return;
      currentCard = card;
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
      const btn = e.target.closest(HOVER_SEL);
      if (btn) showMenu(btn);
    });

    document.addEventListener('mouseout', e => {
      if (e.target.closest(HOVER_SEL)) scheduleHide();
    });

    menu.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
    menu.addEventListener('mouseleave', scheduleHide);

    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      menu.style.display = 'none';
      if (!currentCard) return;
      const company = cardText(currentCard, COMPANY_SEL);
      if (!company) { setStatus('\u26A0 Could not detect company name.'); return; }
      if (rules.find(r => r.type === 'company' && r.value.toLowerCase() === company.toLowerCase())) {
        setStatus('\u26A0 Rule already exists for: ' + company);
        return;
      }
      const newRule = addRule('company', company, 'Company Name: ' + company);
      clearHighlights();
      applyAllRules();
      const dismissed = dismissRule(newRule);
      if (panelOpen) renderRules();
      setStatus('Rule added \u2014 ' + dismissed + ' card(s) dismissed for ' + company);
    });

    qdBtn.addEventListener('click', e => {
      e.stopPropagation();
      menu.style.display = 'none';
      if (!currentCard) return;
      const company = cardText(currentCard, COMPANY_SEL);
      if (!company) { setStatus('\u26A0 Could not detect company name.'); return; }
      const dismissed = dismissRule({ type: 'company', value: company, label: 'Quick: ' + company });
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
    setStatus('\u2713 Logged: ' + (title || company));
  }

  function setupApplyCapture() {
    document.addEventListener('click', e => {
      if (e.target.closest(YES_BTN_SEL) || e.target.closest(EASY_APPLY_SUBMIT)) captureAppliedJob();
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
