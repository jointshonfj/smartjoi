/* SmartJoi — frontend (GitHub Pages + Supabase) */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let S = null;            // stav ze serveru
let busy = false;
const ui = { search: '', showNone: false, includeRefs: false, histOpen: {} };

const APPS = [
  { id: 'objednavky', icon: '📦', title: 'Objednávky od dodavatelů', desc: 'Položky z Shoptetu ve stavu „Potřeba objednat“ — co objednat, u koho, a hotový e-mail v angličtině.' },
];
const COUNTRIES = [
  ['DE', 'Německo'], ['AT', 'Rakousko'], ['PL', 'Polsko'], ['SK', 'Slovensko'], ['IT', 'Itálie'], ['NL', 'Nizozemsko'],
  ['BE', 'Belgie'], ['FR', 'Francie'], ['ES', 'Španělsko'], ['DK', 'Dánsko'], ['SE', 'Švédsko'], ['HU', 'Maďarsko'],
  ['SI', 'Slovinsko'], ['CN', 'Čína'], ['GB', 'Velká Británie'], ['CZ', 'Česko'],
];
const MAP_LABELS = {
  orderCode: 'Číslo objednávky', status: 'Stav objednávky', itemCode: 'Kód položky', itemName: 'Název položky',
  itemAmount: 'Množství', itemUnit: 'Jednotka', itemType: 'Typ položky (doprava/platba se přeskočí)', date: 'Datum', customer: 'Zákazník',
};
const TABS = [
  ['k-objednani', 'K objednání'], ['objednavky', 'Objednávky'], ['produkty', 'Produkty'],
  ['dodavatele', 'Dodavatelé'], ['historie', 'Historie'], ['nastaveni', 'Nastavení'],
];

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const flag = cc => cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map(c => 127397 + c.charCodeAt(0))) : '🌍';
const countryName = cc => (COUNTRIES.find(c => c[0] === cc) || [cc, cc || '—'])[1];
const fmtQty = n => (Math.round(n * 1000) / 1000).toLocaleString('cs-CZ');
const fmtQtyEn = n => String(Math.round(n * 1000) / 1000);
function fmtDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d)) return iso;
  return d.toLocaleString('cs-CZ', withTime ? { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'numeric', year: 'numeric' });
}
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
  const M = { ks: 'pcs', kus: 'pcs', kusů: 'pcs', kusy: 'pcs', pcs: 'pcs', m2: 'm²', 'm²': 'm²', bm: 'lm', m: 'm', bal: 'pack(s)', balení: 'pack(s)', bal_: 'pack(s)', kg: 'kg', t: 't', l: 'l', pár: 'pair(s)', sada: 'set(s)', sad: 'set(s)', krab: 'box(es)', krabice: 'box(es)', role: 'roll(s)', paleta: 'pallet(s)' };
  return M[x] || (u ? u : 'pcs');
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return toast('Zkopírováno ✓'); }
  } catch {}
  // záloha pro http:// v lokální síti (telefon)
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
  document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  toast(ok ? 'Zkopírováno ✓' : 'Označ text a zkopíruj ručně');
}

