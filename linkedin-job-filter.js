// ==UserScript==
// @name         LinkedIn Job Filter
// @namespace    Monkey Scripts
// @version      1.1.0
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
  const SOURCE_URL  = '';

  const CARD_SEL    = 'li.jobs-search-results__list-item, li.scaffold-layout__list-item';
  const TITLE_SEL   = '.job-card-list__title--link, .job-card-container__link';
  const COMPANY_SEL = '.artdeco-entity-lockup__subtitle span';
  const SALARY_SEL  = '.job-card-container__metadata-item, .job-card-container__metadata-wrapper li span';
  const APPLIED_SEL = '.job-card-container__footer-job-state';
  const DISMISS_SEL = 'button.job-card-container__action';

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

  // ─── State ────────────────────────────────────────────────────────────────────

  let rules              = loadRules();
  let panelOpen          = false;
  let editingRuleId      = null;
  let editingOrigType    = null;
  let collapsedSections  = { company: false, title: false };

  // ─── Storage helpers ─────────────────────────────────────────────────────────

  function loadRules() {
    try { return JSON.parse(GM_getValue(STORAGE_KEY, '[]')); }
    catch { return []; }
  }

  function saveRules() {
    GM_setValue(STORAGE_KEY, JSON.stringify(rules));
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

  function matchTitle(card, rule) {
    return cardText(card, TITLE_SEL).toLowerCase().includes(rule.value.toLowerCase());
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
    updateTabCount();
    return total;
  }

  function act(card, rule) {
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
    if (isDismissed(card)) {
      markDismissed(card);
    } else {
      card.style.setProperty('background-color', 'rgba(200,40,40,0.10)', 'important');
      card.style.setProperty('border-left', '3px solid rgba(200,40,40,0.55)', 'important');
      card.style.setProperty('box-sizing', 'border-box', 'important');
      card.dataset.ljfHighlighted = rule.id;
    }
  }

  function markDismissed(card) {
    card.style.setProperty('background-color', 'rgba(200,120,0,0.12)', 'important');
    card.style.setProperty('border-left', '3px solid rgba(200,120,0,0.55)', 'important');
    card.style.setProperty('box-sizing', 'border-box', 'important');
    const badge = card.querySelector('.ljf-badge');
    if (badge) { badge.style.background = 'rgba(180,100,0,0.85)'; badge.textContent = '\u2716 dismissed'; }
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
    const n = [...getCards()].filter(c => c.dataset.ljfHighlighted && !isDismissed(c)).length;
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
    ].join(';');

    panel.innerHTML = `
<div id="ljf-header" style="
  background:#111;padding:12px 14px;
  display:flex;align-items:center;justify-content:space-between;
  border-bottom:1px solid #2e2e2e;flex-shrink:0;">
  <strong style="font-size:14px;letter-spacing:.3px;">LinkedIn Job Filter</strong>
  <div style="position:relative;">
    <button id="ljf-gear" title="Settings" style="
      background:none;border:none;color:#555;cursor:pointer;
      font-size:15px;padding:2px 4px;line-height:1;border-radius:3px;">&#9881;</button>
    <div id="ljf-gear-menu" style="
      display:none;position:absolute;right:0;top:calc(100% + 4px);
      background:#1a1a1a;border:1px solid #333;border-radius:4px;
      min-width:148px;z-index:100001;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.5);">
      <button class="ljf-gear-item" data-action="export" style="
        display:block;width:100%;background:none;color:#ccc;border:none;
        text-align:left;padding:8px 12px;cursor:pointer;font-size:12px;">
        &#8599; Export Rules
      </button>
      <button class="ljf-gear-item" data-action="import" style="
        display:block;width:100%;background:none;color:#ccc;border:none;
        text-align:left;padding:8px 12px;cursor:pointer;font-size:12px;
        border-top:1px solid #2a2a2a;">
        &#8600; Import Rules
      </button>
    </div>
  </div>
</div>

<div style="padding:10px 14px;border-bottom:1px solid #282828;flex-shrink:0;">
  <button id="ljf-run-all" style="
    width:100%;background:#b91c1c;color:#fff;border:none;border-radius:4px;
    padding:8px;cursor:pointer;font-size:12px;font-weight:600;">
    &#10005; Dismiss All
  </button>
</div>

<div id="ljf-rules-list" style="flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 14px;"></div>

<div id="ljf-add-form" style="
  border-top:1px solid #282828;padding:12px 14px;flex-shrink:0;background:#151515;">
  <div id="ljf-add-form-title" style="font-size:10px;color:#666;margin-bottom:7px;text-transform:uppercase;letter-spacing:.6px;">Add Rule</div>
  <select id="ljf-type-sel" style="
    width:100%;background:#fff;color:#000;border:1px solid #ccc;
    border-radius:4px;padding:5px 8px;margin-bottom:6px;font-size:12px;">
    ${DROPDOWN_TYPES.map(k => `<option value="${k}">${RULE_TYPES[k].label}</option>`).join('')}
  </select>
  <input id="ljf-value-input" type="text"
    placeholder="Value  (e.g. Ethos, 100, Sales...)"
    style="width:100%;box-sizing:border-box;background:#fff;color:#000;border:1px solid #ccc;
      border-radius:4px;padding:5px 8px;margin-bottom:6px;font-size:12px;"/>
  <input id="ljf-label-input" type="text"
    placeholder="Label  (optional)"
    style="width:100%;box-sizing:border-box;background:#fff;color:#000;border:1px solid #ccc;
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
      style="flex:1;box-sizing:border-box;background:#fff;color:#000;border:1px solid #ccc;
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
      #ljf-value-input::placeholder, #ljf-label-input::placeholder, #ljf-quick-company::placeholder { color:#999 !important; }
    `;
    document.head.appendChild(style);

    // ── Event wiring ──────────────────────────────────────────────────────────

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
      updateTabCount();
      setStatus('\u2014 ' + dismissed + ' card(s) dismissed.');
    });

    document.getElementById('ljf-run-all').addEventListener('click', () => {
      let dismissed = 0;
      for (const rule of rules) dismissed += dismissRule(rule);
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
        else importRules();
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
  }

  // ─── Form edit-state helpers ──────────────────────────────────────────────────

  function cancelEdit() {
    editingRuleId   = null;
    editingOrigType = null;
    document.getElementById('ljf-value-input').value = '';
    document.getElementById('ljf-label-input').value = '';
    document.getElementById('ljf-add-btn').textContent = '+ Add Rule';
    document.getElementById('ljf-add-form-title').textContent = 'Add Rule';
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
          showImportDialog(data.rules);
        } catch {
          setStatus('\u26A0 Failed to parse rules file.');
        }
      });
      reader.readAsText(file);
    });
    input.click();
  }

  function showImportDialog(incoming) {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:100002',
      'background:rgba(0,0,0,.65)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');

    const modal = document.createElement('div');
    modal.style.cssText = [
      'background:#1c1c1c', 'color:#e0e0e0',
      'border:1px solid #333', 'border-radius:8px',
      'padding:20px 22px', 'max-width:310px', 'width:90%',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'box-shadow:0 8px 32px rgba(0,0,0,.6)',
    ].join(';');

    const countLabel = incoming.length + ' rule' + (incoming.length !== 1 ? 's' : '');
    modal.innerHTML = `
<div style="font-size:14px;font-weight:600;margin-bottom:8px;">Import Rules</div>
<div style="font-size:12px;color:#aaa;margin-bottom:18px;">
  ${escHtml(countLabel)} found. Overwrite all existing rules, or append to them?
</div>
<div style="display:flex;gap:8px;justify-content:flex-end;">
  <button id="ljf-imp-cancel" style="
    background:#2a2a2a;color:#aaa;border:1px solid #3a3a3a;
    border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;">Cancel</button>
  <button id="ljf-imp-append" style="
    background:#1e2a1e;color:#6a9;border:1px solid #2a3a2a;
    border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;">Append</button>
  <button id="ljf-imp-overwrite" style="
    background:#b91c1c;color:#fff;border:none;
    border-radius:4px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;">Overwrite</button>
</div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const freshIds = (arr) => {
      let id = Date.now();
      return arr.map(r => ({ ...r, id: ++id }));
    };

    modal.querySelector('#ljf-imp-cancel').addEventListener('click', () => overlay.remove());

    modal.querySelector('#ljf-imp-append').addEventListener('click', () => {
      rules.push(...freshIds(incoming));
      saveRules();
      overlay.remove();
      clearHighlights();
      applyAllRules();
      renderRules();
      setStatus('Imported ' + incoming.length + ' rule(s) — appended.');
    });

    modal.querySelector('#ljf-imp-overwrite').addEventListener('click', () => {
      rules = freshIds(incoming);
      saveRules();
      overlay.remove();
      clearHighlights();
      applyAllRules();
      renderRules();
      setStatus('Imported ' + incoming.length + ' rule(s) — rules replaced.');
    });
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  function renderRules() {
    const list = document.getElementById('ljf-rules-list');
    if (!list) return;
    list.innerHTML = '';

    // ── 1. Always-visible sticky blocks ──────────────────────────────────────
    list.appendChild(renderAppliedBlock(rules.find(r => r.type === 'applied')));
    list.appendChild(renderSalaryBlock('topsalary', rules.find(r => r.type === 'topsalary')));
    list.appendChild(renderSalaryBlock('salary',    rules.find(r => r.type === 'salary')));

    // ── 2. Dynamic rules grouped by type ─────────────────────────────────────
    const companyRules = rules.filter(r => r.type === 'company');
    const titleRules   = rules.filter(r => r.type === 'title');

    if (companyRules.length === 0 && titleRules.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#555;font-size:12px;padding:10px 0;';
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
    const div = document.createElement('div');
    div.style.cssText = [
      'padding:8px 10px', 'margin-bottom:4px',
      'background:#1a1a2e', 'border:1px solid #2a2a4a', 'border-radius:5px',
    ].join(';');

    const enabled = rule ? rule.enabled : true;
    div.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
  <span style="font-size:12px;color:#a0a0c0;font-weight:600;flex:1;">Already Applied</span>
  <button class="ljf-applied-dismiss" title="Dismiss all matching cards" style="
    flex-shrink:0;background:#1e2a1e;color:#6a9;border:1px solid #2a3a2a;
    border-radius:3px;padding:3px 8px;cursor:pointer;font-size:10px;white-space:nowrap;">✕ dismiss</button>
  <button class="ljf-applied-toggle" title="${enabled ? 'Disable rule' : 'Enable rule'}" style="
    flex-shrink:0;border-radius:3px;width:28px;height:22px;padding:0;cursor:pointer;
    font-size:13px;font-weight:900;line-height:1;text-align:center;
    ${enabled
      ? 'background:#1e2a1e;color:#6a9;border:1px solid #2a3a2a;'
      : 'background:#2a1010;color:#c66;border:1px solid #3a1a1a;'
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

  function renderSalaryBlock(type, rule) {
    const typeLabel = RULE_TYPES[type].label;
    const hasValue  = !!(rule && rule.value);
    const display   = hasValue ? ('$' + rule.value + 'k') : 'Not set';

    const div = document.createElement('div');
    div.style.cssText = [
      'padding:8px 10px', 'margin-bottom:4px', 'cursor:pointer',
      'background:' + (hasValue ? '#182018' : '#181818'),
      'border:1px solid ' + (hasValue ? '#2a422a' : '#282828'),
      'border-radius:5px',
    ].join(';');

    div.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
  <div style="flex:1;min-width:0;">
    <div style="font-size:12px;color:${hasValue ? '#88bb88' : '#555'};font-weight:600;">${escHtml(typeLabel)}</div>
    <div style="font-size:11px;color:${hasValue ? '#5a8a5a' : '#3a3a3a'};margin-top:2px;">${escHtml(display)}</div>
  </div>
  ${hasValue ? `
  <button class="ljf-salary-dismiss" title="Dismiss all matching cards" style="
    flex-shrink:0;background:#1e2a1e;color:#6a9;border:1px solid #2a3a2a;
    border-radius:3px;padding:3px 8px;cursor:pointer;font-size:10px;white-space:nowrap;">✕ dismiss</button>
  <button class="ljf-salary-clear" title="Remove this rule" style="
    flex-shrink:0;background:#2a1010;color:#c66;border:1px solid #3a1a1a;
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
    const collapsed = collapsedSections[sectionKey];
    const arrow = collapsed ? '▸' : '▾';
    const div = document.createElement('div');
    div.style.cssText = [
      'display:flex', 'align-items:center', 'gap:5px',
      'font-size:10px', 'color:#666', 'text-transform:uppercase',
      'letter-spacing:.6px', 'padding:10px 0 4px',
      'cursor:pointer', 'user-select:none',
    ].join(';');
    div.innerHTML =
      `<span>${escHtml(label)}</span>` +
      `<span style="color:#444;">(${count})</span>` +
      `<span style="margin-left:auto;font-size:9px;color:#555;">${arrow}</span>`;
    div.addEventListener('click', () => {
      collapsedSections[sectionKey] = !collapsedSections[sectionKey];
      renderRules();
    });
    return div;
  }

  function renderRuleRow(rule) {
    const row = document.createElement('div');
    row.style.cssText = [
      'display:flex', 'align-items:center', 'gap:7px',
      'padding:7px 8px', 'margin-bottom:3px',
      'background:#222', 'border:1px solid #2a2a2a',
      'border-radius:4px',
    ].join(';');

    const safeLabel = escHtml(rule.label);
    const typeLabel = escHtml(RULE_TYPES[rule.type]?.label || rule.type);

    row.innerHTML = `
<input type="checkbox" class="ljf-toggle" data-id="${rule.id}"
  ${rule.enabled ? 'checked' : ''}
  style="cursor:pointer;accent-color:#b91c1c;flex-shrink:0;margin:0;"/>
<div class="ljf-row-label" style="flex:1;min-width:0;cursor:pointer;" title="Click to edit">
  <div style="font-size:12px;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
    title="${safeLabel}">${safeLabel}</div>
  <div style="font-size:10px;color:#555;margin-top:1px;">${typeLabel}</div>
</div>
<button class="ljf-run-one" data-id="${rule.id}" title="Dismiss all matches for this rule" style="
  background:#1e2a1e;color:#6a9;border:1px solid #2a3a2a;border-radius:3px;
  padding:3px 8px;cursor:pointer;font-size:10px;flex-shrink:0;white-space:nowrap;">✕ dismiss</button>
<button class="ljf-del" data-id="${rule.id}" title="Delete rule" style="
  flex-shrink:0;background:#2a1010;color:#c66;border:1px solid #3a1a1a;
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

  // ─── Bootstrap ───────────────────────────────────────────────────────────────

  function maybeBootstrap() {
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
