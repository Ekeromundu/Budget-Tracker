/* Pocket Ledger — app logic. All data stays in this browser (localStorage). */
(function () {
  'use strict';
  const P = window.Parser;
  const KEY = 'pocketledger.v1';
  const PDFJS = 'vendor/';
  const PROTECTED = ['Income', 'Other', 'Transfers'];

  const DEFAULT_CATS = ['Income', 'Groceries', 'Transport & Fuel', 'Airtime & Data', 'Utilities', 'Rent & Housing',
    'Eating Out', 'Shopping', 'Health', 'Education', 'Entertainment', 'Bank Fees', 'Transfers', 'Other'];
  const DEFAULT_RULES = [
    ['SALARY', 'Income'],
    ['SHOPRITE', 'Groceries'], ['CHECKERS', 'Groceries'], ['PICK N PAY', 'Groceries'], ['SPAR', 'Groceries'],
    ['WOERMANN', 'Groceries'], ['FOOD LOVER', 'Groceries'], ['OK FOODS', 'Groceries'], ['USAVE', 'Groceries'],
    ['ENGEN', 'Transport & Fuel'], ['SHELL', 'Transport & Fuel'], ['PUMA', 'Transport & Fuel'],
    ['TOTALENERGIES', 'Transport & Fuel'], ['ASTRON', 'Transport & Fuel'], ['UBER', 'Transport & Fuel'], ['LEFA', 'Transport & Fuel'],
    ['MTC', 'Airtime & Data'], ['TN MOBILE', 'Airtime & Data'], ['AIRTIME', 'Airtime & Data'],
    ['NAMPOWER', 'Utilities'], ['CITY OF WINDHOEK', 'Utilities'], ['ELECTRICITY', 'Utilities'], ['PREPAID ELEC', 'Utilities'],
    ['KFC', 'Eating Out'], ['NANDO', 'Eating Out'], ['DEBONAIRS', 'Eating Out'], ['WIMPY', 'Eating Out'],
    ['HUNGRY LION', 'Eating Out'], ['CAFE', 'Eating Out'], ['RESTAURANT', 'Eating Out'],
    ['CLICKS', 'Health'], ['DIS-CHEM', 'Health'], ['PHARMACY', 'Health'],
    ['NETFLIX', 'Entertainment'], ['SHOWMAX', 'Entertainment'], ['SPOTIFY', 'Entertainment'],
    ['ACCOUNT FEE', 'Bank Fees'], ['SERVICE FEE', 'Bank Fees'], ['BANK CHARGE', 'Bank Fees'], ['TRANSACTION FEE', 'Bank Fees'],
    ['TRANSFER', 'Transfers'],
  ];

  /* ---------- state ---------- */
  function fresh() {
    return {
      txns: [],
      categories: DEFAULT_CATS.map(name => ({ name, budget: 0 })),
      rules: DEFAULT_RULES.map(([keyword, category]) => ({ keyword, category })),
    };
  }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.txns)) return s; } catch (e) { /* ignore */ }
    return fresh();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save — storage is full or blocked'); }
  }
  let S = load();

  /* ---------- helpers ---------- */
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtShort = n => (n < 0 ? '−' : '') + 'N$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  const fmt = n => (n < 0 ? '−' : '') + 'N$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pad = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const thisMonth = () => today().slice(0, 7);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const opts = (list, sel) => list.map(n => `<option${n === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const catNames = () => S.categories.map(c => c.name);
  const monthTxns = ym => S.txns.filter(t => t.date.startsWith(ym));
  const latestMonth = () => S.txns.length ? S.txns.reduce((m, t) => (t.date > m ? t.date : m), '').slice(0, 7) : thisMonth();
  function monthLabel(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }); }
  function shiftMonth(ym, d) { const [y, m] = ym.split('-').map(Number); const x = new Date(y, m - 1 + d, 1); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; }
  const dayLabel = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  const autoCat = t => P.categorize(t.desc, S.rules) || (t.amount > 0 ? 'Income' : 'Other');

  let toastTimer;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* Suggest a rule keyword from a description: first meaningful words. */
  function suggestKeyword(desc) {
    const stop = /^(POS|PURCHASE|CARD|DEBIT|CREDIT|ORDER|PAYMENT|PAYMENTS|FNB|APP|TO|FROM|INT|LOCAL|ONLINE|SETTLEMENT|#)$/i;
    const words = desc.toUpperCase().replace(/[^A-Z0-9&'\- ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !/\d/.test(w) && !stop.test(w));
    return words.slice(0, 2).join(' ');
  }

  /* ---------- UI state ---------- */
  const UI = { view: 'overview', month: latestMonth(), search: '', pending: null };
  const TITLES = { overview: 'Overview', transactions: 'Transactions', import: 'Import', settings: 'Settings' };

  function render() {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === UI.view));
    $('#title').textContent = TITLES[UI.view];
    $('#view').innerHTML = VIEWS[UI.view]();
  }

  const monthNav = () => `<div class="monthnav">
    <button class="icon" data-action="month" data-d="-1" aria-label="Previous month">‹</button>
    <strong>${esc(monthLabel(UI.month))}</strong>
    <button class="icon" data-action="month" data-d="1" aria-label="Next month">›</button></div>`;

  function bar(v, max, soft) {
    const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0;
    return `<div class="bar${soft ? ' soft' : ''}"><i style="width:${pct.toFixed(1)}%" class="${!soft && v > max ? 'over' : ''}"></i></div>`;
  }

  /* ---------- views ---------- */
  const VIEWS = {
    overview() {
      if (!S.txns.length) {
        return `<section class="card empty"><h2>No transactions yet</h2>
          <p class="muted">Import a bank statement (CSV or PDF) to see where your money goes each month.</p>
          <button class="primary full" data-action="go" data-view="import">Import a statement</button></section>`;
      }
      const ts = monthTxns(UI.month).filter(t => t.category !== 'Transfers');
      const inc = ts.filter(t => t.amount > 0).reduce((a, t) => a + t.amount, 0);
      const out = -ts.filter(t => t.amount < 0).reduce((a, t) => a + t.amount, 0);
      const spend = {};
      for (const t of ts) if (t.category !== 'Income') spend[t.category] = (spend[t.category] || 0) - t.amount;
      const rows = S.categories.filter(c => !['Income', 'Transfers'].includes(c.name))
        .map(c => ({ name: c.name, budget: +c.budget || 0, spent: Math.max(0, spend[c.name] || 0) }))
        .filter(r => r.spent > 0 || r.budget > 0);
      Object.keys(spend).forEach(n => {
        if (spend[n] > 0 && !rows.find(r => r.name === n)) rows.push({ name: n, budget: 0, spent: spend[n] });
      });
      rows.sort((a, b) => b.spent - a.spent);
      const maxSpent = Math.max(1, ...rows.map(r => r.spent));
      const budgeted = rows.filter(r => r.budget > 0);
      const totB = budgeted.reduce((a, r) => a + r.budget, 0);
      const totS = budgeted.reduce((a, r) => a + r.spent, 0);
      const catRow = r => {
        const note = r.budget
          ? (r.spent > r.budget ? `<span class="neg">${fmt(r.spent - r.budget)} over</span>` : `<span class="muted">${fmt(r.budget - r.spent)} left</span>`)
          : '<span class="muted">No budget set</span>';
        return `<button class="catrow" data-action="filtercat" data-cat="${esc(r.name)}">
          <div class="row between"><b>${esc(r.name)}</b><span><b>${fmt(r.spent)}</b>${r.budget ? ` <span class="muted small">/ ${fmt(r.budget)}</span>` : ''}</span></div>
          ${r.budget ? bar(r.spent, r.budget) : bar(r.spent, maxSpent, true)}
          <div class="small">${note}</div></button>`;
      };
      return `${monthNav()}
        <div class="stats">
          <div class="stat"><span>Money in</span><b class="pos">${fmtShort(inc)}</b></div>
          <div class="stat"><span>Money out</span><b class="neg">${fmtShort(out)}</b></div>
          <div class="stat"><span>Net</span><b class="${inc - out >= 0 ? 'pos' : 'neg'}">${fmtShort(inc - out)}</b></div>
        </div>
        ${totB ? `<div class="card"><div class="row between"><span>Budget used</span><b>${fmt(totS)} / ${fmt(totB)}</b></div>${bar(totS, totB)}</div>` : ''}
        <h2 class="section">Spending by category</h2>
        <div class="card list">${rows.length ? rows.map(catRow).join('') : '<p class="muted">No spending this month.</p>'}</div>
        <p class="muted small center">Transfers are left out of these totals. Tap a category to see its transactions.</p>`;
    },

    transactions() {
      return `${monthNav()}
        <input type="search" placeholder="Search description or category" value="${esc(UI.search)}" data-action="search" aria-label="Search">
        <details class="card add"><summary>Add a transaction</summary>
          <form id="addform" class="grid">
            <label>Date<input type="date" name="date" value="${today()}" required></label>
            <label>Type<select name="type"><option value="out">Money out</option><option value="in">Money in</option></select></label>
            <label class="full">Description<input name="desc" required placeholder="e.g. Taxi to town"></label>
            <label>Amount (N$)<input name="amount" inputmode="decimal" required placeholder="0.00"></label>
            <label>Category<select name="category">${opts(catNames(), 'Other')}</select></label>
            <button class="primary full" type="submit">Add</button>
          </form></details>
        <div id="txlist">${txList()}</div>`;
    },

    import() {
      const p = UI.pending;
      if (!p) {
        return `<div class="card"><h2>Import a statement</h2>
          <p>Download your statement from online banking, then choose it here. CSV works best; PDF statements are read too, including password-protected ones.</p>
          <label class="file primary full">Choose CSV or PDF<input type="file" class="vh" accept=".csv,.txt,.pdf,text/csv,application/pdf" data-action="file"></label>
          <p class="muted small">The file is read on this phone only. Nothing is uploaded anywhere.</p></div>
          <div class="card"><h3>Tips</h3><ul class="small">
            <li>Import each month once. Anything already imported is detected and unticked.</li>
            <li>Check the preview. If money in and out look reversed, use “Flip signs”.</li>
            <li>When you fix a category, save it as a rule so future imports get it right.</li></ul></div>`;
      }
      const sel = p.items.filter(i => i.checked);
      const dups = p.items.filter(i => i.dup).length;
      const net = sel.reduce((a, i) => a + i.amount, 0);
      let controls;
      if (p.kind === 'csv') {
        const header = p.guess.headerIdx >= 0 ? p.rows[p.guess.headerIdx] : null;
        const firstData = p.rows.slice(p.guess.headerIdx + 1).find(r => P.parseDate(r[p.guess.map.date], 2000)) || [];
        const ncol = Math.max(0, ...p.rows.slice(0, 40).map(r => r.length));
        const colName = i => header && header[i] ? header[i] : `Column ${i + 1}${firstData[i] ? ` (${String(firstData[i]).slice(0, 18)})` : ''}`;
        const colSel = key => `<select data-action="map" data-key="${key}"><option value="-1">—</option>${
          Array.from({ length: ncol }, (_, i) => `<option value="${i}"${p.guess.map[key] === i ? ' selected' : ''}>${esc(colName(i))}</option>`).join('')}</select>`;
        controls = `<div class="grid">
          <label>Date${colSel('date')}</label><label>Description${colSel('desc')}</label>
          <label class="full">Amount (one signed column)${colSel('amount')}</label>
          <label>Debit / money out${colSel('debit')}</label><label>Credit / money in${colSel('credit')}</label></div>
          <p class="muted small">Use either the Amount column, or set Amount to — and pick Debit and Credit.</p>`;
      } else {
        controls = `<div class="grid"><label>Statement year<input type="number" data-action="year" value="${p.year}" min="2000" max="2100"></label></div>`;
      }
      const list = p.items.length
        ? `<div class="card list">${p.items.map((i, idx) => `<label class="tx pick${i.dup ? ' dup' : ''}">
            <input type="checkbox" data-action="pick" data-idx="${idx}"${i.checked ? ' checked' : ''}>
            <div class="grow"><div class="txmain"><span class="desc">${esc(i.desc)}</span><b class="${i.amount < 0 ? 'neg' : 'pos'}">${fmt(i.amount)}</b></div>
            <div class="small muted">${esc(i.date)} · ${esc(i.category)}${i.dup ? ' · <span class="tag">already imported</span>' : ''}</div></div></label>`).join('')}</div>`
        : `<div class="card"><p>No transactions recognised.</p><p class="small muted">${p.kind === 'csv'
            ? 'Pick the right columns above.'
            : 'Check the statement year, or try the CSV export. You can also open “Show text read from the PDF” below to see what the app saw.'}</p></div>`;
      return `<div class="card">
          <div class="row between"><h2 class="grow" style="overflow-wrap:anywhere">${esc(p.name)}</h2><button class="link" data-action="cancelimport">Cancel</button></div>
          ${controls}
          <label class="check"><input type="checkbox" data-action="flip"${p.flip ? ' checked' : ''}> Flip signs (money in ↔ out)</label>
          <p class="small">${p.items.length} found · ${dups} already imported · <b>${sel.length} selected</b> · net ${fmt(net)}</p>
          <button class="primary full" data-action="commit"${sel.length ? '' : ' disabled'}>Import ${sel.length} transaction${sel.length === 1 ? '' : 's'}</button>
        </div>
        ${list}
        ${p.kind === 'pdf' ? `<details class="card"><summary>Show text read from the PDF</summary><pre class="raw">${esc(p.lines.slice(0, 120).join('\n'))}</pre></details>` : ''}`;
    },

    settings() {
      const cats = catNames();
      return `<h2 class="section">Monthly budgets</h2>
        <div class="card list">
          ${S.categories.filter(c => !['Income', 'Transfers'].includes(c.name)).map(c => `<div class="row between setrow">
            <span class="grow">${esc(c.name)}</span>
            <input class="money" inputmode="decimal" placeholder="No budget" value="${c.budget || ''}" data-action="budget" data-name="${esc(c.name)}" aria-label="Budget for ${esc(c.name)}">
            ${PROTECTED.includes(c.name) ? '<span style="width:28px"></span>' : `<button class="link danger" data-action="delcat" data-name="${esc(c.name)}" aria-label="Delete ${esc(c.name)}">✕</button>`}
          </div>`).join('')}
          <form id="catform" class="row setrow"><input name="name" placeholder="New category" required><button class="primary" type="submit">Add</button></form>
        </div>
        <h2 class="section">Auto-categorise rules</h2>
        <div class="card">
          <p class="small muted">If a description contains the text, the transaction gets that category. The first match wins.</p>
          <form id="ruleform" class="grid">
            <label>Text contains<input name="keyword" required placeholder="e.g. SHOPRITE"></label>
            <label>Category<select name="category">${opts(cats, 'Groceries')}</select></label>
            <button class="primary full" type="submit">Add rule</button>
          </form>
          <details><summary>${S.rules.length} rules</summary>
            <div class="list">${S.rules.map((r, i) => `<div class="row between setrow"><span class="grow"><code>${esc(r.keyword)}</code> → ${esc(r.category)}</span>
              <button class="link danger" data-action="delrule" data-idx="${i}" aria-label="Delete rule">✕</button></div>`).join('')}</div>
          </details>
          <button class="full" data-action="reapply">Re-apply rules to all transactions</button>
        </div>
        <h2 class="section">Your data</h2>
        <div class="card">
          <p class="small muted">Everything is stored on this phone only. Export a backup now and then, especially before clearing Safari data.</p>
          <button class="full" data-action="export">Export backup</button>
          <label class="file full">Restore from backup<input type="file" class="vh" accept=".json,application/json" data-action="restore"></label>
          <button class="full danger" data-action="wipe">Erase all data</button>
        </div>
        <p class="muted small center">${S.txns.length} transactions stored</p>`;
    },
  };

  function txList() {
    const q = UI.search.trim().toLowerCase();
    const ts = monthTxns(UI.month)
      .filter(t => !q || t.desc.toLowerCase().includes(q) || t.category.toLowerCase() === q || t.category.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date));
    if (!ts.length) return `<p class="muted center">No transactions${q ? ' match your search' : ' this month'}.</p>`;
    const cats = catNames();
    let html = '', cur = '';
    for (const t of ts) {
      if (t.date !== cur) {
        if (cur) html += '</div>';
        cur = t.date;
        html += `<h3 class="day">${esc(dayLabel(t.date))}</h3><div class="card list">`;
      }
      const list = cats.includes(t.category) ? cats : [...cats, t.category];
      html += `<div class="tx"><div class="txmain"><span class="desc">${esc(t.desc)}</span><b class="${t.amount < 0 ? 'neg' : 'pos'}">${fmt(t.amount)}</b></div>
        <div class="txmeta"><select data-action="setcat" data-id="${t.id}" aria-label="Category">${opts(list, t.category)}</select>
        <button class="link danger" data-action="deltx" data-id="${t.id}">Delete</button></div></div>`;
    }
    return html + '</div>';
  }

  /* ---------- import ---------- */
  function buildItems(p) {
    const raw = p.kind === 'csv'
      ? P.rowsToTxns(p.rows, p.guess.headerIdx, p.guess.map, { year: p.year })
      : P.parseStatementLines(p.lines, p.year);
    const existing = new Set(S.txns.map(P.txnKey));
    p.items = raw.map(t => {
      const it = { date: t.date, desc: t.desc, amount: p.flip ? -t.amount : t.amount };
      it.category = autoCat(it);
      it.dup = existing.has(P.txnKey(it));
      it.checked = !it.dup;
      return it;
    });
  }

  /* Load pdf.js: the copy bundled in vendor/ first, then the public CDN as a fallback. */
  const PDFJS_SOURCES = [PDFJS, 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/'];
  const loadScript = src => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => { s.remove(); rej(new Error(src)); };
    document.head.appendChild(s);
  });
  async function loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    for (const base of PDFJS_SOURCES) {
      try {
        await loadScript(base + 'pdf.min.js');
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
          return window.pdfjsLib;
        }
      } catch (e) { /* try the next source */ }
    }
    throw new Error('Could not load the PDF reader. Check that the vendor folder was uploaded, or connect to the internet and try again.');
  }

  async function pdfToLines(buf) {
    const lib = await loadPdfJs();
    const task = lib.getDocument({ data: buf });
    task.onPassword = (update, reason) => {
      const wrong = reason === lib.PasswordResponses.INCORRECT_PASSWORD;
      const pw = prompt(wrong ? 'Incorrect password. Try again:' : 'This statement is password-protected. Enter the PDF password:');
      if (pw === null) task.destroy(); else update(pw);
    };
    const doc = await task.promise;
    const lines = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      const rows = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const x = it.transform[4], y = it.transform[5];
        let row = rows.find(r => Math.abs(r.y - y) < 3);
        if (!row) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ x, s: it.str });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) lines.push(r.items.sort((a, b) => a.x - b.x).map(i => i.s).join(' '));
    }
    return lines;
  }

  async function onFile(file) {
    try {
      toast('Reading ' + file.name + '…');
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      let p;
      if (isPdf) {
        const lines = await pdfToLines(await file.arrayBuffer());
        p = { kind: 'pdf', name: file.name, lines, year: P.guessYear(lines.join(' ')) || new Date().getFullYear(), flip: false };
      } else {
        const rows = P.parseCSV(await file.text());
        p = { kind: 'csv', name: file.name, rows, guess: P.guessMapping(rows), year: new Date().getFullYear(), flip: false };
      }
      buildItems(p);
      UI.pending = p;
      render();
      toast(`${p.items.length} transactions found`);
    } catch (e) {
      const msg = e && e.name === 'PasswordException' ? 'The PDF needs its password to open.' : (e && e.message) || 'Could not read that file.';
      toast(msg);
      render();
    }
  }

  /* ---------- backup ---------- */
  async function exportBackup() {
    const name = `pocket-ledger-backup-${today()}.json`;
    const blob = new Blob([JSON.stringify(S)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Pocket Ledger backup' }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function restoreBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.txns) || !Array.isArray(data.categories)) throw new Error();
      if (!confirm(`Replace everything on this phone with the backup (${data.txns.length} transactions)?`)) return;
      S = { txns: data.txns, categories: data.categories, rules: Array.isArray(data.rules) ? data.rules : fresh().rules };
      save(); UI.month = latestMonth(); render(); toast('Backup restored');
    } catch (e) { toast('That file is not a Pocket Ledger backup'); }
  }

  /* ---------- actions ---------- */
  function act(action, el) {
    const p = UI.pending;
    switch (action) {
      case 'go': UI.view = el.dataset.view; render(); break;
      case 'month': UI.month = shiftMonth(UI.month, +el.dataset.d); render(); break;
      case 'filtercat': UI.search = el.dataset.cat; UI.view = 'transactions'; render(); window.scrollTo(0, 0); break;
      case 'setcat': {
        const t = S.txns.find(x => x.id === el.dataset.id); if (!t) return;
        t.category = el.value; t.manual = true; save();
        const kw = prompt(`Also put every transaction containing this text in “${el.value}”, now and in future imports?\nEdit the text, or tap Cancel to change just this one.`, suggestKeyword(t.desc));
        if (kw && kw.trim()) {
          const k = kw.trim().toUpperCase();
          S.rules.unshift({ keyword: k, category: el.value });
          let n = 0;
          S.txns.forEach(x => { if (!x.manual && x.desc.toUpperCase().includes(k) && x.category !== el.value) { x.category = el.value; n++; } });
          save(); toast(`Rule added${n ? ` · ${n} more updated` : ''}`);
          $('#txlist').innerHTML = txList();
        }
        break;
      }
      case 'deltx':
        if (confirm('Delete this transaction?')) { S.txns = S.txns.filter(x => x.id !== el.dataset.id); save(); $('#txlist').innerHTML = txList(); }
        break;
      case 'file': { const f = el.files && el.files[0]; el.value = ''; if (f) onFile(f); break; }
      case 'map': p.guess.map[el.dataset.key] = +el.value; buildItems(p); render(); break;
      case 'year': p.year = +el.value || p.year; buildItems(p); render(); break;
      case 'flip': p.flip = el.checked; buildItems(p); render(); break;
      case 'pick': p.items[+el.dataset.idx].checked = el.checked; render(); break;
      case 'cancelimport': UI.pending = null; render(); break;
      case 'commit': {
        const add = p.items.filter(i => i.checked).map(i => ({ id: uid(), date: i.date, desc: i.desc, amount: i.amount, category: i.category }));
        S.txns.push(...add); save();
        UI.pending = null;
        UI.month = add.reduce((m, t) => (t.date > m ? t.date : m), '').slice(0, 7) || UI.month;
        UI.view = 'overview'; render(); window.scrollTo(0, 0);
        toast(`Imported ${add.length} transactions`);
        break;
      }
      case 'budget': {
        const c = S.categories.find(x => x.name === el.dataset.name);
        const v = parseFloat(String(el.value).replace(/[^\d.]/g, ''));
        if (c) { c.budget = isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0; save(); toast(`Budget saved for ${c.name}`); }
        break;
      }
      case 'delcat': {
        const name = el.dataset.name;
        if (!confirm(`Delete “${name}”? Its transactions move to Other.`)) return;
        S.categories = S.categories.filter(c => c.name !== name);
        S.rules = S.rules.filter(r => r.category !== name);
        S.txns.forEach(t => { if (t.category === name) t.category = 'Other'; });
        save(); render(); break;
      }
      case 'delrule': S.rules.splice(+el.dataset.idx, 1); save(); render(); break;
      case 'reapply': {
        let n = 0;
        S.txns.forEach(t => { if (!t.manual) { const c = autoCat(t); if (c !== t.category) { t.category = c; n++; } } });
        save(); toast(`${n} transactions recategorised`); break;
      }
      case 'export': exportBackup(); break;
      case 'restore': { const f = el.files && el.files[0]; el.value = ''; if (f) restoreBackup(f); break; }
      case 'wipe':
        if (confirm('Erase all transactions, budgets and rules from this phone? This cannot be undone.')) {
          S = fresh(); save(); UI.pending = null; UI.month = thisMonth(); render(); toast('All data erased');
        }
        break;
    }
  }

  /* ---------- events ---------- */
  const view = $('#view');
  view.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    act(el.dataset.action, el);
  });
  view.addEventListener('change', e => {
    const el = e.target.closest('[data-action]');
    if (el && (el.tagName === 'SELECT' || el.tagName === 'INPUT') && el.dataset.action !== 'search') act(el.dataset.action, el);
  });
  view.addEventListener('input', e => {
    if (e.target.dataset.action === 'search') { UI.search = e.target.value; $('#txlist').innerHTML = txList(); }
  });
  view.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f));
    if (f.id === 'addform') {
      const v = parseFloat(String(d.amount).replace(',', '.').replace(/[^\d.]/g, ''));
      if (!isFinite(v) || v <= 0) { toast('Enter an amount above zero'); return; }
      S.txns.push({ id: uid(), date: d.date, desc: d.desc.trim(), amount: d.type === 'in' ? v : -v, category: d.category, manual: true });
      save(); UI.month = d.date.slice(0, 7); render(); toast('Transaction added');
    } else if (f.id === 'catform') {
      const name = d.name.trim();
      if (!name || catNames().some(n => n.toLowerCase() === name.toLowerCase())) { toast('That category already exists'); return; }
      S.categories.splice(S.categories.length - 1, 0, { name, budget: 0 });
      save(); render();
    } else if (f.id === 'ruleform') {
      const k = d.keyword.trim().toUpperCase();
      if (!k) return;
      S.rules.unshift({ keyword: k, category: d.category });
      save(); render(); toast('Rule added — tap “Re-apply rules” to update old transactions');
    }
  });
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
    UI.view = b.dataset.view; if (UI.view === 'transactions') UI.search = '';
    render(); window.scrollTo(0, 0);
  }));

  render();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