// ---------- Supabase data layer ----------
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
  const [st, sups, prods, items, batches] = await Promise.all([
    sb.from('settings').select('*').eq('id', 1).single().then(ok),
    fetchAll('suppliers', q => q.order('name')),
    fetchAll('products', q => q.order('code')),
    fetchAll('order_items', q => q.eq('active', true).order('order_code')),
    sb.from('batches').select('*').order('created_at', { ascending: false }).limit(200).then(ok),
  ]);
  const products = {};
  for (const p of prods) products[p.code] = { supplierId: p.skip ? 'none' : (p.supplier_id || ''), supplierCode: p.supplier_code, supplierName: p.supplier_name, name: p.name };
  S = {
    settings: { csvUrl: st.csv_url, statusValue: st.status_value, mapping: st.mapping || {}, companyName: st.company_name, subjectTemplate: st.subject_template, extraNote: st.extra_note, signature: st.signature },
    suppliers: sups.map(s => ({ id: s.id, name: s.name, country: s.country, email: s.email, contact: s.contact, customerNo: s.customer_no, notes: s.notes })),
    products,
    items: items.map(i => ({ key: i.key, orderCode: i.order_code, code: i.code, name: i.name, qty: Number(i.qty), unit: i.unit, date: i.order_date, customer: i.customer, ordered: i.ordered_at ? { at: i.ordered_at, batchId: i.batch_id } : null })),
    batches: batches.map(b => ({ id: b.id, createdAt: b.created_at, supplierId: b.supplier_id, to: b.to_email, subject: b.subject, body: b.body, lines: b.lines || [], keys: b.keys || [] })),
    sync: { fetchedAt: st.last_sync_at, error: st.last_sync_error, errorAt: st.last_sync_error_at, headers: st.sync_headers || [], rowCount: st.sync_row_count, sample: st.sync_sample || [], statuses: st.sync_statuses || {} },
  };
}
// Spustí načtení ze Shoptetu (přes databázi → Edge Function) a počká na výsledek
async function requestSync() {
  const snap = async () => ok(await sb.from('settings').select('last_sync_at,last_sync_error_at').eq('id', 1).single());
  const before = await snap();
  ok(await sb.rpc('request_shoptet_sync'));
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const now = await snap();
    if (now.last_sync_at !== before.last_sync_at || now.last_sync_error_at !== before.last_sync_error_at) return;
  }
  throw new Error('Shoptet neodpověděl do 90 s, zkus to za chvíli znovu.');
}
async function dispatch(method, url, b = {}) {
  const now = new Date().toISOString();
  let m;
  if (url === '/api/state') return;
  if (url === '/api/sync') return requestSync();
  if (url === '/api/settings') {
    // last_sync_at: null → funkce se hned spustí znovu i s novým stavem / sloupci / odkazem
    ok(await sb.from('settings').update({
      csv_url: b.csvUrl, status_value: b.statusValue, mapping: b.mapping, company_name: b.companyName,
      subject_template: b.subjectTemplate, extra_note: b.extraNote, signature: b.signature, last_sync_at: null,
    }).eq('id', 1));
    return requestSync();
  }
  if (url === '/api/suppliers') {
    const row = { name: b.name, country: b.country, email: b.email, contact: b.contact, customer_no: b.customerNo, notes: b.notes };
    if (b.id) return ok(await sb.from('suppliers').update(row).eq('id', b.id));
    return ok(await sb.from('suppliers').insert(row));
  }
  if ((m = url.match(/^\/api\/suppliers\/(.+)$/))) return ok(await sb.from('suppliers').delete().eq('id', m[1]));
  if (url === '/api/products') {
    const d = b.data, row = { code: b.code, updated_at: now };
    if (d.supplierId !== undefined) { row.skip = d.supplierId === 'none'; row.supplier_id = d.supplierId && d.supplierId !== 'none' ? d.supplierId : null; }
    if (d.supplierCode !== undefined) row.supplier_code = d.supplierCode;
    if (d.supplierName !== undefined) row.supplier_name = d.supplierName;
    return ok(await sb.from('products').upsert(row, { onConflict: 'code' }));
  }
  if (url === '/api/batches') {
    const batch = ok(await sb.from('batches').insert({ supplier_id: b.supplierId, to_email: b.to, subject: b.subject, body: b.body, lines: b.lines, keys: b.keys }).select().single());
    for (let i = 0; i < b.keys.length; i += 200)
      ok(await sb.from('order_items').update({ ordered_at: batch.created_at, batch_id: batch.id }).in('key', b.keys.slice(i, i + 200)));
    return;
  }
  if ((m = url.match(/^\/api\/batches\/(.+)$/))) {
    ok(await sb.from('order_items').update({ ordered_at: null, batch_id: null }).eq('batch_id', m[1]));
    return ok(await sb.from('batches').delete().eq('id', m[1]));
  }
  if (url === '/api/ordered')
    return ok(await sb.from('order_items').update(b.ordered ? { ordered_at: now, batch_id: null } : { ordered_at: null, batch_id: null }).eq('key', b.key));
  throw new Error('Neznámá akce ' + url);
}
async function api(method, url, body) {
  busy = true;
  try { await dispatch(method, url, body); await loadState(); return S; }
  catch (e) { toast('Chyba: ' + e.message); throw e; }
  finally { busy = false; }
}

// ---------- derived ----------
const supplierById = id => S.suppliers.find(s => s.id === id);
const prod = code => S.products[code] || {};
function openItems() { return S.items.filter(i => !i.ordered); }
function groupsToOrder() {
  const groups = new Map(); // supplierId -> products map
  for (const it of openItems()) {
    const sid = prod(it.code).supplierId || '';
    if (!groups.has(sid)) groups.set(sid, new Map());
    const g = groups.get(sid);
    if (!g.has(it.code)) g.set(it.code, { code: it.code, name: it.name, unit: it.unit, qty: 0, items: [] });
    const p = g.get(it.code); p.qty += it.qty; p.items.push(it);
  }
  return groups;
}
function counts() {
  const open = openItems();
  const unassigned = open.filter(i => !prod(i.code).supplierId).length;
  const toOrder = open.filter(i => { const s = prod(i.code).supplierId; return s && s !== 'none'; }).length;
  const orders = new Set(S.items.map(i => i.orderCode)).size;
  return { unassigned, toOrder, orders, open: open.length };
}

// ---------- router ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  return { app: h[0] || '', tab: h[1] || '' };
}
function render() {
  if (!S) { $('#view').innerHTML = '<div class="empty"><div class="big spin">◌</div>Načítám…</div>'; return; }
  const r = route();
  const crumb = $('#crumb');
  if (!r.app) { crumb.innerHTML = ''; return renderHub(); }
  const app = APPS.find(a => a.id === r.app);
  if (!app) { location.hash = '#/'; return; }
  crumb.innerHTML = `<span>/</span><b>${esc(app.title)}</b>`;
  renderOrders(r.tab || 'k-objednani');
}

// ---------- HUB ----------
function renderHub() {
  const c = counts();
  $('#view').innerHTML = `
    <section class="hero">
      <div class="eyebrow">Jointshon — FJ · interní nástroje</div>
      <h1>Systém místo chaosu.</h1>
      <p>Všechny tvoje pracovní aplikace na jednom místě — na počítači i v telefonu.</p>
    </section>
    <div class="apps">
      ${APPS.map((a, i) => `
        <a class="app-card" href="#/${a.id}">
          <div class="row"><div class="app-icon">${a.icon}</div><span class="num grow" style="text-align:right">0${i + 1}</span></div>
          <h3>${esc(a.title)}</h3>
          <p>${esc(a.desc)}</p>
          <div class="badge-row">
            ${c.toOrder ? `<span class="badge warn"><span class="dot"></span>${c.toOrder} k objednání</span>` : c.unassigned ? '' : `<span class="badge ok"><span class="dot"></span>Vše objednáno</span>`}
            ${c.unassigned ? `<span class="badge bad">${c.unassigned} bez dodavatele</span>` : ''}
          </div>
        </a>`).join('')}
      <div class="app-card soon">
        <div class="row"><div class="app-icon">＋</div></div>
        <h3>Další aplikace</h3>
        <p>Místo pro další nástroj — reporty, sklad, reklamace…</p>
      </div>
    </div>
    <div class="footer">SmartJoi · Jointshon | FJ</div>`;
}

