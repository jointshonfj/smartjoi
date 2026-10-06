// SmartJoi · StockUpdate — čtení skladové listiny dodavatele (PDF) a příprava importu skladu do Shoptetu
// Bez závislostí: dostane textové položky z PDF (pdf.js) a řádky CSV exportu ze Shoptetu.

// ---------- PDF: Gunreben „G2 Terrassen-Lagerliste“ ----------
// Stránky jsou tabulky: nahoře kód artiklu (např. F31090A00150), pod ním sloupce Stück / lfm, vlevo délka (3,00 …).
// items: [[{ s, x, y, w }]] po stránkách (souřadnice PDF, y roste nahoru)
const CODE_RE = /^[A-Z][0-9][0-9A-Z]{10}$/;
const LEN_RE = /^\d{1,2},\d{2}$/;
const INT_RE = /^\d+(?:\.\d{3})*$/;
const DEC_RE = /^\d+(?:\.\d{3})*,\d{2}$/;
const czNum = s => Number(String(s).replace(/\./g, '').replace(',', '.'));

export function parseSupplierStock(pages) {
  const stock = {};           // kód → { '3.00': kusy, … }
  let updated = null, pairs = 0, unassigned = 0;
  for (const raw of pages) {
    const items = raw.map(i => ({ ...i, s: String(i.s).trim(), cx: i.x + (i.w || 0) / 2 })).filter(i => i.s);
    const upd = items.find(i => /\d{2}\.\d{2}\.\d{4}\s+\d{1,2}:\d{2}/.test(i.s));
    if (upd && !updated) updated = /(\d{2}\.\d{2}\.\d{4}\s+\d{1,2}:\d{2})/.exec(upd.s)[1];
    const codes = items.filter(i => CODE_RE.test(i.s));
    // řádky podle y
    const rows = [];
    for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const r = rows.find(r => Math.abs(r.y - it.y) <= 2);
      if (r) r.items.push(it); else rows.push({ y: it.y, items: [it] });
    }
    for (const r of rows) {
      const cells = r.items.sort((a, b) => a.x - b.x);
      for (let k = 0; k < cells.length; k++) {
        const n = cells[k];
        if (!INT_RE.test(n.s)) continue;
        const lfm = cells[k + 1];
        if (!lfm || !DEC_RE.test(lfm.s)) continue;
        // délka: nejbližší vlevo, která není lfm (lfm stojí hned za počtem kusů)
        let len = null;
        for (let j = k - 1; j >= 0; j--) if (LEN_RE.test(cells[j].s) && !(j > 0 && INT_RE.test(cells[j - 1].s))) { len = cells[j]; break; }
        if (!len) continue;
        const L = czNum(len.s), q = czNum(n.s), m = czNum(lfm.s);
        if (Math.abs(q * L - m) > 0.02 + m * 0.0005) continue;   // kontrola: kusy × délka = lfm
        const mid = (n.x + lfm.x + (lfm.w || 0)) / 2;
        // kód: nad řádkem, ve stejném sloupci, nejbližší
        const cand = codes.filter(c => c.y > r.y && c.y - r.y < 420 && Math.abs(c.cx - mid) < 45).sort((a, b) => (a.y - r.y) - (b.y - r.y));
        if (!cand.length) { unassigned++; continue; }
        const code = cand[0].s;
        (stock[code] ||= {})[L.toFixed(2)] = q;
        pairs++;
      }
    }
  }
  // druhý formát: seznam „Nr. | Beschreibung | Beschreibung 2 | packs available | quantity available“ (vinyl)
  const list = parseStockList(pages);
  for (const [code, v] of Object.entries(list.stock)) if (!stock[code]) stock[code] = v;
  return { stock, updated, pairs: pairs + list.rows, unassigned, info: list.info, format: list.rows > pairs ? 'list' : 'lengths' };
}

// seznam: kód | popis | balení | množství (m²) — sklad bez délek, klíč 'all'
const SNUM_RE = /^-?\d+(?:\.\d{3})*,\d{2}$/;
export function parseStockList(pages) {
  const stock = {}, info = {}; let rows = 0;
  for (const raw of pages) {
    const items = raw.map(i => ({ ...i, s: String(i.s).trim() })).filter(i => i.s);
    const lines = [];
    for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const r = lines.find(r => Math.abs(r.y - it.y) <= 2);
      if (r) r.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    for (const l of lines) {
      const c = l.items.sort((a, b) => a.x - b.x);
      if (c.length < 4 || !CODE_RE.test(c[0].s)) continue;
      const q = c[c.length - 1], p = c[c.length - 2];
      if (!SNUM_RE.test(q.s) || !SNUM_RE.test(p.s)) continue;
      const packs = czNum(p.s), qty = czNum(q.s);
      stock[c[0].s] = { all: qty };
      info[c[0].s] = { desc: c.slice(1, -2).map(x => x.s).join(' | '), packs, qty, perPack: packs > 0 ? qty / packs : null };
      rows++;
    }
  }
  return { stock, info, rows };
}

