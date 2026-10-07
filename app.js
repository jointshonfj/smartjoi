/* SmartJoi — frontend (GitHub Pages + Supabase) */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import * as DC from './dochazka-core.js?v=20261007b';
import { addAttendanceSheet, downloadWorkbook, workbookBuffer } from './dochazka-xlsx.js?v=20261007b';
import * as SU from './stockupdate-core.js?v=20261007b';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let S = null;            // stav ze serveru
let busy = false;
const ui = { stockSearch: '', stockWh: '', stockCat: '', stockOnly: '', stockMoveSearch: '', stockMoveKind: '', orderSearch: '', emailSearch: '', emailCat: '', emailVals: {}, search: '', orderFilter: 'active', aufFilter: 'sent', docs: {}, includeRefs: false, showPast: false };

const COUNTRIES = [
  ['DE', 'Německo'], ['AT', 'Rakousko'], ['PL', 'Polsko'], ['SK', 'Slovensko'], ['IT', 'Itálie'], ['NL', 'Nizozemsko'],
  ['BE', 'Belgie'], ['FR', 'Francie'], ['ES', 'Španělsko'], ['DK', 'Dánsko'], ['SE', 'Švédsko'], ['HU', 'Maďarsko'],
  ['SI', 'Slovinsko'], ['CN', 'Čína'], ['GB', 'Velká Británie'], ['CZ', 'Česko'],
];
const MAP_LABELS = {
  orderCode: 'Číslo objednávky', status: 'Stav objednávky', itemCode: 'Kód položky', itemName: 'Název položky', itemVariant: 'Varianta',
  itemAmount: 'Množství', itemUnit: 'Jednotka', itemType: 'Typ položky (doprava/platba se přeskočí)', date: 'Datum',
};
const TABS = [
  ['objednavky', 'Objednávky'], ['aufy', 'AUFy'], ['svozy', 'Svozy'],
  ['produkty', 'Produkty'], ['dodavatele', 'Dodavatelé'], ['nastaveni', 'Nastavení'],
];
// stav objednávky v SmartJoi (od ruky ze Shoptetu až po svoz)
const STATE = {
  issue:     ['Reklamace / problém', 'bad', 0],
  todo:      ['Potřeba objednat', 'warn', 1],
  waiting:   ['Čeká na AUF', 'info', 2],
  confirmed: ['AUF potvrzen · bez svozu', 'ok', 3],
  shipping:  ['Na cestě', 'ok', 4],
  delivered: ['Doručeno', 'ok', 5],
  none:      ['Nic k objednání', '', 6],
  empty:     ['Bez položek', '', 7],
};
// stav dodání AUFu (po příjezdu svozu)
const DELIVERY = { ok: ['Doručeno v pořádku', 'ok', '✓'], complaint: ['Reklamace', 'bad', '⚠'], missing: ['Chybí zboží', 'bad', '⚠'], damaged: ['Poškozené zboží', 'bad', '⚠'], other: ['Jiný problém', 'warn', '⚠'] };
const isIssue = a => !!a.deliveredAt && !!a.delivery && a.delivery !== 'ok';
// fáze pro ukazatel postupu: objednáno → AUF → svoz → doručeno
const STEP = { todo: 0, waiting: 1, confirmed: 2, shipping: 3, delivered: 4, issue: 4 };
const AUF_STATE = { draft: ['Koncept e-mailu', ''], sent: ['Odesláno · čeká na AUF', 'info'], confirmed: ['AUF potvrzen', 'ok'] };

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const flag = cc => cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map(c => 127397 + c.charCodeAt(0))) : '🌍';
const countryName = cc => (COUNTRIES.find(c => c[0] === cc) || [cc, cc || '—'])[1];
const fmtQty = n => (Math.round(n * 1000) / 1000).toLocaleString('cs-CZ');
const fmtQtyEn = n => String(Math.round(n * 1000) / 1000);
const eur = n => n == null || n === '' || isNaN(n) ? '—' : Number(n).toLocaleString('cs-CZ', { style: 'currency', currency: 'EUR' });
const parseEur = s => { const t = String(s ?? '').replace(/\s|€|eur/gi, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); const n = parseFloat(t); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const todayIso = () => new Date().toISOString().slice(0, 10);
// hledání bez ohledu na velikost písmen a diakritiku
const fold = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const plural = (n, a, b, c) => `${n} ${n === 1 ? a : n > 1 && n < 5 ? b : c}`;
function fmtDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d)) return iso;
  return d.toLocaleString('cs-CZ', withTime ? { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'numeric', year: 'numeric' });
}
const fmtDay = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' }) : 'bez data';
function ago(iso) {
  if (!iso) return 'nikdy';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'právě teď';
  if (s < 3600) return `před ${Math.round(s / 60)} min`;
  if (s < 86400) return `před ${Math.round(s / 3600)} h`;
  return fmtDate(iso);
}
function unitEn(u) {
  const x = String(u || '').trim().toLowerCase().replace('.', '');
  const M = { ks: 'pcs', kus: 'pcs', kusů: 'pcs', kusy: 'pcs', pcs: 'pcs', m2: 'm²', 'm²': 'm²', bm: 'lm', m: 'm', bal: 'pack(s)', balení: 'pack(s)', kg: 'kg', t: 't', l: 'l', pár: 'pair(s)', sada: 'set(s)', sad: 'set(s)', krab: 'box(es)', krabice: 'box(es)', role: 'roll(s)', paleta: 'pallet(s)' };
  return M[x] || (u ? u : 'pcs');
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2000);
}
async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return toast('Zkopírováno ✓'); } } catch {}
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
  document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
  let okc = false; try { okc = document.execCommand('copy'); } catch {}
  ta.remove(); toast(okc ? 'Zkopírováno ✓' : 'Označ text a zkopíruj ručně');
}
const fmtSize = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' kB';

// ---------- data ----------
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
async function fetchAll(table, build = q => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = ok(await build(sb.from(table).select('*')).range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
async function loadState() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [st, sups, prods, orders, items, aufs, ships, events, emails, stock, attEmps, attMonths, aiMem, attHol, suCfg, suRuns] = await Promise.all([
    sb.from('settings').select('*').eq('id', 1).single().then(ok),
    fetchAll('suppliers', q => q.order('name')),
    fetchAll('products', q => q.order('code')),
    fetchAll('orders', q => q.order('code', { ascending: false })),
    fetchAll('order_items', q => q.order('key')),
    fetchAll('aufs', q => q.order('created_at', { ascending: false })),
    fetchAll('shipments', q => q.order('ship_date')),
    sb.from('calendar_events').select('*').gte('starts_on', since).order('starts_on').limit(200).then(ok),
    fetchAll('email_templates', q => q.order('title')),
    loadStock(),
    fetchAll('att_employees', q => q.order('sort').order('name')),
    fetchAll('att_months', q => q.order('month', { ascending: false })),
    fetchAll('ai_memory', q => q.order('created_at')),
    fetchAll('att_holidays', q => q.order('date')).catch(() => []),
    fetchAll('su_config', q => q.order('id')).catch(() => []),
    fetchAll('su_runs', q => q.order('week', { ascending: false })).catch(() => []),
  ]);
  const products = {};
  for (const p of prods) products[p.code] = { supplierId: p.skip ? 'none' : (p.supplier_id || ''), supplierCode: p.supplier_code, supplierName: p.supplier_name, name: p.name, nameEn: p.name_en || '', nameEnSrc: p.name_en_src || '', mpn: p.mpn || '', shoptetSupplier: p.shoptet_supplier || '' };
  S = {
    settings: { csvUrl: st.csv_url, statusValue: st.status_value, mapping: st.mapping || {}, companyName: st.company_name, subjectTemplate: st.subject_template, extraNote: st.extra_note, signature: st.signature, productsCsvUrl: st.products_csv_url || '', productsSyncInfo: st.products_sync_info || {}, deeplKey: st.deepl_api_key || '', translateInfo: st.translate_info || {}, calendarToken: st.calendar_token || '', warehouseMsg: st.warehouse_msg || {}, attEmail: st.att_email || {} },
    suppliers: sups.map(s => ({ id: s.id, name: s.name, country: s.country, email: s.email, contact: s.contact, customerNo: s.customer_no, notes: s.notes })),
    products,
    orders: orders.map(o => ({ code: o.code, date: o.order_date, customer: o.customer, shoptetStatus: o.shoptet_status, active: o.active, note: o.note || '', archived: o.archived, manual: !!o.manual })),
    items: items.map(i => ({ key: i.key, orderCode: i.order_code, code: i.code, name: i.name, qty: Number(i.qty), unit: i.unit, active: i.active, decision: i.decision, supplierId: i.supplier_id || '', aufId: i.auf_id || '', manual: !!i.manual, variant: i.variant || '' })),
    aufs: aufs.map(a => ({ id: a.id, orderCode: a.order_code, supplierId: a.supplier_id || '', status: a.status, to: a.email_to, subject: a.subject, body: a.body, lines: a.lines || [], sentAt: a.sent_at, aufNumber: a.auf_number || '', amount: a.amount_eur == null ? null : Number(a.amount_eur), confirmedAt: a.confirmed_at, note: a.note || '', shipmentId: a.shipment_id || '', createdAt: a.created_at, deliveredAt: a.delivered_at || null, delivery: a.delivery_status || '', deliveryNote: a.delivery_note || '', resolvedAt: a.issue_resolved_at || null })),
    shipments: ships.map(s => ({ id: s.id, date: s.ship_date || '', note: s.note || '', ref: s.reference || '', deliveredAt: s.delivered_at || null })),
    events,
    stock,
    att: {
      employees: attEmps.map(e => ({ ...e, weekly_hours: Number(e.weekly_hours), daily_hours: Number(e.daily_hours) })),
      months: attMonths.map(r => ({ id: r.id, employeeId: r.employee_id, month: r.month, entries: r.entries || [], shiftDays: r.shift_days || {}, sources: r.sources || [], report: r.report, status: r.status, note: r.note, updatedAt: r.updated_at })),
      memory: aiMem.map(m => ({ id: m.id, scope: m.scope, text: m.text, createdAt: m.created_at })),
      holidays: attHol.map(h => ({ date: String(h.date).slice(0, 10), name: h.name })),
    },
    su: suCfg.map(c => ({ ...c, reserve: Number(c.reserve), mappings: c.mappings || {} })),
    suRuns: suRuns.map(r => ({ ...r, week: String(r.week).slice(0, 10) })),
    emails: emails.map(e => ({ id: e.id, title: e.title, category: e.category || '', to: e.to_addr || '', cc: e.cc || '', subject: e.subject || '', body: e.body || '', note: e.note || '', pinned: !!e.pinned, useCount: e.use_count || 0, lastUsed: e.last_used_at, updatedAt: e.updated_at })),
    sync: { fetchedAt: st.last_sync_at, error: st.last_sync_error, errorAt: st.last_sync_error_at, headers: st.sync_headers || [], rowCount: st.sync_row_count, sample: st.sync_sample || [], statuses: st.sync_statuses || {} },
  };
}
// akce: provede změnu, znovu načte data a překreslí
async function act(fn, msg) {
  busy = true;
  try { const r = await fn(); await loadState(); if (msg) toast(msg); render(); return r; }
  catch (e) { toast('Chyba: ' + e.message); console.error(e); }
  finally { busy = false; }
}
async function requestSync() {
  const snap = async () => ok(await sb.from('settings').select('last_sync_at,last_sync_error_at').eq('id', 1).single());
  const before = await snap();
  ok(await sb.rpc('request_shoptet_sync', { task: 'orders' }));
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const now = await snap();
    if (now.last_sync_at !== before.last_sync_at || now.last_sync_error_at !== before.last_sync_error_at) {
      sb.rpc('request_shoptet_sync', { task: 'products' }).then(() => {}, () => {});
      return;
    }
  }
  throw new Error('Shoptet neodpověděl do 90 s, zkus to za chvíli znovu.');
}

// ---------- derived ----------
const supplierById = id => S.suppliers.find(s => s.id === id);
const supName = id => supplierById(id)?.name || '(bez dodavatele)';
const prod = code => S.products[code] || {};
const supCode = code => prod(code).supplierCode || prod(code).mpn || code;     // kód do e-mailu
const enName = code => prod(code).supplierName || prod(code).nameEn || '';     // název do e-mailu
// ruční položka s vlastním názvem → do e-mailu jde název tak, jak ho napsal (produkt může mít jinou délku / variantu)
const itemEn = i => i.manual && i.name && prod(i.code).name !== i.name ? i.name : (enName(i.code) || (i.manual ? i.name : ''));
// kód, který SmartJoi vymyslí pro ruční položku bez kódu (do e-mailu se nepíše)
const genCode = c => /^M-[A-Z0-9]{6}$/.test(c || '');
const orderByCode = code => S.orders.find(o => o.code === code);
const aufById = id => S.aufs.find(a => a.id === id);
const aufsOf = code => S.aufs.filter(a => a.orderCode === code);
const orderItems = code => S.items.filter(i => i.orderCode === code && (i.active || i.aufId));
const shipmentById = id => S.shipments.find(s => s.id === id);
const aufsInShipment = id => S.aufs.filter(a => a.shipmentId === id);
const sumEur = list => list.reduce((s, a) => s + (a.amount || 0), 0);
// dodavatel položky: ručně u položky > výchozí u produktu
function effSup(it) { if (it.supplierId) return it.supplierId; const d = prod(it.code).supplierId; return d && d !== 'none' ? d : ''; }
// objednat / neobjednávat: ručně u položky > podle produktu (neobjednávat = skladem/CZ) > výchozí objednat
function effDec(it) { if (it.decision) return it.decision; if (prod(it.code).supplierId === 'none') return 'skip'; return 'order'; }
function orderState(code) {
  const its = orderItems(code), aufs = aufsOf(code);
  if (!its.length && !aufs.length) return 'empty';
  const open = its.filter(i => !i.aufId);
  if (aufs.some(isIssue)) return 'issue';
  if (open.some(i => effDec(i) === 'order') || aufs.some(a => a.status === 'draft')) return 'todo';
  if (aufs.some(a => a.status === 'sent')) return 'waiting';
  if (aufs.some(a => a.status === 'confirmed' && !a.shipmentId && !a.deliveredAt)) return 'confirmed';
  if (aufs.some(a => a.status === 'confirmed' && !a.deliveredAt)) return 'shipping';
  if (aufs.some(a => a.deliveredAt)) return 'delivered';
  return 'none';
}
function counts() {
  const act = S.orders.filter(o => !o.archived);
  const st = act.map(o => orderState(o.code));
  return {
    todo: st.filter(x => x === 'todo').length, waiting: st.filter(x => x === 'waiting').length,
    issue: st.filter(x => x === 'issue').length, transit: st.filter(x => x === 'shipping').length,
    unshipped: S.aufs.filter(a => a.status === 'confirmed' && !a.shipmentId && !a.deliveredAt).length,
    shipping: S.shipments.filter(s => !s.deliveredAt).length,
    toReceive: S.shipments.filter(s => !s.deliveredAt && s.date && s.date <= todayIso() && aufsInShipment(s.id).length).length,
    sentAufs: S.aufs.filter(a => a.status === 'sent').length,
  };
}

// ---------- router ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { app: h[0] || '', tab: h[1] || '', id: h[2] || '' };
}
function render() {
  if (!S) { $('#view').innerHTML = '<div class="empty"><div class="big spin">◌</div>Načítám…</div>'; return; }
  const r = route();
  const crumb = $('#crumb');
  if (r.app === 'kalendar') { crumb.innerHTML = `<span>/</span><b>Kalendář</b>`; return renderCalendar(); }
  if (r.app === 'emaily') {
    const e = r.tab === 'e' ? emailById(r.id) : null;
    crumb.innerHTML = `<span>/</span><a href="#/emaily">EmailJoi</a>${e ? `<span>/</span><b>${esc(e.title)}</b>` : ''}`;
    return r.tab === 'e' ? renderEmailDetail(r.id) : renderEmailList();
  }
  if (r.app === 'dochazka') {
    const e = r.tab ? S.att.employees.find(x => x.id === r.tab) : null;
    crumb.innerHTML = `<span>/</span><a href="#/dochazka">DocházkoBot</a>${e ? `<span>/</span><b>${esc(e.name)}</b>` : ''}`;
    return renderAttApp(e ? e.id : '');
  }
  if (r.app === 'stockupdate') { crumb.innerHTML = `<span>/</span><a href="#/stockupdate">StockUpdate 1.0</a>${r.tab === 'w' && r.id ? `<span>/</span><b>${weekLabel(mondayOf(r.id))}</b>` : ''}`; return renderSuApp(r.tab === 'w' ? r.id : ''); }
  if (r.app === 'sklad') {
    const it = r.tab === 'p' ? stItem(r.id) : null;
    crumb.innerHTML = `<span>/</span><a href="#/sklad">StockJoi</a>${it ? `<span>/</span><b>${esc(it.name)}</b>` : ''}`;
    return r.tab === 'p' ? renderStockItem(r.id) : renderStockApp(r.tab || 'prehled');
  }
  if (r.app !== 'objednavky') { crumb.innerHTML = ''; return renderHub(); }
  crumb.innerHTML = `<span>/</span><a href="#/objednavky">OrderJoi</a>${r.tab === 'o' ? `<span>/</span><b>${esc(r.id)}</b>` : ''}`;
  if (r.tab === 'o') return renderOrderDetail(r.id);
  renderOrdersApp(r.tab || 'objednavky');
}

// ---------- HUB ----------
function renderHub() {
  const c = counts();
  const next = S.events.filter(e => e.starts_on >= todayIso()).slice(0, 3);
  $('#view').innerHTML = `
    <section class="hero">
      <div class="eyebrow">Jointshon — FJ · interní nástroje</div>
      <h1>Systém místo chaosu.</h1>
      <p>Všechny tvoje pracovní aplikace na jednom místě — na počítači i v telefonu.</p>
    </section>
    <div class="apps">
      <a class="app-card" href="#/objednavky">
        <div class="row"><div class="app-icon">📦</div><span class="num grow" style="text-align:right">01</span></div>
        <h3>OrderJoi</h3>
        <p>Vinylor · objednávky od dodavatelů: Shoptet → e-mail dodavateli → AUF → svoz.</p>
        <div class="badge-row">
          ${c.issue ? `<span class="badge bad"><span class="dot"></span>${c.issue} reklamace</span>` : ''}
          ${c.todo ? `<span class="badge warn"><span class="dot"></span>${c.todo} potřeba objednat</span>` : ''}
          ${c.sentAufs ? `<span class="badge info">${c.sentAufs} čeká na AUF</span>` : ''}
          ${c.unshipped ? `<span class="badge ok">${c.unshipped} AUF bez svozu</span>` : ''}
          ${c.toReceive ? `<span class="badge info">🚚 ${c.toReceive} svoz k převzetí</span>` : ''}
          ${!c.todo && !c.sentAufs && !c.unshipped && !c.issue ? `<span class="badge ok"><span class="dot"></span>Vše vyřízeno</span>` : ''}
        </div>
      </a>
      <a class="app-card" href="#/emaily">
        <div class="row"><div class="app-icon">✉️</div><span class="num grow" style="text-align:right">02</span></div>
        <h3>EmailJoi</h3>
        <p>Často posílané e-maily — adresa, předmět a text připravené ke zkopírování.</p>
        <div class="badge-row"><span class="badge">${plural(S.emails.length, 'šablona', 'šablony', 'šablon')}</span>${S.emails.some(e => e.pinned) ? `<span class="badge info">★ ${S.emails.filter(e => e.pinned).length} připnuté</span>` : ''}</div>
      </a>
      <a class="app-card" href="#/sklad">
        <div class="row"><div class="app-icon">🏬</div><span class="num grow" style="text-align:right">03</span></div>
        <h3>StockJoi</h3>
        <p>Sklad: stav zboží ve více skladech, naskladnění, vyskladnění a přesuny.</p>
        <div class="badge-row">${(() => { const sc = stockCounts(); return `<span class="badge">${plural(sc.items, 'položka', 'položky', 'položek')} · ${plural(activeWhs().length, 'sklad', 'sklady', 'skladů')}</span>${sc.low ? `<span class="badge bad"><span class="dot"></span>${sc.low} pod minimem</span>` : ''}`; })()}</div>
      </a>
      <a class="app-card" href="#/dochazka">
        <div class="row"><div class="app-icon">🕘</div><span class="num grow" style="text-align:right">04</span></div>
        <h3>DocházkoBot</h3>
        <p>Docházka zaměstnanců → podklady pro účetní v Excelu. Čte PDF z docházky, pomáhá SmartJoiAI.</p>
        <div class="badge-row">${(() => { const m = ui.attMonth || prevMonth(); const act = S.att.employees.filter(e => e.active); const done = act.filter(e => attRec(e.id, m)?.status === 'done').length, up = act.filter(e => attRec(e.id, m)?.entries.length).length;
          return `<span class="badge">${esc(monthLabel(m))}: ${up}/${act.length} nahráno</span>${done ? `<span class="badge ok">${done} hotovo</span>` : ''}`; })()}</div>
      </a>
      <a class="app-card" href="#/stockupdate">
        <div class="row"><div class="app-icon">🔄</div><span class="num grow" style="text-align:right">05</span></div>
        <h3>StockUpdate 1.0</h3>
        <p>Každé pondělí: sklad Gunrebenu z PDF → import skladu do Shoptetu (s rezervou). WPC prkna a vinyl, s historií po týdnech.</p>
        <div class="badge-row">${(() => { const w = mondayOf(); return `<span class="badge">${weekLabel(w)}</span>` + suCfgs().map(c => { const r = suRun(c.id, w); return `<span class="badge ${r ? (r.imported_at ? 'ok' : 'warn') : ''}">${esc(c.label)}: ${r ? (r.imported_at ? '✓ v Shoptetu' : 'připraveno') : 'čeká'}</span>`; }).join(''); })()}</div>
      </a>
      <a class="app-card" href="#/kalendar">
        <div class="row"><div class="app-icon">📅</div><span class="num grow" style="text-align:right">SmartJoi</span></div>
        <h3>Kalendář</h3>
        <p>${next.length ? next.map(e => `<b>${esc(fmtDay(e.starts_on))}</b> · ${esc(e.title)}`).join('<br>') : 'Společný kalendář všech aplikací — propojený s Google Kalendářem.'}</p>
        <div class="badge-row"><span class="badge">${plural(S.events.filter(e => e.starts_on >= todayIso()).length, 'nadcházející událost', 'nadcházející události', 'nadcházejících událostí')}</span></div>
      </a>
      <div class="app-card soon">
        <div class="row"><div class="app-icon">＋</div></div>
        <h3>Další aplikace</h3>
        <p>Místo pro další nástroj — reporty, reklamace…</p>
      </div>
    </div>
    <div class="footer">SmartJoi · Jointshon | FJ</div>`;
}

// ---------- KALENDÁŘ (společný pro celý SmartJoi) ----------
const icsUrl = () => `${SUPABASE_URL}/functions/v1/calendar-ics?token=${S.settings.calendarToken}`;
function gcalLink({ title, date, details = '' }) {
  const d1 = date.replaceAll('-', ''), x = new Date(date + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1);
  const d2 = x.toISOString().slice(0, 10).replaceAll('-', '');
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&dates=' + d1 + '/' + d2 + '&details=' + encodeURIComponent(details);
}
// API pro všechny aplikace SmartJoi: zapsat / smazat událost ve společném kalendáři
export const SJCalendar = {
  async upsert({ app, ref, title, date, details = '', url = '' }) {
    if (!date) return this.remove(ref);
    ok(await sb.from('calendar_events').upsert({ app, ref, title, starts_on: date, details, url, updated_at: new Date().toISOString() }, { onConflict: 'ref' }));
  },
  async remove(ref) { ok(await sb.from('calendar_events').delete().eq('ref', ref)); },
};
function renderCalendar() {
  const up = S.events.filter(e => e.starts_on >= todayIso());
  const past = S.events.filter(e => e.starts_on < todayIso()).reverse();
  const APPN = { objednavky: '📦 OrderJoi' };
  const row = e => `<tr><td style="white-space:nowrap"><b>${esc(fmtDay(e.starts_on))}</b></td><td>${esc(e.title)}<div class="sub">${esc(APPN[e.app] || e.app)}</div></td>
    <td style="text-align:right"><a class="btn sm" target="_blank" rel="noopener" href="${esc(gcalLink({ title: e.title, date: e.starts_on, details: e.details }))}">＋ Google</a></td></tr>`;
  $('#view').innerHTML = `
    <div class="page-head"><div><div class="eyebrow">SmartJoi</div><h1>Kalendář</h1></div></div>
    <div class="card stack">
      <div><h2>Propojení s Google Kalendářem</h2><div class="sub">Jednou přidáš kalendář „SmartJoi“ do Google Kalendáře a všechny termíny ze všech aplikací SmartJoi (svozy i další, co přibudou) se tam budou zobrazovat samy.</div></div>
      <ol class="small" style="margin:0;padding-left:18px;line-height:1.8">
        <li>Zkopíruj odkaz níže.</li>
        <li>Otevři Google Kalendář → vlevo <b>Další kalendáře ＋</b> → <b>Z adresy URL</b> (nebo tlačítko níže).</li>
        <li>Vlož odkaz a klikni na <b>Přidat kalendář</b>.</li>
      </ol>
      <div class="copy-box"><input type="text" readonly id="ics-url" value="${esc(icsUrl())}"><button class="btn sm" id="copy-ics">Kopírovat</button></div>
      <div class="row"><a class="btn primary" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl">Otevřít Google Kalendář</a>
        <button class="btn ghost sm" id="rotate-ics" title="Starý odkaz přestane fungovat">Vygenerovat nový odkaz</button></div>
      <div class="small muted">Google si odebírané kalendáře obnovuje sám, obvykle během několika hodin. Když potřebuješ termín hned, použij u události tlačítko „＋ Google“. Odkaz je tajný — nesdílej ho.</div>
    </div>
    <div class="card"><div class="card-head"><h2 style="margin:0">Nadcházející</h2></div>
      ${up.length ? `<div class="table-wrap"><table><tbody>${up.map(row).join('')}</tbody></table></div>` : '<div class="empty">Žádné nadcházející události.</div>'}
    </div>
    ${past.length ? `<div class="card"><div class="card-head"><h3 style="margin:0">Proběhlé (30 dní)</h3></div><div class="table-wrap"><table><tbody>${past.map(row).join('')}</tbody></table></div></div>` : ''}`;
  $('#copy-ics').onclick = () => copyText(icsUrl());
  $('#rotate-ics').onclick = async () => {
    if (!confirm('Vygenerovat nový odkaz? Ten starý v Google Kalendáři přestane fungovat a budeš ho tam muset přidat znovu.')) return;
    const tok = [...crypto.getRandomValues(new Uint8Array(18))].map(b => b.toString(16).padStart(2, '0')).join('');
    await act(async () => ok(await sb.from('settings').update({ calendar_token: tok }).eq('id', 1)), 'Nový odkaz vytvořen ✓');
  };
}