// ---------- ORDERS APP ----------
function renderOrders(tab) {
  const c = counts();
  const sync = S.sync;
  const tabCount = { 'k-objednani': c.toOrder + c.unassigned, objednavky: c.orders, dodavatele: S.suppliers.length, historie: S.batches.length };
  let html = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Aplikace 01</div>
        <h1>Objednávky od dodavatelů</h1>
      </div>
      <div class="row">
        <span class="small muted">Shoptet: ${sync.error ? `<span style="color:var(--bad)">chyba</span>` : ago(sync.fetchedAt)}</span>
        <button class="btn" id="btn-sync">↻ Načíst ze Shoptetu</button>
      </div>
    </div>
    <div class="tabs">${TABS.map(([id, l]) => `<button class="tab ${id === tab ? 'active' : ''}" data-tab="${id}">${l}${tabCount[id] ? `<span class="count">${tabCount[id]}</span>` : ''}</button>`).join('')}</div>`;

  if (sync.error && !/Nerozpoznal jsem sloupce/.test(sync.error)) html += `<div class="notice bad"><b>Nepodařilo se načíst CSV ze Shoptetu:</b> ${esc(sync.error)} <span class="muted small">(${ago(sync.errorAt)})</span></div>`;
  const m = S.settings.mapping || {};
  if (sync.headers.length && !m.itemCode && !m.itemName)
    html += `<div class="notice warn"><b>Export ze Shoptetu neobsahuje položky objednávek.</b> V šabloně CSV exportu objednávek ve Shoptetu přidej sloupce s položkami (kód, název, množství, jednotka, typ položky) — pak se tady produkty objeví samy. <a href="#/objednavky/nastaveni">Sloupce v exportu →</a></div>`;
  else if (sync.headers.length && !m.status)
    html += `<div class="notice warn">Nepoznal jsem sloupec se stavem objednávky. <a href="#/objednavky/nastaveni">Nastav ho v Nastavení →</a></div>`;
  const stNames = Object.keys(sync.statuses || {});
  if (stNames.length && !stNames.some(x => x.toLowerCase() === String(S.settings.statusValue).trim().toLowerCase()))
    html += `<div class="notice warn">Stav <b>„${esc(S.settings.statusValue)}“</b> se v exportu ze Shoptetu zatím nevyskytuje. Buď ho ve Shoptetu vytvoř a nastav objednávkám, nebo v <a href="#/objednavky/nastaveni">Nastavení</a> vyber jiný stav.</div>`;

  const T = { 'k-objednani': tabToOrder, objednavky: tabOrders, produkty: tabProducts, dodavatele: tabSuppliers, historie: tabHistory, nastaveni: tabSettings };
  html += (T[tab] || tabToOrder)();
  $('#view').innerHTML = html;

  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { location.hash = `#/objednavky/${b.dataset.tab}`; });
  $('#btn-sync').onclick = doSync;
  bind();
}

async function doSync() {
  const b = $('#btn-sync'); if (b) { b.disabled = true; b.innerHTML = '<span class="spin">↻</span> Načítám…'; }
  try { await api('POST', '/api/sync'); toast(S.sync.error ? 'Chyba při načítání' : 'Načteno ze Shoptetu ✓'); } catch {}
  render();
}

function supplierSelect(code, cur, cls = '') {
  return `<select class="${cls}" data-assign="${esc(code)}">
    <option value="" ${!cur ? 'selected' : ''}>— vyber dodavatele —</option>
    ${S.suppliers.map(s => `<option value="${s.id}" ${cur === s.id ? 'selected' : ''}>${flag(s.country)} ${esc(s.name)}</option>`).join('')}
    <option value="none" ${cur === 'none' ? 'selected' : ''}>✕ Neobjednávat (skladem / CZ)</option>
    <option value="__new">＋ Nový dodavatel…</option>
  </select>`;
}