// ---------- CSV (Shoptet export: středník, uvozovky, UTF-8 s BOM) ----------
export function parseCsv(text) {
  const t = String(text).replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ';') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); if (row.some(c => c !== '')) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some(c => c !== '')) rows.push(row); }
  const head = rows.shift() || [];
  while (head.length && head[head.length - 1] === '') head.pop();
  return { head, rows: rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) };
}
const csvCell = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (head, rows) => '﻿' + [head.map(csvCell).join(';'), ...rows.map(r => head.map(h => csvCell(r[h])).join(';'))].join('\r\n') + '\r\n';

// délka varianty z Shoptetu: „3 m“, „3,0 m“, „3,6 m“ → '3.00'
export function variantLength(row) {
  for (const [k, v] of Object.entries(row)) {
    if (!k.startsWith('variant:')) continue;
    const m = /^\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*m\s*$/i.exec(v || '');
    if (m) return Number(m[1].replace(',', '.')).toFixed(2);
  }
  return null;
}

// ---------- párování podle názvu (seznam s popisem, např. „Helios 2,5mm“ ↔ „HELIOS lepený Dub 2,5 mm“) ----------
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const thick = s => { const m = /(\d+[.,]\d+)\s*mm/i.exec(String(s || '')); return m ? Number(m[1].replace(',', '.')) : null; };
function descMatches(name, desc) {
  const w = fold(desc).split(/[\s|]+/)[0];
  if (!w || !new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(fold(name))) return false;
  const a = thick(name), b = thick(desc);
  return a == null || b == null || a === b;
}
export function suggestByName(name, info) {
  const hit = Object.entries(info || {}).filter(([, v]) => descMatches(name, v.desc)).map(([k]) => k);
  return hit.length === 1 ? hit[0] : null;
}

// ---------- návrh nového skladu ----------
// opts: { reserve: 30 (%), stockCol: 'stock:Extérní sklad', mappings: { pairCode|code: kódDodavatele } }
export function buildUpdate(csv, supplier, opts = {}) {
  const reserve = Number(opts.reserve ?? 30), stockCol = opts.stockCol, maps = opts.mappings || {};
  // kód dodavatele pro skupinu (pairCode): partNumber kterékoli varianty, nebo ruční přiřazení
  const groupKey = r => r.pairCode || r.code;
  const groupPart = {};
  for (const r of csv.rows) { const k = groupKey(r); if (r.partNumber && !groupPart[k]) groupPart[k] = r.partNumber.trim(); }
  const out = [];
  for (const r of csv.rows) {
    const k = groupKey(r);
    const manual = maps[k] || '';
    let sc = manual || r.partNumber?.trim() || groupPart[k] || '';
    let byName = false, warn = '';
    // seznam s popisem: kontrola, že kód sedí k názvu produktu; jinak návrh podle názvu
    if (!manual && supplier.info && Object.keys(supplier.info).length) {
      const inf = supplier.info[sc];
      if (!sc || !inf || !descMatches(r.name, inf.desc)) {
        const sug = suggestByName(r.name, supplier.info);
        if (sug) { if (sc && sc !== sug) warn = `partNumber v Shoptetu ${sc}${inf ? ' = ' + inf.desc.split('|')[0].trim() : ''}`; sc = sug; byName = true; }
        else if (sc && inf) warn = `kód ${sc} = ${inf.desc.split('|')[0].trim()} — nesedí k názvu`;
      }
    }
    const len = variantLength(r);
    const cur = r[stockCol] === '' || r[stockCol] == null ? null : Number(String(r[stockCol]).replace(',', '.'));
    const base = { code: r.code, pairCode: r.pairCode, group: k, name: r.name, length: len, supplierCode: sc, mapped: manual ? 'ručně' : byName ? 'podle názvu' : r.partNumber ? 'partNumber' : groupPart[k] ? 'podle varianty' : '', current: cur, warn, desc: supplier.info?.[sc]?.desc || '' };
    if (!sc) { out.push({ ...base, status: 'nomap' }); continue; }
    const st = supplier.stock[sc];
    if (!st) { out.push({ ...base, status: 'nocode' }); continue; }
    if ('all' in st) {
      // seznam (vinyl): rezerva se počítá z celých balení, do Shoptetu jde množství (m²) za celá balení
      const inf = supplier.info?.[sc] || {}, sup = st.all;
      let next;
      if (inf.perPack && inf.packs > 0) next = Math.round(Math.floor(inf.packs * (100 - reserve) / 100) * inf.perPack * 1000) / 1000;
      else next = Math.floor(sup * (100 - reserve) / 100 * 100) / 100;
      next = Math.max(0, next);
      out.push({ ...base, status: 'ok', supplierQty: sup, supplierPacks: inf.packs, next, change: cur == null ? null : Math.round((next - cur) * 1000) / 1000 });
      continue;
    }
    if (!len) { out.push({ ...base, status: 'nolen' }); continue; }
    const sup = st[len] ?? 0;                                   // délka v listině chybí = dodavatel nemá
    const next = Math.max(0, Math.floor(sup * (100 - reserve) / 100));
    out.push({ ...base, status: 'ok', supplierQty: sup, next, change: cur == null ? null : next - cur });
  }
  return out;
}
export function exportRows(rows, stockCol) {
  const head = ['code', 'pairCode', stockCol];
  return toCsv(head, rows.filter(r => r.status === 'ok').map(r => ({ code: r.code, pairCode: r.pairCode, [stockCol]: r.next })));
}
