/* Pocket Ledger — statement parsing (CSV + PDF text lines).
   Pure functions, no DOM, so they can be tested in Node. */
(function (root) {
  'use strict';

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  const pad = n => String(n).padStart(2, '0');
  function iso(y, m, d) {
    if (!(y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  /* Parse common statement date formats. Day-first for numeric dates (Namibian convention).
     fallbackYear is used when the date has no year, e.g. "15 Sep". */
  function parseDate(s, fallbackYear) {
    if (s == null) return null;
    s = String(s).trim();
    let m;
    if ((m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/))) {
      let y = +m[3]; if (y < 100) y += 2000;
      return iso(y, +m[2], +m[1]);
    }
    if ((m = s.match(/^(\d{1,2})[\s\-]*([A-Za-z]{3,9})\.?[\s\-]*(\d{4})?\b/))) {
      const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
      if (!mo) return null;
      const y = m[3] ? +m[3] : fallbackYear;
      return y ? iso(y, mo, +m[1]) : null;
    }
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return iso(+m[1], +m[2], +m[3]);
    return null;
  }

  /* Parse an amount like "-1,234.56", "1 234.56Cr", "(45.00)", "N$ 99.90", "12,50".
     Returns { value, cr } or null. cr = true when the amount carried a "Cr" marker. */
  function parseAmount(s) {
    if (s == null) return null;
    let t = String(s).replace(/[\s\u00a0\u202f]/g, '');
    if (!t) return null;
    let neg = false, cr = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (/cr$/i.test(t)) { cr = true; t = t.slice(0, -2); }
    else if (/dr$/i.test(t)) { neg = !neg; t = t.slice(0, -2); }
    t = t.replace(/^(N\$|NAD|R)/i, '');
    if (t.startsWith('-')) { neg = !neg; t = t.slice(1); }
    else if (t.endsWith('-')) { neg = !neg; t = t.slice(0, -1); }
    else if (t.startsWith('+')) t = t.slice(1);
    t = t.replace(/^(N\$|NAD|R)/i, '');
    if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
    else t = t.replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const v = parseFloat(t);
    return { value: neg ? -v : v, cr };
  }

  /* RFC-4180-ish CSV parser with delimiter detection (comma, semicolon, tab). */
  function parseCSV(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const sample = text.split(/\r?\n/).slice(0, 25).join('\n');
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQ = false;
    for (const ch of sample) { if (ch === '"') inQ = !inQ; else if (!inQ && ch in counts) counts[ch]++; }
    const d = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const rows = []; let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === d) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map(r => r.map(x => x.trim().replace(/^'+|'+$/g, ''))).filter(r => r.some(x => x !== ''));
  }

  const looksLikeMoney = s => !!s && /\d[.,]\d{2}\b/.test(s) && !!parseAmount(s);

  /* Work out which CSV columns hold the date, description and amount(s). */
  function guessMapping(rows) {
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const r = rows[i].map(c => c.toLowerCase());
      if (r.some(c => /date/.test(c)) && r.some(c => /amount|debit|credit|desc|narr|detail|reference|particular/.test(c))) { headerIdx = i; break; }
    }
    const map = { date: -1, desc: -1, amount: -1, debit: -1, credit: -1 };
    if (headerIdx >= 0) {
      rows[headerIdx].forEach((h, i) => {
        const c = h.toLowerCase();
        if (map.date < 0 && /date/.test(c)) map.date = i;
        else if (/balance/.test(c)) { /* ignore */ }
        else if (map.debit < 0 && /debit|withdraw|money out|paid out/.test(c)) map.debit = i;
        else if (map.credit < 0 && /credit|deposit|money in|paid in/.test(c)) map.credit = i;
        else if (map.amount < 0 && /amount|value/.test(c)) map.amount = i;
        else if (map.desc < 0 && /desc|narr|detail|reference|particular|transaction|payee/.test(c)) map.desc = i;
      });
    }
    const sample = rows.slice(headerIdx + 1, headerIdx + 41);
    const ncol = Math.max(0, ...sample.map(r => r.length));
    const dateScore = i => sample.filter(r => parseDate(r[i], 2000)).length;
    const moneyScore = i => sample.filter(r => looksLikeMoney(r[i])).length;
    if (map.date < 0) {
      let best = -1, bs = 0;
      for (let i = 0; i < ncol; i++) { const s = dateScore(i); if (s > bs) { bs = s; best = i; } }
      map.date = best;
    }
    if (map.amount < 0 && map.debit < 0 && map.credit < 0) {
      for (let i = 0; i < ncol; i++) {
        if (i !== map.date && moneyScore(i) >= Math.max(1, sample.length * 0.5)) { map.amount = i; break; }
      }
    }
    if (map.desc < 0) {
      const used = [map.date, map.amount, map.debit, map.credit];
      let best = -1, bl = 0;
      for (let i = 0; i < ncol; i++) {
        if (used.includes(i)) continue;
        const l = sample.reduce((a, r) => a + (looksLikeMoney(r[i]) ? 0 : (r[i] || '').replace(/[\d\s.,\-]/g, '').length), 0);
        if (l > bl) { bl = l; best = i; }
      }
      map.desc = best;
    }
    return { headerIdx, map };
  }

  const cleanDesc = s => String(s || '').replace(/\s+/g, ' ').trim() || '(no description)';
  const round2 = v => Math.round(v * 100) / 100;

  /* Turn CSV rows into transactions using a column mapping. Money out is negative. */
  function rowsToTxns(rows, headerIdx, map, opts) {
    opts = opts || {};
    const out = [];
    for (const r of rows.slice(headerIdx + 1)) {
      const date = parseDate(r[map.date], opts.year);
      if (!date) continue;
      let amt = null;
      if (map.amount >= 0) {
        const a = parseAmount(r[map.amount]);
        if (a) amt = a.cr ? Math.abs(a.value) : a.value;
      } else {
        const d = map.debit >= 0 ? parseAmount(r[map.debit]) : null;
        const c = map.credit >= 0 ? parseAmount(r[map.credit]) : null;
        if (d || c) amt = (c ? Math.abs(c.value) : 0) - (d ? Math.abs(d.value) : 0);
      }
      if (amt == null || amt === 0) continue;
      out.push({ date, desc: cleanDesc(r[map.desc]), amount: round2(amt) });
    }
    return out;
  }

  const AMT_RE = /(?:^|\s)(-?(?:N\$\s?)?\d{1,3}(?:[ ,]\d{3})*\.\d{2}(?:\s?(?:Cr|Dr)\b)?-?)(?=\s|$)/gi;
  const DATE_START = /^(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\.?(?:\s+\d{4})?)(?=\s)/;

  /* Read transactions from text lines extracted from a PDF statement.
     Expects lines like: "15 Sep  POS Purchase Shoprite  245.90  3,120.45Cr".
     First amount = transaction, last = running balance (ignored).
     If the statement marks credits with "Cr", unmarked amounts are treated as money out. */
  function parseStatementLines(lines, year) {
    const joined = lines.join('\n');
    const crStyle = /\d\.\d{2}\s?Cr\b/i.test(joined);
    const out = [];
    let y = year, lastMonth = 0;
    for (const raw of lines) {
      const line = String(raw).replace(/\s+/g, ' ').trim();
      const dm = line.match(DATE_START);
      if (!dm) continue;
      const hasYear = /\d{4}/.test(dm[1]);
      let date = parseDate(dm[1], y);
      if (!date) continue;
      if (!hasYear) {
        const mo = +date.slice(5, 7);
        if (lastMonth === 12 && mo === 1) { y += 1; date = parseDate(dm[1], y); }
        lastMonth = mo;
      }
      const rest = line.slice(dm[0].length);
      const amts = [...rest.matchAll(AMT_RE)];
      if (!amts.length) continue;
      const first = amts[0];
      const a = parseAmount(first[1]);
      if (!a) continue;
      let v = a.value;
      if (a.cr) v = Math.abs(v);
      else if (crStyle && v > 0) v = -v;
      if (v === 0) continue;
      const desc = rest.slice(0, first.index).trim();
      out.push({ date, desc: cleanDesc(desc), amount: round2(v) });
    }
    return out;
  }

  /* Most frequent 4-digit year in the text, e.g. from "Statement period 01 Sep 2026 to 30 Sep 2026". */
  function guessYear(text) {
    const counts = {};
    for (const m of String(text).matchAll(/\b(20\d{2})\b/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
    const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    return best ? +best : null;
  }

  function categorize(desc, rules) {
    const d = String(desc).toUpperCase();
    for (const r of rules) if (r.keyword && d.includes(String(r.keyword).toUpperCase())) return r.category;
    return null;
  }

  /* Key used to spot transactions that were already imported. */
  function txnKey(t) {
    return t.date + '|' + Number(t.amount).toFixed(2) + '|' + String(t.desc).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);
  }

  const api = { parseDate, parseAmount, parseCSV, guessMapping, rowsToTxns, parseStatementLines, guessYear, categorize, txnKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parser = api;
})(typeof self !== 'undefined' ? self : this);