// --- tab: K objednání
function tabToOrder() {
  const c = counts();
  const groups = groupsToOrder();
  let h = `<div class="stats">
      <div class="stat"><div class="v">${c.toOrder}</div><div class="l">položek k objednání</div></div>
      <div class="stat"><div class="v" style="${c.unassigned ? 'color:var(--bad)' : ''}">${c.unassigned}</div><div class="l">bez dodavatele</div></div>
      <div class="stat"><div class="v">${c.orders}</div><div class="l">objednávek „${esc(S.settings.statusValue)}“</div></div>
      <div class="stat"><div class="v">${S.batches.filter(b => Date.now() - Date.parse(b.createdAt) < 7 * 864e5).length}</div><div class="l">e-mailů za 7 dní</div></div>
    </div>`;

  if (!S.items.length) {
    return h + `<div class="card empty"><div class="big">✓</div><b>Žádné objednávky ve stavu „${esc(S.settings.statusValue)}“.</b><div class="small">${S.sync.fetchedAt ? 'Poslední načtení ' + ago(S.sync.fetchedAt) + '.' : 'Zatím se nic nenačetlo.'}</div></div>`;
  }

  // nepřiřazené
  const un = groups.get('');
  if (un) {
    h += `<div class="group"><div class="group-head"><span class="flag">❓</span><h2 class="grow">Bez dodavatele</h2><span class="badge bad">${un.size} produktů</span></div>
      <div class="group-body"><p class="small muted" style="margin:10px 0 4px">Přiřaď produkt k dodavateli — aplikace si to zapamatuje pro další objednávky.</p>
      <div class="table-wrap"><table><thead><tr><th>Produkt</th><th class="num">Množství</th><th class="hide-m">Objednávky</th><th style="width:230px">Dodavatel</th></tr></thead><tbody>
      ${[...un.values()].map(p => `<tr>
        <td><code>${esc(p.code)}</code><div class="sub">${esc(p.name)}</div></td>
        <td class="num">${fmtQty(p.qty)} ${esc(p.unit)}</td>
        <td class="hide-m small muted">${p.items.map(i => esc(i.orderCode)).join(', ')}</td>
        <td>${supplierSelect(p.code, '')}</td></tr>`).join('')}
      </tbody></table></div></div></div>`;
  }

  // podle dodavatelů
  const sups = [...groups.keys()].filter(k => k && k !== 'none');
  if (!sups.length && !un) h += `<div class="card empty"><div class="big">✓</div><b>Nic k objednání.</b><div class="small">Všechny položky jsou objednané nebo označené jako „neobjednávat“.</div></div>`;
  for (const sid of sups) {
    const s = supplierById(sid) || { name: '(smazaný dodavatel)', country: '' };
    const g = groups.get(sid);
    h += `<div class="group"><div class="group-head">
        <span class="flag">${flag(s.country)}</span>
        <div class="grow"><h2>${esc(s.name)}</h2><div class="sub">${esc(s.email || 'bez e-mailu')}${s.contact ? ' · ' + esc(s.contact) : ''}</div></div>
        <span class="badge warn">${g.size} ${g.size === 1 ? 'produkt' : g.size < 5 ? 'produkty' : 'produktů'}</span>
        <button class="btn primary" data-email="${sid}">✉ Připravit e-mail</button>
      </div><div class="group-body"><div class="table-wrap"><table>
        <thead><tr><th style="width:30px"><input type="checkbox" checked data-all="${sid}"></th><th>Kód dodavatele</th><th>Produkt</th><th class="num">Množství</th><th class="hide-m">Objednávky</th><th></th></tr></thead><tbody>
        ${[...g.values()].map(p => {
          const pr = prod(p.code);
          return `<tr>
          <td><input type="checkbox" checked data-pick="${sid}" value="${esc(p.code)}"></td>
          <td><code>${esc(pr.supplierCode || p.code)}</code>${pr.supplierCode ? `<div class="sub">náš: ${esc(p.code)}</div>` : ''}</td>
          <td>${esc(pr.supplierName || p.name)}${pr.supplierName ? `<div class="sub">${esc(p.name)}</div>` : ''}</td>
          <td class="num"><b>${fmtQty(p.qty)}</b> ${esc(p.unit)}</td>
          <td class="hide-m small muted">${p.items.map(i => esc(i.orderCode) + (p.items.length > 1 ? ` (${fmtQty(i.qty)})` : '')).join(', ')}</td>
          <td><button class="icon-btn" title="Upravit produkt" data-editprod="${esc(p.code)}">✎</button></td></tr>`;
        }).join('')}
        </tbody></table></div></div></div>`;
  }

  const none = groups.get('none');
  if (none) {
    h += `<div class="card"><div class="card-head"><div><h3 style="margin:0">Neobjednáváme <span class="muted">(${none.size})</span></h3><div class="sub">Produkty označené jako skladem / od českého dodavatele.</div></div>
      <button class="btn sm ghost" data-toggle-none>${ui.showNone ? 'Skrýt' : 'Zobrazit'}</button></div>
      ${ui.showNone ? `<div class="table-wrap"><table><tbody>${[...none.values()].map(p => `<tr><td><code>${esc(p.code)}</code><div class="sub">${esc(p.name)}</div></td><td class="num">${fmtQty(p.qty)} ${esc(p.unit)}</td><td style="width:230px">${supplierSelect(p.code, 'none')}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`;
  }
  return h;
}

// --- tab: Objednávky
function tabOrders() {
  const byOrder = new Map();
  for (const it of S.items) { if (!byOrder.has(it.orderCode)) byOrder.set(it.orderCode, []); byOrder.get(it.orderCode).push(it); }
  if (!byOrder.size) return `<div class="card empty"><div class="big">✓</div>Žádné objednávky ve stavu „${esc(S.settings.statusValue)}“.</div>`;
  let h = `<p class="small muted" style="margin-top:0">Všechny objednávky ze Shoptetu ve stavu „${esc(S.settings.statusValue)}“. Jednotlivé položky můžeš ručně označit jako objednané.</p>`;
  for (const [code, items] of byOrder) {
    const done = items.filter(i => i.ordered).length;
    const f = items[0];
    h += `<div class="card"><div class="card-head">
        <div><h3 style="margin:0">${esc(code)}</h3><div class="sub">${esc(f.customer)}${f.customer && f.date ? ' · ' : ''}${esc(f.date)}</div></div>
        <span class="badge ${done === items.length ? 'ok' : done ? 'warn' : ''}">${done}/${items.length} objednáno</span></div>
      <div class="table-wrap"><table><tbody>
      ${items.map(i => {
        const sid = prod(i.code).supplierId; const s = sid && sid !== 'none' ? supplierById(sid) : null;
        return `<tr class="${i.ordered ? 'done' : ''}">
          <td style="width:30px"><input type="checkbox" ${i.ordered ? 'checked' : ''} data-ordered="${esc(i.key)}" title="Objednáno"></td>
          <td><code>${esc(i.code)}</code><div class="sub">${esc(i.name)}</div></td>
          <td class="num">${fmtQty(i.qty)} ${esc(i.unit)}</td>
          <td class="hide-m small">${sid === 'none' ? '<span class="muted">neobjednávat</span>' : s ? `${flag(s.country)} ${esc(s.name)}` : '<span style="color:var(--bad)">bez dodavatele</span>'}</td>
          <td class="small muted hide-m">${i.ordered ? 'objednáno ' + fmtDate(i.ordered.at, false) : ''}</td></tr>`;
      }).join('')}
      </tbody></table></div></div>`;
  }
  return h;
}

// --- tab: Produkty
function tabProducts() {
  const q = ui.search.trim().toLowerCase();
  const all = Object.entries(S.products).sort((a, b) => a[0].localeCompare(b[0], 'cs'));
  const list = all.filter(([code, p]) => !q || (code + ' ' + (p.name || '') + ' ' + (p.supplierCode || '') + ' ' + (p.supplierName || '')).toLowerCase().includes(q));
  return `<div class="card">
    <div class="card-head"><div><h2>Produkty</h2><div class="sub">Přiřazení dodavatele a údaje, které se použijí v e-mailu (kód a anglický název u dodavatele).</div></div>
      <input type="search" id="prod-search" placeholder="Hledat kód nebo název…" value="${esc(ui.search)}" style="max-width:280px"></div>
    ${!all.length ? '<div class="empty">Produkty se tu objeví automaticky, jakmile přijdou v objednávkách.</div>' : `
    <div class="table-wrap"><table><thead><tr><th>Náš kód / název</th><th style="width:220px">Dodavatel</th><th class="hide-m">Kód u dodavatele</th><th class="hide-m">Název pro dodavatele (EN)</th><th></th></tr></thead><tbody>
    ${list.slice(0, 400).map(([code, p]) => `<tr>
      <td><code>${esc(code)}</code><div class="sub">${esc(p.name)}</div></td>
      <td>${supplierSelect(code, p.supplierId || '')}</td>
      <td class="hide-m small">${p.supplierCode ? `<code>${esc(p.supplierCode)}</code>` : '<span class="muted">—</span>'}</td>
      <td class="hide-m small">${p.supplierName ? esc(p.supplierName) : '<span class="muted">—</span>'}</td>
      <td><button class="icon-btn" data-editprod="${esc(code)}">✎</button></td></tr>`).join('')}
    </tbody></table></div>${list.length > 400 ? `<p class="small muted">Zobrazeno 400 z ${list.length} — upřesni hledání.</p>` : ''}`}
  </div>`;
}

// --- tab: Dodavatelé
function tabSuppliers() {
  const used = id => Object.values(S.products).filter(p => p.supplierId === id).length;
  return `<div class="card">
    <div class="card-head"><div><h2>Dodavatelé</h2><div class="sub">Zahraniční dodavatelé, kterým se posílá objednávka e-mailem.</div></div>
      <button class="btn primary" data-editsup="">＋ Přidat dodavatele</button></div>
    ${!S.suppliers.length ? `<div class="empty"><div class="big">🌍</div>Zatím žádný dodavatel. Přidej třeba toho z Německa.</div>` : `
    <div class="table-wrap"><table><thead><tr><th>Dodavatel</th><th class="hide-m">E-mail</th><th class="hide-m">Kontakt</th><th class="num">Produktů</th><th></th></tr></thead><tbody>
    ${S.suppliers.map(s => `<tr>
      <td><span class="flag">${flag(s.country)}</span> <b>${esc(s.name)}</b><div class="sub">${esc(countryName(s.country))}${s.customerNo ? ' · zák. č. ' + esc(s.customerNo) : ''}</div></td>
      <td class="hide-m small">${esc(s.email) || '<span class="muted">—</span>'}</td>
      <td class="hide-m small">${esc(s.contact) || '<span class="muted">—</span>'}</td>
      <td class="num">${used(s.id)}</td>
      <td style="white-space:nowrap"><button class="icon-btn" data-editsup="${s.id}">✎</button><button class="icon-btn" data-delsup="${s.id}" title="Smazat">🗑</button></td></tr>`).join('')}
    </tbody></table></div>`}
  </div>`;
}

// --- tab: Historie
function tabHistory() {
  if (!S.batches.length) return `<div class="card empty"><div class="big">🗂</div>Zatím žádné odeslané objednávky. Po označení e-mailu jako odeslaného se objeví tady.</div>`;
  return S.batches.map(b => {
    const s = supplierById(b.supplierId) || { name: '(smazaný dodavatel)' };
    const open = ui.histOpen[b.id];
    return `<div class="card">
      <div class="card-head"><div><h3 style="margin:0">${flag(s.country)} ${esc(s.name)}</h3><div class="sub">${fmtDate(b.createdAt)} · ${b.lines.length} produktů · ${new Set(b.keys.map(k => k.split('|')[0])).size} objednávek</div></div>
        <div class="row"><button class="btn sm" data-histtoggle="${b.id}">${open ? 'Skrýt' : 'Zobrazit e-mail'}</button><button class="btn sm ghost danger" data-delbatch="${b.id}" title="Vrátí položky zpět do K objednání">Zrušit</button></div></div>
      ${open ? `<div class="stack">
        <div class="copy-box"><input type="text" readonly value="${esc(b.to)}"><button class="btn sm" data-copy="to" data-b="${b.id}">Kopírovat</button></div>
        <div class="copy-box"><input type="text" readonly value="${esc(b.subject)}"><button class="btn sm" data-copy="subject" data-b="${b.id}">Kopírovat</button></div>
        <div class="copy-box"><textarea readonly class="mail-body">${esc(b.body)}</textarea><button class="btn sm" data-copy="body" data-b="${b.id}">Kopírovat</button></div>
      </div>` : `<div class="small muted">${b.lines.map(l => `${esc(l.code)} × ${fmtQty(l.qty)}`).join(' · ')}</div>`}
    </div>`;
  }).join('');
}

// --- tab: Nastavení
function tabSettings() {
  const st = S.settings, sync = S.sync, m = st.mapping || {};
  const statuses = Object.entries(sync.statuses || {}).sort((a, b) => b[1] - a[1]);
  const hOpts = cur => `<option value="">— nepoužívat —</option>` + sync.headers.map(h => `<option ${h === cur ? 'selected' : ''}>${esc(h)}</option>`).join('');
  return `
  <div class="card stack">
    <div><h2>Napojení na Shoptet</h2><div class="sub">CSV export objednávek z administrace Shoptetu. Aplikace ho sama stahuje v nastaveném intervalu.</div></div>
    <label class="field"><span>Odkaz na CSV export</span><input type="url" id="s-csvUrl" value="${esc(st.csvUrl)}"></label>
    <div class="grid-2">
      <label class="field"><span>Stav objednávky, který znamená „objednat“</span>
        <input type="text" id="s-statusValue" list="statuses" value="${esc(st.statusValue)}">
        <datalist id="statuses">${statuses.map(([v]) => `<option value="${esc(v)}">`).join('')}</datalist></label>
      <div class="field"><span class="small muted" style="display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px">Automatické načítání</span><div class="small muted" style="padding-top:8px">Každých 15 minut (plánovač v Supabase)</div></div>
    </div>
    ${statuses.length ? `<div class="small muted">Stavy nalezené v exportu: ${statuses.map(([v, n]) => `<span class="badge ${v.toLowerCase() === st.statusValue.toLowerCase() ? 'ok' : ''}" style="margin:2px">${esc(v || '(prázdný)')} · ${n}</span>`).join(' ')}</div>` : ''}
    <div class="small muted">Poslední načtení: ${sync.fetchedAt ? fmtDate(sync.fetchedAt) + ` · ${sync.rowCount} řádků · ${sync.headers.length} sloupců` : 'zatím ne'}${sync.error ? ` · <span style="color:var(--bad)">${esc(sync.error)}</span>` : ''}</div>
  </div>

  <div class="card stack">
    <div><h2>Sloupce v CSV</h2><div class="sub">Aplikace je rozpoznala automaticky — pokud něco nesedí, oprav to tady.</div></div>
    ${sync.headers.length ? `<div class="grid-3">${Object.entries(MAP_LABELS).map(([k, l]) => `<label class="field"><span>${l}</span><select data-map="${k}">${hOpts(m[k])}</select></label>`).join('')}</div>
    <details><summary class="small muted" style="cursor:pointer">Náhled prvních řádků CSV</summary>
      <div class="table-wrap" style="margin-top:10px"><table><thead><tr>${sync.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${sync.sample.map(r => `<tr>${sync.headers.map((_, i) => `<td class="small">${esc(r[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`
    : '<div class="muted small">Sloupce se zobrazí po prvním úspěšném načtení CSV.</div>'}
  </div>

  <div class="card stack">
    <div><h2>E-mail pro dodavatele</h2><div class="sub">Šablona objednávkového e-mailu (anglicky). V předmětu můžeš použít {company}, {date}, {supplier}.</div></div>
    <div class="grid-2">
      <label class="field"><span>Název firmy</span><input type="text" id="s-companyName" value="${esc(st.companyName)}"></label>
      <label class="field"><span>Předmět</span><input type="text" id="s-subjectTemplate" value="${esc(st.subjectTemplate)}"></label>
    </div>
    <label class="field"><span>Doplňující věta (volitelné, EN)</span><textarea id="s-extraNote" placeholder="e.g. Please deliver to our warehouse in …">${esc(st.extraNote)}</textarea></label>
    <label class="field"><span>Podpis</span><textarea id="s-signature">${esc(st.signature)}</textarea></label>
  </div>
  <div class="row" style="justify-content:flex-end"><button class="btn primary" id="save-settings">Uložit nastavení</button></div>`;
}

// ---------- email ----------
function buildEmail(sid, codes, includeRefs) {
  const s = supplierById(sid);
  const st = S.settings;
  const g = groupsToOrder().get(sid);
  const picked = [...g.values()].filter(p => codes.includes(p.code));
  const date = new Date().toLocaleDateString('en-GB');
  const subject = (st.subjectTemplate || 'Purchase order – {company} – {date}')
    .replaceAll('{company}', st.companyName || '').replaceAll('{date}', date).replaceAll('{supplier}', s.name);
  const lines = picked.map((p, i) => {
    const pr = prod(p.code);
    const code = pr.supplierCode || p.code;
    // do e-mailu jde jen anglický název; bez něj pouze kód (české názvy dodavatel nezná)
    let l = `${i + 1}. ${code}${pr.supplierName ? ' – ' + pr.supplierName : ''} – ${fmtQtyEn(p.qty)} ${unitEn(p.unit)}`;
    if (includeRefs) l += `  (ref.: ${p.items.map(x => x.orderCode).join(', ')})`;
    return l;
  });
  const greet = s.contact ? `Dear ${s.contact},` : 'Dear Sir or Madam,';
  const body = [
    greet, '',
    `we would like to place the following order${s.customerNo ? ` (customer no. ${s.customerNo})` : ''}:`, '',
    ...lines, '',
    'Please confirm the order and let us know the expected delivery date.',
    ...(st.extraNote ? ['', st.extraNote] : []),
    '', 'Thank you in advance.', '',
    st.signature || '',
  ].join('\n');
  return {
    to: s.email || '', subject, body,
    lines: picked.map(p => ({ code: prod(p.code).supplierCode || p.code, ourCode: p.code, name: prod(p.code).supplierName || p.name, qty: p.qty, unit: p.unit })),
    keys: picked.flatMap(p => p.items.map(i => i.key)),
  };
}

function openEmail(sid) {
  const codes = [...document.querySelectorAll(`[data-pick="${sid}"]:checked`)].map(x => x.value);
  if (!codes.length) return toast('Vyber aspoň jeden produkt');
  const s = supplierById(sid);
  let mail = buildEmail(sid, codes, ui.includeRefs);
  const draw = () => {
    $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal">
      <div class="modal-head"><h2>✉ Objednávka · ${flag(s.country)} ${esc(s.name)}</h2><button class="icon-btn" data-close>✕</button></div>
      ${!s.email ? `<div class="notice warn">Dodavatel nemá vyplněný e-mail. Doplň ho v záložce Dodavatelé.</div>` : ''}
      ${(() => { const n = codes.filter(c => !prod(c).supplierName).length; return n ? `<div class="notice">U ${n} ${n === 1 ? 'produktu' : 'produktů'} chybí anglický název, v e-mailu je proto jen kód. Doplníš ho přes ✎ u produktu — příště už se použije automaticky.</div>` : ''; })()}
      <div class="stack">
        <label class="field"><span>Komu</span><div class="copy-box"><input type="text" id="m-to" value="${esc(mail.to)}"><button class="btn sm" data-mcopy="m-to">Kopírovat</button></div></label>
        <label class="field"><span>Předmět</span><div class="copy-box"><input type="text" id="m-subject" value="${esc(mail.subject)}"><button class="btn sm" data-mcopy="m-subject">Kopírovat</button></div></label>
        <label class="field"><span>Text e-mailu</span><div class="copy-box"><textarea id="m-body" class="mail-body">${esc(mail.body)}</textarea><button class="btn sm" data-mcopy="m-body">Kopírovat</button></div></label>
        <label class="row small muted" style="cursor:pointer"><input type="checkbox" id="m-refs" ${ui.includeRefs ? 'checked' : ''}> Uvést u položek čísla našich objednávek</label>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" data-close>Zavřít</button>
        <button class="btn primary" id="m-done">✓ Odesláno — označit jako objednané</button>
      </div></div></div>`;
    const root = $('#modal-root');
    root.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
    root.querySelector('.modal-back').onclick = e => { if (e.target.classList.contains('modal-back')) closeModal(); };
    root.querySelectorAll('[data-mcopy]').forEach(b => b.onclick = e => { e.preventDefault(); copyText($('#' + b.dataset.mcopy).value); });
    $('#m-refs').onchange = e => { ui.includeRefs = e.target.checked; mail = buildEmail(sid, codes, ui.includeRefs); draw(); };
    $('#m-done').onclick = async () => {
      await api('POST', '/api/batches', { supplierId: sid, to: $('#m-to').value, subject: $('#m-subject').value, body: $('#m-body').value, lines: mail.lines, keys: mail.keys });
      closeModal(); toast('Označeno jako objednané ✓'); render();
    };
  };
  draw();
}
function closeModal() { $('#modal-root').innerHTML = ''; }

// ---------- supplier / product modals ----------
function editSupplier(id, thenAssignCode) {
  const s = supplierById(id) || { id: '', name: '', country: 'DE', email: '', contact: '', customerNo: '', notes: '' };
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
    const data = { id: s.id || undefined };
    for (const k of ['name', 'country', 'email', 'contact', 'customerNo', 'notes']) data[k] = $('#f-' + k).value.trim();
    if (!data.name) return toast('Vyplň název');
    const before = new Set(S.suppliers.map(x => x.id));
    await api('POST', '/api/suppliers', data);
    if (thenAssignCode) {
      const created = S.suppliers.find(x => !before.has(x.id));
      if (created) await api('PUT', '/api/products', { code: thenAssignCode, data: { supplierId: created.id } });
    }
    closeModal(); toast('Uloženo ✓'); render();
  };
}

function editProduct(code) {
  const p = prod(code);
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal">
    <div class="modal-head"><h2>Produkt <code>${esc(code)}</code></h2><button class="icon-btn" data-close>✕</button></div>
    <p class="muted small" style="margin-top:0">${esc(p.name)}</p>
    <div class="stack">
      <label class="field"><span>Dodavatel</span>${supplierSelect(code, p.supplierId || '', 'no-auto').replace('<option value="__new">＋ Nový dodavatel…</option>', '')}</label>
      <label class="field"><span>Kód produktu u dodavatele</span><input type="text" id="p-supplierCode" placeholder="${esc(code)}" value="${esc(p.supplierCode)}"></label>
      <label class="field"><span>Název produktu pro dodavatele (anglicky)</span><input type="text" id="p-supplierName" placeholder="${esc(p.name)}" value="${esc(p.supplierName)}"></label>
      <div class="small muted">Prázdná pole = v e-mailu se použije náš kód a název ze Shoptetu.</div>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="p-save">Uložit</button></div>
  </div></div>`;
  $('#modal-root').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  $('#p-save').onclick = async () => {
    await api('PUT', '/api/products', { code, data: {
      supplierId: $('#modal-root select').value,
      supplierCode: $('#p-supplierCode').value.trim(), supplierName: $('#p-supplierName').value.trim(),
    } });
    closeModal(); toast('Uloženo ✓'); render();
  };
}

// ---------- bindings ----------
function bind() {
  const V = $('#view');
  V.querySelectorAll('select[data-assign]').forEach(sel => sel.onchange = async () => {
    const code = sel.dataset.assign;
    if (sel.value === '__new') return editSupplier('', code);
    await api('PUT', '/api/products', { code, data: { supplierId: sel.value } });
    toast('Přiřazeno ✓'); render();
  });
  V.querySelectorAll('[data-email]').forEach(b => b.onclick = () => openEmail(b.dataset.email));
  V.querySelectorAll('[data-all]').forEach(cb => cb.onchange = () => V.querySelectorAll(`[data-pick="${cb.dataset.all}"]`).forEach(x => x.checked = cb.checked));
  V.querySelectorAll('[data-editprod]').forEach(b => b.onclick = () => editProduct(b.dataset.editprod));
  V.querySelectorAll('[data-editsup]').forEach(b => b.onclick = () => editSupplier(b.dataset.editsup));
  V.querySelectorAll('[data-delsup]').forEach(b => b.onclick = async () => {
    const s = supplierById(b.dataset.delsup);
    if (!confirm(`Smazat dodavatele ${s.name}? Jeho produkty budou bez dodavatele.`)) return;
    await api('DELETE', '/api/suppliers/' + s.id); render();
  });
  V.querySelectorAll('[data-ordered]').forEach(cb => cb.onchange = async () => { await api('PUT', '/api/ordered', { key: cb.dataset.ordered, ordered: cb.checked }); render(); });
  V.querySelectorAll('[data-toggle-none]').forEach(b => b.onclick = () => { ui.showNone = !ui.showNone; render(); });
  V.querySelectorAll('[data-histtoggle]').forEach(b => b.onclick = () => { ui.histOpen[b.dataset.histtoggle] = !ui.histOpen[b.dataset.histtoggle]; render(); });
  V.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { const bt = S.batches.find(x => x.id === b.dataset.b); copyText(bt[b.dataset.copy]); });
  V.querySelectorAll('[data-delbatch]').forEach(b => b.onclick = async () => {
    if (!confirm('Zrušit tuto objednávku? Položky se vrátí do „K objednání“.')) return;
    await api('DELETE', '/api/batches/' + b.dataset.delbatch); render();
  });
  const ps = $('#prod-search');
  if (ps) ps.oninput = () => { ui.search = ps.value; const pos = ps.selectionStart; render(); const n = $('#prod-search'); n.focus(); n.setSelectionRange(pos, pos); };
  const ss = $('#save-settings');
  if (ss) ss.onclick = async () => {
    const data = { mapping: { ...S.settings.mapping } };
    for (const k of ['csvUrl', 'statusValue', 'companyName', 'subjectTemplate', 'extraNote', 'signature']) data[k] = $('#s-' + k).value;
    V.querySelectorAll('[data-map]').forEach(sel => data.mapping[sel.dataset.map] = sel.value);
    ss.disabled = true; ss.textContent = 'Ukládám…';
    await api('PUT', '/api/settings', data); toast('Nastavení uloženo ✓'); render();
  };
}

// ---------- login ----------
function renderLogin(msg = '', email = '') {
  $('#crumb').innerHTML = '';
  $('#user').innerHTML = '';
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
    const email = $('#l-email').value.trim();
    const { error } = await sb.auth.signInWithPassword({ email, password: $('#l-pass').value });
    if (error) { renderLogin(error.message === 'Invalid login credentials' ? 'Špatný e-mail nebo heslo.' : error.message, email); $('#l-pass').focus(); }
  };
}
function renderUser(session) {
  $('#user').innerHTML = `<button class="btn sm ghost" id="logout" title="${esc(session.user.email)}">Odhlásit</button>`;
  $('#logout').onclick = () => sb.auth.signOut();
}

// ---------- start ----------
let session = null;
window.addEventListener('hashchange', () => { if (!session) return; closeModal(); render(); window.scrollTo(0, 0); });
async function load() { try { await api('GET', '/api/state'); } catch {} render(); }
sb.auth.onAuthStateChange((_ev, s) => {
  const was = session; session = s;
  if (!s) { S = null; return renderLogin(); }
  renderUser(s);
  if (!was) setTimeout(() => { render(); load(); }, 0); // mimo callback (doporučení Supabase)
});
// obnova dat každou minutu (jen když uživatel zrovna nic nevyplňuje)
setInterval(() => {
  if (!session || busy || document.hidden || $('#modal-root').innerHTML) return;
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
  if (route().tab === 'nastaveni') return;
  load();
}, 60e3);
document.addEventListener('visibilitychange', () => { if (session && !document.hidden && !$('#modal-root').innerHTML) load(); });
