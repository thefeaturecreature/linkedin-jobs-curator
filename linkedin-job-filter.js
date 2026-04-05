// ==UserScript==
// @name         LinkedIn Job Filter
// @namespace    https://github.com/local/linkedin-job-filter
// @version      1.0.0
// @description  DOM-only job card filtering with rule manager overlay
// @match        https://www.linkedin.com/jobs/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────────

  const STORAGE_KEY = 'ljf_rules';

  const CARD_SEL    = 'li.jobs-search-results__list-item, li.scaffold-layout__list-item';
  const TITLE_SEL   = '.job-card-list__title--link, .job-card-container__link';
  const COMPANY_SEL = '.artdeco-entity-lockup__subtitle span';
  const SALARY_SEL  = '.job-card-container__metadata-item, .job-card-container__metadata-wrapper li span';
  const APPLIED_SEL = '.job-card-container__footer-job-state';
  const DISMISS_SEL = 'button.job-card-container__action';
  const JOB_ID_RE   = /\/jobs\/view\/(\d+)\//;

  // Rule type definitions
  const RULE_TYPES = {
    applied:  { label: 'Already Applied',   match: matchApplied  },
    company:  { label: 'Company Name',       match: matchCompany  },
    title:    { label: 'Title Keyword',      match: matchTitle    },
    salary:   { label: 'Salary Below ($k)',  match: matchSalary   },
    industry: { label: 'Industry Keyword',   match: matchIndustry },
    jobid:    { label: 'Job ID (exact)',      match: matchJobId    },
  };

  // ─── State ────────────────────────────────────────────────────────────────────

  let rules     = loadRules();
  let panelOpen = false;

  // ─── Storage helpers ─────────────────────────────────────────────────────────

  function loadRules() {
    try { return JSON.parse(GM_getValue(STORAGE_KEY, '[]')); }
    catch { return []; }
  }

  function saveRules() {
    GM_setValue(STORAGE_KEY, JSON.stringify(rules));
  }

  function addRule(type, value, label) {
    const rule = {
      id: Date.now(),
      type,
      value: value.trim(),
      label: label || value.trim(),
      enabled: true,
    };
    rules.push(rule);
    saveRules();
    return rule;
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

  function matchApplied(card /*, rule */) {
    const el = card.querySelector(APPLIED_SEL);
    return !!el && /applied/i.test(el.textContent);
  }

  function matchCompany(card, rule) {
    const co = cardText(card, COMPANY_SEL);
    return co.toLowerCase().includes(rule.value.toLowerCase());
  }

  function matchTitle(card, rule) {
    const title = cardText(card, TITLE_SEL);
    return title.toLowerCase().includes(rule.value.toLowerCase());
  }

  function matchSalary(card, rule) {
    // Dismisses if the *max* salary in the card is below threshold
    const threshold = parseFloat(rule.value) * 1000;
    if (isNaN(threshold)) return false;

    const items = card.querySelectorAll(SALARY_SEL);
    for (const el of items) {
      const text = el.textContent;
      // Match things like $80K, $80,000, $120K/yr, $80K–$160K
      const nums = [...text.matchAll(/\$(\d[\d,]*\.?\d*)\s*[Kk]?/g)].map(m => {
        let n = parseFloat(m[1].replace(/,/g, ''));
        const suffix = text.slice(m.index + m[0].length, m.index + m[0].length + 1);
        if (/[Kk]/.test(suffix) || /[Kk]/.test(m[0])) n *= 1000;
        return n;
      });
      if (nums.length === 0) continue;
      const maxSalary = Math.max(...nums);
      if (maxSalary < threshold) return true;
    }
    return false;
  }

  function matchIndustry(card, rule) {
    const full = card.textContent.toLowerCase();
    return full.includes(rule.value.toLowerCase());
  }

  function matchJobId(card, rule) {
    const link = card.querySelector('a[href*="/jobs/view/"]');
    if (!link) return false;
    const m = link.href.match(JOB_ID_RE);
    return !!(m && m[1] === rule.value.trim());
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
      if (matcher(card, rule)) {
        matched++;
        act(card, rule);
      }
    }
    return { matched };
  }

  function applyAllRules() {
    let total = 0;
    for (const rule of rules) {
      const { matched } = applyRule(rule);
      total += matched;
    }
    updateTabCount();
    return total;
  }

  // Red = detected, not yet dismissed
  function act(card, rule) {
    if (card.dataset.ljfDismissed) return; // already orange, leave it
    card.style.setProperty('background-color', 'rgba(200,40,40,0.10)', 'important');
    card.style.setProperty('border-left', '3px solid rgba(200,40,40,0.55)', 'important');
    card.style.setProperty('box-sizing', 'border-box', 'important');
    card.dataset.ljfHighlighted = rule.id;

    if (!card.querySelector('.ljf-badge')) {
      const badge = document.createElement('span');
      badge.className = 'ljf-badge';
      badge.textContent = '\u26F3 ' + rule.label;
      badge.style.cssText = [
        'position:absolute', 'top:6px', 'right:52px',
        'background:rgba(180,30,30,0.80)', 'color:#fff',
        'font-size:10px', 'padding:2px 7px', 'border-radius:3px',
        'pointer-events:none', 'z-index:9999',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
        'line-height:1.4',
      ].join(';');
      card.style.position = 'relative';
      card.appendChild(badge);
    }
  }

  // Orange = dismissed (LinkedIn X clicked)
  function markDismissed(card) {
    card.style.setProperty('background-color', 'rgba(200,120,0,0.12)', 'important');
    card.style.setProperty('border-left', '3px solid rgba(200,120,0,0.55)', 'important');
    card.style.setProperty('box-sizing', 'border-box', 'important');
    const badge = card.querySelector('.ljf-badge');
    if (badge) {
      badge.style.background = 'rgba(180,100,0,0.85)';
      badge.textContent = '\u2716 dismissed';
    }
  }

  // Clicks the LinkedIn dismiss X on all matching cards for a given rule
  function dismissRule(rule) {
    const matcher = RULE_TYPES[rule.type]?.match;
    if (!matcher) return 0;
    let dismissed = 0;
    for (const card of getCards()) {
      if (matcher(card, rule) && !card.dataset.ljfDismissed) {
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
    // Only count highlighted cards that haven't been dismissed yet
    const n = [...getCards()].filter(
      c => c.dataset.ljfHighlighted && !c.dataset.ljfDismissed
    ).length;
    el.textContent = n > 0 ? n : '';
  }

  function clearHighlights() {
    updateTabCount();
    for (const card of getCards()) {
      card.style.removeProperty('background-color');
      card.style.removeProperty('border-left');
      card.style.removeProperty('box-sizing');
      delete card.dataset.ljfHighlighted;
      delete card.dataset.ljfDismissed;
      card.querySelector('.ljf-badge')?.remove();
    }
  }

  // ─── MutationObserver: handle lazy-loaded cards ───────────────────────────────

  let scanTimeout = null;
  const observer = new MutationObserver(() => {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(applyAllRules, 700);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ─── UI ───────────────────────────────────────────────────────────────────────

  function buildUI() {
    // Side tab
    const tab = document.createElement('div');
    tab.id = 'ljf-tab';
    tab.title = 'LinkedIn Job Filter';
    tab.innerHTML =
      '<span id="ljf-tab-flag" style="font-size:15px;line-height:1;">&#9873;</span>' +
      '<span id="ljf-tab-count" style="font-size:10px;font-weight:700;line-height:1;margin-top:2px;"></span>';
    tab.style.cssText = [
      'position:fixed', 'right:0', 'top:50%',
      'transform:translateY(-50%)',
      'width:26px', 'min-height:54px',
      'background:#1d4ed8', 'color:#fff',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center', 'gap:3px',
      'padding:8px 0',
      'cursor:pointer',
      'border-radius:6px 0 0 6px',
      'z-index:99999',
      'box-shadow:-2px 2px 8px rgba(0,0,0,.35)',
      'user-select:none',
      'transition:right .2s ease',
    ].join(';');

    // Panel
    const panel = document.createElement('div');
    panel.id = 'ljf-panel';
    panel.style.cssText = [
      'position:fixed', 'right:0', 'top:0', 'bottom:0',
      'width:340px',
      'background:#1c1c1c', 'color:#e0e0e0',
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
    ].join(';')

    panel.innerHTML = `
<div id="ljf-header" style="
  background:#111;padding:12px 14px;
  display:flex;align-items:center;justify-content:space-between;
  border-bottom:1px solid #2e2e2e;flex-shrink:0;">
  <strong style="font-size:14px;letter-spacing:.3px;">&#9873; Job Filter</strong>
  <span style="font-size:11px;color:#555;">highlight-only</span>
</div>

<div style="padding:10px 14px;border-bottom:1px solid #282828;flex-shrink:0;">
  <div style="display:flex;gap:6px;">
    <button id="ljf-run-all" style="
      flex:1;background:#b91c1c;color:#fff;border:none;border-radius:4px;
      padding:8px;cursor:pointer;font-size:12px;font-weight:600;">
      &#10005; Dismiss All
    </button>

  </div>
</div>

<div id="ljf-rules-list" style="flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 14px;"></div>

<div id="ljf-add-form" style="
  border-top:1px solid #282828;padding:12px 14px;flex-shrink:0;background:#151515;">
  <div style="font-size:10px;color:#666;margin-bottom:7px;text-transform:uppercase;letter-spacing:.6px;">Add Rule</div>
  <select id="ljf-type-sel" style="
    width:100%;background:#fff;color:#000;border:1px solid #ccc;
    border-radius:4px;padding:5px 8px;margin-bottom:6px;font-size:12px;">
    ${Object.entries(RULE_TYPES).map(([k, v]) =>
      `<option value="${k}">${v.label}</option>`
    ).join('')}
  </select>
  <input id="ljf-value-input" type="text"
    placeholder="Value  (e.g. Ethos, 100, Sales...)"
    style="
      width:100%;box-sizing:border-box;
      background:#fff;color:#000;border:1px solid #ccc;
      border-radius:4px;padding:5px 8px;margin-bottom:6px;font-size:12px;"/>
  <input id="ljf-label-input" type="text"
    placeholder="Label  (optional, e.g. Applied at Ethos)"
    style="
      width:100%;box-sizing:border-box;
      background:#fff;color:#000;border:1px solid #ccc;
      border-radius:4px;padding:5px 8px;margin-bottom:8px;font-size:12px;"/>
  <button id="ljf-add-btn" style="
    width:100%;background:#166534;color:#fff;border:none;border-radius:4px;
    padding:8px;cursor:pointer;font-size:12px;font-weight:600;">
    + Add Rule
  </button>
</div>

<div style="padding:10px 14px;border-bottom:1px solid #282828;flex-shrink:0;">
  <div style="font-size:10px;color:#666;margin-bottom:7px;text-transform:uppercase;letter-spacing:.6px;">Quick Dismiss</div>
  <div style="display:flex;gap:6px;align-items:center;">
    <input id="ljf-quick-company" type="text" placeholder="Company name"
      style="
        flex:1;box-sizing:border-box;
        background:#222;color:#e0e0e0;border:1px solid #444;
        border-radius:4px;padding:5px 8px;font-size:12px;"/>
    <button id="ljf-quick-dismiss" style="
      background:#b91c1c;color:#fff;border:none;border-radius:4px;
      padding:5px 12px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;">
      Dismiss
    </button>
  </div>
</div>

<div id="ljf-status" style="
  background:#111;padding:5px 14px;font-size:11px;color:#555;
  border-top:1px solid #222;flex-shrink:0;">Ready</div>
`;

    document.body.appendChild(tab);
    document.body.appendChild(panel);

    const style = document.createElement('style');
    style.textContent = `
      #ljf-value-input::placeholder,
      #ljf-label-input::placeholder {
        color: #999 !important;
      }
    `;
    document.head.appendChild(style);

    // ── Event wiring ──────────────────────────────────────────────────────────

    tab.addEventListener('click', () => {
      panelOpen = !panelOpen;
      panel.style.display = panelOpen ? 'flex' : 'none';
      tab.style.right = panelOpen ? '340px' : '0';
      if (panelOpen) renderRules();
    });

    document.getElementById('ljf-run-all').addEventListener('click', () => {
      let dismissed = 0;
      for (const rule of rules) {
        dismissed += dismissRule(rule);
      }
      setStatus('\u2014 ' + dismissed + ' card(s) dismissed.');
    });

    document.getElementById('ljf-quick-dismiss').addEventListener('click', () => {
      const company = document.getElementById('ljf-quick-company').value.trim();
      if (!company) {
        setStatus('\u26A0 Enter a company name.');
        return;
      }
      const tempRule = { type: 'company', value: company, label: 'Quick: ' + company };
      const dismissed = dismissRule(tempRule);
      document.getElementById('ljf-quick-company').value = '';
      setStatus('Quick dismiss: ' + dismissed + ' card(s) dismissed.');
    });

    document.getElementById('ljf-quick-company').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        document.getElementById('ljf-quick-dismiss').click();
      }
    });

    document.getElementById('ljf-add-btn').addEventListener('click', handleAddRule);
    document.getElementById('ljf-label-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') handleAddRule();
    });
    document.getElementById('ljf-value-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') handleAddRule();
    });
  }

  function handleAddRule() {
    const type  = document.getElementById('ljf-type-sel').value;
    const value = document.getElementById('ljf-value-input').value.trim();
    const label = document.getElementById('ljf-label-input').value.trim();

    if (!value && type !== 'applied') {
      setStatus('\u26A0 Enter a value first.');
      return;
    }

    const finalValue = type === 'applied' ? '_applied_' : value;
    const typeLabel  = RULE_TYPES[type]?.label || type;
    const finalLabel = label || typeLabel + (value ? ': ' + value : '');

    addRule(type, finalValue, finalLabel);
    document.getElementById('ljf-value-input').value = '';
    document.getElementById('ljf-label-input').value = '';

    renderRules();
    document.getElementById('ljf-panel').scrollTop = 0;

    const { matched } = applyRule(rules[rules.length - 1]);
    setStatus('Rule added \u2014 ' + matched + ' card(s) matched.');
  }

  function renderRules() {
    const list = document.getElementById('ljf-rules-list');
    if (!list) return;

    if (rules.length === 0) {
      list.innerHTML = '<div style="color:#555;font-size:12px;padding:10px 0;">No rules yet. Add one below.</div>';
      return;
    }

    list.innerHTML = '';
    for (const rule of rules) {
      const row = document.createElement('div');
      row.style.cssText = [
        'display:flex', 'align-items:center', 'gap:7px',
        'padding:8px 0', 'border-bottom:1px solid #262626',
      ].join(';');

      const safeLabel = escHtml(rule.label);
      const typeLabel = escHtml(RULE_TYPES[rule.type]?.label || rule.type);

      row.innerHTML = `
<input type="checkbox" class="ljf-toggle" data-id="${rule.id}"
  ${rule.enabled ? 'checked' : ''}
  style="cursor:pointer;accent-color:#b91c1c;flex-shrink:0;margin:0;"/>
<div style="flex:1;min-width:0;">
  <div style="font-size:12px;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
    title="${safeLabel}">${safeLabel}</div>
  <div style="font-size:10px;color:#555;margin-top:1px;">${typeLabel}</div>
</div>
<button class="ljf-run-one" data-id="${rule.id}" title="Dismiss all matches for this rule" style="
  background:#1e2a1e;color:#6a9;border:1px solid #2a3a2a;border-radius:3px;
  padding:3px 8px;cursor:pointer;font-size:10px;flex-shrink:0;white-space:nowrap;">✕ dismiss</button>
<button class="ljf-del" data-id="${rule.id}" title="Delete rule" style="
  background:#2a1010;color:#c66;border:1px solid #3a1a1a;border-radius:3px;
  padding:3px 8px;cursor:pointer;font-size:11px;flex-shrink:0;">&#10005;</button>
`;
      list.appendChild(row);
    }

    list.querySelectorAll('.ljf-toggle').forEach(cb => {
      cb.addEventListener('change', e => {
        toggleRule(Number(e.currentTarget.dataset.id));
      });
    });

    list.querySelectorAll('.ljf-run-one').forEach(btn => {
      btn.addEventListener('click', e => {
        const id   = Number(e.currentTarget.dataset.id);
        const rule = rules.find(r => r.id === id);
        if (!rule) return;
        const dismissed = dismissRule(rule);
        setStatus('"' + rule.label + '" \u2014 ' + dismissed + ' card(s) dismissed.');
      });
    });

    list.querySelectorAll('.ljf-del').forEach(btn => {
      btn.addEventListener('click', e => {
        removeRule(Number(e.currentTarget.dataset.id));
        clearHighlights();
        applyAllRules();
        renderRules();
        setStatus('Rule removed.');
      });
    });
  }

  function setStatus(msg) {
    const el = document.getElementById('ljf-status');
    if (el) el.textContent = msg;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────────────

  function maybeBootstrap() {
    // Pre-populate the "Already Applied" rule so it's ready on first install
    if (!rules.find(r => r.type === 'applied')) {
      addRule('applied', '_applied_', 'Already Applied');
    }
  }

  function init() {
    maybeBootstrap();
    buildUI();
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