// ---------- APLIKACE 04: DOCHÁZKOBOT ----------
const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
let _pdfjs = null;
async function pdfLib() { if (!_pdfjs) { _pdfjs = await import(PDFJS_URL); _pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } return _pdfjs; }
// text z PDF — kousky na stejném řádku se spojí bez mezer, pokud na sebe navazují (jinak by „Oběd“ bylo „Ob ě d“)
async function pdfToText(buf) {
  const lib = await pdfLib();
  const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise; let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent(); let prev = null;
    for (const it of c.items) {
      const x = it.transform[4], y = it.transform[5];
      if (prev) { const same = Math.abs(y - prev.y) < 2; out += !same ? '\n' : x - prev.xe > 1.5 ? ' ' : ''; }
      out += it.str; prev = { y, xe: x + it.width }; if (it.hasEOL) { out += '\n'; prev = null; }
    }
    out += '\n';
  }
  return out;
}
// ---------- APLIKACE 05: STOCKUPDATE ----------
// Po týdnech (každé pondělí): PDF se skladem dodavatele + CSV export ze Shoptetu → CSV pro import skladu do Shoptetu.
// Každý týden a seznam (WPC, vinyl) = jeden záznam v su_runs (uložené vstupy → výsledek jde kdykoli znovu spočítat a stáhnout).
const su = { pending: {}, open: {}, showAll: {} };
const suNum = v => v == null ? '' : Number(v).toLocaleString('cs-CZ', { maximumFractionDigits: 3 });
const locIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mondayOf = iso => { const d = iso ? new Date(iso + 'T12:00:00') : new Date(); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return locIso(d); };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return locIso(d); };
const isoWeekNo = iso => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7); const y = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - y) / 864e5 - 3 + (y.getDay() + 6) % 7) / 7); };
const czD = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d}.${m}.${y}`; };
const weekLabel = w => `Týden ${isoWeekNo(w)}`;
const weekRange = w => { const e = addDays(w, 6); return `${czD(w).replace(/\.\d{4}$/, '.')}–${czD(e)}`; };
const suCfgs = () => [...S.su].sort((a, b) => (a.id === 'gunreben-wpc' ? -1 : b.id === 'gunreben-wpc' ? 1 : a.id.localeCompare(b.id)));
const suCfgById = id => S.su.find(c => c.id === id);
const suRun = (cfg, week) => S.suRuns.find(r => r.cfg_id === cfg && r.week === week);
const suPrevRun = (cfg, week) => S.suRuns.filter(r => r.cfg_id === cfg && r.week < week).sort((a, b) => b.week.localeCompare(a.week))[0];

async function pdfItems(buf) {
  const lib = await pdfLib(); const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise; const pages = [];
  for (let i = 1; i <= doc.numPages; i++) { const c = await (await doc.getPage(i)).getTextContent(); pages.push(c.items.filter(it => it.str.trim()).map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width }))); }
  return pages;
}
// výpočet z uložených vstupů běhu
const _suCache = new Map();
function suCompute(run) {
  const key = run.id + '|' + run.updated_at;
  if (_suCache.has(key)) return _suCache.get(key);
  const rows = SU.buildUpdate({ rows: run.items }, run.supplier, { reserve: Number(run.reserve), stockCol: run.stock_col, mappings: run.mappings || {} });
  const res = { rows, col: run.stock_col }; _suCache.set(key, res); return res;
}
function suSummary(rows, prevRows) {
  const okR = rows.filter(r => r.status === 'ok'), prev = new Map((prevRows || []).filter(r => r.status === 'ok').map(r => [r.code, r.next]));
  let up = 0, down = 0, same = 0;
  for (const r of okR) { if (!prev.has(r.code)) continue; const d = r.next - prev.get(r.code); if (Math.abs(d) < 1e-9) same++; else if (d > 0) up++; else down++; }
  return { ok: okR.length, bad: rows.length - okR.length, warn: rows.filter(r => r.warn).length, total: okR.reduce((t, r) => t + r.next, 0), up, down, same, hasPrev: prev.size > 0 };
}

async function suLoadFiles(cfgId, week, files) {
  const p = (su.pending[cfgId + week] ||= {});
  for (const f of files) {
    try {
      if (/\.pdf$/i.test(f.name)) {
        const sup = SU.parseSupplierStock(await pdfItems(await f.arrayBuffer()));
        if (!Object.keys(sup.stock).length) throw new Error('V PDF jsem nenašel žádné kódy artiklů se skladem');
        p.pdf = { name: f.name, ...sup };
      } else if (/\.csv$/i.test(f.name)) {
        const buf = await f.arrayBuffer(); let text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('�')) text = new TextDecoder('windows-1250').decode(buf);
        const csv = SU.parseCsv(text);
        if (!csv.head.includes('code')) throw new Error('V CSV chybí sloupec „code“ — je to export produktů ze Shoptetu?');
        p.csv = { name: f.name, ...csv };
      } else toast('Nahraj PDF od dodavatele nebo CSV ze Shoptetu');
    } catch (e) { toast('Chyba: ' + e.message); console.error(e); }
  }
  if (p.pdf && p.csv) return suSaveRun(cfgId, week, p);
  render();
}
async function suSaveRun(cfgId, week, p) {
  const c = suCfgById(cfgId);
  const col = p.csv.head.includes(c.stock_col) ? c.stock_col : p.csv.head.find(h => h.startsWith('stock:')) || c.stock_col;
  // uložit jen to, co výpočet potřebuje (malé)
  const items = p.csv.rows.map(r => { const len = SU.variantLength(r); return { code: r.code, pairCode: r.pairCode || '', name: r.name, partNumber: r.partNumber || '', 'variant:Délka': len ? len + ' m' : '', [col]: r[col] ?? '' }; });
  const supplier = { stock: p.pdf.stock, info: p.pdf.info || {}, updated: p.pdf.updated, format: p.pdf.format };
  const row = { cfg_id: cfgId, week, pdf_name: p.pdf.name, csv_name: p.csv.name, reserve: c.reserve, stock_col: col, mappings: c.mappings || {}, supplier, items, imported_at: null, updated_at: new Date().toISOString() };
  const rows = SU.buildUpdate({ rows: items }, supplier, { reserve: c.reserve, stockCol: col, mappings: row.mappings });
  const prev = suPrevRun(cfgId, week);
  row.summary = { ...suSummary(rows, prev ? suCompute(prev).rows : null), pdfUpdated: p.pdf.updated || null };
  delete su.pending[cfgId + week];
  su.open[cfgId + week] = false;
  await act(async () => {
    ok(await sb.from('su_runs').upsert(row, { onConflict: 'cfg_id,week' }));
    // připomínka na další pondělí ve společném kalendáři (jde i do Google Kalendáře)
    try { await SJCalendar.upsert({ app: 'stockupdate', ref: 'stockupdate:next', title: 'StockUpdate – aktualizovat sklad Gunreben (WPC + vinyl)', date: addDays(mondayOf(), 7), details: 'Nahrát stock listy od Gunrebenu a CSV ze Shoptetu, stáhnout CSV a naimportovat do Shoptetu.', url: location.origin + location.pathname + '#/stockupdate' }); } catch (e) { console.warn(e); }
  }, 'Uloženo ✓');
}
function suDownload(run) {
  const { rows, col } = suCompute(run);
  const blob = new Blob([SU.exportRows(rows, col)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `stockupdate-${run.cfg_id}-${run.week}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function suWeekBadge(run) {
  if (!run) return '<span class="badge">nenahráno</span>';
  return run.imported_at ? `<span class="badge ok"><span class="dot"></span>v Shoptetu ${esc(czD(locIso(new Date(run.imported_at))))}</span>` : '<span class="badge warn"><span class="dot"></span>připraveno, nenaimportováno</span>';
}
function renderSuApp(weekArg) {
  const thisWeek = mondayOf(), week = weekArg && /^\d{4}-\d{2}-\d{2}$/.test(weekArg) ? mondayOf(weekArg) : thisWeek;
  const cfgs = suCfgs();
  let h = `
    <div class="page-head"><div><div class="eyebrow">Aplikace 05 · každé pondělí</div><h1>StockUpdate 1.0</h1><div class="sub">Sklad Gunrebenu z PDF → import skladu do Shoptetu s rezervou</div></div></div>
    <div class="card su-week">
      <div class="card-head" style="margin-bottom:6px">
        <div class="row" style="gap:8px;align-items:center"><button class="icon-btn" data-suwk="${addDays(week, -7)}" title="Předchozí týden">‹</button>
          <div><h2 style="margin:0">${weekLabel(week)}${week === thisWeek ? ' <span class="badge info">tento týden</span>' : ''}</h2><div class="sub">${weekRange(week)}</div></div>
          <button class="icon-btn" data-suwk="${addDays(week, 7)}" title="Další týden" ${week >= thisWeek ? 'disabled' : ''}>›</button></div>
        ${week !== thisWeek ? `<button class="btn sm ghost" data-suwk="${thisWeek}">Tento týden</button>` : ''}
      </div>
      ${cfgs.map(c => suListBlock(c, week)).join('')}
    </div>`;
  // historie
  const weeks = [...new Set(S.suRuns.map(r => r.week))].sort().reverse();
  h += `<div class="card"><h2>Historie</h2>${weeks.length ? `<div class="table-wrap"><table class="su-hist"><thead><tr><th>Týden</th>${cfgs.map(c => `<th>${esc(c.label)}</th>`).join('')}<th></th></tr></thead><tbody>
    ${weeks.map(w => `<tr data-suwk="${w}" class="${w === week ? 'on' : ''}"><td><b>${weekLabel(w)}</b><div class="muted small">${weekRange(w)}</div></td>
      ${cfgs.map(c => { const r = suRun(c.id, w); return `<td>${suWeekBadge(r)}${r ? `<div class="muted small">${plural(r.summary?.ok || 0, 'varianta', 'varianty', 'variant')}${r.summary?.hasPrev ? ` · ▲${r.summary.up} ▼${r.summary.down}` : ''}</div>` : ''}</td>`; }).join('')}
      <td class="r"><span class="muted">›</span></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="small muted">Zatím žádný týden. Po nahrání PDF a CSV se týden uloží sem.</div>'}</div>
    <div class="small muted" style="margin:-4px 2px 14px">Nastavení: rezerva a sklad v Shoptetu se mění u každého seznamu v ⚙. Připomínka na další pondělí se sama zapíše do kalendáře SmartJoi.</div>`;
  $('#view').innerHTML = h; suBind(week);
}
function suListBlock(c, week) {
  const run = suRun(c.id, week), key = c.id + week, p = su.pending[key] || {};
  const head = `<div class="su-list-head"><div><h3 style="margin:0">${esc(c.supplier)} · ${esc(c.label)}</h3><div class="muted small">rezerva ${+c.reserve} % · ${esc(c.stock_col.replace('stock:', ''))}</div></div>
    <div class="row" style="gap:6px;align-items:center">${suWeekBadge(run)}<button class="icon-btn" data-suset="${esc(c.id)}" title="Nastavení">⚙</button></div></div>`;
  const uploader = (again) => `<div class="su-up">
      <label class="su-file ${p.pdf ? 'done' : ''}" data-sudrop="${esc(c.id)}"><input type="file" accept=".pdf,.csv" multiple hidden>${p.pdf ? '✓ ' + esc(p.pdf.name) : '1 · PDF od dodavatele'}</label>
      <label class="su-file ${p.csv ? 'done' : ''}" data-sudrop="${esc(c.id)}"><input type="file" accept=".pdf,.csv" multiple hidden>${p.csv ? '✓ ' + esc(p.csv.name) : '2 · CSV export ze Shoptetu'}</label>
      ${again ? `<button class="btn sm ghost" data-sucancel="${esc(key)}">Zrušit</button>` : ''}</div>
      <div class="muted small" style="margin-top:6px">Přetáhni sem oba soubory (nebo klikni). Po nahrání obou se týden uloží sám.${again ? ' Nahráním se přepíše uložený výsledek tohoto týdne.' : ''}</div>`;
  if (!run || su.pending[key]?.again) return `<div class="su-list">${head}${uploader(!!run)}</div>`;
  const { rows } = suCompute(run), s = run.summary || {};
  const prev = suPrevRun(c.id, week), prevMap = new Map(prev ? suCompute(prev).rows.filter(r => r.status === 'ok').map(r => [r.code, r.next]) : []);
  const unit = run.supplier?.format === 'list' ? 'm²' : 'ks';
  const issues = rows.filter(r => r.status !== 'ok' || r.warn || r.mapped === 'ručně'), nIssues = new Set(issues.map(r => r.group)).size;
  const open = su.open[key];
  return `<div class="su-list">${head}
    <div class="su-sum">
      <div><b>${s.ok ?? 0}</b><span>variant do importu</span></div>
      <div><b>${suNum(Math.round(s.total || 0))}</b><span>${unit} po rezervě</span></div>
      <div>${s.hasPrev ? `<b><span style="color:var(--ok)">▲${s.up}</span> <span style="color:var(--bad)">▼${s.down}</span> <span class="muted">=${s.same}</span></b><span>proti minulému týdnu</span>` : `<b class="muted">—</b><span>první týden</span>`}</div>
      <div><b style="${s.bad ? 'color:var(--bad)' : nIssues ? 'color:var(--warn)' : ''}">${s.bad ? s.bad : nIssues ? '⚠ ' + nIssues : '✓'}</b><span>${s.bad ? 'variant bez párování' : nIssues ? plural(nIssues, 'produkt ke kontrole', 'produkty ke kontrole', 'produktů ke kontrole').replace(/^\d+ /, '') : 'vše spárováno'}</span></div>
    </div>
    <div class="muted small">PDF: ${esc(run.pdf_name)}${s.pdfUpdated ? ` (stav ${esc(s.pdfUpdated)})` : ''} · CSV: ${esc(run.csv_name)} · uloženo ${esc(fmtDate(run.updated_at))}</div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn primary sm" data-sudl="${run.id}">⬇ CSV pro Shoptet</button>
      ${run.imported_at ? `<button class="btn sm ghost" data-suimp="${run.id}" data-v="0">Zrušit „naimportováno“</button>` : `<button class="btn sm" data-suimp="${run.id}" data-v="1">✓ Naimportováno do Shoptetu</button>`}
      <button class="btn sm ghost" data-suopen="${esc(key)}">${open ? 'Skrýt detail ▴' : 'Detail ▾'}</button>
      <button class="btn sm ghost" data-suagain="${esc(key)}">↻ Nahrát znovu</button>
    </div>
    ${open ? suDetail(c, run, rows, prevMap, issues, unit, key) : ''}
  </div>`;
}
function suDetail(c, run, rows, prevMap, issues, unit, key) {
  const sup = run.supplier || {}, codes = Object.keys(sup.stock || {}).sort();
  const sample = code => { const inf = sup.info?.[code]; if (inf) return `${inf.desc.split('|')[0].trim()} · ${suNum(inf.packs)} bal.`; return Object.entries(sup.stock[code] || {}).map(([l, q]) => `${l.replace('.', ',')}: ${q}`).join(' · '); };
  const delta = r => { if (r.status !== 'ok' || !prevMap.has(r.code)) return ''; const d = Math.round((r.next - prevMap.get(r.code)) * 1000) / 1000; return d ? `<span class="su-d ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${suNum(d)}</span>` : ''; };
  // problémy / ruční přiřazení
  const groups = [...new Map(issues.map(r => [r.group, r])).values()];
  let h = groups.length ? `<div class="su-issues"><b>Ke kontrole</b>
    ${groups.map(g => `<div class="su-issue"><div class="grow"><b>${esc(g.name)}</b> <span class="muted small">${esc(g.code)}</span>
        ${g.warn ? `<div class="small" style="color:var(--warn)">⚠ ${esc(g.warn)} → použit ${esc(g.supplierCode)} podle názvu</div>` : g.status === 'nomap' ? '<div class="small" style="color:var(--bad)">chybí kód dodavatele (partNumber)</div>' : g.status === 'nocode' ? `<div class="small" style="color:var(--bad)">kód ${esc(g.supplierCode)} v listině není</div>` : g.mapped === 'ručně' ? '<div class="small muted">přiřazeno ručně</div>' : ''}</div>
      <select data-sumap="${esc(g.group)}" data-run="${run.id}"><option value="">${g.supplierCode && g.mapped !== 'ručně' ? `automaticky: ${esc(g.supplierCode)}` : '— vyber artikl —'}</option>${codes.map(k => `<option value="${k}" ${run.mappings?.[g.group] === k ? 'selected' : ''}>${k} · ${esc(sample(k))}</option>`).join('')}</select></div>`).join('')}
    <div class="muted small">Trvalé řešení: opravit partNumber v Shoptetu.</div></div>` : '';
  // kompaktní přehled: produkt = 1 řádek (u prken délky vedle sebe), u vinylu rozdělené podle tloušťky
  const byGroup = new Map(); for (const r of rows) { if (!byGroup.has(r.group)) byGroup.set(r.group, []); byGroup.get(r.group).push(r); }
  const lengths = [...new Set(rows.map(r => r.length).filter(Boolean))].sort();
  const sectionOf = name => { const m = /(\d+[.,]\d+)\s*mm/i.exec(name || ''); const t = /lepen/i.test(name) ? 'lepený' : /click/i.test(name) ? 'click' : ''; return m ? `${t} ${m[1]} mm`.trim() : ''; };
  const sections = new Map(); for (const [g, rs] of byGroup) { const sct = sectionOf(rs[0].name); if (!sections.has(sct)) sections.set(sct, []); sections.get(sct).push(rs); }
  const all = su.showAll[key];
  const changedOnly = rs => all || rs.some(r => r.status !== 'ok' || r.warn || !prevMap.has(r.code) || Math.abs(r.next - prevMap.get(r.code)) > 1e-9);
  for (const [sct, list] of sections) {
    const shown = list.filter(changedOnly);
    h += `<div class="su-sect">${sct ? `<div class="su-sect-h">${esc(sct)} <span class="muted small">${plural(list.length, 'produkt', 'produkty', 'produktů')}</span></div>` : ''}
      <div class="table-wrap"><table class="su-c"><thead><tr><th>Produkt</th>${lengths.length ? lengths.map(l => `<th class="r">${l.replace('.', ',').replace(/0$/, '')} m</th>`).join('') : `<th class="r">U dodavatele</th><th class="r">Do Shoptetu (${unit})</th>`}</tr></thead><tbody>
      ${shown.map(rs => { const f = rs[0];
        const nm = `<td><b>${esc(f.name)}</b><div class="muted small">${esc(lengths.length ? (f.pairCode ? f.code.replace(/-[^-]+$/, '') : f.code) : f.code)} · ${esc(f.supplierCode || '—')}</div></td>`;
        if (lengths.length) return `<tr>${nm}${lengths.map(l => { const r = rs.find(x => x.length === l); return `<td class="r">${!r ? '' : r.status !== 'ok' ? '<span class="badge bad">?</span>' : `<b>${suNum(r.next)}</b>${delta(r)}<div class="muted small">z ${suNum(r.supplierQty)}</div>`}</td>`; }).join('')}</tr>`;
        return `<tr>${nm}<td class="r">${f.status === 'ok' ? `${suNum(f.supplierQty)}<div class="muted small">${suNum(f.supplierPacks)} bal.</div>` : ''}</td><td class="r">${f.status === 'ok' ? `<b>${suNum(f.next)}</b>${delta(f)}` : '<span class="badge bad">?</span>'}</td></tr>`; }).join('') || `<tr><td colspan="9" class="muted small">Beze změny proti minulému týdnu.</td></tr>`}
      </tbody></table></div></div>`;
  }
  const hidden = [...byGroup.values()].filter(rs => !changedOnly(rs)).length;
  h += `<div class="row" style="gap:8px;margin-top:6px">${hidden || all ? `<button class="btn sm ghost" data-suall="${esc(key)}">${all ? 'Jen změny' : `Zobrazit i beze změny (${hidden})`}</button>` : ''}<span class="muted small">Čísla = do Shoptetu (po rezervě ${+run.reserve} %), „z“ = sklad u dodavatele, barevně změna proti minulému týdnu.</span></div>`;
  return `<div class="su-detail">${h}</div>`;
}
function suSettings(cfgId) {
  const c = suCfgById(cfgId); const run = S.suRuns.find(r => r.cfg_id === cfgId);
  const cols = [...new Set([c.stock_col, 'stock:Extérní sklad', ...(run?.items?.[0] ? Object.keys(run.items[0]).filter(k => k.startsWith('stock:')) : [])])];
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:460px">
    <div class="modal-head"><h2>${esc(c.supplier)} · ${esc(c.label)}</h2><button class="icon-btn" data-close>✕</button></div>
    <label class="field"><span>Rezerva</span><select id="sus-res">${[0, 10, 20, 25, 30, 40, 50].map(v => `<option value="${v}" ${+c.reserve === v ? 'selected' : ''}>${v} %</option>`).join('')}</select></label>
    <label class="field" style="margin-top:10px"><span>Sklad v Shoptetu (sloupec v CSV)</span><input id="sus-col" value="${esc(c.stock_col)}" list="sus-cols"><datalist id="sus-cols">${cols.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
    <div class="small muted" style="margin-top:8px">Platí pro další nahrání. Uložené týdny zůstávají, jak byly.</div>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="sus-save">Uložit</button></div>
  </div></div>`;
  document.querySelectorAll('#modal-root [data-close]').forEach(b => b.onclick = () => { $('#modal-root').innerHTML = ''; });
  $('#sus-save').onclick = () => { const reserve = Number($('#sus-res').value), stock_col = $('#sus-col').value.trim() || c.stock_col; $('#modal-root').innerHTML = ''; act(async () => ok(await sb.from('su_config').update({ reserve, stock_col, updated_at: new Date().toISOString() }).eq('id', cfgId)), 'Uloženo ✓'); };
}
function suBind(week) {
  document.querySelectorAll('[data-suwk]').forEach(b => b.onclick = () => { location.hash = '#/stockupdate/w/' + b.dataset.suwk; });
  document.querySelectorAll('[data-sudrop]').forEach(d => {
    const id = d.dataset.sudrop, inp = d.querySelector('input');
    d.ondragover = e => { e.preventDefault(); d.classList.add('over'); };
    d.ondragleave = () => d.classList.remove('over');
    d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); if (e.dataTransfer.files.length) suLoadFiles(id, week, [...e.dataTransfer.files]); };
    inp.onchange = () => { if (inp.files.length) suLoadFiles(id, week, [...inp.files]); };
  });
  document.querySelectorAll('[data-sudl]').forEach(b => b.onclick = () => suDownload(S.suRuns.find(r => r.id === b.dataset.sudl)));
  document.querySelectorAll('[data-suimp]').forEach(b => b.onclick = () => act(async () => ok(await sb.from('su_runs').update({ imported_at: b.dataset.v === '1' ? new Date().toISOString() : null }).eq('id', b.dataset.suimp)), b.dataset.v === '1' ? 'Označeno ✓' : 'Zrušeno'));
  document.querySelectorAll('[data-suopen]').forEach(b => b.onclick = () => { su.open[b.dataset.suopen] = !su.open[b.dataset.suopen]; render(); });
  document.querySelectorAll('[data-suall]').forEach(b => b.onclick = () => { su.showAll[b.dataset.suall] = !su.showAll[b.dataset.suall]; render(); });
  document.querySelectorAll('[data-suagain]').forEach(b => b.onclick = () => { su.pending[b.dataset.suagain] = { again: true }; render(); });
  document.querySelectorAll('[data-sucancel]').forEach(b => b.onclick = () => { delete su.pending[b.dataset.sucancel]; render(); });
  document.querySelectorAll('[data-suset]').forEach(b => b.onclick = () => suSettings(b.dataset.suset));
  // ruční přiřazení: uloží se do běhu (přepočet) i do nastavení seznamu (pro příště)
  document.querySelectorAll('[data-sumap]').forEach(sel => sel.onchange = () => {
    const run = S.suRuns.find(r => r.id === sel.dataset.run), c = suCfgById(run.cfg_id);
    const upd = m => { const x = { ...(m || {}) }; if (sel.value) x[sel.dataset.sumap] = sel.value; else delete x[sel.dataset.sumap]; return x; };
    const mappings = upd(run.mappings), cm = upd(c.mappings);
    const rows = SU.buildUpdate({ rows: run.items }, run.supplier, { reserve: Number(run.reserve), stockCol: run.stock_col, mappings });
    const prev = suPrevRun(run.cfg_id, run.week);
    const summary = { ...suSummary(rows, prev ? suCompute(prev).rows : null), pdfUpdated: run.summary?.pdfUpdated || null };
    act(async () => { ok(await sb.from('su_runs').update({ mappings, summary, updated_at: new Date().toISOString() }).eq('id', run.id)); ok(await sb.from('su_config').update({ mappings: cm }).eq('id', c.id)); }, 'Uloženo ✓');
  });
}
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const monthLabel = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' }); };
const attEmp = id => S.att.employees.find(e => e.id === id);
const attRec = (empId, month) => S.att.months.find(r => r.employeeId === empId && r.month === month);
// zaměstnanec s automatickou docházkou (např. 1 h denně): bez nahraného záznamu se měsíc vyplní sám
const AUTO_SRC = { id: 'auto', kind: 'auto', name: 'automaticky', at: null };
const attEntries = (emp, month) => { const r = attRec(emp.id, month); return r?.entries?.length ? r.entries : DC.hasAuto(emp) ? DC.autoEntries(month, emp, S.att.holidays) : []; };
const attComp = (emp, month) => { const r = attRec(emp.id, month), list = attEntries(emp, month); return list.length ? DC.computeMonth(month, list, emp, { shiftDays: r?.shiftDays, holidays: S.att.holidays }) : null; };
const hasAlt = e => !!(e.alt_shift_start && e.alt_shift_end);
const shiftText = e => `směna ${e.shift_start}–${e.shift_end}${hasAlt(e) ? ` (střídá s ${e.alt_shift_start}–${e.alt_shift_end})` : ''}`;
const hh = m => DC.hours(m || 0).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fileSafe = t => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\-]+/g, '_');
const firstName = n => String(n).split(' ')[0];
const nameKey = n => fold(n).split(/\s+/).filter(Boolean).sort().join(' ');

// státní svátky: načtou se z internetu (přes SmartJoiAI funkci, zdroj date.nager.at) a uloží do databáze
const holTried = {};
async function ensureHolidays(year) {
  if (holTried[year] || S.att.holidays.some(h => h.date.startsWith(year + '-'))) return;
  holTried[year] = true;
  try { const j = await callAssistant({ task: 'holidays', year }); if (j.holidays?.length) { S.att.holidays.push(...j.holidays); render(); } }
  catch (e) { console.warn('svátky', e); }
}
function renderAttApp(empId) {
  ui.attMonth ||= prevMonth();
  ensureHolidays(Number(ui.attMonth.slice(0, 4)));
  const month = ui.attMonth, emps = S.att.employees.filter(e => e.active);
  const emp = empId ? attEmp(empId) : null;
  const statusDot = e => { const r = attRec(e.id, month); return !r || !r.entries.length ? (DC.hasAuto(e) ? ' <span class="att-dot" title="Automaticky">⚡</span>' : '') : r.status === 'done' ? ' <span class="att-dot done" title="Hotovo">✓</span>' : ' <span class="att-dot" title="Nahráno">•</span>'; };
  let h = `
    <div class="page-head">
      <div><div class="eyebrow">Aplikace 04 · Docházka a podklady pro účetní</div><h1>DocházkoBot</h1></div>
      <div class="row">${(() => { const y = ui.attMonth.slice(0, 4), own = S.att.holidays.filter(h => h.date.startsWith(ui.attMonth)); const ok2 = S.att.holidays.some(h => h.date.startsWith(y + '-'));
          const list = ok2 ? own : Object.entries(DC.czHolidays(+y)).filter(([d]) => d.startsWith(ui.attMonth)).map(([date, name]) => ({ date, name }));
          return `<span class="small ${ok2 ? 'muted' : ''}" title="${ok2 ? 'Státní svátky načtené z internetu (date.nager.at)' : 'Svátky se nepodařilo načíst z internetu – použit výpočet'}">${ok2 ? '' : '⚠ '}Svátky: ${list.length ? list.map(h => `${+h.date.slice(8)}.${+h.date.slice(5, 7)}.${h.date.slice(0, 4)}`).join(', ') : 'žádné'}</span>`; })()}
        <span class="att-month"><button class="btn sm ghost" data-amon="-1" title="Předchozí měsíc">‹</button><b>${esc(monthLabel(month))}</b><button class="btn sm ghost" data-amon="1" title="Další měsíc">›</button></span>
        <button class="btn" id="att-all" title="Jeden sešit, list pro každého zaměstnance">⬇ Excel – všichni</button></div>
    </div>
    <div class="tabs">
      <button class="tab ${!emp ? 'active' : ''}" data-atab="">Přehled</button>
      ${emps.map(e => `<button class="tab ${emp?.id === e.id ? 'active' : ''}" data-atab="${e.id}" title="${esc(e.name)}">${esc(firstName(e.name))}${statusDot(e)}</button>`).join('')}
    </div>`;
  h += emp ? attEmployeeView(emp, month) : attOverview(emps, month);
  $('#view').innerHTML = h;
  bindAtt(emp, month);
}
function attOverview(emps, month) {
  const rows = emps.map(e => { const r = attRec(e.id, month), c = attComp(e, month); return { e, r, c }; });
  const done = rows.filter(x => x.r?.status === 'done').length, loaded = rows.filter(x => x.c).length;
  return `
    <div class="stats">
      <div class="stat"><div class="v">${loaded}/${emps.length}</div><div class="l">nahraná docházka · ${esc(monthLabel(month))}</div></div>
      <div class="stat"><div class="v" style="${done === emps.length ? 'color:var(--ok)' : ''}">${done}/${emps.length}</div><div class="l">hotovo pro účetní</div></div>
      <div class="stat"><div class="v">${hh(rows.reduce((t, x) => t + (x.c?.sum.over || 0), 0))}</div><div class="l">přesčasy celkem (h)</div></div>
      <div class="stat"><div class="v">${hh(rows.reduce((t, x) => t + (x.c?.sum.vac || 0), 0))}</div><div class="l">dovolená celkem (h)</div></div>
    </div>
    <div class="card" style="padding:4px 0"><div class="table-wrap"><table class="att-over">
      <thead><tr><th style="width:28px"><input type="checkbox" id="asel-all" title="Vybrat všechny s docházkou" ${rows.filter(x => x.c).every(x => attSelected(month).has(x.e.id)) && rows.some(x => x.c) ? 'checked' : ''}></th><th>Zaměstnanec</th><th class="hide-m">Oddělení</th><th>Stav</th><th class="num">Odpracováno</th><th class="num">Přesčas</th><th class="num hide-m">Dovolená</th><th class="num hide-m">Nemoc</th><th class="num hide-m">Lékař</th><th class="num">Chybí</th></tr></thead>
      <tbody>${rows.map(({ e, r, c }) => `<tr data-aemp="${e.id}">
        <td class="asel"><input type="checkbox" data-asel="${e.id}" ${attSelected(month).has(e.id) ? 'checked' : ''} ${c ? '' : 'disabled'} title="Do e-mailu a Excelu pro účetní"></td><td><b>${esc(e.name)}</b></td><td class="hide-m small">${esc(e.department || '—')}</td>
        <td>${!c ? '<span class="badge">nenahráno</span>' : r?.status === 'done' ? '<span class="badge ok">hotovo</span>' : !r ? '<span class="badge info">⚡ automaticky</span>' : '<span class="badge info">rozpracováno</span>'}</td>
        ${c ? `<td class="num">${hh(c.sum.worked)}</td><td class="num">${hh(c.sum.over)}</td><td class="num hide-m">${hh(c.sum.vac)}</td><td class="num hide-m">${hh(c.sum.sick)}</td><td class="num hide-m">${hh(c.sum.doc)}</td><td class="num ${c.sum.missing ? 'neg' : ''}">${hh(c.sum.missing)}</td>` : '<td colspan="6" class="muted small">—</td>'}
      </tr>`).join('')}</tbody></table></div></div>
    ${(() => { const hid = S.att.employees.filter(e => !e.active); return hid.length ? `<div class="small muted" style="margin:-4px 2px 14px">Skrytí (zpracovávají se zvlášť): ${hid.map(e => `${esc(e.name)} <button class="btn sm ghost" data-ashow="${e.id}" style="padding:2px 8px">zobrazit</button>`).join(' · ')}</div>` : ''; })()}
    ${attEmailCard(month)}
    ${attMemoryCard()}`;
}
// ---- e-mail pro účetní (šablona v settings.att_email, vybraní zaměstnanci za měsíc) ----
const ATT_EMAIL_DEF = { to: '', cc: '', subject: 'Docházka – {mesic}', body: 'Dobrý den,\n\nv příloze posílám evidenci pracovní doby za {mesic}.\n\nDěkuji a přeji hezký den.\nS pozdravem\nFilip' };
const attEmailTpl = () => ({ ...ATT_EMAIL_DEF, ...(S.settings.attEmail || {}) });
ui.attSel ||= {};
function attSelected(month) {
  if (!ui.attSel[month]) ui.attSel[month] = new Set(S.att.employees.filter(e => e.active && attComp(e, month)).map(e => e.id));
  return ui.attSel[month];
}
function attEmailFill(t, month) {
  const sel = S.att.employees.filter(e => e.active && attSelected(month).has(e.id)).map(e => ({ e, c: attComp(e, month) })).filter(x => x.c);
  const vars = { mesic: monthLabel(month), zamestnanci: sel.map(x => x.e.name).join('\n'), pocet: String(sel.length), jmena: sel.map(x => x.e.name).join(', ') };
  const f = x => String(x || '').replace(/\{(mesic|zamestnanci|pocet|jmena)\}/g, (_, k) => vars[k]);
  return { to: f(t.to), cc: f(t.cc), subject: f(t.subject), body: f(t.body), count: sel.length, sel };
}
// přílohy: Excel pro každého zakliknutého zvlášť
async function attEmailFiles(month, sel) {
  const out = [];
  for (const { e, c } of sel) out.push({ name: fileSafe(`Evidence pracovni doby ${e.name} ${month}`) + '.xlsx', data: await workbookBuffer(wb => addAttendanceSheet(wb, c, e, e.name)) });
  return out;
}
// .eml = rozepsaný e-mail (X-Unsent) s přílohami — otevře se v poštovním programu
const b64u = t => b64(new TextEncoder().encode(t));
const wrap76 = s => s.replace(/.{76}/g, '$&\r\n');
const mimeWord = t => /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${b64u(t)}?=`;
function buildEml(x, files) {
  const B = 'sj_' + Math.random().toString(36).slice(2);
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const h = [x.to && `To: ${x.to}`, x.cc && `Cc: ${x.cc}`, `Subject: ${mimeWord(x.subject)}`, 'X-Unsent: 1', 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${B}"`].filter(Boolean);
  const parts = [`--${B}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64u(x.body.replace(/\r?\n/g, '\r\n')))}`,
    ...files.map(f => `--${B}\r\nContent-Type: ${XLSX}; name="${f.name}"\r\nContent-Disposition: attachment; filename="${f.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(f.data))}`)];
  return h.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') + `\r\n--${B}--\r\n`;
}
function attEmailCard(month) {
  const t = attEmailTpl(), x = attEmailFill(t, month);
  return `<div class="card" id="att-email">
    <div class="card-head"><div><h2>E-mail pro účetní</h2><div class="sub">Šablona se ukládá sama. V příloze bude Excel za každého zakliknutého. Proměnné: <code>{mesic}</code> <code>{jmena}</code> <code>{pocet}</code></div></div>
      <span class="badge ${x.count ? 'info' : ''}">${plural(x.count, 'zaměstnanec', 'zaměstnanci', 'zaměstnanců')} · ${esc(monthLabel(month))}</span></div>
    <div class="grid-2"><label class="field"><span>Komu</span><input type="text" data-aem="to" value="${esc(t.to)}" placeholder="ucetni@firma.cz"></label><label class="field"><span>Kopie</span><input type="text" data-aem="cc" value="${esc(t.cc)}" placeholder="volitelné"></label></div>
    <label class="field" style="margin-top:10px"><span>Předmět</span><input type="text" data-aem="subject" value="${esc(t.subject)}"></label>
    <label class="field" style="margin-top:10px"><span>Text</span><textarea data-aem="body" rows="11">${esc(t.body)}</textarea></label>
    <div class="small muted" style="margin:10px 0 4px">Náhled · přílohy: ${x.sel.map(s => `<span class="chip" style="padding:2px 8px;font-size:12px">📎 ${esc(fileSafe(`Evidence pracovni doby ${s.e.name} ${month}`))}.xlsx</span>`).join(' ') || '—'}</div>
    <div class="att-mail-prev"><div class="small"><b>Komu:</b> <span id="aem-to">${esc(x.to || '—')}${x.cc ? ` · Kopie: ${esc(x.cc)}` : ''}</span></div><div class="small"><b>Předmět:</b> <span id="aem-subj">${esc(x.subject)}</span></div><pre id="aem-body">${esc(x.body)}</pre></div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn primary" id="aem-open" ${x.count ? '' : 'disabled'}>✉ Otevřít v e-mailu (${plural(x.count, 'příloha', 'přílohy', 'příloh')})</button>
      ${navigator.canShare ? `<button class="btn" id="aem-share" ${x.count ? '' : 'disabled'} title="Sdílet přílohy do Mailu (Mac, iPhone)">Sdílet do Mailu</button>` : ''}
      <button class="btn ghost" id="aem-xlsx" ${x.count ? '' : 'disabled'}>⬇ Jen Excely</button>
      <button class="btn ghost sm" id="aem-reset" title="Vrátit výchozí text šablony">Výchozí šablona</button>
    </div>
    <div class="small muted" style="margin-top:6px">„Otevřít v e-mailu“ stáhne připravený e-mail (.eml) s přílohami — otevři ho a v Outlooku je rovnou k odeslání (v Apple Mailu: Zpráva → Poslat znovu). „Sdílet do Mailu“ vloží přílohy do nového e-mailu přímo.</div>
  </div>`;
}
function bindAttEmail(month) {
  if (!$('#att-email')) return;
  let tmr = null;
  const read = () => { const o = { ...attEmailTpl() }; document.querySelectorAll('[data-aem]').forEach(i => { o[i.dataset.aem] = i.value; }); return o; };
  const upd = () => { const x = attEmailFill(read(), month); $('#aem-to').textContent = (x.to || '—') + (x.cc ? ' · Kopie: ' + x.cc : ''); $('#aem-subj').textContent = x.subject; $('#aem-body').textContent = x.body; };
  const save = () => { const o = read(); S.settings.attEmail = o; sb.from('settings').update({ att_email: o }).eq('id', 1).then(({ error }) => error ? toast('Šablonu se nepodařilo uložit: ' + error.message) : null, () => toast('Šablonu se nepodařilo uložit')); };
  document.querySelectorAll('[data-aem]').forEach(i => { i.oninput = () => { upd(); clearTimeout(tmr); tmr = setTimeout(save, 600); }; i.onblur = () => { clearTimeout(tmr); save(); }; });
  $('#aem-open').onclick = async () => {
    const x = attEmailFill(read(), month); if (!x.to.trim()) toast('Doplň příjemce (Komu)');
    try {
      const eml = buildEml(x, await attEmailFiles(month, x.sel));
      const url = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' }));
      const a = document.createElement('a'); a.href = url; a.download = fileSafe(`Dochazka ${month}`) + '.eml'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('E-mail připraven — otevři stažený soubor');
    } catch (e) { toast('Chyba: ' + e.message); console.error(e); }
  };
  // sdílení musí proběhnout hned po kliknutí → přílohy se připraví dopředu
  const selKey = month + '|' + [...attSelected(month)].sort().join(',');
  if ($('#aem-share') && attEmailFill(read(), month).count && ui.attShare?.key !== selKey) { ui.attShare = { key: selKey, files: null }; attEmailFiles(month, attEmailFill(read(), month).sel).then(f => { if (ui.attShare?.key === selKey) ui.attShare.files = f; }, () => {}); }
  if ($('#aem-share')) $('#aem-share').onclick = async () => {
    const x = attEmailFill(read(), month);
    try {
      const ready = ui.attShare?.key === selKey && ui.attShare.files;
      if (!ready) return toast('Přílohy se ještě připravují — zkus to za vteřinu');
      const files = ready.map(f => new File([f.data], f.name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      if (!navigator.canShare({ files })) return toast('Tenhle prohlížeč neumí sdílet soubory — použij „Otevřít v e-mailu“');
      await navigator.share({ files, title: x.subject, text: x.body });
      if (x.to) copyText(x.to);
    } catch (e) { if (e.name !== 'AbortError') toast('Chyba: ' + e.message); }
  };
  $('#aem-reset').onclick = () => { if (!confirm('Vrátit předmět a text na výchozí? Příjemci zůstanou.')) return; const o = { ...read(), subject: ATT_EMAIL_DEF.subject, body: ATT_EMAIL_DEF.body }; S.settings.attEmail = o; sb.from('settings').update({ att_email: o }).eq('id', 1).then(() => {}, () => {}); render(); };
  $('#aem-xlsx').onclick = async () => { try { for (const f of await attEmailFiles(month, attEmailFill(read(), month).sel)) { const url = URL.createObjectURL(new Blob([f.data])); const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); await new Promise(r => setTimeout(r, 300)); } } catch (e) { toast('Chyba: ' + e.message); } };
}
function attMemoryCard() {
  const mem = S.att.memory;
  return `<div class="card">
    <div class="card-head"><div><h2>Co si SmartJoiAI pamatuje</h2><div class="sub">Pravidla pro výpočet a zpracování. Když SmartJoiAI v chatu něco opravíš nebo naučíš („pamatuj si, že…“), přibude to sem.</div></div>
      <button class="btn sm" id="mem-add">＋ Přidat pravidlo</button></div>
    ${mem.length ? `<div class="mem-list">${mem.map(m => `<div class="mem"><span class="badge">${esc(m.scope === 'global' ? 'obecné' : m.scope === 'dochazka' ? 'docházka' : attEmp(m.scope)?.name || m.scope)}</span><span class="grow">${esc(m.text)}</span><button class="icon-btn" data-memdel="${m.id}" title="Zapomenout">🗑</button></div>`).join('')}</div>` : '<div class="small muted">Zatím nic.</div>'}
  </div>`;
}
function attEmployeeView(emp, month) {
  const r = attRec(emp.id, month), c = attComp(emp, month);
  const rep = r?.report;
  const chk = (label, a, b) => { if (b == null) return ''; const okk = Math.abs(a - b) < 0.06; return `<span class="chk ${okk ? 'ok' : 'bad'}">${okk ? '✓' : '⚠'} ${label} ${hh(a * 60)} ${okk ? '' : `(docházka ${String(b).replace('.', ',')})`}</span>`; };
  let h = `
    <div class="page-head" style="margin-top:4px">
      <div><h2 style="margin:0">${esc(emp.name)}</h2><div class="sub">${esc([emp.department, emp.position, emp.contract, shiftText(emp)].filter(Boolean).join(' · '))}</div></div>
      <div class="row">
        <button class="btn sm ghost" id="att-set">⚙ Nastavení</button>
        <button class="btn sm ghost" id="att-ai">✦ Zeptat se SmartJoiAI</button>
        ${c ? `<button class="btn sm ${r?.status === 'done' ? 'ghost' : ''}" id="att-done">${r?.status === 'done' ? '↩ Vrátit do rozpracovaných' : '✓ Hotovo'}</button><button class="btn sm primary" id="att-xlsx">⬇ Excel pro účetní</button>` : ''}
      </div>
    </div>
    <div class="card">
      <label class="imp-drop" id="att-drop"><input type="file" id="att-file" accept=".pdf,.txt,.csv" multiple hidden>
        <b>${c ? 'Nahrát znovu' : 'Nahrát docházku'} · ${esc(monthLabel(month))}</b>
        <span class="small muted">PDF z docházkového systému (seznam záznamů „Úprava záznamů“ a/nebo měsíční výkaz) — přetáhni sem nebo klikni</span></label>
      <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap"><button class="btn sm ghost" id="att-paste">Vložit jako text</button>
        ${r?.sources?.length ? `<span class="att-srcs">${r.sources.map((s, i) => `<span class="chip att-src" title="Nahráno ${esc(fmtDate(s.at || r.updatedAt))}${s.n ? ` · ${s.n} záznamů` : ''}${s.report ? ' · měsíční výkaz' : ''}${s.ai ? ' · přečetl SmartJoiAI' : ''}">📄 ${esc(s.name)}${s.n ? ` <span class="muted">(${s.n})</span>` : s.report ? ' <span class="muted">(výkaz)</span>' : ''}<button class="icon-btn" data-srcdel="${i}" title="Smazat tento podklad i jeho záznamy">✕</button></span>`).join('')}</span>` : ''}
        ${r ? `<button class="btn sm ghost" id="att-wipe" title="Smaže všechny záznamy, podklady a úpravy za tento měsíc">🗑 Smazat měsíc</button>` : ''}
        ${c && rep ? `<span class="grow"></span>${chk('fond', c.sum.fund / 60, rep.fund)}${chk('dovolená', c.sum.vac / 60, rep.vacation)}${chk('lékař', c.sum.doc / 60, rep.doctor)}` : ''}</div>
    </div>`;
  if (!c) return h + `<div class="card empty"><div class="big">🕘</div><b>Za ${esc(monthLabel(month))} zatím žádná docházka.</b><div class="small">Nahraj PDF z docházkového systému. Víc souborů najednou je v pořádku (záznamy + měsíční výkaz pro kontrolu).</div></div>`;
  const S2 = c.sum;
  if (DC.hasAuto(emp)) h += `<div class="small muted" style="margin:-4px 2px 12px">⚡ Automatická docházka: každý pracovní den ${esc(emp.auto_start)}–${esc(emp.auto_end)} (${hh(DC.toMin(emp.auto_end) - DC.toMin(emp.auto_start))} h), víkendy a svátky ne. Dovolenou, nemoc nebo jiný čas zapíšeš kliknutím na den; čas a rozsah změníš v ⚙ Nastavení.</div>`;
  if (hasAlt(emp)) h += `<div class="small muted" style="margin:-4px 2px 12px">Směna se určuje po dnech: kdo skončil v ${esc(emp.alt_shift_end)}, měl delší směnu ${esc(emp.alt_shift_start)}–${esc(emp.alt_shift_end)} (vše před ${esc(emp.alt_shift_start)} je přesčas), jinak ${esc(emp.shift_start)}–${esc(emp.shift_end)}. Den s delší směnou má u data štítek ${esc(emp.alt_shift_start)}; ručně jde přepnout v úpravě dne.</div>`;
  h += `<div class="stats att-stats">
      <div class="stat"><div class="v">${hh(S2.worked)}</div><div class="l">odpracováno (h)</div></div>
      <div class="stat"><div class="v">${hh(S2.over)}</div><div class="l">přesčas · z toho víkend ${hh(S2.overWeekend)}</div></div>
      <div class="stat"><div class="v">${hh(S2.vac)}</div><div class="l">dovolená</div></div>
      <div class="stat"><div class="v">${hh(S2.sick)}</div><div class="l">nemoc / OČR</div></div>
      <div class="stat"><div class="v">${hh(S2.doc)}</div><div class="l">lékař</div></div>
      <div class="stat"><div class="v" style="${S2.missing ? 'color:var(--bad)' : ''}">${hh(S2.missing)}</div><div class="l">chybí odpracovat</div></div>
    </div>
    <div class="card" style="padding:4px 0"><div class="table-wrap"><table class="att-days">
      <thead><tr><th>Den</th><th>Příchod – odchod</th><th class="hide-m">Oběd</th><th class="num">Netto</th><th class="num">Přesčas</th><th class="num">Absence</th><th class="num">Chybí</th><th class="hide-m">Poznámka</th></tr></thead>
      <tbody>${c.days.map(d => {
        const abs = [d.vac && `D ${DC.fmtHM(d.vac)}`, d.sick && `N ${DC.fmtHM(d.sick)}`, d.doc && `L ${DC.fmtHM(d.doc)}`, d.other && `J ${DC.fmtHM(d.other)}`].filter(Boolean).join(' · ');
        const segs = d.segs.map(s => { const raw = (s.rs !== s.s || s.re !== s.e) ? `<div class="raw">${DC.fmtClock(s.rs)}–${DC.fmtClock(s.re)}</div>` : ''; return `<div>${DC.fmtClock(s.s)}–${DC.fmtClock(s.e)}${s.exactStart || s.exactEnd ? ' <span title="Přesný čas, nezaokrouhluje se">⚑</span>' : ''}</div>${raw}`; }).join('');
        return `<tr class="${d.holiday ? 'hol' : d.weekend ? 'we' : ''}" data-aday="${d.date}">
          <td><b>${d.day}.${+month.slice(5)}.${month.slice(0, 4)}</b> <span class="muted small">${d.dayName.slice(0, 2)}</span>${d.alt ? ` <span class="badge info" title="Delší směna ${esc(emp.alt_shift_start)}–${esc(emp.alt_shift_end)}${d.altManual ? ' (nastaveno ručně)' : ''}">${esc(emp.alt_shift_start)}${d.altManual ? '✎' : ''}</span>` : d.altManual ? ` <span class="badge" title="Ručně nastavena běžná směna">${esc(emp.shift_start)}✎</span>` : ''}</td>
          <td>${segs || '<span class="muted">—</span>'}</td>
          <td class="hide-m small">${d.lunch ? `${DC.fmtClock(d.lunch.s)}–${DC.fmtClock(d.lunch.e)}` : ''}</td>
          <td class="num">${d.netto ? DC.fmtHM(d.netto) : ''}</td>
          <td class="num">${d.over ? `<b>${DC.fmtHM(d.over)}</b>` : ''}</td>
          <td class="num small">${abs}</td>
          <td class="num ${d.missing ? 'neg' : ''}">${d.missing ? DC.fmtHM(d.missing) : ''}</td>
          <td class="hide-m small muted">${esc(d.notes.join('; '))}</td></tr>`;
      }).join('')}</tbody></table></div>
      <div class="small muted" style="padding:8px 16px">Klikni na den pro úpravu. D = dovolená, N = nemoc/OČR, L = lékař, J = jiná překážka. Šedě pod časem je původní čas z docházky, ⚑ = přesný čas bez zaokrouhlení.</div></div>`;
  return h;
}
function bindAtt(emp, month) {
  const V = $('#view');
  V.querySelectorAll('[data-amon]').forEach(b => b.onclick = () => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + Number(b.dataset.amon), 1); ui.attMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; render(); });
  $('#att-all').onclick = () => attExportAll(month);
  V.querySelectorAll('[data-atab]').forEach(b => b.onclick = () => { location.hash = '#/dochazka' + (b.dataset.atab ? '/' + b.dataset.atab : ''); });
  V.querySelectorAll('tr[data-aemp]').forEach(tr => tr.onclick = e => { if (e.target.closest('.asel')) return; location.hash = '#/dochazka/' + tr.dataset.aemp; });
  V.querySelectorAll('[data-asel]').forEach(cb => cb.onchange = () => { const s = attSelected(month); cb.checked ? s.add(cb.dataset.asel) : s.delete(cb.dataset.asel); render(); });
  if ($('#asel-all')) $('#asel-all').onchange = e => { const s = attSelected(month); for (const x of S.att.employees.filter(x => x.active && attComp(x, month))) e.target.checked ? s.add(x.id) : s.delete(x.id); render(); };
  bindAttEmail(month);
  if ($('#mem-add')) $('#mem-add').onclick = () => { const t = prompt('Nové pravidlo pro SmartJoiAI (docházka):'); if (t?.trim()) act(async () => ok(await sb.from('ai_memory').insert({ scope: 'dochazka', text: t.trim() })), 'Uloženo ✓'); };
  V.querySelectorAll('[data-memdel]').forEach(b => b.onclick = () => { if (confirm('Zapomenout tohle pravidlo?')) act(async () => ok(await sb.from('ai_memory').delete().eq('id', b.dataset.memdel)), 'Zapomenuto'); });
  V.querySelectorAll('[data-ashow]').forEach(b => b.onclick = () => act(async () => ok(await sb.from('att_employees').update({ active: true }).eq('id', b.dataset.ashow)), 'Zobrazeno ✓'));
  if (!emp) return;
  $('#att-set').onclick = () => editAttEmployee(emp.id);
  $('#att-ai').onclick = () => { chat.open = true; chatRender(); const i = $('#chat-in'); if (i) { i.value = `${emp.name}, ${monthLabel(month)}: `; i.focus(); } };
  if ($('#att-done')) $('#att-done').onclick = () => { const r = attRec(emp.id, month);
    if (!r) return act(async () => ok(await sb.from('att_months').insert({ employee_id: emp.id, month, entries: DC.autoEntries(month, emp, S.att.holidays), sources: [{ ...AUTO_SRC, at: new Date().toISOString() }], status: 'done' })), 'Označeno jako hotové ✓');
    act(async () => ok(await sb.from('att_months').update({ status: r.status === 'done' ? 'draft' : 'done' }).eq('id', r.id)), r.status === 'done' ? 'Vráceno' : 'Označeno jako hotové ✓'); };
  if ($('#att-xlsx')) $('#att-xlsx').onclick = async () => {
    try { const c = attComp(emp, month); await downloadWorkbook(fileSafe(`Evidence pracovni doby ${emp.name} ${month}`) + '.xlsx', wb => addAttendanceSheet(wb, c, emp, emp.name)); toast('Excel stažen ✓'); }
    catch (e) { toast('Chyba: ' + e.message); }
  };
  const drop = $('#att-drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) attImportFiles(emp, month, [...e.dataTransfer.files]); };
  $('#att-file').onchange = () => { if ($('#att-file').files.length) attImportFiles(emp, month, [...$('#att-file').files]); };
  $('#att-paste').onclick = () => {
    $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:720px"><div class="modal-head"><h2>Vložit docházku jako text</h2><button class="icon-btn" data-close>✕</button></div>
      <textarea id="att-text" style="min-height:300px" placeholder="Vlož zkopírovaný seznam záznamů z docházkového systému…"></textarea>
      <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="att-text-go">Zpracovat</button></div></div></div>`;
    $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
    $('#att-text-go').onclick = () => { const t = $('#att-text').value; closeModal(); attImportTexts(emp, month, [{ name: 'vložený text', text: t }]); };
  };
  V.querySelectorAll('tr[data-aday]').forEach(tr => tr.onclick = () => editAttDay(emp, month, tr.dataset.aday));
  V.querySelectorAll('[data-srcdel]').forEach(b => b.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); attDeleteSource(emp, month, +b.dataset.srcdel); });
  if ($('#att-wipe')) $('#att-wipe').onclick = () => {
    const r = attRec(emp.id, month);
    if (!confirm(`Smazat celou docházku ${emp.name} za ${monthLabel(month)}? Smažou se všechny nahrané podklady, záznamy i ruční úpravy. Pak můžeš nahrát nové soubory.`)) return;
    act(async () => ok(await sb.from('att_months').delete().eq('id', r.id)), 'Docházka za měsíc smazána');
  };
}

// --- import podkladů
async function attImportFiles(emp, month, files) {
  toast('Čtu soubory…');
  const texts = [];
  for (const f of files) {
    try {
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') { const buf = await f.arrayBuffer(); const text = await pdfToText(buf); texts.push({ name: f.name, text, pdf: text.replace(/\s/g, '').length < 50 ? buf : null }); }
      else texts.push({ name: f.name, text: await f.text() });
    } catch (e) { toast(`${f.name}: ${e.message}`); }
  }
  if (texts.length) attImportTexts(emp, month, texts);
}
const b64 = buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
async function attImportTexts(emp, month, texts) {
  let entries = [], report = null, names = new Set(), aiUsed = false;
  for (const t of texts) {
    t.id = Math.random().toString(36).slice(2, 10);   // každý podklad má své id → jde později smazat i se svými záznamy
    const p = DC.parseAttendanceText(t.text);
    if (p.employee) names.add(p.employee);
    if (p.report) { report = p.report; t.report = true; }
    if (p.entries.length) { entries.push(...p.entries.map(e => ({ ...e, src: t.id }))); continue; }
    if (p.report) continue; // měsíční výkaz — jen pro kontrolu
    // neznámý formát → SmartJoiAI
    try {
      toast('Neznámý formát — čte ho SmartJoiAI…'); aiUsed = true;
      const j = await callAssistant({ task: 'extract_attendance', employee: emp.name, month, text: t.text.slice(0, 60000), pdf: t.pdf ? b64(t.pdf) : undefined });
      if (j.employee) names.add(j.employee);
      entries.push(...(j.entries || []).map(e => ({ ...e, exact: false, label: e.label || DC.KIND_LABEL[e.kind] || '', src: t.id })));
      t.ai = true;
    } catch (e) { toast('SmartJoiAI soubor nepřečetl: ' + e.message); }
  }
  if (!entries.length && !report) return toast('V podkladech jsem nenašel žádné záznamy docházky.');
  // jméno a měsíc
  const other = [...names].find(n => nameKey(n) !== nameKey(emp.name));
  if (other && !confirm(`Podklady vypadají, že patří zaměstnanci „${other}“, ne „${emp.name}“. Přesto je uložit k ${emp.name}?`)) return;
  const months = [...new Set(entries.map(e => e.date.slice(0, 7)))];
  let target = month;
  if (months.length && !months.includes(month)) {
    const main = months.sort((a, b) => entries.filter(e => e.date.startsWith(b)).length - entries.filter(e => e.date.startsWith(a)).length)[0];
    if (!confirm(`Záznamy jsou za ${monthLabel(main)}, ne za ${monthLabel(month)}. Uložit je do ${monthLabel(main)}?`)) return;
    target = main;
  }
  const mine = entries.filter(e => e.date.startsWith(target));
  const ex = attRec(emp.id, target);
  if (mine.length && ex?.entries?.length && !confirm(`${emp.name} už má za ${monthLabel(target)} nahranou docházku (${ex.entries.length} záznamů). Nahradit ji novými podklady?`)) return;
  const now = new Date().toISOString();
  const newSrc = texts.map(t => ({ id: t.id, name: t.name, at: now, n: mine.filter(e => e.src === t.id).length, report: t.report || undefined, ai: t.ai || undefined }))
    .filter(x => x.n || x.report);
  // při nahrazení záznamů zůstane jen dřívější měsíční výkaz (pokud nepřišel nový)
  const keep = (ex?.sources || []).filter(x => mine.length ? (x.report && !x.n && !report) : true);
  const sources = [...keep, ...newSrc];
  const row = { employee_id: emp.id, month: target, sources, updated_at: new Date().toISOString(), ...(mine.length ? { entries: mine, status: 'draft', shift_days: {} } : {}), ...(report ? { report } : {}) };
  ui.attMonth = target;
  await act(async () => ok(await sb.from('att_months').upsert(row, { onConflict: 'employee_id,month' })),
    mine.length ? `Načteno ${plural(mine.length, 'záznam', 'záznamy', 'záznamů')}${aiUsed ? ' (přečetl SmartJoiAI — zkontroluj)' : ''} ✓` : 'Uložen měsíční výkaz pro kontrolu ✓');
}
// smazání jednoho nahraného podkladu i se záznamy, které z něj vznikly
async function attDeleteSource(emp, month, idx) {
  const r = attRec(emp.id, month); const src = r?.sources?.[idx]; if (!src) return;
  const legacy = !src.id;   // starší nahrávky (před 1. 10. 2026) nemají u záznamů vazbu na soubor
  let others = r.sources.filter((_, i) => i !== idx);
  const drop = e => src.kind === 'manual' ? e.edited : legacy ? !e.src && !e.edited : e.src === src.id;
  const entries = r.entries.filter(e => !drop(e));
  if (!entries.some(e => e.edited)) for (let i = others.length - 1; i >= 0; i--) if (others[i].kind === 'manual') others.splice(i, 1);
  const removed = r.entries.length - entries.length;
  const dropReport = src.report || (legacy && !others.some(x => !x.id || x.report));
  const report = dropReport ? null : r.report;
  if (!confirm(`Smazat podklad „${src.name}“${removed ? ` a ${plural(removed, 'záznam', 'záznamy', 'záznamů')}, které z něj vznikly` : ''}${dropReport && r.report ? ' (i kontrolní měsíční výkaz)' : ''}?${legacy ? '\n\nStarší nahrávka — smažou se všechny nahrané záznamy kromě ručních úprav.' : ''}`)) return;
  await act(async () => {
    if (!entries.length && !report && !others.length) ok(await sb.from('att_months').delete().eq('id', r.id));
    else ok(await sb.from('att_months').update({ sources: others, entries, report, updated_at: new Date().toISOString(), ...(entries.length ? {} : { status: 'draft', shift_days: {} }) }).eq('id', r.id));
  }, 'Podklad smazán');
}
async function callAssistant(payload) {
  const { data: { session: s } } = await sb.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (s?.access_token || '') }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({ error: 'HTTP ' + r.status })); if (j.error) throw new Error(j.error); return j;
}

// --- úprava dne
function editAttDay(emp, month, date) {
  const rec = attRec(emp.id, month);
  // obědy ze systému docházky se nepoužívají (oběd dopočítá aplikace) → v úpravě dne je neukazujeme
  const base = attEntries(emp, month), fromAuto = !rec?.entries?.length && base.length;
  const list = base.filter(e => e.date === date && e.kind !== 'lunch').map(e => ({ ...e }));
  const d = new Date(date + 'T12:00:00');
  const kinds = Object.entries(DC.KIND_LABEL).filter(([k]) => k !== 'lunch');
  const rowHtml = (e, i) => `<div class="ad-row" data-i="${i}">
    <select class="ad-kind">${kinds.map(([k, l]) => `<option value="${k}" ${e.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input type="time" class="ad-start" value="${esc(e.start || '')}"><input type="time" class="ad-end" value="${esc(e.end || '')}">
    <input type="text" class="ad-hours" inputmode="decimal" placeholder="h" value="${e.minutes != null && e.kind !== 'work' && e.kind !== 'lunch' ? String(DC.hours(e.minutes)).replace('.', ',') : ''}" title="Hodiny (u nepřítomnosti)">
    <label class="small" title="Přesný čas, nezaokrouhlovat"><input type="checkbox" class="ad-exact" ${e.exact ? 'checked' : ''}> přesně</label>
    <button class="icon-btn ad-del" title="Odebrat">✕</button></div>`;
  const draw = () => {
    $('#ad-rows').innerHTML = list.map(rowHtml).join('') || '<div class="small muted">Žádné záznamy — den bez práce.</div>';
    $('#ad-rows').querySelectorAll('.ad-del').forEach(b => b.onclick = () => { read(); list.splice(+b.closest('.ad-row').dataset.i, 1); draw(); });
  };
  const read = () => $('#ad-rows').querySelectorAll('.ad-row').forEach(r => {
    const e = list[+r.dataset.i], g = c => r.querySelector(c);
    e.kind = g('.ad-kind').value; e.start = g('.ad-start').value || null; e.end = g('.ad-end').value || null; e.exact = g('.ad-exact').checked;
    const hv = g('.ad-hours').value.trim().replace(',', '.'); e.minutes = hv ? Math.round(Number(hv) * 60) : (e.start && e.end ? Math.max(0, DC.toMin(e.end) - DC.toMin(e.start)) : null);
    e.label = DC.KIND_LABEL[e.kind]; e.date = date;
  });
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:720px">
    <div class="modal-head"><h2>${esc(emp.name)} · ${d.toLocaleDateString('cs-CZ', { weekday: 'long' })} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="small muted" style="margin-bottom:8px">Časy zadávej podle skutečnosti — zaokrouhlení a oběd se dopočítají samy (oběd ze systému docházky se nepoužívá). „Přesně“ = čas se nezaokrouhlí.</div>
    ${hasAlt(emp) && ![0, 6].includes(d.getDay()) ? `<label class="field" style="margin-bottom:10px"><span>Směna</span><select id="ad-shift">
      <option value="">Automaticky (skončil v ${esc(emp.alt_shift_end)} → ${esc(emp.alt_shift_start)}–${esc(emp.alt_shift_end)})</option>
      <option value="normal" ${rec?.shiftDays?.[date] === 'normal' ? 'selected' : ''}>${esc(emp.shift_start)}–${esc(emp.shift_end)}</option>
      <option value="alt" ${rec?.shiftDays?.[date] === 'alt' ? 'selected' : ''}>${esc(emp.alt_shift_start)}–${esc(emp.alt_shift_end)} (delší)</option></select></label>` : ''}
    <div id="ad-rows" class="stack" style="gap:6px"></div>
    <div class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap">
      <button class="btn sm ghost" id="ad-add">＋ Práce</button>
      <button class="btn sm ghost" data-adq="vacation">Dovolená celý den</button>
      <button class="btn sm ghost" data-adq="sick">Nemoc celý den</button>
      <button class="btn sm ghost" data-adq="doctor">Lékař</button>
      <button class="btn sm ghost" id="ad-clear">Vymazat den</button>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="ad-save">Uložit</button></div>
  </div></div>`;
  draw();
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  $('#ad-add').onclick = () => { read(); const alt = hasAlt(emp) && $('#ad-shift')?.value === 'alt'; list.push({ date, kind: 'work', start: alt ? emp.alt_shift_start : emp.shift_start, end: alt ? emp.alt_shift_end : emp.shift_end, minutes: null, exact: false }); draw(); };
  $('#ad-clear').onclick = () => { list.length = 0; draw(); };
  $('#modal-root').querySelectorAll('[data-adq]').forEach(b => b.onclick = () => { read(); const k = b.dataset.adq; if (k !== 'doctor') list.length = 0; list.push({ date, kind: k, start: null, end: null, minutes: k === 'doctor' ? 60 : Math.round(Number(emp.daily_hours) * 60), exact: false }); draw(); });
  $('#ad-save').onclick = async () => {
    read();
    for (const e of list) { if (e.kind === 'work' && (!e.start || !e.end)) return toast('U práce vyplň příchod i odchod'); if (e.kind !== 'work' && e.kind !== 'lunch' && !(e.minutes > 0)) return toast('U nepřítomnosti vyplň hodiny nebo čas od–do'); }
    const all = [...base.filter(e => e.date !== date), ...list.map(e => ({ ...e, edited: true }))].sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
    const sd = { ...(rec?.shiftDays || {}) }; const sv = $('#ad-shift')?.value; if (sv) sd[date] = sv; else delete sd[date];
    closeModal();
    await act(async () => ok(await sb.from('att_months').upsert({ employee_id: emp.id, month, entries: all, shift_days: sd, updated_at: new Date().toISOString(), sources: (() => { const cur = [...(rec?.sources || [])], at = new Date().toISOString();
      if (fromAuto && !cur.some(x => x.kind === 'auto')) cur.push({ ...AUTO_SRC, at });
      if (!cur.some(x => x.kind === 'manual')) cur.push({ id: 'manual', kind: 'manual', name: 'ruční úpravy', at });
      return cur; })() }, { onConflict: 'employee_id,month' })), 'Den uložen ✓');
  };
}
function editAttEmployee(id) {
  const e = attEmp(id);
  const F = [['name', 'Jméno a příjmení', 'text'], ['department', 'Oddělení', 'text'], ['position', 'Funkce', 'text'], ['employer', 'Zaměstnavatel (do Excelu)', 'text'], ['contract', 'Pracovní poměr', 'text'],
    ['weekly_hours', 'Týdenní pracovní doba (h)', 'num'], ['daily_hours', 'Denní fond (h)', 'num'], ['shift_start', 'Začátek směny', 'time'], ['shift_end', 'Konec směny', 'time'],
    ['alt_shift_start', 'Střídavá směna od (nepovinné)', 'time'], ['alt_shift_end', 'Střídavá směna do', 'time'],
    ['auto_start', 'Automatická docházka od (nepovinné)', 'time'], ['auto_end', 'Automatická docházka do', 'time'],
    ['lunch_minutes', 'Oběd (min)', 'num'], ['lunch_after_minutes', 'Oběd, když práce déle než (min)', 'num'], ['lunch_default', 'Oběd od', 'time'],
    ['round_start', 'Příchod: okno / krok zaokrouhlení (min)', 'num'], ['round_end', 'Odchod: okno / krok zaokrouhlení (min)', 'num'], ['start_tolerance', 'Příchod do X min po začátku směny = začátek směny', 'num'], ['end_tolerance', 'Odchod do X min po konci směny = konec směny', 'num']];
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:720px">
    <div class="modal-head"><h2>Nastavení · ${esc(e.name)}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="grid-2">${F.map(([k, l, t]) => `<label class="field"><span>${l}</span><input type="${t === 'time' ? 'time' : 'text'}" ${t === 'num' ? 'inputmode="decimal"' : ''} data-ae="${k}" data-t="${t}" value="${esc(String(e[k] ?? '').replace('.', t === 'num' ? ',' : '.'))}"></label>`).join('')}</div>
    <div class="grid-2" style="margin-top:10px">${[['round_start_mode', 'Příchod zaokrouhlovat'], ['round_end_mode', 'Odchod zaokrouhlovat']].map(([k, l]) => `<label class="field"><span>${l}</span><select data-ae="${k}" data-t="text">${(k === 'round_start_mode' ? [['snap_up', 'nahoru na celou/půl h, jen v okně (7:21 → 7:30, 7:19 zůstane)']] : [['snap_down', 'dolů na celou/půl h, jen v okně (17:05 → 17:00, 17:17 zůstane)']]).concat([['up', 'nahoru po kroku (6:47 → 6:50)'], ['down', 'dolů po kroku (16:20 → 16:15)'], ['nearest', 'na nejbližší krok']]).map(([v, t]) => `<option value="${v}" ${(e[k] || (k === 'round_start_mode' ? 'snap_up' : 'snap_down')) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`).join('')}</div>
    <label class="chip" style="margin-top:10px"><input type="checkbox" id="ae-active" ${e.active ? 'checked' : ''}> Zobrazovat v DocházkoBotu (odškrtnout = zpracovává se zvlášť)</label>
    <label class="field" style="margin-top:10px"><span>Poznámka / zvláštnosti (čte i SmartJoiAI)</span><textarea data-ae="notes" data-t="text" style="min-height:60px">${esc(e.notes)}</textarea></label>
    <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="ae-save">Uložit</button></div>
  </div></div>`;
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  $('#ae-save').onclick = () => {
    const row = {};
    for (const el of document.querySelectorAll('[data-ae]')) { const v = el.value.trim(); if (el.dataset.t === 'num') { const n = Number(v.replace(',', '.')); if (!Number.isFinite(n)) return toast('Zkontroluj čísla'); row[el.dataset.ae] = n; } else row[el.dataset.ae] = v; }
    if (!row.name) return toast('Vyplň jméno');
    if (!!row.alt_shift_start !== !!row.alt_shift_end) return toast('Střídavou směnu vyplň celou (od i do), nebo nech prázdnou');
    if (!!row.auto_start !== !!row.auto_end) return toast('Automatickou docházku vyplň celou (od i do), nebo nech prázdnou');
    row.active = $('#ae-active').checked;
    closeModal(); act(async () => ok(await sb.from('att_employees').update(row).eq('id', id)), 'Uloženo ✓');
  };
}
async function attExportAll(month, only) {
  if (only) {
    const list = S.att.employees.filter(e => e.active && only.has(e.id)).map(e => ({ e, c: attComp(e, month) })).filter(x => x.c);
    if (!list.length) return toast('Nikdo není vybraný');
    try { await downloadWorkbook(fileSafe(`Evidence pracovni doby ${month}`) + '.xlsx', wb => { for (const { e, c } of list) addAttendanceSheet(wb, c, e, e.name); }); toast('Excel stažen ✓'); } catch (e) { toast('Chyba: ' + e.message); }
    return;
  }
  const list = S.att.employees.filter(e => e.active).map(e => ({ e, c: attComp(e, month) })).filter(x => x.c);
  if (!list.length) return toast('Za tento měsíc zatím nikdo nemá nahranou docházku');
  const missing = S.att.employees.filter(e => e.active && !attComp(e, month)).map(e => e.name);
  if (missing.length && !confirm(`Bez docházky: ${missing.join(', ')}.\nStáhnout sešit jen s ostatními (${list.length})?`)) return;
  try { await downloadWorkbook(fileSafe(`Evidence pracovni doby ${month}`) + '.xlsx', wb => { for (const { e, c } of list) addAttendanceSheet(wb, c, e, e.name); }); toast('Excel stažen ✓'); }
  catch (e) { toast('Chyba: ' + e.message); }
}

// ---------- APLIKACE 03: STOCKJOI (sklad) ----------
const STOCK_TABS = [['prehled', 'Přehled'], ['pohyby', 'Pohyby'], ['sklady', 'Sklady'], ['kategorie', 'Kategorie']];
const MOVE_KIND = { in: ['Naskladnění', 'ok', '↓'], out: ['Vyskladnění', 'warn', '↑'], transfer: ['Přesun', 'info', '⇄'], adjust: ['Inventura', '', '≡'] };
const stItem = id => S.stock.items.find(i => i.id === id);
const stWh = id => S.stock.warehouses.find(w => w.id === id);
const stCat = id => S.stock.categories.find(c => c.id === id);
const activeWhs = () => S.stock.warehouses.filter(w => !w.archived);
const lvl = (itemId, whId) => S.stock.levels[itemId + '|' + whId] || 0;
const lvlTotal = itemId => activeWhs().reduce((s, w) => s + lvl(itemId, w.id), 0) + S.stock.warehouses.filter(w => w.archived).reduce((s, w) => s + lvl(itemId, w.id), 0);
const isLow = it => it.minQty != null && lvlTotal(it.id) < it.minQty;
const qtyU = (n, u) => `${fmtQty(n)} ${esc(u || '')}`.trim();
const itemLabel = it => (it.sku ? it.sku + ' · ' : '') + it.name;
const stockCounts = () => { const its = S.stock.items.filter(i => !i.archived); return { items: its.length, low: its.filter(isLow).length }; };

async function loadStock() {
  const [whs, cats, items, levels, moves] = await Promise.all([
    fetchAll('stock_warehouses', q => q.order('sort').order('name')),
    fetchAll('stock_categories', q => q.order('sort').order('name')),
    fetchAll('stock_items', q => q.order('name')),
    fetchAll('stock_levels'),
    sb.from('stock_moves').select('*').order('created_at', { ascending: false }).limit(600).then(ok),
  ]);
  const lv = {}; for (const l of levels) lv[l.item_id + '|' + l.warehouse_id] = Number(l.qty);
  return {
    warehouses: whs.map(w => ({ id: w.id, name: w.name, location: w.location || '', note: w.note || '', archived: w.archived })),
    categories: cats.map(c => ({ id: c.id, name: c.name })),
    items: items.map(i => ({ id: i.id, sku: i.sku || '', name: i.name, categoryId: i.category_id || '', unit: i.unit || 'ks', mpn: i.mpn || '', ean: i.ean || '', minQty: i.min_qty == null ? null : Number(i.min_qty), note: i.note || '', archived: i.archived })),
    levels: lv,
    moves: moves.map(m => ({ id: m.id, doc: m.doc_id, kind: m.kind, itemId: m.item_id, whId: m.warehouse_id, qty: Number(m.qty), ref: m.reference || '', note: m.note || '', by: m.created_by || '', at: m.created_at })),
  };
}
// pohyby seskupené do dokladů (přesun = 2 řádky)
function groupDocs(moves) {
  const map = new Map();
  for (const m of moves) {
    if (!map.has(m.doc)) map.set(m.doc, { id: m.doc, kind: m.kind, at: m.at, ref: m.ref, note: m.note, by: m.by, lines: [] });
    map.get(m.doc).lines.push(m);
  }
  return [...map.values()].map(d => {
    const whs = [...new Set(d.lines.map(l => l.whId))];
    if (d.kind === 'transfer') { d.from = d.lines.find(l => l.qty < 0)?.whId; d.to = d.lines.find(l => l.qty > 0)?.whId; d.lines = d.lines.filter(l => l.qty > 0); }
    d.whs = whs; return d;
  });
}
function docWhText(d) {
  if (d.kind === 'transfer') return `${esc(stWh(d.from)?.name || '?')} → ${esc(stWh(d.to)?.name || '?')}`;
  return d.whs.map(id => esc(stWh(id)?.name || '?')).join(', ');
}
function renderDoc(d, { showItems = true } = {}) {
  const k = MOVE_KIND[d.kind];
  return `<div class="sdoc">
    <div class="row" style="gap:8px;align-items:flex-start">
      <span class="badge ${k[1]}">${k[2]} ${k[0]}</span>
      <div class="grow"><b>${docWhText(d)}</b>${d.ref ? ` · <span>${esc(d.ref)}</span>` : ''}
        <div class="sub">${fmtDate(d.at)}${d.by ? ' · ' + esc(d.by.split('@')[0]) : ''}${d.note ? ' · ' + esc(d.note) : ''}</div></div>
      <button class="icon-btn" data-deldoc-s="${d.id}" title="Smazat pohyb (oprava chyby)">🗑</button>
    </div>
    ${showItems ? `<div class="sdoc-lines">${d.lines.map(l => { const it = stItem(l.itemId) || { name: '?' }; return `<a href="#/sklad/p/${l.itemId}">${esc(it.name)}${it.sku ? ` <span class="muted">${esc(it.sku)}</span>` : ''}</a> <b class="${d.kind === 'transfer' ? '' : l.qty < 0 ? 'neg' : 'pos'}">${l.qty > 0 && d.kind !== 'transfer' ? '+' : ''}${qtyU(l.qty, it.unit)}</b>`; }).join('<br>')}</div>` : ''}
  </div>`;
}

function renderStockApp(tab) {
  const c = stockCounts();
  const noWh = !activeWhs().length;
  let h = `
    <div class="page-head">
      <div><div class="eyebrow">Aplikace 03 · Sklad</div><h1>StockJoi</h1></div>
      <div class="row">
        <button class="btn" data-smove="in" ${noWh ? 'disabled' : ''}>↓ Naskladnit</button>
        <button class="btn" data-smove="out" ${noWh ? 'disabled' : ''}>↑ Vyskladnit</button>
        <button class="btn" data-smove="transfer" ${activeWhs().length < 2 ? 'disabled' : ''}>⇄ Přesunout</button>
      </div>
    </div>
    <div class="tabs">${STOCK_TABS.map(([id, l]) => `<button class="tab ${id === tab ? 'active' : ''}" data-stab="${id}">${l}${id === 'prehled' && c.low ? `<span class="count" style="color:var(--bad)">${c.low}</span>` : ''}</button>`).join('')}</div>`;
  const T = { prehled: stockOverview, pohyby: stockMovesTab, sklady: stockWarehousesTab, kategorie: stockCategoriesTab };
  h += (T[tab] || stockOverview)();
  $('#view').innerHTML = h;
  bindStock();
}
function stockOverview() {
  const whs = activeWhs(), c = stockCounts();
  if (!whs.length) return `<div class="card empty"><div class="big">🏬</div><b>Nejdřív si založ sklad.</b><div class="small">Třeba „Hlavní sklad“, „Prodejna“, „Externí sklad“… Skladů můžeš mít kolik chceš.</div><div style="margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn primary" data-editwh="">＋ Nový sklad</button><button class="btn" data-simport>⬆ Import z Excelu</button></div></div>`;
  const words = fold(ui.stockSearch).split(/\s+/).filter(Boolean);
  const wf = ui.stockWh && stWh(ui.stockWh) ? ui.stockWh : '';
  const qOf = it => wf ? lvl(it.id, wf) : lvlTotal(it.id);
  let list = S.stock.items.filter(i => !i.archived)
    .filter(i => !ui.stockCat || (ui.stockCat === '__none' ? !i.categoryId : i.categoryId === ui.stockCat))
    .filter(i => !words.length || words.every(w => fold([i.sku, i.name, i.mpn, i.ean, stCat(i.categoryId)?.name, i.note].join(' ')).includes(w)))
    .filter(i => ui.stockOnly === 'low' ? isLow(i) : ui.stockOnly === 'in' ? qOf(i) > 0 : true);
  list.sort((a, b) => (isLow(b) - isLow(a)) || a.name.localeCompare(b.name, 'cs'));
  const cols = !wf && whs.length > 1 && whs.length <= 5;
  const today = todayIso();
  const movesToday = new Set(S.stock.moves.filter(m => m.at.slice(0, 10) === today).map(m => m.doc)).size;
  return `
    <div class="stats">
      <div class="stat"><div class="v">${c.items}</div><div class="l">skladových položek</div></div>
      <div class="stat"><div class="v">${whs.length}</div><div class="l">${whs.length === 1 ? 'sklad' : whs.length < 5 ? 'sklady' : 'skladů'}</div></div>
      <div class="stat"><div class="v" style="${c.low ? 'color:var(--bad)' : ''}">${c.low}</div><div class="l">pod minimem</div></div>
      <div class="stat"><div class="v">${movesToday}</div><div class="l">pohybů dnes</div></div>
    </div>
    <div class="row s-tools">
      <input type="search" id="s-search" placeholder="Hledat kód, název, MPN, EAN…" value="${esc(ui.stockSearch)}">
      <select id="s-wh"><option value="">Všechny sklady</option>${whs.map(w => `<option value="${w.id}" ${wf === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
      <select id="s-cat"><option value="">Všechny kategorie</option>${S.stock.categories.map(k => `<option value="${k.id}" ${ui.stockCat === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}<option value="__none" ${ui.stockCat === '__none' ? 'selected' : ''}>Bez kategorie</option></select>
      <div class="chips"><button class="chip ${!ui.stockOnly ? 'on' : ''}" data-sonly="">Vše</button><button class="chip ${ui.stockOnly === 'in' ? 'on' : ''}" data-sonly="in">Skladem</button><button class="chip ${ui.stockOnly === 'low' ? 'on' : ''}" data-sonly="low">Pod minimem</button></div>
      <span class="grow"></span><button class="btn sm ghost" data-simport>⬆ Import</button><button class="btn sm ghost" data-sexport ${S.stock.items.some(i => !i.archived) ? '' : 'disabled'}>⬇ Export</button><button class="btn sm primary" data-edititem="">＋ Nová položka</button>
    </div>
    ${!S.stock.items.filter(i => !i.archived).length ? `<div class="card empty"><div class="big">📦</div><b>Zatím žádné skladové položky.</b><div class="small">Založ je tlačítkem „＋ Nová položka“, nahraj z Excelu přes „⬆ Import“, nebo rovnou přes „↓ Naskladnit“ — nové položky se při naskladnění založí samy.</div></div>`
    : !list.length ? `<div class="card empty">Nic nenalezeno.</div>`
    : `<div class="card" style="padding:4px 0"><div class="table-wrap"><table class="stock">
      <thead><tr><th>Položka</th><th class="hide-m">Kategorie</th>${cols ? whs.map(w => `<th class="num hide-m">${esc(w.name)}</th>`).join('') : ''}<th class="num">${wf ? esc(stWh(wf).name) : 'Celkem'}</th></tr></thead>
      <tbody>${list.slice(0, 500).map(i => { const q = qOf(i), low = isLow(i); return `<tr class="${low ? 'low' : ''}" data-sitem="${i.id}">
        <td><a href="#/sklad/p/${i.id}" class="s-name">${esc(i.name)}</a><div class="sub">${[i.sku && `<code>${esc(i.sku)}</code>`, i.mpn && 'MPN ' + esc(i.mpn)].filter(Boolean).join(' · ')}${low ? ` <span class="badge bad">pod minimem ${fmtQty(i.minQty)}</span>` : ''}</div></td>
        <td class="hide-m small">${esc(stCat(i.categoryId)?.name || '')}</td>
        ${cols ? whs.map(w => { const x = lvl(i.id, w.id); return `<td class="num hide-m ${x < 0 ? 'neg' : x ? '' : 'muted'}">${x ? fmtQty(x) : '—'}</td>`; }).join('') : ''}
        <td class="num"><b class="${q < 0 ? 'neg' : ''}">${fmtQty(q)}</b> <span class="muted small">${esc(i.unit)}</span></td></tr>`; }).join('')}</tbody></table></div>
      ${list.length > 500 ? `<p class="small muted" style="padding:0 16px">Zobrazeno 500 z ${list.length} — upřesni hledání.</p>` : ''}</div>`}`;
}
function stockMovesTab() {
  const words = fold(ui.stockMoveSearch).split(/\s+/).filter(Boolean);
  let docs = groupDocs(S.stock.moves)
    .filter(d => !ui.stockMoveKind || d.kind === ui.stockMoveKind)
    .filter(d => !ui.stockWh || d.whs.includes(ui.stockWh))
    .filter(d => !words.length || words.every(w => fold([d.ref, d.note, d.by, ...d.whs.map(x => stWh(x)?.name), ...d.lines.map(l => { const it = stItem(l.itemId); return it ? it.name + ' ' + it.sku : ''; })].join(' ')).includes(w)));
  return `
    <div class="row s-tools">
      <input type="search" id="s-msearch" placeholder="Hledat referenci, položku, poznámku…" value="${esc(ui.stockMoveSearch)}">
      <select id="s-wh"><option value="">Všechny sklady</option>${S.stock.warehouses.map(w => `<option value="${w.id}" ${ui.stockWh === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
      <div class="chips"><button class="chip ${!ui.stockMoveKind ? 'on' : ''}" data-smkind="">Vše</button>${Object.entries(MOVE_KIND).map(([k, v]) => `<button class="chip ${ui.stockMoveKind === k ? 'on' : ''}" data-smkind="${k}">${v[2]} ${v[0]}</button>`).join('')}</div>
    </div>
    ${!docs.length ? `<div class="card empty">${S.stock.moves.length ? 'Nic nenalezeno.' : 'Zatím žádné pohyby.'}</div>`
      : `<div class="card" style="padding:6px 0">${docs.slice(0, 200).map(d => renderDoc(d)).join('')}</div>`}
    ${S.stock.moves.length >= 600 ? '<p class="small muted">Zobrazeny poslední pohyby. Celou historii položky najdeš v jejím detailu.</p>' : ''}`;
}
function stockWarehousesTab() {
  const whs = S.stock.warehouses;
  const stat = w => { const its = S.stock.items.filter(i => lvl(i.id, w.id) > 0); return { n: its.length }; };
  return `<div class="card">
    <div class="card-head"><div><h2>Sklady</h2><div class="sub">Každý sklad má vlastní stav. Zboží mezi nimi přesouváš přes „⇄ Přesunout“.</div></div>
      <button class="btn primary" data-editwh="">＋ Nový sklad</button></div>
    ${!whs.length ? '<div class="empty">Zatím žádný sklad.</div>' : `<div class="table-wrap"><table><thead><tr><th>Sklad</th><th class="hide-m">Umístění</th><th class="num">Položek skladem</th><th></th></tr></thead><tbody>
    ${whs.map(w => `<tr class="${w.archived ? 'done' : ''}"><td><b>${esc(w.name)}</b>${w.archived ? ' <span class="badge">archiv</span>' : ''}${w.note ? `<div class="sub">${esc(w.note)}</div>` : ''}</td>
      <td class="hide-m small">${esc(w.location) || '<span class="muted">—</span>'}</td><td class="num">${stat(w).n}</td>
      <td style="white-space:nowrap;text-align:right"><button class="btn sm ghost" data-whfilter="${w.id}">Zobrazit stav</button> <button class="icon-btn" data-editwh="${w.id}">✎</button></td></tr>`).join('')}
    </tbody></table></div>`}
  </div>`;
}
function stockCategoriesTab() {
  const cnt = id => S.stock.items.filter(i => !i.archived && i.categoryId === id).length;
  return `<div class="card">
    <div class="card-head"><div><h2>Kategorie</h2><div class="sub">Pro přehlednost a filtrování položek.</div></div>
      <button class="btn primary" data-editcat="">＋ Nová kategorie</button></div>
    ${!S.stock.categories.length ? '<div class="empty">Zatím žádná kategorie.</div>' : `<div class="table-wrap"><table><thead><tr><th>Kategorie</th><th class="num">Položek</th><th></th></tr></thead><tbody>
    ${S.stock.categories.map(k => `<tr><td><b>${esc(k.name)}</b></td><td class="num">${cnt(k.id)}</td>
      <td style="white-space:nowrap;text-align:right"><button class="btn sm ghost" data-catfilter="${k.id}">Zobrazit</button> <button class="icon-btn" data-editcat="${k.id}">✎</button><button class="icon-btn" data-delcat="${k.id}" title="Smazat">🗑</button></td></tr>`).join('')}
    </tbody></table></div>`}
  </div>`;
}
function bindStock() {
  const V = $('#view');
  V.querySelectorAll('[data-stab]').forEach(b => b.onclick = () => { location.hash = '#/sklad/' + b.dataset.stab; });
  V.querySelectorAll('[data-smove]').forEach(b => b.onclick = () => stockMoveModal(b.dataset.smove));
  V.querySelectorAll('[data-edititem]').forEach(b => b.onclick = () => editStockItem(b.dataset.edititem));
  V.querySelectorAll('[data-simport]').forEach(b => b.onclick = importStockModal);
  V.querySelectorAll('[data-sexport]').forEach(b => b.onclick = exportStockXlsx);
  V.querySelectorAll('[data-editwh]').forEach(b => b.onclick = () => editWarehouse(b.dataset.editwh));
  V.querySelectorAll('[data-editcat]').forEach(b => b.onclick = () => editCategory(b.dataset.editcat));
  V.querySelectorAll('[data-whfilter]').forEach(b => b.onclick = () => { ui.stockWh = b.dataset.whfilter; location.hash = '#/sklad/prehled'; });
  V.querySelectorAll('[data-catfilter]').forEach(b => b.onclick = () => { ui.stockCat = b.dataset.catfilter; location.hash = '#/sklad/prehled'; });
  V.querySelectorAll('[data-delcat]').forEach(b => b.onclick = () => {
    const k = stCat(b.dataset.delcat); if (!confirm(`Smazat kategorii „${k.name}“? Položky zůstanou, jen budou bez kategorie.`)) return;
    act(async () => ok(await sb.from('stock_categories').delete().eq('id', k.id)), 'Kategorie smazána');
  });
  V.querySelectorAll('[data-sonly]').forEach(b => b.onclick = () => { ui.stockOnly = b.dataset.sonly; render(); });
  V.querySelectorAll('[data-smkind]').forEach(b => b.onclick = () => { ui.stockMoveKind = b.dataset.smkind; render(); });
  if ($('#s-wh')) $('#s-wh').onchange = () => { ui.stockWh = $('#s-wh').value; render(); };
  if ($('#s-cat')) $('#s-cat').onchange = () => { ui.stockCat = $('#s-cat').value; render(); };
  for (const [id, key] of [['s-search', 'stockSearch'], ['s-msearch', 'stockMoveSearch']]) {
    const el = $('#' + id); if (!el) continue;
    el.oninput = () => { ui[key] = el.value; const pos = el.selectionStart; render(); const n = $('#' + id); n.focus(); n.setSelectionRange(pos, pos); };
  }
  V.querySelectorAll('tr[data-sitem]').forEach(tr => tr.onclick = e => { if (!e.target.closest('a,button')) location.hash = '#/sklad/p/' + tr.dataset.sitem; });
  bindDocDelete(V);
}
function bindDocDelete(V) {
  V.querySelectorAll('[data-deldoc-s]').forEach(b => b.onclick = () => {
    if (!confirm('Smazat tenhle pohyb? Stav skladu se vrátí, jako by se nestal. (Použij při chybném zadání.)')) return;
    act(async () => ok(await sb.from('stock_moves').delete().eq('doc_id', b.getAttribute('data-deldoc-s'))), 'Pohyb smazán');
  });
}

// --- detail položky
async function renderStockItem(id) {
  const it = stItem(id);
  if (!it) { $('#view').innerHTML = `<div class="card empty">Položka nenalezena. <a href="#/sklad">Zpět</a></div>`; return; }
  const whs = S.stock.warehouses.filter(w => !w.archived || lvl(id, w.id));
  const total = lvlTotal(id);
  $('#view').innerHTML = `
    <div class="page-head">
      <div><a class="small muted" href="#/sklad" style="text-decoration:none">← StockJoi</a>
        <h1>${esc(it.name)}</h1>
        <div class="sub">${[it.sku && 'Kód ' + esc(it.sku), it.mpn && 'MPN ' + esc(it.mpn), it.ean && 'EAN ' + esc(it.ean), stCat(it.categoryId) && esc(stCat(it.categoryId).name)].filter(Boolean).join(' · ') || '&nbsp;'}${it.archived ? ' · <span class="badge">archiv</span>' : ''}</div></div>
      <div class="row"><button class="btn sm" id="si-edit">✎ Upravit</button></div>
    </div>
    <div class="stats s-stats">
      <div class="stat"><div class="v ${total < 0 ? 'neg' : ''}" style="${isLow(it) ? 'color:var(--bad)' : ''}">${fmtQty(total)} <span class="small muted">${esc(it.unit)}</span></div><div class="l">celkem skladem${it.minQty != null ? ` · minimum ${fmtQty(it.minQty)}` : ''}</div></div>
      ${whs.map(w => `<div class="stat"><div class="v">${fmtQty(lvl(id, w.id))}</div><div class="l">${esc(w.name)}</div></div>`).join('')}
    </div>
    <div class="row" style="gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn" data-simove="in">↓ Naskladnit</button>
      <button class="btn" data-simove="out">↑ Vyskladnit</button>
      ${activeWhs().length > 1 ? '<button class="btn" data-simove="transfer">⇄ Přesunout</button>' : ''}
      <button class="btn ghost" id="si-inv">≡ Inventura</button>
    </div>
    ${it.note ? `<div class="card"><h3 style="margin-top:0">Poznámka</h3><div class="small" style="white-space:pre-wrap">${esc(it.note)}</div></div>` : ''}
    <div class="card" style="padding:6px 0"><div class="card-head" style="padding:10px 18px 0"><h2 style="margin:0">Historie pohybů</h2></div><div id="si-hist"><div class="empty small">Načítám…</div></div></div>`;
  $('#si-edit').onclick = () => editStockItem(id);
  $('#si-inv').onclick = () => inventoryModal(id);
  document.querySelectorAll('[data-simove]').forEach(b => b.onclick = () => stockMoveModal(b.dataset.simove, { itemId: id }));
  try {
    const rows = ok(await sb.from('stock_moves').select('*').eq('item_id', id).order('created_at', { ascending: false }).limit(500));
    if (route().id !== id) return;
    const ms = rows.map(m => ({ id: m.id, doc: m.doc_id, kind: m.kind, itemId: m.item_id, whId: m.warehouse_id, qty: Number(m.qty), ref: m.reference || '', note: m.note || '', by: m.created_by || '', at: m.created_at }));
    const docs = groupDocs(ms);
    $('#si-hist').innerHTML = docs.length ? docs.map(d => renderDoc(d)).join('') : '<div class="empty small">Zatím žádné pohyby.</div>';
    bindDocDelete($('#si-hist'));
  } catch (e) { $('#si-hist').innerHTML = `<div class="empty small">Chyba: ${esc(e.message)}</div>`; }
}

// --- naskladnění / vyskladnění / přesun
function stockMoveModal(kind, { itemId = '' } = {}) {
  const whs = activeWhs(), k = MOVE_KIND[kind];
  const defWh = ui.stockWh && stWh(ui.stockWh) && !stWh(ui.stockWh).archived ? ui.stockWh : whs[0]?.id;
  const whSel = (id, cur) => `<select id="${id}">${whs.map(w => `<option value="${w.id}" ${w.id === cur ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>`;
  const items = S.stock.items.filter(i => !i.archived);
  const pre = itemId ? stItem(itemId) : null;
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:720px">
    <div class="modal-head"><h2>${k[2]} ${k[0]}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="stack">
      <div class="grid-2">
        ${kind === 'transfer'
          ? `<label class="field"><span>Ze skladu</span>${whSel('sm-wh', defWh)}</label><label class="field"><span>Do skladu</span>${whSel('sm-wh2', whs.find(w => w.id !== defWh)?.id)}</label>`
          : `<label class="field"><span>${kind === 'in' ? 'Do skladu' : 'Ze skladu'}</span>${whSel('sm-wh', defWh)}</label>`}
        <label class="field"><span>Reference ${kind === 'in' ? '(dodací list, AUF…)' : kind === 'out' ? '(číslo objednávky, zakázka…)' : ''}</span><input type="text" id="sm-ref"></label>
      </div>
      <div>
        <div class="sm-head small muted"><span>Položka</span><span>Množství</span><span></span></div>
        <div id="sm-rows"></div>
        <datalist id="sm-items">${items.map(i => `<option value="${esc(itemLabel(i))}">`).join('')}</datalist>
        <div style="margin-top:8px"><button class="btn sm ghost" id="sm-add">＋ Další položka</button></div>
        ${kind === 'in' ? '<div class="small muted" style="margin-top:6px">Napiš kód nebo název. Když položka ještě neexistuje, založí se nová.</div>' : ''}
      </div>
      <label class="field"><span>Poznámka</span><input type="text" id="sm-note"></label>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="sm-save">${k[0] === 'Přesun' ? 'Přesunout' : k[0] === 'Naskladnění' ? 'Naskladnit' : 'Vyskladnit'}</button></div>
  </div></div>`;
  const root = $('#sm-rows');
  const hint = row => {
    const it = resolveItem(row.querySelector('.sm-item').value); const h = row.querySelector('.sm-hint');
    if (!it) { h.textContent = row.querySelector('.sm-item').value.trim() && kind === 'in' ? 'nová položka' : ''; return; }
    h.textContent = kind === 'in' ? `skladem ${fmtQty(lvl(it.id, $('#sm-wh').value))} ${it.unit}` : `k dispozici ${fmtQty(lvl(it.id, $('#sm-wh').value))} ${it.unit}`;
  };
  const addRow = (label = '') => {
    root.insertAdjacentHTML('beforeend', `<div class="sm-row"><div><input type="text" class="sm-item" list="sm-items" placeholder="Kód nebo název" value="${esc(label)}" autocomplete="off"><div class="sm-hint small muted"></div></div>
      <input type="text" class="sm-qty" inputmode="decimal" placeholder="0"><button class="icon-btn sm-del" title="Odebrat">✕</button></div>`);
    const row = root.lastElementChild;
    row.querySelector('.sm-item').addEventListener('input', () => hint(row));
    row.querySelector('.sm-del').onclick = () => { row.remove(); if (!root.children.length) addRow(); };
    hint(row); return row;
  };
  addRow(pre ? itemLabel(pre) : '');
  $('#sm-add').onclick = () => addRow().querySelector('.sm-item').focus();
  $('#sm-wh').onchange = () => root.querySelectorAll('.sm-row').forEach(hint);
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  (pre ? root.querySelector('.sm-qty') : root.querySelector('.sm-item')).focus();
  $('#sm-save').onclick = async () => {
    const wh = $('#sm-wh').value, wh2 = kind === 'transfer' ? $('#sm-wh2').value : '';
    if (kind === 'transfer' && wh === wh2) return toast('Vyber dva různé sklady');
    const lines = [], unknown = [];
    for (const row of root.querySelectorAll('.sm-row')) {
      const txt = row.querySelector('.sm-item').value.trim(), qty = Number(row.querySelector('.sm-qty').value.replace(/\s/g, '').replace(',', '.'));
      if (!txt && !row.querySelector('.sm-qty').value.trim()) continue;
      if (!txt) return toast('Vyplň položku');
      if (!(qty > 0)) return toast(`Zadej množství u „${txt}“`);
      const it = resolveItem(txt);
      if (!it) { if (kind !== 'in') return toast(`Položka „${txt}“ neexistuje`); unknown.push(txt); }
      lines.push({ it, txt, qty });
    }
    if (!lines.length) return toast('Přidej aspoň jednu položku');
    if (unknown.length && !confirm(`Založit ${plural(unknown.length, 'novou položku', 'nové položky', 'nových položek')}?\n\n${[...new Set(unknown)].join('\n')}`)) return;
    if (kind !== 'in') {
      const need = {}; for (const l of lines) need[l.it.id] = (need[l.it.id] || 0) + l.qty;
      const short = Object.entries(need).filter(([id, q]) => q > lvl(id, wh)).map(([id, q]) => `${stItem(id).name}: chce ${fmtQty(q)}, skladem ${fmtQty(lvl(id, wh))}`);
      if (short.length && !confirm(`Na skladu „${stWh(wh).name}“ není dost zboží:\n\n${short.join('\n')}\n\nPřesto pokračovat? (stav půjde do minusu)`)) return;
    }
    const ref = $('#sm-ref').value.trim(), note = $('#sm-note').value.trim();
    closeModal();
    await act(async () => {
      const created = {};
      for (const name of [...new Set(unknown)]) created[name] = ok(await sb.from('stock_items').insert({ name, unit: 'ks' }).select().single()).id;
      const doc = crypto.randomUUID(), rows = [];
      for (const l of lines) {
        const item_id = l.it ? l.it.id : created[l.txt];
        if (kind === 'transfer') rows.push({ doc_id: doc, kind, item_id, warehouse_id: wh, qty: -l.qty, reference: ref, note }, { doc_id: doc, kind, item_id, warehouse_id: wh2, qty: l.qty, reference: ref, note });
        else rows.push({ doc_id: doc, kind, item_id, warehouse_id: wh, qty: kind === 'in' ? l.qty : -l.qty, reference: ref, note });
      }
      ok(await sb.from('stock_moves').insert(rows));
    }, kind === 'in' ? 'Naskladněno ✓' : kind === 'out' ? 'Vyskladněno ✓' : 'Přesunuto ✓');
  };
}
// „SKU · název“, samotný kód nebo přesný název → položka
function resolveItem(txt) {
  const t = fold(txt.trim()); if (!t) return null;
  const items = S.stock.items.filter(i => !i.archived);
  return items.find(i => fold(itemLabel(i)) === t) || items.find(i => i.sku && fold(i.sku) === t) || items.find(i => fold(i.name) === t)
    || items.find(i => (i.mpn && fold(i.mpn) === t) || (i.ean && fold(i.ean) === t)) || null;
}
function inventoryModal(id) {
  const it = stItem(id), whs = S.stock.warehouses.filter(w => !w.archived || lvl(id, w.id));
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:520px">
    <div class="modal-head"><h2>≡ Inventura · ${esc(it.name)}</h2><button class="icon-btn" data-close>✕</button></div>
    <p class="small muted" style="margin-top:0">Zadej, kolik je skutečně na skladě. Rozdíl se zapíše jako pohyb „Inventura“.</p>
    <div class="stack">${whs.map(w => `<label class="field"><span>${esc(w.name)} <span class="muted">(evidováno ${fmtQty(lvl(id, w.id))} ${esc(it.unit)})</span></span><input type="text" inputmode="decimal" data-invwh="${w.id}" value="${fmtQty(lvl(id, w.id)).replace(/\s/g, '')}"></label>`).join('')}
      <label class="field"><span>Poznámka</span><input type="text" id="inv-note" placeholder="např. roční inventura"></label></div>
    <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="inv-save">Uložit</button></div>
  </div></div>`;
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  $('#inv-save').onclick = async () => {
    const doc = crypto.randomUUID(), note = $('#inv-note').value.trim(), rows = [];
    for (const inp of document.querySelectorAll('[data-invwh]')) {
      const v = Number(inp.value.replace(/\s/g, '').replace(',', '.'));
      if (inp.value.trim() === '' || !Number.isFinite(v)) return toast('Zadej čísla');
      const d = Math.round((v - lvl(id, inp.dataset.invwh)) * 1000) / 1000;
      if (d) rows.push({ doc_id: doc, kind: 'adjust', item_id: id, warehouse_id: inp.dataset.invwh, qty: d, note });
    }
    closeModal();
    if (!rows.length) return toast('Beze změny');
    await act(async () => ok(await sb.from('stock_moves').insert(rows)), 'Inventura uložena ✓');
  };
}

// --- import / export z Excelu (SheetJS se načte až při použití)
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.mjs';
let _xlsx = null;
async function xlsxLib() { if (!_xlsx) _xlsx = await import(XLSX_URL); return _xlsx; }
const IMPORT_FIELDS = [
  ['sku', 'Kód', [/^k[oó]d/i, /^sku$/i, /^code$/i, /^č[ií]slo/i, /^product.?code/i, /^katalog/i]],
  ['name', 'Název', [/^n[aá]zev/i, /^name$/i, /^produkt/i, /^polo[zž]ka/i, /^popis/i, /^description/i]],
  ['category', 'Kategorie', [/^kategorie/i, /^category/i, /^skupina/i]],
  ['unit', 'Jednotka', [/^jednotka/i, /^unit/i, /^mj$/i, /^m\.?j\.?$/i]],
  ['mpn', 'MPN', [/^mpn$/i, /v[yý]robce/i, /part.?n/i]],
  ['ean', 'EAN', [/^ean/i, /^[čc][aá]rov/i, /barcode/i]],
  ['min', 'Minimum', [/^min/i]],
];
const QTY_RE = [/^mno[zž]stv/i, /^pcs$/i, /^ks$/i, /^kus/i, /skladem/i, /^stav/i, /^qty/i, /^quantity/i, /^po[cč]et/i, /^stock/i];
const numCell = v => { if (typeof v === 'number') return v; const t = String(v ?? '').replace(/\s| /g, '').replace(',', '.'); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
async function exportStockXlsx() {
  try {
    const X = await xlsxLib();
    const whs = activeWhs(), wf = ui.stockWh && stWh(ui.stockWh) ? ui.stockWh : '';
    const words = fold(ui.stockSearch).split(/\s+/).filter(Boolean);
    const items = S.stock.items.filter(i => !i.archived)
      .filter(i => !ui.stockCat || (ui.stockCat === '__none' ? !i.categoryId : i.categoryId === ui.stockCat))
      .filter(i => !words.length || words.every(w => fold([i.sku, i.name, i.mpn, i.ean, stCat(i.categoryId)?.name, i.note].join(' ')).includes(w)))
      .sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    const cols = wf ? [stWh(wf)] : whs;
    const rows = items.map(i => {
      const r = { 'Kód': i.sku, 'Název': i.name, 'Kategorie': stCat(i.categoryId)?.name || '', 'Jednotka': i.unit, 'MPN': i.mpn, 'EAN': i.ean, 'Minimum': i.minQty ?? '' };
      for (const w of cols) r[w.name] = lvl(i.id, w.id);
      if (!wf) r['Celkem'] = lvlTotal(i.id);
      return r;
    });
    const ws = X.utils.json_to_sheet(rows, { header: ['Kód', 'Název', 'Kategorie', 'Jednotka', 'MPN', 'EAN', 'Minimum', ...cols.map(w => w.name), ...(wf ? [] : ['Celkem'])] });
    ws['!cols'] = [{ wch: 16 }, { wch: 44 }, { wch: 18 }, { wch: 9 }, { wch: 16 }, { wch: 15 }, { wch: 9 }, ...cols.map(() => ({ wch: 14 })), { wch: 10 }];
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Sklad');
    X.writeFile(wb, `StockJoi-${wf ? stWh(wf).name.replace(/[^\w\-]+/g, '_') + '-' : ''}${todayIso()}.xlsx`);
    toast(`Exportováno ${plural(rows.length, 'položka', 'položky', 'položek')} ✓`);
  } catch (e) { toast('Export se nepovedl: ' + e.message); }
}
function importStockModal() {
  const imp = { file: '', headers: [], rows: [], map: {}, qty: [], mode: 'set' };
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:760px">
    <div class="modal-head"><h2>⬆ Import z Excelu</h2><button class="icon-btn" data-close>✕</button></div>
    <div id="imp-body" class="stack">
      <p class="small muted" style="margin:0">Nahraj .xlsx, .xls nebo .csv. První řádek musí být hlavička (např. <b>Kód · Název · Kategorie · Množství</b>). Stačí i jen dva sloupce: kód a počet kusů. Soubor z exportu StockJoi jde nahrát zpátky beze změn.</p>
      <label class="imp-drop"><input type="file" id="imp-file" accept=".xlsx,.xls,.csv,.ods" hidden><b>Vybrat soubor</b><span class="small muted">nebo ho sem přetáhni</span></label>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="imp-go" disabled>Importovat</button></div>
  </div></div>`;
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  const drop = $('.imp-drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); };
  $('#imp-file').onchange = () => { if ($('#imp-file').files[0]) readFile($('#imp-file').files[0]); };
  async function readFile(f) {
    try {
      const X = await xlsxLib();
      const wb = X.read(await f.arrayBuffer(), { type: 'array', raw: /\.csv$/i.test(f.name) }); // CSV jako text → „7,5“ zůstane 7,5
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = X.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: true });
      const hi = aoa.findIndex(r => r.filter(c => String(c).trim() !== '').length >= 2);
      if (hi < 0) throw new Error('V souboru nevidím tabulku s hlavičkou');
      imp.file = f.name; imp.headers = aoa[hi].map((h, i) => String(h).trim() || `Sloupec ${i + 1}`);
      imp.first = hi + 2; imp.rows = aoa.slice(hi + 1).map((r, i) => Object.assign(r, { _n: hi + 2 + i })).filter(r => r.some(c => String(c).trim() !== ''));
      // automatické rozpoznání sloupců
      const used = new Set();
      for (const [k, , res] of IMPORT_FIELDS) { const i = imp.headers.findIndex((h, j) => !used.has(j) && res.some(re => re.test(h))); imp.map[k] = i; if (i >= 0) used.add(i); }
      imp.qty = [];
      imp.headers.forEach((h, j) => { if (used.has(j)) return; const w = S.stock.warehouses.find(x => fold(x.name) === fold(h)); if (w) { imp.qty.push({ col: j, wh: w.id }); used.add(j); } });
      if (!imp.qty.length) { const j = imp.headers.findIndex((h, j) => !used.has(j) && QTY_RE.some(re => re.test(h))); if (j >= 0) imp.qty.push({ col: j, wh: (ui.stockWh && stWh(ui.stockWh) ? ui.stockWh : activeWhs()[0]?.id) || '__new:Hlavní sklad' }); }
      renderMapping();
    } catch (e) { toast('Soubor se nepodařilo přečíst: ' + e.message); }
  }
  function plan() {
    const col = k => imp.map[k] ?? -1, cell = (r, k) => col(k) >= 0 ? String(r[col(k)] ?? '').trim() : '';
    const bySku = new Map(S.stock.items.filter(i => i.sku).map(i => [fold(i.sku), i])), byName = new Map(S.stock.items.map(i => [fold(i.name), i]));
    const out = [], errs = []; const seen = new Set();
    imp.rows.forEach((r, n) => {
      const sku = cell(r, 'sku'), name = cell(r, 'name');
      if (!sku && !name) return;
      const key = fold(sku || name); if (seen.has(key)) { errs.push(`Řádek ${r._n}: ${sku || name} je v souboru dvakrát — použije se první`); return; } seen.add(key);
      const ex = (sku && bySku.get(fold(sku))) || (!sku && byName.get(fold(name))) || null;
      if (!ex && !name && !sku) return;
      const min = cell(r, 'min') === '' ? undefined : numCell(cell(r, 'min'));
      const qty = imp.qty.filter(q => q.col >= 0 && q.wh).map(q => ({ wh: q.wh, v: numCell(r[q.col]) })).filter(q => q.v !== null);
      if (qty.some(q => Number.isNaN(q.v))) { errs.push(`Řádek ${r._n} (${sku || name}): množství není číslo — přeskočeno`); return; }
      out.push({ ex, sku, name: name || ex?.name || sku, category: cell(r, 'category'), unit: cell(r, 'unit'), mpn: cell(r, 'mpn'), ean: cell(r, 'ean'), min: Number.isNaN(min) ? undefined : min, qty });
    });
    return { out, errs };
  }
  function renderMapping() {
    const opt = cur => `<option value="-1">— nepoužít —</option>` + imp.headers.map((h, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>${esc(h)}</option>`).join('');
    const whOpt = (cur, col) => S.stock.warehouses.filter(w => !w.archived).map(w => `<option value="${w.id}" ${cur === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')
      + `<option value="__new:${esc(imp.headers[col] && !QTY_RE.some(re => re.test(imp.headers[col])) ? imp.headers[col] : 'Hlavní sklad')}" ${String(cur).startsWith('__new:') ? 'selected' : ''}>＋ Založit sklad „${esc(String(cur).startsWith('__new:') ? cur.slice(6) : (imp.headers[col] && !QTY_RE.some(re => re.test(imp.headers[col])) ? imp.headers[col] : 'Hlavní sklad'))}“</option>`;
    const p = plan();
    const nNew = p.out.filter(x => !x.ex).length, nUpd = p.out.length - nNew;
    const whId = w => String(w).startsWith('__new:') ? null : w;
    const nQty = p.out.reduce((t, x) => t + x.qty.filter(q => imp.mode === 'add' ? q.v !== 0 : q.v !== (x.ex && whId(q.wh) ? lvl(x.ex.id, q.wh) : 0)).length, 0);
    $('#imp-body').innerHTML = `
      <div class="small"><b>${esc(imp.file)}</b> · ${plural(imp.rows.length, 'řádek', 'řádky', 'řádků')} <button class="btn sm ghost" id="imp-again" style="margin-left:8px">Jiný soubor</button></div>
      <div><h3 style="margin:4px 0 8px">Sloupce</h3><div class="grid-3">${IMPORT_FIELDS.map(([k, l]) => `<label class="field"><span>${l}${k === 'sku' || k === 'name' ? ' *' : ''}</span><select data-impmap="${k}">${opt(imp.map[k])}</select></label>`).join('')}</div>
        <div class="small muted" style="margin-top:4px">* Položky se párují podle kódu, bez kódu podle názvu. Nové se založí, existujícím se doplní vyplněné údaje.</div></div>
      <div><h3 style="margin:4px 0 8px">Počet kusů skladem</h3>
        ${imp.qty.map((q, i) => `<div class="row imp-qty"><select data-qcol="${i}">${opt(q.col)}</select><span class="muted">→ sklad</span><select data-qwh="${i}">${whOpt(q.wh, q.col)}</select><button class="icon-btn" data-qdel="${i}">✕</button></div>`).join('') || '<div class="small muted">Bez množství — naimportují se jen položky.</div>'}
        <button class="btn sm ghost" id="imp-qadd" style="margin-top:6px">＋ Sloupec s množstvím</button>
        ${imp.qty.length ? `<div class="chips" style="margin-top:10px"><label class="chip ${imp.mode === 'set' ? 'on' : ''}"><input type="radio" name="imp-mode" value="set" ${imp.mode === 'set' ? 'checked' : ''} hidden>Nastavit stav (inventura)</label><label class="chip ${imp.mode === 'add' ? 'on' : ''}"><input type="radio" name="imp-mode" value="add" ${imp.mode === 'add' ? 'checked' : ''} hidden>Přičíst (naskladnění)</label></div>
          <div class="small muted" style="margin-top:4px">${imp.mode === 'set' ? 'Stav ve skladu bude přesně jako v souboru; rozdíl se zapíše jako inventura.' : 'Množství ze souboru se přičte k současnému stavu jako naskladnění.'}</div>` : ''}
      </div>
      <div class="notice ${p.errs.length ? 'warn' : ''}"><b>Náhled:</b> ${plural(nNew, 'nová položka', 'nové položky', 'nových položek')} · ${plural(nUpd, 'existující', 'existující', 'existujících')} · ${imp.qty.length ? plural(nQty, 'změna stavu', 'změny stavu', 'změn stavu') : 'bez změny stavu'}
        ${p.errs.length ? `<div class="small" style="margin-top:6px">${p.errs.slice(0, 5).map(esc).join('<br>')}${p.errs.length > 5 ? `<br>… a ${p.errs.length - 5} dalších` : ''}</div>` : ''}</div>
      <div class="table-wrap"><table><thead><tr><th></th><th>Kód</th><th>Název</th><th class="hide-m">Kategorie</th>${imp.qty.map(q => `<th class="num">${esc(String(q.wh).startsWith('__new:') ? q.wh.slice(6) : stWh(q.wh)?.name || '?')}</th>`).join('')}</tr></thead><tbody>
        ${p.out.slice(0, 12).map(x => `<tr><td><span class="badge ${x.ex ? '' : 'ok'}">${x.ex ? 'úprava' : 'nová'}</span></td><td><code>${esc(x.sku)}</code></td><td>${esc(x.name)}</td><td class="hide-m small">${esc(x.category)}</td>${imp.qty.map(q => { const v = x.qty.find(z => z.wh === q.wh); return `<td class="num">${v ? fmtQty(v.v) : '<span class="muted">—</span>'}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>${p.out.length > 12 ? `<div class="small muted">… a dalších ${p.out.length - 12}</div>` : ''}`;
    $('#imp-go').disabled = !p.out.length || (imp.map.sku < 0 && imp.map.name < 0);
    $('#imp-again').onclick = () => $('#imp-file') ? $('#imp-file').click() : importStockModal();
    document.querySelectorAll('[data-impmap]').forEach(s => s.onchange = () => { imp.map[s.dataset.impmap] = +s.value; renderMapping(); });
    document.querySelectorAll('[data-qcol]').forEach(s => s.onchange = () => { imp.qty[+s.dataset.qcol].col = +s.value; renderMapping(); });
    document.querySelectorAll('[data-qwh]').forEach(s => s.onchange = () => { imp.qty[+s.dataset.qwh].wh = s.value; renderMapping(); });
    document.querySelectorAll('[data-qdel]').forEach(b => b.onclick = () => { imp.qty.splice(+b.dataset.qdel, 1); renderMapping(); });
    document.querySelectorAll('input[name="imp-mode"]').forEach(r => r.onchange = () => { imp.mode = r.value; renderMapping(); });
    $('#imp-qadd').onclick = () => { imp.qty.push({ col: -1, wh: activeWhs()[0]?.id || '__new:Hlavní sklad' }); renderMapping(); };
  }
  $('#imp-go').onclick = async () => {
    const p = plan(); if (!p.out.length) return;
    if (imp.qty.some(q => q.col < 0)) return toast('U množství vyber sloupec, nebo řádek odeber ✕');
    const whs = [...new Set(imp.qty.map(q => q.wh))];
    if (new Set(imp.qty.map(q => q.wh)).size !== imp.qty.length) return toast('Každý sklad může mít jen jeden sloupec s množstvím');
    const nNew = p.out.filter(x => !x.ex).length;
    if (!confirm(`Importovat ${plural(p.out.length, 'položku', 'položky', 'položek')} (${nNew} nových)?${imp.qty.length ? `\nStav skladu: ${imp.mode === 'set' ? 'nastavit podle souboru' : 'přičíst'}.` : ''}`)) return;
    $('#imp-go').disabled = true; $('#imp-go').textContent = 'Importuji…';
    const res = await act(async () => {
      const now = new Date().toISOString();
      // sklady a kategorie
      const whMap = {};
      for (const w of whs) whMap[w] = w.startsWith('__new:') ? ok(await sb.from('stock_warehouses').insert({ name: w.slice(6), sort: S.stock.warehouses.length }).select().single()).id : w;
      const catMap = new Map(S.stock.categories.map(k => [fold(k.name), k.id]));
      for (const name of [...new Set(p.out.map(x => x.category).filter(Boolean))]) if (!catMap.has(fold(name))) catMap.set(fold(name), ok(await sb.from('stock_categories').insert({ name }).select().single()).id);
      const catId = x => x.category ? catMap.get(fold(x.category)) : undefined;
      // nové položky najednou
      const fresh = p.out.filter(x => !x.ex);
      for (let i = 0; i < fresh.length; i += 500) {
        const chunk = fresh.slice(i, i + 500);
        const ins = ok(await sb.from('stock_items').insert(chunk.map(x => ({ sku: x.sku, name: x.name, category_id: catId(x) || null, unit: x.unit || 'ks', mpn: x.mpn, ean: x.ean, min_qty: x.min ?? null }))).select('id,sku,name'));
        chunk.forEach((x, j) => { x.id = ins[j].id; });
      }
      // existující: doplnit vyplněné údaje
      const upd = p.out.filter(x => x.ex);
      for (let i = 0; i < upd.length; i += 20) await Promise.all(upd.slice(i, i + 20).map(async x => {
        x.id = x.ex.id; const row = {};
        if (x.name && x.name !== x.ex.name) row.name = x.name;
        if (catId(x) && catId(x) !== x.ex.categoryId) row.category_id = catId(x);
        for (const [k, f] of [['unit', 'unit'], ['mpn', 'mpn'], ['ean', 'ean']]) if (x[k] && x[k] !== x.ex[f]) row[k] = x[k];
        if (x.min !== undefined && x.min !== x.ex.minQty) row.min_qty = x.min;
        if (x.ex.archived) row.archived = false;
        if (Object.keys(row).length) ok(await sb.from('stock_items').update({ ...row, updated_at: now }).eq('id', x.id));
      }));
      // stav skladu
      const doc = crypto.randomUUID(), moves = [];
      for (const x of p.out) for (const q of x.qty) {
        const wh = whMap[q.wh], cur = x.ex ? lvl(x.id, wh) : 0;
        const d = imp.mode === 'set' ? Math.round((q.v - cur) * 1000) / 1000 : q.v;
        if (d) moves.push({ doc_id: doc, kind: imp.mode === 'set' ? 'adjust' : 'in', item_id: x.id, warehouse_id: wh, qty: d, reference: imp.file, note: 'Import z Excelu' });
      }
      for (let i = 0; i < moves.length; i += 500) ok(await sb.from('stock_moves').insert(moves.slice(i, i + 500)));
      return { items: p.out.length, fresh: fresh.length, moves: moves.length };
    });
    if (!res) { $('#imp-go').disabled = false; $('#imp-go').textContent = 'Importovat'; return; }
    closeModal();
    { toast(`Hotovo: ${plural(res.items, 'položka', 'položky', 'položek')} (${res.fresh} nových), ${plural(res.moves, 'změna stavu', 'změny stavu', 'změn stavu')} ✓`); }
  };
}

// --- položka / sklad / kategorie
function editStockItem(id) {
  const it = stItem(id) || { id: '', sku: '', name: '', categoryId: ui.stockCat && ui.stockCat !== '__none' ? ui.stockCat : '', unit: 'ks', mpn: '', ean: '', minQty: null, note: '', archived: false };
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:640px">
    <div class="modal-head"><h2>${id ? 'Upravit položku' : 'Nová skladová položka'}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="stack">
      <div class="grid-2">
        <label class="field"><span>Kód (náš)</span><input type="text" id="it-sku" value="${esc(it.sku)}" autocomplete="off"></label>
        <label class="field"><span>Název *</span><input type="text" id="it-name" value="${esc(it.name)}"></label>
        <label class="field"><span>Kategorie</span><select id="it-cat"><option value="">— bez kategorie —</option>${S.stock.categories.map(k => `<option value="${k.id}" ${k.id === it.categoryId ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}<option value="__new">＋ Nová kategorie…</option></select></label>
        <label class="field"><span>Jednotka</span><input type="text" id="it-unit" value="${esc(it.unit)}" list="it-units"></label>
        <label class="field"><span>MPN (kód výrobce)</span><input type="text" id="it-mpn" value="${esc(it.mpn)}"></label>
        <label class="field"><span>EAN</span><input type="text" id="it-ean" inputmode="numeric" value="${esc(it.ean)}"></label>
        <label class="field"><span>Minimální zásoba (upozornění)</span><input type="text" id="it-min" inputmode="decimal" value="${it.minQty == null ? '' : fmtQty(it.minQty).replace(/\s/g, '')}" placeholder="nepovinné"></label>
      </div>
      <label class="field"><span>Poznámka</span><textarea id="it-note" style="min-height:60px">${esc(it.note)}</textarea></label>
      <datalist id="it-units">${['ks', 'm', 'm²', 'bm', 'kg', 'bal', 'sada', 'role', 'paleta'].map(u => `<option value="${u}">`).join('')}</datalist>
    </div>
    <div class="modal-foot">${id ? `<button class="btn ghost" id="it-arch" style="margin-right:auto">${it.archived ? '↩ Obnovit' : '🗄 Archivovat'}</button>` : ''}<button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="it-save">Uložit</button></div>
  </div></div>`;
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  $('#it-cat').onchange = () => { if ($('#it-cat').value !== '__new') return; const n = prompt('Název nové kategorie'); const sel = $('#it-cat'); if (!n?.trim()) { sel.value = it.categoryId || ''; return; } sel.insertAdjacentHTML('beforeend', `<option value="__new:${esc(n.trim())}" selected>${esc(n.trim())}</option>`); };
  (id ? $('#it-name') : $('#it-sku')).focus();
  if ($('#it-arch')) $('#it-arch').onclick = () => { closeModal(); act(async () => ok(await sb.from('stock_items').update({ archived: !it.archived }).eq('id', id)), it.archived ? 'Obnoveno' : 'Archivováno'); };
  $('#it-save').onclick = async () => {
    const g = k => $('#it-' + k).value.trim();
    const minTxt = g('min'), min = minTxt === '' ? null : Number(minTxt.replace(',', '.'));
    if (!g('name')) return toast('Vyplň název');
    if (minTxt !== '' && !Number.isFinite(min)) return toast('Minimum musí být číslo');
    if (g('sku') && S.stock.items.some(x => x.id !== id && x.sku && fold(x.sku) === fold(g('sku')))) return toast(`Kód ${g('sku')} už má jiná položka`);
    let cat = $('#it-cat').value;
    const row = { sku: g('sku'), name: g('name'), unit: g('unit') || 'ks', mpn: g('mpn'), ean: g('ean'), min_qty: min, note: g('note'), updated_at: new Date().toISOString() };
    closeModal();
    const saved = await act(async () => {
      if (cat.startsWith('__new:')) cat = ok(await sb.from('stock_categories').insert({ name: cat.slice(6) }).select().single()).id;
      row.category_id = cat && cat !== '__new' ? cat : null;
      return id ? ok(await sb.from('stock_items').update(row).eq('id', id).select().single()) : ok(await sb.from('stock_items').insert(row).select().single());
    }, 'Uloženo ✓');
    if (saved && !id) location.hash = '#/sklad/p/' + saved.id;
  };
}
function editWarehouse(id) {
  const w = stWh(id) || { id: '', name: '', location: '', note: '', archived: false };
  const has = id && S.stock.moves.some(m => m.whId === id);
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:480px">
    <div class="modal-head"><h2>${id ? 'Upravit sklad' : 'Nový sklad'}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="stack">
      <label class="field"><span>Název *</span><input type="text" id="wh-name" value="${esc(w.name)}" placeholder="např. Hlavní sklad"></label>
      <label class="field"><span>Umístění / adresa</span><input type="text" id="wh-location" value="${esc(w.location)}"></label>
      <label class="field"><span>Poznámka</span><input type="text" id="wh-note" value="${esc(w.note)}"></label>
    </div>
    <div class="modal-foot">${id ? `<button class="btn ghost" id="wh-del" style="margin-right:auto">${has ? (w.archived ? '↩ Obnovit' : '🗄 Archivovat') : '🗑 Smazat'}</button>` : ''}<button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="wh-save">Uložit</button></div>
  </div></div>`;
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  $('#wh-name').focus();
  if ($('#wh-del')) $('#wh-del').onclick = () => {
    closeModal();
    if (has) return act(async () => ok(await sb.from('stock_warehouses').update({ archived: !w.archived }).eq('id', id)), w.archived ? 'Obnoveno' : 'Sklad archivován');
    if (!confirm(`Smazat sklad „${w.name}“?`)) return;
    act(async () => ok(await sb.from('stock_warehouses').delete().eq('id', id)), 'Sklad smazán');
  };
  $('#wh-save').onclick = () => {
    const row = { name: $('#wh-name').value.trim(), location: $('#wh-location').value.trim(), note: $('#wh-note').value.trim() };
    if (!row.name) return toast('Vyplň název');
    closeModal();
    act(async () => id ? ok(await sb.from('stock_warehouses').update(row).eq('id', id)) : ok(await sb.from('stock_warehouses').insert({ ...row, sort: S.stock.warehouses.length })), 'Sklad uložen ✓');
  };
}
function editCategory(id) {
  const k = stCat(id);
  const n = prompt(k ? 'Přejmenovat kategorii' : 'Název nové kategorie', k ? k.name : '');
  if (!n?.trim()) return;
  act(async () => k ? ok(await sb.from('stock_categories').update({ name: n.trim() }).eq('id', id)) : ok(await sb.from('stock_categories').insert({ name: n.trim(), sort: S.stock.categories.length })), 'Uloženo ✓');
}

// ---------- APLIKACE 02: EMAILJOI ----------
const emailById = id => S.emails.find(e => e.id === id);
// proměnné v šabloně: {cokoliv}; {datum}/{dnes} se doplní samy
const AUTO_VARS = { datum: () => new Date().toLocaleDateString('cs-CZ'), dnes: () => new Date().toLocaleDateString('cs-CZ'), date: () => new Date().toLocaleDateString('en-GB') };
const VAR_RE = /\{([^{}\n]{1,40})\}/g;
function emailVars(e) {
  const set = new Set();
  for (const t of [e.to, e.cc, e.subject, e.body]) for (const m of String(t).matchAll(VAR_RE)) if (!AUTO_VARS[m[1].trim().toLowerCase()]) set.add(m[1].trim());
  return [...set];
}
function fillEmail(e, vals = {}) {
  const f = t => String(t || '').replace(VAR_RE, (m, k) => { const key = k.trim(); const a = AUTO_VARS[key.toLowerCase()]; return a ? a() : (vals[key] ? vals[key] : m); });
  return { to: f(e.to), cc: f(e.cc), subject: f(e.subject), body: f(e.body) };
}
const mailtoLink = x => 'mailto:' + encodeURIComponent(x.to).replace(/%40/g, '@').replace(/%2C/gi, ',') + '?' +
  [x.cc && 'cc=' + encodeURIComponent(x.cc), 'subject=' + encodeURIComponent(x.subject), 'body=' + encodeURIComponent(x.body)].filter(Boolean).join('&');
function markUsed(id) {
  const e = emailById(id); if (!e) return;
  e.useCount++; e.lastUsed = new Date().toISOString();
  sb.from('email_templates').update({ use_count: e.useCount, last_used_at: e.lastUsed }).eq('id', id).then(() => {}, () => {});
}
const emailCats = () => [...new Set(S.emails.map(e => e.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs'));
function renderEmailList() {
  const q = ui.emailSearch.trim().toLowerCase(), cats = emailCats();
  if (ui.emailCat && !cats.includes(ui.emailCat)) ui.emailCat = '';
  const list = S.emails
    .filter(e => !ui.emailCat || e.category === ui.emailCat)
    .filter(e => !q || [e.title, e.category, e.to, e.cc, e.subject, e.body, e.note].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.pinned - a.pinned) || (b.useCount - a.useCount) || a.title.localeCompare(b.title, 'cs'));
  $('#view').innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Aplikace 02 · Často posílané e-maily</div><h1>EmailJoi</h1></div>
      <div class="row"><button class="btn primary" id="em-new">＋ Nový e-mail</button></div>
    </div>
    ${S.emails.length ? `<div class="row em-tools">
      <input type="search" id="em-search" placeholder="Hledat v názvu, adrese, předmětu i textu…" value="${esc(ui.emailSearch)}">
      ${cats.length ? `<div class="chips"><button class="chip ${!ui.emailCat ? 'on' : ''}" data-ecat="">Vše <span class="muted">${S.emails.length}</span></button>${cats.map(c => `<button class="chip ${ui.emailCat === c ? 'on' : ''}" data-ecat="${esc(c)}">${esc(c)} <span class="muted">${S.emails.filter(e => e.category === c).length}</span></button>`).join('')}</div>` : ''}
    </div>` : ''}
    ${!S.emails.length ? `<div class="card empty"><div class="big">✉️</div><b>Zatím tu nic není.</b><div class="small">Založ si první e-mail, který posíláš často — adresu, předmět a text pak jen kopíruješ.</div><div style="margin-top:14px"><button class="btn primary" data-emnew2>＋ Nový e-mail</button></div></div>`
    : !list.length ? `<div class="card empty">Nic nenalezeno.</div>`
    : `<div class="em-grid">${list.map(e => { const x = fillEmail(e, ui.emailVals[e.id]); const vars = emailVars(e); return `
      <div class="card em-card">
        <a class="em-open" href="#/emaily/e/${e.id}">
          <div class="row" style="gap:8px;align-items:flex-start"><h3 class="grow">${e.pinned ? '<span class="em-star" title="Připnuto">★</span> ' : ''}${esc(e.title || '(bez názvu)')}</h3>${e.category ? `<span class="badge">${esc(e.category)}</span>` : ''}</div>
          <div class="em-meta"><span class="muted">Komu</span> ${esc(e.to) || '<span class="muted">—</span>'}</div>
          <div class="em-meta"><span class="muted">Předmět</span> ${esc(e.subject) || '<span class="muted">—</span>'}</div>
          <div class="em-preview">${esc(e.body.slice(0, 220))}${e.body.length > 220 ? '…' : ''}</div>
        </a>
        <div class="row em-actions">
          ${vars.length ? `<a class="btn sm primary" href="#/emaily/e/${e.id}">Vyplnit ${plural(vars.length, 'údaj', 'údaje', 'údajů')} →</a>` : `
          <button class="btn sm" data-ecopy="${e.id}" data-f="to" ${x.to ? '' : 'disabled'}>Adresa</button>
          <button class="btn sm" data-ecopy="${e.id}" data-f="subject" ${x.subject ? '' : 'disabled'}>Předmět</button>
          <button class="btn sm" data-ecopy="${e.id}" data-f="body">Text</button>
          <a class="btn sm ghost" href="${esc(mailtoLink(x))}" data-emailto="${e.id}" title="Otevřít v poštovním programu">✉ Mail</a>`}
          <span class="grow"></span><span class="small muted" title="Kolikrát zkopírováno">${e.useCount ? e.useCount + '×' : ''}</span>
        </div>
      </div>`; }).join('')}</div>`}`;
  const V = $('#view');
  $('#em-new').onclick = () => editEmail('');
  V.querySelectorAll('[data-emnew2]').forEach(b => b.onclick = () => editEmail(''));
  const se = $('#em-search');
  if (se) se.oninput = () => { ui.emailSearch = se.value; const pos = se.selectionStart; renderEmailList(); const n = $('#em-search'); n.focus(); n.setSelectionRange(pos, pos); };
  V.querySelectorAll('[data-ecat]').forEach(b => b.onclick = () => { ui.emailCat = b.dataset.ecat; renderEmailList(); });
  V.querySelectorAll('[data-ecopy]').forEach(b => b.onclick = () => { const e = emailById(b.dataset.ecopy); copyText(fillEmail(e, ui.emailVals[e.id])[b.dataset.f]); markUsed(e.id); });
  V.querySelectorAll('[data-emailto]').forEach(a => a.addEventListener('click', () => markUsed(a.dataset.emailto)));
}
function renderEmailDetail(id) {
  const e = emailById(id);
  if (!e) { $('#view').innerHTML = `<div class="card empty">E-mail nenalezen. <a href="#/emaily">Zpět</a></div>`; return; }
  const vals = ui.emailVals[id] ||= {};
  const vars = emailVars(e);
  const x = fillEmail(e, vals);
  const field = (f, label, val, multi) => `
    <div class="em-field">
      <div class="row em-field-head"><span class="em-label">${label}</span><span class="grow"></span>${val ? `<button class="btn sm" data-dcopy="${f}">Kopírovat</button>` : ''}</div>
      ${multi ? `<div class="em-body" data-out="${f}">${esc(val) || '<span class="muted">—</span>'}</div>` : `<div class="em-value" data-out="${f}">${esc(val) || '<span class="muted">—</span>'}</div>`}
    </div>`;
  $('#view').innerHTML = `
    <div class="page-head">
      <div><a class="small muted" href="#/emaily" style="text-decoration:none">← EmailJoi</a>
        <h1>${e.pinned ? '<span class="em-star">★</span> ' : ''}${esc(e.title || '(bez názvu)')}</h1>
        <div class="sub">${e.category ? esc(e.category) + ' · ' : ''}${e.useCount ? `použito ${e.useCount}× · naposledy ${ago(e.lastUsed)}` : 'zatím nepoužito'}</div></div>
      <div class="row">
        <button class="btn sm ghost" id="ed-pin">${e.pinned ? '☆ Odepnout' : '★ Připnout'}</button>
        <button class="btn sm ghost" id="ed-dup">⧉ Duplikovat</button>
        <button class="btn sm ghost" id="ed-del">🗑 Smazat</button>
        <button class="btn sm" id="ed-edit">✎ Upravit</button>
      </div>
    </div>
    ${vars.length ? `<div class="card stack">
      <div><h2>Doplň údaje</h2><div class="sub">Tyhle údaje se liší e-mail od e-mailu — doplní se do adresy, předmětu i textu.</div></div>
      <div class="grid-2">${vars.map(v => `<label class="field"><span>${esc(v)}</span><input type="text" data-var="${esc(v)}" value="${esc(vals[v] || '')}"></label>`).join('')}</div>
      <div class="row"><button class="btn sm ghost" id="ed-clear">Vymazat údaje</button></div>
    </div>` : ''}
    <div class="card stack em-detail">
      ${field('to', 'Komu', x.to)}
      ${e.cc || x.cc ? field('cc', 'Kopie', x.cc) : ''}
      ${field('subject', 'Předmět', x.subject)}
      ${field('body', 'Text', x.body, true)}
      <div class="row em-bottom">
        <button class="btn" id="ed-all">Kopírovat vše</button>
        <a class="btn primary" id="ed-mailto" href="${esc(mailtoLink(x))}">✉ Otevřít v Mailu</a>
      </div>
    </div>
    ${e.note ? `<div class="card"><h3 style="margin-top:0">Poznámka</h3><div class="small" style="white-space:pre-wrap">${esc(e.note)}</div></div>` : ''}`;
  const cur = () => fillEmail(e, vals);
  const refreshOut = () => {
    const y = cur();
    for (const f of ['to', 'cc', 'subject', 'body']) { const el = $(`[data-out="${f}"]`); if (el) el.textContent = y[f] || '—'; }
    $('#ed-mailto').href = mailtoLink(y);
  };
  document.querySelectorAll('[data-var]').forEach(inp => inp.oninput = () => { vals[inp.dataset.var] = inp.value; refreshOut(); });
  document.querySelectorAll('[data-dcopy]').forEach(b => b.onclick = () => { copyText(cur()[b.dataset.dcopy]); markUsed(id); });
  $('#ed-all').onclick = () => { const y = cur(); copyText([`Komu: ${y.to}`, y.cc ? `Kopie: ${y.cc}` : '', `Předmět: ${y.subject}`, '', y.body].filter((l, i) => l || i === 3).join('\n')); markUsed(id); };
  $('#ed-mailto').addEventListener('click', () => markUsed(id));
  if ($('#ed-clear')) $('#ed-clear').onclick = () => { ui.emailVals[id] = {}; renderEmailDetail(id); };
  $('#ed-edit').onclick = () => editEmail(id);
  $('#ed-pin').onclick = () => act(async () => ok(await sb.from('email_templates').update({ pinned: !e.pinned }).eq('id', id)), e.pinned ? 'Odepnuto' : 'Připnuto ★');
  $('#ed-dup').onclick = () => editEmail('', { ...e, title: e.title + ' (kopie)', pinned: false });
  $('#ed-del').onclick = () => {
    if (!confirm(`Smazat e-mail „${e.title}“?`)) return;
    act(async () => ok(await sb.from('email_templates').delete().eq('id', id)), 'Smazáno').then(() => { if (!emailById(id)) location.hash = '#/emaily'; });
  };
}
function editEmail(id, preset) {
  const e = emailById(id) || preset || { id: '', title: '', category: ui.emailCat || '', to: '', cc: '', subject: '', body: '', note: '' };
  const cats = emailCats();
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:720px">
    <div class="modal-head"><h2>${id ? 'Upravit e-mail' : 'Nový e-mail'}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="stack">
      <div class="grid-2">
        <label class="field"><span>Název *</span><input type="text" id="ee-title" value="${esc(e.title)}" placeholder="např. Objednávka palet – Gunreben"></label>
        <label class="field"><span>Kategorie</span><input type="text" id="ee-category" list="ee-cats" value="${esc(e.category)}" placeholder="např. Dodavatelé, Dopravci, Zákazníci">
          <datalist id="ee-cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="field"><span>Komu</span><input type="text" id="ee-to" value="${esc(e.to)}" placeholder="adresa@firma.cz (více oddělit čárkou)" autocapitalize="off" spellcheck="false"></label>
        <label class="field"><span>Kopie (volitelné)</span><input type="text" id="ee-cc" value="${esc(e.cc)}" autocapitalize="off" spellcheck="false"></label>
      </div>
      <label class="field"><span>Předmět</span><input type="text" id="ee-subject" value="${esc(e.subject)}"></label>
      <label class="field"><span>Text</span><textarea id="ee-body" style="min-height:240px">${esc(e.body)}</textarea></label>
      <div class="small muted">Tip: co se mění, napiš do složených závorek — třeba <code>{číslo objednávky}</code> nebo <code>{jméno}</code>. Před kopírováním to jen doplníš. <code>{datum}</code> se doplní samo dnešním datem.</div>
      <label class="field"><span>Poznámka pro tebe (nekopíruje se)</span><textarea id="ee-note" style="min-height:60px">${esc(e.note)}</textarea></label>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="ee-save">Uložit</button></div>
  </div></div>`;
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  $('#ee-title').focus();
  $('#ee-save').onclick = async () => {
    const g = k => $('#ee-' + k).value;
    const row = { title: g('title').trim(), category: g('category').trim(), to_addr: g('to').trim(), cc: g('cc').trim(), subject: g('subject').trim(), body: g('body').replace(/\s+$/, ''), note: g('note').trim(), updated_at: new Date().toISOString() };
    if (!row.title) return toast('Vyplň název');
    closeModal();
    const saved = await act(async () => id ? ok(await sb.from('email_templates').update(row).eq('id', id).select().single()) : ok(await sb.from('email_templates').insert(row).select().single()), 'Uloženo ✓');
    if (saved && !id) location.hash = '#/emaily/e/' + saved.id;
  };
}

// ---------- APLIKACE OBJEDNÁVKY ----------
function syncNotices() {
  const sync = S.sync, m = S.settings.mapping || {};
  let h = '';
  if (sync.error && !/Nerozpoznal jsem sloupce/.test(sync.error)) h += `<div class="notice bad"><b>Nepodařilo se načíst CSV ze Shoptetu:</b> ${esc(sync.error)} <span class="muted small">(${ago(sync.errorAt)})</span></div>`;
  if (sync.headers.length && !m.itemCode && !m.itemName) h += `<div class="notice warn"><b>Export ze Shoptetu neobsahuje položky objednávek.</b> <a href="#/objednavky/nastaveni">Sloupce v exportu →</a></div>`;
  return h;
}
function renderOrdersApp(tab) {
  const c = counts();
  const tabCount = { objednavky: c.todo + c.issue, aufy: c.sentAufs, svozy: c.unshipped + c.toReceive, dodavatele: S.suppliers.length };
  let html = `
    <div class="page-head">
      <div><div class="eyebrow">Aplikace 01 · Vinylor · objednávky od dodavatelů</div><h1>OrderJoi</h1></div>
      <div class="row">
        <span class="small muted">Shoptet: ${S.sync.error ? `<span style="color:var(--bad)">chyba</span>` : ago(S.sync.fetchedAt)}</span>
        <button class="btn" id="btn-sync">↻ Načíst ze Shoptetu</button>
      </div>
    </div>
    <div class="tabs">${TABS.map(([id, l]) => `<button class="tab ${id === tab ? 'active' : ''}" data-tab="${id}">${l}${tabCount[id] ? `<span class="count">${tabCount[id]}</span>` : ''}</button>`).join('')}</div>
    ${syncNotices()}`;
  const T = { objednavky: tabOrders, aufy: tabAufs, svozy: tabShipments, produkty: tabProducts, dodavatele: tabSuppliers, nastaveni: tabSettings };
  html += (T[tab] || tabOrders)();
  $('#view').innerHTML = html;
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { location.hash = `#/objednavky/${b.dataset.tab}`; });
  $('#btn-sync').onclick = doSync;
  bind();
}
async function doSync() {
  const b = $('#btn-sync'); if (b) { b.disabled = true; b.innerHTML = '<span class="spin">↻</span> Načítám…'; }
  await act(requestSync, 'Načteno ze Shoptetu ✓');
}

// --- tab: Objednávky (seznam)
const ACTIVE_ST = ['issue', 'todo', 'waiting', 'confirmed', 'shipping'];
const ST_ICON = { issue: '⚠', todo: '🛒', waiting: '✉', confirmed: '📋', shipping: '🚚', delivered: '✓' };
const relDay = d => { if (!d) return ''; const n = Math.round((new Date(d + 'T12:00:00') - new Date(todayIso() + 'T12:00:00')) / 864e5); return n === 0 ? 'dnes' : n === 1 ? 'zítra' : n === -1 ? 'včera' : n > 0 ? `za ${plural(n, 'den', 'dny', 'dní')}` : `před ${plural(-n, 'dnem', 'dny', 'dny')}`; };
function orderSteps(st) {
  const i = STEP[st]; if (i == null) return '';
  const L = ['Objednat', 'AUF', 'Svoz', 'Doručeno'];
  return `<div class="osteps ${st === 'issue' ? 'is-issue' : ''}" title="${L.map((l, k) => (k < i || st === 'delivered' ? '✓ ' : k === i ? '● ' : '○ ') + l).join('  ')}">${L.map((l, k) => `<i class="${k < i || st === 'delivered' ? 'done' : k === i ? 'now' : ''}"></i>`).join('')}</div>`;
}
function tabOrders() {
  const c = counts();
  const f = ['active', 'done', 'archive'].includes(ui.orderFilter) ? ui.orderFilter : 'active';
  const words = fold(ui.orderSearch).split(/\s+/).filter(Boolean);
  // hledá v čísle objednávky, AUF číslech, zákazníkovi, poznámkách i položkách (i v archivu)
  const hay = o => fold([o.code, o.customer, o.note, o.shoptetStatus,
    ...aufsOf(o.code).flatMap(a => [a.aufNumber, a.note, a.deliveryNote, supName(a.supplierId)]),
    ...S.items.filter(i => i.orderCode === o.code).flatMap(i => [i.code, i.name, i.variant, prod(i.code).mpn])].join(' '));
  const all = S.orders.map(o => ({ o, st: orderState(o.code) }));
  const inF = x => f === 'archive' ? x.o.archived : !x.o.archived && (f === 'active' ? ACTIVE_ST.includes(x.st) : !ACTIVE_ST.includes(x.st) && (x.st !== 'empty' || x.o.manual));
  let list = words.length ? all.filter(x => words.every(w => hay(x.o).includes(w))) : all.filter(inF);
  if (!words.length && f === 'active' && ui.orderState) list = list.filter(x => x.st === ui.orderState);
  list.sort((a, b) => STATE[a.st][2] - STATE[b.st][2] || String(b.o.date).localeCompare(String(a.o.date)) || b.o.code.localeCompare(a.o.code));
  const nDone = all.filter(x => !x.o.archived && !ACTIVE_ST.includes(x.st) && (x.st !== 'empty' || x.o.manual)).length;
  const deliveredCnt = all.filter(x => !x.o.archived && x.st === 'delivered').length;
  const tiles = [['issue', 'Reklamace', c.issue], ['todo', 'Objednat', c.todo], ['waiting', 'Čeká na AUF', c.waiting], ['confirmed', 'Bez svozu', all.filter(x => !x.o.archived && x.st === 'confirmed').length], ['shipping', 'Na cestě', c.transit], ['delivered', 'Doručeno', deliveredCnt]];
  // nejbližší svoz
  const nextShip = S.shipments.filter(x => !x.deliveredAt && aufsInShipment(x.id).length).sort((x, y) => String(x.date || '9').localeCompare(String(y.date || '9')))[0];
  let h = `<div class="pipe">${tiles.map(([k, l, n], idx) => `<button class="pipe-t st-${k} ${ui.orderState === k && f === 'active' ? 'on' : ''} ${!n ? 'zero' : ''}" data-ostate="${k}" style="--i:${idx}">
      <span class="pipe-i">${ST_ICON[k]}</span><span class="pipe-n" data-count="${n}">${n}</span><span class="pipe-l">${l}</span></button>`).join('')}</div>
    ${nextShip ? (() => { const L = aufsInShipment(nextShip.id), due = nextShip.date && nextShip.date <= todayIso(); return `<div class="nextship ${due ? 'due' : ''}">
      <span class="ns-truck">🚚</span><div class="grow"><b>${due ? 'Svoz by měl být u nás' : 'Nejbližší svoz'}${nextShip.ref ? ' · ' + esc(nextShip.ref) : ''}</b>
      <div class="sub">${nextShip.date ? `${esc(fmtDay(nextShip.date))} · ${relDay(nextShip.date)}` : 'bez data'} · ${plural(L.length, 'AUF', 'AUFy', 'AUFů')} · ${eur(sumEur(L))}</div></div>
      ${due ? `<button class="btn primary sm" data-deliver="${nextShip.id}">✓ Označit doručení</button>` : `<a class="btn sm ghost" href="#/objednavky/svozy">Svozy ›</a>`}</div>`; })() : ''}
    <div class="row o-tools">
      <div class="osearch"><span>⌕</span><input type="search" id="o-search" placeholder="Hledat objednávku, AUF, zákazníka, položku…" value="${esc(ui.orderSearch)}"></div>
      <div class="chips" ${words.length ? 'style="opacity:.45"' : ''}>${[['active', 'Aktivní', c.todo + c.waiting + c.issue + c.transit + all.filter(x => !x.o.archived && x.st === 'confirmed').length], ['done', 'Vyřízené', nDone], ['archive', 'Archiv', S.orders.filter(o => o.archived).length]].map(([k, l, n]) => `<button class="chip ${f === k ? 'on' : ''}" data-ofilter="${k}">${l} <span class="muted">${n}</span></button>`).join('')}</div>
      <div class="grow"></div><button class="btn sm" data-neworder>＋ Ruční objednávka</button>
    </div>
    ${!words.length && f === 'active' && ui.orderState ? `<div class="small muted" style="margin:-4px 0 10px">Filtr: <b>${esc(STATE[ui.orderState][0])}</b> · <a href="#" data-ostate="">zrušit</a></div>` : ''}`;
  if (words.length && !list.length) return h + `<div class="card empty"><div class="big">🔍</div><b>Nic nenalezeno pro „${esc(ui.orderSearch)}“.</b><div class="small">Hledá se v aktivních, vyřízených i archivovaných objednávkách.</div></div>`;
  if (words.length) h += `<div class="small muted" style="margin:-4px 0 10px">${plural(list.length, 'výsledek', 'výsledky', 'výsledků')} — všechny objednávky</div>`;
  if (!list.length) return h + `<div class="card empty fadein"><div class="big">${f === 'active' ? '🎉' : '🗂'}</div><b>${f === 'active' ? (ui.orderState ? 'Tady nic není.' : 'Všechno vyřízeno.') : f === 'done' ? 'Zatím nic vyřízeného.' : 'Archiv je prázdný.'}</b><div class="small">${f === 'active' && S.sync.fetchedAt ? 'Shoptet načten ' + ago(S.sync.fetchedAt) + '.' : ''}</div></div>`;
  const grouped = !words.length && f === 'active' && !ui.orderState;
  const row = ({ o, st }, idx) => {
    const its = orderItems(o.code), aufs = aufsOf(o.code);
    const sups = [...new Set([...its.filter(i => effDec(i) === 'order' && effSup(i)).map(effSup), ...aufs.map(a => a.supplierId)])].filter(Boolean);
    const issues = aufs.filter(isIssue);
    const ship = aufs.map(a => a.shipmentId && shipmentById(a.shipmentId)).find(x => x && !x.deliveredAt);
    return `<a class="orow st-${st}" style="--i:${Math.min(idx, 14)}" href="#/objednavky/o/${encodeURIComponent(o.code)}">
      <div class="grow"><div class="row" style="gap:8px"><b class="ocode">${esc(o.code)}</b>${o.manual ? '<span class="badge">ručně</span>' : ''}${o.archived ? '<span class="badge">archiv</span>' : ''}${o.note ? '<span title="Má poznámku">📝</span>' : ''}</div>
        <div class="sub">${esc(o.customer || '')}${o.customer ? ' · ' : ''}${esc(String(o.date || '').slice(0, 10))} · ${plural(its.length, 'položka', 'položky', 'položek')}${sups.length ? ' · ' + sups.map(x => `${flag(supplierById(x)?.country)} ${esc(supName(x))}`).join(', ') : ''}</div>
        ${issues.length ? `<div class="oissue">⚠ ${issues.map(a => `${esc(DELIVERY[a.delivery][0])}${a.aufNumber ? ' (AUF ' + esc(a.aufNumber) + ')' : ''}${a.deliveryNote ? ': ' + esc(a.deliveryNote) : ''}`).join(' · ')}</div>` : ''}
        ${st === 'shipping' && ship ? `<div class="sub">🚚 ${ship.ref ? esc(ship.ref) + ' · ' : ''}${ship.date ? esc(fmtDay(ship.date)) + ' · ' + relDay(ship.date) : 'bez data'}</div>` : ''}</div>
      ${orderSteps(st)}
      ${grouped ? '' : `<span class="badge ${STATE[st][1]}">${STATE[st][0]}</span>`}<span class="chev">›</span></a>`;
  };
  if (!words.length && f === 'active' && !ui.orderState) {
    let k = 0;
    for (const st of ACTIVE_ST) { const g = list.filter(x => x.st === st); if (!g.length) continue;
      h += `<div class="ogroup st-${st}"><div class="ogroup-h"><span>${ST_ICON[st]} ${STATE[st][0]}</span><span class="muted">${g.length}</span></div><div class="card olist-card"><div class="olist">${g.map(x => row(x, k++)).join('')}</div></div></div>`; }
    return h;
  }
  return h + `<div class="card olist-card"><div class="olist">${list.map(row).join('')}</div></div>`;
}

// --- detail objednávky
function renderOrderDetail(code) {
  const o = orderByCode(code);
  if (!o) { $('#view').innerHTML = `<div class="card empty">Objednávka ${esc(code)} nenalezena. <a href="#/objednavky">Zpět</a></div>`; return; }
  const its = orderItems(code);
  const aufs = aufsOf(code);
  const st = orderState(code);
  const open = its.filter(i => !i.aufId);
  const needSup = open.filter(i => effDec(i) === 'order' && !effSup(i)).length;
  const groups = new Map();
  for (const i of open) if (effDec(i) === 'order' && effSup(i)) { const s = effSup(i); if (!groups.has(s)) groups.set(s, []); groups.get(s).push(i); }
  const locked = i => i.aufId && aufById(i.aufId)?.status !== 'draft';
  const delCol = o.manual || its.some(i => i.manual);
  const supOptions = cur => `<option value="" ${!cur ? 'selected' : ''}>— dodavatel —</option>${S.suppliers.map(s => `<option value="${s.id}" ${cur === s.id ? 'selected' : ''}>${flag(s.country)} ${esc(s.name)}</option>`).join('')}<option value="__new">＋ Nový dodavatel…</option>`;
  $('#view').innerHTML = `
    <div class="page-head">
      <div><a class="small muted" href="#/objednavky" style="text-decoration:none">← Objednávky</a>
        <h1>${esc(o.code)}</h1>
        <div class="sub">${esc(o.customer || '')}${o.customer && o.date ? ' · ' : ''}${esc(o.date || '')} · ${o.manual ? 'ruční objednávka (mimo Shoptet)' : 'Shoptet: ' + esc(o.shoptetStatus || '—')}</div></div>
      <div class="row"><span class="badge ${STATE[st][1]}">${STATE[st][0]}</span>
        ${o.manual ? `<button class="btn sm ghost" id="o-edit">✎ Upravit</button>${aufs.some(a => a.status !== 'draft') ? '' : '<button class="btn sm ghost" id="o-delete">🗑 Smazat</button>'}` : ''}
        <button class="btn sm ghost" id="o-archive">${o.archived ? '↩ Obnovit z archivu' : '🗄 Archivovat'}</button></div>
    </div>
    ${STEP[st] != null ? `<div class="otimeline st-${st}">${['Objednat u dodavatele', 'AUF potvrzen', 'Ve svozu', st === 'issue' ? 'Reklamace' : 'Doručeno'].map((l, k) => { const i = STEP[st], done = k < i || st === 'delivered', now = k === i && st !== 'delivered'; return `<div class="ot ${done ? 'done' : now ? 'now' : ''} ${st === 'issue' && k === 3 ? 'bad' : ''}"><span class="ot-dot">${done ? '✓' : st === 'issue' && k === 3 ? '!' : k + 1}</span><span class="ot-l">${l}</span></div>`; }).join('<span class="ot-line"></span>')}</div>` : ''}

    <div class="card">
      <div class="card-head"><div><h2>Položky</h2><div class="sub">Zaškrtni, co objednáváš, a u koho. Dodavatel se u produktu zapamatuje pro příště.</div></div>
        <button class="btn sm" id="o-additem">＋ Přidat položku</button></div>
      ${!its.length ? `<div class="empty">${o.manual ? 'Zatím žádné položky — přidej je tlačítkem „＋ Přidat položku“.' : 'Objednávka nemá položky ke zboží.'}</div>` : `
      <div class="table-wrap"><table class="items">
        <thead><tr><th style="width:34px" title="Objednat">Obj.</th><th>Kód · MPN</th><th>Produkt</th><th class="num">Množství</th><th style="width:210px">Dodavatel</th>${delCol ? '<th style="width:36px"></th>' : ''}</tr></thead>
        <tbody>${its.map(i => {
          const p = prod(i.code), dec = effDec(i), a = i.aufId ? aufById(i.aufId) : null;
          return `<tr class="${dec === 'skip' ? 'done' : ''}">
            <td><input type="checkbox" data-dec="${esc(i.key)}" ${dec === 'order' ? 'checked' : ''} ${locked(i) ? 'disabled' : ''} title="${dec === 'skip' ? 'Neobjednává se' : 'Objednat'}"></td>
            <td>${genCode(i.code) ? '<span class="muted small">bez kódu</span>' : `<code>${esc(i.code)}</code>`}${p.mpn ? `<div class="sub">MPN ${esc(p.mpn)}</div>` : ''}</td>
            <td>${esc(i.name)}${i.variant ? ` <span class="variant">${esc(i.variant)}</span>` : ''}${itemEn(i) && itemEn(i) !== i.name ? `<div class="sub">${esc(itemEn(i))}</div>` : ''}${!i.active && !i.manual ? '<div class="sub" style="color:var(--warn)">už není v objednávce ve Shoptetu</div>' : ''}${i.manual && !o.manual ? '<div class="sub">přidáno ručně</div>' : ''}</td>
            <td class="num"><b>${fmtQty(i.qty)}</b> ${esc(i.unit)}</td>
            <td>${dec === 'skip' ? '<span class="muted small">neobjednává se</span>' : a
              ? `<span class="small">${flag(supplierById(a.supplierId)?.country)} ${esc(supName(a.supplierId))}</span><div class="sub">${a.aufNumber ? 'AUF ' + esc(a.aufNumber) : esc(AUF_STATE[a.status][0])}</div>`
              : `<select data-isup="${esc(i.key)}">${supOptions(effSup(i))}</select>${!effSup(i) && p.shoptetSupplier ? `<div class="sub">Shoptet: ${esc(p.shoptetSupplier)}</div>` : ''}`}</td>${delCol ? `<td>${i.manual && !i.aufId ? `<button class="icon-btn" data-delitem="${esc(i.key)}" title="Odebrat položku">🗑</button>` : ''}</td>` : ''}</tr>`;
        }).join('')}</tbody></table></div>`}
    </div>

    <div class="card">
      <div class="card-head"><div><h2>Objednávky u dodavatelů</h2><div class="sub">1 dodavatel = 1 e-mail = 1 AUF.</div></div></div>
      ${needSup ? `<div class="notice warn">${plural(needSup, 'položka nemá', 'položky nemají', 'položek nemá')} vybraného dodavatele — vyber ho, nebo odškrtni „Obj.“.</div>` : ''}
      ${[...groups.entries()].map(([sid, list]) => { const s = supplierById(sid) || {}; return `
        <div class="auf pending"><div class="auf-head"><span class="flag">${flag(s.country)}</span><div class="grow"><b>${esc(s.name || '?')}</b><div class="sub">${plural(list.length, 'položka', 'položky', 'položek')} k objednání${s.email ? ' · ' + esc(s.email) : ' · <span style="color:var(--bad)">chybí e-mail</span>'}</div></div>
          <button class="btn primary" data-mkauf="${sid}">✉ Připravit e-mail</button></div></div>`; }).join('')}
      ${aufs.map(a => renderAuf(a)).join('')}
      ${!groups.size && !aufs.length ? '<div class="small muted">Zatím nic — zaškrtni položky a vyber dodavatele.</div>' : ''}
    </div>

    <div class="card stack">
      <div><h2>Poznámky</h2></div>
      <textarea id="o-note" placeholder="Poznámky k objednávce…" style="min-height:110px">${esc(o.note)}</textarea>
      <div class="row" style="justify-content:flex-end"><span class="small muted grow" id="note-state"></span><button class="btn sm" id="o-note-save">Uložit poznámku</button></div>
    </div>`;
  bindOrderDetail(o);
  bindAufs();
}
function bindOrderDetail(o) {
  const V = $('#view');
  $('#o-archive').onclick = () => act(async () => ok(await sb.from('orders').update({ archived: !o.archived }).eq('code', o.code)), o.archived ? 'Obnoveno ✓' : 'Archivováno ✓');
  const saveNote = async () => {
    const v = $('#o-note').value; if (v === o.note) return;
    try { ok(await sb.from('orders').update({ note: v, updated_at: new Date().toISOString() }).eq('code', o.code)); o.note = v; $('#note-state').textContent = 'Uloženo ' + new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { toast('Chyba: ' + e.message); }
  };
  $('#o-note-save').onclick = saveNote;
  $('#o-note').onblur = saveNote;
  V.querySelectorAll('[data-dec]').forEach(cb => cb.onchange = () => act(async () => {
    ok(await sb.from('order_items').update({ decision: cb.checked ? 'order' : 'skip' }).eq('key', cb.dataset.dec));
  }));
  V.querySelectorAll('[data-isup]').forEach(sel => sel.onchange = () => {
    const it = S.items.find(i => i.key === sel.dataset.isup);
    if (sel.value === '__new') return editSupplier('', it.code, it.key);
    return act(async () => {
      ok(await sb.from('order_items').update({ supplier_id: sel.value || null, ...(sel.value ? { decision: 'order' } : {}) }).eq('key', it.key));
      // zapamatovat u produktu, pokud ještě dodavatele nemá
      if (sel.value && !prod(it.code).supplierId) ok(await sb.from('products').update({ supplier_id: sel.value, skip: false, updated_at: new Date().toISOString() }).eq('code', it.code));
    });
  });
  V.querySelectorAll('[data-mkauf]').forEach(b => b.onclick = () => createAuf(o.code, b.dataset.mkauf));
  $('#o-additem').onclick = () => addManualItems(o.code);
  V.querySelectorAll('[data-delitem]').forEach(b => b.onclick = () => {
    const it = S.items.find(i => i.key === b.dataset.delitem);
    if (!confirm(`Odebrat položku ${it.name || it.code}?`)) return;
    act(async () => ok(await sb.from('order_items').delete().eq('key', it.key)), 'Položka odebrána');
  });
  if (!o.manual) return;
  $('#o-edit').onclick = () => editManualOrder(o.code);
  if ($('#o-delete')) $('#o-delete').onclick = () => {
    if (!confirm(`Smazat ruční objednávku ${o.code} i s položkami a rozepsanými e-maily?`)) return;
    act(async () => {
      ok(await sb.from('order_items').delete().eq('order_code', o.code));
      ok(await sb.from('orders').delete().eq('code', o.code));
    }, 'Objednávka smazána').then(() => { if (!orderByCode(o.code)) location.hash = '#/objednavky'; });
  };
}

// --- ruční objednávka (mimo Shoptet)
const itemRow = (r = {}) => `<div class="mi-row">
  <input type="text" class="mi-code" placeholder="Náš kód" value="${esc(r.code || '')}">
  <input type="text" class="mi-mpn" placeholder="MPN / kód dodavatele" value="${esc(r.mpn || '')}">
  <input type="text" class="mi-name" placeholder="Název (CZ i EN) *" value="${esc(r.name || '')}">
  <input type="text" class="mi-variant" placeholder="Varianta / délka" value="${esc(r.variant || '')}">
  <input type="text" class="mi-qty" inputmode="decimal" placeholder="Ks" value="${esc(r.qty ?? '1')}">
  <input type="text" class="mi-unit" placeholder="Jedn." value="${esc(r.unit ?? 'ks')}">
  <button class="icon-btn mi-del" title="Odebrat řádek">✕</button></div>`;
function itemRowsHtml() {
  return `<div class="stack" style="gap:8px"><div class="mi-head small muted"><span>Náš kód</span><span>MPN / kód dodavatele</span><span>Název *</span><span>Varianta / délka</span><span>Množství</span><span>Jedn.</span><span></span></div>
    <div id="mi-rows">${itemRow()}</div>
    <div><button class="btn sm ghost" id="mi-add">＋ Další položka</button></div>
    <div class="small muted">Stačí název a množství. Stejné MPN můžeš mít klidně víckrát — rozliš je variantou (délka, barva…). Když vyplníš náš kód existujícího produktu, doplní se dodavatel, MPN i anglický název samy.</div></div>`;
}
function bindItemRows() {
  const root = $('#mi-rows');
  const wire = () => root.querySelectorAll('.mi-del').forEach(b => b.onclick = () => { b.closest('.mi-row').remove(); if (!root.children.length) { root.insertAdjacentHTML('beforeend', itemRow()); wire(); } });
  $('#mi-add').onclick = () => { root.insertAdjacentHTML('beforeend', itemRow()); wire(); root.lastElementChild.querySelector('.mi-code').focus(); };
  root.addEventListener('change', e => {
    if (!e.target.classList.contains('mi-code')) return;
    const row = e.target.closest('.mi-row'), p = S.products[e.target.value.trim()];
    if (p && !row.querySelector('.mi-name').value) row.querySelector('.mi-name').value = p.name || '';
  });
  wire();
}
function readItemRows() {
  const rows = [];
  for (const r of $('#mi-rows').querySelectorAll('.mi-row')) {
    const g = c => r.querySelector(c).value.trim();
    const code = g('.mi-code'), mpn = g('.mi-mpn'), name = g('.mi-name'), variant = g('.mi-variant'), qty = Number(g('.mi-qty').replace(',', '.')), unit = g('.mi-unit');
    if (!code && !mpn && !name) continue;
    if (!name && !(code && S.products[code])) throw new Error('Vyplň název u každé položky');
    if (!(qty > 0)) throw new Error('Množství musí být větší než 0');
    rows.push({ code, mpn, name: name || S.products[code].name, variant, qty, unit });
  }
  return rows;
}
async function saveManualItems(orderCode, rows, date, customer) {
  const now = new Date().toISOString();
  // stejný produkt může být v objednávce kolikrát chceš → klíč dostane pořadové číslo
  // (u objednávek ze Shoptetu vždy, aby se ruční řádek nepletl s řádkem ze Shoptetu)
  const taken = new Set(S.items.map(i => i.key));
  const shoptet = !orderByCode(orderCode)?.manual;
  const items = [], newProds = [], prodSeen = new Set();
  for (const r of rows) {
    let code = r.code || r.mpn;
    if (!code) code = 'M-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    let key = orderCode + '|' + code;
    for (let n = shoptet ? 1 : 2; shoptet || taken.has(key); n++) { key = `${orderCode}|${code}#${n}`; if (!taken.has(key)) break; }
    taken.add(key);
    if (!S.products[code] && !prodSeen.has(code) && prodSeen.add(code)) newProds.push({ code, name: r.name, supplier_code: r.mpn && r.mpn !== code ? r.mpn : '', updated_at: now });
    items.push({ key, order_code: orderCode, code, name: r.name, variant: r.variant || '', qty: r.qty, unit: r.unit, order_date: date || '', customer: customer || '', active: true, manual: true, decision: 'order', first_seen: now, last_seen: now });
  }
  if (newProds.length) ok(await sb.from('products').upsert(newProds, { onConflict: 'code', ignoreDuplicates: true }));
  if (items.length) ok(await sb.from('order_items').insert(items));
  // nové produkty → na pozadí doplnit anglický název (a MPN, pokud je produkt ve Shoptetu)
  if (newProds.length) sb.rpc('request_shoptet_sync', { task: 'orders' }).then(() => {}, () => {});
}
function suggestManualCode() {
  const d = new Date(), base = 'R-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  let n = 1; while (orderByCode(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
function editManualOrder(code) {
  const o = code ? orderByCode(code) : null;
  const today = new Date().toISOString().slice(0, 10);
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:760px">
    <div class="modal-head"><h2>${o ? 'Upravit ruční objednávku' : 'Ruční objednávka'}</h2><button class="icon-btn" data-close>✕</button></div>
    ${o ? '' : '<p class="muted small" style="margin-top:0">Pro objednávky, které nepřišly přes Shoptet — dál s ní pracuješ úplně stejně (e-mail, AUF, svoz).</p>'}
    <div class="stack">
      <div class="grid-2">
        <label class="field"><span>Číslo / reference objednávky *</span><input type="text" id="mo-code" value="${esc(o ? o.code : suggestManualCode())}" ${o ? 'disabled' : ''}></label>
        <label class="field"><span>Datum</span><input type="date" id="mo-date" value="${esc(o ? String(o.date).slice(0, 10) : today)}"></label>
      </div>
      <label class="field"><span>Zákazník / pro koho</span><input type="text" id="mo-customer" value="${esc(o ? o.customer : '')}" placeholder="např. jméno zákazníka, sklad, výstava…"></label>
      ${o ? '' : `<label class="field"><span>Poznámka</span><textarea id="mo-note" placeholder="Odkud objednávka přišla, reference…"></textarea></label>
      <div><h3 style="margin:6px 0 8px">Položky</h3>${itemRowsHtml()}</div>`}
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="mo-save">${o ? 'Uložit' : 'Vytvořit objednávku'}</button></div>
  </div></div>`;
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = () => { closeModal(); render(); });
  if (!o) { bindItemRows(); $('#mo-code').select(); }
  $('#mo-save').onclick = async () => {
    const date = $('#mo-date').value, customer = $('#mo-customer').value.trim();
    if (o) {
      closeModal();
      return act(async () => {
        ok(await sb.from('orders').update({ order_date: date, customer, updated_at: new Date().toISOString() }).eq('code', o.code));
        ok(await sb.from('order_items').update({ order_date: date, customer }).eq('order_code', o.code));
      }, 'Uloženo ✓');
    }
    const newCode = $('#mo-code').value.trim(), note = $('#mo-note').value.trim();
    let rows, exists = false;
    try {
      if (!newCode) throw new Error('Vyplň číslo / referenci objednávky');
      if (/[|/#?]/.test(newCode)) throw new Error('Číslo objednávky nesmí obsahovat znaky | / # ?');
      rows = readItemRows();
      const { data: ex } = await sb.from('orders').select('code,manual').eq('code', newCode).maybeSingle();
      exists = !!(ex || orderByCode(newCode));
    } catch (e) { return toast(e.message); }
    // objednávka s tímhle číslem už existuje → položky se přidají do ní
    if (exists && !confirm(`Objednávka ${newCode} už v SmartJoi je. Přidat položky do ní?`)) return;
    closeModal();
    if (exists) {
      const o = orderByCode(newCode) || {};
      await act(() => saveManualItems(newCode, rows, o.date || date, o.customer || customer), rows.length ? 'Položky přidány ✓' : '');
      location.hash = '#/objednavky/o/' + encodeURIComponent(newCode);
      return;
    }
    await act(async () => {
      ok(await sb.from('orders').insert({ code: newCode, order_date: date, customer, note, manual: true, active: true, shoptet_status: '' }));
      S.orders.push({ code: newCode, manual: true });
      try { await saveManualItems(newCode, rows, date, customer); }
      catch (e) { await sb.from('orders').delete().eq('code', newCode); throw e; } // nic nezůstane napůl
    }, 'Objednávka vytvořena ✓');
    if (orderByCode(newCode)) location.hash = '#/objednavky/o/' + encodeURIComponent(newCode);
  };
}
function addManualItems(code) {
  const o = orderByCode(code);
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:760px">
    <div class="modal-head"><h2>Přidat položky · ${esc(code)}</h2><button class="icon-btn" data-close>✕</button></div>
    ${itemRowsHtml()}
    <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="mi-save">Přidat</button></div>
  </div></div>`;
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  bindItemRows(); $('#mi-rows .mi-code').focus();
  $('#mi-save').onclick = async () => {
    let rows; try { rows = readItemRows(); if (!rows.length) throw new Error('Vyplň aspoň jednu položku'); } catch (e) { return toast(e.message); }
    closeModal();
    await act(() => saveManualItems(code, rows, o.date, o.customer), 'Položky přidány ✓');
  };
}

// ---------- AUF (objednávka u dodavatele) ----------
function renderAuf(a, { showOrder = false } = {}) {
  const s = supplierById(a.supplierId) || { name: '(smazaný dodavatel)' };
  const ship = a.shipmentId ? shipmentById(a.shipmentId) : null;
  const docs = ui.docs[a.id];
  const shipOpts = `<option value="">— bez svozu —</option>${S.shipments.filter(x => !x.deliveredAt || x.id === a.shipmentId).map(x => `<option value="${x.id}" ${a.shipmentId === x.id ? 'selected' : ''}>${x.ref ? esc(x.ref) + ' · ' : ''}${esc(fmtDay(x.date))}${x.note ? ' · ' + esc(x.note) : ''}</option>`).join('')}<option value="__new">＋ Nový svoz…</option>`;
  return `<div class="auf ${a.status} ${isIssue(a) ? 'dlv-issue' : a.deliveredAt ? 'dlv-ok' : ''}" data-aufcard="${a.id}">
    <div class="auf-head">
      <span class="flag">${flag(s.country)}</span>
      <div class="grow"><b>${esc(s.name)}</b>${showOrder ? ` · <a href="#/objednavky/o/${encodeURIComponent(a.orderCode)}">obj. ${esc(a.orderCode)}</a>` : ''}
        <div class="sub">${plural(a.lines.length, 'položka', 'položky', 'položek')}${a.sentAt ? ' · odesláno ' + fmtDate(a.sentAt, false) : ''}${ship ? ' · svoz ' + esc(fmtDay(ship.date)) : ''}</div></div>
      ${a.aufNumber ? `<div class="auf-no"><div class="sub">AUF</div><b>${esc(a.aufNumber)}</b></div>` : ''}
      ${a.amount != null ? `<div class="auf-no"><div class="sub">Částka</div><b>${eur(a.amount)}</b></div>` : ''}
      ${a.deliveredAt ? `<span class="badge ${DELIVERY[a.delivery]?.[1] || 'ok'}">${esc(DELIVERY[a.delivery]?.[0] || 'Doručeno')}</span>` : `<span class="badge ${AUF_STATE[a.status][1]}">${AUF_STATE[a.status][0]}</span>`}
    </div>
    <div class="auf-lines small muted">${a.lines.map(l => `${esc(l.code || l.name)}${l.variant ? ' (' + esc(l.variant) + ')' : ''} × ${fmtQty(l.qty)}`).join(' · ')}</div>
    ${a.status === 'draft' ? `<div class="row"><button class="btn primary sm" data-aufmail="${a.id}">✉ Otevřít e-mail</button><button class="btn sm ghost danger" data-aufdel="${a.id}">Zrušit</button></div>` : `
    <div class="auf-form">
      <label class="field"><span>AUF číslo (od dodavatele)</span><input type="text" data-aufno="${a.id}" value="${esc(a.aufNumber)}" placeholder="např. 4711234"></label>
      <label class="field"><span>Částka AUF (EUR)</span><input type="text" inputmode="decimal" data-aufamt="${a.id}" value="${a.amount != null ? String(a.amount).replace('.', ',') : ''}" placeholder="0,00"></label>
      ${a.status === 'confirmed' ? `<label class="field"><span>Svoz</span><select data-aufship="${a.id}">${shipOpts}</select></label>` : '<div></div>'}
      <div class="field"><span>&nbsp;</span><button class="btn ${a.status === 'sent' ? 'primary' : ''}" data-aufsave="${a.id}">${a.status === 'sent' ? '✓ Uložit AUF' : 'Uložit'}</button></div>
    </div>
    <div class="docs" data-docs="${a.id}">
      <div class="sub" style="margin-bottom:6px">Dokumenty</div>
      ${docs === undefined || docs === 'loading' ? '<div class="small muted">Načítám…</div>' : docs.length ? docs.map(d => `<div class="doc"><a href="#" data-dl="${esc(a.id + '/' + d.name)}">📄 ${esc(d.name.replace(/^\d+-/, ''))}</a><span class="sub">${fmtSize(d.metadata?.size || 0)}</span><button class="icon-btn" data-deldoc="${esc(a.id + '/' + d.name)}" title="Smazat">🗑</button></div>`).join('') : '<div class="small muted">Zatím žádné.</div>'}
      <label class="btn sm" style="margin-top:6px">＋ Přiložit dokument<input type="file" multiple data-upload="${a.id}" hidden></label>
    </div>
    ${a.status === 'confirmed' ? `<div class="dlv ${isIssue(a) ? 'issue' : a.deliveredAt ? 'ok' : ''}">
      <div class="sub" style="margin-bottom:6px">Dodání ${a.deliveredAt ? '· ' + esc(fmtDate(a.deliveredAt, false)) : ''}${a.resolvedAt && a.delivery === 'ok' && a.deliveryNote ? ' · problém vyřešen ' + esc(fmtDate(a.resolvedAt, false)) : ''}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <select data-dlvst="${a.id}" style="max-width:220px"><option value="">${a.deliveredAt ? '— vrátit na nedoručeno —' : '— zatím nedoručeno —'}</option>${Object.entries(DELIVERY).map(([k, [l]]) => `<option value="${k}" ${a.deliveredAt && a.delivery === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input type="text" class="grow" data-dlvnote="${a.id}" placeholder="Poznámka k dodání / reklamaci" value="${esc(a.deliveryNote)}" style="min-width:200px">
        <button class="btn sm" data-dlvsave="${a.id}">Uložit</button>
        ${isIssue(a) ? `<button class="btn sm primary" data-dlvres="${a.id}">✓ Vyřešeno</button>` : ''}
      </div></div>` : ''}
    <div class="row"><button class="btn sm ghost" data-aufmail="${a.id}">✉ E-mail</button>${a.status === 'sent' ? `<button class="btn sm ghost danger" data-aufdel="${a.id}">Zrušit objednávku</button>` : ''}</div>`}
  </div>`;
}
function bindAufs() {
  const V = $('#view');
  V.querySelectorAll('[data-aufmail]').forEach(b => b.onclick = () => openAufEmail(b.dataset.aufmail));
  V.querySelectorAll('[data-aufdel]').forEach(b => b.onclick = () => {
    if (!confirm('Zrušit? Položky se vrátí do „potřeba objednat“.')) return;
    const id = b.dataset.aufdel;
    act(async () => { ok(await sb.from('order_items').update({ auf_id: null }).eq('auf_id', id)); ok(await sb.from('aufs').delete().eq('id', id)); }, 'Zrušeno');
  });
  V.querySelectorAll('[data-aufsave]').forEach(b => b.onclick = () => {
    const id = b.dataset.aufsave, a = aufById(id);
    const no = V.querySelector(`[data-aufno="${id}"]`).value.trim();
    const amtRaw = V.querySelector(`[data-aufamt="${id}"]`).value.trim();
    const amount = amtRaw ? parseEur(amtRaw) : null;
    if (amtRaw && amount == null) return toast('Částka není číslo');
    const row = { auf_number: no, amount_eur: amount, updated_at: new Date().toISOString() };
    if (no && a.status === 'sent') Object.assign(row, { status: 'confirmed', confirmed_at: new Date().toISOString() });
    if (!no && a.status === 'confirmed') Object.assign(row, { status: 'sent', confirmed_at: null, shipment_id: null });
    act(async () => { ok(await sb.from('aufs').update(row).eq('id', id)); if (a.shipmentId) await syncShipmentEvent(a.shipmentId); },
      no && a.status === 'sent' ? 'AUF potvrzen ✓' : 'Uloženo ✓');
  });
  V.querySelectorAll('[data-aufship]').forEach(sel => sel.onchange = () => {
    const id = sel.dataset.aufship, a = aufById(id);
    if (sel.value === '__new') return editShipment('', id);
    act(async () => {
      ok(await sb.from('aufs').update({ shipment_id: sel.value || null, updated_at: new Date().toISOString() }).eq('id', id));
      if (a.shipmentId) await syncShipmentEvent(a.shipmentId);
      if (sel.value) await syncShipmentEvent(sel.value);
    }, sel.value ? 'Přidáno do svozu ✓' : 'Odebráno ze svozu');
  });
  V.querySelectorAll('[data-dlvsave]').forEach(b => b.onclick = () => {
    const id = b.dataset.dlvsave, a = aufById(id), st = V.querySelector(`[data-dlvst="${id}"]`).value, note = V.querySelector(`[data-dlvnote="${id}"]`).value.trim();
    const row = st ? { delivered_at: a.deliveredAt || new Date().toISOString(), delivery_status: st, delivery_note: note, issue_resolved_at: st === 'ok' && isIssue(a) ? new Date().toISOString() : st === 'ok' ? a.resolvedAt : null }
      : { delivered_at: null, delivery_status: '', delivery_note: note, issue_resolved_at: null };
    act(async () => ok(await sb.from('aufs').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id)), st && st !== 'ok' ? 'Uloženo — označeno jako problém ⚠' : 'Uloženo ✓');
  });
  V.querySelectorAll('[data-dlvres]').forEach(b => b.onclick = () => {
    const id = b.dataset.dlvres, note = V.querySelector(`[data-dlvnote="${id}"]`)?.value.trim() ?? aufById(id).deliveryNote;
    act(async () => ok(await sb.from('aufs').update({ delivery_status: 'ok', delivery_note: note, issue_resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)), 'Vyřešeno ✓');
  });
  V.querySelectorAll('[data-upload]').forEach(inp => inp.onchange = async () => {
    const id = inp.dataset.upload;
    for (const f of inp.files) {
      const safe = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_');
      const { error } = await sb.storage.from('auf-docs').upload(`${id}/${Date.now()}-${safe}`, f, { contentType: f.type || undefined });
      if (error) { toast('Chyba nahrávání: ' + error.message); break; }
    }
    toast('Nahráno ✓'); await loadDocs(id);
  });
  V.querySelectorAll('[data-dl]').forEach(a => a.onclick = async e => {
    e.preventDefault();
    const w = window.open('', '_blank');
    const { data, error } = await sb.storage.from('auf-docs').createSignedUrl(a.dataset.dl, 600);
    if (error) { w?.close(); return toast('Chyba: ' + error.message); }
    if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
  });
  V.querySelectorAll('[data-deldoc]').forEach(b => b.onclick = async () => {
    if (!confirm('Smazat dokument?')) return;
    const { error } = await sb.storage.from('auf-docs').remove([b.dataset.deldoc]);
    if (error) return toast('Chyba: ' + error.message);
    await loadDocs(b.dataset.deldoc.split('/')[0]);
  });
  // dokumenty načti na pozadí
  V.querySelectorAll('[data-docs]').forEach(el => { const id = el.dataset.docs; if (ui.docs[id] === undefined) loadDocs(id); });
}
async function loadDocs(id) {
  ui.docs[id] = 'loading';
  const { data, error } = await sb.storage.from('auf-docs').list(id, { sortBy: { column: 'name', order: 'asc' } });
  ui.docs[id] = error ? [] : (data || []).filter(d => d.name && !d.name.startsWith('.'));
  const card = document.querySelector(`[data-aufcard="${id}"]`);
  const a = aufById(id);
  if (card && a) { card.outerHTML = renderAuf(a, { showOrder: route().tab !== 'o' }); bindAufs(); }
}

// e-mail pro 1 objednávku × 1 dodavatele
function buildEmail(order, sid, items, includeRefs) {
  const s = supplierById(sid) || {};
  const st = S.settings;
  const date = new Date().toLocaleDateString('en-GB');
  const fill = t => String(t || '').replaceAll('{company}', st.companyName || '').replaceAll('{date}', date)
    .replaceAll('{supplier}', s.name || '').replaceAll('{orders}', order.code).replaceAll('{order}', order.code);
  const mpnCount = {}; for (const i of items) { const c = supCode(i.code); mpnCount[c] = (mpnCount[c] || 0) + 1; }
  const lines = items.map((i, n) => {
    const code = supCode(i.code), nm = itemEn(i);
    const head = genCode(code) ? '' : `${code}${mpnCount[code] > 1 && code !== i.code ? ` (${i.code})` : ''}`;
    let l = `${n + 1}. ${[head, nm, i.variant].filter(Boolean).join(' – ')} – ${fmtQtyEn(i.qty)} ${unitEn(i.unit)}`;
    if (includeRefs) l += `  (ref.: ${order.code})`;
    return l;
  });
  const body = [
    s.contact ? `Dear ${s.contact},` : 'Dear Sir or Madam,', '',
    `we would like to place the following order${s.customerNo ? ` (customer no. ${s.customerNo})` : ''}:`, '',
    ...lines, '',
    'Please confirm the order and let us know the expected delivery date.',
    ...(st.extraNote ? ['', fill(st.extraNote)] : []),
    '', 'Thank you in advance.', '', st.signature || '',
  ].join('\n');
  return {
    to: s.email || '', subject: fill(st.subjectTemplate || 'Purchase order {orders} – {company}'), body,
    lines: items.map(i => ({ code: genCode(supCode(i.code)) ? '' : supCode(i.code), ourCode: i.code, name: itemEn(i) || i.name, variant: i.variant || '', qty: i.qty, unit: i.unit, key: i.key })),
  };
}
async function createAuf(orderCode, sid) {
  const o = orderByCode(orderCode);
  const items = orderItems(orderCode).filter(i => !i.aufId && effDec(i) === 'order' && effSup(i) === sid);
  if (!items.length) return;
  const mail = buildEmail(o, sid, items, false);
  const id = await act(async () => {
    const a = ok(await sb.from('aufs').insert({ order_code: orderCode, supplier_id: sid, status: 'draft', email_to: mail.to, subject: mail.subject, body: mail.body, lines: mail.lines }).select().single());
    ok(await sb.from('order_items').update({ auf_id: a.id, supplier_id: sid, decision: 'order' }).in('key', items.map(i => i.key)));
    return a.id;
  });
  if (id) openAufEmail(id);
}
function openAufEmail(id) {
  const a = aufById(id); if (!a) return;
  const s = supplierById(a.supplierId) || {};
  const draft = a.status === 'draft';
  const auto = a.lines.filter(l => !prod(l.ourCode).supplierName && prod(l.ourCode).nameEn).length;
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal">
    <div class="modal-head"><h2>✉ ${esc(a.orderCode)} · ${flag(s.country)} ${esc(s.name || '')}</h2><button class="icon-btn" data-close>✕</button></div>
    ${!a.to ? `<div class="notice warn">Dodavatel nemá vyplněný e-mail. Doplň ho v záložce Dodavatelé.</div>` : ''}
    ${draft && auto ? `<div class="notice">Názvy jsou přeložené automaticky — před odesláním je rychle projeď. Trvalou opravu uděláš přes ✎ u produktu.</div>` : ''}
    <div class="stack">
      <label class="field"><span>Komu</span><div class="copy-box"><input type="text" id="m-to" value="${esc(a.to)}"><button class="btn sm" data-mcopy="m-to">Kopírovat</button></div></label>
      <label class="field"><span>Předmět</span><div class="copy-box"><input type="text" id="m-subject" value="${esc(a.subject)}"><button class="btn sm" data-mcopy="m-subject">Kopírovat</button></div></label>
      <label class="field"><span>Text e-mailu</span><div class="copy-box"><textarea id="m-body" class="mail-body">${esc(a.body)}</textarea><button class="btn sm" data-mcopy="m-body">Kopírovat</button></div></label>
      ${draft ? `<div class="row"><button class="btn sm ghost" id="m-regen">↻ Vytvořit text znovu (po úpravě produktů / šablony)</button></div>` : ''}
    </div>
    <div class="modal-foot">
      <button class="btn ghost" data-close>${draft ? 'Uložit a zavřít' : 'Zavřít'}</button>
      <a class="btn ${draft ? '' : 'primary'}" id="m-mail" href="#">✉ Otevřít v Outlooku</a>
      ${draft ? `<button class="btn primary" id="m-sent">✓ Odesláno — čekám na AUF</button>` : ''}
    </div></div></div>`;
  const root = $('#modal-root');
  const texts = () => ({ email_to: $('#m-to').value, subject: $('#m-subject').value, body: $('#m-body').value, updated_at: new Date().toISOString() });
  const close = async () => {
    if (draft) { const t = texts(); if (t.email_to !== a.to || t.subject !== a.subject || t.body !== a.body) await act(async () => ok(await sb.from('aufs').update(t).eq('id', id))); }
    closeModal();
  };
  root.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  root.querySelector('.modal-back').onclick = e => { if (e.target.classList.contains('modal-back')) close(); };
  root.querySelectorAll('[data-mcopy]').forEach(b => b.onclick = e => { e.preventDefault(); copyText($('#' + b.dataset.mcopy).value); });
  // otevře e-mail ve výchozím poštovním programu (Outlook) s vyplněnou adresou, předmětem i textem
  $('#m-mail').onclick = () => {
    const t = texts();
    if (!t.email_to.trim()) toast('Chybí e-mail dodavatele — doplň ho do pole Komu');
    $('#m-mail').href = mailtoLink({ to: t.email_to.trim(), cc: '', subject: t.subject, body: t.body });
    if (draft) {
      if (t.email_to !== a.to || t.subject !== a.subject || t.body !== a.body) { sb.from('aufs').update(t).eq('id', id).then(() => { Object.assign(a, { to: t.email_to, subject: t.subject, body: t.body }); }, () => {}); }
      setTimeout(() => { toast('Po odeslání v Outlooku klikni na „✓ Odesláno“'); $('#m-sent')?.classList.add('pulse'); }, 400);
    }
  };
  if (draft) {
    $('#m-regen').onclick = () => {
      const items = a.lines.map(l => S.items.find(i => i.key === l.key)).filter(Boolean);
      const m = buildEmail(orderByCode(a.orderCode), a.supplierId, items, false);
      $('#m-to').value = m.to; $('#m-subject').value = m.subject; $('#m-body').value = m.body; toast('Text vytvořen znovu');
    };
    $('#m-sent').onclick = async () => {
      const t = texts(); closeModal();
      await act(async () => ok(await sb.from('aufs').update({ ...t, status: 'sent', sent_at: new Date().toISOString() }).eq('id', id)), 'Označeno jako odeslané ✓ — čekáme na AUF');
    };
  }
}

// --- tab: AUFy
function tabAufs() {
  const F = { sent: ['Čeká na AUF', a => a.status === 'sent'], unshipped: ['Potvrzené bez svozu', a => a.status === 'confirmed' && !a.shipmentId && !a.deliveredAt], issues: ['Reklamace', a => isIssue(a)], confirmed: ['Všechny potvrzené', a => a.status === 'confirmed'], all: ['Vše', () => true] };
  const f = F[ui.aufFilter] ? ui.aufFilter : 'sent';
  const list = S.aufs.filter(F[f][1]);
  const conf = S.aufs.filter(a => a.status === 'confirmed');
  let h = `<div class="stats">
    <div class="stat"><div class="v">${S.aufs.filter(a => a.status === 'sent').length}</div><div class="l">čeká na AUF</div></div>
    <div class="stat"><div class="v">${conf.filter(a => !a.shipmentId && !a.deliveredAt).length}</div><div class="l">potvrzené bez svozu</div></div>
    <div class="stat"><div class="v eur">${eur(sumEur(conf.filter(a => !a.shipmentId && !a.deliveredAt)))}</div><div class="l">hodnota bez svozu</div></div>
    <div class="stat"><div class="v">${S.aufs.filter(a => a.status === 'draft').length}</div><div class="l">neodeslané koncepty</div></div>
  </div>
  <div class="chips" style="margin-bottom:12px">${Object.entries(F).map(([k, [l, fn]]) => `<button class="chip ${k === f ? 'on' : ''}" data-afilter="${k}">${l} <span class="muted">${S.aufs.filter(fn).length}</span></button>`).join('')}</div>`;
  if (!list.length) return h + `<div class="card empty">Nic tu není.</div>`;
  return h + `<div class="card">${list.map(a => renderAuf(a, { showOrder: true })).join('')}</div>`;
}

// --- tab: Svozy
function tabShipments() {
  const unassigned = S.aufs.filter(a => a.status === 'confirmed' && !a.shipmentId && !a.deliveredAt);
  const open = S.shipments.filter(s => !s.deliveredAt).sort((x, y) => String(x.date || '9').localeCompare(String(y.date || '9')));
  const delivered = S.shipments.filter(s => s.deliveredAt).sort((x, y) => String(y.deliveredAt).localeCompare(String(x.deliveredAt)));
  const shipCard = (s, idx) => {
    const list = aufsInShipment(s.id), details = shipmentDetails(s);
    const due = !s.deliveredAt && s.date && s.date <= todayIso();
    const issues = list.filter(isIssue);
    return `<div class="card ship ${s.deliveredAt ? 'delivered' : due ? 'due' : ''}" style="--i:${idx}">
      <div class="card-head">
        <div><h2 style="margin:0">${s.deliveredAt ? '📦' : '🚚'} ${s.ref ? `<span class="ship-ref">${esc(s.ref)}</span> ` : ''}${esc(fmtDay(s.date))}</h2>
          <div class="sub">${s.deliveredAt ? `doručeno ${esc(fmtDate(s.deliveredAt, false))}${issues.length ? ` · <span style="color:var(--bad)">⚠ ${plural(issues.length, 'problém', 'problémy', 'problémů')}</span>` : ' · vše v pořádku'}` : s.date ? relDay(s.date) : 'bez data'}${s.note ? ' · ' + esc(s.note) : ''}</div></div>
        <div class="row">
          <div class="auf-no"><div class="sub">AUFů</div><b>${list.length}</b></div>
          <div class="auf-no"><div class="sub">Celkem</div><b>${eur(sumEur(list))}</b></div>
        </div>
      </div>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>AUF</th><th>Dodavatel</th><th class="hide-m">Objednávka</th><th class="num">Částka</th><th>${s.deliveredAt ? 'Stav' : ''}</th></tr></thead><tbody>
        ${list.map(a => `<tr><td><b>${esc(a.aufNumber)}</b></td><td>${flag(supplierById(a.supplierId)?.country)} ${esc(supName(a.supplierId))}</td>
          <td class="hide-m"><a href="#/objednavky/o/${encodeURIComponent(a.orderCode)}">${esc(a.orderCode)}</a></td><td class="num">${eur(a.amount)}</td>
          <td>${a.deliveredAt ? `<span class="badge ${DELIVERY[a.delivery]?.[1] || 'ok'}" title="${esc(a.deliveryNote)}">${esc(DELIVERY[a.delivery]?.[0] || 'Doručeno')}</span>${a.deliveryNote ? `<div class="sub">${esc(a.deliveryNote)}</div>` : ''}` : `<button class="icon-btn" data-unship="${a.id}" title="Odebrat ze svozu">✕</button>`}</td></tr>`).join('')}
        <tr class="total"><td colspan="3" class="hide-m"><b>Celkem</b></td><td class="num"><b>${eur(sumEur(list))}</b></td><td></td></tr>
      </tbody></table></div>` : '<div class="small muted">Zatím žádný AUF.</div>'}
      <div class="row" style="margin-top:12px;flex-wrap:wrap">
        ${!s.deliveredAt && unassigned.length ? `<select data-addauf="${s.id}" style="max-width:320px"><option value="">＋ Přidat AUF…</option>${unassigned.map(a => `<option value="${a.id}">AUF ${esc(a.aufNumber)} · ${esc(supName(a.supplierId))} · ${eur(a.amount)}</option>`).join('')}</select>` : ''}
        <span class="grow"></span>
        ${list.length ? `<button class="btn sm ${due ? 'primary' : ''}" data-deliver="${s.id}">${s.deliveredAt ? '✎ Stav doručení' : '✓ Svoz doručen'}</button>` : ''}
        ${!s.deliveredAt && list.length ? `<button class="btn sm ghost" data-shipmsg="${s.id}">💬 Zpráva pro sklad</button>` : ''}
        ${!s.deliveredAt && s.date ? `<a class="btn sm ghost" target="_blank" rel="noopener" href="${esc(gcalLink({ title: details.title, date: s.date, details: details.text }))}">📅 Google</a>` : ''}
        <button class="icon-btn" data-editship="${s.id}" title="Upravit">✎</button>${s.deliveredAt ? '' : `<button class="icon-btn" data-delship="${s.id}" title="Smazat svoz">🗑</button>`}
      </div>
    </div>`;
  };
  return `
    <div class="row" style="margin-bottom:14px"><button class="btn primary" data-editship="">＋ Nový svoz</button><span class="small muted">Termíny svozů se propisují do kalendáře SmartJoi. Po příjezdu klikni na „✓ Svoz doručen“ — objednávky se přesunou mezi vyřízené.</span></div>
    ${unassigned.length ? `<div class="card">
      <div class="card-head"><div><h2 style="margin:0">AUFy bez svozu</h2><div class="sub">Potvrzené objednávky u dodavatelů, které ještě nejsou naplánované.</div></div>
        <div class="auf-no"><div class="sub">${plural(unassigned.length, 'AUF', 'AUFy', 'AUFů')}</div><b>${eur(sumEur(unassigned))}</b></div></div>
      <div class="table-wrap"><table><tbody>${unassigned.map(a => `<tr><td><b>${esc(a.aufNumber)}</b></td><td>${flag(supplierById(a.supplierId)?.country)} ${esc(supName(a.supplierId))}</td>
        <td class="hide-m"><a href="#/objednavky/o/${encodeURIComponent(a.orderCode)}">${esc(a.orderCode)}</a></td><td class="num">${eur(a.amount)}</td>
        <td style="width:200px"><select data-aufship="${a.id}"><option value="">— do svozu —</option>${open.map(x => `<option value="${x.id}">${x.ref ? esc(x.ref) + ' · ' : ''}${esc(fmtDay(x.date))}</option>`).join('')}<option value="__new">＋ Nový svoz…</option></select></td></tr>`).join('')}</tbody></table></div>
    </div>` : ''}
    <div class="ogroup-h" style="margin-top:4px"><span>🚚 Na cestě</span><span class="muted">${open.length}</span></div>
    ${open.map(shipCard).join('') || '<div class="card empty fadein"><div class="big">🛣</div>Žádný svoz na cestě.</div>'}
    ${delivered.length ? `<div class="ogroup-h" style="margin-top:18px"><span>📦 Doručené svozy</span><span class="muted">${delivered.length}</span></div>
      <div class="card olist-card"><div class="olist">${(ui.showPast ? delivered : delivered.slice(0, 6)).map((x, k) => { const L = aufsInShipment(x.id), iss = L.filter(isIssue); ui.shipOpen ||= {};
        return `<div class="orow shrow ${iss.length ? 'st-issue' : 'st-delivered'}" style="--i:${k}" data-shipx="${x.id}"><div class="grow"><b>📦 ${x.ref ? esc(x.ref) + ' · ' : ''}${esc(fmtDay(x.date))}</b>
          <div class="sub">doručeno ${esc(fmtDate(x.deliveredAt, false))} · ${plural(L.length, 'AUF', 'AUFy', 'AUFů')} · ${eur(sumEur(L))}</div>
          ${iss.length ? `<div class="oissue">⚠ ${iss.map(a => `AUF ${esc(a.aufNumber)}: ${esc(DELIVERY[a.delivery][0])}${a.deliveryNote ? ' – ' + esc(a.deliveryNote) : ''}`).join(' · ')}</div>` : ''}</div>
          <span class="badge ${iss.length ? 'bad' : 'ok'}">${iss.length ? plural(iss.length, 'problém', 'problémy', 'problémů') : '✓ v pořádku'}</span><span class="chev" style="${ui.shipOpen[x.id] ? 'transform:rotate(90deg)' : ''}">›</span></div>
          ${ui.shipOpen[x.id] ? `<div class="ship-exp">${shipCard(x, 0)}</div>` : ''}`; }).join('')}</div></div>
      ${delivered.length > 6 ? `<div class="row" style="margin:6px 0 12px"><button class="btn sm ghost" data-togglepast>${ui.showPast ? 'Zobrazit méně' : `Zobrazit všechny doručené (${delivered.length})`}</button></div>` : ''}` : ''}`;
}
// převzetí svozu: stav každého AUFu (v pořádku / reklamace / chybí / poškozené / jiný problém) + poznámka
function deliverShipment(id) {
  const s = shipmentById(id), list = aufsInShipment(id);
  const day = s.deliveredAt ? String(s.deliveredAt).slice(0, 10) : todayIso();
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:720px">
    <div class="modal-head"><h2>📦 Převzetí svozu ${s.ref ? esc(s.ref) : ''}</h2><button class="icon-btn" data-close>✕</button></div>
    <label class="field" style="max-width:220px"><span>Datum doručení</span><input type="date" id="dv-date" value="${esc(day)}"></label>
    <div class="small muted" style="margin:10px 0 6px">U každého AUFu vyber stav. Co je v pořádku, nech jak je — problémy (reklamace…) zůstanou v přehledu objednávek, dokud je neoznačíš jako vyřešené.</div>
    <div class="dv-list">${list.map(a => `<div class="dv-row" data-dvrow="${a.id}">
      <div class="dv-what"><b>AUF ${esc(a.aufNumber)}</b><div class="sub">${flag(supplierById(a.supplierId)?.country)} ${esc(supName(a.supplierId))} · obj. ${esc(a.orderCode)}</div></div>
      <div class="chips dv-st">${Object.entries(DELIVERY).map(([k, [l, cls, ic]]) => `<button type="button" class="chip ${(a.delivery || 'ok') === k ? 'on' : ''} ${cls}" data-dvst="${k}">${ic} ${l}</button>`).join('')}</div>
      <input type="text" class="dv-note" placeholder="Poznámka (např. 2 prkna poškozená, chybí 1 balení…)" value="${esc(a.deliveryNote)}">
    </div>`).join('')}</div>
    <div class="modal-foot">${s.deliveredAt ? '<button class="btn ghost danger" id="dv-undo">Zrušit doručení</button>' : ''}<span class="grow"></span><button class="btn ghost" data-close>Zavřít</button><button class="btn primary" id="dv-save">✓ Uložit doručení</button></div>
  </div></div>`;
  const root = $('#modal-root');
  root.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  root.querySelectorAll('.dv-st').forEach(g => g.querySelectorAll('[data-dvst]').forEach(b => b.onclick = () => { g.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); b.classList.add('on'); }));
  $('#dv-save').onclick = () => {
    const when = new Date(($('#dv-date').value || todayIso()) + 'T12:00:00').toISOString();
    const rows = [...root.querySelectorAll('[data-dvrow]')].map(r => ({ id: r.dataset.dvrow, st: r.querySelector('.dv-st .on')?.dataset.dvst || 'ok', note: r.querySelector('.dv-note').value.trim() }));
    closeModal();
    act(async () => {
      ok(await sb.from('shipments').update({ delivered_at: when }).eq('id', id));
      for (const x of rows) { const a = aufById(x.id); ok(await sb.from('aufs').update({ delivered_at: a.deliveredAt || when, delivery_status: x.st, delivery_note: x.note, issue_resolved_at: x.st === 'ok' && isIssue(a) ? new Date().toISOString() : (x.st === 'ok' ? a.resolvedAt : null), updated_at: new Date().toISOString() }).eq('id', x.id)); }
    }, rows.some(x => x.st !== 'ok') ? 'Uloženo — problémy jsou v přehledu ⚠' : 'Svoz doručen ✓');
  };
  if ($('#dv-undo')) $('#dv-undo').onclick = () => { if (!confirm('Vrátit svoz mezi nedoručené?')) return; closeModal(); act(async () => {
    ok(await sb.from('shipments').update({ delivered_at: null }).eq('id', id));
    ok(await sb.from('aufs').update({ delivered_at: null, delivery_status: '', issue_resolved_at: null }).eq('shipment_id', id));
  }, 'Doručení zrušeno'); };
}
function shipmentDetails(s) {
  const list = aufsInShipment(s.id);
  const title = `Svoz${s.ref ? ' ' + s.ref : ''} · ${plural(list.length, 'AUF', 'AUFy', 'AUFů')} · ${eur(sumEur(list))}`;
  const text = list.map(a => `AUF ${a.aufNumber} – ${supName(a.supplierId)} – obj. ${a.orderCode} – ${eur(a.amount)}`).join('\n')
    + (list.length ? `\nCelkem: ${eur(sumEur(list))}` : '') + (s.note ? `\n\n${s.note}` : '');
  return { title, text };
}
// zapíše / aktualizuje termín svozu ve společném kalendáři SmartJoi
async function syncShipmentEvent(id) {
  const { data: s } = await sb.from('shipments').select('*').eq('id', id).maybeSingle();
  if (!s) return SJCalendar.remove('shipment:' + id);
  const { data: list } = await sb.from('aufs').select('*').eq('shipment_id', id);
  const ls = (list || []).map(a => ({ aufNumber: a.auf_number, supplierId: a.supplier_id, orderCode: a.order_code, amount: a.amount_eur == null ? null : Number(a.amount_eur) }));
  const title = `Svoz${s.reference ? ' ' + s.reference : ''} · ${plural(ls.length, 'AUF', 'AUFy', 'AUFů')} · ${eur(sumEur(ls))}`;
  const text = ls.map(a => `AUF ${a.aufNumber} – ${supName(a.supplierId)} – obj. ${a.orderCode} – ${eur(a.amount)}`).join('\n') + (ls.length ? `\nCelkem: ${eur(sumEur(ls))}` : '') + (s.note ? `\n\n${s.note}` : '');
  await SJCalendar.upsert({ app: 'objednavky', ref: 'shipment:' + id, title, date: s.ship_date, details: text, url: location.origin + location.pathname + '#/objednavky/svozy' });
}
// další volné interní číslo svozu: SV-2026-001, SV-2026-002…
function nextShipRef() {
  const y = new Date().getFullYear(), re = new RegExp(`^SV-${y}-(\\d+)$`, 'i');
  const max = S.shipments.reduce((m, x) => { const r = re.exec(x.ref || ''); return r ? Math.max(m, +r[1]) : m; }, 0);
  return `SV-${y}-${String(max + 1).padStart(3, '0')}`;
}
// zpráva pro vedoucího skladu (WhatsApp / Slack): AUF – objednávka – zákazník
function warehouseMessage(s, o) {
  const list = aufsInShipment(s.id).slice().sort((a, b) => String(a.aufNumber).localeCompare(String(b.aufNumber)));
  const head = `Svoz${s.ref ? ' ' + s.ref : ''}${s.date ? ' · ' + fmtDay(s.date) : ''}`;
  const lines = list.map(a => {
    const ord = orderByCode(a.orderCode) || {};
    return [a.aufNumber || '(bez AUF)', a.orderCode, o.customer && ord.customer, o.supplier && supName(a.supplierId), o.amount && a.amount != null && eur(a.amount)].filter(Boolean).join(' – ');
  });
  const out = [];
  if (o.intro) out.push(o.intro, '');
  out.push(head, ...lines, '', `Celkem: ${plural(list.length, 'AUF', 'AUFy', 'AUFů')}${o.amount ? ' · ' + eur(sumEur(list)) : ''}`);
  if (o.note && s.note) out.push(`Pozn.: ${s.note}`);
  return out.join('\n');
}
function openWarehouseMsg(id) {
  const s = shipmentById(id);
  const o = { customer: true, supplier: false, amount: false, note: true, intro: 'Dobrý den, posílám Vám AUFy do svozu:', phone: '', ...S.settings.warehouseMsg };
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:600px">
    <div class="modal-head"><h2>💬 Zpráva pro sklad</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="stack">
      <div class="chips">
        ${[['customer', 'Jméno zákazníka'], ['supplier', 'Dodavatel'], ['amount', 'Částka'], ['note', 'Poznámka svozu']].map(([k, l]) => `<label class="chip ${o[k] ? 'on' : ''}"><input type="checkbox" data-wmo="${k}" ${o[k] ? 'checked' : ''} hidden>${l}</label>`).join('')}
      </div>
      <label class="field"><span>Úvodní věta</span><input type="text" id="wm-intro" value="${esc(o.intro)}"></label>
      <label class="field"><span>Zpráva (můžeš upravit)</span><textarea id="wm-text" style="min-height:220px;font-family:inherit"></textarea></label>
      <label class="field"><span>WhatsApp číslo vedoucího (volitelné — pak se otevře rovnou jeho chat)</span><input type="tel" id="wm-phone" value="${esc(o.phone)}" placeholder="+420 …"></label>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Zavřít</button><a class="btn" id="wm-wa" target="_blank" rel="noopener">WhatsApp</a><button class="btn primary" id="wm-copy">Kopírovat (Slack)</button></div>
  </div></div>`;
  const read = () => { const x = { ...o, intro: $('#wm-intro').value.trim(), phone: $('#wm-phone').value.trim() }; document.querySelectorAll('[data-wmo]').forEach(c => x[c.dataset.wmo] = c.checked); return x; };
  const waHref = () => { const ph = $('#wm-phone').value.replace(/[^\d]/g, ''); return `https://wa.me/${ph}?text=${encodeURIComponent($('#wm-text').value)}`; };
  const regen = () => { $('#wm-text').value = warehouseMessage(s, read()); $('#wm-wa').href = waHref(); };
  const save = () => { const x = read(); S.settings.warehouseMsg = x; sb.from('settings').update({ warehouse_msg: x }).eq('id', 1).then(() => {}, () => {}); };
  document.querySelectorAll('[data-wmo]').forEach(c => c.onchange = () => { c.closest('.chip').classList.toggle('on', c.checked); regen(); });
  $('#wm-intro').oninput = regen;
  $('#wm-phone').oninput = () => { $('#wm-wa').href = waHref(); };
  $('#wm-text').oninput = () => { $('#wm-wa').href = waHref(); };
  $('#wm-copy').onclick = () => { copyText($('#wm-text').value); save(); };
  $('#wm-wa').addEventListener('click', save);
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  regen();
}
function editShipment(id, thenAufId) {
  const s = shipmentById(id) || { id: '', date: '', note: '', ref: nextShipRef() };
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:460px">
    <div class="modal-head"><h2>${s.id ? 'Upravit svoz' : 'Nový svoz'}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="stack">
      <label class="field"><span>Interní číslo svozu</span><input type="text" id="sh-ref" value="${esc(s.ref)}" placeholder="např. SV-2026-001"></label>
      <label class="field"><span>Datum svozu</span><input type="date" id="sh-date" value="${esc(s.date)}"></label>
      <label class="field"><span>Poznámka (volitelné)</span><input type="text" id="sh-note" value="${esc(s.note)}" placeholder="např. kamion z Bayreuthu"></label>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="sh-save">Uložit</button></div>
  </div></div>`;
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = () => { closeModal(); render(); });
  $('#sh-save').onclick = async () => {
    const row = { ship_date: $('#sh-date').value || null, note: $('#sh-note').value.trim(), reference: $('#sh-ref').value.trim() };
    if (row.reference && S.shipments.some(x => x.id !== s.id && x.ref.toLowerCase() === row.reference.toLowerCase())) return toast(`Svoz ${row.reference} už existuje`);
    closeModal();
    await act(async () => {
      const saved = s.id ? ok(await sb.from('shipments').update(row).eq('id', s.id).select().single()) : ok(await sb.from('shipments').insert(row).select().single());
      if (thenAufId) ok(await sb.from('aufs').update({ shipment_id: saved.id }).eq('id', thenAufId));
      await syncShipmentEvent(saved.id);
    }, 'Svoz uložen ✓');
  };
}

// --- tab: Produkty
function supplierSelect(code, cur) {
  return `<select data-assign="${esc(code)}">
    <option value="" ${!cur ? 'selected' : ''}>— vyber dodavatele —</option>
    ${S.suppliers.map(s => `<option value="${s.id}" ${cur === s.id ? 'selected' : ''}>${flag(s.country)} ${esc(s.name)}</option>`).join('')}
    <option value="none" ${cur === 'none' ? 'selected' : ''}>✕ Neobjednávat (skladem / CZ)</option>
    <option value="__new">＋ Nový dodavatel…</option>
  </select>`;
}
function tabProducts() {
  const q = ui.search.trim().toLowerCase();
  const all = Object.entries(S.products).sort((a, b) => a[0].localeCompare(b[0], 'cs'));
  const list = all.filter(([code, p]) => !q || (code + ' ' + (p.name || '') + ' ' + (p.supplierCode || '') + ' ' + (p.supplierName || '') + ' ' + (p.mpn || '') + ' ' + (p.nameEn || '')).toLowerCase().includes(q));
  return `<div class="card">
    <div class="card-head"><div><h2>Produkty</h2><div class="sub">Výchozí dodavatel produktu a údaje do e-mailu. MPN se načítá ze Shoptetu, anglický název se překládá automaticky — obojí můžeš přes ✎ přepsat.</div></div>
      <input type="search" id="prod-search" placeholder="Hledat kód, MPN nebo název…" value="${esc(ui.search)}" style="max-width:280px"></div>
    ${!all.length ? '<div class="empty">Produkty se tu objeví automaticky, jakmile přijdou v objednávkách.</div>' : `
    <div class="table-wrap"><table><thead><tr><th>Náš kód / název</th><th style="width:220px">Výchozí dodavatel</th><th class="hide-m">MPN / kód do e-mailu</th><th class="hide-m">Název EN</th><th></th></tr></thead><tbody>
    ${list.slice(0, 400).map(([code, p]) => `<tr>
      <td><code>${esc(code)}</code><div class="sub">${esc(p.name)}</div></td>
      <td>${supplierSelect(code, p.supplierId || '')}${p.shoptetSupplier ? `<div class="sub" style="margin-top:4px">Shoptet: ${esc(p.shoptetSupplier)}</div>` : ''}</td>
      <td class="hide-m small">${supCode(code) !== code ? `<code>${esc(supCode(code))}</code>` : '<span class="muted">—</span>'}</td>
      <td class="hide-m small">${enName(code) ? esc(enName(code)) : '<span class="muted">—</span>'}</td>
      <td><button class="icon-btn" data-editprod="${esc(code)}">✎</button></td></tr>`).join('')}
    </tbody></table></div>${list.length > 400 ? `<p class="small muted">Zobrazeno 400 z ${list.length} — upřesni hledání.</p>` : ''}`}
  </div>`;
}

// --- tab: Dodavatelé
function tabSuppliers() {
  const used = id => Object.values(S.products).filter(p => p.supplierId === id).length;
  return `<div class="card">
    <div class="card-head"><div><h2>Dodavatelé</h2><div class="sub">Když se dodavatel jmenuje stejně jako ve Shoptetu, produkty se mu přiřadí samy.</div></div>
      <button class="btn primary" data-editsup="">＋ Přidat dodavatele</button></div>
    ${!S.suppliers.length ? `<div class="empty"><div class="big">🌍</div>Zatím žádný dodavatel.</div>` : `
    <div class="table-wrap"><table><thead><tr><th>Dodavatel</th><th class="hide-m">E-mail</th><th class="hide-m">Kontakt</th><th class="num">Produktů</th><th class="num">AUFů</th><th></th></tr></thead><tbody>
    ${S.suppliers.map(s => `<tr>
      <td><span class="flag">${flag(s.country)}</span> <b>${esc(s.name)}</b><div class="sub">${esc(countryName(s.country))}${s.customerNo ? ' · zák. č. ' + esc(s.customerNo) : ''}</div></td>
      <td class="hide-m small">${esc(s.email) || '<span class="muted">—</span>'}</td>
      <td class="hide-m small">${esc(s.contact) || '<span class="muted">—</span>'}</td>
      <td class="num">${used(s.id)}</td><td class="num">${S.aufs.filter(a => a.supplierId === s.id).length}</td>
      <td style="white-space:nowrap"><button class="icon-btn" data-editsup="${s.id}">✎</button><button class="icon-btn" data-delsup="${s.id}" title="Smazat">🗑</button></td></tr>`).join('')}
    </tbody></table></div>`}
  </div>`;
}

// --- tab: Nastavení
function tabSettings() {
  const st = S.settings, sync = S.sync, m = st.mapping || {};
  const statuses = Object.entries(sync.statuses || {}).sort((a, b) => b[1] - a[1]);
  const hOpts = cur => `<option value="">— nepoužívat —</option>` + sync.headers.map(h => `<option ${h === cur ? 'selected' : ''}>${esc(h)}</option>`).join('');
  return `
  <div class="card stack">
    <div><h2>Napojení na Shoptet</h2><div class="sub">Aplikace stahuje exporty sama každých 15 minut.</div></div>
    <label class="field"><span>Odkaz na CSV export objednávek</span><input type="url" id="s-csvUrl" value="${esc(st.csvUrl)}"></label>
    <label class="field"><span>Odkaz na export produktů — MPN a dodavatel (XML productsComplete nebo CSV)</span><input type="url" id="s-productsCsvUrl" value="${esc(st.productsCsvUrl)}"></label>
    ${(() => { const i = st.productsSyncInfo || {}; if (!st.productsCsvUrl || !i.at) return '';
      return i.error ? `<div class="small" style="color:var(--bad)">Export produktů: ${esc(i.error)}</div>`
        : `<div class="small muted">Export produktů: ${fmtDate(i.at)} · ${i.rows} produktů/variant · MPN z <code>${esc(i.mpnCol)}</code> · změněno ${i.updated} · automaticky přiřazeno ${i.assigned || 0}</div>`; })()}
    <label class="field"><span>Stav objednávky, který znamená „objednat“</span>
      <input type="text" id="s-statusValue" list="statuses" value="${esc(st.statusValue)}">
      <datalist id="statuses">${statuses.map(([v]) => `<option value="${esc(v)}">`).join('')}</datalist></label>
    <div class="small muted">Poslední načtení: ${sync.fetchedAt ? fmtDate(sync.fetchedAt) + ` · ${sync.rowCount} řádků` : 'zatím ne'}${sync.error ? ` · <span style="color:var(--bad)">${esc(sync.error)}</span>` : ''}</div>
  </div>
  <div class="card stack">
    <div><h2>Sloupce v CSV</h2><div class="sub">Rozpoznané automaticky — pokud něco nesedí, oprav to tady.</div></div>
    ${sync.headers.length ? `<div class="grid-3">${Object.entries(MAP_LABELS).map(([k, l]) => `<label class="field"><span>${l}</span><select data-map="${k}">${hOpts(m[k])}</select></label>`).join('')}</div>`
    : '<div class="muted small">Sloupce se zobrazí po prvním úspěšném načtení CSV.</div>'}
  </div>
  <div class="card stack">
    <div><h2>E-mail pro dodavatele</h2><div class="sub">Šablona (anglicky). V předmětu i doplňující větě můžeš použít {orders} (číslo objednávky), {company}, {date}, {supplier}.</div></div>
    <div class="grid-2">
      <label class="field"><span>Název firmy</span><input type="text" id="s-companyName" value="${esc(st.companyName)}"></label>
      <label class="field"><span>Předmět</span><input type="text" id="s-subjectTemplate" value="${esc(st.subjectTemplate)}"></label>
    </div>
    <label class="field"><span>Doplňující věta (volitelné, EN)</span><textarea id="s-extraNote" placeholder="e.g. Our order reference: {orders}">${esc(st.extraNote)}</textarea></label>
    <label class="field"><span>Podpis</span><textarea id="s-signature">${esc(st.signature)}</textarea></label>
    <label class="field"><span>Klíč DeepL API (volitelné — lepší překlad názvů)</span>
      <input type="text" id="s-deeplKey" autocomplete="off" spellcheck="false" value="${esc(st.deeplKey)}"></label>
    ${(() => { const t = st.translateInfo || {}; if (!t.at) return '';
      return t.error ? `<div class="small" style="color:var(--bad)">Překlad (${esc(t.provider)}): ${esc(t.error)} · ${fmtDate(t.at)}</div>`
        : `<div class="small muted">Poslední překlad: ${esc(t.provider === 'deepl' ? 'DeepL' : 'MyMemory')} · ${t.done} názvů · ${fmtDate(t.at)}</div>`; })()}
  </div>
  <div class="row" style="justify-content:flex-end"><button class="btn primary" id="save-settings">Uložit nastavení</button></div>`;
}

// ---------- modaly: dodavatel, produkt ----------
function closeModal() { $('#modal-root').innerHTML = ''; }
function editSupplier(id, thenAssignCode, thenItemKey) {
  const s = supplierById(id) || { id: '', name: (thenAssignCode && prod(thenAssignCode).shoptetSupplier) || '', country: 'DE', email: '', contact: '', customerNo: '', notes: '' };
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal">
    <div class="modal-head"><h2>${s.id ? 'Upravit dodavatele' : 'Nový dodavatel'}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="stack">
      <div class="grid-2">
        <label class="field"><span>Název firmy *</span><input type="text" id="f-name" value="${esc(s.name)}"></label>
        <label class="field"><span>Země</span><select id="f-country">${COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === s.country ? 'selected' : ''}>${flag(c)} ${n}</option>`).join('')}</select></label>
        <label class="field"><span>E-mail pro objednávky</span><input type="email" id="f-email" value="${esc(s.email)}"></label>
        <label class="field"><span>Kontaktní osoba (oslovení v e-mailu)</span><input type="text" id="f-contact" placeholder="např. Mr Schmidt" value="${esc(s.contact)}"></label>
        <label class="field"><span>Naše zákaznické číslo u nich</span><input type="text" id="f-customerNo" value="${esc(s.customerNo)}"></label>
      </div>
      <label class="field"><span>Poznámka (interní)</span><textarea id="f-notes">${esc(s.notes)}</textarea></label>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="f-save">Uložit</button></div>
  </div></div>`;
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = () => { closeModal(); render(); });
  $('#f-name').focus();
  $('#f-save').onclick = async () => {
    const d = {}; for (const k of ['name', 'country', 'email', 'contact', 'customerNo', 'notes']) d[k] = $('#f-' + k).value.trim();
    if (!d.name) return toast('Vyplň název');
    const row = { name: d.name, country: d.country, email: d.email, contact: d.contact, customer_no: d.customerNo, notes: d.notes };
    closeModal();
    await act(async () => {
      const saved = s.id ? ok(await sb.from('suppliers').update(row).eq('id', s.id).select().single()) : ok(await sb.from('suppliers').insert(row).select().single());
      if (thenAssignCode) ok(await sb.from('products').update({ supplier_id: saved.id, skip: false }).eq('code', thenAssignCode));
      if (thenItemKey) ok(await sb.from('order_items').update({ supplier_id: saved.id, decision: 'order' }).eq('key', thenItemKey));
      // produkty bez dodavatele se stejným dodavatelem ve Shoptetu → přiřadit
      const { data: rows } = await sb.from('products').update({ supplier_id: saved.id }).is('supplier_id', null).eq('skip', false).ilike('shoptet_supplier', d.name).select('code');
      if (rows?.length) setTimeout(() => toast(`Přiřazeno ${rows.length} produktů podle Shoptetu ✓`), 2100);
    }, 'Dodavatel uložen ✓');
  };
}
function editProduct(code) {
  const p = prod(code);
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal">
    <div class="modal-head"><h2>Produkt <code>${esc(code)}</code></h2><button class="icon-btn" data-close>✕</button></div>
    <p class="muted small" style="margin-top:0">${esc(p.name)}</p>
    <div class="stack">
      <label class="field"><span>Výchozí dodavatel</span>${supplierSelect(code, p.supplierId || '').replace('<option value="__new">＋ Nový dodavatel…</option>', '')}</label>
      <div class="small muted">MPN ze Shoptetu: ${p.mpn ? `<code>${esc(p.mpn)}</code>` : '—'}</div>
      <label class="field"><span>Kód do e-mailu (prázdné = MPN, jinak náš kód)</span><input type="text" id="p-supplierCode" placeholder="${esc(p.mpn || code)}" value="${esc(p.supplierCode)}"></label>
      <label class="field"><span>Název pro dodavatele (anglicky)</span><input type="text" id="p-supplierName" placeholder="${esc(p.nameEn || 'Anglický název')}" value="${esc(p.supplierName || p.nameEn)}"></label>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="p-save">Uložit</button></div>
  </div></div>`;
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  $('#p-save').onclick = async () => {
    const sup = $('#modal-root select').value;
    const row = { skip: sup === 'none', supplier_id: sup && sup !== 'none' ? sup : null, supplier_code: $('#p-supplierCode').value.trim(),
      supplier_name: (v => v === (p.nameEn || '') ? '' : v)($('#p-supplierName').value.trim()), updated_at: new Date().toISOString() };
    closeModal();
    await act(async () => ok(await sb.from('products').update(row).eq('code', code)), 'Uloženo ✓');
  };
}

// ---------- bindings (záložky) ----------
// čísla v dlaždicích naběhnou od nuly (jen poprvé po otevření)
function animateCounts(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || ui._counted) return;
  ui._counted = true;
  root.querySelectorAll('[data-count]').forEach(el => { const n = +el.dataset.count; if (!n) return; const t0 = performance.now(), d = 600;
    const step = t => { const k = Math.min(1, (t - t0) / d); el.textContent = Math.round(n * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); }; el.textContent = '0'; requestAnimationFrame(step); });
}
function bind() {
  const V = $('#view');
  V.querySelectorAll('[data-ofilter]').forEach(b => b.onclick = () => { ui.orderFilter = b.dataset.ofilter; ui.orderSearch = ''; ui.orderState = ''; render(); });
  V.querySelectorAll('[data-ostate]').forEach(b => b.onclick = e => { e.preventDefault(); const k = b.dataset.ostate; if (k === 'delivered') { ui.orderFilter = 'done'; ui.orderState = ''; } else { ui.orderFilter = 'active'; ui.orderState = ui.orderState === k ? '' : k; } ui.orderSearch = ''; render(); });
  V.querySelectorAll('[data-deliver]').forEach(b => b.onclick = e => { e.preventDefault(); deliverShipment(b.dataset.deliver); });
  V.querySelectorAll('[data-shipx]').forEach(r => r.onclick = () => { ui.shipOpen ||= {}; ui.shipOpen[r.dataset.shipx] = !ui.shipOpen[r.dataset.shipx]; render(); });
  animateCounts(V);
  const os = $('#o-search');
  if (os) os.oninput = () => { ui.orderSearch = os.value; const pos = os.selectionStart; render(); const n = $('#o-search'); n.focus(); n.setSelectionRange(pos, pos); };
  V.querySelectorAll('[data-neworder]').forEach(b => b.onclick = () => editManualOrder(''));
  V.querySelectorAll('[data-afilter]').forEach(b => b.onclick = () => { ui.aufFilter = b.dataset.afilter; render(); });
  V.querySelectorAll('[data-togglepast]').forEach(b => b.onclick = () => { ui.showPast = !ui.showPast; render(); });
  V.querySelectorAll('select[data-assign]').forEach(sel => sel.onchange = () => {
    const code = sel.dataset.assign;
    if (sel.value === '__new') return editSupplier('', code);
    act(async () => ok(await sb.from('products').update({ skip: sel.value === 'none', supplier_id: sel.value && sel.value !== 'none' ? sel.value : null, updated_at: new Date().toISOString() }).eq('code', code)), 'Uloženo ✓');
  });
  V.querySelectorAll('[data-editprod]').forEach(b => b.onclick = () => editProduct(b.dataset.editprod));
  V.querySelectorAll('[data-editsup]').forEach(b => b.onclick = () => editSupplier(b.dataset.editsup));
  V.querySelectorAll('[data-delsup]').forEach(b => b.onclick = () => {
    const s = supplierById(b.dataset.delsup);
    if (!confirm(`Smazat dodavatele ${s.name}? Jeho produkty budou bez dodavatele.`)) return;
    act(async () => ok(await sb.from('suppliers').delete().eq('id', s.id)), 'Smazáno');
  });
  V.querySelectorAll('[data-editship]').forEach(b => b.onclick = () => editShipment(b.dataset.editship));
  V.querySelectorAll('[data-shipmsg]').forEach(b => b.onclick = () => openWarehouseMsg(b.dataset.shipmsg));
  V.querySelectorAll('[data-delship]').forEach(b => b.onclick = () => {
    if (!confirm('Smazat svoz? AUFy v něm se vrátí mezi „bez svozu“.')) return;
    const id = b.dataset.delship;
    act(async () => { ok(await sb.from('aufs').update({ shipment_id: null }).eq('shipment_id', id)); ok(await sb.from('shipments').delete().eq('id', id)); await SJCalendar.remove('shipment:' + id); }, 'Svoz smazán');
  });
  V.querySelectorAll('[data-addauf]').forEach(sel => sel.onchange = () => {
    if (!sel.value) return;
    const sid = sel.dataset.addauf;
    act(async () => { ok(await sb.from('aufs').update({ shipment_id: sid }).eq('id', sel.value)); await syncShipmentEvent(sid); }, 'Přidáno do svozu ✓');
  });
  V.querySelectorAll('[data-unship]').forEach(b => b.onclick = () => {
    const a = aufById(b.dataset.unship);
    act(async () => { ok(await sb.from('aufs').update({ shipment_id: null }).eq('id', a.id)); await syncShipmentEvent(a.shipmentId); }, 'Odebráno ze svozu');
  });
  bindAufs();
  const ps = $('#prod-search');
  if (ps) ps.oninput = () => { ui.search = ps.value; const pos = ps.selectionStart; render(); const n = $('#prod-search'); n.focus(); n.setSelectionRange(pos, pos); };
  const ss = $('#save-settings');
  if (ss) ss.onclick = () => {
    const mp = { ...S.settings.mapping };
    V.querySelectorAll('[data-map]').forEach(sel => mp[sel.dataset.map] = sel.value);
    const g = k => $('#s-' + k).value;
    ss.disabled = true; ss.textContent = 'Ukládám…';
    act(async () => {
      ok(await sb.from('settings').update({ csv_url: g('csvUrl'), products_csv_url: g('productsCsvUrl'), deepl_api_key: g('deeplKey').trim(), status_value: g('statusValue'), mapping: mp,
        company_name: g('companyName'), subject_template: g('subjectTemplate'), extra_note: g('extraNote'), signature: g('signature'), last_sync_at: null }).eq('id', 1));
      await requestSync();
    }, 'Nastavení uloženo ✓');
  };
}

// ---------- login ----------
function renderLogin(msg = '', email = '') {
  $('#crumb').innerHTML = ''; $('#user').innerHTML = '';
  $('#view').innerHTML = `
    <section class="hero" style="max-width:420px;margin:0 auto">
      <img src="logo.png" alt="" width="84" height="84" style="display:block;margin-bottom:18px">
      <div class="eyebrow">Jointshon — FJ · interní nástroje</div>
      <h1>Přihlášení</h1>
      <p>SmartJoi je jen pro tebe. Přihlas se účtem ze Supabase.</p>
      <form id="login" class="card stack" style="margin-top:20px">
        <label class="field"><span>E-mail</span><input type="email" id="l-email" autocomplete="username" required value="${esc(email)}"></label>
        <label class="field"><span>Heslo</span><input type="password" id="l-pass" autocomplete="current-password" required></label>
        ${msg ? `<div class="notice bad">${esc(msg)}</div>` : ''}
        <button class="btn primary" style="width:100%">Přihlásit</button>
      </form>
    </section>`;
  $('#login').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Přihlašuji…';
    const em = $('#l-email').value.trim();
    const { error } = await sb.auth.signInWithPassword({ email: em, password: $('#l-pass').value });
    if (error) { renderLogin(error.message === 'Invalid login credentials' ? 'Špatný e-mail nebo heslo.' : error.message, em); $('#l-pass').focus(); }
  };
}
function renderUser(session) {
  $('#user').innerHTML = `<button class="btn sm ghost" id="logout" title="${esc(session.user.email)}">Odhlásit</button>`;
  $('#logout').onclick = () => sb.auth.signOut();
}

// ---------- světlý / tmavý režim ----------
const THEMES = ['auto', 'light', 'dark'];
const ICON = p => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const THEME_UI = {
  auto: [ICON('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>'), 'Motiv: podle systému'],
  light: [ICON('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'), 'Motiv: světlý'],
  dark: [ICON('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'), 'Motiv: tmavý'],
};
function getTheme() { try { return localStorage.getItem('sj-theme') || 'auto'; } catch { return 'auto'; } }
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0a0a' : '#f4f4f2');
  const b = $('#theme'); if (b) { b.innerHTML = THEME_UI[t][0]; b.title = THEME_UI[t][1] + ' (klikni pro změnu)'; }
}
$('#theme').onclick = () => {
  const t = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
  try { localStorage.setItem('sj-theme', t); } catch {}
  applyTheme(t); toast(THEME_UI[t][1]);
};
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(getTheme()));
applyTheme(getTheme());

// ---------- AI asistent (Gemini, Edge Function „assistant“) ----------
const chat = { open: false, busy: false, contents: [], log: [], pending: null };
try { const x = JSON.parse(sessionStorage.getItem('sj-chat') || 'null'); if (x) Object.assign(chat, { contents: x.contents || [], log: x.log || [], pending: x.pending || null }); } catch {}
const chatSave = () => { try { sessionStorage.setItem('sj-chat', JSON.stringify({ contents: chat.contents.slice(-40), log: chat.log.slice(-60), pending: chat.pending })); } catch {} };
// jednoduché formátování odpovědi: **tučně**, odkazy, zalomení
const chatFmt = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
function chatRender() {
  let root = $('#chat-root');
  if (!root) { root = document.createElement('div'); root.id = 'chat-root'; document.body.appendChild(root); }
  if (!session) { root.innerHTML = ''; return; }
  if (!chat.open) { root.innerHTML = `<button class="chat-fab" id="chat-fab" title="SmartJoiAI">✦<span>SmartJoiAI</span></button>`; $('#chat-fab').onclick = () => { chat.open = true; chatRender(); $('#chat-in')?.focus(); }; return; }
  root.innerHTML = `<div class="chat-panel" role="dialog" aria-label="AI asistent">
    <div class="chat-head"><b>✦ SmartJoiAI</b><span class="small muted grow">OrderJoi · StockJoi · EmailJoi · DocházkoBot</span>
      <button class="icon-btn" id="chat-new" title="Nový rozhovor">⟲</button><button class="icon-btn" id="chat-close" title="Zavřít">✕</button></div>
    <div class="chat-log" id="chat-log">
      ${!chat.log.length ? `<div class="chat-hello"><b>Ahoj, s čím pomůžu?</b><div class="small muted">Třeba:</div>
        ${['Co je potřeba objednat?', 'Které AUFy čekají na potvrzení?', 'Založ ruční objednávku…', 'Připrav zprávu pro sklad k nejbližšímu svozu'].map(q => `<button class="chip" data-chatq="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : ''}
      ${chat.log.map(m => `<div class="msg ${m.role}">${m.role === 'bot' ? chatFmt(m.text) : m.role === 'err' ? '⚠ ' + esc(m.text) : m.role === 'act' ? esc(m.text) : esc(m.text).replace(/\n/g, '<br>')}${m.role === 'bot' && m.text.length > 60 ? `<button class="msg-copy" data-chatcopy="${chat.log.indexOf(m)}" title="Kopírovat">⧉</button>` : ''}</div>`).join('')}
      ${chat.pending ? `<div class="msg pending"><div class="small muted" style="margin-bottom:6px">SmartJoiAI chce provést:</div>${chat.pending.map(p => `<div class="pend">• ${esc(p.summary)}</div>`).join('')}
        <div class="row" style="margin-top:10px;gap:8px"><button class="btn sm primary" id="chat-ok" ${chat.busy ? 'disabled' : ''}>✓ Provést</button><button class="btn sm ghost" id="chat-no" ${chat.busy ? 'disabled' : ''}>Zrušit</button></div></div>` : ''}
      ${chat.busy ? '<div class="msg bot typing"><span></span><span></span><span></span></div>' : ''}
    </div>
    <form class="chat-form" id="chat-form"><textarea id="chat-in" rows="1" placeholder="${chat.pending ? 'Nejdřív potvrď nebo zruš akci výše' : 'Napiš, co mám udělat…'}" ${chat.busy || chat.pending ? 'disabled' : ''}></textarea><button class="btn primary" ${chat.busy || chat.pending ? 'disabled' : ''}>↑</button></form>
  </div>`;
  const log = $('#chat-log'); log.scrollTop = log.scrollHeight;
  $('#chat-close').onclick = () => { chat.open = false; chatRender(); };
  $('#chat-new').onclick = () => { if (chat.busy) return; Object.assign(chat, { contents: [], log: [], pending: null }); chatSave(); chatRender(); $('#chat-in')?.focus(); };
  root.querySelectorAll('[data-chatq]').forEach(b => b.onclick = () => { const q = b.dataset.chatq; if (q.endsWith('…')) { $('#chat-in').value = q.replace('…', ' '); $('#chat-in').focus(); } else chatSend({ message: q }); });
  root.querySelectorAll('[data-chatcopy]').forEach(b => b.onclick = () => copyText(chat.log[+b.dataset.chatcopy].text));
  const inp = $('#chat-in');
  const grow = () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 140) + 'px'; };
  inp.oninput = grow;
  inp.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chat-form').requestSubmit(); } };
  $('#chat-form').onsubmit = e => { e.preventDefault(); const t = inp.value.trim(); if (t) chatSend({ message: t }); };
  if ($('#chat-ok')) { $('#chat-ok').onclick = () => chatSend({ decision: 'approve' }); $('#chat-no').onclick = () => chatSend({ decision: 'reject' }); }
}
// co má uživatel právě otevřené (aby SmartJoiAI věděl, o čem je řeč)
function chatContext() {
  const r = route();
  if (r.app === 'dochazka') { const e = r.tab ? S?.att.employees.find(x => x.id === r.tab) : null; return `DocházkoBot, měsíc ${ui.attMonth || prevMonth()}${e ? `, zaměstnanec ${e.name}` : ', přehled všech zaměstnanců'}`; }
  if (r.app === 'objednavky') return r.tab === 'o' ? `OrderJoi, detail objednávky ${r.id}` : `OrderJoi, záložka ${r.tab || 'objednávky'}`;
  if (r.app === 'sklad') return r.tab === 'p' ? `StockJoi, položka ${S?.stock.items.find(i => i.id === r.id)?.name || ''}` : 'StockJoi';
  if (r.app === 'emaily') return 'EmailJoi';
  return 'úvodní stránka SmartJoi';
}
async function chatSend(payload) {
  if (chat.busy) return;
  if (payload.message) chat.log.push({ role: 'user', text: payload.message });
  if (payload.decision) chat.log.push({ role: 'act', text: (payload.decision === 'approve' ? '✓ Provést: ' : '✕ Zrušeno: ') + chat.pending.map(p => p.summary).join('; ') });
  const prevPending = chat.pending;
  chat.pending = null; chat.busy = true; chatRender();
  try {
    const { data: { session: s } } = await sb.auth.getSession();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/assistant`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (s?.access_token || '') },
      body: JSON.stringify({ contents: chat.contents, context: chatContext(), ...payload }) });
    const j = await r.json().catch(() => ({ error: 'Neplatná odpověď serveru (HTTP ' + r.status + ')' }));
    if (j.error) throw new Error(j.error);
    chat.contents = j.contents || chat.contents;
    if (j.reply) chat.log.push({ role: 'bot', text: j.reply });
    chat.pending = j.pending || null;
    if (j.changed) { await loadState().catch(() => {}); if (!$('#modal-root').innerHTML) render(); }
  } catch (e) {
    chat.log.push({ role: 'err', text: e.message });
    if (payload.decision) chat.pending = prevPending; // schválení se nepovedlo → nech ho k dispozici znovu
  } finally { chat.busy = false; chatSave(); chatRender(); if (!chat.pending) $('#chat-in')?.focus(); }
}

// ---------- start ----------
let session = null;
window.addEventListener('hashchange', () => { if (!session) return; closeModal(); render(); window.scrollTo(0, 0); });
async function load() { try { await loadState(); } catch (e) { toast('Chyba: ' + e.message); } render(); }
sb.auth.onAuthStateChange((_ev, s) => {
  const was = session; session = s;
  if (!s) { S = null; try { sessionStorage.removeItem('sj-chat'); } catch {} Object.assign(chat, { open: false, contents: [], log: [], pending: null }); chatRender(); return renderLogin(); }
  renderUser(s); if (!was) chatRender();
  if (!was) setTimeout(() => { render(); load(); }, 0);
});
// obnova dat každou minutu (ne když zrovna něco vyplňuješ)
setInterval(() => {
  if (!session || busy || document.hidden || $('#modal-root').innerHTML) return;
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
  if (route().tab === 'nastaveni') return;
  load();
}, 60e3);
document.addEventListener('visibilitychange', () => { if (session && !document.hidden && !$('#modal-root').innerHTML && !busy) load(); });
