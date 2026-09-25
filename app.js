/* SmartJoi — frontend (GitHub Pages + Supabase) */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
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
  itemAmount: 'Množství', itemUnit: 'Jednotka', itemType: 'Typ položky (doprava/platba se přeskočí)', date: 'Datum', customer: 'Zákazník',
};
const TABS = [
  ['objednavky', 'Objednávky'], ['aufy', 'AUFy'], ['svozy', 'Svozy'],
  ['produkty', 'Produkty'], ['dodavatele', 'Dodavatelé'], ['nastaveni', 'Nastavení'],
];
// stav objednávky v SmartJoi (od ruky ze Shoptetu až po svoz)
const STATE = {
  todo:      ['Potřeba objednat', 'warn', 1],
  waiting:   ['Čeká na AUF', 'info', 2],
  confirmed: ['AUF potvrzen · bez svozu', 'ok', 3],
  shipping:  ['Ve svozu', 'ok', 4],
  none:      ['Nic k objednání', '', 5],
  empty:     ['Bez položek', '', 6],
};
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
  const [st, sups, prods, orders, items, aufs, ships, events, emails, stock] = await Promise.all([
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
  ]);
  const products = {};
  for (const p of prods) products[p.code] = { supplierId: p.skip ? 'none' : (p.supplier_id || ''), supplierCode: p.supplier_code, supplierName: p.supplier_name, name: p.name, nameEn: p.name_en || '', nameEnSrc: p.name_en_src || '', mpn: p.mpn || '', shoptetSupplier: p.shoptet_supplier || '' };
  S = {
    settings: { csvUrl: st.csv_url, statusValue: st.status_value, mapping: st.mapping || {}, companyName: st.company_name, subjectTemplate: st.subject_template, extraNote: st.extra_note, signature: st.signature, productsCsvUrl: st.products_csv_url || '', productsSyncInfo: st.products_sync_info || {}, deeplKey: st.deepl_api_key || '', translateInfo: st.translate_info || {}, calendarToken: st.calendar_token || '' },
    suppliers: sups.map(s => ({ id: s.id, name: s.name, country: s.country, email: s.email, contact: s.contact, customerNo: s.customer_no, notes: s.notes })),
    products,
    orders: orders.map(o => ({ code: o.code, date: o.order_date, customer: o.customer, shoptetStatus: o.shoptet_status, active: o.active, note: o.note || '', archived: o.archived, manual: !!o.manual })),
    items: items.map(i => ({ key: i.key, orderCode: i.order_code, code: i.code, name: i.name, qty: Number(i.qty), unit: i.unit, active: i.active, decision: i.decision, supplierId: i.supplier_id || '', aufId: i.auf_id || '', manual: !!i.manual, variant: i.variant || '' })),
    aufs: aufs.map(a => ({ id: a.id, orderCode: a.order_code, supplierId: a.supplier_id || '', status: a.status, to: a.email_to, subject: a.subject, body: a.body, lines: a.lines || [], sentAt: a.sent_at, aufNumber: a.auf_number || '', amount: a.amount_eur == null ? null : Number(a.amount_eur), confirmedAt: a.confirmed_at, note: a.note || '', shipmentId: a.shipment_id || '', createdAt: a.created_at })),
    shipments: ships.map(s => ({ id: s.id, date: s.ship_date || '', note: s.note || '' })),
    events,
    stock,
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
  if (open.some(i => effDec(i) === 'order') || aufs.some(a => a.status === 'draft')) return 'todo';
  if (aufs.some(a => a.status === 'sent')) return 'waiting';
  if (aufs.some(a => a.status === 'confirmed' && !a.shipmentId)) return 'confirmed';
  if (aufs.some(a => a.status === 'confirmed')) return 'shipping';
  return 'none';
}
function counts() {
  const act = S.orders.filter(o => !o.archived);
  const st = act.map(o => orderState(o.code));
  return {
    todo: st.filter(x => x === 'todo').length, waiting: st.filter(x => x === 'waiting').length,
    unshipped: S.aufs.filter(a => a.status === 'confirmed' && !a.shipmentId).length,
    shipping: S.shipments.filter(s => s.date >= todayIso()).length,
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
          ${c.todo ? `<span class="badge warn"><span class="dot"></span>${c.todo} potřeba objednat</span>` : ''}
          ${c.sentAufs ? `<span class="badge info">${c.sentAufs} čeká na AUF</span>` : ''}
          ${c.unshipped ? `<span class="badge ok">${c.unshipped} AUF bez svozu</span>` : ''}
          ${!c.todo && !c.sentAufs && !c.unshipped ? `<span class="badge ok"><span class="dot"></span>Vše vyřízeno</span>` : ''}
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
  if (!whs.length) return `<div class="card empty"><div class="big">🏬</div><b>Nejdřív si založ sklad.</b><div class="small">Třeba „Hlavní sklad“, „Prodejna“, „Externí sklad“… Skladů můžeš mít kolik chceš.</div><div style="margin-top:14px"><button class="btn primary" data-editwh="">＋ Nový sklad</button></div></div>`;
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
      <span class="grow"></span><button class="btn sm primary" data-edititem="">＋ Nová položka</button>
    </div>
    ${!S.stock.items.filter(i => !i.archived).length ? `<div class="card empty"><div class="big">📦</div><b>Zatím žádné skladové položky.</b><div class="small">Založ je tlačítkem „＋ Nová položka“, nebo rovnou přes „↓ Naskladnit“ — nové položky se při naskladnění založí samy.</div></div>`
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
  const tabCount = { objednavky: c.todo, aufy: c.sentAufs, svozy: c.unshipped, dodavatele: S.suppliers.length };
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
function tabOrders() {
  const c = counts();
  const archived = ui.orderFilter === 'archive';
  const words = fold(ui.orderSearch).split(/\s+/).filter(Boolean);
  // hledá v čísle objednávky, AUF číslech, zákazníkovi, poznámkách i položkách (i v archivu)
  const hay = o => fold([o.code, o.customer, o.note, o.shoptetStatus,
    ...aufsOf(o.code).flatMap(a => [a.aufNumber, a.note, supName(a.supplierId)]),
    ...S.items.filter(i => i.orderCode === o.code).flatMap(i => [i.code, i.name, i.variant, prod(i.code).mpn])].join(' '));
  const list = S.orders.filter(o => words.length ? words.every(w => hay(o).includes(w)) : o.archived === archived)
    .map(o => ({ o, st: orderState(o.code) }))
    .filter(x => words.length || archived || x.st !== 'empty' || x.o.active)
    .sort((a, b) => STATE[a.st][2] - STATE[b.st][2] || String(b.o.date).localeCompare(String(a.o.date)) || b.o.code.localeCompare(a.o.code));
  let h = `<div class="stats">
      <div class="stat"><div class="v" style="${c.todo ? 'color:var(--warn)' : ''}">${c.todo}</div><div class="l">potřeba objednat</div></div>
      <div class="stat"><div class="v">${c.sentAufs}</div><div class="l">čeká na AUF</div></div>
      <div class="stat"><div class="v">${c.unshipped}</div><div class="l">AUF bez svozu</div></div>
      <div class="stat"><div class="v">${c.shipping}</div><div class="l">naplánované svozy</div></div>
    </div>
    <div class="row o-tools" style="margin-bottom:12px">
      <input type="search" id="o-search" placeholder="Hledat: číslo objednávky, AUF, jméno, reference…" value="${esc(ui.orderSearch)}">
      <div class="chips" ${words.length ? 'style="opacity:.45"' : ''}><button class="chip ${!archived ? 'on' : ''}" data-ofilter="active">Aktivní</button><button class="chip ${archived ? 'on' : ''}" data-ofilter="archive">Archiv</button></div>
      <div class="grow"></div><button class="btn sm" data-neworder>＋ Ruční objednávka</button>
    </div>`;
  if (words.length && !list.length) return h + `<div class="card empty"><b>Nic nenalezeno pro „${esc(ui.orderSearch)}“.</b><div class="small">Hledá se v aktivních i archivovaných objednávkách.</div></div>`;
  if (words.length) h += `<div class="small muted" style="margin:-4px 0 10px">${plural(list.length, 'výsledek', 'výsledky', 'výsledků')} — aktivní i archiv</div>`;
  if (!list.length) return h + `<div class="card empty"><div class="big">✓</div><b>${archived ? 'Archiv je prázdný.' : `Žádné objednávky ve stavu „${esc(S.settings.statusValue)}“.`}</b><div class="small">${!archived && S.sync.fetchedAt ? 'Poslední načtení ' + ago(S.sync.fetchedAt) + '.' : ''}</div></div>`;
  h += `<div class="card" style="padding:6px 0"><div class="olist">${list.map(({ o, st }) => {
    const its = orderItems(o.code);
    const sups = [...new Set(its.filter(i => effDec(i) === 'order' && effSup(i)).map(effSup))];
    const aufs = aufsOf(o.code).filter(a => a.aufNumber);
    return `<a class="orow" href="#/objednavky/o/${encodeURIComponent(o.code)}">
      <div class="grow"><div class="row" style="gap:8px"><b>${esc(o.code)}</b>${o.manual ? '<span class="badge">ručně</span>' : ''}${words.length && o.archived ? '<span class="badge">archiv</span>' : ''}${o.note ? '<span title="Má poznámku">📝</span>' : ''}${!o.manual && !o.active && o.shoptetStatus ? `<span class="sub">Shoptet: ${esc(o.shoptetStatus)}</span>` : ''}</div>
        <div class="sub">${esc(o.customer || '')}${o.customer && o.date ? ' · ' : ''}${esc(String(o.date).slice(0, 10))} · ${plural(its.length, 'položka', 'položky', 'položek')}${sups.length ? ' · ' + sups.map(s => `${flag(supplierById(s)?.country)} ${esc(supName(s))}`).join(', ') : ''}${aufs.length ? ' · AUF ' + aufs.map(a => esc(a.aufNumber)).join(', ') : ''}</div></div>
      <span class="badge ${STATE[st][1]}">${STATE[st][0]}</span><span class="chev">›</span></a>`;
  }).join('')}</div></div>`;
  return h;
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
  const shipOpts = `<option value="">— bez svozu —</option>${S.shipments.map(x => `<option value="${x.id}" ${a.shipmentId === x.id ? 'selected' : ''}>${esc(fmtDay(x.date))}${x.note ? ' · ' + esc(x.note) : ''}</option>`).join('')}<option value="__new">＋ Nový svoz…</option>`;
  return `<div class="auf ${a.status}" data-aufcard="${a.id}">
    <div class="auf-head">
      <span class="flag">${flag(s.country)}</span>
      <div class="grow"><b>${esc(s.name)}</b>${showOrder ? ` · <a href="#/objednavky/o/${encodeURIComponent(a.orderCode)}">obj. ${esc(a.orderCode)}</a>` : ''}
        <div class="sub">${plural(a.lines.length, 'položka', 'položky', 'položek')}${a.sentAt ? ' · odesláno ' + fmtDate(a.sentAt, false) : ''}${ship ? ' · svoz ' + esc(fmtDay(ship.date)) : ''}</div></div>
      ${a.aufNumber ? `<div class="auf-no"><div class="sub">AUF</div><b>${esc(a.aufNumber)}</b></div>` : ''}
      ${a.amount != null ? `<div class="auf-no"><div class="sub">Částka</div><b>${eur(a.amount)}</b></div>` : ''}
      <span class="badge ${AUF_STATE[a.status][1]}">${AUF_STATE[a.status][0]}</span>
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
  const F = { sent: ['Čeká na AUF', a => a.status === 'sent'], unshipped: ['Potvrzené bez svozu', a => a.status === 'confirmed' && !a.shipmentId], confirmed: ['Všechny potvrzené', a => a.status === 'confirmed'], all: ['Vše', () => true] };
  const f = F[ui.aufFilter] ? ui.aufFilter : 'sent';
  const list = S.aufs.filter(F[f][1]);
  const conf = S.aufs.filter(a => a.status === 'confirmed');
  let h = `<div class="stats">
    <div class="stat"><div class="v">${S.aufs.filter(a => a.status === 'sent').length}</div><div class="l">čeká na AUF</div></div>
    <div class="stat"><div class="v">${conf.filter(a => !a.shipmentId).length}</div><div class="l">potvrzené bez svozu</div></div>
    <div class="stat"><div class="v eur">${eur(sumEur(conf.filter(a => !a.shipmentId)))}</div><div class="l">hodnota bez svozu</div></div>
    <div class="stat"><div class="v">${S.aufs.filter(a => a.status === 'draft').length}</div><div class="l">neodeslané koncepty</div></div>
  </div>
  <div class="chips" style="margin-bottom:12px">${Object.entries(F).map(([k, [l, fn]]) => `<button class="chip ${k === f ? 'on' : ''}" data-afilter="${k}">${l} <span class="muted">${S.aufs.filter(fn).length}</span></button>`).join('')}</div>`;
  if (!list.length) return h + `<div class="card empty">Nic tu není.</div>`;
  return h + `<div class="card">${list.map(a => renderAuf(a, { showOrder: true })).join('')}</div>`;
}

// --- tab: Svozy
function tabShipments() {
  const unassigned = S.aufs.filter(a => a.status === 'confirmed' && !a.shipmentId);
  const upcoming = S.shipments.filter(s => !s.date || s.date >= todayIso());
  const past = S.shipments.filter(s => s.date && s.date < todayIso()).reverse();
  const shipCard = s => {
    const list = aufsInShipment(s.id);
    const details = shipmentDetails(s);
    return `<div class="card ship">
      <div class="card-head">
        <div><h2 style="margin:0">🚚 ${esc(fmtDay(s.date))}</h2>${s.note ? `<div class="sub">${esc(s.note)}</div>` : ''}</div>
        <div class="row">
          <div class="auf-no"><div class="sub">AUFů</div><b>${list.length}</b></div>
          <div class="auf-no"><div class="sub">Celkem</div><b>${eur(sumEur(list))}</b></div>
        </div>
      </div>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>AUF</th><th>Dodavatel</th><th class="hide-m">Objednávka</th><th class="num">Částka</th><th></th></tr></thead><tbody>
        ${list.map(a => `<tr><td><b>${esc(a.aufNumber)}</b></td><td>${flag(supplierById(a.supplierId)?.country)} ${esc(supName(a.supplierId))}</td>
          <td class="hide-m"><a href="#/objednavky/o/${encodeURIComponent(a.orderCode)}">${esc(a.orderCode)}</a></td><td class="num">${eur(a.amount)}</td>
          <td><button class="icon-btn" data-unship="${a.id}" title="Odebrat ze svozu">✕</button></td></tr>`).join('')}
        <tr class="total"><td colspan="3" class="hide-m"><b>Celkem</b></td><td class="num"><b>${eur(sumEur(list))}</b></td><td></td></tr>
      </tbody></table></div>` : '<div class="small muted">Zatím žádný AUF.</div>'}
      <div class="row" style="margin-top:12px">
        ${unassigned.length ? `<select data-addauf="${s.id}" style="max-width:320px"><option value="">＋ Přidat AUF…</option>${unassigned.map(a => `<option value="${a.id}">AUF ${esc(a.aufNumber)} · ${esc(supName(a.supplierId))} · ${eur(a.amount)}</option>`).join('')}</select>` : ''}
        <span class="grow"></span>
        ${s.date ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(gcalLink({ title: details.title, date: s.date, details: details.text }))}">📅 Přidat do Google</a>` : ''}
        <button class="icon-btn" data-editship="${s.id}" title="Upravit">✎</button><button class="icon-btn" data-delship="${s.id}" title="Smazat svoz">🗑</button>
      </div>
    </div>`;
  };
  return `
    <div class="row" style="margin-bottom:14px"><button class="btn primary" data-editship="">＋ Nový svoz</button><span class="small muted">Termíny svozů se automaticky propisují do kalendáře SmartJoi.</span></div>
    <div class="card">
      <div class="card-head"><div><h2 style="margin:0">AUFy bez svozu</h2><div class="sub">Potvrzené objednávky u dodavatelů, které ještě nejsou naplánované.</div></div>
        <div class="auf-no"><div class="sub">${plural(unassigned.length, 'AUF', 'AUFy', 'AUFů')}</div><b>${eur(sumEur(unassigned))}</b></div></div>
      ${unassigned.length ? `<div class="table-wrap"><table><tbody>${unassigned.map(a => `<tr><td><b>${esc(a.aufNumber)}</b></td><td>${flag(supplierById(a.supplierId)?.country)} ${esc(supName(a.supplierId))}</td>
        <td class="hide-m"><a href="#/objednavky/o/${encodeURIComponent(a.orderCode)}">${esc(a.orderCode)}</a></td><td class="num">${eur(a.amount)}</td>
        <td style="width:200px"><select data-aufship="${a.id}"><option value="">— do svozu —</option>${S.shipments.map(x => `<option value="${x.id}">${esc(fmtDay(x.date))}</option>`).join('')}<option value="__new">＋ Nový svoz…</option></select></td></tr>`).join('')}</tbody></table></div>` : '<div class="small muted">Vše je naplánované.</div>'}
    </div>
    ${upcoming.map(shipCard).join('') || '<div class="card empty">Žádný naplánovaný svoz.</div>'}
    ${past.length ? `<div class="row" style="margin:6px 0 12px"><button class="btn sm ghost" data-togglepast>${ui.showPast ? 'Skrýt' : 'Zobrazit'} proběhlé svozy (${past.length})</button></div>${ui.showPast ? past.map(shipCard).join('') : ''}` : ''}`;
}
function shipmentDetails(s) {
  const list = aufsInShipment(s.id);
  const title = `Svoz · ${plural(list.length, 'AUF', 'AUFy', 'AUFů')} · ${eur(sumEur(list))}`;
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
  const title = `Svoz · ${plural(ls.length, 'AUF', 'AUFy', 'AUFů')} · ${eur(sumEur(ls))}`;
  const text = ls.map(a => `AUF ${a.aufNumber} – ${supName(a.supplierId)} – obj. ${a.orderCode} – ${eur(a.amount)}`).join('\n') + (ls.length ? `\nCelkem: ${eur(sumEur(ls))}` : '') + (s.note ? `\n\n${s.note}` : '');
  await SJCalendar.upsert({ app: 'objednavky', ref: 'shipment:' + id, title, date: s.ship_date, details: text, url: location.origin + location.pathname + '#/objednavky/svozy' });
}
function editShipment(id, thenAufId) {
  const s = shipmentById(id) || { id: '', date: '', note: '' };
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:460px">
    <div class="modal-head"><h2>${s.id ? 'Upravit svoz' : 'Nový svoz'}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="stack">
      <label class="field"><span>Datum svozu</span><input type="date" id="sh-date" value="${esc(s.date)}"></label>
      <label class="field"><span>Poznámka (volitelné)</span><input type="text" id="sh-note" value="${esc(s.note)}" placeholder="např. kamion z Bayreuthu"></label>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="sh-save">Uložit</button></div>
  </div></div>`;
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = () => { closeModal(); render(); });
  $('#sh-save').onclick = async () => {
    const row = { ship_date: $('#sh-date').value || null, note: $('#sh-note').value.trim() };
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
function bind() {
  const V = $('#view');
  V.querySelectorAll('[data-ofilter]').forEach(b => b.onclick = () => { ui.orderFilter = b.dataset.ofilter; ui.orderSearch = ''; render(); });
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

// ---------- start ----------
let session = null;
window.addEventListener('hashchange', () => { if (!session) return; closeModal(); render(); window.scrollTo(0, 0); });
async function load() { try { await loadState(); } catch (e) { toast('Chyba: ' + e.message); } render(); }
sb.auth.onAuthStateChange((_ev, s) => {
  const was = session; session = s;
  if (!s) { S = null; return renderLogin(); }
  renderUser(s);
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
