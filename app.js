// Vinylor Hub — frontend (GitHub Pages + Supabase)
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { offerPdf } from './pdf.js';
import { APP_VERSION, APP_CHANNEL, APP_BUILD, CHANGELOG } from './version.js';

const { createClient } = window.supabase; // knihovna je přímo v aplikaci (vendor/supabase.js)
// Relace: na důvěryhodném zařízení přežije zavření prohlížeče (localStorage), jinak jen do zavření okna (sessionStorage).
const trustedDevice = () => { try { return localStorage.getItem('vh_trusted') === '1'; } catch { return false; } };
const setTrusted = on => { try { on ? localStorage.setItem('vh_trusted', '1') : localStorage.removeItem('vh_trusted'); } catch {} };
const authStore = () => { try { return trustedDevice() ? localStorage : sessionStorage; } catch { return null; } };
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: {
  persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'vh-auth',
  storage: {
    getItem: k => { try { return authStore()?.getItem(k) ?? null; } catch { return null; } },
    setItem: (k, v) => { try { authStore()?.setItem(k, v); } catch {} },
    removeItem: k => { try { localStorage.removeItem(k); } catch {} try { sessionStorage.removeItem(k); } catch {} },
  },
} });
const Calc = window.Calc;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const M = Calc.money;
const STATUSES = { draft: 'Koncept', sent: 'Odeslána', postponed: 'Odložena', confirmed: 'Překlopena do Shoptetu', rejected: 'Zamítnuta' };
const STATUS_ORDER = Object.keys(STATUSES);
const STATUS_HINT = {
  draft: 'rozpracovaná, zákazník ji ještě nemá',
  sent: 'zákazník nabídku dostal',
  postponed: 'líbí se mu, ale ještě se nerozhodl',
  confirmed: 'potvrzeno, objednávka je v Shoptetu',
  rejected: 'zákazník nabídku odmítl',
};
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

const S = { me: null, users: [], offers: [], settings: null, products: null, view: ls.get('vh_view') || 'over', q: '', who: '', fStatus: '' };
const VERSION_LABEL = `v${APP_VERSION}${APP_CHANNEL ? ' ' + APP_CHANNEL : ''}`;
const CREDIT = `<div class="credit">Postaveno na struktuře <b>SmartJoi</b>™<br>vytvořil <a href="https://www.jointshon.cz" target="_blank" rel="noopener">jointshon.cz</a><br><button type="button" class="ver-btn" data-ver title="Co je nového">${VERSION_LABEL}</button></div>`;
let leaveGuard = null;
let routeCleanup = null;
// ---------- verze aplikace ----------
document.addEventListener('click', e => {
  if (!e.target.closest('[data-ver]')) return;
  modal({
    title: `Vinylor Hub ${VERSION_LABEL}`,
    body: `<p class="muted small">Sestaveno ${esc(czDate(APP_BUILD))}${APP_CHANNEL === 'beta' ? ' · beta = ještě se ladí, chyby prosím hlas správci' : ''}</p>
      <div class="changelog">${CHANGELOG.map(c => `<div><b>v${esc(c.v)}</b> <span class="muted small">${esc(czDate(c.d))}</span><ul>${c.t.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div>`,
    actions: [{ label: 'Zavřít', value: null, cls: 'primary' }],
  });
});
// když je na serveru novější verze, nabídnout obnovení (kontrola při návratu do okna a každých 10 minut)
let updateShown = false;
async function checkForUpdate() {
  if (updateShown) return;
  try {
    const m = await import('./version.js?t=' + Date.now());
    if (m.APP_VERSION === APP_VERSION && m.APP_BUILD === APP_BUILD) return;
    updateShown = true;
    const b = document.createElement('div');
    b.className = 'upd-banner';
    b.innerHTML = `<span>Je dostupná nová verze <b>v${esc(m.APP_VERSION)}${m.APP_CHANNEL ? ' ' + esc(m.APP_CHANNEL) : ''}</b>. Rozepsané změny se před obnovením uloží.</span><button class="btn sm primary" type="button">Obnovit</button>`;
    document.body.appendChild(b);
    $('button', b).onclick = async () => { if (leaveGuard) { try { await leaveGuard(); } catch {} } location.reload(); };
  } catch { /* offline — příště */ }
}
setInterval(checkForUpdate, 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });

// ---------- světlý / tmavý režim ----------
const getTheme = () => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('vh_theme', t); } catch {}
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0a0a0a' : '#f4f5f3');
  $$('.theme-toggle button').forEach(b => b.classList.toggle('on', b.dataset.theme === t));
}
const themeToggle = () => `<div class="theme-toggle" role="group" aria-label="Režim vzhledu"><button type="button" data-theme="light" class="${getTheme() === 'light' ? 'on' : ''}" title="Světlý režim">☀︎ Světlý</button><button type="button" data-theme="dark" class="${getTheme() === 'dark' ? 'on' : ''}" title="Tmavý režim">☾ Tmavý</button></div>`;
document.addEventListener('click', e => { const b = e.target.closest('.theme-toggle button[data-theme]'); if (b) setTheme(b.dataset.theme); }); // úklid při odchodu z obrazovky (např. živé odběry)

// ---------- pomocné ----------
function check({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}
async function fetchAll(build) {
  const out = []; const page = 1000;
  for (let from = 0; ; from += page) {
    const rows = check(await build().range(from, from + page - 1));
    out.push(...rows);
    if (rows.length < page) return out;
  }
}
const userName = id => (S.users.find(u => u.id === id) || {}).name || '';
const initials = id => userName(id).split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase() || '?';
const czDate = s => { if (!s) return ''; const d = new Date(s.length === 10 ? s + 'T00:00' : s); return d.toLocaleDateString('cs-CZ'); };
const czDateTime = s => new Date(s).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const ago = s => {
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return 'právě teď'; if (m < 60) return `před ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `před ${h} h`;
  const d = Math.round(h / 24); return d === 1 ? 'včera' : `před ${d} dny`;
};
const daysSince = s => Math.floor((Date.now() - new Date(s).getTime()) / 864e5);
const custLabel = c => c.company || c.name || c.email || c.phone || 'Bez zákazníka';
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const stat = s => `<span class="st" data-s="${s}">${esc(STATUSES[s] || s)}</span>`;
const emptyCustomer = () => ({ name: '', company: '', ico: '', dic: '', street: '', city: '', country: 'Česká republika', email: '', phone: '' });
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toNum = v => { const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const numStr = n => String(n ?? '').replace('.', ',');
function highlight(text, q) {
  const t = String(text ?? ''); const tokens = fold(q).split(/\s+/).filter(x => x.length > 1);
  if (!tokens.length) return esc(t);
  const f = fold(t); const marks = new Array(t.length).fill(false);
  for (const tok of tokens) { let i = f.indexOf(tok); while (i >= 0) { for (let k = i; k < i + tok.length; k++) marks[k] = true; i = f.indexOf(tok, i + 1); } }
  let out = '', open = false;
  for (let i = 0; i < t.length; i++) {
    if (marks[i] && !open) { out += '<mark>'; open = true; } else if (!marks[i] && open) { out += '</mark>'; open = false; }
    out += esc(t[i]);
  }
  return out + (open ? '</mark>' : '');
}
function tween(el, to, fmt = M) {
  if (!el) return;
  const from = Number(el.dataset.v || 0); el.dataset.v = to;
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 420;
  const step = now => { const p = Math.min(1, Math.max(0, (now - t0) / dur)); const e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
  setTimeout(() => { if (Number(el.dataset.v) === to) el.textContent = fmt(to); }, dur + 80); // pojistka (např. tab na pozadí)
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}

// ---------- toast, dialogy, menu ----------
function toast(msg, opts = {}) {
  if (opts === true) opts = { err: true };
  const d = document.createElement('div');
  d.className = 't' + (opts.err ? ' err' : '');
  d.innerHTML = `<span>${esc(msg)}</span>${opts.action ? `<button>${esc(opts.action.label)}</button>` : ''}`;
  const close = () => { d.classList.add('out'); setTimeout(() => d.remove(), 250); };
  if (opts.action) $('button', d).onclick = () => { opts.action.fn(); close(); };
  $('#toast').appendChild(d);
  setTimeout(close, opts.action ? 6000 : opts.err ? 5000 : 2600);
}
function modal({ title, body = '', actions = [{ label: 'Zavřít', value: null }], focus }) {
  return new Promise(resolve => {
    const bd = document.createElement('div');
    bd.className = 'backdrop';
    bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${body}<div class="acts">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
    const done = v => { bd.classList.add('out'); document.removeEventListener('keydown', key); setTimeout(() => bd.remove(), 150); resolve(v); };
    const valueOf = a => (typeof a.value === 'function' ? a.value(bd) : a.value);
    const key = e => {
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { const a = actions[actions.length - 1]; e.preventDefault(); done(valueOf(a)); }
    };
    bd.addEventListener('mousedown', e => { if (e.target === bd) done(null); });
    $$('[data-i]', bd).forEach(b => b.onclick = () => done(valueOf(actions[b.dataset.i])));
    document.addEventListener('keydown', key);
    document.body.appendChild(bd);
    setTimeout(() => { const f = focus ? $(focus, bd) : $('.acts .btn:last-child', bd); if (f) { f.focus(); if (f.select) f.select(); } }, 30);
  });
}
const confirmBox = (title, text, { ok = 'Potvrdit', danger = false } = {}) => modal({
  title, body: `<p>${esc(text)}</p>`, actions: [{ label: 'Zrušit', value: false }, { label: ok, value: true, cls: danger ? 'danger solid' : 'primary' }],
});
const promptBox = (title, label, value = '', { placeholder = '', ok = 'Uložit', text = '' } = {}) => modal({
  title, body: `${text ? `<p>${esc(text)}</p>` : ''}<label>${esc(label)}</label><input class="pin" value="${esc(value)}" placeholder="${esc(placeholder)}">`,
  focus: '.pin', actions: [{ label: 'Zrušit', value: null }, { label: ok, value: bd => $('.pin', bd).value, cls: 'primary' }],
});
const passwordBox = (who, pw) => modal({
  title: 'Dočasné heslo', body: `<p>Předej ho uživateli <b>${esc(who)}</b>. Po prvním přihlášení si ho změní.</p><div class="pw">${esc(pw)}</div>`,
  actions: [{ label: 'Zkopírovat a zavřít', value: true, cls: 'primary' }],
}).then(() => navigator.clipboard?.writeText(pw).catch(() => {}));
function popMenu(anchor, items) {
  document.querySelectorAll('.menu').forEach(m => m.remove());
  return new Promise(resolve => {
    const m = document.createElement('div');
    m.className = 'menu';
    m.innerHTML = items.map((it, i) => `<button data-i="${i}" ${it.s ? `data-s="${it.s}"` : ''}>${esc(it.label)}</button>`).join('');
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + 'px';
    m.style.top = (r.bottom + m.offsetHeight + 8 > innerHeight ? r.top - m.offsetHeight - 6 : r.bottom + 6) + 'px';
    const close = v => { m.remove(); document.removeEventListener('mousedown', out, true); resolve(v); };
    const out = e => { if (!m.contains(e.target)) close(null); };
    setTimeout(() => document.addEventListener('mousedown', out, true));
    $$('button', m).forEach(b => b.onclick = e => { e.stopPropagation(); close(items[b.dataset.i].value); });
  });
}

// ---------- data ----------
const fromRow = r => ({
  id: r.id, currency: r.currency === 'EUR' ? 'EUR' : 'CZK', archived: !!r.archived, archivedAt: r.archived_at || null, number: r.number, status: r.status, statusAt: r.status_at, date: r.date, validUntil: r.valid_until,
  customer: { ...emptyCustomer(), ...(r.customer || {}) }, recipient: r.recipient || '', items: r.items || [],
  note: r.note || '', terms: r.terms || '', shoptetOrder: r.shoptet_order || '', net: Number(r.net), total: Number(r.total),
  createdBy: r.created_by, issuedBy: r.issued_by, lastEditBy: r.last_edit_by, version: r.version,
  createdAt: r.created_at, updatedAt: r.updated_at, commentCount: r.offer_comments ? r.offer_comments[0]?.count || 0 : 0,
});
// nabídky v eurech (slovenský e-shop): měna je u každé nabídky, ceny z CZ feedu se přepočítají kurzem a slovenským DPH
const offSym = o => (o && o.currency === 'EUR' ? '€' : 'Kč');
const offMoney = (n, o) => M(n) + ' ' + offSym(o);
const offStep = (o, st) => (o && o.currency === 'EUR' ? 0.01 : st.priceStep);
const offVatOpts = o => (o && o.currency === 'EUR' ? [23, 19, 5, 0] : [21, 12, 0]);
const offVatDefault = (o, st) => (o && o.currency === 'EUR' ? Number(st.defaultVatEur) || 23 : Number(st.defaultVat) || 21);
const VAT_CZ_TO_SK = { 21: 23, 12: 19, 0: 0 }, VAT_SK_TO_CZ = { 23: 21, 19: 12, 5: 12, 0: 0 };
const offRate = st => Number(st.eurRate) || 24.2;
// cena s DPH v CZK (český e-shop) → cena s DPH v EUR (výchozí návrh, jde přepsat)
const czkToEur = (price, st) => Calc.r2(Number(price || 0) / (1 + (Number(st.defaultVat) || 21) / 100) / offRate(st) * (1 + (Number(st.defaultVatEur) || 23) / 100));
const sumByCur = list => { const c = list.filter(o => o.currency !== 'EUR').reduce((a, o) => a + o.total, 0), e = list.filter(o => o.currency === 'EUR').reduce((a, o) => a + o.total, 0); return { czk: c, eur: e }; };
const sumTxtCur = list => { const { czk, eur } = sumByCur(list); return [czk || !eur ? M(czk).replace(/,\d\d$/, '') + ' Kč' : '', eur ? M(eur).replace(/,\d\d$/, '') + ' €' : ''].filter(Boolean).join(' + '); };
async function loadSettings() {
  S.settings = check(await sb.from('hub_settings').select('*').eq('id', 1).single());
  return S.settings;
}
const cfg = () => S.settings.data;
async function loadUsers() {
  S.users = check(await sb.from('hub_profiles').select('*').order('name'));
  S.me = S.users.find(u => u.id === S.me.id) || S.me;
}
async function loadProducts(force) {
  if (S.products && !force) return S.products;
  const rows = await fetchAll(() => sb.from('hub_products').select('code,name,variant,supplier,price_vat,action_price,visible,ean,mpn,manufacturer,keywords,category').order('code'));
  S.products = rows.map(p => ({ ...p, priceVat: Number(p.price_vat), actionPrice: p.action_price == null ? null : Number(p.action_price), fcode: fold(p.code), text: fold(`${p.code} ${p.name} ${p.variant} ${p.supplier} ${p.ean || ''} ${p.mpn || ''} ${p.manufacturer || ''} ${p.keywords || ''}`) }));
  return S.products;
}
function searchProducts(q, includeHidden) {
  const fq = fold(q).trim();
  const tokens = fq.split(/\s+/).filter(Boolean);
  if (!tokens.length || !S.products) return [];
  const out = [];
  for (const p of S.products) {
    if (!includeHidden && !p.visible) continue;
    if (!tokens.every(t => p.text.includes(t))) continue;
    out.push({ score: (p.fcode === fq ? 0 : p.fcode.startsWith(fq) ? 1 : 2) + (p.visible ? 0 : 3), p });
  }
  out.sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name, 'cs') || a.p.code.localeCompare(b.p.code));
  return out.slice(0, 40).map(x => x.p);
}
// dřívější zákazníci z nabídek (pro rychlé vyplnění)
async function knownCustomers() {
  if (!S.offers.length) { try { await refreshOffers(true); } catch {} }
  const map = new Map();
  for (const o of S.offers) {
    const c = o.customer; if (!c.name && !c.company) continue;
    const key = fold(c.ico || c.email || c.company + '|' + c.name);
    if (!map.has(key)) map.set(key, { ...c, _last: o.date, _count: 1 }); else map.get(key)._count++;
  }
  return [...map.values()];
}
// ARES — veřejný registr firem (CORS povolený)
const ARES = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';
function aresMap(x) {
  const s = x.sidlo || {};
  const cislo = [s.cisloDomovni, s.cisloOrientacni].filter(Boolean).join('/') + (s.cisloOrientacniPismeno || '');
  const street = s.nazevUlice ? `${s.nazevUlice} ${cislo}` : [s.nazevCastiObce || s.nazevObce, cislo].filter(Boolean).join(' ');
  const psc = s.psc ? String(s.psc).replace(/^(\d{3})(\d{2})$/, '$1 $2') : '';
  return {
    company: x.obchodniJmeno || '', ico: x.ico || '', dic: x.dic || '',
    street: street.trim(), city: [psc, s.nazevMestskehoObvodu || s.nazevObce].filter(Boolean).join(' '),
    country: s.nazevStatu || 'Česká republika', _addr: s.textovaAdresa || '',
  };
}
async function aresSearch(q) {
  const t = /^[\d\s]+$/.test(q.trim()) ? q.replace(/\s/g, '') : q.trim();
  if (/^\d{6,8}$/.test(t)) {
    const r = await fetch(`${ARES}/${t.padStart(8, '0')}`);
    if (!r.ok) return [];
    return [aresMap(await r.json())];
  }
  if (t.length < 3) return [];
  const r = await fetch(`${ARES}/vyhledat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ obchodniJmeno: t, pocet: 6 }) });
  if (!r.ok) return [];
  return ((await r.json()).ekonomickeSubjekty || []).map(aresMap);
}

// ---------- router ----------
// uživatel musí do ~0,4 s vidět, že se něco děje: tenký pruh nahoře (objeví se až po 150 ms, ať neprobliká); po návratu z detailu se vrátí poloha seznamu
const scrollMem = {}; let prevHash = '';
async function route() {
  const h = location.hash || '#/';
  if (prevHash && prevHash !== h) scrollMem[prevHash] = window.scrollY;
  const from = prevHash; prevHash = h;
  document.body.classList.add('nav-busy');
  try { await routeInner(); } finally { document.body.classList.remove('nav-busy'); }
  if (from && /^#\/(o|s|oj|svoz|k|b|inventura)\//.test(from) && !/^#\/(o|s|oj|svoz|k|b|inventura)\//.test(h) && scrollMem[h] != null) window.scrollTo(0, scrollMem[h]);
}
async function routeInner() {
  const h = location.hash || '#/';
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderLogin();
  if (idleExpired()) return logout('Odhlášeno po 2 hodinách nečinnosti.');
  const { data: aal, error: aalErr } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalErr || aal?.currentLevel !== 'aal2') { S.me = null; return renderMfa(); }
  touchActivity();
  if (!S.me) {
    try {
      S.me = { id: session.user.id };
      await loadUsers();
      if (!S.users.some(u => u.id === session.user.id)) throw new Error('Tento účet nemá do Vinylor Hubu přístup.');
      await loadSettings();
    } catch (e) {
      return logout(e.message);
    }
  }
  document.body.classList.toggle('no-tb', /^#\/(o|s)\//.test(h));
  if (leaveGuard) { const g = leaveGuard; leaveGuard = null; await g(); }
  if (S.me.must_change && h !== '#/ucet') { location.hash = '#/ucet'; return; }
  if (routeCleanup) { const c = routeCleanup; routeCleanup = null; c(); }
  document.querySelectorAll('.menu, .sumbar').forEach(m => m.remove());
  let m;
  if ((m = h.match(/^#\/o\/([\w-]+)/))) return renderEditor(m[1]);
  if ((m = h.match(/^#\/s\/([\w-]+)/))) return renderReceipt(m[1]);
  if (h === '#/sklad') return renderStock();
  if (h === '#/pohyby') return renderMoves();
  if (h === '#/zasoby') return renderZasoby();
  if (h === '#/rozvozy') return renderRozvozy();
  if (h === '#/inventura') return renderInvList();
  if ((m = h.match(/^#\/inventura\/([\w-]+)/))) return renderInvDetail(m[1]);
  if (h === '#/svozy' || h === '#/objednavky') return renderOj();
  if (h === '#/kontejnery') return renderCt();
  if ((m = h.match(/^#\/k\/([\w-]+)/))) return renderContainer(m[1]);
  if ((m = h.match(/^#\/svoz\/([\w-]+)/))) return renderShipment(m[1]);
  if ((m = h.match(/^#\/oj\/(.+)$/))) return renderOjOrder(decodeURIComponent(m[1]));
  if (h === '#/navstevy') return renderVisits();
  if (h === '#/nastenka') return renderBoards();
  if ((m = h.match(/^#\/b\/([\w-]+)/))) return renderBoard(m[1]);
  if (h === '#/nastaveni') return renderSettings();
  if (h === '#/ucet') return renderAccount();
  if (h === '#/nabidky') return renderOffers();
  return renderHome();
}
window.addEventListener('hashchange', route);
route();
window.addEventListener('focus', () => { if ((location.hash || '#/') === '#/nabidky' && S.me) refreshOffers().catch(() => {}); });

const setSide = on => { $('#side')?.classList.toggle('open', on); $('#scrim')?.classList.toggle('on', on); };
// na telefonu se z tabulek dělají přehledné karty: každá buňka dostane popisek z hlavičky sloupce
function labelTables() {
  if (innerWidth > 820) return;
  $$('.main table.list').forEach(t => {
    const hs = [...t.querySelectorAll('thead th')].map(h => h.textContent.trim());
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (td.colSpan === 1 && !td.dataset.l && hs[i]) td.dataset.l = hs[i]; }));
  });
}
{ let q = 0; new MutationObserver(() => { if (q) return; q = requestAnimationFrame(() => { q = 0; labelTables(); }); }).observe(document.getElementById('app'), { childList: true, subtree: true }); }
const NAV_SVG = {
  home: '<path d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5M10 20v-6h4v6"/>',
  offers: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  orders: '<path d="M2 6h11v10H2zM13 9h5l3 3v4h-8"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  rz: '<path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>',
  zs: '<path d="M4 20V9M10 20V4M16 20v-8M22 20H2"/><path d="m14 6 3-3 3 3"/>',
  inv: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4h6v3H9zM9 14l2 2 4-4"/>',
  stock: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  visits: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.4"/><path d="M17 14.2c2.4.3 4 2.2 4 4.8"/>',
  boards: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16M15 4v10"/>',
  ct: '<path d="M3 14h18l-2 5H5zM6 14V9h12v5M9 9V6h6v3"/>',
  moves: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9"/>',
  account: '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
};
const svgIco = k => `<svg class="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_SVG[k] || ''}</svg>`;
const pgHead = (key, title, sub = '', right = '') => `<div class="pg-head"><span class="pg-ico">${svgIco(key)}</span><div class="grow"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${right}</div>`;
const HB_TITLES = { home: 'Přehled', offers: 'Nabídky', orders: 'Objednávky & Sklad', stock: 'Objednávky & Sklad', inv: 'Inventura', zs: 'Zásoby', rz: 'Rozvozy', moves: 'Objednávky & Sklad', ct: 'Kontejnery', visits: 'Návštěvnost', boards: 'Nástěnka', settings: 'Nastavení', account: 'Můj účet' };
function shell(active, inner) {
  const nav = (href, key, icon, label) => `<a href="${href}" class="${active === key ? 'on' : ''}"><span class="ico">${svgIco(key)}</span><span>${label}</span></a>`;
  if (!$('.shell')) {
    $('#app').innerHTML = `
    <div class="mobile-top"><button id="menuBtn" aria-label="Menu">☰</button><b>Vinylor Hub</b></div>
    <div class="shell">
      <aside class="side" id="side"></aside>
      <div class="mainwrap">
        <header class="hubbar"><b id="hbTitle"></b>
          <label class="hb-search">${svgIco('search')}<input id="hbq" type="search" placeholder="Hledat objednávku, produkt, referenci…" autocomplete="off"><kbd>⌘ K</kbd></label>
          <span class="hb-date">${svgIco('cal')}<span id="hbDate"></span></span>
          <a class="hb-me" href="#/ucet" title="Můj účet"><span class="av">${initials(S.me.id)}</span><span class="hb-nm">${esc(S.me.name)}</span></a>
        </header>
        <main class="main" id="main"></main>
      </div>
    </div>
    <div class="scrim" id="scrim"></div>
    <nav class="tabbar" id="tabbar" aria-label="Hlavní navigace"></nav>`;
    $('#hbDate').textContent = new Date().toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
    $('#hbq').onkeydown = e => {
      if (e.key !== 'Enter') return; const v = e.target.value.trim(); if (!v) return;
      OJ.q = v; OJ.tab = 'potreba'; OJ.card = ''; ls.set('vh_oj_tab', 'potreba'); e.target.value = ''; e.target.blur();
      if (location.hash === '#/objednavky') route(); else location.hash = '#/objednavky';
    };
    addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && $('#hbq')) { e.preventDefault(); $('#hbq').focus(); $('#hbq').select(); } });
    $('#menuBtn').onclick = () => setSide(!$('#side').classList.contains('open'));
    $('#scrim').onclick = () => setSide(false);
  }
  $('#hbTitle').textContent = HB_TITLES[active] || 'Vinylor Hub';
  const tab = (href, key, icon, label) => `<a href="${href}" class="${active === key ? 'on' : ''}"><span class="ti">${icon}</span><span>${label}</span></a>`;
  $('#tabbar').innerHTML = `${tab('#/', 'home', '🏠', 'Přehled')}${tab('#/nabidky', 'offers', '📄', 'Nabídky')}${tab('#/objednavky', 'orders', '🚚', 'Objednávky')}${tab('#/sklad', 'stock', '📦', 'Sklad')}<button type="button" id="tbMenu" class="${['visits', 'settings', 'account', 'ct', 'moves', 'boards', 'inv'].includes(active) ? 'on' : ''}"><span class="ti">☰</span><span>Víc</span></button>`;
  $('#tbMenu').onclick = () => setSide(true);
  $('#side').innerHTML = `
    <a class="brand" href="#/"><img src="img/icon.png" alt=""><span>Vinylor Hub<small>automatizace</small></span></a>
    <nav class="nav">
      ${nav('#/', 'home', '🏠', 'Přehled')}
      ${nav('#/nabidky', 'offers', '📄', 'Nabídky')}
      ${nav('#/objednavky', 'orders', '🚚', 'Objednávky')}
      ${nav('#/sklad', 'stock', '📦', 'Naskladnění')}
      ${nav('#/inventura', 'inv', '📋', 'Inventura')}
      ${nav('#/zasoby', 'zs', '📈', 'Zásoby')}
      ${nav('#/rozvozy', 'rz', '📍', 'Rozvozy')}
      ${nav('#/navstevy', 'visits', '🚶', 'Návštěvnost')}
      ${nav('#/nastenka', 'boards', '🗂️', 'Nástěnka')}
      ${hasApp('kontejnery') ? nav('#/kontejnery', 'ct', '🚢', 'Kontejnery') : '<a class="soon" href="#" title="Zatím jen pro vybrané uživatele"><span class="ico">🚢</span><span>Kontejnery</span><em>🔒</em></a>'}
      ${nav('#/pohyby', 'moves', '📜', 'Historie pohybů')}
      <div class="nav-h">Systém</div>
      ${nav('#/nastaveni', 'settings', '⚙️', 'Nastavení')}
      ${nav('#/ucet', 'account', '👤', 'Můj účet')}
    </nav>
    <div class="me"><div class="who"><span class="av lg">${initials(S.me.id)}</span><div><b>${esc(S.me.name)}</b><a href="#/ucet">Účet</a><a href="#" id="logout">Odhlásit</a></div></div>${themeToggle()}${CREDIT}</div>`;
  $('#logout').onclick = e => { e.preventDefault(); logout(); };
  $('#side').onclick = e => { if (e.target.closest('a')) setSide(false); };
  // nový <main> bez posluchačů z předchozí obrazovky
  const old = $('#main'); const main = old.cloneNode(false); old.replaceWith(main);
  main.className = 'main';
  main.innerHTML = inner;
  void main.offsetWidth; main.classList.add('enter');
  window.scrollTo(0, 0);
}

// ---------- přihlášení (e-mail + heslo → kód z aplikace 2FA) ----------
const IDLE_MS = 2 * 60 * 60 * 1000; // po 2 hodinách nečinnosti odhlásit
const touchActivity = () => { try { localStorage.setItem('vh_act', String(Date.now())); } catch {} };
const idleExpired = () => { try { const t = Number(localStorage.getItem('vh_act') || 0); return t && Date.now() - t > IDLE_MS; } catch { return false; } };
['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, () => { if (S.me) touchActivity(); }, { passive: true }));
setInterval(() => { if (S.me && idleExpired()) logout('Odhlášeno po 2 hodinách nečinnosti.'); }, 60_000);

async function logout(msg = '', scope = 'local') {
  if (leaveGuard) { try { await leaveGuard(); } catch {} leaveGuard = null; }
  if (routeCleanup) { try { routeCleanup(); } catch {} routeCleanup = null; }
  try { await sb.rpc('hub_log', { p_action: 'logout', p_detail: { scope } }); } catch {}
  try { await sb.auth.signOut({ scope }); } catch {}
  Object.assign(S, { me: null, users: [], offers: [], products: null, settings: null });
  document.querySelectorAll('.sumbar, .backdrop, .menu').forEach(x => x.remove());
  history.replaceState(null, '', location.pathname + location.search + '#/');
  renderLogin(msg);
}

const loginFails = { n: 0, until: 0 };
async function renderLogin(msg = '') {
  let lastEmail = '';
  try { lastEmail = localStorage.getItem('vh_last_email') || ''; } catch {}
  $('#app').innerHTML = `
  <div class="login">${themeToggle()}<form class="panel" id="lf" autocomplete="on">
    <img class="logo" src="img/logo.png" alt="Vinylor">
    <h1>Vinylor Hub</h1>
    <div class="f"><label for="le-mail">E-mail</label><input id="le-mail" name="email" type="email" autocomplete="username" required value="${esc(lastEmail)}" placeholder="jmeno@vinylor.cz"></div>
    <div class="f"><label for="le-pw">Heslo</label><input id="le-pw" name="password" type="password" autocomplete="current-password" required></div>
    <label class="trust"><input type="checkbox" id="le-trust" ${trustedDevice() ? 'checked' : ''}> Důvěryhodné zařízení <span class="muted">— zůstat přihlášen i po zavření prohlížeče</span></label>
    <div class="err" id="le" role="alert">${esc(msg)}</div>
    <button class="btn primary lg" style="width:100%;margin-top:4px">Pokračovat</button>
    <div class="login-sec">🔒 Přístup jen pro tým Vinylor. Po hesle následuje kód z ověřovací aplikace v telefonu.</div>
    ${CREDIT}
  </form></div>`;
  $(lastEmail ? '#le-pw' : '#le-mail').focus();
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    if (Date.now() < loginFails.until) { $('#le').textContent = `Příliš mnoho pokusů. Zkus to znovu za ${Math.ceil((loginFails.until - Date.now()) / 1000)} s.`; return; }
    const f = new FormData(e.target);
    const email = String(f.get('email') || '').trim().toLowerCase();
    setTrusted($('#le-trust').checked);
    const btn = $('button', e.target); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Ověřuji…';
    const { error } = await sb.auth.signInWithPassword({ email, password: String(f.get('password') || '') });
    if (error) {
      loginFails.n++; if (loginFails.n >= 5) { loginFails.until = Date.now() + 60_000 * Math.min(10, loginFails.n - 4); }
      btn.disabled = false; btn.textContent = 'Pokračovat';
      $('#le').textContent = /rate|too many/i.test(error.message) ? 'Příliš mnoho pokusů. Zkus to za chvíli.' : 'Nesprávný e-mail nebo heslo.';
      const p = $('#lf'); p.classList.remove('shake'); void p.offsetWidth; p.classList.add('shake');
      $('#le-pw').value = ''; $('#le-pw').focus();
      return;
    }
    loginFails.n = 0;
    try { localStorage.setItem('vh_last_email', email); } catch {}
    touchActivity();
    try { await sb.rpc('hub_log', { p_action: 'login', p_detail: { trusted: trustedDevice(), ua: navigator.userAgent.slice(0, 120), ver: APP_VERSION } }); } catch {}
    S.me = null;
    route();
  };
}

// druhý krok: ověřovací kód (TOTP) — nebo první nastavení 2FA
async function renderMfa() {
  let prof = null;
  try { prof = check(await sb.rpc('hub_my_profile'))[0]; } catch {}
  if (!prof || !prof.active) { await logout('Tento účet nemá do Vinylor Hubu přístup.'); return; }
  const { data: lf, error } = await sb.auth.mfa.listFactors();
  if (error) { await logout('Přihlášení vypršelo, přihlas se znovu.'); return; }
  const verified = (lf.totp || []).filter(f => f.status === 'verified');
  const box = (title, body) => {
    $('#app').innerHTML = `<div class="login">${themeToggle()}<form class="panel mfa" id="mf">
      <div class="mfa-ico">🔐</div><h1>${esc(title)}</h1>${body}
      <div class="err" id="me" role="alert"></div>
      <button class="btn primary lg" style="width:100%">Ověřit</button>
      <button type="button" class="btn ghost" id="mfOut" style="width:100%;margin-top:6px">Zpět na přihlášení</button>
    </form></div>`;
    $('#mfOut').onclick = () => logout();
  };
  const codeInput = `<input id="mf-code" class="code-in" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required>`;
  let factorId;
  if (verified.length) {
    factorId = verified[0].id;
    box(`Ahoj, ${prof.name.split(' ')[0]}`, `<p class="muted">Zadej 6místný kód z ověřovací aplikace v telefonu (Google Authenticator, Microsoft Authenticator…).</p>${codeInput}`);
  } else {
    // první přihlášení: nastavení 2FA
    for (const f of (lf.all || []).filter(f => f.factor_type === 'totp' && f.status !== 'verified')) { try { await sb.auth.mfa.unenroll({ factorId: f.id }); } catch {} }
    const { data: en, error: e2 } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Vinylor Hub ' + new Date().toLocaleDateString('cs-CZ') + ' ' + Math.random().toString(36).slice(2, 6) });
    if (e2) { box('Dvoufázové ověření', `<p class="err">Nepodařilo se připravit 2FA: ${esc(e2.message)}</p>`); return; }
    factorId = en.id;
    box('Zapni si dvoufázové ověření', `
      <ol class="mfa-steps">
        <li>Nainstaluj do telefonu <b>Google Authenticator</b> nebo <b>Microsoft Authenticator</b>.</li>
        <li>V aplikaci zvol <b>Přidat účet → Naskenovat QR kód</b> a naskenuj:</li>
      </ol>
      <img class="mfa-qr" src="${esc(en.totp.qr_code)}" alt="QR kód pro ověřovací aplikaci">
      <details class="mfa-secret"><summary>Nejde naskenovat? Opiš klíč ručně</summary><code>${esc(en.totp.secret.replace(/(.{4})/g, '$1 ').trim())}</code></details>
      <ol class="mfa-steps" start="3"><li>Opiš sem 6místný kód, který aplikace ukazuje:</li></ol>${codeInput}`);
  }
  const ci = $('#mf-code'); ci.focus();
  ci.addEventListener('input', () => { ci.value = ci.value.replace(/\D/g, '').slice(0, 6); if (ci.value.length === 6) $('#mf').requestSubmit(); });
  $('#mf').onsubmit = async e => {
    e.preventDefault();
    const btn = $('#mf .btn.primary'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Ověřuji…';
    const { error: ve } = await sb.auth.mfa.challengeAndVerify({ factorId, code: ci.value });
    if (ve) {
      btn.disabled = false; btn.textContent = 'Ověřit';
      $('#me').textContent = /rate|too many/i.test(ve.message) ? 'Příliš mnoho pokusů, chvíli počkej.' : 'Kód nesedí. Zkontroluj čas v telefonu a zadej aktuální kód.';
      ci.value = ''; ci.focus(); const p = $('#mf'); p.classList.remove('shake'); void p.offsetWidth; p.classList.add('shake');
      return;
    }
    try { await sb.rpc('hub_log', { p_action: verified.length ? 'mfa_verified' : 'mfa_enrolled', p_detail: {} }); } catch {}
    touchActivity();
    if (!verified.length) toast('Dvoufázové ověření je zapnuté ✓');
    S.me = null; route();
  };
}

// ---------- Přehled: domovská obrazovka ----------
const ojGoHash = (tab, f = {}) => { OJ.tab = tab; ls.set('vh_oj_tab', tab); Object.assign(OJ, { q: '', card: '', ...f }); location.hash = '#/objednavky'; };
function offerDonut(list, R = 42) {
  const n = st => list.filter(o => o.status === st).length;
  const parts = [['Překlopené', n('confirmed'), 'var(--s-confirmed)'], ['Rozjednané', n('sent') + n('postponed'), 'var(--s-sent)'], ['Zamítnuté', n('rejected'), 'var(--s-draft)']];
  const tot = parts.reduce((x, p) => x + p[1], 0) || 1; const C = 2 * Math.PI * R; let off = 0;
  const decided = n('confirmed') + n('rejected'); const rate = decided ? Math.round(100 * n('confirmed') / decided) : null;
  const arcs = parts.map(([l, v, c]) => { const len = C * v / tot; const el = `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${c}" stroke-width="9" stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 50 50)"/>`; off += len; return el; }).join('');
  return `<div class="donut"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="9"/>${arcs}</svg><div class="donut-c"><b>${rate == null ? '—' : rate + ' %'}</b><small>úspěšnost</small></div></div>
    <div class="donut-l">${parts.map(([l, v, c]) => `<div><i style="background:${c}"></i><span>${l}</span><b>${Math.round(100 * v / tot)} %</b><em>${v}</em></div>`).join('')}</div>`;
}
function lineChart(vals, labels) {
  const W = 300, H = 90, P = 6; const mx = Math.max(1, ...vals);
  const pts = vals.map((v, i) => [P + i * (W - 2 * P) / Math.max(1, vals.length - 1), H - P - (v / mx) * (H - 2 * P)]);
  const d = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
  return `<svg class="lc" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="lc-a" d="${d} L${pts[pts.length - 1][0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H}Z"/><path class="lc-l" d="${d}"/></svg><div class="lc-x">${labels.map(l => `<span>${l}</span>`).join('')}</div>`;
}
// nabídky po týdnech za posledních 5 týdnů (podle data nabídky)
function weekSeries(list, valFn) {
  const vals = [0, 0, 0, 0, 0], today = new Date(ymd(new Date()) + 'T12:00');
  list.forEach(o => { const w = Math.floor((today - new Date(String(o.date).slice(0, 10) + 'T12:00')) / (7 * 864e5)); if (w >= 0 && w < 5) vals[4 - w] += valFn(o); });
  const labels = [4, 3, 2, 1, 0].map(w => { const d = new Date(today - w * 7 * 864e5); return d.getDate() + '. ' + (d.getMonth() + 1) + '.'; });
  return { vals, labels };
}
async function renderHome() {
  shell('home', `<div class="pg-hello"><h1>${hello()} 👋</h1><p>Tady je přehled toho, co se dnes děje.</p></div><div class="kpis k4">${'<div class="panel kpi"><div class="sk" style="height:50px;width:100%"></div></div>'.repeat(4)}</div>`);
  const rs = await Promise.allSettled([refreshOffers(true), loadSettings(), loadOj(), loadProducts()]);
  if (rs[0].status === 'rejected') { $('#main').innerHTML = `<p class="err">${esc(rs[0].reason.message)}</p>`; return; }
  const okOj = rs[2].status === 'fulfilled' && rs[3].status === 'fulfilled';
  const base = S.offers.filter(o => !o.archived);
  const open = base.filter(o => o.status === 'sent' || o.status === 'postponed');
  const lateO = open.filter(o => (o.status === 'sent' && daysSince(o.statusAt) >= 5) || (o.status === 'postponed' && daysSince(o.statusAt) >= 7));
  let infos = [], toOrder = [], waiting = [], onWay = [], toStock = [], unpaid = [], overdue = [];
  if (okOj) {
    infos = OJ.orders.map(o => ojInfo(o)); const act = infos.filter(i => ojBucket(i) === 'active');
    toOrder = act.filter(i => i.stage === 'order'); waiting = OJ.aufs.filter(a => a.status === 'sent');
    const sact = a => (ojSup(a.supplier_id) || {}).active !== false;
    onWay = OJ.aufs.filter(a => a.status === 'confirmed' && !a.delivered_at && sact(a));
    toStock = ojStockQueue();
    unpaid = OJ.aufs.filter(a => a.status !== 'draft' && !a.paid_at && sact(a)); overdue = unpaid.filter(a => a.due_at && a.due_at < ymd(new Date()));
  }
  const sumTxt = list => { const m = {}; list.forEach(a => { if (a.amount_eur != null) m[a.currency || 'EUR'] = (m[a.currency || 'EUR'] || 0) + Number(a.amount_eur); }); return Object.entries(m).map(([c, n]) => n.toLocaleString('cs-CZ', { maximumFractionDigits: 2 }) + ' ' + ({ USD: '$', CZK: 'Kč' }[c] || '€')).join(' + '); };
  const bySup = list => { const m = {}; list.forEach(a => { const n = (ojSup(a.supplier_id) || {}).name || '?'; m[n] = (m[n] || 0) + 1; }); return Object.entries(m).map(([k, v]) => `${esc(k)} (${v})`).join(' · '); };
  const word = (n, a, b, c) => n === 1 ? a : n < 5 ? b : c;
  const KI = { doc: NAV_SVG.offers, truck: NAV_SVG.orders, ship: NAV_SVG.ct, box: NAV_SVG.stock };
  const kpi = [['doc', 'var(--s-sent)', 'Rozjednané nabídky', open.length, lateO.length ? `<span class="kpi-pill warn">ozvat se: ${lateO.length}</span>` : '', () => { location.hash = '#/nabidky'; }]];
  if (okOj) kpi.push(['truck', 'var(--s-sent)', 'K objednání', toOrder.length, '', () => ojGoHash('potreba', { card: 'order', view: 'list' })], ['ship', 'var(--brand)', 'Na cestě', onWay.length, '', () => ojGoHash('aufy', { af: 'confirmed' })], ['box', 'var(--s-confirmed)', 'K naskladnění', toStock.length, '', () => ojGoHash('naskladneni')]);
  OJ._hk = kpi;
  const todo = [];
  if (okOj) {
    if (waiting.length) todo.push(['truck', 'var(--s-sent)', `${waiting.length} ${word(waiting.length, 'objednávka čeká', 'objednávky čekají', 'objednávek čeká')} na potvrzení`, bySup(waiting), 'Zkontrolovat', () => ojGoHash('aufy', { af: 'sent' }), 1]);
    if (overdue.length) todo.push(['warn', 'var(--s-rejected)', `${overdue.length} ${word(overdue.length, 'platba po splatnosti', 'platby po splatnosti', 'plateb po splatnosti')}`, `Celkem ${sumTxt(overdue)} · ${bySup(overdue)}`, 'Zobrazit platby', () => ojGoHash('aufy', { af: 'unpaid' }), 0]);
    else if (unpaid.length) todo.push(['card', 'var(--s-postponed)', `${unpaid.length} ${word(unpaid.length, 'objednávka', 'objednávky', 'objednávek')} k zaplacení`, `Celkem ${sumTxt(unpaid) || 'bez částky'}`, 'Zobrazit', () => ojGoHash('aufy', { af: 'unpaid' }), 1]);
    if (toStock.length) todo.push(['box', 'var(--s-confirmed)', `${toStock.length} ${word(toStock.length, 'doručený balík', 'doručené balíky', 'doručených balíků')} k naskladnění`, 'Dorazilo na sklad — zkontroluj a naskladni', 'Naskladnit', () => ojGoHash('naskladneni'), 1]);
    if (toOrder.length) todo.push(['cart', 'var(--s-postponed)', `${toOrder.length} ${word(toOrder.length, 'objednávka', 'objednávky', 'objednávek')} k objednání u dodavatele`, `${toOrder.reduce((x, i) => x + i.todo.length, 0)} položek bez objednávky`, 'Objednat', () => ojGoHash('potreba', { card: 'order', view: 'list' }), 1]);
  }
  if (lateO.length) todo.push(['doc', 'var(--s-sent)', `${lateO.length} ${word(lateO.length, 'nabídka', 'nabídky', 'nabídek')} — ozvat se zákazníkovi`, lateO.slice(0, 2).map(o => `${esc(custLabel(o.customer))} · ${daysSince(o.statusAt)} d`).join(' · '), 'Otevřít', () => { S.view = 'over'; location.hash = '#/nabidky'; }, 1]);
  OJ._ht = todo;
  const TI = { ...KI, warn: '<path d="M12 4 2.8 20h18.4zM12 10v5M12 17.5v.5"/>', cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2.5 3.5h3l2.2 11h10.6l2-8H6.3"/>', card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>' };
  const wk = weekSeries(base, () => 1);
  $('#main').innerHTML = `
  <div class="pg-hello"><h1>${hello()} 👋</h1><p>Tady je přehled toho, co se dnes děje.</p></div>
  <div class="kpis k${kpi.length}">${kpi.map(([ic, c, l, n, extra], i) => `<button class="panel kpi" data-k="${i}" style="--c:${c}"><span class="kpi-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${KI[ic]}</svg></span><span class="kpi-t"><span class="kpi-l">${l}</span><b class="kpi-v">${n}</b>${extra}</span></button>`).join('')}</div>
  <div class="hg">
    <section class="panel dash"><div class="dash-h"><svg class="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg><b>Co teď udělat</b></div>
      <div class="dash-b nopad">${todo.length ? todo.map((t, i) => `<div class="td-row"><span class="td-i" style="--c:${t[1]}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TI[t[0]]}</svg></span><div class="grow"><b>${t[2]}</b><div class="small muted">${t[3]}</div></div><button class="btn ${t[6] ? '' : 'primary'}" data-t="${i}">${t[4]}</button></div>`).join('') : '<div class="td-empty">✅ Všechno vyřízeno — nic nečeká na akci.</div>'}</div></section>
    <section class="panel dash"><div class="dash-h"><svg class="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20V10M12 20V4M19 20v-7"/></svg><b>Aktivita nabídek</b></div>
      <div class="dash-b"><div class="donut-w">${offerDonut(base)}</div><div class="lc-w">${lineChart(wk.vals, wk.labels)}</div><div class="small muted" style="text-align:center">nové nabídky po týdnech</div></div></section>
    <section class="panel dash"><div class="dash-h"><svg class="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${NAV_SVG.ct}</svg><b>Kontejnery na cestě</b><span class="grow"></span>${hasApp('kontejnery') ? '<a class="dash-lnk" href="#/kontejnery">Všechny →</a>' : ''}</div>
      <div id="hCt" class="dash-b"><div class="sk" style="height:110px"></div></div></section>
  </div>
  <section class="panel dash" style="margin-top:16px"><div class="dash-h">${svgIco('zs')}<b>Zásoby ke sledování</b><span class="grow"></span><a class="dash-lnk" href="#/zasoby">Otevřít Zásoby ›</a></div><div id="hZs" class="dash-b"><div class="sk" style="height:70px"></div></div></section>
  ${okOj ? `<section class="panel dash" style="margin-top:16px"><div class="dash-h"><b style="font-size:18px">Objednávky dodavatelů</b><span class="grow"></span><button class="btn sm" id="hBoard">Otevřít nástěnku ›</button><button class="btn primary sm" id="hNew">＋ Nová objednávka</button></div><div class="mini-board">${ojMiniBoard(infos, 2)}</div></section>` : ''}`;
  $$('.kpi').forEach(b => b.onclick = () => OJ._hk[b.dataset.k][5]());
  $$('.td-row .btn').forEach(b => b.onclick = () => OJ._ht[b.dataset.t][5]());
  if (okOj) {
    $('#hBoard').onclick = () => ojGoHash('potreba', { view: 'board' }); $('#hNew').onclick = () => { ojGoHash('prehled'); };
    $$('.mb-h, .mb-more').forEach(b => b.onclick = () => ojGoHash('potreba', { view: 'board' }));
    $$('.mb-card').forEach(c => c.onclick = () => { location.hash = orderHref(c.dataset.o); });
  }
  (async () => {
    try {
      if (!hasApp('kontejnery')) throw 0;
      const r = check(await sb.from('ct_containers').select('*').neq('status', 'delivered').order('eta', { ascending: true, nullsFirst: false }).limit(3));
      if ($('#hCt')) $('#hCt').innerHTML = r.length ? r.map(c => `<a class="rc-row" href="#/k/${c.id}"><span class="rc-i">${svgIco('ct')}</span><div class="grow"><b>${esc(c.number || 'bez čísla')}</b> ${CT_ST[c.status] ? ctBadge(c.status) : ''}<div class="small muted">${esc(c.vessel || '')}</div></div><span class="small nowrap">ETA <b>${ctEta(c) ? czDate(ctEta(c)) : '—'}</b></span></a>`).join('') : '<div class="muted small">Žádný kontejner na cestě.</div>';
    } catch { if ($('#hCt')) $('#hCt').innerHTML = '<div class="muted small">Kontejnery nejsou k dispozici.</div>'; }
  })();
  zsHomeCard();
}

// ---------- Inventura ----------
const INV_ST = { draft: ['Příprava', 'draft'], counting: ['Počítá se', 'sent'], review: ['Ke schválení', 'postponed'], done: ['Uzavřeno', 'confirmed'] };
const INV_STEPS = ['draft', 'counting', 'review', 'done'];
// =====================================================================
// ZÁSOBY: hlídání minimálních zásob — co je pod hranicí, co brzy dojde a co doobjednat
// hranice: u konkrétního produktu (ručně) nebo pravidlem pro skupinu (výrobce, dodavatel, část názvu, začátek kódu)
// =====================================================================
const ZS = { rules: [], watch: [], levels: new Map(), sales: [], cfg: { horizon_days: 30, window_days: 60 }, loaded: false, tab: 'alerts', q: '', st: 'all', sup: '', pq: '', syncing: '' };
const ZS_KIND = { category: 'Kategorie', manufacturer: 'Výrobce', supplier: 'Dodavatel', name: 'Název obsahuje', prefix: 'Kód začíná' };
const ZS_ST = { out: ['Došlo', 'bad'], low: ['Pod hranicí', 'bad'], soon: ['Brzy dojde', 'wait'], ok: ['V pořádku', 'ok'], nodata: ['Bez dat', ''] };
const ZS_ORD = { out: 0, low: 1, soon: 2, ok: 3, nodata: 4 };
async function zsCall(body) {
  const { data, error } = await sb.functions.invoke('hub-stock', { body });
  if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch {} throw new Error(msg); }
  if (data && data.error) throw new Error(data.error);
  return data;
}
async function zsLoad() {
  const c = await sb.from('stk_config').select('*').eq('id', 1).maybeSingle();
  if (c.data) ZS.cfg = c.data;
  const since = ymd(new Date(Date.now() - ZS.cfg.window_days * 864e5));
  const [rules, watch, lv, sales] = await Promise.all([
    fetchAll(() => sb.from('stk_rules').select('*').order('created_at')),
    fetchAll(() => sb.from('stk_watch').select('*')),
    fetchAll(() => sb.from('stk_levels').select('code,stock')),
    fetchAll(() => sb.from('stk_sales').select('code,qty,sold_at').gte('sold_at', since)),
  ]);
  Object.assign(ZS, { rules, watch, levels: new Map(lv.map(x => [x.code, Number(x.stock)])), sales, loaded: true });
}
// kategorie: shoduje se přesně, nebo je produkt v podkategorii („Podlahy“ zahrne i „Podlahy > Vinyl“)
const zsCatHit = (cat, val) => { const c = fold(cat).trim(), v = fold(val).trim(); return !!v && !!c && (c === v || (c.startsWith(v) && /^\s*[>\/|»]/.test(c.slice(v.length)))); };
const zsRuleHit = (r, p) => { const v = fold(r.value).trim(); if (!v) return false; if (r.kind === 'category') return zsCatHit(p.category, r.value); return r.kind === 'manufacturer' ? fold(p.manufacturer).trim() === v : r.kind === 'supplier' ? fold(p.supplier).trim() === v : r.kind === 'name' ? fold(p.name).includes(v) : fold(p.code).startsWith(v); };
// všechny sledované produkty s vypočteným stavem
function zsRows() {
  const W = ZS.cfg.window_days, H = ZS.cfg.horizon_days;
  const sold = new Map(); for (const x of ZS.sales) sold.set(x.code, (sold.get(x.code) || 0) + Number(x.qty));
  const watch = new Map(ZS.watch.map(w => [w.code, w]));
  const out = []; const ignored = [];
  for (const pr of S.products || []) {
    const w = watch.get(pr.code);
    if (w && w.mode === 'ignore') { ignored.push(pr); continue; }
    let rule = null; for (const r of ZS.rules) if (zsRuleHit(r, pr) && (!rule || Number(r.min_qty) > Number(rule.min_qty))) rule = r;
    if (!w && !rule) continue;
    const min = w && w.min_qty != null ? Number(w.min_qty) : rule ? Number(rule.min_qty) : null;
    const stock = ZS.levels.has(pr.code) ? ZS.levels.get(pr.code) : null;
    const avg = (sold.get(pr.code) || 0) / W; const days = avg > 0 && stock != null ? Math.max(0, stock) / avg : null;
    const st = stock == null ? 'nodata' : stock <= 0 ? 'out' : min != null && stock <= min ? 'low' : days != null && days <= H ? 'soon' : 'ok';
    const need = stock == null || st === 'ok' ? 0 : Math.max(0, Math.ceil((min || 0) + avg * H - stock));
    out.push({ p: pr, code: pr.code, stock, min, avg, days, st, need, src: w && w.min_qty != null ? 'ručně' : rule ? `pravidlo: ${ZS_KIND[rule.kind].toLowerCase()} „${rule.value}“` : 'ručně', manual: !!w, rule });
  }
  out.sort((a, b) => ZS_ORD[a.st] - ZS_ORD[b.st] || (a.days ?? 1e9) - (b.days ?? 1e9) || a.code.localeCompare(b.code));
  return { rows: out, ignored };
}
const zsDays = d => d == null ? '—' : d < 1 ? 'dnes' : d > 999 ? '999+' : Math.round(d) + ' d';
const zsRow = (r, withSrc) => `<tr class="click" data-c="${esc(r.code)}"><td><span class="stp ${ZS_ST[r.st][1]}">${ZS_ST[r.st][0]}</span></td><td><b>${esc(r.code)}</b><div class="small muted">${esc(r.p.name)}${r.p.variant ? ' · ' + esc(r.p.variant) : ''}${r.p.category ? ' · <span title="Výchozí kategorie">' + esc(r.p.category.split(/\s*[>\/|»]\s*/).pop()) + '</span>' : ''}</div></td>
  <td class="r nowrap"><b>${r.stock == null ? '—' : fmtQ(r.stock)}</b></td><td class="r nowrap">${r.min == null ? '<span class="muted">—</span>' : fmtQ(r.min)}</td><td class="r nowrap">${r.avg ? fmtQ(Math.round(r.avg * 100) / 100) : '<span class="muted">0</span>'}</td><td class="r nowrap">${zsDays(r.days)}</td>
  ${withSrc ? `<td class="small muted">${esc(r.src)}</td>` : `<td class="r nowrap">${r.need ? `<b>${fmtQ(r.need)}</b>` : '<span class="muted">—</span>'}</td><td class="small">${esc(r.p.supplier || '')}</td>`}</tr>`;
async function renderZasoby() {
  shell('zs', `${pgHead('zs', 'Zásoby', 'Hlídání minimálních zásob a co brzy doobjednat.')}<div class="panel panel-b"><div class="sk" style="height:220px"></div></div>`);
  try { await Promise.all([loadSettings(), loadProducts(), zsLoad()]); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  drawZasoby();
}
function drawZasoby() {
  if (location.hash !== '#/zasoby') return;
  const { rows, ignored } = zsRows(); const bad = rows.filter(r => ['out', 'low'].includes(r.st)), soon = rows.filter(r => r.st === 'soon');
  const alerts = rows.filter(r => ['out', 'low', 'soon'].includes(r.st));
  const last = ZS.cfg.stock_synced_at; const noData = !ZS.levels.size;
  const sups = [...new Set(rows.map(r => r.p.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs'));
  const stat = (k, v, sub, c) => `<div class="panel stat" style="--c:${c}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  const tabs = [['alerts', 'Upozornění', alerts.length], ['watch', 'Sledované produkty', rows.length], ['rules', 'Pravidla', ZS.rules.length]];
  const q = fold(ZS.q).trim();
  const flt = list => list.filter(r => (!ZS.sup || r.p.supplier === ZS.sup) && (!q || fold(r.code + ' ' + r.p.name + ' ' + (r.p.supplier || '')).includes(q)) && (ZS.st === 'all' || r.st === ZS.st));
  let body = '';
  if (ZS.tab === 'alerts') {
    const list = flt(alerts);
    body = `<div class="oj-bar"><div class="search oj-q"><span class="ic">⌕</span><input id="zsq" placeholder="Hledat kód, název, dodavatele…" value="${esc(ZS.q)}"></div>
      <div class="chips" id="zsF">${[['all', 'Vše'], ['out', 'Došlo'], ['low', 'Pod hranicí'], ['soon', 'Brzy dojde']].map(([k, l]) => `<button class="chip ${ZS.st === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      <select id="zsSup" class="of-who"><option value="">Všichni dodavatelé</option>${sups.map(x => `<option ${x === ZS.sup ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><span class="grow"></span><button class="btn" id="zsCopy">📋 Kopírovat seznam</button></div>
      <div class="panel" style="overflow-x:auto">${list.length ? `<table class="list"><thead><tr><th>Stav</th><th>Produkt</th><th class="r">Skladem</th><th class="r">Hranice</th><th class="r" title="Průměrný prodej za den v posledních ${ZS.cfg.window_days} dnech">Prodej/den</th><th class="r" title="Za jak dlouho dojde při tomto tempu">Vystačí</th><th class="r" title="Hranice + prodej za ${ZS.cfg.horizon_days} dní − sklad">Doobjednat</th><th>Dodavatel</th></tr></thead><tbody>${list.slice(0, 300).map(r => zsRow(r)).join('')}</tbody></table>`
        : `<div class="empty-big"><div class="ill">${noData ? '📡' : '✅'}</div><h3>${noData ? 'Zatím nejsou načtené zásoby' : rows.length ? 'Nic nehrozí' : 'Zatím nic nesledujete'}</h3><p>${noData ? 'Klikni nahoře na „Aktualizovat ze Shoptetu“ — stáhne aktuální stavy skladu a prodeje.' : rows.length ? 'Žádný sledovaný produkt není pod hranicí ani blízko vyprodání.' : 'Přidej pravidlo pro skupinu produktů nebo konkrétní produkt v záložce Sledované produkty / Pravidla.'}</p></div>`}</div>
      ${list.length > 300 ? `<p class="muted small">Zobrazeno prvních 300 z ${list.length} — zúži filtr.</p>` : ''}`;
  } else if (ZS.tab === 'watch') {
    const list = rows.filter(r => !q || fold(r.code + ' ' + r.p.name + ' ' + (r.p.supplier || '')).includes(q));
    body = `<div class="oj-bar"><div class="search oj-q"><span class="ic">⌕</span><input id="zsq" placeholder="Hledat mezi sledovanými…" value="${esc(ZS.q)}"></div><span class="grow"></span><button class="btn primary of-new" id="zsAdd">＋ Přidat produkt</button></div>
      <div class="panel" style="overflow-x:auto">${list.length ? `<table class="list"><thead><tr><th>Stav</th><th>Produkt</th><th class="r">Skladem</th><th class="r">Hranice</th><th class="r">Prodej/den</th><th class="r">Vystačí</th><th>Zdroj hranice</th></tr></thead><tbody>${list.slice(0, 400).map(r => zsRow(r, true)).join('')}</tbody></table>` : '<div class="empty-big"><div class="ill">📈</div><h3>Nic nesledujete</h3><p>Přidej produkt tlačítkem nahoře, nebo vytvoř pravidlo pro celou skupinu.</p></div>'}</div>
      ${ignored.length ? `<details class="panel panel-b ns-skipped"><summary>Vyřazeno ze sledování (${ignored.length})</summary>${ignored.slice(0, 100).map(x => `<div class="ns-sk"><div class="grow"><b>${esc(x.code)}</b> <span class="muted small">${esc(x.name)}</span></div><button class="btn sm" data-unign="${esc(x.code)}">Vrátit</button></div>`).join('')}</details>` : ''}`;
  } else {
    const cnt = r => (S.products || []).filter(p => zsRuleHit(r, p)).length;
    body = `<div class="oj-bar"><span class="grow"></span><button class="btn primary of-new" id="zsNewRule">＋ Nové pravidlo</button></div>
      <div class="panel" style="overflow-x:auto;margin-bottom:16px">${ZS.rules.length ? `<table class="list"><thead><tr><th>Skupina produktů</th><th class="r">Hranice</th><th class="r">Produktů</th><th>Poznámka</th><th></th></tr></thead><tbody>${ZS.rules.map(r => `<tr data-r="${r.id}"><td><span class="tag blue">${ZS_KIND[r.kind]}</span> <b>${esc(r.value)}</b></td><td class="r nowrap"><b>${fmtQ(r.min_qty)}</b></td><td class="r">${cnt(r)}</td><td class="small muted">${esc(r.note)}</td><td class="r nowrap"><button class="btn sm" data-redit="${r.id}">Upravit</button> <button class="btn sm danger" data-rdel="${r.id}">✕</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty-big"><div class="ill">🧩</div><h3>Zatím žádné pravidlo</h3><p>Pravidlo nastaví hranici najednou celé skupině — například všem produktům výrobce, od jednoho dodavatele nebo s „click“ v názvu. U konkrétního produktu ji pak můžeš přebít.</p></div>'}</div>
      <div class="panel panel-b"><b>Předpověď</b><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:10px">
        <div><label>Upozornit, když zásoba vystačí na méně než (dní)</label><input type="number" min="1" max="365" id="zsH" value="${ZS.cfg.horizon_days}"></div>
        <div><label>Průměrný prodej počítat z posledních (dní)</label><input type="number" min="7" max="180" id="zsW" value="${ZS.cfg.window_days}"></div></div>
        <p class="muted small" style="margin:10px 0 0">Doporučené množství k objednání = hranice + očekávaný prodej za zadaný počet dní − aktuální sklad. Po změně počtu dní pro průměr klikni na „Aktualizovat ze Shoptetu“.</p><button class="btn" id="zsCfg" style="margin-top:10px">Uložit nastavení</button></div>`;
  }
  $('#main').innerHTML = `${pgHead('zs', 'Zásoby', 'Hlídání minimálních zásob a co brzy doobjednat.', `<span class="muted small" id="zsLast">${last ? 'zásoby: ' + ago(last) : 'zatím nenačteno'}</span><button class="btn" id="zsSync">↻ Aktualizovat ze Shoptetu</button>`)}
  <div class="stats">${stat('Došlo / pod hranicí', bad.length, bad.length ? 'zkontroluj a doobjednej' : 'nic nechybí', 'var(--s-rejected)')}${stat('Brzy dojde', soon.length, `vystačí na < ${ZS.cfg.horizon_days} dní`, 'var(--s-postponed)')}${stat('Sledováno', rows.length, ZS.rules.length ? `${ZS.rules.length} ${ZS.rules.length === 1 ? 'pravidlo' : 'pravidel'} + ruční` : 'ručně vybrané', 'var(--s-confirmed)')}${stat('Prodeje z', ZS.cfg.window_days + ' dní', ZS.cfg.sales_synced_at ? 'aktualizováno ' + ago(ZS.cfg.sales_synced_at) : 'zatím nenačteno', 'var(--brand)')}</div>
  <div class="chips" id="zsTabs" style="margin-bottom:14px">${tabs.map(([k, l, n]) => `<button class="chip ${ZS.tab === k ? 'on' : ''}" data-t="${k}">${l}${n ? ` <span class="tag ${k === 'alerts' ? '' : 'grey'}">${n}</span>` : ''}</button>`).join('')}</div>${body}`;
  zsBind(rows);
}
function zsBind(rows) {
  $$('#zsTabs .chip').forEach(c => c.onclick = () => { ZS.tab = c.dataset.t; ZS.q = ''; ZS.st = 'all'; drawZasoby(); });
  $('#zsSync').onclick = zsSync;
  const q = $('#zsq'); if (q) q.oninput = e => { ZS.q = e.target.value; const pos = e.target.selectionStart; drawZasoby(); const n = $('#zsq'); n.focus(); n.setSelectionRange(pos, pos); };
  $$('#zsF .chip').forEach(c => c.onclick = () => { ZS.st = c.dataset.f; drawZasoby(); });
  if ($('#zsSup')) $('#zsSup').onchange = e => { ZS.sup = e.target.value; drawZasoby(); };
  $$('tr.click[data-c]').forEach(t => t.onclick = () => zsEdit(t.dataset.c));
  if ($('#zsCopy')) $('#zsCopy').onclick = () => {
    const qq = fold(ZS.q).trim(); const list = rows.filter(r => ['out', 'low', 'soon'].includes(r.st) && (!ZS.sup || r.p.supplier === ZS.sup) && (!qq || fold(r.code + ' ' + r.p.name).includes(qq)) && (ZS.st === 'all' || r.st === ZS.st));
    if (!list.length) return toast('Není co kopírovat.', true);
    const txt = ['Kód\tNázev\tDodavatel\tSkladem\tHranice\tDoobjednat', ...list.map(r => [r.code, r.p.name, r.p.supplier || '', r.stock ?? '', r.min ?? '', r.need || ''].join('\t'))].join('\n');
    navigator.clipboard.writeText(txt).then(() => toast(`Zkopírováno ${list.length} řádků (vlož do Excelu) ✓`), () => toast('Kopírování se nepovedlo.', true));
  };
  if ($('#zsAdd')) $('#zsAdd').onclick = zsAddProduct;
  $$('[data-unign]').forEach(b => b.onclick = async () => { try { check(await sb.from('stk_watch').delete().eq('code', b.dataset.unign)); await zsLoad(); drawZasoby(); } catch (e) { toast(e.message, true); } });
  if ($('#zsNewRule')) $('#zsNewRule').onclick = () => zsRuleDlg();
  $$('[data-redit]').forEach(b => b.onclick = () => zsRuleDlg(ZS.rules.find(r => r.id === b.dataset.redit)));
  $$('[data-rdel]').forEach(b => b.onclick = async () => {
    const r = ZS.rules.find(x => x.id === b.dataset.rdel); if (!(await confirmBox('Smazat pravidlo?', `Pravidlo „${ZS_KIND[r.kind]}: ${r.value}“ zmizí. Produkty s vlastní hranicí zůstanou sledované.`, { ok: 'Smazat', danger: true }))) return;
    try { check(await sb.from('stk_rules').delete().eq('id', r.id)); await zsLoad(); drawZasoby(); } catch (e) { toast(e.message, true); }
  });
  if ($('#zsCfg')) $('#zsCfg').onclick = async () => {
    const h = Math.round(toNum($('#zsH').value)), w = Math.round(toNum($('#zsW').value));
    if (!(h >= 1 && h <= 365 && w >= 7 && w <= 180)) return toast('Dny upozornění 1–365, dny pro průměr 7–180.', true);
    try { check(await sb.from('stk_config').update({ horizon_days: h, window_days: w }).eq('id', 1)); await zsLoad(); drawZasoby(); toast('Uloženo ✓'); } catch (e) { toast(e.message, true); }
  };
}
async function zsSync() {
  if (ZS.syncing) return; ZS.syncing = '1'; const btn = $('#zsSync'); const set = t => { const b = $('#zsSync'); if (b) { b.disabled = true; b.innerHTML = `<span class="spin"></span> ${t}`; } };
  const stockId = Number(cfg().shoptetStockId) || 1; let msg = ''; let warn = false;
  try {
    set('Načítám zásoby…');
    const r = await zsCall({ action: 'stock_sync', stockId });
    if (r.ok === false) { warn = true; msg = (r.error || 'Zásoby se nepodařilo načíst.') + (r.sampleKeys && r.sampleKeys.length ? ' Pole v odpovědi: ' + r.sampleKeys.join(', ') : ''); }
    else msg = `Zásoby: ${r.saved} produktů`;
    let rem = 1, guard = 0, orders = 0;
    while (rem > 0 && guard++ < 60) {
      set(guard === 1 ? 'Načítám prodeje…' : `Načítám prodeje… zbývá ${rem}`);
      const s = await zsCall({ action: 'sales_sync', days: ZS.cfg.window_days, batch: 40 });
      if (s.ok === false) { warn = true; msg += (msg ? ' · ' : '') + s.error; break; }
      rem = s.remaining || 0; orders += s.processed || 0;
    }
    if (!warn) msg += ` · nové objednávky: ${orders}`;
    await zsLoad();
  } catch (e) { warn = true; msg = e.message; }
  ZS.syncing = ''; drawZasoby(); if (btn) toast(msg || 'Hotovo', warn);
}
async function zsEdit(code) {
  const r = zsRows().rows.find(x => x.code === code); const pr = (S.products || []).find(x => x.code === code); if (!pr) return;
  const w = ZS.watch.find(x => x.code === code);
  const v = await modal({ title: pr.code, body: `<p class="muted small">${esc(pr.name)}${pr.variant ? ' · ' + esc(pr.variant) : ''}</p>
    <div class="ns-sk" style="border:0;padding:0"><div>Skladem: <b>${r && r.stock != null ? fmtQ(r.stock) : '—'}</b></div><div>Prodej/den: <b>${r ? fmtQ(Math.round(r.avg * 100) / 100) : '—'}</b></div><div>Vystačí: <b>${r ? zsDays(r.days) : '—'}</b></div></div>
    <label>Vlastní hranice pro tento produkt${r && r.rule ? ` <span class="muted small">(prázdné = z pravidla: ${fmtQ(r.rule.min_qty)})</span>` : ''}</label><input data-k="min" type="number" step="any" min="0" value="${w && w.min_qty != null ? w.min_qty : ''}" placeholder="${r && r.rule ? fmtQ(r.rule.min_qty) : 'např. 100'}">
    <label class="chk" style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" data-k="ign"> Nesledovat tento produkt</label>`, focus: '[data-k="min"]',
    actions: [{ label: 'Zrušit', value: null }, { label: 'Uložit', cls: 'primary', value: bd => ({ min: $('[data-k="min"]', bd).value.trim(), ign: $('[data-k="ign"]', bd).checked }) }] });
  if (!v) return;
  try {
    if (v.ign) check(await sb.from('stk_watch').upsert({ code, mode: 'ignore', min_qty: null, updated_at: nowIso() }, { onConflict: 'code' }));
    else if (v.min !== '') { const m = toNum(v.min); if (!(m >= 0)) return toast('Hranice musí být číslo.', true); check(await sb.from('stk_watch').upsert({ code, mode: 'watch', min_qty: m, updated_at: nowIso() }, { onConflict: 'code' })); }
    else if (r && r.rule) check(await sb.from('stk_watch').delete().eq('code', code));
    else check(await sb.from('stk_watch').upsert({ code, mode: 'watch', min_qty: null, updated_at: nowIso() }, { onConflict: 'code' }));
    await zsLoad(); drawZasoby(); toast('Uloženo ✓');
  } catch (e) { toast(e.message, true); }
}
async function zsAddProduct() {
  let pick = null;
  const done = modal({ title: 'Přidat produkt ke sledování', body: `<label>Hledat produkt (kód, název, EAN…)</label><input id="zsPq" placeholder="např. carrara click 6mm"><div id="zsPr" style="max-height:240px;overflow:auto;margin-top:8px"></div>
    <div id="zsPk" class="small" style="margin:10px 0 0"></div><label>Hranice (minimální zásoba)</label><input data-k="min" type="number" step="any" min="0" placeholder="např. 100">`, focus: '#zsPq',
    actions: [{ label: 'Zrušit', value: null }, { label: 'Přidat', cls: 'primary', value: bd => pick ? { code: pick.code, min: $('[data-k="min"]', bd).value.trim() } : null }] });
  setTimeout(() => {
    const bd = $$('.backdrop').pop(); if (!bd) return; const inp = $('#zsPq', bd);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') e.stopPropagation(); });
    inp.oninput = () => {
      const res = searchProducts(inp.value, true).slice(0, 12);
      $('#zsPr', bd).innerHTML = res.map(x => `<button type="button" class="btn sm" data-p="${esc(x.code)}" style="display:block;width:100%;text-align:left;margin:3px 0"><b>${esc(x.code)}</b> ${esc(x.name)}${x.variant ? ' · ' + esc(x.variant) : ''}</button>`).join('') || '<div class="muted small">Nic nenalezeno.</div>';
      $$('[data-p]', bd).forEach(b => b.onclick = () => { pick = res.find(x => x.code === b.dataset.p); $('#zsPk', bd).innerHTML = `Vybráno: <b>${esc(pick.code)}</b> ${esc(pick.name)}`; $('[data-k="min"]', bd).focus(); });
    };
  }, 40);
  const v = await done; if (!v) return;
  try {
    const m = v.min === '' ? null : toNum(v.min); if (m != null && !(m >= 0)) return toast('Hranice musí být číslo.', true);
    check(await sb.from('stk_watch').upsert({ code: v.code, mode: 'watch', min_qty: m, updated_at: nowIso() }, { onConflict: 'code' }));
    await zsLoad(); ZS.tab = 'watch'; drawZasoby(); toast('Přidáno ke sledování ✓');
  } catch (e) { toast(e.message, true); }
}
async function zsRuleDlg(rule) {
  const prods = S.products || [];
  const cats = [...new Set(prods.map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs')); const mans = [...new Set(prods.map(p => p.manufacturer).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs')), sups = [...new Set(prods.map(p => p.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs'));
  const done = modal({ title: rule ? 'Upravit pravidlo' : 'Nové pravidlo', body: `<label>Skupina produktů</label><select data-k="kind">${Object.entries(ZS_KIND).map(([k, l]) => `<option value="${k}" ${rule && rule.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>Hodnota</label><input data-k="val" list="zsDl" value="${rule ? esc(rule.value) : ''}" placeholder="např. kategorie, Gunreben nebo click"><datalist id="zsDl"></datalist>
    <div class="small muted" id="zsHit" style="margin-top:6px"></div><div class="small" id="zsCatHint" style="margin-top:6px;color:var(--warn-fg)"></div>
    <label>Hranice pro každý produkt ve skupině</label><input data-k="min" type="number" step="any" min="0" value="${rule ? rule.min_qty : ''}" placeholder="např. 100">
    <label>Poznámka (nepovinné)</label><input data-k="note" value="${rule ? esc(rule.note) : ''}">`, focus: '[data-k="val"]',
    actions: [{ label: 'Zrušit', value: null }, { label: 'Uložit', cls: 'primary', value: bd => ({ kind: $('[data-k="kind"]', bd).value, value: $('[data-k="val"]', bd).value.trim(), min: $('[data-k="min"]', bd).value.trim(), note: $('[data-k="note"]', bd).value.trim() }) }] });
  setTimeout(() => {
    const bd = $$('.backdrop').pop(); if (!bd) return; const k = $('[data-k="kind"]', bd), val = $('[data-k="val"]', bd);
    const upd = () => { $('#zsDl', bd).innerHTML = (k.value === 'category' ? cats : k.value === 'manufacturer' ? mans : k.value === 'supplier' ? sups : []).map(x => `<option value="${esc(x)}">`).join(''); const n = val.value.trim() ? prods.filter(p => zsRuleHit({ kind: k.value, value: val.value }, p)).length : 0; $('#zsHit', bd).textContent = val.value.trim() ? `Odpovídá ${n} produktů.` : ''; $('#zsCatHint', bd).textContent = k.value === 'category' && !cats.length ? 'Kategorie produktů zatím nejsou načtené. V Shoptetu přidej do CSV exportu produktů sloupec „Výchozí kategorie“ a pak v Nastavení klikni na „Načíst produkty teď“.' : ''; };
    k.onchange = upd; val.oninput = upd; upd();
  }, 40);
  const v = await done; if (!v) return;
  const m = toNum(v.min); if (!v.value || v.min === '' || !(m >= 0)) return toast('Vyplň hodnotu a hranici (číslo).', true);
  try {
    const row = { kind: v.kind, value: v.value, min_qty: m, note: v.note };
    if (rule) check(await sb.from('stk_rules').update(row).eq('id', rule.id)); else check(await sb.from('stk_rules').insert(row));
    await zsLoad(); ZS.tab = 'rules'; drawZasoby(); toast('Pravidlo uloženo ✓');
  } catch (e) { toast(e.message, true); }
}
// karta na úvodní stránce
async function zsHomeCard() {
  const put = h => { if ($('#hZs')) $('#hZs').innerHTML = h; };
  try {
    await Promise.all([loadProducts(), zsLoad()]);
    const { rows } = zsRows(); const al = rows.filter(r => ['out', 'low', 'soon'].includes(r.st));
    if (!rows.length) return put('<div class="muted small" style="padding:4px 2px">Zatím nic nesledujete. <a href="#/zasoby"><u>Nastavit hranice</u></a></div>');
    if (!ZS.levels.size) return put('<div class="muted small" style="padding:4px 2px">Zásoby ještě nejsou načtené — <a href="#/zasoby"><u>aktualizuj je v Zásobách</u></a>.</div>');
    if (!al.length) return put(`<div class="muted small" style="padding:4px 2px">✅ Všech ${rows.length} sledovaných produktů má dost zásob.</div>`);
    put(al.slice(0, 5).map(r => `<a class="rc-row" href="#/zasoby"><span class="stp ${ZS_ST[r.st][1]}">${ZS_ST[r.st][0]}</span><div class="grow"><b>${esc(r.code)}</b> <span class="small muted">${esc(r.p.name)}</span></div><span class="small nowrap">skladem <b>${fmtQ(r.stock)}</b>${r.need ? ` · doobjednat <b>${fmtQ(r.need)}</b>` : ''}</span></a>`).join('') + (al.length > 5 ? `<div class="small muted" style="padding:6px 2px">+ ${al.length - 5} dalších v Zásobách</div>` : ''));
  } catch { put('<div class="muted small">Zásoby nejsou k dispozici.</div>'); }
}
// =====================================================================
// ROZVOZY: objednávky k rozvozu na mapě, oblasti, výběr zastávek, optimalizace pořadí a trasa (Mapy.com)
// data: CSV export objednávek ze Shoptetu → edge funkce hub-rozvoz → tabulka rozvoz_orders
// =====================================================================
const RZ_ST = [['Nevyřízená', 'NEVYŘÍZENÁ', '#FF1F2D', '#fff'], ['Zaplaceno', 'ZAPLACENO', '#00C853', '#fff'], ['Vyřizuje se', 'VYŘIZUJE SE', '#FF6D00', '#fff'], ['SKLAD', 'SKLAD', '#8E24AA', '#fff'],
  ['Zabaleno - připraveno k expedici', 'ZABALENO', '#1565FF', '#fff'], ['Čeká na vyzvednutí přepravcem', 'ČEKÁ NA VYZVEDNUTÍ', '#00A6D6', '#fff'], ['Nedoplatek dopravy', 'NEDOPLATEK DOPRAVY', '#E91E63', '#fff'], ['Naše doprava', 'NAŠE DOPRAVA', '#FFD600', '#171717']];
const RZ_READY = ['SKLAD', 'Zabaleno - připraveno k expedici', 'Čeká na vyzvednutí přepravcem', 'Nedoplatek dopravy', 'Naše doprava'];
const RZ_WH = { name: 'Sklad Vinylor', address: 'V Lukách 293, Příbram', lat: 49.6992203, lng: 14.0045589 };
const RZ_COLORS = ['#08752f', '#2f80c9', '#e4a32b', '#a36ad2', '#08a1a7', '#df6a55', '#6f8e36'];
const RZ_RADIUS = 35, RZ_MAX = 16;
const RZ = { orders: [], cfg: null, group: 'ALL', status: 'ALL', q: '', seq: [], mapType: 'basic', map: null, tile: null, mk: null, rt: null, route: null, sync: false };
async function rzCall(body) {
  const { data, error } = await sb.functions.invoke('hub-rozvoz', { body });
  if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch {} throw new Error(msg); }
  if (data && data.error) throw new Error(data.error);
  return data;
}
const rzMeta = st => { const m = RZ_ST.find(x => x[0] === st); return m ? { label: m[1], color: m[2], text: m[3] } : { label: st || 'Bez stavu', color: '#52605A', text: '#fff' }; };
const rzKm = (a, b, c, d) => { const r = x => x * Math.PI / 180; const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const rzHasXY = o => o.lat != null && o.lng != null && o.lat !== 0 && o.lng !== 0;
const rzMoney = n => (Number(n) || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
const rzCompact = n => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: 2 }) + ' mil.' : n >= 1e3 ? Math.round(n / 1e3).toLocaleString('cs-CZ') + ' tis.' : rzMoney(n); };
async function rzLoad() {
  const [cfg, rows] = await Promise.all([rzCall({ action: 'config_get' }), fetchAll(() => sb.from('rozvoz_orders').select('*').order('code', { ascending: false }))]);
  RZ.cfg = cfg; RZ.orders = rows.map(r => ({ ...r, lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng), total: Number(r.total), paid: Number(r.paid) }));
  RZ.seq = RZ.seq.filter(c => RZ.orders.some(o => o.code === c)); RZ.route = null; rzAssign();
}
// oblasti: objednávky do 35 km od sebe se spojují (řetězově)
function rzAssign() {
  RZ.orders.forEach(o => { o.group = 'Samostatné'; o.groupName = 'Samostatné'; o.groupColor = '#df6a55'; });
  const v = RZ.orders.filter(rzHasXY); const seen = new Set(); let gid = 1;
  for (let i = 0; i < v.length; i++) {
    if (seen.has(i)) continue; const comp = []; const q = [i]; seen.add(i);
    while (q.length) { const c = q.shift(); comp.push(c); for (let j = 0; j < v.length; j++) { if (seen.has(j)) continue; if (rzKm(v[c].lat, v[c].lng, v[j].lat, v[j].lng) <= RZ_RADIUS) { seen.add(j); q.push(j); } } }
    if (comp.length < 2) continue;
    const id = 'G' + gid, color = RZ_COLORS[(gid - 1) % RZ_COLORS.length]; gid++;
    const cnt = {}; comp.forEach(k => { const c = v[k].city || 'Oblast'; cnt[c] = (cnt[c] || 0) + 1; });
    const name = (Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || 'Oblast') + ' a okolí';
    comp.forEach(k => { v[k].group = id; v[k].groupName = name; v[k].groupColor = color; });
  }
}
const rzGroups = () => { const g = {}; RZ.orders.forEach(o => { (g[o.group] = g[o.group] || { id: o.group, name: o.groupName, color: o.groupColor, items: [], cities: {} }).items.push(o); if (o.city) g[o.group].cities[o.city] = 1; }); return Object.values(g).sort((a, b) => a.id === 'Samostatné' ? 1 : b.id === 'Samostatné' ? -1 : b.items.length - a.items.length); };
const rzBase = () => { const q = fold(RZ.q).trim(); return RZ.orders.filter(o => (RZ.group === 'ALL' || o.group === RZ.group) && (!q || fold([o.code, o.city, o.zip, o.address, o.groupName, o.status, o.items].join(' ')).includes(q))); };
const rzShown = () => rzBase().filter(o => RZ.status === 'ALL' || o.status === RZ.status);
async function renderRozvozy() {
  shell('rz', `${pgHead('rz', 'Rozvozy', 'Plánování rozvozů objednávek na mapě.')}<div class="panel panel-b"><div class="sk" style="height:300px"></div></div>`);
  try { await Promise.all([loadSettings(), rzLoad()]); } catch (e) { $('#main').innerHTML = `${pgHead('rz', 'Rozvozy', '')}<div class="panel panel-b"><p class="err">${esc(e.message)}</p></div>`; return; }
  drawRozvozy();
}
function drawRozvozy() {
  if (location.hash !== '#/rozvozy') return;
  if (RZ.map) { try { RZ.map.remove(); } catch {} RZ.map = null; }
  const admin = S.me && S.me.role === 'admin'; const c = RZ.cfg || {};
  const head = pgHead('rz', 'Rozvozy', 'Plánování rozvozů objednávek na mapě — oblasti, výběr zastávek a trasa.', `<span class="muted small" id="rzLast">${c.syncedAt ? 'Shoptet: ' + ago(c.syncedAt) : 'zatím nenačteno'}</span>${c.hasCsv ? '<button class="btn" id="rzSync">↻ Načíst ze Shoptetu</button>' : ''}${admin ? '<button class="btn" id="rzCfg">⚙ Propojení</button>' : ''}`);
  if (!c.hasCsv) {
    $('#main').innerHTML = `${head}<div class="panel empty-big"><div class="ill">🗺️</div><h3>Rozvozy ještě nejsou propojené</h3><p>${admin ? 'Zadej odkaz na CSV export objednávek ze Shoptetu (ve starém Apps Scriptu: Nastavení projektu → Vlastnosti skriptu → <code>SHOPTET_EXPORT_URL</code>). Klíče Mapy.com jsou nepovinné — bez nich mapa běží na OpenStreetMap a trasy na náhradní službě.' : 'Propojení musí nejdřív nastavit správce.'}</p>${admin ? '<button class="btn primary" id="rzCfg2">⚙ Nastavit propojení</button>' : ''}</div>`;
    if ($('#rzCfg')) $('#rzCfg').onclick = rzConfig; if ($('#rzCfg2')) $('#rzCfg2').onclick = rzConfig; return;
  }
  $('#main').innerHTML = `${head}<div class="stats" id="rzStats"></div>
  <div class="oj-bar"><div class="search oj-q"><span class="ic">⌕</span><input id="rzq" placeholder="Hledat objednávku, město, adresu, zboží…" value="${esc(RZ.q)}"></div><div class="chips" id="rzSt"></div><span class="grow"></span>
    ${c.tileKey ? '' : '<span class="muted small">mapa: OpenStreetMap</span>'}<div class="seg" id="rzMt" ${c.tileKey ? '' : 'hidden'}><button data-m="basic" class="${RZ.mapType === 'basic' ? 'on' : ''}">Základní</button><button data-m="aerial" class="${RZ.mapType === 'aerial' ? 'on' : ''}">Letecká</button></div></div>
  <div class="rz-grid"><div class="panel rz-mapw"><div id="rzMap"></div><div class="rz-sum" id="rzSum"></div>
      <div class="rz-route" id="rzRoute" hidden><div class="rz-m"><span>Zastávky</span><b id="rzRs"></b></div><div class="rz-m"><span>Trasa</span><b id="rzRd"></b></div><div class="rz-m"><span>Čas</span><b id="rzRt"></b></div><div class="rz-m"><span>Hodnota</span><b id="rzRv"></b></div>
        <button class="btn sm" id="rzOpen">Otevřít v Mapy.com</button><button class="btn sm" id="rzNav">Navigovat</button><button class="btn sm" id="rzClr" title="Zrušit trasu">✕</button></div></div>
    <div class="rz-side"><section class="panel dash rz-areas-p"><div class="dash-h">${svgIco('rz')}<b>Doporučené oblasti</b><span class="grow"></span><button class="btn sm" id="rzAll">Zobrazit vše</button></div><div id="rzAreas" class="rz-areas"></div></section>
      <section class="panel dash rz-orders-p"><div class="dash-h"><b id="rzTitle">Všechny objednávky</b><span class="grow"></span><span class="tag blue" id="rzSelN">0 vybráno</span></div>
        <div class="rz-tb"><label class="chk ns-all"><input type="checkbox" id="rzSelAll"> Vybrat zobrazené</label><span class="grow"></span><button class="btn sm" id="rzOpt">Optimalizovat pořadí</button><button class="btn sm primary" id="rzDraw">Vykreslit trasu</button></div>
        <div id="rzMsg" class="rz-msg" hidden></div><div id="rzOrders" class="rz-list"></div></section></div></div>`;
  $('#rzq').oninput = e => { RZ.q = e.target.value; rzClearRoute(); rzRender(true); };
  $$('#rzMt button').forEach(b => b.onclick = () => { RZ.mapType = b.dataset.m; $$('#rzMt button').forEach(x => x.classList.toggle('on', x === b)); rzTiles(); });
  $('#rzAll').onclick = () => { RZ.group = 'ALL'; rzClearRoute(); rzRender(true); };
  $('#rzSelAll').onchange = e => { rzBulk(e.target.checked); };
  $('#rzOpt').onclick = rzOptimize; $('#rzDraw').onclick = rzDraw; $('#rzClr').onclick = () => { rzClearRoute(); rzRender(false); };
  $('#rzOpen').onclick = () => rzOpenUrl(false); $('#rzNav').onclick = () => rzOpenUrl(true);
  if ($('#rzSync')) $('#rzSync').onclick = rzSync; if ($('#rzCfg')) $('#rzCfg').onclick = rzConfig;
  rzRender(false); rzInitMap();
}
async function rzInitMap() {
  const el = $('#rzMap'); if (!el) return;
  let L; try { L = await loadLeaflet(); } catch (e) { el.innerHTML = `<p class="muted small" style="padding:14px">${esc(e.message)}</p>`; return; }
  if (!$('#rzMap')) return;
  RZ.map = L.map(el, { zoomControl: true }).setView([49.8, 15.5], 7);
  rzTiles();
  const icon = L.divIcon({ className: '', html: '<div class="rz-mk rz-wh">⌂</div>', iconSize: [44, 50], iconAnchor: [22, 46] });
  L.marker([RZ_WH.lat, RZ_WH.lng], { icon }).addTo(RZ.map).bindPopup(`<b>${esc(RZ_WH.name)}</b><br>${esc(RZ_WH.address)}`);
  RZ.mk = L.layerGroup().addTo(RZ.map); RZ.rt = L.layerGroup().addTo(RZ.map);
  rzMarkers(true); setTimeout(() => RZ.map && RZ.map.invalidateSize(), 200);
}
function rzTiles() {
  if (!RZ.map || !window.L) return; if (RZ.tile) RZ.map.removeLayer(RZ.tile);
  RZ.tile = (RZ.cfg.tileKey
    ? L.tileLayer(`https://api.mapy.cz/v1/maptiles/${RZ.mapType}/256/{z}/{x}/{y}?apikey=${encodeURIComponent(RZ.cfg.tileKey)}`, { minZoom: 0, maxZoom: 19, attribution: '<a href="https://mapy.com/" target="_blank" rel="noopener">Mapy.com</a> © Seznam.cz, a.s.' })
    : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' })).addTo(RZ.map);
  RZ.tile.bringToBack();
}
const rzPos = code => { const i = RZ.seq.indexOf(code); return i === -1 ? 0 : i + 1; };
function rzMarkers(fit) {
  if (!RZ.map || !RZ.mk) return; RZ.mk.clearLayers(); const pts = [];
  for (const o of rzShown()) {
    if (!rzHasXY(o)) continue; const m = rzMeta(o.status); const pos = rzPos(o.code);
    const icon = L.divIcon({ className: '', html: `<div class="rz-mk${pos ? ' sel' : ''}" style="--mc:${m.color};--mt:${m.text}">${esc(pos ? String(pos) : o.code.slice(-4))}<span class="rz-mk-l">${esc(m.label)}</span></div>`, iconSize: [72, 58], iconAnchor: [36, 52] });
    const mk = L.marker([o.lat, o.lng], { icon }).bindTooltip(esc(o.code + ' · ' + (o.city || '')), { direction: 'top', offset: [0, -38], opacity: .94 });
    mk.on('click', () => rzDetail(o)); mk.addTo(RZ.mk); pts.push([o.lat, o.lng]);
  }
  if (RZ.route) RZ.route.latlngs.forEach(p => pts.push(p));
  if (fit) { if (pts.length) RZ.map.fitBounds(pts, { paddingTopLeft: [50, 70], paddingBottomRight: [50, 50], maxZoom: 13 }); else RZ.map.setView([49.8, 15.5], 7); }
}
function rzRender(fit) {
  const all = RZ.orders; const groups = rzGroups(); const base = rzBase(); const shown = rzShown();
  const ready = all.filter(o => RZ_READY.includes(o.status)).length; const noXY = all.filter(o => !rzHasXY(o)).length;
  const st = (k, v, sub, c) => `<div class="panel stat" style="--c:${c}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  $('#rzStats').innerHTML = st('Objednávek', all.length, noXY ? `${noXY} bez souřadnic` : 'všechny na mapě', 'var(--brand)') + st('Oblastí', groups.filter(g => g.id !== 'Samostatné').length, 'doporučených (do 35 km)', 'var(--s-sent)') + st('Připraveno', ready, 'k rozvozu', 'var(--s-confirmed)') + st('Hodnota', rzCompact(all.reduce((t, o) => t + o.total, 0)), 'všech objednávek', 'var(--s-postponed)');
  $('#rzSt').innerHTML = `<button class="chip ${RZ.status === 'ALL' ? 'on' : ''}" data-s="ALL">Vše <span class="tag grey">${base.length}</span></button>` + RZ_ST.map(([k, l, c]) => { const n = base.filter(o => o.status === k).length; return n ? `<button class="chip ${RZ.status === k ? 'on' : ''}" data-s="${esc(k)}"><i class="rz-dot" style="background:${c}"></i>${l} <span class="tag grey">${n}</span></button>` : ''; }).join('');
  $$('#rzSt .chip').forEach(b => b.onclick = () => { RZ.status = b.dataset.s; rzClearRoute(); rzRender(true); });
  $('#rzAll').classList.toggle('primary', RZ.group === 'ALL');
  $('#rzAreas').innerHTML = groups.map(g => { const rd = g.items.filter(o => RZ_READY.includes(o.status)).length; const pr = g.items.length ? Math.round(100 * rd / g.items.length) : 0;
    return `<div class="rz-area${RZ.group === g.id ? ' on' : ''}" data-g="${esc(g.id)}"><div class="rz-at"><i class="rz-dot" style="background:${esc(g.color)}"></i><b>${esc(g.name)}</b><span class="tag blue">${g.items.length}</span></div><div class="small muted">${rd} připraveno · ${g.items.length - rd} v procesu</div><div class="rz-pg"><i style="width:${pr}%"></i></div><div class="small muted rz-af"><span>${esc(Object.keys(g.cities).slice(0, 3).join(' · ') || 'Bez města')}</span><b>${rzCompact(g.items.reduce((t, o) => t + o.total, 0))}</b></div></div>`; }).join('') || '<div class="muted small" style="padding:8px">Zatím nejsou žádné oblasti.</div>';
  $$('.rz-area').forEach(a => a.onclick = () => { RZ.group = a.dataset.g; RZ.status = 'ALL'; rzClearRoute(); rzRender(true); });
  $('#rzTitle').textContent = (RZ.group === 'ALL' ? 'Všechny objednávky' : (RZ.orders.find(o => o.group === RZ.group) || {}).groupName || 'Oblast') + (RZ.status !== 'ALL' ? ' · ' + rzMeta(RZ.status).label : '');
  $('#rzOrders').innerHTML = shown.map(o => { const m = rzMeta(o.status); const sel = !!rzPos(o.code);
    return `<div class="rz-card${sel ? ' sel' : ''}" data-c="${esc(o.code)}" style="--c:${m.color}"><i class="rz-stripe"></i><input type="checkbox" class="rz-chk" ${sel ? 'checked' : ''} aria-label="Vybrat objednávku"><div class="rz-main"><div class="rz-code">${sel ? `<span class="rz-pos">${rzPos(o.code)}</span>` : ''}<b>${esc(o.code)}</b><span class="rz-badge" style="--c:${m.color};--t:${m.text}">${esc(m.label)}</span>${rzHasXY(o) ? '' : '<span class="tag">bez souřadnic</span>'}</div><div class="small muted rz-addr">${esc(o.address || 'Adresa neuvedena')}</div></div><div class="rz-r"><b>${esc(o.city || '—')}</b><div class="small">${rzMoney(o.total)}</div></div><span class="muted">›</span></div>`; }).join('') || '<div class="empty-big" style="padding:24px"><h3>Žádné objednávky</h3><p>Pro zvolený filtr tu nic není.</p></div>';
  $$('.rz-card').forEach(c => { const o = RZ.orders.find(x => x.code === c.dataset.c); c.onclick = e => { if (e.target.classList.contains('rz-chk')) return; if (RZ.map && rzHasXY(o)) RZ.map.flyTo([o.lat, o.lng], Math.max(RZ.map.getZoom(), 13), { duration: .45 }); rzDetail(o); }; $('.rz-chk', c).onchange = e => rzToggle(o.code, e.target.checked); });
  const n = RZ.seq.length; $('#rzSelN').textContent = n + ' vybráno'; const sv = shown.filter(o => rzPos(o.code)).length;
  const sa = $('#rzSelAll'); sa.checked = shown.length > 0 && sv === shown.length; sa.indeterminate = sv > 0 && sv < shown.length;
  $('#rzOpt').disabled = n < 2; $('#rzDraw').disabled = n === 0;
  $('#rzSum').innerHTML = `<b>${shown.length}</b> zobrazeno · ${RZ.group === 'ALL' ? 'všechny oblasti' : esc((RZ.orders.find(o => o.group === RZ.group) || {}).groupName || '')}`;
  rzMarkers(fit);
}
function rzToggle(code, on) { if (on) { if (!RZ.seq.includes(code)) RZ.seq.push(code); } else RZ.seq = RZ.seq.filter(c => c !== code); rzClearRoute(); rzRender(false); }
function rzBulk(on) { for (const o of rzShown()) { if (on) { if (!RZ.seq.includes(o.code)) RZ.seq.push(o.code); } else RZ.seq = RZ.seq.filter(c => c !== o.code); } rzClearRoute(); rzRender(false); }
const rzSelected = () => RZ.seq.map(c => RZ.orders.find(o => o.code === c)).filter(o => o && rzHasXY(o));
function rzMsg(t) { const m = $('#rzMsg'); if (!m) return; m.hidden = !t; m.textContent = t || ''; }
function rzValid(sel) { if (!sel.length) { toast('Nejdřív vyber alespoň jednu objednávku se souřadnicemi.', true); return false; } if (sel.length > RZ_MAX) { toast(`Pro jednu trasu lze vybrat nejvýše ${RZ_MAX} objednávek.`, true); return false; } return true; }
function rzOptimize() {
  const sel = rzSelected(); if (!rzValid(sel)) return;
  const dist = list => { let t = 0, la = RZ_WH.lat, ln = RZ_WH.lng; for (const o of list) { t += rzKm(la, ln, o.lat, o.lng); la = o.lat; ln = o.lng; } return t; };
  const rem = sel.slice(); let ord = []; let la = RZ_WH.lat, ln = RZ_WH.lng;
  while (rem.length) { let bi = 0, bd = Infinity; rem.forEach((o, i) => { const d = rzKm(la, ln, o.lat, o.lng); if (d < bd) { bd = d; bi = i; } }); const nx = rem.splice(bi, 1)[0]; ord.push(nx); la = nx.lat; ln = nx.lng; }
  if (ord.length >= 4) { let best = dist(ord), imp = true, loops = 0; while (imp && loops++ < 20) { imp = false; for (let i = 0; i < ord.length - 1; i++) for (let k = i + 1; k < ord.length; k++) { const c = [...ord.slice(0, i), ...ord.slice(i, k + 1).reverse(), ...ord.slice(k + 1)]; const d = dist(c); if (d + 0.01 < best) { ord = c; best = d; imp = true; } } } }
  const rest = RZ.seq.filter(c => !ord.some(o => o.code === c)); RZ.seq = [...ord.map(o => o.code), ...rest];
  rzClearRoute(); rzRender(false); rzMsg('Pořadí zastávek bylo optimalizováno od skladu. Klikni na „Vykreslit trasu“.'); toast('Pořadí zastávek optimalizováno ✓');
}
async function rzDraw() {
  const sel = rzSelected(); if (!rzValid(sel)) return; rzMsg('Počítám trasu v Mapy.com…'); $('#rzDraw').disabled = true;
  try {
    const r = await rzCall({ action: 'route', stops: sel.map(o => ({ lat: o.lat, lng: o.lng })) });
    if (!r.ok) { rzMsg(r.message || 'Trasu se nepodařilo vypočítat.'); return; }
    RZ.route = { latlngs: r.latlngs, len: r.lengthMeters, dur: r.durationSeconds }; rzMsg(r.note || '');
    RZ.rt.clearLayers(); L.polyline(r.latlngs, { color: '#fff', weight: 12, opacity: .96, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(RZ.rt); const line = L.polyline(r.latlngs, { color: '#1267E8', weight: 7, opacity: .98, lineCap: 'round', lineJoin: 'round' }).addTo(RZ.rt);
    sel.forEach((o, i) => { const m = rzMeta(o.status); L.marker([o.lat, o.lng], { zIndexOffset: 1000 + i, icon: L.divIcon({ className: '', html: `<div class="rz-mk rz-stop" style="--mc:${m.color};--mt:${m.text}">${i + 1}</div>`, iconSize: [48, 48], iconAnchor: [24, 45] }) }).bindTooltip(`${i + 1}. ${esc(o.code)} · ${esc(o.city || '')}`, { direction: 'top', offset: [0, -38] }).addTo(RZ.rt); });
    RZ.map.fitBounds(line.getBounds(), { padding: [55, 55] });
    $('#rzRs').textContent = sel.length; $('#rzRd').textContent = r.lengthMeters ? (r.lengthMeters >= 1000 ? (r.lengthMeters / 1000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + ' km' : Math.round(r.lengthMeters) + ' m') : '—';
    const min = Math.round((r.durationSeconds || 0) / 60); $('#rzRt').textContent = r.durationSeconds ? (min >= 60 ? Math.floor(min / 60) + ' h ' + (min % 60) + ' min' : min + ' min') : '—'; $('#rzRv').textContent = rzCompact(sel.reduce((t, o) => t + o.total, 0)); $('#rzRoute').hidden = false;
  } catch (e) { rzMsg(e.message); } finally { const b = $('#rzDraw'); if (b) b.disabled = RZ.seq.length === 0; }
}
function rzClearRoute() { RZ.route = null; if (RZ.rt) RZ.rt.clearLayers(); const r = $('#rzRoute'); if (r) r.hidden = true; rzMsg(''); }
function rzUrl(sel, nav) {
  const end = sel[sel.length - 1]; const p = ['mapset=traffic', 'start=' + encodeURIComponent(RZ_WH.lng + ',' + RZ_WH.lat), 'end=' + encodeURIComponent(end.lng + ',' + end.lat), 'routeType=car_fast_traffic'];
  if (sel.length > 1) p.push('waypoints=' + encodeURIComponent(sel.slice(0, -1).map(o => o.lng + ',' + o.lat).join(';')));
  if (nav) p.push('navigate=true'); return 'https://mapy.com/fnc/v1/route?' + p.join('&');
}
function rzOpenUrl(nav) { const sel = rzSelected(); if (!rzValid(sel)) return; window.open(rzUrl(sel, nav), '_blank', 'noopener'); }
async function rzDetail(o) {
  const m = rzMeta(o.status); const items = String(o.items || '').split('|').map(x => x.trim()).filter(Boolean); const inRoute = !!rzPos(o.code);
  const done = modal({ title: o.code, body: `<span class="rz-badge" style="--c:${m.color};--t:${m.text}">${esc(m.label)}</span>
    <label>Doručovací adresa</label><div>${esc(o.address || '—')}</div>
    <div class="rz-tiles"><div class="panel panel-b"><b>${rzMoney(o.total)}</b><div class="small muted">Celková hodnota</div></div><div class="panel panel-b"><b>${rzMoney(o.paid)}</b><div class="small muted">Uhrazeno</div></div></div>
    <label>Obsah objednávky</label><ul class="rz-items">${items.map(x => `<li>${esc(x)}</li>`).join('') || '<li>Obsah není v exportu uveden.</li>'}</ul>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><a class="btn sm" target="_blank" rel="noopener" href="https://mapy.com/cs/zakladni?q=${encodeURIComponent(o.address || '')}">Otevřít v Mapy.com</a><button class="btn sm" id="rzCopy" type="button">Kopírovat adresu</button></div>`,
    actions: [{ label: 'Zavřít', value: null }, { label: inRoute ? 'Odebrat z trasy' : 'Přidat do trasy', cls: 'primary', value: 'toggle' }] });
  setTimeout(() => { const b = $('#rzCopy'); if (b) b.onclick = () => navigator.clipboard.writeText(o.address || '').then(() => toast('Adresa zkopírována ✓'), () => toast('Kopírování se nepovedlo.', true)); }, 40);
  if ((await done) === 'toggle') { if (!rzHasXY(o) && !inRoute) toast('Objednávka nemá souřadnice — v trase se nepoužije.', true); rzToggle(o.code, !inRoute); }
}
async function rzSync() {
  if (RZ.sync) return; RZ.sync = true; const set = t => { const b = $('#rzSync'); if (b) { b.disabled = true; b.innerHTML = `<span class="spin"></span> ${t}`; } };
  let msg = '', warn = false;
  try {
    let r, guard = 0; do { set(guard ? 'Doplňuji souřadnice…' : 'Stahuji objednávky…'); r = await rzCall({ action: 'sync' }); if (r.ok === false) throw new Error(r.error); } while (r.geoRemaining > 0 && ++guard < 12);
    msg = `Načteno ${r.orders} objednávek`; if (r.missing) { warn = true; msg += ` · ${r.missing} bez souřadnic (adresu se nepodařilo najít${r.geoDiag ? ': ' + r.geoDiag : ''})`; }
    await rzLoad();
  } catch (e) { warn = true; msg = e.message; }
  RZ.sync = false; drawRozvozy(); toast(msg, warn);
}
async function rzConfig() {
  const c = RZ.cfg || {};
  const v = await modal({ title: 'Propojení rozvozů', body: `<p class="muted small">Povinný je jen odkaz na export ze Shoptetu. Klíče Mapy.com jsou <b>nepovinné</b>: bez nich mapa běží na OpenStreetMap, adresy se hledají přes OpenStreetMap a trasy přes náhradní službu (bez aktuální dopravy). Hodnoty najdeš ve starém Apps Scriptu: Nastavení projektu → Vlastnosti skriptu. Prázdné pole se nezmění; uložené hodnoty se nezobrazují.</p>
    <label>Odkaz na CSV export objednávek ze Shoptetu <span class="muted small">(<code>SHOPTET_EXPORT_URL</code>) ${c.hasCsv ? '· uloženo ✓' : ''}</span></label><input data-k="csv" placeholder="https://…" autocomplete="off">
    <label>Klíč Mapy.com pro mapu <span class="muted small">(nepovinné, <code>MAPY_TILE_API_KEY</code>) ${c.tileKey ? '· uloženo ✓' : ''}</span></label><input data-k="tile" autocomplete="off">
    <label>Klíč Mapy.com pro trasy a adresy <span class="muted small">(nepovinné, <code>MAPY_API_KEY_SERVER</code> — když nevíš, nech prázdné: použije se klíč pro mapu) ${c.hasRoute ? '· uloženo ✓' : ''}</span></label><input data-k="route" autocomplete="off">`, focus: '[data-k="csv"]',
    actions: [{ label: 'Zrušit', value: null }, { label: 'Uložit', cls: 'primary', value: bd => ({ csvUrl: $('[data-k="csv"]', bd).value.trim(), tileKey: $('[data-k="tile"]', bd).value.trim(), routeKey: $('[data-k="route"]', bd).value.trim() }) }] });
  if (!v) return;
  try { await rzCall({ action: 'config_save', ...v }); await rzLoad(); drawRozvozy(); toast('Propojení uloženo ✓'); } catch (e) { toast(e.message, true); }
}
const INV_KIND = { partial: 'Dílčí inventura', annual: 'Roční inventura' };
const INV_CHECK = ['Naskladnit všechny příjemky a svozy, které dorazily', 'Zpracovat kontejnery, které už dorazily na sklad', 'Domluvit pauzu v příjmu a expedici na dobu počítání', 'Vyřadit poškozené a rozbalené zboží, ať je to zvlášť', 'Rozdělit sklad na zóny / regály a určit počítací dvojice', 'Načíst aktuální stav skladu ze Shoptetu a vyexportovat ho (záloha)', 'Vytisknout počítací soupisy', 'Určit termín a informovat tým'];
const INV = { ses: null, items: [], q: '', f: 'all', limit: 200, showSys: false, plus: false };
const invNum = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const invStockId = () => Number((S.settings && S.settings.data && S.settings.data.shoptetStockId)) || 1;
const invBadge = st => `<span class="st" data-s="${INV_ST[st][1]}">${INV_ST[st][0]}</span>`;
const invDiff = it => (it.counted_qty == null || it.system_qty == null) ? null : Number(it.counted_qty) - Number(it.system_qty);
const invFmtD = d => d == null ? '' : d === 0 ? '<span class="stp ok">✓ 0</span>' : `<span class="stp ${d > 0 ? 'go' : 'bad'}">${d > 0 ? '+' : '−'}${fmtQ(Math.abs(d))}</span>`;
const invPieces = n => `${n} ${n === 1 ? 'položka' : n < 5 ? 'položky' : 'položek'}`;
const invDownload = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };

async function renderInvList() {
  shell('inv', `<div class="pg-head"><span class="pg-ico">${svgIco('inv')}</span><div class="grow"><h1>Inventura</h1><p>Přepočty zásob a roční inventura skladu.</p></div></div><div class="panel panel-b"><div class="sk" style="height:140px"></div></div>`);
  let rows = [];
  try { rows = check(await sb.from('inv_sessions').select('*').order('created_at', { ascending: false }).limit(60)); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const counts = await Promise.all(rows.map(async r => {
    const [a, b] = await Promise.all([sb.from('inv_items').select('id', { count: 'exact', head: true }).eq('session_id', r.id), sb.from('inv_items').select('id', { count: 'exact', head: true }).eq('session_id', r.id).not('counted_qty', 'is', null)]);
    return [r.id, a.count || 0, b.count || 0];
  }));
  const cm = Object.fromEntries(counts.map(c => [c[0], c]));
  const year = new Date().getFullYear();
  const hasAnnual = rows.some(r => r.kind === 'annual' && String(r.created_at).slice(0, 4) === String(year));
  const card = r => { const [, tot, cnt] = cm[r.id] || [0, 0, 0]; const pct = tot ? Math.round(100 * cnt / tot) : 0;
    return `<a class="panel inv-card" href="#/inventura/${r.id}"><div class="inv-ch"><b>${esc(r.title)}</b>${invBadge(r.status)}</div>
      <div class="small muted">${INV_KIND[r.kind]}${r.planned_at ? ' · termín ' + czDate(r.planned_at) : ''} · založil(a) ${esc(userName(r.created_by))}, ${czDate(String(r.created_at).slice(0, 10))}</div>
      <div class="inv-pb"><i style="width:${pct}%"></i></div><div class="small muted">${cnt} z ${tot} napočteno${r.done_at ? ' · uzavřeno ' + czDate(String(r.done_at).slice(0, 10)) : ''}</div></a>`; };
  const act = rows.filter(r => r.status !== 'done'), done = rows.filter(r => r.status === 'done');
  $('#main').innerHTML = `
  <div class="pg-head"><span class="pg-ico">${svgIco('inv')}</span><div class="grow"><h1>Inventura</h1><p>Přepočty zásob a roční inventura skladu.</p></div><button class="btn primary of-new" id="invNew">＋ Nová inventura</button></div>
  ${!hasAnnual ? `<section class="panel inv-banner"><span class="td-i" style="--c:var(--s-postponed)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${NAV_SVG.inv}</svg></span><div class="grow"><b>Roční inventura ${year}</b><div class="small muted">Celoskladová inventura na konci roku — připrav si seznam zboží, kontrolní seznam před inventurou a počítací soupisy.</div></div><button class="btn primary" id="invAnnual">Připravit roční inventuru</button></section>` : ''}
  <h3 class="oj-h">Probíhající a připravované</h3>
  ${act.length ? `<div class="inv-grid">${act.map(card).join('')}</div>` : '<div class="panel panel-b muted">Žádná inventura. Nová dílčí inventura: tlačítko nahoře — vybereš zboží, které se má přepočítat.</div>'}
  ${done.length ? `<h3 class="oj-h">Uzavřené</h3><div class="inv-grid">${done.map(card).join('')}</div>` : ''}`;
  $('#invNew').onclick = () => invCreate('partial');
  if ($('#invAnnual')) $('#invAnnual').onclick = () => invCreate('annual');
}
async function invCreate(kind) {
  const year = new Date().getFullYear();
  const v = await modal({ title: kind === 'annual' ? 'Nová roční inventura' : 'Nová inventura',
    body: `<label>Název</label><input data-k="t" value="${esc(kind === 'annual' ? 'Roční inventura ' + year : '')}" placeholder="např. Přepočet terasová prkna">
      <label>Druh</label><select data-k="k"><option value="partial" ${kind === 'partial' ? 'selected' : ''}>Dílčí — jen vybrané zboží</option><option value="annual" ${kind === 'annual' ? 'selected' : ''}>Roční — celý sklad</option></select>
      <label>Termín (nepovinné)</label><input type="date" data-k="d" value="${kind === 'annual' ? year + '-12-31' : ''}">
      <label>Poznámka</label><textarea data-k="n" rows="2"></textarea>`, focus: '[data-k="t"]',
    actions: [{ label: 'Zrušit', value: null }, { label: 'Založit', cls: 'primary', value: bd => ({ t: $('[data-k="t"]', bd).value.trim(), k: $('[data-k="k"]', bd).value, d: $('[data-k="d"]', bd).value || null, n: $('[data-k="n"]', bd).value.trim() }) }] });
  if (!v) return;
  if (!v.t) return toast('Zadej název inventury.', true);
  try {
    const r = check(await sb.from('inv_sessions').insert({ title: v.t, kind: v.k, planned_at: v.d, note: v.n || null, created_by: S.me.id, checklist: v.k === 'annual' ? INV_CHECK.map(t => ({ t, done: false })) : [] }).select('id').single());
    location.hash = '#/inventura/' + r.id;
  } catch (e) { toast(e.message, true); }
}

// ----- detail -----
async function invLoad(id) {
  const ses = check(await sb.from('inv_sessions').select('*').eq('id', id).single());
  const items = await fetchAll(() => sb.from('inv_items').select('*').eq('session_id', id).order('location', { nullsFirst: false }).order('code'));
  INV.ses = ses; INV.items = items;
}
async function renderInvDetail(id) {
  shell('inv', `<div class="pg-head"><div class="sk" style="height:46px;width:300px"></div></div><div class="panel panel-b"><div class="sk" style="height:220px"></div></div>`);
  try { await Promise.all([invLoad(id), loadSettings(), loadProducts()]); } catch (e) { $('#main').innerHTML = `<div class="panel empty-big"><div class="ill">🔍</div><h3>Inventuru se nepodařilo otevřít</h3><p>${esc(e.message)}</p><a class="btn" href="#/inventura">← Zpět</a></div>`; return; }
  Object.assign(INV, { q: '', f: 'all', limit: 200, showSys: false, plus: false });
  drawInv();
}
const invFiltered = () => {
  const q = fold(INV.q).trim();
  return INV.items.filter(it => {
    if (INV.f === 'todo' && it.counted_qty != null) return false;
    if (INV.f === 'diff' && !(it.counted_qty != null && it.system_qty != null && Number(it.counted_qty) !== Number(it.system_qty))) return false;
    if (INV.f === 'ok' && !(it.counted_qty != null && it.system_qty != null && Number(it.counted_qty) === Number(it.system_qty))) return false;
    return !q || fold([it.code, it.name, it.ean, it.location, it.note].join(' ')).includes(q);
  });
};
function invStats() {
  const it = INV.items; const counted = it.filter(x => x.counted_qty != null);
  const diffs = counted.filter(x => x.system_qty != null && Number(x.counted_qty) !== Number(x.system_qty));
  const plus = diffs.reduce((a, x) => a + Math.max(0, invDiff(x)), 0), minus = diffs.reduce((a, x) => a + Math.max(0, -invDiff(x)), 0);
  const noSys = counted.filter(x => x.system_qty == null).length;
  return { total: it.length, counted: counted.length, diffs: diffs.length, plus, minus, noSys, todo: it.length - counted.length };
}
function invRowHtml(it, st, showSys) {
  const d = invDiff(it); const edit = st === 'counting' || st === 'draft' || st === 'review';
  return `<tr data-id="${it.id}"${it.applied_at ? ' class="applied"' : ''}>
    <td class="nowrap"><b>${esc(it.code)}</b>${it.ean ? `<div class="small muted">${esc(it.ean)}</div>` : ''}</td>
    <td>${esc(it.name || '—')}</td>
    <td>${edit && st !== 'review' ? `<input class="inv-loc" data-f="location" value="${esc(it.location || '')}" placeholder="regál / zóna">` : esc(it.location || '—')}</td>
    ${showSys ? `<td class="r nowrap">${it.system_qty == null ? '<span class="muted">—</span>' : fmtQ(it.system_qty)}</td>` : ''}
    <td class="r">${st === 'counting' || st === 'review' ? `<input class="inv-q" data-f="counted" inputmode="decimal" value="${it.counted_qty == null ? '' : fmtQ(it.counted_qty).replace(/\s/g, '')}" ${it.applied_at ? 'disabled' : ''}>` : (it.counted_qty == null ? '<span class="muted">—</span>' : fmtQ(it.counted_qty))}</td>
    ${showSys ? `<td class="r nowrap inv-d">${invFmtD(d)}${it.applied_at ? ' <span class="tag blue" title="Odesláno do Shoptetu">✓ Shoptet</span>' : ''}</td>` : ''}
    <td>${st === 'counting' || st === 'review' ? `<input class="inv-n" data-f="note" value="${esc(it.note || '')}" placeholder="poznámka">` : esc(it.note || '')}</td>
    <td class="r">${st === 'draft' ? `<button class="btn sm ghost" data-del="${it.id}" title="Odebrat z inventury">✕</button>` : ''}</td></tr>`;
}
function invTableHtml(st) {
  const showSys = st !== 'counting' || INV.showSys;
  const list = invFiltered(); const shown = list.slice(0, INV.limit);
  return `<div class="panel" style="overflow-x:auto"><table class="list inv-t"><thead><tr><th>Kód / EAN</th><th>Název</th><th>Umístění</th>${showSys ? '<th class="r">V systému</th>' : ''}<th class="r">Napočteno</th>${showSys ? '<th class="r">Rozdíl</th>' : ''}<th>Poznámka</th><th></th></tr></thead>
    <tbody>${shown.map(it => invRowHtml(it, st, showSys)).join('') || `<tr><td colspan="8" class="empty">${INV.items.length ? 'Nic nenalezeno.' : 'Zatím žádné zboží. Přidej ho v kroku Příprava.'}</td></tr>`}</tbody></table></div>
    ${list.length > INV.limit ? `<div style="text-align:center;margin:12px"><button class="btn" id="invMore">Zobrazit dalších ${Math.min(200, list.length - INV.limit)} (zbývá ${list.length - INV.limit})</button></div>` : ''}`;
}
function drawInv() {
  const ses = INV.ses, st = ses.status; const stt = invStats(); const idx = INV_STEPS.indexOf(st);
  const acts = {
    draft: `<button class="btn primary" id="invStart">Zahájit počítání ›</button>`,
    counting: `<button class="btn" id="invPrint">🖨 Tisk soupisu</button><button class="btn primary" id="invReview">Předat ke kontrole ›</button>`,
    review: `<button class="btn" id="invBack">‹ Zpět k počítání</button><button class="btn primary" id="invApply">Schválit a naskladnit do Shoptetu</button>`,
    done: '',
  }[st];
  $('#main').innerHTML = `
  <div class="pg-head"><a class="btn ghost" href="#/inventura" title="Zpět">←</a><span class="pg-ico">${svgIco('inv')}</span><div class="grow"><h1>${esc(ses.title)}</h1><p>${INV_KIND[ses.kind]}${ses.planned_at ? ' · termín ' + czDate(ses.planned_at) : ''}${ses.note ? ' · ' + esc(ses.note) : ''}</p></div>
    ${st === 'draft' || st === 'counting' ? '<button class="btn sm ghost" id="invEdit" title="Upravit název a termín">✎</button><button class="btn sm ghost" id="invDelete" title="Smazat inventuru">🗑</button>' : ''}</div>
  <div class="inv-steps">${INV_STEPS.map((k, i) => `<div class="inv-step ${i < idx ? 'done' : ''} ${i === idx ? 'on' : ''}"><i>${i < idx ? '✓' : i + 1}</i><span>${INV_ST[k][0]}</span></div>`).join('<b></b>')}</div>
  <div class="kpis k4 inv-kpis"><div class="panel kpi" style="--c:var(--s-sent)"><span class="kpi-t"><span class="kpi-l">Položek v inventuře</span><b class="kpi-v">${stt.total}</b></span></div>
    <div class="panel kpi" style="--c:var(--s-confirmed)"><span class="kpi-t"><span class="kpi-l">Napočteno</span><b class="kpi-v" id="kC">${stt.counted}</b><div class="inv-pb"><i style="width:${stt.total ? Math.round(100 * stt.counted / stt.total) : 0}%"></i></div></span></div>
    <div class="panel kpi" style="--c:var(--s-postponed)"><span class="kpi-t"><span class="kpi-l">Rozdíly</span><b class="kpi-v" id="kD">${stt.diffs}</b></span></div>
    <div class="panel kpi" style="--c:var(--s-rejected)"><span class="kpi-t"><span class="kpi-l">Přebytek / manko (ks)</span><b class="kpi-v" id="kPM" style="font-size:22px">+${fmtQ(stt.plus)} / −${fmtQ(stt.minus)}</b></span></div></div>
  ${st === 'draft' ? invPrepHtml() : ''}
  ${st === 'counting' ? `<section class="panel inv-scan"><label class="grow" style="margin:0">Rychlé zadání — naskenuj nebo napiš kód / EAN a stiskni Enter<input id="invScan" placeholder="kód nebo EAN…" autocomplete="off" inputmode="search"></label>
    <label class="chk"><input type="checkbox" id="invPlus" ${INV.plus ? 'checked' : ''}> každé skenování = +1 ks</label><label class="chk"><input type="checkbox" id="invSys" ${INV.showSys ? 'checked' : ''}> ukázat stav v systému</label></section>` : ''}
  <div class="of-tabsrow" style="margin-top:14px"><div class="chips" id="invF">${[['all', 'Vše'], ['todo', 'Nenapočítáno'], ['diff', 'Rozdíly'], ['ok', 'Souhlasí']].map(([k, l]) => `<button class="chip ${INV.f === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    <div class="search of-search grow"><span class="ic">⌕</span><input id="invQ" placeholder="Hledat kód, název, umístění…" value="${esc(INV.q)}"></div>
    <button class="btn" id="invCsv">⬇ CSV</button>${st === 'draft' ? '<button class="btn" id="invPrint2">🖨 Tisk soupisu</button>' : ''}${st === 'draft' || st === 'counting' || st === 'review' ? '<button class="btn" id="invSyncSys">↻ Načíst stav ze Shoptetu</button>' : ''}${acts}</div>
  <div id="invTbl">${invTableHtml(st)}</div>
  ${st === 'done' ? `<p class="muted small" style="margin-top:12px">Inventura uzavřena${ses.done_at ? ' ' + czDateTime(ses.done_at) : ''}. Pohyby jsou vidět v Historii pohybů (zdroj „Inventura“).</p>` : ''}`;
  bindInv();
}
function invPrepHtml() {
  const ses = INV.ses;
  return `<section class="panel inv-prep"><div class="dash-h"><b>Příprava — co se bude počítat</b></div><div class="dash-b">
    <div class="inv-add"><div class="search grow"><span class="ic">⌕</span><input id="invAdd" placeholder="Přidat produkt — hledej kód, název, EAN…" autocomplete="off"></div></div><div id="invAddRes" class="inv-res"></div>
    <div class="inv-tools"><button class="btn" id="invPaste">📋 Vložit seznam kódů</button><button class="btn" id="invGroup">🏷 Podle dodavatele / výrobce</button><button class="btn" id="invAll">📦 Celý katalog</button></div></div></section>
  ${ses.kind === 'annual' ? `<div class="inv-two"><section class="panel dash"><div class="dash-h"><b>Kontrolní seznam před inventurou</b><span class="grow"></span><button class="btn sm" id="chkAdd">＋ Přidat</button></div><div class="dash-b nopad" id="invChk">${invChecklistHtml()}</div></section>
    <section class="panel dash"><div class="dash-h"><b>Co ještě zbývá naskladnit</b></div><div class="dash-b" id="invReady"><div class="sk" style="height:90px"></div></div></section></div>` : ''}`;
}
const invChecklistHtml = () => {
  const l = INV.ses.checklist || [];
  return l.map((c, i) => `<label class="td-row chk-row"><input type="checkbox" data-ci="${i}" ${c.done ? 'checked' : ''}><span class="grow ${c.done ? 'done' : ''}">${esc(c.t)}</span><button class="btn sm ghost" data-cdel="${i}" title="Odebrat">✕</button></label>`).join('') + (l.length ? `<div class="small muted" style="padding:10px 18px">Hotovo ${l.filter(c => c.done).length} z ${l.length}</div>` : '<div class="td-empty">Prázdný seznam.</div>');
};
async function invReadiness() {
  const el = $('#invReady'); if (!el) return;
  const out = [];
  try {
    const rc = check(await sb.from('stock_receipts').select('id,doc_no,supplier,item_count,stocked_count').eq('deleted', false).order('created_at', { ascending: false }).limit(300));
    const open = rc.filter(r => (r.item_count || 0) > (r.stocked_count || 0));
    out.push([open.length, 'Příjemky, které nejsou celé naskladněné', open.slice(0, 4).map(r => `<a href="#/s/${r.id}">${esc(r.doc_no || r.supplier || 'příjemka')}</a>`).join(', '), '#/sklad']);
  } catch { out.push([null, 'Příjemky — nepodařilo se načíst']); }
  try {
    const sh = check(await sb.from('oj_shipments').select('id,reference,title,status,lines').eq('deleted', false).eq('status', 'arrived'));
    const open = sh.filter(x => (x.lines || []).some(l => !l.stocked && !l.skip));
    out.push([open.length, 'Svozy, které dorazily a čekají na naskladnění', open.slice(0, 4).map(x => `<a href="#/svoz/${x.id}">${esc(x.reference || x.title || 'svoz')}</a>`).join(', '), '#/objednavky']);
  } catch { out.push([null, 'Svozy — nepodařilo se načíst']); }
  if (hasApp('kontejnery')) {
    try {
      const ct = check(await sb.from('ct_containers').select('id,number,status').in('status', ['sailing', 'port']));
      out.push([ct.length, 'Kontejnery na cestě nebo v přístavu (dorazí-li před inventurou, počítej s nimi)', ct.slice(0, 4).map(c => `<a href="#/k/${c.id}">${esc(c.number || 'kontejner')}</a>`).join(', '), '#/kontejnery']);
    } catch { /* bez kontejnerů */ }
  }
  el.innerHTML = out.map(([n, l, extra]) => n === null ? `<div class="muted small">${l}</div>` : `<div class="rdy ${n ? 'warn' : 'ok'}"><b>${n ? n : '✓'}</b><div><div>${l}</div>${extra ? `<div class="small muted">${extra}</div>` : ''}</div></div>`).join('');
}
async function invPatchSes(f) { check(await sb.from('inv_sessions').update({ ...f, updated_at: nowIso() }).eq('id', INV.ses.id)); Object.assign(INV.ses, f); }
async function invAddProducts(prods) {
  const rows = prods.filter(p => p && p.code).map(p => ({ session_id: INV.ses.id, code: p.code, name: [p.name, p.variant].filter(Boolean).join(', ') || null, ean: p.ean || null }));
  if (!rows.length) return toast('Nic k přidání.', true);
  for (let i = 0; i < rows.length; i += 500) check(await sb.from('inv_items').upsert(rows.slice(i, i + 500), { onConflict: 'session_id,code', ignoreDuplicates: true }));
  const before = INV.items.length; await invLoad(INV.ses.id); drawInv();
  toast(`Přidáno ${INV.items.length - before} z ${rows.length} (zbytek už v inventuře je)`);
}
async function invSyncSystem(silent) {
  if (!INV.items.length) return toast('Nejdřív přidej zboží.', true);
  const btn = $('#invSyncSys'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Načítám…'; }
  try {
    const r = await shoptetCall({ action: 'inv_supplies', stockId: invStockId(), codes: INV.items.length < 3000 ? INV.items.map(i => i.code) : undefined });
    if (r.unknownShape && !Object.keys(r.supplies).length) throw new Error('Shoptet vrátil zásoby v neočekávaném tvaru (pole: ' + (r.sampleKeys || []).join(', ') + '). Napiš to správci.');
    const rows = INV.items.filter(i => r.supplies[i.code] != null).map(i => ({ session_id: INV.ses.id, code: i.code, system_qty: r.supplies[i.code] }));
    for (let i = 0; i < rows.length; i += 500) check(await sb.from('inv_items').upsert(rows.slice(i, i + 500), { onConflict: 'session_id,code' }));
    const miss = INV.items.length - rows.length;
    await invLoad(INV.ses.id); drawInv();
    toast(`Stav ze Shoptetu načten u ${rows.length} položek${miss ? `, ${miss} ve Shoptetu nenalezeno` : ''}`);
  } catch (e) { toast(e.message, true); if (btn) { btn.disabled = false; btn.textContent = '↻ Načíst stav ze Shoptetu'; } }
}
function invUpdateLive() {
  const stt = invStats();
  if ($('#kC')) { $('#kC').textContent = stt.counted; const pb = $('#kC').parentElement.querySelector('.inv-pb i'); if (pb) pb.style.width = (stt.total ? Math.round(100 * stt.counted / stt.total) : 0) + '%'; }
  if ($('#kD')) $('#kD').textContent = stt.diffs;
  if ($('#kPM')) $('#kPM').textContent = `+${fmtQ(stt.plus)} / −${fmtQ(stt.minus)}`;
}
async function invSaveField(it, f, raw, input) {
  let val = raw;
  if (f === 'counted') { val = invNum(raw); if (Number.isNaN(val) || (val != null && val < 0)) { toast('Zadej číslo (0 nebo víc).', true); input.value = it.counted_qty == null ? '' : fmtQ(it.counted_qty).replace(/\s/g, ''); return; } }
  const patch = f === 'counted' ? { counted_qty: val, counted_by: val == null ? null : S.me.id, counted_at: val == null ? null : nowIso() } : f === 'location' ? { location: String(val).trim() || null } : { note: String(val).trim() || null };
  try { check(await sb.from('inv_items').update(patch).eq('id', it.id)); Object.assign(it, patch); } catch (e) { toast(e.message, true); return; }
  if (f === 'counted') { const tr = input.closest('tr'); const d = tr && tr.querySelector('.inv-d'); if (d) d.innerHTML = invFmtD(invDiff(it)); invUpdateLive(); }
}
function bindInv() {
  const ses = INV.ses, st = ses.status;
  const redrawTbl = () => { $('#invTbl').innerHTML = invTableHtml(st); bindInvTbl(); };
  $$('#invF .chip').forEach(c => c.onclick = () => { INV.f = c.dataset.f; INV.limit = 200; $$('#invF .chip').forEach(x => x.classList.toggle('on', x === c)); redrawTbl(); });
  $('#invQ').oninput = e => { INV.q = e.target.value; INV.limit = 200; redrawTbl(); };
  $('#invCsv').onclick = () => { const rows = INV.items; invDownload(`Inventura_${fold(ses.title).replace(/[^a-z0-9]+/g, '_')}.csv`, [['kod', 'nazev', 'ean', 'umisteni', 'v_systemu', 'napocteno', 'rozdil', 'poznamka'], ...rows.map(i => [i.code, i.name || '', i.ean || '', i.location || '', i.system_qty == null ? '' : String(i.system_qty).replace('.', ','), i.counted_qty == null ? '' : String(i.counted_qty).replace('.', ','), invDiff(i) == null ? '' : String(invDiff(i)).replace('.', ','), i.note || ''])].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n')); toast('CSV staženo'); };
  if ($('#invPrint')) $('#invPrint').onclick = invPrint; if ($('#invPrint2')) $('#invPrint2').onclick = invPrint;
  if ($('#invSyncSys')) $('#invSyncSys').onclick = () => invSyncSystem();
  if ($('#invEdit')) $('#invEdit').onclick = async () => {
    const v = await modal({ title: 'Upravit inventuru', body: `<label>Název</label><input data-k="t" value="${esc(ses.title)}"><label>Termín</label><input type="date" data-k="d" value="${esc(ses.planned_at || '')}"><label>Poznámka</label><textarea data-k="n" rows="2">${esc(ses.note || '')}</textarea>`, actions: [{ label: 'Zrušit', value: null }, { label: 'Uložit', cls: 'primary', value: bd => ({ t: $('[data-k="t"]', bd).value.trim(), d: $('[data-k="d"]', bd).value || null, n: $('[data-k="n"]', bd).value.trim() || null }) }] });
    if (!v || !v.t) return; try { await invPatchSes({ title: v.t, planned_at: v.d, note: v.n }); drawInv(); } catch (e) { toast(e.message, true); }
  };
  if ($('#invDelete')) $('#invDelete').onclick = async () => { if (!(await confirmBox('Smazat inventuru?', `„${ses.title}“ se všemi napočtenými údaji se smaže. Do Shoptetu se nic neposílalo.`, { ok: 'Smazat', danger: true }))) return; try { check(await sb.from('inv_sessions').delete().eq('id', ses.id)); toast('Inventura smazána'); location.hash = '#/inventura'; } catch (e) { toast(e.message, true); } };
  if ($('#invStart')) $('#invStart').onclick = async () => {
    if (!INV.items.length) return toast('Nejdřív přidej zboží k počítání.', true);
    const open = (ses.checklist || []).filter(c => !c.done).length;
    if (open && !(await confirmBox('Zahájit počítání?', `V kontrolním seznamu ještě zbývá ${open} bodů. Zahájit i tak?`, { ok: 'Zahájit' }))) return;
    try { await invPatchSes({ status: 'counting' }); drawInv(); toast('Počítání zahájeno'); } catch (e) { toast(e.message, true); }
  };
  if ($('#invReview')) $('#invReview').onclick = async () => {
    const stt = invStats();
    if (stt.todo && !(await confirmBox('Předat ke kontrole?', `${invPieces(stt.todo)} ještě není napočtených. Nenapočtené se do Shoptetu neposílají (stav zůstane beze změny).`, { ok: 'Předat ke kontrole' }))) return;
    try { await invPatchSes({ status: 'review' }); INV.f = 'all'; drawInv(); } catch (e) { toast(e.message, true); }
  };
  if ($('#invBack')) $('#invBack').onclick = async () => { try { await invPatchSes({ status: 'counting' }); drawInv(); } catch (e) { toast(e.message, true); } };
  if ($('#invApply')) $('#invApply').onclick = invApply;
  if ($('#invSys')) $('#invSys').onchange = e => { INV.showSys = e.target.checked; drawInv(); };
  if ($('#invPlus')) $('#invPlus').onchange = e => { INV.plus = e.target.checked; };
  if ($('#invScan')) $('#invScan').onkeydown = async e => {
    if (e.key !== 'Enter') return; e.preventDefault(); const v = e.target.value.trim(); if (!v) return; const f = fold(v);
    let it = INV.items.find(x => fold(x.code) === f || (x.ean && fold(x.ean) === f));
    if (!it) {
      const p = (S.products || []).find(x => x.fcode === f || (x.ean && fold(x.ean) === f) || (x.mpn && fold(x.mpn) === f));
      if (!p) { toast(`„${v}“ — kód nenalezen.`, true); e.target.select(); return; }
      if (!(await confirmBox('Není v inventuře', `${p.code} — ${p.name} není v této inventuře. Přidat?`, { ok: 'Přidat' }))) return;
      await invAddProducts([p]); it = INV.items.find(x => x.code === p.code); if (!it) return;
    }
    if (INV.plus) {
      const nv = (it.counted_qty == null ? 0 : Number(it.counted_qty)) + 1;
      const tr = $(`#invTbl tr[data-id="${it.id}"]`); const inp = tr && tr.querySelector('.inv-q');
      if (inp) { inp.value = nv; await invSaveField(it, 'counted', String(nv), inp); inp.value = fmtQ(nv).replace(/\s/g, ''); tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash'); }
      else { await invSaveField(it, 'counted', String(nv), document.createElement('input')); toast(`${it.code}: ${nv}`); }
    } else {
      INV.f = 'all'; INV.q = ''; $('#invQ').value = ''; INV.limit = Math.max(INV.limit, INV.items.indexOf(it) + 5); redrawTbl();
      const tr = $(`#invTbl tr[data-id="${it.id}"]`); if (tr) { tr.scrollIntoView({ block: 'center' }); const inp = tr.querySelector('.inv-q'); if (inp) { inp.focus(); inp.select(); } }
    }
    e.target.value = ''; e.target.focus();
  };
  // příprava
  if (st === 'draft') {
    let t = null;
    $('#invAdd').oninput = e => { clearTimeout(t); t = setTimeout(() => {
      const res = searchProducts(e.target.value, true).slice(0, 12);
      $('#invAddRes').innerHTML = res.map(p => `<button class="inv-r" data-code="${esc(p.code)}"><b>${esc(p.code)}</b> ${esc(p.name)}${p.variant ? ', ' + esc(p.variant) : ''}${INV.items.some(i => i.code === p.code) ? ' <span class="tag blue">už v inventuře</span>' : ''}</button>`).join('');
      $$('#invAddRes .inv-r').forEach(b => b.onclick = async () => { const p = S.products.find(x => x.code === b.dataset.code); $('#invAdd').value = ''; $('#invAddRes').innerHTML = ''; try { await invAddProducts([p]); } catch (er) { toast(er.message, true); } });
    }, 120); };
    $('#invPaste').onclick = async () => {
      const v = await modal({ title: 'Vložit seznam kódů', body: '<p class="muted small">Kódy produktů, EAN nebo MPN — každý na nový řádek (nebo oddělené čárkou / středníkem). Můžeš vložit sloupec z Excelu.</p><textarea data-k="l" rows="10" style="font-family:var(--mono, monospace)"></textarea>', focus: '[data-k="l"]', actions: [{ label: 'Zrušit', value: null }, { label: 'Přidat do inventury', cls: 'primary', value: bd => $('[data-k="l"]', bd).value }] });
      if (!v) return;
      const toks = [...new Set(v.split(/[\n\r,;\t]+/).map(x => x.trim()).filter(Boolean))];
      const idx = new Map(); for (const p of S.products) { idx.set(p.fcode, p); if (p.ean) idx.set(fold(p.ean), p); if (p.mpn) idx.set(fold(p.mpn), p); }
      const found = [], miss = []; for (const k of toks) { const p = idx.get(fold(k)); if (p) found.push(p); else miss.push(k); }
      try { if (found.length) await invAddProducts(found); } catch (e) { return toast(e.message, true); }
      if (miss.length) await modal({ title: `Nenalezeno ${miss.length} kódů`, body: `<p class="muted small">Tyto kódy nejsou v katalogu Hubu (zkontroluj překlepy nebo synchronizaci produktů):</p><textarea rows="6" readonly style="font-family:var(--mono, monospace)">${esc(miss.join('\n'))}</textarea>`, actions: [{ label: 'Rozumím', value: true }] });
    };
    $('#invGroup').onclick = async () => {
      const cnt = f => { const m = new Map(); for (const p of S.products) if (p.visible && p[f]) m.set(p[f], (m.get(p[f]) || 0) + 1); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'cs')); };
      const sup = cnt('supplier'), man = cnt('manufacturer');
      const v = await modal({ title: 'Přidat podle dodavatele / výrobce', body: `<label>Dodavatel</label><select data-k="s"><option value="">— nevybráno —</option>${sup.map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join('')}</select><label>Výrobce</label><select data-k="m"><option value="">— nevybráno —</option>${man.map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join('')}</select><p class="muted small">Přidají se viditelné produkty z e-shopu, které odpovídají výběru.</p>`, actions: [{ label: 'Zrušit', value: null }, { label: 'Přidat', cls: 'primary', value: bd => ({ s: $('[data-k="s"]', bd).value, m: $('[data-k="m"]', bd).value }) }] });
      if (!v || (!v.s && !v.m)) return;
      const list = S.products.filter(p => p.visible && (!v.s || p.supplier === v.s) && (!v.m || p.manufacturer === v.m));
      try { await invAddProducts(list); } catch (e) { toast(e.message, true); }
    };
    $('#invAll').onclick = async () => {
      const list = S.products.filter(p => p.visible);
      if (!(await confirmBox('Přidat celý katalog?', `Do inventury se přidá ${list.length} viditelných produktů z e-shopu (skryté ne). Hodí se pro celoskladovou inventuru.`, { ok: 'Přidat vše' }))) return;
      try { await invAddProducts(list); } catch (e) { toast(e.message, true); }
    };
    if (ses.kind === 'annual') {
      invReadiness();
      const bindChk = () => {
        $$('#invChk [data-ci]').forEach(c => c.onchange = async () => { const l = ses.checklist.map((x, i) => i === Number(c.dataset.ci) ? { ...x, done: c.checked } : x); try { await invPatchSes({ checklist: l }); $('#invChk').innerHTML = invChecklistHtml(); bindChk(); } catch (e) { toast(e.message, true); } });
        $$('#invChk [data-cdel]').forEach(b => b.onclick = async e => { e.preventDefault(); const l = ses.checklist.filter((_, i) => i !== Number(b.dataset.cdel)); try { await invPatchSes({ checklist: l }); $('#invChk').innerHTML = invChecklistHtml(); bindChk(); } catch (er) { toast(er.message, true); } });
      };
      bindChk();
      $('#chkAdd').onclick = async () => { const v = await promptBox('Nový bod seznamu', 'Co je potřeba udělat před inventurou?', '', { ok: 'Přidat' }); if (!v || !v.trim()) return; try { await invPatchSes({ checklist: [...(ses.checklist || []), { t: v.trim(), done: false }] }); $('#invChk').innerHTML = invChecklistHtml(); bindChk(); } catch (e) { toast(e.message, true); } };
    }
  }
  bindInvTbl();
}
function bindInvTbl() {
  const st = INV.ses.status; const tb = $('#invTbl'); if (!tb) return;
  if ($('#invMore')) $('#invMore').onclick = () => { INV.limit += 200; tb.innerHTML = invTableHtml(st); bindInvTbl(); };
  $$('[data-del]', tb).forEach(b => b.onclick = async () => { try { check(await sb.from('inv_items').delete().eq('id', b.dataset.del)); INV.items = INV.items.filter(x => x.id !== b.dataset.del); b.closest('tr').remove(); invUpdateLive(); } catch (e) { toast(e.message, true); } });
  $$('input[data-f]', tb).forEach(inp => {
    const row = () => INV.items.find(x => x.id === inp.closest('tr').dataset.id);
    inp.onchange = () => { const it = row(); if (it) invSaveField(it, inp.dataset.f, inp.value, inp); };
    inp.onfocus = () => inp.select && inp.select();
    inp.onkeydown = e => { if (e.key !== 'Enter') return; e.preventDefault(); inp.blur(); const sel = 'input[data-f="' + inp.dataset.f + '"]:not([disabled])'; const all = $$(sel, tb); const nx = all[all.indexOf(inp) + 1]; if (nx) { nx.focus(); nx.scrollIntoView({ block: 'center' }); } };
  });
}
function invPrint() {
  const ses = INV.ses; const rows = INV.items.slice().sort((a, b) => String(a.location || '~').localeCompare(String(b.location || '~'), 'cs') || a.code.localeCompare(b.code));
  let el = $('#invPrintArea'); if (!el) { el = document.createElement('div'); el.id = 'invPrintArea'; document.body.appendChild(el); }
  el.innerHTML = `<h2>${esc(ses.title)}</h2><p>${INV_KIND[ses.kind]} · vytištěno ${czDateTime(nowIso())}${ses.planned_at ? ' · termín ' + czDate(ses.planned_at) : ''} · ${rows.length} položek · počítal(a): ______________________ &nbsp; datum: ____________</p>
    <table><thead><tr><th style="width:90px">Umístění</th><th style="width:120px">Kód</th><th>Název</th><th style="width:110px">Napočteno</th><th style="width:150px">Poznámka</th></tr></thead><tbody>${rows.map(i => `<tr><td>${esc(i.location || '')}</td><td>${esc(i.code)}</td><td>${esc(i.name || '')}</td><td></td><td></td></tr>`).join('')}</tbody></table>`;
  window.onafterprint = () => { const e = $('#invPrintArea'); if (e) e.remove(); window.onafterprint = null; };
  window.print();
}
async function invApply() {
  const ses = INV.ses;
  const send = INV.items.filter(i => i.counted_qty != null && !i.applied_at && !(i.system_qty != null && Number(i.system_qty) === Number(i.counted_qty)));
  if (!send.length) { if (INV.items.some(i => i.counted_qty != null)) { try { await invPatchSes({ status: 'done', done_at: nowIso() }); drawInv(); toast('Inventura uzavřena — nebyl žádný rozdíl.'); } catch (e) { toast(e.message, true); } } else toast('Není co odesílat.', true); return; }
  const stt = invStats(); const unknown = send.filter(i => i.system_qty == null).length;
  const ok = await modal({ title: 'Schválit a naskladnit do Shoptetu?', body: `<p>Do Shoptetu se u <b>${invPieces(send.length)}</b> nastaví <b>fyzický stav skladu</b> na napočtené množství (přebytek +${fmtQ(stt.plus)} ks, manko −${fmtQ(stt.minus)} ks).</p><p>Jde o <b>přepsání stavu</b>, ne přírůstek — automaticky se to nedá vrátit. Každá položka se pošle nejvýš jednou.</p>${unknown ? `<p class="muted small">U ${unknown} položek neznáme původní stav ze Shoptetu (rozdíl nelze ukázat). Můžeš je předem načíst tlačítkem „↻ Načíst stav ze Shoptetu“.</p>` : ''}<p class="muted small">Sklad č. ${invStockId()}.</p>`, actions: [{ label: 'Zrušit', value: false }, { label: 'Schválit a odeslat', cls: 'primary', value: true }] });
  if (!ok) return;
  const btn = $('#invApply'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Odesílám…'; }
  const errors = []; let okN = 0, dup = 0, done = false;
  try {
    for (let i = 0; i < send.length; i += 50) {
      const chunk = send.slice(i, i + 50);
      const r = await shoptetCall({ action: 'inv_apply', sessionId: ses.id, stockId: invStockId(), items: chunk.map(x => ({ id: x.id, code: x.code, counted: Number(x.counted_qty), system: x.system_qty })) });
      for (const x of r.results) { if (x.status === 'ok') okN++; else if (x.status === 'duplicate') dup++; else errors.push(`${x.code}: ${x.message}`); }
      done = r.done; toast(`Odesláno ${Math.min(i + 50, send.length)} z ${send.length}…`);
    }
  } catch (e) { errors.push(e.message); }
  await invLoad(ses.id); drawInv();
  if (errors.length || dup) await modal({ title: 'Odeslání do Shoptetu — výsledek', body: `<p><b>${okN}</b> položek odesláno${dup ? `, ${dup} už bylo odesláno dříve` : ''}${errors.length ? `, <b style="color:var(--danger)">${errors.length} chyb</b>` : ''}.</p>${errors.length ? `<textarea rows="8" readonly>${esc(errors.join('\n'))}</textarea><p class="muted small">Inventura zůstává „ke schválení“ — po opravě můžeš odeslat zbytek znovu (už odeslané se neposílají podruhé).</p>` : ''}`, actions: [{ label: 'Zavřít', value: true }] });
  else toast(done ? `Hotovo — ${okN} položek nastaveno ve Shoptetu, inventura uzavřena ✓` : `Odesláno ${okN} položek`);
}

// ---------- přehled nabídek ----------
const OFFER_LIST_COLS = 'id,archived,archived_at,number,status,status_at,date,valid_until,customer,created_by,issued_by,updated_at,created_at,note,shoptet_order,net,total,currency,version,offer_comments(count)';
async function refreshOffers(silent) {
  const rows = await fetchAll(() => sb.from('offers').select(OFFER_LIST_COLS).eq('deleted', false).order('created_at', { ascending: false }));
  S.offers = rows.map(fromRow);
  if (!silent && $('#ov')) { drawStats(); drawOffersBody(); }
}
function boardSkeleton() {
  return `<div class="stats">${'<div class="panel stat"><div class="sk" style="height:12px;width:60%"></div><div class="sk" style="height:24px;width:80%;margin-top:10px"></div></div>'.repeat(4)}</div>
    <div class="board">${STATUS_ORDER.map(s => `<section class="col" data-s="${s}"><div class="col-h">${esc(STATUSES[s])}</div>${'<div class="sk" style="height:92px;margin-bottom:8px"></div>'.repeat(s === 'draft' ? 3 : 2)}</section>`).join('')}</div>`;
}
async function renderOffers() {
  shell('offers', `<div class="topbar"><h1>Nabídky</h1></div>${boardSkeleton()}`);
  try { await refreshOffers(true); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  drawOffers();
}
function filteredOffers() {
  const q = fold(S.q).trim();
  return S.offers.filter(o => {
    if (S.who && o.issuedBy !== S.who && o.createdBy !== S.who) return false;
    if (S.view === 'archive' ? !o.archived : o.archived) return false;
    if ((S.view === 'list' || S.view === 'over') && S.fStatus && o.status !== S.fStatus) return false;
    if (!q) return true;
    const c = o.customer;
    return fold([o.number, c.name, c.company, c.email, c.phone, c.city, c.ico, o.note, o.shoptetOrder].join(' ')).includes(q);
  });
}
async function newOffer(copyFrom = null, currency = 'CZK') {
  const o = check(await sb.rpc('hub_create_offer', { p_copy_from: copyFrom, p_currency: currency }));
  location.hash = '#/o/' + o.id;
  return o;
}
function drawOffers() {
  const main = $('#main');
  main.innerHTML = `
  <div class="of-page">
  <div class="pg-head"><span class="pg-ico">${svgIco('offers')}</span><div class="grow"><h1>Nabídky</h1><p>Tvorba cenových nabídek, správa stavů a překlopení do Shoptetu. <span class="muted" id="ofSub"></span></p></div>
    <select id="who" class="of-who">
      <option value="">Všichni</option>
      ${S.users.map(u => `<option value="${u.id}" ${S.who === u.id ? 'selected' : ''}>${u.id === S.me.id ? 'Moje' : esc(u.name)}</option>`).join('')}
    </select>
    <button class="btn of-new" id="newOfferEur" title="Nová nabídka v eurech (slovenský e-shop)">＋ Nabídka v €</button>
    <button class="btn primary of-new" id="newOffer" title="Nová nabídka (N)">＋ Nová nabídka</button></div>
  <div class="of-tabsrow"><div class="seg of-seg"><i class="seg-thumb"></i><button data-v="over" class="${S.view === 'over' ? 'on' : ''}">Přehled</button><button data-v="board" class="${S.view === 'board' ? 'on' : ''}">Nástěnka</button><button data-v="list" class="${S.view === 'list' ? 'on' : ''}">Seznam</button><button data-v="archive" class="${S.view === 'archive' ? 'on' : ''}">📦 Archiv <span class="muted">${S.offers.filter(o => o.archived).length}</span></button></div>
    <div class="search of-search grow"><span class="ic">⌕</span><input id="q" placeholder="Hledat číslo, zákazníka, IČO, telefon…" value="${esc(S.q)}"><span class="hint-k"><kbd>/</kbd></span></div></div>
  <div id="stats"></div>
  <div id="ov" class="enter-once"></div>
  </div>`;
  main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
  $('#newOffer').onclick = async e => { const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span> Zakládám…'; try { await newOffer(); } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = '＋ Nová nabídka'; } };
  $('#newOfferEur').onclick = async e => { const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span> Zakládám…'; try { await newOffer(null, 'EUR'); } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = '＋ Nabídka v €'; } };
  $('#q').oninput = e => { S.q = e.target.value; drawOffersBody(); };
  $('#who').onchange = e => { S.who = e.target.value; drawStats(); drawOffersBody(); };
  const placeThumb = () => { const seg = $('.of-seg', main), on = $('.seg button.on', main), th = $('.seg-thumb', main); if (!seg || !on || !th) return; th.style.width = on.offsetWidth + 'px'; th.style.transform = `translateX(${on.offsetLeft}px)`; };
  $$('.seg button', main).forEach(b => b.onclick = () => { S.view = b.dataset.v; if (S.view !== 'archive') ls.set('vh_view', S.view); drawStats(); drawOffersBody(); $$('.seg button', main).forEach(x => x.classList.toggle('on', x === b)); placeThumb(); });
  requestAnimationFrame(placeThumb); setTimeout(placeThumb, 250);
  setTimeout(() => $('#ov') && $('#ov').classList.remove('enter-once'), 1200);
  drawStats(); drawOffersBody();
}
function hello() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Dobrou noc' : h < 10 ? 'Dobré ráno' : h < 12 ? 'Dobré dopoledne' : h < 18 ? 'Dobré odpoledne' : 'Dobrý večer';
  return `${part}, ${esc(String(S.me.name || '').split(' ')[0] || 'tým')}`;
}
function drawStats() {
  const el = $('#stats'); if (!el) return;
  const base = S.offers.filter(o => !o.archived);
  const list = S.who ? base.filter(o => o.issuedBy === S.who || o.createdBy === S.who) : base;
  const sub = $('#ofSub'); if (sub) sub.textContent = `${list.length} ${list.length === 1 ? 'nabídka' : list.length < 5 ? 'nabídky' : 'nabídek'}${S.offers.some(o => o.archived) ? ` · ${S.offers.filter(o => o.archived).length} v archivu` : ''}`;
  if (S.view !== 'over') { el.innerHTML = ''; return; }
  const open = list.filter(o => o.status === 'sent' || o.status === 'postponed');
  const late = open.filter(o => (o.status === 'sent' && daysSince(o.statusAt) >= 5) || (o.status === 'postponed' && daysSince(o.statusAt) >= 7));
  const month = ymd(new Date()).slice(0, 7);
  const won = list.filter(o => o.status === 'confirmed'); const rej = list.filter(o => o.status === 'rejected');
  const wonM = won.filter(o => String(o.statusAt).slice(0, 7) === month);
  const sum = a => a.reduce((x, o) => x + o.total, 0);
  const wk = weekSeries(list.filter(o => o.currency !== 'EUR'), o => o.total);
  const since = ymd(new Date(Date.now() - 30 * 864e5)); const v30l = list.filter(o => String(o.date).slice(0, 10) >= since); const v30 = sum(v30l.filter(o => o.currency !== 'EUR')); const v30e = sum(v30l.filter(o => o.currency === 'EUR'));
  const IC = { doc: NAV_SVG.offers, ok: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>' };
  const k = (ic, c, v, l, extra = '') => `<div class="panel ostat" style="--c:${c}"><span class="kpi-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[ic]}</svg></span><div><b>${v}</b><span>${l}</span>${extra}</div></div>`;
  el.innerHTML = `<div class="of-strip">
    ${k('doc', 'var(--s-sent)', open.length, 'Rozjednané', late.length ? `<em class="kpi-pill warn">ozvat se: ${late.length}</em>` : '')}
    ${k('ok', 'var(--s-confirmed)', won.length, 'Překlopené', wonM.length ? `<em class="kpi-pill ok">tento měsíc ${wonM.length}</em>` : '')}
    ${k('x', 'var(--s-rejected)', rej.length, 'Zamítnuté')}
    <div class="panel ostat donut-card">${offerDonut(list, 40)}</div>
    <div class="panel ostat chart-card"><div class="cc-h"><span>Hodnota nabídek (30 dní)</span><b>${M(v30).replace(/,\d\d$/, '')} Kč${v30e ? ` + ${M(v30e).replace(/,\d\d$/, '')} €` : ''}</b></div>${lineChart(wk.vals, wk.labels)}</div>
  </div>`;
}
async function changeStatus(o, status) {
  const args = { p_id: o.id, p_status: status, p_shoptet_order: null };
  if (status === 'confirmed') {
    const n = await promptBox('Překlopit do Shoptetu', 'Číslo objednávky v Shoptetu (nepovinné)', o.shoptetOrder || '', { placeholder: 'např. 2026001234', ok: 'Potvrdit', text: `Nabídka ${o.number} se přesune mezi potvrzené.` });
    if (n === null) return null;
    args.p_shoptet_order = n.trim();
  }
  if (status === 'rejected' && !(await confirmBox('Zamítnout nabídku?', `Nabídka ${o.number} se označí jako zamítnutá zákazníkem.`, { ok: 'Zamítnout', danger: true }))) return null;
  return fromRow(check(await sb.rpc('hub_set_offer_status', args)));
}
async function moveOffer(o, status) {
  if (!o || o.status === status) return;
  try {
    const r = await changeStatus(o, status);
    if (!r) return;
    Object.assign(o, { status: r.status, statusAt: r.statusAt, shoptetOrder: r.shoptetOrder, updatedAt: r.updatedAt, version: r.version });
    drawStats(); drawOffersBody(o.id);
    toast(`${o.number} → ${STATUSES[o.status]}`);
  } catch (err) { toast(err.message, true); }
}
function drawOffersBody(movedId) {
  const ov = $('#ov'); if (!ov) return;
  const list = filteredOffers();
  if (!S.offers.length) {
    ov.innerHTML = `<div class="panel empty-big"><div class="ill">📄</div><h3>Zatím tu nejsou žádné nabídky</h3><p>Založ první nabídku — zákazníka dohledáš v ARES, produkty se berou rovnou z e-shopu.</p><button class="btn primary lg" id="firstOffer">＋ Vytvořit první nabídku</button></div>`;
    $('#firstOffer').onclick = () => $('#newOffer').click();
    return;
  }
  if (S.view === 'list') return drawList(ov, list);
  if (S.view === 'archive') return drawArchive(ov, list);
  if (S.view === 'over') {
    ov.innerHTML = `<div id="obB"></div><section class="panel dash" style="margin-top:18px"><div class="dash-h"><b style="font-size:18px">Všechny nabídky</b><span class="cnt-pill">${list.length}</span></div><div id="obL" class="dash-b"></div></section>`;
    drawOfferBoard($('#obB', ov), list, movedId, 3); drawList($('#obL', ov), list); return;
  }
  drawOfferBoard(ov, list, movedId, 0);
}
function drawOfferBoard(ov, list, movedId, cap) {
  ov.innerHTML = `<div class="board">${STATUS_ORDER.map(s => {
    const all = list.filter(o => o.status === s).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const cards = cap ? all.slice(0, cap) : all;
    const sumTxt = all.length ? sumTxtCur(all) : '';
    return `<section class="col" data-s="${s}" data-drop="${s}">
      <div class="col-h">${esc(STATUSES[s])} <span class="cnt">${all.length}</span>${all.length && (s === 'confirmed' || s === 'rejected') ? `<button class="colarch" data-arch="${s}" title="Archivovat všechny nabídky v tomto sloupci">📦</button>` : ''}<span class="sum">${sumTxt}</span></div>
      <div class="col-body">${cards.map((o, i) => card(o, i, o.id === movedId)).join('') || `<div class="empty">${esc(STATUS_HINT[s])}</div>`}</div>
      ${cap && all.length > cap ? `<button class="mb-more" data-more>+ ${all.length - cap} dalších</button>` : ''}
      ${cards.length > 6 ? `<div class="col-more">↓ dalších ${cards.length - 6} — posuň v sloupci, starší dej do archivu 📦</div>` : ''}
    </section>`;
  }).join('')}</div>`;
  $$('.card', ov).forEach(c => {
    c.onclick = e => { if (e.target.closest('.stbtn')) return; location.hash = '#/o/' + c.dataset.id; };
    c.ondragstart = e => { e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => c.classList.add('dragging')); };
    c.ondragend = () => c.classList.remove('dragging');
  });
  limitCols(ov);
  $$('[data-more]', ov).forEach(b => b.onclick = () => { const t = $('.seg button[data-v="board"]'); if (t) t.click(); });
  $$('.archbtn', ov).forEach(b => b.onclick = e => { e.stopPropagation(); archiveOffers([b.closest('.card').dataset.id], true); });
  $$('.colarch', ov).forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const ids = list.filter(o => o.status === b.dataset.arch).map(o => o.id);
    if (ids.length && await confirmBox('Archivovat nabídky?', `${ids.length} nabídek ve sloupci „${STATUSES[b.dataset.arch]}“ se přesune do archivu. Nic se nemaže, v Archivu je najdeš a můžeš vrátit.`, { ok: 'Archivovat' })) archiveOffers(ids, true);
  });
  $$('.stbtn', ov).forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const o = S.offers.find(x => x.id === b.closest('.card').dataset.id);
    const s = await popMenu(b, STATUS_ORDER.filter(x => x !== o.status).map(x => ({ label: STATUSES[x], value: x, s: x })));
    if (s) moveOffer(o, s);
  });
  $$('.col', ov).forEach(col => {
    let depth = 0;
    col.ondragenter = e => { e.preventDefault(); depth++; col.classList.add('over'); };
    col.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
    col.ondragleave = () => { if (--depth <= 0) { depth = 0; col.classList.remove('over'); } };
    col.ondrop = e => {
      e.preventDefault(); depth = 0; col.classList.remove('over');
      moveOffer(S.offers.find(x => x.id === e.dataTransfer.getData('text/plain')), col.dataset.drop);
    };
  });
}
// sloupec ukáže nejvýš 6 karet, ostatní se rolují uvnitř sloupce
function limitCols(root) {
  $$('.col-body', root).forEach(b => {
    b.style.maxHeight = ''; b.classList.remove('scroll');
    const cards = [...b.querySelectorAll('.card')];
    if (cards.length <= 6) return;
    b.style.maxHeight = (cards[6].offsetTop - cards[0].offsetTop) + 'px'; b.classList.add('scroll');
  });
}
let limitT = null;
window.addEventListener('resize', () => { clearTimeout(limitT); limitT = setTimeout(() => { const ov = $('#ov'); if (ov && $('.board', ov)) limitCols(ov); }, 150); });
async function archiveOffers(ids, flag) {
  try {
    const at = flag ? new Date().toISOString() : null;
    check(await sb.from('offers').update({ archived: flag, archived_at: at }).in('id', ids));
    S.offers.forEach(o => { if (ids.includes(o.id)) { o.archived = flag; o.archivedAt = at; } });
    drawOffersBody();
    const seg = $('.seg button[data-v="archive"]'); if (seg) seg.innerHTML = `📦 Archiv <span class="muted">${S.offers.filter(o => o.archived).length}</span>`;
    { const on = $('.of-seg button.on'), th = $('.of-seg .seg-thumb'); if (on && th) { th.style.width = on.offsetWidth + 'px'; th.style.transform = `translateX(${on.offsetLeft}px)`; } }
    drawStats();
    toast(flag ? `Do archivu: ${ids.length} ${ids.length === 1 ? 'nabídka' : ids.length < 5 ? 'nabídky' : 'nabídek'}` : 'Vráceno z archivu', { action: { label: 'Vrátit', fn: () => archiveOffers(ids, !flag) } });
  } catch (err) { toast(err.message, true); }
}
function drawArchive(ov, list) {
  const rows = list.slice().sort((a, b) => String(b.archivedAt || '').localeCompare(String(a.archivedAt || '')));
  ov.innerHTML = `<p class="muted small" style="margin:0 0 10px">Archivované nabídky se nezobrazují na nástěnce ani v seznamu. Hledání nahoře funguje i tady.</p>
  <div class="panel" style="overflow-x:auto"><table class="list">
    <thead><tr><th>Číslo</th><th>Zákazník</th><th>Stav</th><th>Datum</th><th>Archivováno</th><th>Vystavil</th><th class="r">S DPH</th><th></th></tr></thead>
    <tbody>${rows.map(o => `<tr class="click" data-id="${o.id}">
      <td class="nowrap num-t"><b>${esc(o.number)}</b></td>
      <td>${highlight(custLabel(o.customer), S.q)}<div class="muted small">${esc([o.customer.email, o.customer.phone].filter(Boolean).join(' · '))}</div></td>
      <td>${stat(o.status)}${o.shoptetOrder ? `<div class="muted small">🛒 ${esc(o.shoptetOrder)}</div>` : ''}</td>
      <td class="nowrap">${czDate(o.date)}</td><td class="nowrap">${o.archivedAt ? czDate(String(o.archivedAt).slice(0, 10)) : '—'}</td>
      <td class="nowrap">${esc(userName(o.issuedBy))}</td><td class="r nowrap num-t"><b>${M(o.total)}${o.currency === 'EUR' ? ' €' : ''}</b></td>
      <td><button class="btn sm" data-un="${o.id}">↩ Vrátit</button></td></tr>`).join('') || `<tr><td colspan="8" class="empty">${S.q ? 'Nic nenalezeno' : 'Archiv je prázdný. Nabídku archivuješ tlačítkem 📦 na kartě.'}</td></tr>`}</tbody></table></div>`;
  $$('tr.click', ov).forEach(r => r.onclick = e => { if (e.target.closest('[data-un]')) return; location.hash = '#/o/' + r.dataset.id; });
  $$('[data-un]', ov).forEach(b => b.onclick = e => { e.stopPropagation(); archiveOffers([b.dataset.un], false); });
}
function card(o, i, moved) {
  const d = daysSince(o.statusAt);
  const late = (o.status === 'sent' && d >= 5) || (o.status === 'postponed' && d >= 7);
  return `<article class="card${moved ? ' moved' : ''}" draggable="true" data-id="${o.id}" data-s="${o.status}" style="--i:${Math.min(i, 12)}">
    <div class="t"><span class="no">${esc(o.number)}</span><span title="${esc(czDateTime(o.updatedAt))}">${ago(o.updatedAt)}</span></div>
    <div class="cu">${highlight(custLabel(o.customer), S.q)}${o.customer.company && o.customer.name ? `<span class="muted small" style="font-weight:400"> · ${esc(o.customer.name)}</span>` : ''}</div>
    ${o.note ? `<div class="nt">${esc(o.note)}</div>` : ''}
    <div class="b">
      <span class="av" title="${esc(userName(o.issuedBy))}">${initials(o.issuedBy)}</span>
      ${o.commentCount ? `<span title="Interní komentáře">💬 ${o.commentCount}</span>` : ''}
      ${late ? `<span class="late" title="Ve stavu už ${d} dní — ozvat se zákazníkovi?">⏰ ${d} d</span>` : ''}
      ${o.shoptetOrder ? `<span title="Objednávka v Shoptetu">🛒 ${esc(o.shoptetOrder)}</span>` : ''}
      <button class="archbtn" title="Archivovat">📦</button>
      <button class="st stbtn" data-s="${o.status}" title="Změnit stav">Stav ▾</button>
      <span class="price">${offMoney(o.total, o)}</span>
    </div>
  </article>`;
}
function drawList(ov, list) {
  ov.innerHTML = `
  <div class="chips" style="margin-bottom:12px">
    <button class="chip ${!S.fStatus ? 'on' : ''}" data-f="">Vše <span class="muted">${S.offers.length}</span></button>
    ${STATUS_ORDER.map(s => `<button class="chip ${S.fStatus === s ? 'on' : ''}" data-f="${s}">${esc(STATUSES[s])}</button>`).join('')}
  </div>
  <div class="panel" style="overflow-x:auto"><table class="list">
    <thead><tr><th>Číslo</th><th>Zákazník</th><th>Stav</th><th>Datum</th><th>Platnost</th><th>Vystavil</th><th class="r">Bez DPH</th><th class="r">S DPH</th></tr></thead>
    <tbody>${list.map((o, i) => `<tr class="click" data-id="${o.id}" style="animation-delay:${Math.min(i, 20) * 15}ms">
      <td class="nowrap num-t"><b>${esc(o.number)}</b></td>
      <td>${highlight(custLabel(o.customer), S.q)}<div class="muted small">${esc([o.customer.email, o.customer.phone].filter(Boolean).join(' · '))}</div></td>
      <td>${stat(o.status)}</td>
      <td class="nowrap">${czDate(o.date)}</td>
      <td class="nowrap ${o.validUntil < ymd(new Date()) ? 'muted' : ''}">${czDate(o.validUntil)}</td>
      <td class="nowrap">${esc(userName(o.issuedBy))}</td>
      <td class="r nowrap num-t">${M(o.net)}${o.currency === 'EUR' ? ' €' : ''}</td>
      <td class="r nowrap num-t"><b>${M(o.total)}${o.currency === 'EUR' ? ' €' : ''}</b></td>
    </tr>`).join('') || '<tr><td colspan="8" class="empty">Nic nenalezeno</td></tr>'}</tbody>
  </table></div>`;
  $$('.chip', ov).forEach(c => c.onclick = () => { S.fStatus = c.dataset.f; drawOffersBody(); });
  $$('tr.click', ov).forEach(r => r.onclick = () => { location.hash = '#/o/' + r.dataset.id; });
}
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || $('.backdrop')) return;
  if ((location.hash || '#/') !== '#/nabidky') return;
  if (e.key === '/') { e.preventDefault(); $('#q')?.focus(); }
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); $('#newOffer')?.click(); }
});

// ---------- editor nabídky ----------
function editorSkeleton() {
  return `<div class="topbar"><div class="sk" style="height:30px;width:260px"></div></div>
    <div class="ed"><div>${'<div class="panel panel-b"><div class="sk" style="height:16px;width:30%"></div><div class="sk" style="height:110px;margin-top:14px"></div></div>'.repeat(2)}</div>
    <div>${'<div class="panel panel-b"><div class="sk" style="height:150px"></div></div>'.repeat(2)}</div></div>`;
}
async function renderEditor(id) {
  shell('offers', editorSkeleton());
  let o, comments, history;
  try {
    const [row, cm, hi] = await Promise.all([
      sb.from('offers').select('*').eq('id', id).eq('deleted', false).single().then(check),
      sb.from('offer_comments').select('*').eq('offer_id', id).order('created_at').then(check),
      sb.from('offer_history').select('*').eq('offer_id', id).order('at').then(check),
      loadSettings(),
    ]);
    o = fromRow(row); comments = cm; history = hi;
  } catch (e) { $('#main').innerHTML = `<div class="panel empty-big"><div class="ill">🔍</div><h3>Nabídku se nepodařilo otevřít</h3><p>${esc(e.message)}</p><a class="btn" href="#/nabidky">← Zpět na nabídky</a></div>`; return; }
  loadProducts().catch(e => toast('Produkty: ' + e.message, true));

  const E = { dirty: false, saving: null, timer: null };
  const st = cfg();
  let step = offStep(o, st); let CUR = offSym(o);
  const c = o.customer;
  const field = (k, label, cls = 'c2', type = 'text', ph = '') => `<div class="${cls}"><label>${label}</label><input data-c="${k}" type="${type}" value="${esc(c[k])}" placeholder="${esc(ph)}"></div>`;
  const plusDays = n => { const d = new Date(o.date + 'T00:00'); d.setDate(d.getDate() + n); return ymd(d); };

  $('#main').innerHTML = `
  <div class="ed-top" id="edTop"><div class="topbar">
    <a class="btn ghost" href="#/nabidky" title="Zpět na nabídky">←</a>
    <h1>Nabídka <span class="num-t">${esc(o.number)}</span></h1>
    <span id="stBadge">${stat(o.status)}</span>
    <span class="save" id="saveState">Uloženo</span>
    <span class="grow"></span>
    <button class="btn" id="arch" title="Přesunout do archivu (zmizí z nástěnky)">📦 <span class="hide-xs">${o.archived ? 'Vrátit z archivu' : 'Archivovat'}</span></button>
    <button class="btn" id="dup" title="Vytvořit kopii nabídky">⧉ <span class="hide-xs">Duplikovat</span></button>
    <button class="btn ghost danger" id="del" title="Smazat nabídku">🗑</button>
  </div></div>
  <div class="ed">
    <div>
      <section class="panel">
        <div class="panel-h"><span class="step" id="step1">1</span>Zákazník <span class="sub">— komu nabídku posíláme</span></div>
        <div class="panel-b">
          <div class="search big" id="cs"><span class="ic">⌕</span><input id="cq" placeholder="Najít zákazníka — dřívější nabídky nebo firmu v ARES (název / IČO)…" autocomplete="off"><div class="results" id="cr" hidden></div></div>
          <div class="grid" style="margin-top:14px">
            ${field('name', 'Jméno a příjmení', 'c3', 'text', 'Jan Novák')}
            ${field('company', 'Firma', 'c3', 'text', 'nepovinné')}
            ${field('email', 'E-mail', 'c3', 'email', 'jan@email.cz')}
            ${field('phone', 'Telefon', 'c3', 'tel', '+420 …')}
            ${field('street', 'Ulice a č. p.', 'c3')}
            ${field('city', 'PSČ a město', 'c3', 'text', '110 00 Praha')}
            <div class="c2"><label>IČ <span class="ares-st" id="aresSt"></span></label><input data-c="ico" inputmode="numeric" value="${esc(c.ico)}" placeholder="8 číslic → doplní se z ARES"></div>
            ${field('dic', 'DIČ')}
            ${field('country', 'Země')}
            <div class="c6"><details ${o.recipient ? 'open' : ''}><summary>Konečný příjemce / jiná adresa dodání</summary>
              <textarea data-f="recipient" rows="2" style="margin-top:8px" placeholder="např. stavba Dobříš, Pražská 12 — p. Novák 777 …">${esc(o.recipient)}</textarea></details></div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-h"><span class="step" id="step2">2</span>Položky <span class="sub" id="itemsSub">— ceny z e-shopu jsou s DPH, v PDF se přepočítají bez DPH</span></div>
        <div class="panel-b">
          <div class="row">
            <div class="search big grow" id="ps"><span class="ic">⌕</span><input id="pq" placeholder="Přidat produkt — kód nebo název, např. „teak 3,6“ nebo W-01-02" autocomplete="off"><div class="results" id="pr" hidden></div></div>
            <label class="row small" style="margin:0;gap:5px;color:var(--muted)"><input type="checkbox" id="phid" style="width:auto"> i skryté</label>
            <button class="btn" id="addCustom" title="Položka mimo e-shop (doprava, montáž…)">＋ Vlastní položka</button>
          </div>
          <div class="hint">↑ ↓ vybrat · <kbd>Enter</kbd> přidat · v množství <kbd>Enter</kbd> = zpět na hledání</div>
          <div id="items"></div>
          <div class="items-foot" id="itemsFoot">
            <div class="row small muted">Sleva všem položkám
              <div class="fld" style="width:84px"><input id="allDisc" inputmode="decimal" value="${esc(numStr(st.defaultDiscount))}"><span class="suf">%</span></div>
              <button class="btn sm" id="applyDisc">Použít</button>
            </div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-h"><span class="step" id="step3">3</span>Poznámka pro zákazníka <span class="sub">— zobrazí se v PDF</span></div>
        <div class="panel-b">
          <textarea data-f="note" rows="3" placeholder="např. Terasové prkno WPC teak classic duté – 2,85 a 3,6 m">${esc(o.note)}</textarea>
          <details style="margin-top:12px"><summary>Podmínky nabídky (také v PDF)</summary>
            <textarea data-f="terms" rows="8" style="margin-top:8px">${esc(o.terms)}</textarea>
            <div class="row" style="justify-content:space-between;margin-top:6px"><span class="hint" style="margin:0">{platnost} se v PDF nahradí datem platnosti.</span><button class="btn sm" id="resetTerms">Obnovit výchozí</button></div>
          </details>
        </div>
      </section>
    </div>

    <div class="side-col">
      <section class="panel">
        <div class="panel-h">Stav nabídky</div>
        <div class="panel-b">
          <div class="status-pick" id="statusPick">${STATUS_ORDER.map(s => `<button data-s="${s}" class="${o.status === s ? 'on' : ''}" title="${esc(STATUS_HINT[s])}">${esc(STATUSES[s])}</button>`).join('')}</div>
          <div id="shoptetBox" style="margin-top:12px" ${o.status === 'confirmed' ? '' : 'hidden'}>
            <label>Číslo objednávky v Shoptetu</label>
            <input data-f="shoptetOrder" value="${esc(o.shoptetOrder)}" placeholder="např. 2026001234">
          </div>
          <div id="toShoptetBox" style="margin-top:12px"></div>
          <button class="btn sm" id="copyShoptet" style="margin-top:8px;width:100%" title="Zkopíruje kódy a množství pro ruční založení objednávky">📋 Kopírovat položky pro Shoptet</button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-h">Údaje nabídky</div>
        <div class="panel-b grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div><label>Datum</label><input type="date" data-f="date" value="${esc(o.date)}"></div>
          <div><label>Platnost do</label><input type="date" data-f="validUntil" value="${esc(o.validUntil)}">
            <div class="quick" id="quickValid"><button data-d="7">+7 d</button><button data-d="14">+14 d</button><button data-d="30">+30 d</button></div></div>
          <div style="grid-column:span 2"><label>Měna nabídky</label><div class="seg" id="curSegO" style="width:100%"><button data-c="CZK" class="${o.currency === 'EUR' ? '' : 'on'}" style="flex:1">Kč</button><button data-c="EUR" class="${o.currency === 'EUR' ? 'on' : ''}" style="flex:1">€ EUR</button></div>
            <div class="hint" id="curHint" style="margin-top:6px">${o.currency === 'EUR' ? `EUR: DPH ${offVatDefault(o, st)} %, ceny z CZ e-shopu se přepočítají kurzem ${numStr(offRate(st))} Kč/€ — uprav je podle slovenského e-shopu.` : ''}</div></div>
          <div style="grid-column:span 2"><label>Vystavil</label><select data-f="issuedBy">${S.users.map(u => `<option value="${u.id}" ${o.issuedBy === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
        </div>
      </section>

      <section class="panel private">
        <div class="panel-h">🔒 Interní komentáře <span class="sub">zákazník je neuvidí</span></div>
        <div class="panel-b">
          <div id="comments"></div>
          <div class="compose"><textarea id="cmText" rows="1" placeholder="Napiš komentář…"></textarea><button class="btn primary" id="cmSend" title="Odeslat (Ctrl+Enter)">➤</button></div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-h">Historie</div>
        <div class="panel-b"><div class="timeline" id="hist"></div></div>
      </section>
    </div>
  </div>`;
  document.querySelectorAll('.sumbar').forEach(x => x.remove());
  const bar = document.createElement('div');
  bar.className = 'sumbar';
  bar.innerHTML = `
    <div class="m hide-m"><span>Položek</span><b id="sbCount">0</b></div>
    <div class="m hide-m"><span>Bez DPH</span><b id="sbNet" class="num-t">0,00 ${CUR}</b></div>
    <div class="m hide-m"><span>DPH</span><b id="sbTax" class="num-t">0,00 ${CUR}</b></div>
    <div class="m tot"><span>Celkem s DPH</span><b id="sbTotal" class="num-t">0,00</b></div>
    <span class="grow"></span>
    <button class="btn" id="pdfView">👁 <span class="hide-m">Náhled</span></button>
    <button class="btn primary" id="pdfDl">⬇ <span class="hide-xs">Stáhnout&nbsp;</span>PDF</button>`;
  document.body.appendChild(bar);
  const onScroll = () => $('#edTop')?.classList.toggle('scrolled', scrollY > 4);
  addEventListener('scroll', onScroll, { passive: true });

  // --- kroky (zelená fajfka u hotových částí) ---
  function drawSteps() {
    const s1 = !!(o.customer.name || o.customer.company), s2 = o.items.length > 0, s3 = !!o.note.trim();
    [['#step1', s1, 1], ['#step2', s2, 2], ['#step3', s3, 3]].forEach(([sel, ok, n]) => { const el = $(sel); if (el) { el.classList.toggle('done', ok); el.textContent = ok ? '✓' : n; } });
  }

  // --- položky ---
  const lineCalc = it => Calc.line(it, step);
  const open = new Set(); // rozbalené řádky (úprava ceny, slevy, kódu…)
  const priceLine = it => `${M(it.priceVat)} ${CUR} / ${esc(it.unit || 'ks')}${Number(it.discount) ? ` · sleva ${numStr(it.discount)} %` : ''}${Number(it.vatRate) !== offVatDefault(o, st) ? ` · DPH ${numStr(it.vatRate)} %` : ''}`;
  function itemRow(it, n, isNew) {
    const l = lineCalc(it);
    const isOpen = open.has(it.id);
    const sub = [it.code, it.variant].filter(Boolean).map(esc).join(' · ');
    return `<div class="it${isNew ? ' new' : ''}${isOpen ? ' open' : ''}" data-id="${it.id}">
      <div class="it-main">
        <span class="it-n">${n}</span>
        <div class="it-info">
          <div class="it-name" data-o="name">${esc(it.name) || '<span class="muted">Bez názvu</span>'}</div>
          <div class="it-sub" data-o="sub">${sub}</div>
          <button class="it-price" data-a="edit" title="Upravit cenu, slevu, DPH">${priceLine(it)} <span class="pen">✎</span></button>
        </div>
        <div class="it-qty"><div class="stepper"><button data-a="minus" tabindex="-1" aria-label="Méně">−</button><input data-k="qty" inputmode="decimal" value="${esc(numStr(it.qty))}" aria-label="Množství"><span class="u" data-o="unit">${esc(it.unit || 'ks')}</span><button data-a="plus" tabindex="-1" aria-label="Více">+</button></div></div>
        <div class="it-sum"><b data-o="total">${M(l.total)} ${CUR}</b><span data-o="net">${M(l.net)} bez DPH</span></div>
        <button class="ib del it-rm" data-a="rm" title="Odebrat položku">✕</button>
      </div>
      <div class="it-edit">
        <div class="f2"><label>Název</label><textarea data-k="name" rows="1">${esc(it.name)}</textarea></div>
        <div><label>Kód</label><input data-k="code" value="${esc(it.code)}"></div>
        <div><label>Varianta</label><input data-k="variant" value="${esc(it.variant)}"></div>
        <div><label>Cena/j s DPH</label><div class="fld"><input data-k="priceVat" inputmode="decimal" value="${esc(numStr(it.priceVat))}"><span class="suf">${CUR}</span></div></div>
        <div><label>Jednotka</label><input data-k="unit" value="${esc(it.unit)}"></div>
        <div><label>Sleva</label><div class="fld"><input data-k="discount" inputmode="decimal" value="${esc(numStr(it.discount))}"><span class="suf">%</span></div></div>
        <div><label>DPH</label><select data-k="vatRate">${[...new Set([...offVatOpts(o), Number(it.vatRate)])].map(r => `<option value="${r}" ${Number(it.vatRate) === r ? 'selected' : ''}>${r} %</option>`).join('')}</select></div>
        <div class="f2 it-edit-foot"><span class="muted small" data-o="unitNet">Jedn. cena bez DPH: ${M(l.unitNet)} ${CUR}</span><button class="btn sm" data-a="edit">Hotovo</button></div>
      </div>
    </div>`;
  }
  function drawItems(newId) {
    const t = Calc.totals(o, step);
    $('#items').innerHTML = o.items.length
      ? `<div class="items">${o.items.map((it, i) => itemRow(it, i + 1, it.id === newId)).join('')}</div>
         <div class="it-total"><span>Bez DPH</span><b data-o="tnet">${M(t.net)} ${CUR}</b><span>DPH</span><b data-o="ttax">${M(t.tax)} ${CUR}</b><span class="big">Celkem s DPH</span><b class="big" data-o="ttot">${M(t.total)} ${CUR}</b></div>`
      : `<div class="items-empty" style="margin-top:12px"><b>Zatím žádné položky</b>Začni psát do vyhledávání nad tímto polem — stačí kus názvu nebo kód produktu.</div>`;
    $('#itemsFoot').style.display = o.items.length ? '' : 'none';
    $$('#items textarea[data-k="name"]').forEach(autoGrow);
    drawTotals(); drawSteps();
  }
  function drawTotals() {
    const t = Calc.totals(o, step);
    $('#sbCount').textContent = o.items.length;
    $('#sbNet').textContent = M(t.net) + ' ' + CUR;
    $('#sbTax').textContent = M(t.tax) + ' ' + CUR;
    tween($('#sbTotal'), t.total, n => M(n) + ' ' + CUR);
    const set = (k, v) => { const el = $(`#items [data-o="${k}"]`); if (el) el.textContent = M(v) + ' ' + CUR; };
    set('tnet', t.net); set('ttax', t.tax); set('ttot', t.total);
  }
  function updateRow(it) {
    const row = $(`.it[data-id="${it.id}"]`); if (!row) return;
    const l = lineCalc(it);
    $('[data-o="total"]', row).textContent = M(l.total) + ' ' + CUR;
    $('[data-o="net"]', row).textContent = M(l.net) + ' bez DPH';
    $('[data-o="unitNet"]', row).textContent = `Jedn. cena bez DPH: ${M(l.unitNet)} ${CUR}`;
    $('[data-o="name"]', row).innerHTML = esc(it.name) || '<span class="muted">Bez názvu</span>';
    $('[data-o="sub"]', row).innerHTML = [it.code, it.variant].filter(Boolean).map(esc).join(' · ');
    $('[data-o="unit"]', row).textContent = it.unit || 'ks';
    $('.it-price', row).innerHTML = `${priceLine(it)} <span class="pen">✎</span>`;
    drawTotals();
  }
  const numKeys = ['qty', 'priceVat', 'discount', 'vatRate'];
  const autoGrow = t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
  const onField = e => {
    if (e.target.tagName === 'TEXTAREA') autoGrow(e.target);
    const row = e.target.closest('.it'); const k = e.target.dataset.k;
    if (!row || !k) return;
    const it = o.items.find(x => x.id === row.dataset.id);
    it[k] = numKeys.includes(k) ? toNum(e.target.value) : e.target.value;
    updateRow(it); markDirty();
  };
  $('#items').addEventListener('input', onField);
  $('#items').addEventListener('change', e => { if (e.target.tagName === 'SELECT') onField(e); });
  $('#items').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.k === 'qty') { e.preventDefault(); $('#pq').focus(); }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.dataset.k === 'qty') {
      e.preventDefault(); const it = o.items.find(x => x.id === e.target.closest('.it').dataset.id);
      it.qty = Math.max(0, Calc.r2(toNum(it.qty) + (e.key === 'ArrowUp' ? 1 : -1))); e.target.value = numStr(it.qty); updateRow(it); markDirty();
    }
  });
  $('#items').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const row = b.closest('.it'); const i = o.items.findIndex(x => x.id === row.dataset.id); const it = o.items[i];
    if (b.dataset.a === 'plus' || b.dataset.a === 'minus') {
      it.qty = Math.max(0, Calc.r2(toNum(it.qty) + (b.dataset.a === 'plus' ? 1 : -1)));
      $('[data-k="qty"]', row).value = numStr(it.qty); updateRow(it); markDirty();
    }
    if (b.dataset.a === 'edit') {
      const on = !open.has(it.id);
      on ? open.add(it.id) : open.delete(it.id);
      row.classList.toggle('open', on);
      if (on) { autoGrow($('textarea', row)); setTimeout(() => $('[data-k="priceVat"]', row).focus(), 60); }
    }
    if (b.dataset.a === 'rm') {
      row.classList.add('out');
      setTimeout(() => {
        o.items.splice(i, 1); open.delete(it.id); drawItems(); markDirty();
        toast(`Odebráno: ${it.name || 'položka'}`, { action: { label: 'Vrátit', fn: () => { o.items.splice(Math.min(i, o.items.length), 0, it); drawItems(it.id); markDirty(); } } });
      }, 200);
    }
  });
  const rid = () => crypto.randomUUID().slice(0, 12);
  function addItem(p) {
    const same = p && o.items.find(x => x.code === p.code);
    if (same) {
      same.qty = Calc.r2(toNum(same.qty) + 1); drawItems(same.id); markDirty();
      toast(`${p.code} už v nabídce je — množství +1`);
      const q = $(`.it[data-id="${same.id}"] [data-k="qty"]`); q.focus(); q.select(); return;
    }
    const it = {
      id: rid(), code: p ? p.code : '', name: p ? p.name : '', variant: p ? p.variant : '', qty: 1, unit: 'ks',
      priceVat: p ? (o.currency === 'EUR' ? czkToEur(p.priceVat, st) : p.priceVat) : 0, discount: p ? Number(st.defaultDiscount) || 0 : 0, vatRate: offVatDefault(o, st),
    };
    if (!p) open.add(it.id);
    o.items.push(it); drawItems(it.id); markDirty();
    const inp = $(p ? '[data-k="qty"]' : '[data-k="name"]', $(`.it[data-id="${it.id}"]`));
    inp.focus(); if (inp.select) inp.select();
    inp.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  $('#addCustom').onclick = () => addItem(null);
  $('#applyDisc').onclick = () => {
    const d = toNum($('#allDisc').value); o.items.forEach(it => { it.discount = d; });
    drawItems(); markDirty(); toast(`Sleva ${numStr(d)} % nastavena u všech ${o.items.length} položek`);
  };

  // --- našeptávač (sdílený pro produkty i zákazníky) ---
  function suggest({ input, box, fetch: getItems, render, pick, minLen = 2, delay = 120 }) {
    let found = [], sel = 0, timer = null, seq = 0;
    const draw = () => {
      box.hidden = false;
      box.innerHTML = render(found, sel);
      $$('[data-i]', box).forEach(el => el.classList.toggle('on', Number(el.dataset.i) === sel));
      $('.on', box)?.scrollIntoView({ block: 'nearest' });
    };
    const run = async () => {
      const q = input.value.trim();
      if (q.length < minLen) { box.hidden = true; found = []; return; }
      const my = ++seq;
      const r = await getItems(q, partial => { if (my === seq) { found = partial; sel = 0; draw(); } });
      if (my !== seq) return;
      found = r; sel = 0; draw();
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, delay); });
    input.addEventListener('keydown', e => {
      if (box.hidden || !found.length) { if (e.key === 'Escape') input.blur(); return; }
      if (e.key === 'ArrowDown') { sel = Math.min(found.length - 1, sel + 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      if (e.key === 'Enter') { e.preventDefault(); done(sel); }
      if (e.key === 'Escape') box.hidden = true;
    });
    box.addEventListener('mousedown', e => { const r = e.target.closest('[data-i]'); if (r) { e.preventDefault(); done(Number(r.dataset.i)); } });
    box.addEventListener('mousemove', e => { const r = e.target.closest('[data-i]'); if (r && Number(r.dataset.i) !== sel) { sel = Number(r.dataset.i); $$('[data-i]', box).forEach(el => el.classList.toggle('on', Number(el.dataset.i) === sel)); } });
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
    input.addEventListener('focus', () => { if (found.length && input.value.trim().length >= minLen) draw(); });
    const done = i => { const x = found[i]; if (!x || x._src === 'loading') return; box.hidden = true; input.value = ''; found = []; pick(x); };
    return { rerun: run };
  }

  // produkty
  const ps = suggest({
    input: $('#pq'), box: $('#pr'),
    fetch: async q => { if (!S.products) await loadProducts(); return searchProducts(q, $('#phid').checked); },
    render: list => { const q = $('#pq').value; return list.length ? list.map((p, i) => `<div class="res" data-i="${i}">
      <code>${highlight(p.code, q)}</code>
      <div>${highlight(p.name, q)}${p.visible ? '' : '<span class="tag grey">skrytý</span>'}${p.actionPrice ? `<span class="tag">akce ${M(o.currency === 'EUR' ? czkToEur(p.actionPrice, st) : p.actionPrice)}</span>` : ''}${o.items.some(x => x.code === p.code) ? '<span class="tag blue">v nabídce</span>' : ''}${p.variant ? `<div class="v">${highlight(p.variant, q)}</div>` : ''}</div>
      <div class="p">${M(o.currency === 'EUR' ? czkToEur(p.priceVat, st) : p.priceVat)} ${CUR}</div></div>`).join('') : `<div class="empty">${S.products ? 'Nic nenalezeno — zkus kratší dotaz nebo zaškrtni „i skryté“' : 'Načítám produkty…'}</div>`; },
    pick: addItem,
  });
  $('#phid').onchange = () => ps.rerun();

  // zákazníci (dřívější + ARES)
  suggest({
    input: $('#cq'), box: $('#cr'), delay: 250,
    fetch: async (q, partial) => {
      const fq = fold(q);
      const known = (await knownCustomers()).filter(c => fold([c.name, c.company, c.email, c.phone, c.ico].join(' ')).includes(fq)).slice(0, 5).map(c => ({ ...c, _src: 'known' }));
      partial([...known, { _src: 'loading' }]);
      let ares = [];
      try { ares = (await aresSearch(q)).filter(a => !known.some(k => k.ico && k.ico === a.ico)).map(a => ({ ...a, _src: 'ares' })); } catch {}
      return [...known, ...ares];
    },
    render: list => {
      const q = $('#cq').value;
      const row = (c, i) => c._src === 'loading' ? `<div class="empty"><span class="spin" style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .7s linear infinite;vertical-align:-2px"></span> Hledám v ARES…</div>`
        : `<div class="res cust" data-i="${i}"><span class="av">${c._src === 'ares' ? '🏢' : esc((c.company || c.name || '?')[0].toUpperCase())}</span>
          <div><b>${highlight(c.company || c.name, q)}</b>${c.company && c.name ? ` · ${highlight(c.name, q)}` : ''}<div class="v">${esc(c._src === 'ares' ? c._addr : [c.email, c.phone, c.city].filter(Boolean).join(' · '))}</div></div>
          <div class="v">${c.ico ? 'IČ ' + highlight(c.ico, q) : ''}</div></div>`;
      const known = list.map((c, i) => [c, i]).filter(([c]) => c._src === 'known');
      const rest = list.map((c, i) => [c, i]).filter(([c]) => c._src !== 'known');
      if (!list.length) return '<div class="empty">Nic nenalezeno — vyplň údaje ručně níže</div>';
      return (known.length ? `<div class="grp">Dřívější zákazníci</div>${known.map(([c, i]) => row(c, i)).join('')}` : '')
        + (rest.length ? `<div class="grp">Registr firem ARES</div>${rest.map(([c, i]) => row(c, i)).join('')}` : '');
    },
    pick: x => {
      for (const k of Object.keys(emptyCustomer())) {
        const v = x[k]; if (v == null || v === '') continue;
        o.customer[k] = v;
        const inp = $(`[data-c="${k}"]`); inp.value = v; inp.classList.remove('filled'); void inp.offsetWidth; inp.classList.add('filled');
      }
      markDirty(); drawSteps();
      toast(x._src === 'ares' ? 'Údaje firmy doplněny z ARES' : 'Zákazník doplněn z dřívější nabídky');
      $(x._src === 'ares' && !o.customer.name ? '[data-c="name"]' : '#pq').focus();
    },
  });

  // --- ostatní pole ---
  // IČ → automatické doplnění firmy z ARES
  let aresT = null, aresLast = '';
  const aresSt = (txt, cls = '') => { const el = $('#aresSt'); if (el) { el.textContent = txt; el.className = 'ares-st ' + cls; } };
  async function fillFromIco(ico) {
    if (ico === aresLast) return; aresLast = ico;
    aresSt('hledám v ARES…', 'busy');
    try {
      const [f] = await aresSearch(ico);
      if (!f || !f.company) { aresSt('v ARES nenalezeno', 'err'); return; }
      for (const k of ['company', 'dic', 'street', 'city', 'country']) {
        if (!f[k]) continue;
        o.customer[k] = f[k];
        const inp = $(`[data-c="${k}"]`); inp.value = f[k]; inp.classList.remove('filled'); void inp.offsetWidth; inp.classList.add('filled');
      }
      markDirty(); drawSteps();
      aresSt('✓ doplněno z ARES', 'ok');
    } catch { aresLast = ''; aresSt('ARES teď neodpovídá', 'err'); }
  }
  $('#main').addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.c === 'ico') {
      clearTimeout(aresT); aresSt('');
      const v = t.value.replace(/\s/g, '');
      if (/^\d{8}$/.test(v)) aresT = setTimeout(() => fillFromIco(v), 250);
    }
    if (t.dataset.c) { o.customer[t.dataset.c] = t.value; markDirty(); drawSteps(); }
    else if (t.dataset.f) { o[t.dataset.f] = t.value; markDirty(); if (t.dataset.f === 'note') drawSteps(); }
  });
  $('#main').addEventListener('change', e => { if (e.target.dataset.f === 'issuedBy') { o.issuedBy = e.target.value; markDirty(); } });
  $('#quickValid').onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; o.validUntil = plusDays(Number(b.dataset.d)); const i = $('[data-f="validUntil"]'); i.value = o.validUntil; i.classList.remove('filled'); void i.offsetWidth; i.classList.add('filled'); markDirty(); };
  $('#resetTerms').onclick = async () => { if (!(await confirmBox('Obnovit podmínky?', 'Text podmínek se nahradí výchozím textem z Nastavení.', { ok: 'Obnovit' }))) return; o.terms = st.terms; $('[data-f="terms"]').value = o.terms; markDirty(); };
  const cmText = $('#cmText');
  cmText.addEventListener('input', () => { cmText.style.height = 'auto'; cmText.style.height = Math.min(160, cmText.scrollHeight + 2) + 'px'; });

  // --- ukládání (automaticky) ---
  function setSave(text, cls = '') { const el = $('#saveState'); if (el) { el.textContent = text; el.className = 'save ' + cls; } }
  function markDirty() { E.dirty = true; setSave('Neuloženo', 'dirty'); clearTimeout(E.timer); E.timer = setTimeout(save, 1000); }
  async function save() {
    clearTimeout(E.timer);
    if (E.saving) await E.saving;
    if (!E.dirty) return;
    E.dirty = false; setSave('Ukládám…', 'busy');
    E.saving = (async () => {
      const t = Calc.totals(o, step);
      const row = {
        customer: o.customer, recipient: o.recipient, items: o.items, note: o.note, terms: o.terms, shoptet_order: o.shoptetOrder,
        date: o.date || null, valid_until: o.validUntil || null, issued_by: o.issuedBy, net: t.net, total: t.total, currency: o.currency,
      };
      try {
        const r = check(await sb.from('offers').update(row).eq('id', o.id).eq('version', o.version).select('version,updated_at,last_edit_by').maybeSingle());
        if (!r) {
          const cur = check(await sb.from('offers').select('last_edit_by').eq('id', o.id).single());
          const err = new Error(`Nabídku mezitím upravil(a) ${userName(cur.last_edit_by) || 'někdo jiný'}.`); err.conflict = true; throw err;
        }
        o.version = r.version;
        setSave('Uloženo');
      } catch (err) {
        E.dirty = !err.conflict;
        setSave(err.conflict ? 'Konflikt' : 'Chyba ukládání', 'err');
        if (err.conflict) {
          if (await confirmBox('Nabídku upravil někdo jiný', err.message + ' Načíst aktuální verzi? Tvoje poslední změny se zahodí.', { ok: 'Načíst aktuální' })) { leaveGuard = null; cleanup(); renderEditor(o.id); }
        } else { toast('Neuloženo: ' + err.message, true); E.timer = setTimeout(save, 5000); }
      }
    })();
    await E.saving; E.saving = null;
  }
  leaveGuard = async () => { await save(); cleanup(); };
  const onBefore = e => { if (E.dirty) { e.preventDefault(); e.returnValue = ''; } };
  addEventListener('beforeunload', onBefore);
  const ks = e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } };
  document.addEventListener('keydown', ks);
  function cleanup() { removeEventListener('beforeunload', onBefore); document.removeEventListener('keydown', ks); removeEventListener('scroll', onScroll); bar.remove(); }

  // --- PDF ---
  const issuer = () => S.users.find(u => u.id === o.issuedBy);
  const busy = (b, on, html) => { b.disabled = on; if (on) { b.dataset.html = b.innerHTML; b.innerHTML = `<span class="spin"></span> ${html}`; } else b.innerHTML = b.dataset.html; };
  $('#pdfView', bar).onclick = async e => {
    const b = e.currentTarget; const w = window.open('', '_blank');
    busy(b, true, '');
    try { await save(); await offerPdf(o, st, issuer(), 'open', w); }
    catch (err) { if (w) w.close(); toast('PDF: ' + err.message, true); }
    busy(b, false);
  };
  $('#pdfDl', bar).onclick = async e => {
    const b = e.currentTarget;
    if (!o.items.length && !(await confirmBox('Nabídka nemá položky', 'Opravdu stáhnout PDF bez položek?', { ok: 'Stáhnout' }))) return;
    busy(b, true, 'Generuji…');
    try {
      await save(); await offerPdf(o, st, issuer(), 'download');
      if (o.status === 'draft') toast('PDF staženo. Až ho pošleš zákazníkovi, označ nabídku jako odeslanou.', { action: { label: 'Odeslána', fn: () => $('#statusPick [data-s="sent"]')?.click() } });
    } catch (err) { toast('PDF: ' + err.message, true); }
    busy(b, false);
  };

  // --- stav ---
  $('#statusPick').onclick = async e => {
    const b = e.target.closest('button[data-s]'); if (!b || b.dataset.s === o.status) return;
    await save();
    try {
      const r = await changeStatus(o, b.dataset.s);
      if (!r) return;
      Object.assign(o, { status: r.status, version: r.version, shoptetOrder: r.shoptetOrder });
      $$('#statusPick button').forEach(x => x.classList.toggle('on', x.dataset.s === o.status));
      $('#stBadge').innerHTML = stat(o.status);
      $('#shoptetBox').hidden = o.status !== 'confirmed';
      $('[data-f="shoptetOrder"]').value = o.shoptetOrder || '';
      drawToShoptet();
      history = check(await sb.from('offer_history').select('*').eq('offer_id', o.id).order('at'));
      drawHistory();
      toast('Stav: ' + STATUSES[o.status]);
    } catch (err) { toast(err.message, true); }
  };
  // --- překlopení nabídky do objednávky ve Shoptetu ---
  function drawToShoptet() {
    const box = $('#toShoptetBox');
    if (o.currency === 'EUR') { box.innerHTML = '<div class="muted small">Nabídka v EUR — překlopení do Shoptetu zatím není (slovenský e-shop). Položky můžeš zkopírovat tlačítkem níž.</div>'; return; }
    box.innerHTML = o.shoptetOrder && o.status === 'confirmed'
      ? `<div class="sh-linked"><span class="mg ok">Objednávka ve Shoptetu</span> <b class="num-t">${esc(o.shoptetOrder)}</b></div>`
      : `<button class="btn primary" id="toShoptet" style="width:100%" title="Založí ve Shoptetu objednávku z této nabídky">🛒 Překlopit do Shoptetu</button>`;
    const b = $('#toShoptet'); if (b) b.onclick = flipToShoptet;
  }
  async function flipToShoptet(e) {
    const btn = e.currentTarget;
    await save();
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Načítám…';
    let opts;
    try { opts = await shoptetCall({ action: 'order_options' }); if (!opts.ok) throw new Error('Nepodařilo se načíst způsoby platby a dopravy ze Shoptetu.'); }
    catch (err) { toast(err.message, true); drawToShoptet(); return; }
    drawToShoptet();
    let mem = {}; try { mem = JSON.parse(ls.get('vh_sh_order') || '{}'); } catch {}
    const pick = (list, remembered, re) => (list.find(x => x.guid === remembered) || list.find(x => re.test(x.name)) || list[0] || {}).guid;
    const payDef = pick(opts.payments, mem.pay, /Bankovním převodem/i), shipDef = pick(opts.shippings, mem.ship, /Osobní odběr.*Bez Palety/i);
    const stDef = opts.statuses.some(x => x.id === mem.status) ? mem.status : -1;
    const t = Calc.totals(o, step);
    const sel = (id, list, cur) => `<select id="${id}">${list.map(x => `<option value="${esc(x.guid ?? x.id)}" ${String(x.guid ?? x.id) === String(cur) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
    const res = await modal({
      title: 'Překlopit do Shoptetu',
      body: `<div class="sh-sum"><div><span class="muted">Zákazník</span><b>${esc(custLabel(o.customer))}</b></div><div><span class="muted">Položek</span><b>${o.items.length}</b></div><div><span class="muted">Celkem s DPH</span><b class="num-t">${M(t.total)} Kč</b></div></div>
        <div class="form" style="grid-template-columns:1fr;gap:10px">
          <div><label for="mPay">Způsob platby</label>${sel('mPay', opts.payments, payDef)}</div>
          <div><label for="mShip">Způsob dopravy</label>${sel('mShip', opts.shippings, shipDef)}</div>
          <div><label for="mShipP">Cena dopravy s DPH</label><div class="fld"><input id="mShipP" inputmode="decimal" value="0"><span class="suf">Kč</span></div></div>
          <div><label for="mSt">Stav nové objednávky</label>${sel('mSt', opts.statuses.map(x => ({ guid: x.id, name: x.name })), stDef)}</div>
          <label class="trust"><input type="checkbox" id="mMail"> Poslat zákazníkovi e-mail s objednávkou <span class="muted">— jinak se neodešle nic</span></label>
        </div>
        <p class="muted small">Ceny a slevy se přenesou přesně podle nabídky. Do <b>interní poznámky objednávky</b> ve Shoptetu se zapíše „Vytvořeno z nabídky č. ${esc(o.number)} ve Vinylor Hubu“ (zákazník ji nevidí). Nabídka přejde do stavu „Překlopena do Shoptetu“ a objednávka se zamkne proti dvojímu založení.</p>`,
      actions: [{ label: 'Zrušit', value: null }, { label: '🛒 Založit objednávku', value: bd => ({
        paymentGuid: $('#mPay', bd).value, paymentName: $('#mPay', bd).selectedOptions[0].textContent,
        shippingGuid: $('#mShip', bd).value, shippingName: $('#mShip', bd).selectedOptions[0].textContent,
        shippingPriceVat: toNum($('#mShipP', bd).value), statusId: Number($('#mSt', bd).value), sendEmail: $('#mMail', bd).checked,
      }), cls: 'primary' }],
    });
    if (!res) return;
    ls.set('vh_sh_order', JSON.stringify({ pay: res.paymentGuid, ship: res.shippingGuid, status: res.statusId }));
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Zakládám objednávku…';
    try {
      let r = await shoptetCall({ action: 'order_create', offerId: o.id, ...res });
      if (!r.ok && r.stockShort) {
        const go = await modal({ title: 'Není dost zboží skladem',
          body: `<p>Shoptet objednávku nepustil, protože na skladě není dostatečné množství:</p><ul class="problems">${r.problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p><b>Chceš objednávku založit i tak?</b> Objednávka vznikne a zboží se ze skladu <b>stáhne do mínusu</b>. Dej pozor, ať je pak vše včas naskladněno.</p>`,
          actions: [{ label: 'Zrušit', value: false }, { label: 'Založit i tak (sklad do mínusu)', value: true, cls: 'danger' }] });
        if (!go) { drawToShoptet(); return; }
        btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Zakládám objednávku…';
        r = await shoptetCall({ action: 'order_create', offerId: o.id, ...res, allowNegative: true });
      }
      if (!r.ok) {
        await modal({ title: 'Objednávku se nepodařilo založit', body: `<ul class="problems">${r.problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="muted small">Nic se ve Shoptetu nevytvořilo. Oprav údaje v nabídce a zkus to znovu.</p>`, actions: [{ label: 'Rozumím', value: null, cls: 'primary' }] });
        drawToShoptet(); return;
      }
      try {
        const mv = o.items.filter(i => i.code && Number(i.qty) > 0).map(i => ({ actor: S.me.id, order_code: String(r.code), offer_id: o.id, offer_number: o.number, code: String(i.code).trim(), amount: -Number(i.qty), negative_stock: !!r.negative }));
        if (mv.length) await sb.from('stock_order_log').insert(mv);
      } catch { /* historie pohybů je doplněk, objednávku nezdržuje */ }
      o.status = 'confirmed'; o.shoptetOrder = r.code;
      $$('#statusPick button').forEach(x => x.classList.toggle('on', x.dataset.s === o.status));
      $('#stBadge').innerHTML = stat(o.status);
      $('#shoptetBox').hidden = false; $('[data-f="shoptetOrder"]').value = r.code;
      const fresh = check(await sb.from('offers').select('version').eq('id', o.id).single()); o.version = fresh.version;
      history = check(await sb.from('offer_history').select('*').eq('offer_id', o.id).order('at')); drawHistory(); drawToShoptet();
      const link = r.adminUrl ? `<p><a class="btn" href="${esc(r.adminUrl)}" target="_blank" rel="noopener">Otevřít objednávku ve Shoptetu ↗</a></p>` : '';
      await modal({ title: `Objednávka ${r.code} založena ✓`, body: `${r.negative ? '<p class="warn-t">⚠ Zboží se ze skladu stáhlo do mínusu (potvrzeno).</p>' : ''}<p>Celkem s DPH: <b>${M(r.offerTotal)} Kč</b> v nabídce · <b>${r.shoptetTotal == null ? '—' : M(r.shoptetTotal) + ' Kč'}</b> ve Shoptetu${r.toPay != null ? ` (k úhradě ${esc(String(r.toPay))} Kč)` : ''}.</p>${link}
        ${r.warnings?.length ? `<ul class="problems">${r.warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`, actions: [{ label: 'Hotovo', value: null, cls: 'primary' }] });
    } catch (err) { toast(err.message, true); drawToShoptet(); }
  }
  drawToShoptet();
  $('#copyShoptet').onclick = async () => {
    const txt = o.items.filter(i => i.code).map(i => `${i.code}\t${numStr(i.qty)}\t${i.name}${i.variant ? ', ' + i.variant : ''}`).join('\n');
    if (!txt) return toast('V nabídce nejsou položky s kódem', true);
    try { await navigator.clipboard.writeText(txt); toast('Zkopírováno: kód, množství, název'); }
    catch { modal({ title: 'Zkopíruj položky', body: `<textarea rows="8" readonly>${esc(txt)}</textarea>` }); }
  };

  // --- komentáře ---
  function drawComments() {
    $('#comments').innerHTML = comments.length ? comments.map(cm => `<div class="cm ${cm.author === S.me.id ? 'mine' : ''}">
      <span class="av" title="${esc(userName(cm.author))}">${initials(cm.author)}</span>
      <div class="bub"><div class="h"><b>${esc(userName(cm.author))}</b><span title="${esc(czDateTime(cm.created_at))}">${ago(cm.created_at)}</span>
      ${cm.author === S.me.id || S.me.role === 'admin' ? `<button class="x" data-cid="${cm.id}" title="Smazat">✕</button>` : ''}</div>
      <p>${esc(cm.text)}</p></div></div>`).join('') : '<div class="muted small">Zatím žádné komentáře. Sem si pište poznámky k jednání se zákazníkem — v PDF se neobjeví.</div>';
  }
  async function sendComment() {
    const text = cmText.value.trim(); if (!text) return;
    const b = $('#cmSend'); b.disabled = true;
    try {
      const cm = check(await sb.from('offer_comments').insert({ offer_id: o.id, author: S.me.id, text }).select().single());
      comments.push(cm); cmText.value = ''; cmText.style.height = ''; drawComments();
    } catch (err) { toast(err.message, true); }
    b.disabled = false;
  }
  $('#cmSend').onclick = sendComment;
  cmText.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendComment(); };
  $('#comments').onclick = async e => {
    const b = e.target.closest('[data-cid]'); if (!b) return;
    if (!(await confirmBox('Smazat komentář?', 'Komentář se nevratně odstraní.', { ok: 'Smazat', danger: true }))) return;
    try { check(await sb.from('offer_comments').delete().eq('id', b.dataset.cid)); comments = comments.filter(x => x.id !== b.dataset.cid); drawComments(); }
    catch (err) { toast(err.message, true); }
  };

  function drawHistory() {
    $('#hist').innerHTML = [...history].reverse().map(h => {
      const what = h.action === 'created' ? 'vytvořil(a) nabídku' + (h.note ? ` (${esc(h.note)})` : '') : `→ <b>${esc(STATUSES[h.to_status] || h.to_status)}</b>`;
      return `<div><b>${esc(userName(h.author))}</b> ${what}<br>${czDateTime(h.at)}</div>`;
    }).join('');
  }

  $('#arch').onclick = async e => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const flag = !o.archived;
      const r = check(await sb.from('offers').update({ archived: flag, archived_at: flag ? new Date().toISOString() : null }).eq('id', o.id).select('version').single());
      o.archived = flag; o.version = r.version;
      b.innerHTML = `📦 <span class="hide-xs">${flag ? 'Vrátit z archivu' : 'Archivovat'}</span>`; toast(flag ? 'Nabídka je v archivu' : 'Vráceno z archivu');
    } catch (err) { toast(err.message, true); }
    b.disabled = false;
  };
  $('#dup').onclick = async e => {
    const b = e.currentTarget; busy(b, true, 'Kopíruji…');
    await save();
    try { const n = await newOffer(o.id); toast('Vytvořena kopie ' + n.number); } catch (err) { toast(err.message, true); busy(b, false); }
  };
  $('#del').onclick = async () => {
    if (!(await confirmBox(`Smazat nabídku ${o.number}?`, 'Nabídka zmizí z přehledu. Obnovit ji může jen správce.', { ok: 'Smazat', danger: true }))) return;
    try {
      E.dirty = false; clearTimeout(E.timer);
      check(await sb.from('offers').update({ deleted: true }).eq('id', o.id));
      leaveGuard = null; cleanup(); toast('Nabídka smazána'); location.hash = '#/nabidky';
    } catch (err) { toast(err.message, true); }
  };

  // --- měna nabídky (Kč / EUR) ---
  $('#curSegO').onclick = async e => {
    const b = e.target.closest('button'); if (!b || b.dataset.c === o.currency) return; const to = b.dataset.c;
    if (o.items.length && !(await confirmBox(`Změnit měnu na ${to === 'EUR' ? 'EUR' : 'Kč'}?`, `Ceny ${o.items.length} položek se přepočtou kurzem ${numStr(offRate(st))} Kč/€ a sazby DPH se změní (${to === 'EUR' ? '21 → 23 %, 12 → 19 %' : '23 → 21 %, 19 a 5 → 12 %'}). Ceny pak zkontroluj.`, { ok: 'Změnit a přepočítat' }))) return;
    const rate = offRate(st);
    for (const it of o.items) {
      const vat = Number(it.vatRate) || 0; const nvat = to === 'EUR' ? (VAT_CZ_TO_SK[vat] ?? 23) : (VAT_SK_TO_CZ[vat] ?? 21);
      const net = Number(it.priceVat || 0) / (1 + vat / 100);
      let np = Calc.r2((to === 'EUR' ? net / rate : net * rate) * (1 + nvat / 100)); if (to === 'CZK' && Math.abs(np - Math.round(np)) < 0.05) np = Math.round(np); // 429 → 18,02 € → zase 429, ne 428,99
      it.priceVat = np; it.vatRate = nvat;
    }
    o.currency = to; CUR = offSym(o); step = offStep(o, st);
    if (to === 'EUR' && (!o.customer.country || o.customer.country === 'Česká republika')) { o.customer.country = 'Slovensko'; const ci = $('[data-c="country"]'); if (ci) ci.value = 'Slovensko'; }
    if (to === 'CZK' && o.customer.country === 'Slovensko') { o.customer.country = 'Česká republika'; const ci = $('[data-c="country"]'); if (ci) ci.value = 'Česká republika'; }
    $$('#curSegO button').forEach(x => x.classList.toggle('on', x === b));
    $('#curHint').textContent = to === 'EUR' ? `EUR: DPH ${offVatDefault(o, st)} %, ceny z CZ e-shopu se přepočítají kurzem ${numStr(offRate(st))} Kč/€ — uprav je podle slovenského e-shopu.` : '';
    drawItems(); drawToShoptet(); markDirty(); toast(`Měna nabídky: ${to === 'EUR' ? 'EUR' : 'Kč'}`);
  };

  drawItems(); drawComments(); drawHistory();
  if (!o.items.length && !c.name && !c.company) $('#cq').focus();
}

// ---------- nastavení ----------
async function renderSettings() {
  shell('settings', `<div class="topbar"><h1>Nastavení</h1></div><div class="stack">${'<div class="panel panel-b"><div class="sk" style="height:120px"></div></div>'.repeat(3)}</div>`);
  const row = await loadSettings();
  const s = row.data, sup = s.supplier || {};
  const inp = (k, label, v, cls = '', type = 'text', extra = '') => `<div class="${cls}"><label>${label}</label><input name="${k}" type="${type}" value="${esc(v)}" ${extra}></div>`;
  $('#main').innerHTML = `
  ${pgHead('settings', 'Nastavení', 'Propojení se Shoptetem, kurzy, objednávky a správa týmu.')}
  <form class="stack" id="sf">
    <section class="panel"><div class="panel-h">🛒 Produkty ze Shoptetu</div><div class="panel-b">
      <div class="form">
        ${inp('csvUrl', 'Odkaz na CSV export produktů', s.csvUrl, 'full')}
        <div class="full"><label>Stav</label><div id="pst" class="small"></div><div class="hint">Produkty se načítají automaticky každou hodinu.</div></div>
      </div>
      <button type="button" class="btn sm" id="refresh" style="margin-top:10px">↻ Načíst produkty teď</button>
    </div></section>

    <section class="panel"><div class="panel-h">📄 Nabídky</div><div class="panel-b form">
      ${inp('numberPrefix', 'Předpona čísla — jen číslice, {RR} = rok (26)', s.numberPrefix, '', 'text', 'pattern="(\\{RR\\}|\\{RRRR\\}|[0-9])*" title="Jen číslice a {RR} — číslo nabídky slouží jako variabilní symbol"')}
      ${inp('numberDigits', 'Počet číslic', s.numberDigits, '', 'number', 'min="1" max="10"')}
      ${inp('nextNumber', 'Další pořadové číslo', s.nextNumber, '', 'number', 'min="1"')}
      ${inp('validDays', 'Platnost nabídky (dní)', s.validDays, '', 'number', 'min="1"')}
      ${inp('defaultDiscount', 'Výchozí sleva na položky (%)', s.defaultDiscount, '', 'number', 'step="0.5"')}
      ${inp('defaultVat', 'Výchozí sazba DPH (%)', s.defaultVat, '', 'number')}
      ${inp('defaultVatEur', 'Nabídky v EUR: výchozí sazba DPH (%) — Slovensko', s.defaultVatEur ?? 23, '', 'number')}
      ${inp('eurRate', 'Nabídky v EUR: kurz pro přepočet cen z CZ e-shopu (Kč za 1 €)', s.eurRate ?? 24.2, '', 'number', 'step="0.0001" min="1"')}
      <div><label>Zaokrouhlení jedn. ceny bez DPH</label><select name="priceStep">
        <option value="0.1" ${s.priceStep == 0.1 ? 'selected' : ''}>na 0,10 Kč (jako Pohoda — 429 → 354,60)</option>
        <option value="0.01" ${s.priceStep == 0.01 ? 'selected' : ''}>na haléře (429 → 354,55)</option>
      </select></div>
      <div class="full hint" id="numPreview"></div>
      ${inp('agreeLine', 'Úvodní věta podmínek', s.agreeLine, 'full')}
      <div class="full"><label>Výchozí podmínky ({platnost} = datum platnosti)</label><textarea name="terms" rows="8">${esc(s.terms)}</textarea></div>
    </div></section>

    <section class="panel"><div class="panel-h">🚚 Objednávky</div><div class="panel-b form">
      <div class="full hint">Názvy sloupců na nástěnce objednávek (nech prázdné pro výchozí).</div>
      ${inp('ojLbl_order', 'Sloupec 1', s.ojLbl_order || '', '', 'text', 'placeholder="Potřeba objednat"')}${inp('ojLbl_ordered', 'Sloupec 2', s.ojLbl_ordered || '', '', 'text', 'placeholder="Objednáno"')}${inp('ojLbl_transit', 'Sloupec 3', s.ojLbl_transit || '', '', 'text', 'placeholder="Na cestě"')}${inp('ojLbl_delivered', 'Sloupec 4', s.ojLbl_delivered || '', '', 'text', 'placeholder="Doručeno"')}${inp('ojLbl_issue', 'Sloupec 5', s.ojLbl_issue || '', '', 'text', 'placeholder="Reklamace"')}
      <div class="full"><label>Sledovaní dodavatelé</label><div class="hint">Do „Potřeba objednat“ se počítá jen zboží od zaškrtnutých dodavatelů (každý má vlastní záložku). Ostatní (Hašpl, Dakota…) se ignoruje.</div><div id="ojSupSet" class="small muted">načítám…</div></div>
      ${inp('ojDueDays', 'Splatnost objednávky u dodavatele (dní od objednání, 0 = nenastavovat)', s.ojDueDays ?? '', '', 'number', 'min="0" step="1" placeholder="např. 14"')}
      ${inp('ojDueWarn', 'Upozornit na blížící se splatnost (dní předem)', s.ojDueWarn ?? 3, '', 'number', 'min="0" step="1"')}
      ${inp('ojWaitStatusName', 'Stav ve Shoptetu po objednání u dodavatele', s.ojWaitStatusName || '', '', 'text', 'placeholder="Čeká na zboží"')}
      <div class="full"><input type="hidden" name="ojWaitEmail" value="0"><label class="chk" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="ojWaitEmail" value="1" ${s.ojWaitEmail === '1' ? 'checked' : ''}> Při změně stavu poslat zákazníkovi e-mail (výchozí: neposílat)</label></div>
      <div class="full"><input type="hidden" name="ojShowUnassigned" value="0"><label class="chk" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="ojShowUnassigned" value="1" ${s.ojShowUnassigned === '1' ? 'checked' : ''}> Počítat i zboží, které nemá přiřazeného dodavatele</label></div>
    </div></section>

    <section class="panel"><div class="panel-h">📦 Naskladnění</div><div class="panel-b form">
      ${inp('stockRate', 'Výchozí kurz EUR/CZK (když se nepodaří načíst ČNB)', s.stockRate ?? 24.2055, '', 'number', 'step="0.0001"')}
      ${inp('stockRateUsd', 'Výchozí kurz USD/CZK (když se nepodaří načíst ČNB)', s.stockRateUsd ?? 21.5, '', 'number', 'step="0.0001"')}
      ${inp('stockTransportPct', 'Doprava k nákupní ceně (%)', s.stockTransportPct ?? 10, '', 'number', 'step="0.5"')}
      ${inp('marginWarn', 'Upozornit na marži pod (%) — oranžově', s.marginWarn ?? 25, '', 'number')}
      ${inp('marginBad', 'Varovat při marži pod (%) — červeně', s.marginBad ?? 15, '', 'number')}
    </div></section>

    <section class="panel"><div class="panel-h">🔌 Propojení se Shoptetem <span class="sub">Private API</span></div><div class="panel-b">
      <div id="shStatus" class="small muted">Token je uložený v Supabase (Secrets), do prohlížeče se nikdy nedostane. Klikni na „Otestovat spojení“.</div>
      <div class="form" style="margin-top:12px">
        <div><label for="shStock">Sklad pro naskladnění</label><select id="shStock" name="shoptetStockId"><option value="${esc(s.shoptetStockId ?? 1)}">${esc(s.shoptetStockName || 'Sklad ' + (s.shoptetStockId ?? 1))}</option></select><input type="hidden" name="shoptetStockName" id="shStockName" value="${esc(s.shoptetStockName || '')}"></div>
        <div><label>&nbsp;</label><button type="button" class="btn" id="shTest">↻ Otestovat spojení</button></div>
      </div>
      <div class="hint">Do tohoto skladu zapisuje tlačítko „Naskladnit do Shoptetu“ u příjemek. Přidává se jen přírůstek, množství se nikdy nepřepisuje.</div>
    </div></section>

    <section class="panel"><div class="panel-h">🏢 Dodavatel (hlavička PDF)</div><div class="panel-b form">
      ${inp('s.company', 'Firma', sup.company)}
      ${inp('s.street', 'Ulice', sup.street)}
      ${inp('s.city', 'PSČ a město', sup.city)}
      ${inp('s.country', 'Země', sup.country)}
      ${inp('s.ico', 'IČ', sup.ico)}
      ${inp('s.dic', 'DIČ', sup.dic)}
      ${inp('s.phone', 'Telefon', sup.phone)}
      ${inp('s.mobile', 'Mobil', sup.mobile)}
      ${inp('s.email', 'E-mail', sup.email)}
      ${inp('s.web', 'Web', sup.web)}
      ${inp('s.bank', 'Bankovní účet (nepovinné)', sup.bank, 'full')}
      ${inp('s.bankEur', 'Účet / IBAN pro nabídky v EUR (nepovinné, jinak se použije účet výše)', sup.bankEur || '', 'full')}
    </div></section>
    <div><button class="btn primary lg">Uložit nastavení</button></div>
  </form>`;
  const drawPst = r => {
    $('#pst').innerHTML = (r.products_error ? `<div class="err">Chyba: ${esc(r.products_error)} (${czDateTime(r.products_error_at)})</div>` : '') +
      `<b>${r.products_count}</b> produktů · naposledy načteno ${r.products_synced_at ? ago(r.products_synced_at) : '—'}`;
  };
  drawPst(row);
  const preview = () => {
    const f = new FormData($('#sf'));
    const pre = String(f.get('numberPrefix')).replace('{RRRR}', String(new Date().getFullYear())).replace('{RR}', String(new Date().getFullYear()).slice(2));
    const num = pre + String(f.get('nextNumber')).padStart(Number(f.get('numberDigits')) || 5, '0');
    const ok = /^\d+$/.test(num) && num.length <= 10;
    $('#numPreview').innerHTML = `Další nabídka dostane číslo <b class="num-t" style="color:${ok ? 'var(--brand)' : 'var(--danger)'}">${esc(num)}</b>${ok ? ' — vhodné jako variabilní symbol ✓' : ' — nehodí se jako variabilní symbol (jen číslice, max. 10)'}`;
  };
  $('#sf').addEventListener('input', preview); preview();
  $('#shStock').onchange = e => { $('#shStockName').value = e.target.selectedOptions[0]?.textContent || ''; };
  $('#shTest').onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span> Testuji…';
    try {
      const r = await shoptetCall({ action: 'status' });
      if (!r.ok) throw new Error(r.error || 'Spojení se nepovedlo.');
      const cur = String($('#shStock').value);
      $('#shStock').innerHTML = r.stocks.map(x => `<option value="${x.id}" ${String(x.id) === cur ? 'selected' : ''}>${esc(x.title)}</option>`).join('');
      $('#shStockName').value = $('#shStock').selectedOptions[0]?.textContent || '';
      $('#shStatus').innerHTML = `<span class="mg ok">Spojeno</span> &nbsp;${esc(r.shop.company || 'e-shop')} · <b>${r.products ?? '?'}</b> produktů · <b>${r.stocks.length}</b> sklady (${r.stocks.map(x => esc(x.title)).join(', ')}) · <b>${r.statuses.length}</b> stavů objednávek`;
      toast('Spojení se Shoptetem funguje ✓');
    } catch (err) { $('#shStatus').innerHTML = `<span class="mg bad">Chyba</span> ${esc(err.message)}`; toast(err.message, true); }
    b.disabled = false; b.textContent = '↻ Otestovat spojení';
  };
  $('#refresh').onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span> Načítám…';
    try {
      const { data, error } = await sb.functions.invoke('hub-products-sync', { body: {} });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error);
      drawPst(await loadSettings()); await loadProducts(true);
      toast('Produkty aktualizovány');
    } catch (err) { toast(err.message, true); }
    b.disabled = false; b.textContent = '↻ Načíst produkty teď';
  };
  (async () => {
    const box = $('#ojSupSet'); if (!box) return;
    try {
      const sups = check(await sb.from('oj_suppliers').select('id,name,country,active').order('name'));
      box.innerHTML = sups.map(x => `<label class="chk" style="display:flex;gap:8px;align-items:center;margin:4px 0"><input type="checkbox" data-sup="${x.id}" ${x.active === false ? '' : 'checked'}> ${ojFlag(x.country)} ${esc(x.name)}</label>`).join('') || 'Zatím žádný dodavatel (přidáš ho v Objednávky → Dodavatelé).';
      $$('[data-sup]', box).forEach(c => c.onchange = async () => { try { check(await sb.from('oj_suppliers').update({ active: c.checked }).eq('id', c.dataset.sup)); toast(c.checked ? 'Dodavatel se sleduje' : 'Dodavatel se ignoruje'); } catch (er) { toast(er.message, true); c.checked = !c.checked; } });
    } catch (er) { box.textContent = er.message; }
  })();
  $('#sf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const fresh = (await loadSettings()).data; // ať nepřepíšeme číslo řady, které mezitím někdo použil
    const data = { ...fresh, supplier: { ...(fresh.supplier || {}) } };
    const nums = ['numberDigits', 'nextNumber', 'validDays', 'defaultDiscount', 'defaultVat', 'defaultVatEur', 'eurRate', 'priceStep', 'stockRate', 'stockRateUsd', 'ojDueDays', 'ojDueWarn', 'stockTransportPct', 'marginWarn', 'marginBad', 'shoptetStockId'];
    for (const [k, v] of f) {
      if (k.startsWith('s.')) data.supplier[k.slice(2)] = v;
      else data[k] = nums.includes(k) ? Number(v) : v;
    }
    if (Number(f.get('nextNumber')) === Number(s.nextNumber)) data.nextNumber = fresh.nextNumber;
    const pre = String(data.numberPrefix).replace('{RRRR}', '2026').replace('{RR}', '26');
    if (!/^\d*$/.test(pre)) return toast('Předpona smí obsahovat jen číslice a {RR} — číslo nabídky je variabilní symbol.', true);
    if (pre.length + Number(data.numberDigits) > 10) return toast('Číslo nabídky by mělo víc než 10 číslic (limit variabilního symbolu).', true);
    try { check(await sb.from('hub_settings').update({ data }).eq('id', 1)); await loadSettings(); toast('Nastavení uloženo ✓'); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- účet ----------
async function shoptetCall(body) {
  const { data, error } = await sb.functions.invoke('hub-shoptet', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}
async function adminCall(body) {
  const { data, error } = await sb.functions.invoke('hub-admin', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}
// pravidla hesla: aspoň 12 znaků, písmena i číslice, ne jméno/e-mail, ne běžná slova
const WEAK = ['heslo', 'password', 'vinylor', 'qwerty', '123456', 'gaviko', 'shoptet', 'dobris', 'terasa'];
function passwordProblems(pw, me) {
  const p = [];
  if (pw.length < 12) p.push('aspoň 12 znaků');
  if (!/[a-zá-ž]/i.test(pw) || !/\d/.test(pw)) p.push('písmena i číslice');
  const low = fold(pw);
  const parts = [...fold(me.name).split(/\s+/), fold(me.email.split('@')[0])].filter(x => x.length >= 3);
  if (parts.some(x => low.includes(x))) p.push('bez jména a e-mailu');
  if (WEAK.some(w => low.includes(w))) p.push('bez běžných slov (heslo, vinylor…)');
  if (/(.)\1{3,}/.test(pw)) p.push('bez opakování znaků');
  return p;
}
async function verifyCurrentPassword(email, password) {
  // ověření starého hesla v odděleném klientovi — hlavní přihlášení (s 2FA) zůstane beze změny
  const tmp = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'vh-verify-' + Date.now() } });
  const { error } = await tmp.auth.signInWithPassword({ email, password });
  if (!error) { try { await tmp.auth.signOut({ scope: 'local' }); } catch {} }
  return !error;
}
async function renderAccount() {
  const me = S.me;
  let factors = [];
  try { const { data } = await sb.auth.mfa.listFactors(); factors = (data?.totp || []).filter(f => f.status === 'verified'); } catch {}
  shell('account', `
  ${pgHead('account', 'Můj účet', 'Heslo, dvoufázové ověření a přihlášená zařízení.')}
  <div class="stack" style="max-width:760px">
    ${me.must_change ? '<div class="panel panel-b notice">👋 Vítej! Nejdřív si prosím nastav vlastní heslo — dočasné heslo od správce už dál nepoužívej.</div>' : ''}
    <form class="panel" id="pw" autocomplete="on"><div class="panel-h">🔑 Změna hesla</div><div class="panel-b form">
      <input type="email" name="username" value="${esc(me.email)}" autocomplete="username" hidden>
      <div class="full"><label for="pw-old">Současné heslo</label><input id="pw-old" name="old" type="password" autocomplete="current-password" required></div>
      <div><label for="pw-new">Nové heslo</label><input id="pw-new" name="new" type="password" autocomplete="new-password" minlength="12" required></div>
      <div><label for="pw-new2">Nové heslo znovu</label><input id="pw-new2" name="new2" type="password" autocomplete="new-password" minlength="12" required></div>
      <div class="full"><div class="pw-meter"><i id="pwBar"></i></div><div class="hint" id="pwHint">Aspoň 12 znaků, písmena i číslice. Nejlepší je věta ze 3–4 slov, třeba „Terasa-pod-hruskou-2026“.</div></div>
      <div><button class="btn primary">Změnit heslo</button></div>
    </div></form>
    <section class="panel"><div class="panel-h">🔐 Dvoufázové ověření</div><div class="panel-b">
      ${factors.length ? `<div class="row"><span class="mg ok">Zapnuto</span><span class="grow">Při přihlášení se vyžaduje kód z aplikace v telefonu${factors[0].created_at ? ` · nastaveno ${czDate(factors[0].created_at)}` : ''}.</span></div>
        <div class="hint">Nový telefon nebo ztráta telefonu? Požádej správce o reset 2FA — při dalším přihlášení si ho nastavíš znovu.</div>`
      : '<div class="row"><span class="mg bad">Vypnuto</span><span class="grow">Odhlas se a znovu přihlas — aplikace tě provede nastavením.</span></div>'}
      <div class="row" style="margin-top:14px">
        <button class="btn" id="outAll" title="Odhlásí tě z počítače, telefonu i všech dalších zařízení">🚪 Odhlásit ze všech zařízení</button>
        <span class="small muted">Toto zařízení: ${trustedDevice() ? 'důvěryhodné (zůstává přihlášené)' : 'běžné (odhlásí se po zavření prohlížeče)'}</span>
      </div>
    </div></section>
    <form class="panel" id="pf"><div class="panel-h">📇 Kontakt do nabídek</div><div class="panel-b form">
      <div class="full muted small">Zobrazí se v PDF u „Vystavil“, když nabídku vystavíš ty. Přihlašovací e-mail: ${esc(me.email)}</div>
      <div><label for="pf-phone">Telefon</label><input id="pf-phone" name="phone" value="${esc(me.phone)}"></div>
      <div><label for="pf-email">E-mail</label><input id="pf-email" name="email" type="email" value="${esc(me.contact_email)}"></div>
      <div><button class="btn primary">Uložit</button></div>
    </div></form>
    ${me.role === 'admin' ? `<section class="panel"><div class="panel-h">👥 Uživatelé a zabezpečení <span class="sub">správa týmu</span></div><div class="panel-b" id="usersBox"><div class="sk" style="height:120px"></div></div></section>
    <section class="panel"><div class="panel-h">🛡️ Bezpečnostní deník <span class="sub">posledních 60 událostí</span></div><div class="panel-b" id="auditBox"><div class="sk" style="height:120px"></div></div></section>` : ''}
  </div>`);
  $('#pf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try { check(await sb.rpc('hub_update_my_contact', { p_phone: f.get('phone'), p_contact_email: f.get('email') })); await loadUsers(); toast('Uloženo ✓'); }
    catch (err) { toast(err.message, true); }
  };
  const pwNew = $('#pw-new');
  pwNew.oninput = () => {
    const probs = passwordProblems(pwNew.value, me);
    const score = Math.max(0, Math.min(4, Math.floor(pwNew.value.length / 4) - probs.length));
    $('#pwBar').style.width = (pwNew.value ? 20 + score * 20 : 0) + '%';
    $('#pwBar').dataset.s = probs.length ? 'bad' : score >= 4 ? 'ok' : 'warn';
    $('#pwHint').textContent = pwNew.value ? (probs.length ? 'Ještě: ' + probs.join(', ') + '.' : 'Silné heslo ✓') : $('#pwHint').textContent;
  };
  $('#pw').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    const oldPw = String(f.get('old')), newPw = String(f.get('new'));
    if (newPw !== f.get('new2')) return toast('Nová hesla se neshodují', true);
    if (newPw === oldPw) return toast('Nové heslo musí být jiné než současné', true);
    const probs = passwordProblems(newPw, me);
    if (probs.length) return toast('Heslo je slabé: ' + probs.join(', '), true);
    const btn = $('#pw .btn.primary'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Měním…';
    try {
      if (!(await verifyCurrentPassword(me.email, oldPw))) throw new Error('Současné heslo nesedí');
      const { error } = await sb.auth.updateUser({ password: newPw });
      if (error) throw new Error(/should be different/i.test(error.message) ? 'Nové heslo musí být jiné' : /weak|pwned|leaked/i.test(error.message) ? 'Toto heslo se objevilo v únicích dat, zvol jiné' : error.message);
      try { check(await sb.rpc('hub_password_changed')); } catch {}
      try { await sb.rpc('hub_log', { p_action: 'password_changed', p_detail: {} }); } catch {}
      await loadUsers();
      toast('Heslo změněno ✓'); e.target.reset();
      location.hash = '#/nabidky';
    } catch (err) { toast(err.message, true); }
    btn.disabled = false; btn.textContent = 'Změnit heslo';
  };
  $('#outAll').onclick = async () => {
    if (!(await confirmBox('Odhlásit ze všech zařízení?', 'Odhlásíš se všude, i tady. Pak se přihlásíš znovu heslem a kódem.', { ok: 'Odhlásit všude', danger: true }))) return;
    logout('Byl(a) jsi odhlášen(a) ze všech zařízení.', 'global');
  };
  if (me.role === 'admin') drawAdmin();
}
async function drawAdmin() {
  const me = S.me;
  let sec = [];
  try { sec = (await adminCall({ action: 'list' })).users || []; } catch (err) { $('#usersBox').innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  const info = id => sec.find(x => x.id === id) || {};
  $('#usersBox').innerHTML = `<div class="ulist">${S.users.map(u => { const s = info(u.id); return `<div class="urow">
      <span class="av lg">${initials(u.id)}</span>
      <div class="grow" style="min-width:0"><b>${esc(u.name)}</b>${u.role === 'admin' ? ' <span class="tag blue">správce</span>' : ''}${u.active ? '' : ' <span class="tag grey">zablokovaný</span>'}
        <div class="muted small">${esc(u.email)} · ${s.last_sign_in_at ? 'naposledy ' + ago(s.last_sign_in_at) : 'zatím se nepřihlásil(a)'}</div>
        <div class="small" style="margin-top:3px">${s.mfa ? '<span class="mg ok">2FA zapnuto</span>' : '<span class="mg warn">2FA zatím nenastaveno</span>'}${u.must_change ? ' <span class="mg warn">čeká na změnu hesla</span>' : ''}</div></div>
      ${u.id !== me.id ? `<div class="uacts"><button class="btn sm" data-a="reset" data-id="${u.id}">Nové heslo</button><button class="btn sm" data-a="reset_mfa" data-id="${u.id}" ${s.mfa ? '' : 'disabled'}>Reset 2FA</button><button class="btn sm" data-a="signout" data-id="${u.id}">Odhlásit všude</button><button class="btn sm ${u.active ? 'danger' : ''}" data-a="active" data-v="${u.active ? '0' : '1'}" data-id="${u.id}">${u.active ? 'Zablokovat' : 'Povolit'}</button></div>` : '<span class="muted small">to jsi ty</span>'}
    </div>`; }).join('')}</div>
    <form id="addUser" class="form" style="margin-top:16px">
      <div><label for="au-name">Jméno a příjmení</label><input id="au-name" name="name" required placeholder="Pavel Hadraba"></div>
      <div><label for="au-email">Přihlašovací e-mail</label><input id="au-email" name="email" type="email" required placeholder="hadraba.p@vinylor.cz"></div>
      <div><button class="btn primary">＋ Přidat uživatele</button></div>
    </form>
    <div class="hint">Nový uživatel dostane dočasné heslo (ukáže se jen jednou). Při prvním přihlášení si nastaví vlastní heslo a 2FA.</div>`;
  $$('#usersBox [data-a]').forEach(b => b.onclick = async () => {
    const id = b.dataset.id, who = userName(id), a = b.dataset.a;
    const texts = {
      reset: ['Nové heslo', `Vygenerovat nové dočasné heslo pro ${who}? Staré přestane platit a ${who} se odhlásí ze všech zařízení.`, 'Vygenerovat', false],
      reset_mfa: ['Reset dvoufázového ověření', `${who} si při dalším přihlášení nastaví 2FA znovu (např. na novém telefonu). Odhlásí se ze všech zařízení.`, 'Resetovat 2FA', true],
      signout: ['Odhlásit ze všech zařízení', `${who} se odhlásí na všech zařízeních.`, 'Odhlásit', false],
      active: b.dataset.v === '1' ? ['Povolit přístup', `Povolit přístup pro ${who}?`, 'Povolit', false] : ['Zablokovat přístup', `${who} se už nepřihlásí a hned se odhlásí. Data zůstanou zachovaná.`, 'Zablokovat', true],
    }[a];
    if (!(await confirmBox(texts[0], texts[1], { ok: texts[2], danger: texts[3] }))) return;
    try {
      const r = await adminCall({ action: a, id, active: b.dataset.v === '1' });
      if (r.password) await passwordBox(who, r.password); else toast('Hotovo ✓');
      await loadUsers(); drawAdmin();
    } catch (err) { toast(err.message, true); }
  });
  $('#addUser').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try {
      const r = await adminCall({ action: 'create', name: f.get('name'), email: f.get('email') });
      await passwordBox(f.get('name'), r.password); await loadUsers(); drawAdmin();
    } catch (err) { toast(err.message, true); }
  };
  // bezpečnostní deník
  const LOG = { login: 'přihlášení heslem', mfa_verified: 'ověřeno kódem 2FA', mfa_enrolled: 'nastavil(a) 2FA', logout: 'odhlášení', password_changed: 'změnil(a) heslo',
    user_created: 'založil(a) účet', password_reset: 'vygeneroval(a) nové heslo', mfa_reset: 'resetoval(a) 2FA', signed_out_everywhere: 'odhlásil(a) ze všech zařízení', user_blocked: 'zablokoval(a)', user_unblocked: 'povolil(a)', shoptet_stock_in: 'naskladnil(a) do Shoptetu', shoptet_order_create: 'založil(a) objednávku ve Shoptetu' };
  try {
    const rows = check(await sb.from('hub_audit').select('*').order('at', { ascending: false }).limit(60));
    $('#auditBox').innerHTML = rows.length ? `<div class="timeline audit">${rows.map(r => `<div><b>${esc(userName(r.actor) || '—')}</b> ${esc(LOG[r.action] || r.action)}${r.target ? ` → <b>${esc(userName(r.target) || 'účet')}</b>` : ''}${r.detail?.scope === 'global' ? ' (všude)' : ''}${r.action === 'shoptet_stock_in' ? ` (${r.detail?.ok ?? 0} ok${r.detail?.failed ? ', ' + r.detail.failed + ' chyb' : ''})` : ''}<br>${czDateTime(r.at)}${r.detail?.ua ? ` · <span title="${esc(r.detail.ua)}">${esc(/iPhone|Android/i.test(r.detail.ua) ? 'telefon' : 'počítač')}</span>` : ''}${r.detail?.ver ? ` · v${esc(r.detail.ver)}` : ''}</div>`).join('')}</div>` : '<div class="muted small">Zatím žádné události.</div>';
  } catch (err) { $('#auditBox').innerHTML = `<p class="err">${esc(err.message)}</p>`; }
}

// =====================================================================
// NASKLADNĚNÍ — příjemky od dodavatelů → naskladnění do Shoptetu
// =====================================================================
const STOCK_COLS = 'id,doc_no,supplier,date,currency,rate,transport_pct,items,note,total_czk,item_count,stocked_count,imported,created_by,last_edit_by,version,created_at,updated_at';
const SK = { receipts: [], svozy: [], q: '', filter: ls.get('vh_sk_filter') || '' };
const rcFromRow = r => ({
  id: r.id, docNo: r.doc_no || '', supplier: r.supplier || '', date: r.date, currency: r.currency, rate: Number(r.rate), transportPct: Number(r.transport_pct),
  items: r.items || [], note: r.note || '', imported: r.imported, createdBy: r.created_by, lastEditBy: r.last_edit_by, version: r.version,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
// cenu jde psát i jako výpočet: „5,8*4,2“, „12,46 + 1,2“
function evalPrice(v) {
  const t = String(v ?? '').replace(/\s/g, '').replace(/,/g, '.');
  if (!t || !/^[\d.+\-*/()]+$/.test(t)) return null;
  // jednoduchý výpočet + − × ÷ a závorky (bez eval)
  let i = 0;
  const num = () => { const m = t.slice(i).match(/^\d+(\.\d+)?|^\.\d+/); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); };
  const atom = () => { if (t[i] === '-') { i++; return -atom(); } if (t[i] === '(') { i++; const x = expr(); if (t[i++] !== ')') throw 0; return x; } return num(); };
  const term = () => { let x = atom(); while (t[i] === '*' || t[i] === '/') { const o = t[i++]; const y = atom(); x = o === '*' ? x * y : x / y; } return x; };
  const expr = () => { let x = term(); while (t[i] === '+' || t[i] === '-') { const o = t[i++]; const y = term(); x = o === '+' ? x + y : x - y; } return x; };
  try { const n = expr(); return i === t.length && Number.isFinite(n) ? Calc.r2(n * 10000) / 10000 : null; } catch { return null; }
}
const curSign = c => ({ CZK: 'Kč', USD: '$' })[c] || '€';
const isFx = c => c !== 'CZK';
const defRate = c => Number(c === 'USD' ? cfg().stockRateUsd : cfg().stockRate) || (c === 'USD' ? 21.5 : 24.2);
function stockLine(it, rc) {
  const vat = 21;
  const price = evalPrice(it.priceInput);
  const qty = toNum(it.qty);
  const rate = !isFx(rc.currency) ? 1 : Number(rc.rate) || 0;
  const unitCost = price == null ? null : price * (1 + (Number(rc.transportPct) || 0) / 100) * rate; // Kč bez DPH
  const sellVat = it.sellPriceVat == null || it.sellPriceVat === '' ? null : toNum(it.sellPriceVat);
  const sellNet = sellVat == null ? null : sellVat / (1 + vat / 100);
  const margin = unitCost != null && sellNet ? sellNet - unitCost : null;
  const marginPct = margin != null && sellNet ? (margin / sellNet) * 100 : null;
  return { price, qty, unitCost, sellNet, margin, marginPct, totalCost: unitCost == null ? 0 : unitCost * qty, totalCur: price == null ? 0 : price * qty, totalSellNet: sellNet == null ? 0 : sellNet * qty };
}
function stockTotals(rc) {
  let cost = 0, cur = 0, sell = 0, stocked = 0, costForMargin = 0;
  const lines = rc.items.map(it => {
    const l = stockLine(it, rc);
    cost += l.totalCost; cur += l.totalCur;
    if (l.sellNet != null && l.unitCost != null) { sell += l.totalSellNet; costForMargin += l.totalCost; }
    if (it.stocked) stocked++;
    return l;
  });
  const margin = sell - costForMargin;
  return { lines, cost: Calc.r2(cost), cur: Calc.r2(cur), sell: Calc.r2(sell), margin: Calc.r2(margin), marginPct: sell ? (margin / sell) * 100 : null, stocked, count: rc.items.length };
}
const marginCls = p => { const st = S.settings?.data || {}; if (p == null) return 'na'; if (p < (Number(st.marginBad) || 15)) return 'bad'; if (p < (Number(st.marginWarn) || 25)) return 'warn'; return 'ok'; };
const pct = p => (p == null ? '—' : `${numStr(Math.round(p * 10) / 10)} %`);
const rcStatus = rc => { const n = rc.item_count ?? rc.items.length, d = rc.stocked_count ?? rc.items.filter(i => i.stocked).length; return !n ? 'empty' : d >= n ? 'done' : d ? 'part' : 'open'; };
const RC_STATUS = { empty: 'Prázdná', open: 'K naskladnění', part: 'Částečně', done: 'Naskladněno' };

// paměť nákupních cen z dřívějších příjemek
function lengthOf(s) { const m = String(s || '').match(/(\d+(?:[.,]\d+)?)\s*m\b(?!m)/i); return m ? toNum(m[1]) : null; }
const familyKey = (name, supplier) => fold(String(name || '').replace(/\(?\d+(?:[.,]\d+)?\s*m\)?(?!m)/gi, '').replace(/\s+/g, ' ').trim()) + '|' + fold(supplier);
function priceMemory(excludeId) {
  const byCode = new Map(), byFamily = new Map();
  const list = [...SK.receipts].filter(r => r.id !== excludeId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const rc of list) for (const it of rc.items) {
    if (!it.priceInput || evalPrice(it.priceInput) == null) continue;
    const rec = { priceInput: it.priceInput, price: evalPrice(it.priceInput), supplier: rc.supplier, currency: rc.currency, date: rc.date, doc: rc.docNo };
    if (it.code) byCode.set(it.code, rec);
    const f = String(it.priceInput).replace(/\s/g, '').match(/^(\d+(?:[.,]\d+)?)\*(\d+(?:[.,]\d+)?)$/);
    if (f) byFamily.set(familyKey(it.name, rc.supplier), { base: f[1], supplier: rc.supplier, currency: rc.currency });
  }
  return { byCode, byFamily };
}
function predictPrice(p, supplier, mem, cur) {
  const c = mem.byCode.get(p.code);
  if (c && cur && c.currency !== cur) return { priceInput: '', src: `⚠ dříve ${c.priceInput} ${curSign(c.currency)} (jiná měna) — zadej cenu v ${curSign(cur)}` };
  if (c) return { priceInput: c.priceInput, src: `naposledy ${czDate(c.date)}${c.doc ? ' · ' + c.doc : ''}` };
  const len = lengthOf(p.variant) || lengthOf(p.name);
  const fam = len && mem.byFamily.get(familyKey(p.name, supplier || p.supplier));
  if (fam && (!cur || fam.currency === cur)) return { priceInput: `${fam.base}*${numStr(len)}`, src: `odhad: ${fam.base} ${curSign(fam.currency)}/m × ${numStr(len)} m` };
  return null;
}

// ---------- seznam příjemek ----------
async function loadReceipts() {
  const rows = await fetchAll(() => sb.from('stock_receipts').select(STOCK_COLS).eq('deleted', false).order('created_at', { ascending: false }));
  SK.receipts = rows.map(r => ({ ...rcFromRow(r), item_count: r.item_count, stocked_count: r.stocked_count, total_czk: Number(r.total_czk) }));
  // svozy z OrderJoi (doručené a naskladněné) se ukazují mezi příjemkami
  const [sh, au] = await Promise.all([
    fetchAll(() => sb.from('oj_shipments').select('id,reference,title,note,status,delivered_at,stocked_at,created_at,lines').eq('deleted', false).in('status', ['arrived', 'stocked']).order('created_at', { ascending: false })),
    fetchAll(() => sb.from('oj_aufs').select('id,shipment_id,amount_eur').not('shipment_id', 'is', null)),
  ]);
  SK.svozy = sh.map(x => { const ls_ = (x.lines || []).filter(l => !l.skip); return {
    svoz: true, id: x.id, docNo: x.reference || x.title, supplier: x.note || 'Svoz', date: ymd(new Date(x.stocked_at || x.delivered_at || x.created_at)),
    item_count: ls_.length, stocked_count: ls_.filter(l => l.stocked).length, eur: au.filter(a => a.shipment_id === x.id).reduce((t, a) => t + Number(a.amount_eur || 0), 0),
    items: ls_.map(l => ({ code: l.code, name: l.name })), note: '', }; });
}
async function newReceipt(prefill = {}) {
  const st = cfg();
  const row = check(await sb.from('stock_receipts').insert({
    created_by: S.me.id, last_edit_by: S.me.id, currency: 'EUR', rate: Number(st.stockRate) || 24.2, transport_pct: Number(st.stockTransportPct) ?? 10,
    date: ymd(new Date()), ...prefill,
  }).select('id').single());
  location.hash = '#/s/' + row.id;
}
async function renderStock() {
  shell('stock', `<div class="topbar"><h1>Naskladnění</h1></div><div class="panel panel-b"><div class="sk" style="height:220px"></div></div>`);
  try { await Promise.all([loadReceipts(), loadSettings()]); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const main = $('#main');
  main.innerHTML = `
  ${pgHead('stock', 'Naskladnění', 'Příjemky zboží, ceny a odeslání stavu do Shoptetu.', `<div class="search pg-search"><span class="ic">⌕</span><input id="rq" placeholder="Hledat doklad, dodavatele, kód…" value="${esc(SK.q)}"></div><button class="btn primary of-new" id="newRc">＋ Nová příjemka</button>`)}
  ${stockTabs('rc')}
  <div id="skStats"></div>
  <div class="chips" style="margin-bottom:12px" id="rcf">
    ${[['', 'Vše'], ['todo', 'K naskladnění'], ['done', 'Naskladněno']].map(([k, l]) => `<button class="chip ${SK.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}
  </div>
  <div id="rcList"></div>`;
  main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
  $('#newRc').onclick = async e => { const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span> Zakládám…'; try { await newReceipt(); } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = '＋ Nová příjemka'; } };
  $('#rq').oninput = e => { SK.q = e.target.value; drawReceipts(); };
  $$('#rcf .chip').forEach(c => c.onclick = () => { SK.filter = c.dataset.f; ls.set('vh_sk_filter', SK.filter); $$('#rcf .chip').forEach(x => x.classList.toggle('on', x === c)); drawReceipts(); });
  bindStockTabs();
  drawStockStats(); drawReceipts();
}
function drawStockStats() {
  const month = ymd(new Date()).slice(0, 7);
  const thisMonth = SK.receipts.filter(r => String(r.date).slice(0, 7) === month);
  const todo = [...SK.receipts, ...SK.svozy].filter(r => ['open', 'part'].includes(rcStatus(r)));
  const todoItems = todo.reduce((a, r) => a + (r.item_count - r.stocked_count), 0);
  let sell = 0, cost = 0;
  for (const r of SK.receipts) { const t = stockTotals(r); sell += t.sell; cost += t.sell ? t.cost : 0; }
  $('#skStats').innerHTML = `<div class="stats">
    <div class="panel stat" style="--c:var(--s-postponed)"><div class="k">Čeká na naskladnění</div><div class="v">${todoItems}</div><div class="s">${todo.length} dokladů s nenaskladněnými položkami</div></div>
    <div class="panel stat" style="--c:var(--s-sent)"><div class="k">Nakoupeno tento měsíc</div><div class="v" data-n="${thisMonth.reduce((a, r) => a + r.total_czk, 0)}">0 Kč</div><div class="s">${thisMonth.length} příjemek, bez DPH</div></div>
    <div class="panel stat" style="--c:var(--brand)"><div class="k">Průměrná marže</div><div class="v">${pct(sell ? ((sell - cost) / sell) * 100 : null)}</div><div class="s">ze všech příjemek, bez DPH</div></div>
    <div class="panel stat" style="--c:var(--s-confirmed)"><div class="k">Příjemek celkem</div><div class="v">${SK.receipts.length}</div><div class="s">${SK.receipts.reduce((a, r) => a + r.item_count, 0)} položek</div></div>
  </div>`;
  $$('#skStats [data-n]').forEach(v => tween(v, Number(v.dataset.n), n => M(n).replace(/,\d\d$/, '') + ' Kč'));
}
function drawReceipts() {
  const q = fold(SK.q).trim();
  const list = [...SK.receipts, ...SK.svozy].sort((a, b) => String(b.date).localeCompare(String(a.date))).filter(r => {
    const s = rcStatus(r);
    if (SK.filter === 'todo' && !['open', 'part'].includes(s)) return false;
    if (SK.filter === 'done' && s !== 'done') return false;
    if (!q) return true;
    return fold([r.docNo, r.supplier, r.note, ...r.items.map(i => i.code + ' ' + i.name)].join(' ')).includes(q);
  });
  const el = $('#rcList');
  if (!SK.receipts.length) {
    el.innerHTML = `<div class="panel empty-big"><div class="ill">📦</div><h3>Zatím žádné příjemky</h3><p>Založ první příjemku — produkty se doplní z e-shopu, nákupní ceny z minula.</p><button class="btn primary lg" id="firstRc">＋ Nová příjemka</button></div>`;
    $('#firstRc').onclick = () => $('#newRc').click();
    return;
  }
  el.innerHTML = `<div class="panel" style="overflow-x:auto"><table class="list rc-list">
    <thead><tr><th>Doklad</th><th>Dodavatel</th><th>Datum</th><th>Naskladněno</th><th class="r">Náklad</th><th class="r">Marže</th></tr></thead>
    <tbody>${list.map((r, i) => {
      const s = rcStatus(r); const p = r.item_count ? Math.round(100 * r.stocked_count / r.item_count) : 0;
      if (r.svoz) return `<tr class="click" data-svoz="${r.id}" style="animation-delay:${Math.min(i, 20) * 15}ms">
        <td class="nowrap"><b>${highlight(r.docNo || 'svoz', SK.q)}</b> <span class="tag blue" title="Svoz z OrderJoi">svoz</span></td>
        <td>${highlight(r.supplier || '—', SK.q)}<div class="muted small">${r.item_count} položek · EUR</div></td>
        <td class="nowrap">${czDate(r.date)}</td>
        <td class="nowrap"><div class="prog" data-st="${s}"><i style="width:${p}%"></i></div><span class="small muted">${r.stocked_count}/${r.item_count} · ${RC_STATUS[s]}</span></td>
        <td class="r nowrap num-t">${r.eur ? r.eur.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : '—'}</td><td class="r muted">—</td></tr>`;
      const t = stockTotals(r);
      return `<tr class="click" data-id="${r.id}" style="animation-delay:${Math.min(i, 20) * 15}ms">
        <td class="nowrap"><b>${highlight(r.docNo || 'bez čísla', SK.q)}</b>${r.imported ? ' <span class="tag grey" title="Importováno z Excelu">import</span>' : ''}</td>
        <td>${highlight(r.supplier || '—', SK.q)}<div class="muted small">${r.item_count} položek · ${r.currency}</div></td>
        <td class="nowrap">${czDate(r.date)}</td>
        <td class="nowrap"><div class="prog" data-st="${s}"><i style="width:${p}%"></i></div><span class="small muted">${r.stocked_count}/${r.item_count} · ${RC_STATUS[s]}</span></td>
        <td class="r nowrap num-t">${M(t.cost)} Kč</td>
        <td class="r nowrap"><span class="mg ${marginCls(t.marginPct)}">${pct(t.marginPct)}</span></td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">Nic nenalezeno</td></tr>'}</tbody></table></div>`;
  $$('tr.click', el).forEach(r => r.onclick = () => { location.hash = r.dataset.svoz ? '#/svoz/' + r.dataset.svoz : '#/s/' + r.dataset.id; });
}

// ---------- editor příjemky ----------
async function renderReceipt(id) {
  shell('stock', editorSkeleton());
  let rc;
  try {
    const [row] = await Promise.all([
      sb.from('stock_receipts').select(STOCK_COLS).eq('id', id).eq('deleted', false).single().then(check),
      SK.receipts.length ? null : loadReceipts(),
      loadSettings(),
    ]);
    rc = rcFromRow(row);
  } catch (e) { $('#main').innerHTML = `<div class="panel empty-big"><div class="ill">🔍</div><h3>Příjemku se nepodařilo otevřít</h3><p>${esc(e.message)}</p><a class="btn" href="#/sklad">← Zpět</a></div>`; return; }
  loadProducts().catch(e => toast('Produkty: ' + e.message, true));
  const mem = priceMemory(rc.id);
  const E = { dirty: false, saving: null, timer: null };
  const suppliers = [...new Set([...SK.receipts.map(r => r.supplier), ...(S.products || []).map(p => p.supplier)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'cs'));

  $('#main').innerHTML = `
  <div class="ed-top" id="edTop"><div class="topbar">
    <a class="btn ghost" href="#/sklad" title="Zpět na příjemky">←</a>
    <h1>Příjemka <span id="rcTitle">${esc(rc.docNo || 'bez čísla')}</span></h1>
    <span id="rcBadge"></span>
    <span class="save" id="saveState">Uloženo</span>
    <span class="grow"></span>
    <button class="btn" id="pasteRows" title="Vložit řádky zkopírované z Excelu nebo faktury">📋 <span class="hide-xs">Vložit z tabulky</span></button>
    <button class="btn ghost danger" id="rcDel" title="Smazat příjemku">🗑</button>
  </div></div>
  <section class="panel">
    <div class="panel-h"><span class="step" id="rstep1">1</span>Doklad <span class="sub">— od koho a za jakých podmínek</span></div>
    <div class="panel-b rc-head">
      <div><label>Číslo dokladu</label><input data-r="docNo" value="${esc(rc.docNo)}" placeholder="např. AR00546325"></div>
      <div><label>Dodavatel</label><input data-r="supplier" list="supList" value="${esc(rc.supplier)}" placeholder="Gunreben, MEFO…"><datalist id="supList">${suppliers.map(s => `<option value="${esc(s)}">`).join('')}</datalist></div>
      <div><label>Datum</label><input type="date" data-r="date" value="${esc(rc.date)}"></div>
      <div><label>Měna nákupu</label><div class="seg" id="curSeg" style="width:100%"><button data-c="EUR" style="flex:1">EUR €</button><button data-c="USD" style="flex:1">USD $</button><button data-c="CZK" style="flex:1">CZK Kč</button></div></div>
      <div id="rateBox"><label id="rateLbl">Kurz ${rc.currency === 'CZK' ? 'EUR' : rc.currency}/CZK</label><div class="row" style="flex-wrap:nowrap;gap:6px"><input data-r="rate" inputmode="decimal" value="${esc(numStr(rc.rate))}"><button class="btn sm" id="cnb" title="Načíst kurz ČNB ke dni dokladu">ČNB</button></div></div>
      <div><label>Doprava</label><div class="fld"><input data-r="transportPct" inputmode="decimal" value="${esc(numStr(rc.transportPct))}"><span class="suf">%</span></div></div>
      <div class="full"><label>Poznámka</label><input data-r="note" value="${esc(rc.note)}" placeholder="nepovinné"></div>
    </div>
  </section>

  <section class="panel" style="margin-top:18px">
    <div class="panel-h"><span class="step" id="rstep2">2</span>Položky <span class="sub">— začni psát kód nebo název, zbytek se doplní</span></div>
    <div class="panel-b">
      <div class="row">
        <div class="search big grow"><span class="ic">⌕</span><input id="sq" placeholder="Kód nebo název produktu, např. WPCG-09 nebo „light brown 4,8“" autocomplete="off"><div class="results" id="sr" hidden></div></div>
        <button class="btn" id="addFree" title="Položka, která není v e-shopu">＋ Mimo e-shop</button>
      </div>
      <div class="hint">Nákupní cenu jde napsat i jako výpočet, např. <kbd>5,8*4,2</kbd> (cena za metr × délka). <kbd>Enter</kbd> v počtu kusů = zpět na hledání.</div>
      <div id="rcItems"></div>
    </div>
  </section>`;
  const bar = document.createElement('div');
  bar.className = 'sumbar';
  bar.innerHTML = `
    <div class="m hide-m"><span>Hodnota <span id="sbCur">EUR</span></span><b id="sbVal" class="num-t">0</b></div>
    <div class="m"><span>Náklad bez DPH</span><b id="sbCost" class="num-t">0 Kč</b></div>
    <div class="m hide-m"><span>Prodej bez DPH</span><b id="sbSell" class="num-t">0 Kč</b></div>
    <div class="m tot"><span>Marže</span><b id="sbMargin" class="num-t">—</b></div>
    <span class="grow"></span>
    <div class="m hide-m"><span>Naskladněno</span><b id="sbStock">0/0</b></div>
    <button class="btn hide-m" id="exportCsv" title="Stáhnout CSV (kód; počet; nákupní cena)">⬇ <span class="hide-xs">CSV</span></button>
    <button class="btn" id="copyStock" title="Zkopíruje kódy a počty pro ruční zápis">📋 <span class="hide-xs">Kopírovat</span></button>
    <button class="btn primary" id="pushShoptet" title="Přidá položky do skladu ve Shoptetu">⬆ <span class="hide-xs">Naskladnit do Shoptetu</span></button>`;
  document.body.appendChild(bar);
  const onScroll = () => $('#edTop')?.classList.toggle('scrolled', scrollY > 4);
  addEventListener('scroll', onScroll, { passive: true });

  // --- hlavička dokladu ---
  function drawHead() {
    $$('#curSeg button').forEach(b => b.classList.toggle('on', b.dataset.c === rc.currency));
    $('#rateBox').style.visibility = isFx(rc.currency) ? '' : 'hidden'; $('#rateLbl').textContent = 'Kurz ' + rc.currency + '/CZK';
    $('#rstep1').classList.toggle('done', !!(rc.docNo && rc.supplier)); $('#rstep1').textContent = rc.docNo && rc.supplier ? '✓' : '1';
    $('#rcTitle').textContent = rc.docNo || 'bez čísla';
  }
  $('#curSeg').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; const prev = rc.currency; rc.currency = b.dataset.c; if (rc.currency === 'CZK') rc.transportPct = 0;
    if (isFx(rc.currency) && prev !== rc.currency) { rc.rate = defRate(rc.currency); const ri = $('[data-r="rate"]'); if (ri) ri.value = numStr(rc.rate); loadCnb(true); } $('[data-r="transportPct"]').value = numStr(rc.transportPct); drawHead(); drawItems(); markDirty(); };
  $('#main').addEventListener('input', e => {
    const k = e.target.dataset.r; if (!k) return;
    rc[k] = ['rate', 'transportPct'].includes(k) ? toNum(e.target.value) : e.target.value;
    drawHead(); if (['rate', 'transportPct'].includes(k)) refreshAll(); markDirty();
  });
  async function loadCnb(silent) {
    const b = $('#cnb'); b.disabled = true; b.innerHTML = '<span class="spin"></span>';
    try {
      const { data, error } = await sb.functions.invoke('hub-cnb-rate', { body: { currency: rc.currency === 'CZK' ? 'EUR' : rc.currency, date: rc.date } });
      if (error || !data?.rate) throw new Error(data?.error || error?.message || 'kurz nenalezen');
      rc.rate = Calc.r2(data.rate * 1000) / 1000;
      const i = $('[data-r="rate"]'); i.value = numStr(rc.rate); i.classList.remove('filled'); void i.offsetWidth; i.classList.add('filled');
      refreshAll(); markDirty();
      if (!silent) toast(`Kurz ČNB ${numStr(rc.rate)} Kč/${curSign(rc.currency)} (platný ${czDate(data.validFor)})`);
    } catch (err) { if (!silent) toast('ČNB: ' + err.message, true); }
    b.disabled = false; b.textContent = 'ČNB';
  }
  $('#cnb').onclick = () => loadCnb(false);

  // --- položky ---
  const open = new Set();
  function itemRow(it, n, isNew) {
    const l = stockLine(it, rc);
    const sub = [it.code, it.variant].filter(Boolean).map(esc).join(' · ');
    const cs = curSign(rc.currency);
    return `<div class="si${isNew ? ' new' : ''}${it.stocked ? ' stocked' : ''}" data-id="${it.id}">
      <label class="si-chk" title="Naskladněno v Shoptetu"><input type="checkbox" data-k="stocked" ${it.stocked ? 'checked' : ''}><span></span></label>
      <div class="si-info">
        <div class="it-name"><span class="si-n">${n}.</span> ${esc(it.name) || '<span class="muted">Bez názvu</span>'}</div>
        <div class="it-sub">${sub}${it.priceSrc ? ` <span class="tag blue" title="Nákupní cena předvyplněna">${esc(it.priceSrc)}</span>` : ''}${it.shoptetSent ? ` <span class="tag ok" title="Odesláno do Shoptetu ${it.shoptetAt ? esc(czDateTime(it.shoptetAt)) : ''}">ve Shoptetu ✓</span>` : ''}</div>
      </div>
      <div class="si-f" data-l="Nákup / ks bez DPH"><div class="fld"><input data-k="priceInput" inputmode="decimal" value="${esc(it.priceInput || '')}" placeholder="cena" class="${it.priceInput && l.price == null ? 'bad' : ''}"><span class="suf">${cs}</span></div>
        <small class="muted" data-o="calc">${it.priceInput && /[*/+]/.test(it.priceInput) && l.price != null ? '= ' + numStr(Calc.r2(l.price * 100) / 100) + ' ' + cs : ''}</small></div>
      <div class="si-f" data-l="Počet"><input data-k="qty" inputmode="decimal" value="${esc(numStr(it.qty))}" class="num"></div>
      <div class="si-f si-cost" data-l="Náklad / ks"><b data-o="unit">${l.unitCost == null ? '—' : M(l.unitCost) + ' Kč'}</b><small class="muted" data-o="tot">${l.unitCost == null ? '' : 'celkem ' + M(l.totalCost) + ' Kč'}</small></div>
      <div class="si-f" data-l="Prodej s DPH"><div class="fld"><input data-k="sellPriceVat" inputmode="decimal" value="${esc(it.sellPriceVat == null ? '' : numStr(it.sellPriceVat))}" placeholder="—"><span class="suf">Kč</span></div><small class="muted" data-o="eshop">${eshopNote(it)}</small></div>
      <div class="si-f si-m" data-l="Marže"><span class="mg ${marginCls(l.marginPct)}" data-o="mpct">${pct(l.marginPct)}</span><small class="muted" data-o="mk">${l.margin == null ? '' : M(l.margin) + ' Kč/ks'}</small></div>
      <button class="ib del" data-a="rm" title="Odebrat">✕</button>
    </div>`;
  }
  function eshopNote(it) {
    const p = S.products && it.code ? S.products.find(x => x.code === it.code) : null;
    if (!p) return it.code ? '' : 'mimo e-shop';
    return Math.abs(p.priceVat - toNum(it.sellPriceVat)) > 0.5 ? `<span class="warn-t">v e-shopu ${M(p.priceVat)}</span>` : 'jako v e-shopu';
  }
  function drawItems(newId) {
    $('#rcItems').innerHTML = rc.items.length
      ? `<div class="si-head"><span></span><span>Produkt</span><span>Nákup/ks</span><span>Počet</span><span>Náklad/ks</span><span>Prodej s DPH</span><span>Marže</span><span></span></div>
         <div class="items">${rc.items.map((it, i) => itemRow(it, i + 1, it.id === newId)).join('')}</div>
         <div class="items-foot"><button class="btn sm" id="allStocked">✓ Označit vše jako naskladněné</button><span class="small muted">Zaškrtni položku, až ji naskladníš v Shoptetu.</span></div>`
      : `<div class="items-empty" style="margin-top:12px"><b>Zatím žádné položky</b>Napiš kód nebo kus názvu do vyhledávání výše — název, varianta, prodejní cena i poslední nákupní cena se doplní samy.</div>`;
    const all = $('#allStocked');
    if (all) all.onclick = () => { const on = rc.items.some(i => !i.stocked); rc.items.forEach(i => { i.stocked = on; }); drawItems(); markDirty(); toast(on ? 'Vše označeno jako naskladněné ✓' : 'Označení zrušeno'); };
    drawTotals();
  }
  function updateRow(it) {
    const row = $(`.si[data-id="${it.id}"]`); if (!row) return;
    const l = stockLine(it, rc); const cs = curSign(rc.currency);
    $('[data-o="unit"]', row).textContent = l.unitCost == null ? '—' : M(l.unitCost) + ' Kč';
    $('[data-o="tot"]', row).textContent = l.unitCost == null ? '' : 'celkem ' + M(l.totalCost) + ' Kč';
    $('[data-o="calc"]', row).textContent = it.priceInput && /[*/+]/.test(it.priceInput) && l.price != null ? '= ' + numStr(Calc.r2(l.price * 100) / 100) + ' ' + cs : '';
    $('[data-k="priceInput"]', row).classList.toggle('bad', !!it.priceInput && l.price == null);
    const mp = $('[data-o="mpct"]', row); mp.textContent = pct(l.marginPct); mp.className = 'mg ' + marginCls(l.marginPct);
    $('[data-o="mk"]', row).textContent = l.margin == null ? '' : M(l.margin) + ' Kč/ks';
    $('[data-o="eshop"]', row).innerHTML = eshopNote(it);
    row.classList.toggle('stocked', !!it.stocked);
    drawTotals();
  }
  function refreshAll() { rc.items.forEach(updateRow); drawTotals(); }
  function drawTotals() {
    const t = stockTotals(rc);
    $('#sbCur').textContent = rc.currency;
    $('#sbVal').textContent = M(t.cur) + ' ' + curSign(rc.currency);
    tween($('#sbCost'), t.cost, n => M(n) + ' Kč');
    $('#sbSell').textContent = M(t.sell) + ' Kč';
    const mEl = $('#sbMargin'); mEl.textContent = t.marginPct == null ? '—' : `${pct(t.marginPct)} · ${M(t.margin).replace(/,\d\d$/, '')} Kč`;
    mEl.className = 'num-t mg-t ' + marginCls(t.marginPct);
    $('#sbStock').textContent = `${t.stocked}/${t.count}`;
    const s = !t.count ? 'empty' : t.stocked >= t.count ? 'done' : t.stocked ? 'part' : 'open';
    $('#rcBadge').innerHTML = `<span class="st" data-s="${{ empty: 'draft', open: 'postponed', part: 'sent', done: 'confirmed' }[s]}">${RC_STATUS[s]}</span>`;
    $('#rstep2').classList.toggle('done', t.count > 0); $('#rstep2').textContent = t.count ? '✓' : '2';
  }
  const numKeys = ['qty', 'sellPriceVat'];
  $('#rcItems').addEventListener('input', e => {
    const row = e.target.closest('.si'); const k = e.target.dataset.k; if (!row || !k) return;
    const it = rc.items.find(x => x.id === row.dataset.id);
    if (k === 'stocked') it.stocked = e.target.checked;
    else if (k === 'sellPriceVat') it.sellPriceVat = e.target.value.trim() === '' ? null : toNum(e.target.value);
    else it[k] = numKeys.includes(k) ? toNum(e.target.value) : e.target.value;
    if (k === 'priceInput') { it.price = evalPrice(it.priceInput); delete it.priceSrc; }
    updateRow(it); markDirty();
  });
  $('#rcItems').addEventListener('change', e => { if (e.target.dataset.k === 'stocked') { const it = rc.items.find(x => x.id === e.target.closest('.si').dataset.id); if (it.stocked) toast(`${it.code || it.name} naskladněno ✓`); } });
  $('#rcItems').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.k === 'qty') { e.preventDefault(); $('#sq').focus(); }
    if (e.key === 'Enter' && e.target.dataset.k === 'priceInput') { e.preventDefault(); $('[data-k="qty"]', e.target.closest('.si')).select(); }
  });
  $('#rcItems').addEventListener('click', e => {
    const b = e.target.closest('button[data-a="rm"]'); if (!b) return;
    const row = b.closest('.si'); const i = rc.items.findIndex(x => x.id === row.dataset.id); const it = rc.items[i];
    row.classList.add('out');
    setTimeout(() => {
      rc.items.splice(i, 1); drawItems(); markDirty();
      toast(`Odebráno: ${it.code || it.name}`, { action: { label: 'Vrátit', fn: () => { rc.items.splice(Math.min(i, rc.items.length), 0, it); drawItems(it.id); markDirty(); } } });
    }, 200);
  });
  const rid = () => crypto.randomUUID().slice(0, 12);
  function addProduct(p, qty) {
    const pred = p ? predictPrice(p, rc.supplier, mem, rc.currency) : null;
    const it = {
      id: rid(), code: p ? p.code : '', name: p ? p.name : '', variant: p ? p.variant : '',
      priceInput: pred ? pred.priceInput : '', priceSrc: pred ? pred.src : '', qty: qty ?? '', sellPriceVat: p ? p.priceVat : null, stocked: false,
    };
    it.price = evalPrice(it.priceInput);
    if (p && !rc.supplier && p.supplier) { rc.supplier = p.supplier; $('[data-r="supplier"]').value = p.supplier; drawHead(); }
    rc.items.push(it); drawItems(it.id); markDirty();
    return it;
  }
  $('#addFree').onclick = async () => {
    const name = await promptBox('Položka mimo e-shop', 'Název položky', '', { placeholder: 'např. Upevnění rýgle na zděný sloupek', ok: 'Přidat' });
    if (!name) return;
    const it = addProduct(null); it.name = name.trim(); drawItems(it.id);
    $(`.si[data-id="${it.id}"] [data-k="priceInput"]`).focus();
  };

  // našeptávač produktů — produkty zvoleného dodavatele první
  let found = [], sel = 0, timer = null;
  const sq = $('#sq'), sr = $('#sr');
  async function search() {
    const q = sq.value.trim();
    if (q.length < 2) { sr.hidden = true; return; }
    if (!S.products) { sr.hidden = false; sr.innerHTML = '<div class="empty">Načítám produkty…</div>'; await loadProducts(); }
    const sup = fold(rc.supplier);
    found = searchProducts(q, true).sort((a, b) => (sup ? (fold(b.supplier) === sup) - (fold(a.supplier) === sup) : 0) || (b.visible - a.visible)).slice(0, 30);
    sel = 0; draw();
  }
  function draw() {
    const q = sq.value;
    sr.hidden = false;
    sr.innerHTML = found.length ? found.map((p, i) => {
      const pred = predictPrice(p, rc.supplier, mem, rc.currency);
      return `<div class="res ${i === sel ? 'on' : ''}" data-i="${i}">
        <code>${highlight(p.code, q)}</code>
        <div>${highlight(p.name, q)}${p.visible ? '' : '<span class="tag grey">skrytý</span>'}${rc.items.some(x => x.code === p.code) ? '<span class="tag blue">v příjemce</span>' : ''}
          <div class="v">${[p.variant && highlight(p.variant, q), p.supplier && esc(p.supplier), pred && pred.priceInput && `nákup ${esc(pred.priceInput)} ${curSign(rc.currency)}`].filter(Boolean).join(' · ')}</div></div>
        <div class="p">${M(p.priceVat)} Kč</div></div>`;
    }).join('') : '<div class="empty">Nic nenalezeno — přidej položku „Mimo e-shop“</div>';
    $('.res.on', sr)?.scrollIntoView({ block: 'nearest' });
  }
  sq.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 120); });
  sq.addEventListener('keydown', e => {
    if (sr.hidden || !found.length) return;
    if (e.key === 'ArrowDown') { sel = Math.min(found.length - 1, sel + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    if (e.key === 'Escape') sr.hidden = true;
  });
  sr.addEventListener('mousedown', e => { const r = e.target.closest('.res'); if (r) { e.preventDefault(); pick(Number(r.dataset.i)); } });
  sq.addEventListener('blur', () => setTimeout(() => { sr.hidden = true; }, 150));
  function pick(i) {
    const p = found[i]; if (!p) return;
    sr.hidden = true; sq.value = ''; found = [];
    const it = addProduct(p);
    const row = $(`.si[data-id="${it.id}"]`);
    const target = it.priceInput ? $('[data-k="qty"]', row) : $('[data-k="priceInput"]', row);
    target.focus(); target.select?.(); row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // vložení řádků z Excelu / faktury: kód ⇥ počet ⇥ cena
  $('#pasteRows').onclick = async () => {
    const txt = await modal({
      title: 'Vložit řádky z tabulky',
      body: `<p>Zkopíruj z Excelu nebo faktury sloupce <b>kód</b>, <b>počet</b> a volitelně <b>nákupní cenu</b> (v tomto pořadí) a vlož je sem. Produkty se dohledají v e-shopu.</p><textarea class="pin" rows="8" placeholder="WPCG-09-2&#9;12&#9;5,8*3,6&#10;LV059-1&#9;6000&#9;0,3"></textarea>`,
      focus: '.pin', actions: [{ label: 'Zrušit', value: null }, { label: 'Přidat řádky', value: bd => $('.pin', bd).value, cls: 'primary' }],
    });
    if (!txt) return;
    if (!S.products) await loadProducts();
    let ok = 0, miss = [];
    for (const line of txt.split(/\r?\n/)) {
      const cols = line.split(/\t|;/).map(x => x.trim()).filter((x, i) => x || i < 3);
      if (!cols[0]) continue;
      const p = S.products.find(x => fold(x.code) === fold(cols[0]));
      const it = addProduct(p || null, cols[1] ? toNum(cols[1]) : '');
      if (!p) { it.code = cols[0]; it.name = cols[0]; miss.push(cols[0]); }
      if (cols[2]) { it.priceInput = cols[2]; it.price = evalPrice(cols[2]); delete it.priceSrc; }
      ok++;
    }
    drawItems(); markDirty();
    toast(`Přidáno ${ok} řádků${miss.length ? ` · ${miss.length} kódů není v e-shopu: ${miss.slice(0, 3).join(', ')}${miss.length > 3 ? '…' : ''}` : ''}`, miss.length ? { err: false } : {});
  };

  // --- ukládání ---
  function setSave(text, cls = '') { const el = $('#saveState'); if (el) { el.textContent = text; el.className = 'save ' + cls; } }
  function markDirty() { E.dirty = true; setSave('Neuloženo', 'dirty'); clearTimeout(E.timer); E.timer = setTimeout(save, 1000); }
  async function save() {
    clearTimeout(E.timer);
    if (E.saving) await E.saving;
    if (!E.dirty) return;
    E.dirty = false; setSave('Ukládám…', 'busy');
    E.saving = (async () => {
      const t = stockTotals(rc);
      const row = {
        doc_no: rc.docNo, supplier: rc.supplier, date: rc.date || null, currency: rc.currency, rate: rc.rate || 1, transport_pct: rc.transportPct || 0,
        items: rc.items, note: rc.note, total_czk: t.cost, item_count: t.count, stocked_count: t.stocked,
      };
      try {
        const r = check(await sb.from('stock_receipts').update(row).eq('id', rc.id).eq('version', rc.version).select('version').maybeSingle());
        if (!r) {
          const cur = check(await sb.from('stock_receipts').select('last_edit_by').eq('id', rc.id).single());
          const err = new Error(`Příjemku mezitím upravil(a) ${userName(cur.last_edit_by) || 'někdo jiný'}.`); err.conflict = true; throw err;
        }
        rc.version = r.version;
        const cached = SK.receipts.find(x => x.id === rc.id);
        if (cached) Object.assign(cached, rc, { item_count: t.count, stocked_count: t.stocked, total_czk: t.cost });
        setSave('Uloženo');
      } catch (err) {
        E.dirty = !err.conflict;
        setSave(err.conflict ? 'Konflikt' : 'Chyba ukládání', 'err');
        if (err.conflict) {
          if (await confirmBox('Příjemku upravil někdo jiný', err.message + ' Načíst aktuální verzi? Tvoje poslední změny se zahodí.', { ok: 'Načíst aktuální' })) { leaveGuard = null; cleanup(); renderReceipt(rc.id); }
        } else { toast('Neuloženo: ' + err.message, true); E.timer = setTimeout(save, 5000); }
      }
    })();
    await E.saving; E.saving = null;
  }
  leaveGuard = async () => { await save(); cleanup(); };
  const onBefore = e => { if (E.dirty) { e.preventDefault(); e.returnValue = ''; } };
  addEventListener('beforeunload', onBefore);
  const ks = e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } };
  document.addEventListener('keydown', ks);
  function cleanup() { removeEventListener('beforeunload', onBefore); document.removeEventListener('keydown', ks); removeEventListener('scroll', onScroll); bar.remove(); }

  // --- export pro Shoptet ---
  const todo = () => rc.items.filter(i => i.code && !i.stocked && toNum(i.qty) > 0);
  $('#copyStock', bar).onclick = async () => {
    const list = todo().length ? todo() : rc.items.filter(i => i.code);
    if (!list.length) return toast('Žádné položky s kódem', true);
    const txt = list.map(i => `${i.code}\t${numStr(i.qty)}`).join('\n');
    try { await navigator.clipboard.writeText(txt); toast(`Zkopírováno ${list.length} řádků: kód ⇥ počet${todo().length ? ' (jen nenaskladněné)' : ''}`); }
    catch { modal({ title: 'Zkopíruj pro Shoptet', body: `<textarea rows="10" readonly>${esc(txt)}</textarea>` }); }
  };
  const busy = (b, on, html) => { b.disabled = on; if (on) { b.dataset.html = b.innerHTML; b.innerHTML = `<span class="spin"></span> ${html}`; } else b.innerHTML = b.dataset.html; };
  $('#pushShoptet', bar).onclick = async e => {
    const btn = e.currentTarget;
    const stc = cfg(); const stockId = Number(stc.shoptetStockId) || 1; const stockName = stc.shoptetStockName || 'sklad ' + stockId;
    await save();
    const list = rc.items.filter(i => i.code && !i.stocked && !i.shoptetSent && toNum(i.qty) > 0);
    if (!list.length) return toast('Není co posílat: položky jsou buď už naskladněné, nebo nemají kód a počet.', true);
    const big = list.filter(i => toNum(i.qty) >= 5000).length;
    const ok = await modal({
      title: 'Naskladnit do Shoptetu?',
      body: `<p>Do skladu <b>${esc(stockName)}</b> se <b>přidá</b>:</p>
        <div class="push-list">${list.map(i => `<div><code>${esc(i.code)}</code><span>${esc(i.name)}${i.variant ? ', ' + esc(i.variant) : ''}</span><b>+${numStr(i.qty)} ${esc(i.unit || 'ks')}</b></div>`).join('')}</div>
        ${big ? `<p class="warn-t">⚠ ${big} položek má velké množství — zkontroluj, že počty sedí.</p>` : ''}
        <p class="muted small">Položky označené jako naskladněné se neposílají. Zápis do Shoptetu už jedním klikem nevrátíš.</p>`,
      actions: [{ label: 'Zrušit', value: false }, { label: `Naskladnit ${list.length} ${list.length === 1 ? 'položku' : list.length < 5 ? 'položky' : 'položek'}`, value: true, cls: 'primary' }],
    });
    if (!ok) return;
    busy(btn, true, 'Posílám…');
    try {
      const r = await shoptetCall({ action: 'stock_in', receiptId: rc.id, stockId, items: list.map(i => ({ id: i.id, code: i.code, amount: toNum(i.qty) })) });
      let good = 0; const bad = [];
      for (const x of r.results) {
        const it = rc.items.find(i => i.id === x.id); if (!it) continue;
        if (x.status === 'ok' || x.status === 'duplicate') { it.shoptetSent = true; it.stocked = true; it.shoptetAt = new Date().toISOString(); if (x.status === 'ok') good++; }
        if (x.status !== 'ok') bad.push(x);
      }
      drawItems(); markDirty(); await save();
      if (!bad.length) toast(`Naskladněno do Shoptetu: ${good} ${good === 1 ? 'položka' : 'položek'} ✓`);
      else await modal({ title: good ? `Naskladněno ${good}, ale ${bad.length} se nepovedlo` : 'Naskladnění se nepovedlo',
        body: `<div class="push-list err">${bad.map(x => `<div><code>${esc(x.code)}</code><span>${esc(x.message || x.status)}</span></div>`).join('')}</div><p class="muted small">Co se povedlo, je označené. Ostatní můžeš po opravě poslat znovu.</p>`, actions: [{ label: 'Rozumím', value: null, cls: 'primary' }] });
    } catch (err) { toast(err.message, true); }
    busy(btn, false);
  };
  $('#exportCsv', bar).onclick = () => {
    const rows = [['code', 'name', 'variant', 'amount', 'purchasePriceCzkNoVat', 'purchasePrice' + rc.currency, 'priceVat', 'marginPct']];
    rc.items.forEach(it => { const l = stockLine(it, rc); rows.push([it.code, it.name, it.variant, numStr(it.qty), l.unitCost == null ? '' : numStr(Calc.r2(l.unitCost)), l.price == null ? '' : numStr(l.price), it.sellPriceVat == null ? '' : numStr(it.sellPriceVat), l.marginPct == null ? '' : numStr(Math.round(l.marginPct * 10) / 10)]); });
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `Naskladneni_${(rc.docNo || 'prijemka').replace(/[^\w-]+/g, '_')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  $('#rcDel').onclick = async () => {
    if (!(await confirmBox(`Smazat příjemku ${rc.docNo || ''}?`, 'Příjemka zmizí ze seznamu.', { ok: 'Smazat', danger: true }))) return;
    try {
      E.dirty = false; clearTimeout(E.timer);
      check(await sb.from('stock_receipts').update({ deleted: true }).eq('id', rc.id));
      SK.receipts = SK.receipts.filter(x => x.id !== rc.id);
      leaveGuard = null; cleanup(); toast('Příjemka smazána'); location.hash = '#/sklad';
    } catch (err) { toast(err.message, true); }
  };

  drawHead(); drawItems();
  // nová prázdná příjemka v EUR → rovnou načti dnešní kurz ČNB
  if (!rc.items.length && isFx(rc.currency) && !rc.docNo) { loadCnb(true); $('[data-r="docNo"]').focus(); }
}

// =====================================================================
// ORDERJOI — objednávka ze Shoptetu → AUF (potvrzení dodavatele) → svoz → naskladnění do Shoptetu
// stejný postup a pojmy jako ve SmartJoi: objednávky · AUFy · svozy · produkty · dodavatelé
// =====================================================================
const OJ = { comments: [], orders: [], items: [], aufs: [], products: {}, suppliers: [], shipments: [], tab: 'objednavky', filter: 'active', card: '', q: '', syncing: false, sup: '', aq: '', af: '', pf: '' };
OJ.fillSkip = new Set(); OJ.nsSel = new Set(); OJ.nsEdit = {}; OJ.pay = '';
OJ.view = ls.get('vh_oj_view') === 'list' ? 'list' : 'board';
OJ.tab = (v => ({ prehled: 1, potreba: 1, naskladneni: 1, aufy: 1, svozy: 1, produkty: 1, dodavatele: 1 })[v] || /^sup:/.test(v || '') ? v : v === 'objednavky' || v === 'sklad' ? 'potreba' : 'prehled')(ls.get('vh_oj_tab'));
OJ.kind = '';
const OJ_SHIP = { transit: ['Na cestě', 'postponed'], arrived: ['Doručeno', 'confirmed'], stocked: ['Naskladněno', 'confirmed'] };
const OJ_AUF = { draft: ['Koncept', 'draft'], sent: ['Čeká na potvrzení', 'sent'], confirmed: ['Potvrzeno', 'confirmed'] };
const OJ_STAGE_BASE = {
  issue: ['Reklamace', 'rejected', 0], order: ['Potřeba objednat', 'postponed', 1], ordered: ['Objednáno', 'sent', 2],
  transit: ['Na cestě', 'sent', 3], delivered: ['Doručeno', 'confirmed', 4], none: ['Nic k objednání', 'draft', 0],
};
// názvy sloupců jde přepsat v Nastavení → Objednávky (klíče ojLbl_order, ojLbl_ordered…)
const OJ_STAGE = new Proxy(OJ_STAGE_BASE, { get: (t, k) => { const v = t[k]; if (!Array.isArray(v)) return v; const nm = S.settings && S.settings.data && S.settings.data['ojLbl_' + k]; return [nm || v[0], v[1], v[2]]; } });
const OJ_COUNTRIES = [['CZ', 'Česko'], ['DE', 'Německo'], ['AT', 'Rakousko'], ['PL', 'Polsko'], ['SK', 'Slovensko'], ['IT', 'Itálie'], ['NL', 'Nizozemsko'], ['CN', 'Čína'], ['GB', 'Velká Británie']];
const fmtQ = n => (Math.round(Number(n) * 1000) / 1000).toLocaleString('cs-CZ');
const fmtAmt = a => a.amount_eur == null || a.amount_eur === '' ? '—' : Number(a.amount_eur).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + ({ USD: '$', CZK: 'Kč' }[a.currency] || '€');
// platba dodavateli: zaplaceno (datum) / splatnost / nezaplaceno; blížící se a překročená splatnost je zvýrazněná
const ojPayTag = a => {
  if (a.paid_at) return `<span class="tag blue" title="Zaplaceno">💶 zaplaceno ${czDate(a.paid_at)}</span>`;
  const today = ymd(new Date()); const warn = Number((S.settings && S.settings.data && S.settings.data.ojDueWarn) || 3);
  if (a.due_at) { const d = Math.round((new Date(a.due_at + 'T12:00') - new Date(today + 'T12:00')) / 864e5); return `<span class="tag ${d < 0 ? 'late' : d <= warn ? '' : 'grey'}" title="Splatnost">💶 splatnost ${czDate(a.due_at)}${d < 0 ? ` (${-d} d po)` : d <= warn ? ` (za ${d} d)` : ''}</span>`; }
  return '<span class="tag grey">💶 nezaplaceno</span>';
};
const ojDueFromNow = () => { const n = Number((S.settings && S.settings.data && S.settings.data.ojDueDays) || 0); return n > 0 ? ymd(new Date(Date.now() + n * 864e5)) : null; };
async function ojPayDialog(aufId) {
  const a = OJ.aufs.find(x => x.id === aufId); if (!a) return false;
  const sup = ojSup(a.supplier_id); const today = ymd(new Date());
  const v = await modal({ title: 'Platba dodavateli',
    body: `<p class="muted small">${esc(sup ? sup.name : '')} · objednávka ${esc(a.order_code)}${a.auf_number ? ' · č. obj. u dodavatele ' + esc(a.auf_number) : ''} · <b>${fmtAmt(a)}</b></p>
      <label class="chk" style="display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" data-k="paid" ${a.paid_at ? 'checked' : ''}> <b>Zaplaceno</b></label>
      <label>Datum zaplacení</label><input type="date" data-k="pd" value="${esc(a.paid_at || today)}">
      <label>Splatnost (nepovinné)</label><input type="date" data-k="due" value="${esc(a.due_at || '')}">`, focus: '[data-k="pd"]',
    actions: [{ label: 'Zrušit', value: null }, { label: 'Uložit platbu', cls: 'primary', value: bd => ({ paid: $('[data-k="paid"]', bd).checked, pd: $('[data-k="pd"]', bd).value || today, due: $('[data-k="due"]', bd).value || null }) }] });
  if (!v) return false;
  check(await sb.from('oj_aufs').update({ paid_at: v.paid ? v.pd : null, due_at: v.due, updated_at: nowIso() }).eq('id', aufId));
  toast(v.paid ? `Zaplaceno ${czDate(v.pd)}` : 'Platba upravena');
  return true;
}
const fmtEur = n => n == null || n === '' ? '—' : Number(n).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const unitCz = u => ({ m2: 'm²', '': 'ks' })[u] ?? u;
const ojSup = id => OJ.suppliers.find(s => s.id === id);
// počítá se jen zboží od sledovaných dodavatelů (Nastavení → Objednávky); ručně přidané položky vždy
// řádek se neobjednává, když je tak označený, nebo je produkt „nesledovat“ — výslovné „Objednávat“ a ručně přidané řádky ale přebijí nastavení produktu
const ojItemSkipped = i => i.decision === 'skip' || (i.decision !== 'order' && !i.manual && !!(OJ.products[i.code] || {}).skip);
const ojRelevant = i => { if (i.manual) return true; const pr = OJ.products[i.code] || {}; const sp = ojSup(pr.supplier_id); if (sp) return sp.active !== false; return !!(S.settings && S.settings.data && S.settings.data.ojShowUnassigned === '1'); };
const ojActiveSups = () => OJ.suppliers.filter(x => x.active !== false);
const ojFlag = cc => cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map(c => 127397 + c.charCodeAt(0))) : '🌍';
const ojSupLabel = s => s ? `${ojFlag(s.country)} ${esc(s.name)}` : '—';
const shipBadge = s => `<span class="st" data-s="${OJ_SHIP[s][1]}">${OJ_SHIP[s][0]}</span>`;
const aufBadge = a => `<span class="st" data-s="${OJ_AUF[a.status][1]}">${OJ_AUF[a.status][0]}</span>`;
const orderHref = code => '#/oj/' + encodeURIComponent(code);
const stockTabs = active => `<div class="chips" id="skTabs" style="margin-bottom:14px">
  <button class="chip ${active === 'rc' ? 'on' : ''}" data-go="#/sklad">📦 Příjemky</button>
  <button class="chip ${active === 'oj' ? 'on' : ''}" data-go="#/objednavky">🚚 Objednávky dodavatelům</button></div>`;
const bindStockTabs = () => $$('#skTabs [data-go]').forEach(b => b.onclick = () => { location.hash = b.dataset.go; });
const supOptions = (sel, empty = '— dodavatel —') => `<option value="">${empty}</option>` + OJ.suppliers.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
const nowIso = () => new Date().toISOString();

async function loadOj() {
  const [orders, items, aufs, prods, sups, ships, cms] = await Promise.all([
    fetchAll(() => sb.from('oj_orders').select('*').order('order_date', { ascending: false }).order('code')),
    fetchAll(() => sb.from('oj_items').select('*').order('key')),
    fetchAll(() => sb.from('oj_aufs').select('*').order('created_at')),
    fetchAll(() => sb.from('oj_products').select('*').order('code')),
    fetchAll(() => sb.from('oj_suppliers').select('*').order('name')),
    fetchAll(() => sb.from('oj_shipments').select('*').eq('deleted', false).order('created_at', { ascending: false })),
    fetchAll(() => sb.from('oj_order_comments').select('*').order('created_at')),
  ]);
  OJ.comments = cms;
  Object.assign(OJ, { orders, items, aufs, suppliers: sups, shipments: ships, products: Object.fromEntries(prods.map(p => [p.code, p])) });
  // dodavatel ve Shoptetu (pole „Dodavatel“ u produktu) → když se jmenuje stejně jako náš, přiřadí se sám
  const byS = new Map();
  for (const p of prods) {
    if (p.supplier_id || p.skip || !p.shoptet_supplier) continue;
    const f = fold(p.shoptet_supplier); const s = sups.find(x => fold(x.name) === f) || sups.find(x => f.includes(fold(x.name)));
    if (s) { if (!byS.has(s.id)) byS.set(s.id, []); byS.get(s.id).push(p.code); }
  }
  for (const [sid, codes] of byS) {
    for (let i = 0; i < codes.length; i += 200) check(await sb.from('oj_products').update({ supplier_id: sid, updated_at: nowIso() }).in('code', codes.slice(i, i + 200)));
    codes.forEach(c => { OJ.products[c].supplier_id = sid; });
  }
}
async function ojSync(silent) {
  if (OJ.syncing) return; OJ.syncing = true;
  const b = $('#ojSync'); if (b) { b.disabled = true; b.innerHTML = '<span class="spin"></span> Načítám…'; }
  try {
    const r = await shoptetCall({ action: 'oj_sync' });
    if (!r.ok) throw new Error(r.error || 'Načtení se nepovedlo');
    S.settings.data.ojLastSync = r.at; await loadOj();
    if (!silent) toast(`Načteno ze Shoptetu: ${r.orders} objednávek, ${r.items} položek`);
  } catch (e) { toast(e.message, true); }
  OJ.syncing = false;
  if ($('#ojBody')) { drawOj(); const l = $('#ojLast'); if (l) l.textContent = 'Shoptet: ' + ago(cfg().ojLastSync); }
  if (b && b.isConnected) { b.disabled = false; b.textContent = '↻ Načíst ze Shoptetu'; }
}

// ---------- odvozený stav objednávky ----------
function ojInfo(o, sid) {
  const items = OJ.items.filter(i => i.order_code === o.code && (!sid || (OJ.products[i.code] || {}).supplier_id === sid));
  const orderable = items.filter(i => !ojItemSkipped(i) && ojRelevant(i));
  const todo = orderable.filter(i => !i.auf_id);
  const aufs = OJ.aufs.filter(a => a.order_code === o.code && (!sid || a.supplier_id === sid));
  let stage;
  if (aufs.some(a => a.delivery_status === 'issue' && !a.issue_resolved_at)) stage = 'issue';
  else if (todo.length) stage = 'order';
  else if (!aufs.length) stage = 'none';
  else if (aufs.some(a => !a.delivered_at && a.status !== 'confirmed')) stage = 'ordered';
  else if (aufs.some(a => !a.delivered_at)) stage = 'transit';
  else stage = 'delivered';
  // ruční posun na nástěnce platí, dokud se skutečný stav objednávky nezmění (pak se řídí zase daty)
  const auto = stage; const manual = false;
  const sups = [...new Set(orderable.map(i => (OJ.products[i.code] || {}).supplier_id).filter(Boolean))].map(ojSup).filter(Boolean);
  return { o, items, orderable, todo, aufs, stage, sups, auto, manual, sid };
}
const ojBucket = inf => inf.o.archived ? 'archive' : ['delivered', 'none'].includes(inf.stage) ? 'done' : 'active';

async function renderOj() {
  shell('orders', `<div class="topbar"><h1>Objednávky</h1></div><div class="panel panel-b"><div class="sk" style="height:220px"></div></div>`);
  try { await Promise.all([loadSettings(), loadOj(), loadProducts()]); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const last = cfg().ojLastSync;
  $('#main').innerHTML = `
  <div class="pg-head"><span class="pg-ico">${svgIco('orders')}</span><div class="grow"><h1>Objednávky</h1><p>Nákup u dodavatelů, sledování stavu, naskladnění a platby.</p></div><span class="muted small" id="ojLast">${last ? 'Shoptet: ' + ago(last) : 'zatím nenačteno'}</span>
    <button class="btn" id="ojSync">↻ Načíst ze Shoptetu</button></div>
  <div class="chips oj-tabs" id="ojTabs" style="margin-bottom:14px"></div><div id="ojHead"></div><div id="ojBody"></div>`;
  bindStockTabs();
  $('#ojSync').onclick = () => ojSync(false);
  drawOj();
  if (!last || Date.now() - new Date(last).getTime() > 15 * 60000) ojSync(true);
}
const ojSupInfos = id => OJ.orders.map(o => ojInfo(o, id)).filter(i => i.items.length || i.aufs.length);
function drawOj() {
  if (OJ.tab === 'objednavky') OJ.tab = 'potreba';
  if (OJ.tab.startsWith('sup:') && !ojSup(OJ.tab.slice(4))) OJ.tab = 'prehled';
  const sid = OJ.tab.startsWith('sup:') ? OJ.tab.slice(4) : '';
  OJ.curSup = sid; OJ.kindEff = OJ.kind;
  const all = OJ.orders.map(o => ojInfo(o));
  const infos = sid ? ojSupInfos(sid) : all;
  const tabs = [['prehled', 'Přehled', 0, ''], ['potreba', 'Nástěnka', 0, ''], ['naskladneni', 'Naskladnění', ojStockQueue().length, ''],
    ['aufy', 'Potvrzení', OJ.aufs.filter(a => a.status !== 'confirmed').length, 'sep'], ['svozy', 'Svozy', OJ.shipments.filter(x => x.status !== 'stocked').length, ''], ['produkty', 'Produkty', 0, ''], ['dodavatele', 'Dodavatelé', OJ.suppliers.length, '']];
  $('#ojTabs').innerHTML = tabs.map(([k, l, n, c]) => `<button class="chip ${c} ${OJ.tab === k || (k === 'dodavatele' && sid) ? 'on' : ''}" data-t="${k}">${l}${n ? ` <span class="tag ${k === 'dodavatele' || k === 'aufy' || k === 'svozy' ? 'grey' : ''}">${n}</span>` : ''}</button>`).join('');
  $$('#ojTabs .chip').forEach(c => c.onclick = () => { OJ.tab = c.dataset.t; OJ.q = ''; ls.set('vh_oj_tab', OJ.tab); drawOj(); });
  const act = $('#ojTabs .chip.on'); if (act && act.scrollIntoView) { const t = $('#ojTabs'); t.scrollLeft = Math.max(0, act.offsetLeft - 16); }
  let fn = ({ prehled: drawOjOverview, potreba: drawOjOrders, naskladneni: drawOjStockIn, aufy: drawOjAufs, svozy: drawOjShipments, produkty: drawOjProducts, dodavatele: drawOjSuppliers })[OJ.tab];
  $('#ojHead').innerHTML = '';
  if (sid) {
    const x = ojSup(sid); const sv = OJ.supView || 'orders';
    const nA = OJ.aufs.filter(a => a.supplier_id === sid).length, nS = OJ.shipments.filter(h => OJ.aufs.some(a => a.shipment_id === h.id && a.supplier_id === sid)).length;
    $('#ojHead').innerHTML = `<div class="panel panel-b oj-suphead"><div class="grow"><b style="font-size:17px">${ojFlag(x.country)} ${esc(x.name)}</b><div class="muted small">${[x.contact && esc(x.contact), x.email && `<a href="mailto:${esc(x.email)}">${esc(x.email)}</a>`, x.customer_no && 'zák. č. ' + esc(x.customer_no)].filter(Boolean).join(' · ') || 'doplň kontakt v „Upravit“'}</div></div><button class="btn sm" id="supBack">← Všichni dodavatelé</button><button class="btn sm" id="supEdit">Upravit dodavatele</button></div>
      <div class="chips" id="ojSv" style="margin-bottom:12px">${[['orders', 'Objednávky'], ['aufy', 'Potvrzení', nA], ['svozy', 'Svozy', nS]].map(([k, l, n]) => `<button class="chip ${sv === k ? 'on' : ''}" data-v="${k}">${l}${n ? ` <span class="tag grey">${n}</span>` : ''}</button>`).join('')}</div>`;
    $('#supEdit').onclick = () => ojEditSupplier(sid); $('#supBack').onclick = () => ojGo('dodavatele');
    $$('#ojSv .chip').forEach(c => c.onclick = () => { OJ.supView = c.dataset.v; OJ.q = ''; drawOj(); });
    fn = ({ orders: drawOjOrders, aufy: drawOjAufs, svozy: drawOjShipments })[sv];
  }
  fn(infos);
}

// ---------- kopírování soupisu čísel objednávek u dodavatele + referencí ----------
const ojRowOf = a => { const o = OJ.orders.find(x => x.code === a.order_code) || {}; return { num: a.auf_number || '', order: a.order_code, ref: o.ref || '', sup: (ojSup(a.supplier_id) || {}).name || '', amt: a.amount_eur != null ? fmtAmt(a) : '', note: o.note || '' }; };
async function ojCopyRows(rows, title) {
  const fmts = { table: 'Tabulka (do Excelu): č. obj. u dodavatele, objednávka, reference, dodavatel, částka', lines: 'Jen čísla objednávek u dodavatele — každé na řádek', comma: 'Jen čísla objednávek u dodavatele — oddělená čárkou', both: 'Č. obj. u dodavatele – reference (každé na řádek)' };
  const build = f => {
    const uniq = [...new Map(rows.map(r => [r.num + '|' + r.order, r])).values()];
    if (f === 'lines') return [...new Set(uniq.map(r => r.num).filter(Boolean))].join('\n');
    if (f === 'comma') return [...new Set(uniq.map(r => r.num).filter(Boolean))].join(', ');
    if (f === 'both') return uniq.map(r => [r.num || '(bez čísla)', r.ref || r.order].join(' – ')).join('\n');
    return ['Č. obj. u dodavatele\tObjednávka\tReference\tDodavatel\tČástka', ...uniq.map(r => [r.num, r.order, r.ref, r.sup, r.amt].join('\t'))].join('\n');
  };
  if (!rows.length) return toast('Není co kopírovat.', true);
  const done = modal({ title: title || 'Kopírovat soupis', body: `<label>Formát</label><select id="cpFmt">${Object.entries(fmts).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
    <label>Soupis <span class="muted small" id="cpN"></span></label><textarea id="cpTxt" rows="9" readonly style="font-family:var(--mono, monospace);font-size:13px"></textarea>
    <button class="btn primary" id="cpGo" style="margin-top:10px;width:100%">📋 Kopírovat do schránky</button>`, focus: '#cpGo', actions: [{ label: 'Zavřít', value: null }] });
  setTimeout(() => {
    const bd = $$('.backdrop').pop(); if (!bd) return; const sel = $('#cpFmt', bd), ta = $('#cpTxt', bd);
    const draw = () => { ta.value = build(sel.value); $('#cpN', bd).textContent = `· ${ta.value ? ta.value.split('\n').length - (sel.value === 'table' ? 1 : 0) : 0} řádků`; };
    sel.onchange = draw; draw();
    $('#cpGo', bd).onclick = async () => {
      try { await navigator.clipboard.writeText(ta.value); toast('Zkopírováno do schránky ✓'); }
      catch { ta.removeAttribute('readonly'); ta.select(); toast('Označeno — zkopíruj ručně (Cmd+C)', true); }
    };
  }, 40);
  await done;
}
// ---------- záložka Přehled: co teď udělat + co je na cestě ----------
function ojGo(tab, f = {}) { OJ.tab = tab; ls.set('vh_oj_tab', tab); Object.assign(OJ, { q: '', card: '', ...f }); drawOj(); window.scrollTo(0, 0); }
function ojMiniBoard(infos, n) {
  const act = infos.filter(i => ojBucket(i) === 'active');
  const mini = (st, n) => {
    const L = act.filter(i => i.stage === st); if (st === 'delivered') L.push(...infos.filter(i => i.stage === 'delivered' && !i.o.archived));
    const show = L.slice(0, n);
    return `<div class="mb-col" data-st="${st}"><div class="mb-h" data-go="${st}">${esc(OJ_STAGE[st][0])} <span class="mb-n">${L.length}</span></div>
      ${show.map(i => { const a = i.aufs[0]; const sup = (i.sups[0] || (a && ojSup(a.supplier_id)) || {}).name || '';
        return `<div class="mb-card" data-o="${esc(i.o.code)}"><div class="mb-top">${sup ? `<span class="mb-sup">${esc(sup)}</span>` : '<span></span>'}${a && a.auf_number ? `<small>${esc(a.auf_number)}</small>` : ''}</div>
        <b>${esc(i.o.customer || i.o.ref || i.o.code)}</b><div class="small muted">${esc(i.o.code)} · ${i.items.length} ${i.items.length === 1 ? 'položka' : i.items.length < 5 ? 'položky' : 'položek'}${a && a.amount_eur != null ? ' · ' + fmtAmt(a) : ''}</div>
        ${a && a.paid_at ? `<span class="mb-ok">✓ Zaplaceno ${czDate(a.paid_at)}</span>` : a && a.expected_at ? `<span class="mb-eta">📅 ETA ${czDate(a.expected_at)}</span>` : ''}</div>`; }).join('') || '<div class="mb-empty">—</div>'}
      ${L.length > n ? `<button class="mb-more" data-go="${st}">+ ${L.length - n} dalších</button>` : ''}</div>`;
  };
  return ['order', 'ordered', 'transit', 'delivered'].map(st => mini(st, n)).join('');
}
async function ojOverviewExtra(el) {
  const alive = () => $('#ojBody') === el && $('#ovRc');
  const put = (id, html) => { if (alive() && $(id)) $(id).innerHTML = html; };
  try {
    const r = check(await sb.from('stock_receipts').select('id,doc_no,supplier,date,item_count,stocked_count,imported,created_at').eq('deleted', false).order('created_at', { ascending: false }).limit(3));
    put('#ovRc', r.length ? r.map(x => `<a class="rc-row" href="#/sklad"><span class="rc-i">${svgIco('stock')}</span><div class="grow"><b>${esc(x.doc_no || 'Příjemka')}</b> <span class="stp ${x.imported ? 'ok' : 'wait'}">${x.imported ? 'Naskladněno' : 'Čeká'}</span><div class="small muted">${esc(x.supplier || '')} · ${x.item_count || 0} ks položek</div></div><span class="small muted nowrap">${x.date ? czDate(x.date) : ''}</span></a>`).join('') : '<div class="muted small" style="padding:6px 2px">Zatím žádné příjemky.</div>');
  } catch { put('#ovRc', '<div class="muted small">Nepodařilo se načíst.</div>'); }
  try {
    if (!hasApp('kontejnery')) throw 0;
    const r = check(await sb.from('ct_containers').select('*').neq('status', 'delivered').order('eta', { ascending: true, nullsFirst: false }).limit(3));
    put('#ovCt', r.length ? r.map(c => `<a class="rc-row" href="#/k/${c.id}"><span class="rc-i">${svgIco('ct')}</span><div class="grow"><b>${esc(c.number || 'bez čísla')}</b> ${CT_ST[c.status] ? ctBadge(c.status) : ''}<div class="small muted">${esc(c.vessel || '')}</div></div><span class="small nowrap">ETA <b>${ctEta(c) ? czDate(ctEta(c)) : '—'}</b></span></a>`).join('') : '<div class="muted small" style="padding:6px 2px">Žádný kontejner na cestě.</div>');
  } catch { put('#ovCt', '<div class="muted small" style="padding:6px 2px">Kontejnery nejsou k dispozici.</div>'); }
  try {
    const r = check(await sb.from('stock_history').select('at,source_label,reference,code,amount').order('at', { ascending: false }).limit(4));
    put('#ovMv', r.length ? `<table class="dt"><thead><tr><th>Datum</th><th>Produkt / doklad</th><th>Pohyb</th><th class="r">Množství</th></tr></thead><tbody>${r.map(m => `<tr><td class="nowrap">${czDate(String(m.at).slice(0, 10))}</td><td><b>${esc(m.code || '')}</b><div class="small muted">${esc(m.reference || '')}</div></td><td><span class="stp ${Number(m.amount) >= 0 ? 'ok' : 'bad'}">${Number(m.amount) >= 0 ? 'Příjem' : 'Výdej'}</span></td><td class="r nowrap"><b>${Number(m.amount) > 0 ? '+' : ''}${fmtQ(m.amount)}</b></td></tr>`).join('')}</tbody></table>` : '<div class="muted small" style="padding:14px">Zatím žádné pohyby.</div>');
  } catch { put('#ovMv', '<div class="muted small" style="padding:14px">Nepodařilo se načíst.</div>'); }
}
function drawOjOverview(infos) {
  const el = $('#ojBody'); const act = infos.filter(i => ojBucket(i) === 'active');
  const toOrder = act.filter(i => i.stage === 'order');
  const drafts = OJ.aufs.filter(a => a.status === 'draft');
  const waiting = OJ.aufs.filter(a => a.status === 'sent');
  const onWay = OJ.aufs.filter(a => a.status === 'confirmed' && !a.delivered_at && (ojSup(a.supplier_id) || {}).active !== false).sort((a, b) => String(a.expected_at || '9999').localeCompare(b.expected_at || '9999'));
  const toStock = ojStockQueue();
  const issues = OJ.aufs.filter(a => a.delivery_status === 'issue' && !a.issue_resolved_at);
  const unpaid = OJ.aufs.filter(a => a.status !== 'draft' && !a.paid_at && (ojSup(a.supplier_id) || {}).active !== false);
  const overdue = unpaid.filter(a => a.due_at && a.due_at < ymd(new Date()));
  const unpaidSum = (() => { const m = {}; unpaid.forEach(a => { if (a.amount_eur != null) m[a.currency || 'EUR'] = (m[a.currency || 'EUR'] || 0) + Number(a.amount_eur); }); return Object.entries(m).map(([c, n]) => n.toLocaleString('cs-CZ', { maximumFractionDigits: 2 }) + ' ' + ({ USD: '$', CZK: 'Kč' }[c] || '€')).join(' + ') || 'bez částky'; })();
  const oldest = a => { const t = Math.min(...a.map(x => new Date(x.sent_at || x.created_at).getTime())); return isFinite(t) ? Math.floor((Date.now() - t) / 864e5) : 0; };
  const nItems = toOrder.reduce((x, i) => x + i.todo.length, 0);
  const todo = [
    [issues.length, '⚠', 'Reklamace k vyřešení', `${issues.length} ${issues.length === 1 ? 'zásilka' : 'zásilek'} s problémem`, () => ojGo('prehled'), 'var(--s-rejected)', 'Zobrazit níže'],
    [unpaid.length, '💶', 'K zaplacení dodavatelům', `${unpaid.length} ${unpaid.length === 1 ? 'objednávka' : unpaid.length < 5 ? 'objednávky' : 'objednávek'}${overdue.length ? ` · <b style="color:var(--danger)">${overdue.length} po splatnosti</b>` : ''} · ${unpaidSum}`, () => ojGo('aufy', { af: 'unpaid' }), overdue.length ? 'var(--s-rejected)' : 'var(--s-postponed)', 'Zobrazit'],
    [toStock.length, '📥', 'Dorazilo — naskladnit', `${toStock.length} ${toStock.length === 1 ? 'balík čeká' : toStock.length < 5 ? 'balíky čekají' : 'balíků čeká'} na kontrolu a naskladnění`, () => ojGo('naskladneni'), 'var(--s-confirmed)', 'Otevřít frontu'],
    [toOrder.length, '🛒', 'Objednat u dodavatele', `${toOrder.length} ${toOrder.length === 1 ? 'objednávka' : toOrder.length < 5 ? 'objednávky' : 'objednávek'} · ${nItems} položek bez objednávky`, () => ojGo('potreba', { card: 'order', view: 'list' }), 'var(--s-postponed)', 'Zobrazit'],
    [drafts.length, '✉', 'Neodeslané e-maily', `${drafts.length} rozepsaných e-mailů dodavateli`, () => ojGo('aufy', { af: 'draft' }), 'var(--muted)', 'Dokončit'],
    [waiting.length, '⏳', OJ_STAGE.ordered[0] + ' — čeká na potvrzení', `${waiting.length} objednávek u dodavatele · nejdéle ${oldest(waiting)} dní`, () => ojGo('aufy', { af: 'sent' }), 'var(--s-sent)', 'Zobrazit'],
  ].filter(x => x[0]);
  OJ._todo = todo;
  const eta = a => { if (!a.expected_at) return '<span class="muted">bez termínu</span>'; const d = Math.round((new Date(a.expected_at + 'T12:00') - new Date(ymd(new Date()) + 'T12:00')) / 864e5); return `<span class="tag ${d < 0 ? 'late' : d <= 2 ? '' : 'blue'}">📅 ${czDate(a.expected_at)}</span> <span class="muted small">${d < 0 ? `${-d} d po termínu` : d === 0 ? 'dnes' : d === 1 ? 'zítra' : 'za ' + d + ' d'}</span>`; };
  const nOrders = act.length;
  const sumTxt = unpaidSum;
  const kpi = [
    ['cart', 'var(--s-sent)', OJ_STAGE.order[0].replace('Potřeba objednat', 'K objednání'), toOrder.length, '', () => ojGo('potreba', { card: 'order', view: 'list' })],
    ['truck', 'var(--s-sent)', OJ_STAGE.ordered[0], act.filter(i => i.stage === 'ordered').length, '', () => ojGo('potreba', { view: 'board' })],
    ['ship', 'var(--brand)', OJ_STAGE.transit[0], onWay.length, '', () => ojGo('aufy', { af: 'confirmed' })],
    ['box', 'var(--s-confirmed)', 'Doručeno <small>(čeká na naskladnění)</small>', toStock.length, '', () => ojGo('naskladneni')],
    ['card', 'var(--s-rejected)', 'K zaplacení', unpaid.length, `<span class="kpi-pill bad">${sumTxt}</span>`, () => ojGo('aufy', { af: 'unpaid' })],
  ];
  OJ._kpi = kpi;
  const KI = { cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2.5 3.5h3l2.2 11h10.6l2-8H6.3"/>', truck: NAV_SVG.orders, ship: NAV_SVG.ct, box: NAV_SVG.stock, card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>' };
  const stageOf = a => a.delivered_at ? 'Doručeno' : a.status === 'confirmed' ? OJ_STAGE.transit[0] : OJ_STAGE.ordered[0];
  const stClass = a => a.delivered_at ? 'ok' : a.status === 'confirmed' ? 'go' : 'wait';
  const lastAufs = OJ.aufs.filter(a => a.status !== 'draft').sort((x, y) => String(y.created_at || '').localeCompare(String(x.created_at || ''))).slice(0, 5);
  const dueList = unpaid.slice().sort((x, y) => String(x.due_at || '9999').localeCompare(String(y.due_at || '9999'))).slice(0, 4);
  el.innerHTML = `
  <div class="kpis">${kpi.map(([ic, c, l, n, extra], i) => `<button class="panel kpi" data-k="${i}" style="--c:${c}"><span class="kpi-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${KI[ic]}</svg></span><span class="kpi-t"><span class="kpi-l">${l}</span><b class="kpi-v">${n}</b>${extra}</span></button>`).join('')}</div>
  <div class="ovg">
    <div class="ov-main">
      <section class="panel dash"><div class="dash-h">${svgIco('boards')}<b>Nástěnka objednávek</b><span class="grow"></span><button class="btn sm" id="ovBoard">Otevřít nástěnku ›</button></div>
        <div class="mini-board">${ojMiniBoard(infos, 2)}</div></section>
      <div class="ov-two">
        <section class="panel dash"><div class="dash-h">${svgIco('stock')}<b>Naskladnění (příjemky)</b><span class="grow"></span><a class="btn sm primary" href="#/sklad">＋ Nová příjemka</a></div><div id="ovRc" class="dash-b"><div class="sk" style="height:90px"></div></div><a class="dash-f" href="#/sklad">Zobrazit příjemky →</a></section>
        <section class="panel dash"><div class="dash-h">${svgIco('ct')}<b>Kontejnery</b><span class="grow"></span>${hasApp('kontejnery') ? '<a class="btn sm primary" href="#/kontejnery">Otevřít</a>' : ''}</div><div id="ovCt" class="dash-b"><div class="sk" style="height:90px"></div></div><a class="dash-f" href="#/kontejnery">Zobrazit všechny kontejnery →</a></section>
      </div>
    </div>
    <div class="ov-side">
      <section class="panel dash"><div class="dash-h">${svgIco('orders')}<b>Objednávky u dodavatelů</b><span class="grow"></span><button class="btn sm primary" id="ovNew2">Nová objednávka ＋</button></div>
        <div class="dash-b nopad">${lastAufs.length ? `<table class="dt"><thead><tr><th>Číslo / ref.</th><th>Dodavatel</th><th class="r">Částka</th><th>Stav</th></tr></thead><tbody>${lastAufs.map(a => `<tr class="click" data-o="${esc(a.order_code)}"><td><b>${esc(a.auf_number || a.order_code)}</b></td><td><span class="mb-sup">${esc((ojSup(a.supplier_id) || {}).name || '')}</span></td><td class="r nowrap">${fmtAmt(a)}</td><td><span class="stp ${stClass(a)}">${esc(stageOf(a))}</span></td></tr>`).join('')}</tbody></table>` : '<div class="muted small" style="padding:14px">Zatím žádné objednávky u dodavatelů.</div>'}</div>
        <a class="dash-f" href="#" id="ovAllA">Zobrazit všechny objednávky →</a></section>
      <section class="panel dash"><div class="dash-h">${svgIco('cal')}<b>K zaplacení dodavatelům</b><span class="grow"></span><a class="dash-lnk" href="#" id="ovAllP">Všechny platby →</a></div>
        <div class="dash-b nopad">${dueList.length ? `<table class="dt"><thead><tr><th>Dodavatel</th><th>Č. objednávky</th><th>Splatnost</th><th class="r">Částka</th></tr></thead><tbody>${dueList.map(a => { const d = a.due_at ? Math.round((new Date(a.due_at + 'T12:00') - new Date(ymd(new Date()) + 'T12:00')) / 864e5) : null; return `<tr class="click" data-o="${esc(a.order_code)}"><td><span class="mb-sup">${esc((ojSup(a.supplier_id) || {}).name || '')}</span></td><td>${esc(a.auf_number || a.order_code)}</td><td class="nowrap">${a.due_at ? czDate(a.due_at) : '—'}${d !== null && d < 0 ? ` <span class="late-pill">−${-d} d</span>` : ''}</td><td class="r nowrap">${fmtAmt(a)}</td></tr>`; }).join('')}</tbody></table>` : '<div class="muted small" style="padding:14px">Nic k zaplacení.</div>'}</div></section>
      <section class="panel dash"><div class="dash-h">${svgIco('moves')}<b>Historie pohybů zásob</b><span class="grow"></span><a class="dash-lnk" href="#/pohyby">Zobrazit historii →</a></div><div id="ovMv" class="dash-b nopad"><div class="sk" style="height:90px;margin:10px"></div></div></section>
    </div>
  </div>
    <h3 class="oj-h">Co teď udělat</h3>
  ${todo.length ? `<div class="oj-todo">${todo.map((t, i) => `<button class="panel oj-t" data-t="${i}" style="--c:${t[5]}"><span class="oj-ti">${t[1]}</span><div class="grow"><b>${t[2]}</b><div class="muted small">${t[3]}</div></div><span class="btn sm">${t[6]} ›</span></button>`).join('')}</div>`
    : '<div class="panel empty-big"><div class="ill">✅</div><h3>Všechno vyřízeno</h3><p>Nic nečeká na objednání ani na kontrolu. Novou objednávku zboží na sklad založíš tlačítkem níže.</p></div>'}
  <div style="margin:10px 0 4px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" id="ovNew">＋ Objednávka na sklad</button><button class="btn" id="ovAll">Objednávky ze Shoptetu ›</button></div>
  <h3 class="oj-h">Dodavatelé</h3>
  <div class="oj-sups">${ojActiveSups().sort((a, b) => a.name.localeCompare(b.name)).map(x => { const si = ojSupInfos(x.id).filter(i => ojBucket(i) === 'active'); const c = k => si.filter(i => i.stage === k).length; const an = OJ.aufs.filter(a => a.supplier_id === x.id && a.status === 'confirmed' && !a.delivered_at).length;
    return `<button class="panel oj-sup" data-s="${x.id}"><b>${ojSupLabel(x)}</b><div class="oj-sc"><span><b>${c('order')}</b> k objednání</span><span><b>${c('ordered')}</b> objednáno</span><span><b>${an + c('transit') * 0}</b> na cestě</span></div></button>`; }).join('') || '<div class="panel panel-b muted">Zatím žádný dodavatel.</div>'}</div>
  <h3 class="oj-h">Na cestě <span class="muted small">— objednáno a potvrzeno, ještě nedorazilo</span></h3>
  ${onWay.length ? `<div class="panel" style="overflow-x:auto"><table class="list"><thead><tr><th>Dodavatel</th><th>Objednávka</th><th>Č. obj. u dodavatele</th><th>Položek</th><th class="r">Částka</th><th>Očekáváno</th><th></th></tr></thead><tbody>
    ${onWay.map(a => { const sh = OJ.shipments.find(x => x.id === a.shipment_id); const o = OJ.orders.find(x => x.code === a.order_code); return `<tr class="click" data-o="${esc(a.order_code)}"><td><b>${ojSupLabel(ojSup(a.supplier_id))}</b></td><td><u>${esc(a.order_code)}</u>${o && o.kind === 'stock' ? ' <span class="tag blue">na sklad</span>' : ''}</td><td>${esc(a.auf_number)}</td><td>${a.lines.length}</td><td class="r nowrap">${fmtAmt(a)}</td><td class="nowrap">${eta(a)}${sh ? ` <span class="tag grey">${esc(sh.reference)}</span>` : ''}</td><td class="nowrap">${sh ? `<a class="btn sm" href="#/svoz/${sh.id}">Svoz ›</a>` : `<button class="btn sm primary" data-recv="${a.id}">📥 Přijmout</button>`}</td></tr>`; }).join('')}</tbody></table></div>`
    : '<div class="panel panel-b muted">Zatím nic na cestě. Objednávku dodavateli odešli v záložce Objednávky a po potvrzení se tu objeví.</div>'}
  ${issues.length ? `<h3 class="oj-h">Reklamace</h3><div class="panel" style="overflow-x:auto"><table class="list"><thead><tr><th>Dodavatel</th><th>Objednávka</th><th>Č. obj. u dodavatele</th><th>Problém</th><th></th></tr></thead><tbody>
    ${issues.map(a => `<tr class="click" data-o="${esc(a.order_code)}"><td><b>${ojSupLabel(ojSup(a.supplier_id))}</b></td><td><u>${esc(a.order_code)}</u></td><td>${esc(a.auf_number)}</td><td>${esc(a.delivery_note) || '<span class="muted">bez poznámky</span>'}</td><td><button class="btn sm" data-resolve="${a.id}">✓ Vyřešeno</button></td></tr>`).join('')}</tbody></table></div>` : ''}`;
  $$('.kpi', el).forEach(b => b.onclick = () => OJ._kpi[b.dataset.k][5]());
  $('#ovBoard').onclick = () => ojGo('potreba', { view: 'board' }); $('#ovNew2').onclick = ojManualOrder;
  $('#ovAllA').onclick = e => { e.preventDefault(); ojGo('aufy'); }; $('#ovAllP').onclick = e => { e.preventDefault(); ojGo('aufy', { af: 'unpaid' }); };
  $$('.mb-h, .mb-more', el).forEach(b => b.onclick = () => ojGo('potreba', { view: 'board' }));
  $$('.mb-card', el).forEach(c => c.onclick = () => { location.hash = orderHref(c.dataset.o); });
  $$('.dt tr.click', el).forEach(r => r.onclick = () => { location.hash = orderHref(r.dataset.o); });
  ojOverviewExtra(el);
  $$('.oj-t', el).forEach(b => b.onclick = () => OJ._todo[b.dataset.t][4]());
  $('#ovNew').onclick = ojManualOrder; $('#ovAll').onclick = () => ojGo('potreba'); $$('.oj-sup', el).forEach(b => b.onclick = () => ojGo('sup:' + b.dataset.s));
  $$('tr.click', el).forEach(r => r.onclick = e => { if (e.target.closest('[data-recv],[data-resolve],a')) return; location.hash = orderHref(r.dataset.o); });
  $$('[data-recv]', el).forEach(b => b.onclick = e => { e.stopPropagation(); ojReceiveAuf(b.dataset.recv); });
  $$('[data-resolve]', el).forEach(b => b.onclick = async e => { e.stopPropagation(); try { check(await sb.from('oj_aufs').update({ issue_resolved_at: nowIso(), updated_at: nowIso() }).eq('id', b.dataset.resolve)); await loadOj(); drawOj(); toast('Reklamace vyřešena'); } catch (er) { toast(er.message, true); } });
}

// ---------- záložka Objednávky ----------
function waitTag(i) {
  if (i.stage !== 'ordered') return '';
  const t = Math.min(...i.aufs.filter(a => a.status === 'sent' && a.sent_at).map(a => new Date(a.sent_at).getTime()));
  if (!isFinite(t)) return '';
  const d = Math.floor((Date.now() - t) / 864e5);
  return ` <span class="tag ${d >= 5 ? 'late' : 'grey'}" title="Od odeslání e-mailu dodavateli">čeká ${d === 0 ? 'od dneška' : d + ' ' + (d === 1 ? 'den' : d < 5 ? 'dny' : 'dní')}</span>`;
}
function dashes(stage) { const n = OJ_STAGE[stage][2]; return `<span class="dashes ${stage}">${[1, 2, 3, 4].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`; }
function drawOjOrders(infos) {
  const el = $('#ojBody'); const board = OJ.view === 'board'; const act = infos.filter(i => ojBucket(i) === 'active');
  const cnt = k => act.filter(i => i.stage === k).length;
  const cards = [['order', '🛒', OJ_STAGE.order[0], cnt('order'), 'var(--s-postponed)'], ['ordered', '✉', OJ_STAGE.ordered[0], cnt('ordered'), 'var(--s-sent)'], ['transit', '🚚', OJ_STAGE.transit[0], cnt('transit'), 'var(--brand)'],
    ['delivered', '✓', OJ_STAGE.delivered[0], infos.filter(i => i.stage === 'delivered' && !i.o.archived).length, 'var(--s-confirmed)'], ['issue', '⚠', OJ_STAGE.issue[0], cnt('issue'), 'var(--s-rejected)']];
  const bucketCnt = b => infos.filter(i => ojBucket(i) === b).length;
  const q = fold(OJ.q).trim();
  let list = infos.filter(i => {
    if (board) { if (i.o.archived || i.stage === 'none') return false; }
    else if (OJ.card) { if (OJ.card === 'delivered' ? !(i.stage === 'delivered' && !i.o.archived) : !(ojBucket(i) === 'active' && i.stage === OJ.card)) return false; }
    else if (ojBucket(i) !== OJ.filter) return false;
    if (OJ.kindEff && (i.o.kind || 'customer') !== OJ.kindEff) return false;
    if (OJ.pay === 'unpaid' && !i.aufs.some(a => a.status !== 'draft' && !a.paid_at)) return false;
    if (OJ.pay === 'paid' && !i.aufs.some(a => a.paid_at)) return false;
    if (!OJ.curSup && OJ.sup && !i.items.some(x => (OJ.products[x.code] || {}).supplier_id === OJ.sup)) return false;
    if (!q) return true;
    return fold([i.o.code, i.o.customer, i.o.note, i.o.ref, ...OJ.comments.filter(c => c.order_code === i.o.code).map(c => c.text), ...i.aufs.map(a => a.note), ...i.aufs.map(a => a.auf_number + ' ' + a.order_code), ...i.sups.map(x => x.name), ...i.items.map(x => x.code + ' ' + x.name + ' ' + ((OJ.products[x.code] || {}).supplier_code || ''))].join(' ')).includes(q);
  });
  if (board) return drawOjBoard(el, list);
  el.innerHTML = `
  ${ojStockBanner()}
  <div class="stats oj-cards">${cards.map(([k, ic, l, n, c]) => `<button class="panel stat click ${OJ.card === k ? 'on' : ''}" data-card="${k}" style="--c:${c}"><div class="k">${ic}</div><div class="v">${n}</div><div class="s">${l}</div></button>`).join('')}</div>
  ${ojToolbar(`<div class="chips" id="ojF">${[['active', 'Aktivní'], ['done', 'Vyřízené'], ['archive', 'Archiv']].map(([k, l]) => `<button class="chip ${!OJ.card && OJ.filter === k ? 'on' : ''}" data-f="${k}">${l} <span class="tag grey">${bucketCnt(k)}</span></button>`).join('')}</div>`)}
  ${OJ.card ? `<p class="muted small" style="margin:-4px 0 10px">Filtr: <b>${OJ_STAGE[OJ.card][0]}</b> · <a href="#" id="ojClr">zrušit</a></p>` : ''}
  <div class="panel" id="ojOrdList">${list.length ? list.map(i => {
    const [lbl, st] = OJ_STAGE[i.stage]; const sup = i.sups.map(s => ojSupLabel(s)).join(' · ');
    return `<a class="oj-row" href="${orderHref(i.o.code)}" style="--c:${({ rejected: 'var(--s-rejected)', postponed: 'var(--s-postponed)', sent: 'var(--s-sent)', confirmed: 'var(--s-confirmed)', draft: 'var(--muted)' })[st]}">
      <div class="grow"><b>${highlight(i.o.code, OJ.q)}</b>${i.o.kind === 'stock' ? '<span class="tag blue">na sklad</span>' : i.o.manual ? '<span class="tag grey">ruční</span>' : ''}${i.aufs.some(a => a.status === 'draft') ? ' <span class="tag">e-mail neodeslán</span>' : ''}${waitTag(i)}<div class="muted small">${esc(String(i.o.order_date).slice(0, 10))} · ${i.orderable.length} ${i.orderable.length === 1 ? 'položka' : i.orderable.length < 5 ? 'položky' : 'položek'}${sup ? ' · ' + sup : ''}${i.o.customer ? ' · ' + esc(i.o.customer) : ''}</div></div>
      ${dashes(i.stage)}<span class="st" data-s="${st}">${lbl}</span><span class="muted">›</span></a>`; }).join('') : `<div class="empty-big"><div class="ill">✅</div><h3>Tady nic není</h3><p>${OJ.kindEff === 'stock' ? 'Vlastní objednávky zboží na sklad založíš tlačítkem „＋ Objednávka na sklad“.' : 'Objednávky ve stavu „Potřeba objednat“ se načtou tlačítkem nahoře.'}</p></div>`}</div>`;
  $$('[data-card]', el).forEach(b => b.onclick = () => { OJ.card = OJ.card === b.dataset.card ? '' : b.dataset.card; drawOj(); });
  $$('#ojF .chip', el).forEach(b => b.onclick = () => { OJ.card = ''; OJ.filter = b.dataset.f; drawOj(); });
  ojBindBar();
  const clr = $('#ojClr'); if (clr) clr.onclick = e => { e.preventDefault(); OJ.card = ''; drawOj(); };
}
// =====================================================================
// NASKLADNĚNÍ Z OBJEDNÁVEK: fronta doručeného zboží, které čeká na ruční naskladnění do Shoptetu
// balík = svoz, který dorazil, nebo objednávka u dodavatele označená „Doručeno“ bez svozu
// =====================================================================
function ojStockQueue() {
  const out = [];
  for (const sh of OJ.shipments.filter(x => x.status === 'arrived')) {
    const lines = Array.isArray(sh.lines) ? sh.lines : [];
    if (!lines.some(l => !l.stocked && !l.skip)) continue;
    const as = OJ.aufs.filter(a => a.shipment_id === sh.id);
    out.push({ key: 's:' + sh.id, kind: 'svoz', id: sh.id, title: sh.reference || sh.title || 'Svoz', sub: [...new Set(as.map(a => (ojSup(a.supplier_id) || {}).name).filter(Boolean))].join(' · ') || sh.note || '', orders: [...new Set(as.map(a => a.order_code))], at: sh.delivered_at || sh.created_at || '', lines, sh });
  }
  for (const a of OJ.aufs) {
    if (!a.delivered_at || a.shipment_id || a.stock_skip) continue;
    if (a.delivery_status === 'issue' && !a.issue_resolved_at) continue;
    const o = OJ.orders.find(x => x.code === a.order_code); if (!o || o.archived) continue;
    const lines = (a.lines || []).filter(l => l.ourCode).map(l => { const id = a.id.slice(0, 8) + '|' + l.ourCode; return { id, code: l.ourCode, name: (OJ.products[l.ourCode] || {}).name || l.name, qty: Number(l.qty), unit: unitCz(l.unit), aufId: a.id, aufNumber: a.auf_number, orderCode: a.order_code, ...(OJ.nsEdit[id] || {}) }; });
    if (!lines.some(l => !l.skip)) continue;
    out.push({ key: 'a:' + a.id, kind: 'auf', id: a.id, title: a.auf_number || a.order_code, sub: (ojSup(a.supplier_id) || {}).name || '', orders: [a.order_code], at: a.delivered_at, lines, auf: a });
  }
  return out.sort((x, y) => String(y.at).localeCompare(String(x.at)));
}
const nsLeft = p => p.lines.filter(l => !l.stocked && !l.skip);
const nsWord = n => n === 1 ? 'balík' : n < 5 ? 'balíky' : 'balíků';
const ojStockBanner = () => { const n = ojStockQueue().length; return n ? `<a class="panel panel-b oj-banner" href="#/objednavky" data-go-stock><span style="font-size:22px">📥</span><div class="grow"><b>${n} ${nsWord(n)} ${n === 1 ? 'čeká' : n < 5 ? 'čekají' : 'čeká'} na naskladnění</b><div class="muted small">Doručené zboží — otevři „Naskladnění“, vyber, co poslat do Shoptetu.</div></div><span class="btn primary">Otevřít ›</span></a>` : ''; };
document.addEventListener('click', e => { const b = e.target.closest('[data-go-stock]'); if (b) { e.preventDefault(); ojGo('naskladneni'); } });
function drawOjStockIn() {
  const el = $('#ojBody'); const q = ojStockQueue();
  for (const k of [...OJ.nsSel]) if (!q.some(p => p.key === k)) OJ.nsSel.delete(k);
  const stc = cfg(); const sk = stc.shoptetStockName || 'Sklad ' + (stc.shoptetStockId ?? 1);
  const chosen = q.filter(p => OJ.nsSel.has(p.key)); const nLines = chosen.reduce((t, p) => t + nsLeft(p).length, 0);
  const skipped = OJ.aufs.filter(a => a.stock_skip && a.delivered_at && !a.shipment_id && (OJ.orders.find(o => o.code === a.order_code) || {}).archived !== true);
  const pack = p => `<section class="panel ns-pack${OJ.nsSel.has(p.key) ? ' on' : ''}" data-k="${esc(p.key)}">
    <div class="ns-ph"><label class="ns-chk" title="Vybrat k naskladnění"><input type="checkbox" data-sel ${OJ.nsSel.has(p.key) ? 'checked' : ''}></label>
      <div class="grow"><b>${esc(p.title)}</b> ${p.kind === 'svoz' ? '<span class="tag blue">svoz</span>' : ''}<div class="muted small">${[p.sub && esc(p.sub), 'objednávky: ' + p.orders.map(c => `<a href="${orderHref(c)}"><u>${esc(c)}</u></a>`).join(', '), p.at && 'doručeno ' + czDate(String(p.at).slice(0, 10))].filter(Boolean).join(' · ')}</div></div>
      ${p.kind === 'svoz' ? `<a class="btn sm" href="#/svoz/${p.id}">Otevřít svoz</a>` : ''}<button class="btn sm" data-drop title="Odebrat celý balík z fronty (nic se do Shoptetu nepošle)">Odebrat z fronty</button></div>
    <div style="overflow-x:auto"><table class="list ns-t"><thead><tr><th>Kód</th><th>Produkt</th><th>Objednávka</th><th class="r">Objednáno</th><th class="r">Dorazilo</th><th></th></tr></thead><tbody>
    ${p.lines.filter(l => !l.stocked).map(l => `<tr data-l="${esc(l.id)}" class="${l.skip ? 'ns-skip' : ''}"><td class="nowrap"><b>${esc(l.code)}</b></td><td>${esc(l.name)}</td><td class="small muted nowrap">${esc(l.orderCode || '')}</td><td class="r nowrap">${fmtQ(l.qty)} ${esc(l.unit)}</td>
      <td class="r nowrap"><input type="number" step="any" min="0" data-got value="${l.got ?? l.qty}" style="width:96px;text-align:right" ${l.skip ? 'disabled' : ''}> ${esc(l.unit)}</td>
      <td class="r"><button class="btn sm" data-skip title="${l.skip ? 'Vrátit řádek do naskladnění' : 'Tento řádek nenaskladňovat'}">${l.skip ? '↺ Vrátit' : '✕'}</button></td></tr>`).join('')}</tbody></table></div></section>`;
  el.innerHTML = `${ojPageHint()}
  ${q.length ? `<div class="panel panel-b ns-bar"><label class="chk ns-all"><input type="checkbox" id="nsAll" ${chosen.length === q.length ? 'checked' : ''}> Vybrat vše</label><span class="muted small grow">Vybráno <b>${chosen.length}</b> z ${q.length} ${q.length === 1 ? 'balíku' : 'balíků'} · ${nLines} řádků · sklad: ${esc(sk)} · do Shoptetu se <b>přičte</b> (nikdy nepřepíše)</span>
    <button class="btn primary lg" id="nsPush" ${nLines ? '' : 'disabled'}>📥 Naskladnit vybrané do Shoptetu (${nLines})</button></div>` : ''}
  ${q.map(pack).join('') || `<div class="panel empty-big"><div class="ill">✅</div><h3>Nic nečeká na naskladnění</h3><p>Až na nástěnce přesuneš objednávku do „${OJ_STAGE.delivered[0]}“, objeví se tady a ty ji ručně odklikneš do Shoptetu.</p></div>`}
  ${skipped.length ? `<details class="panel panel-b ns-skipped"><summary>Odebráno z fronty (${skipped.length})</summary>${skipped.map(a => `<div class="ns-sk"><div class="grow"><b>${esc(a.auf_number || a.order_code)}</b> <span class="muted small">${esc((ojSup(a.supplier_id) || {}).name || '')} · obj. ${esc(a.order_code)}</span></div><button class="btn sm" data-back="${a.id}">Vrátit do fronty</button></div>`).join('')}</details>` : ''}`;
  const sync = () => drawOjStockIn();
  $$('.ns-pack', el).forEach(sec => {
    const p = q.find(x => x.key === sec.dataset.k);
    $('[data-sel]', sec).onchange = e => { e.target.checked ? OJ.nsSel.add(p.key) : OJ.nsSel.delete(p.key); sync(); };
    $$('[data-got]', sec).forEach(i => i.onchange = async () => {
      const id = i.closest('tr').dataset.l; const v = toNum(i.value); if (!(v >= 0)) return;
      if (p.kind === 'auf') { OJ.nsEdit[id] = { ...(OJ.nsEdit[id] || {}), got: v }; return toast('Počet upraven'); }
      try { p.sh.lines.find(l => l.id === id).got = v; check(await sb.from('oj_shipments').update({ lines: p.sh.lines, updated_at: nowIso() }).eq('id', p.id)); toast('Uloženo'); } catch (e) { toast(e.message, true); }
    });
    $$('[data-skip]', sec).forEach(b => b.onclick = async () => {
      const id = b.closest('tr').dataset.l; const l = p.lines.find(x => x.id === id);
      if (p.kind === 'auf') { OJ.nsEdit[id] = { ...(OJ.nsEdit[id] || {}), skip: !l.skip }; return sync(); }
      try { const ln = p.sh.lines.find(x => x.id === id); ln.skip = !ln.skip; check(await sb.from('oj_shipments').update({ lines: p.sh.lines, updated_at: nowIso() }).eq('id', p.id)); drawOj(); } catch (e) { toast(e.message, true); }
    });
    $('[data-drop]', sec).onclick = async () => {
      if (!(await confirmBox('Odebrat z fronty?', p.kind === 'svoz' ? 'Všechny nenaskladněné řádky svozu se označí „nenaskladňovat“. Do Shoptetu se nic nepošle; svoz najdeš dál v záložce Svozy.' : 'Balík zmizí z fronty a nic se do Shoptetu nepošle. Najdeš ho dole v „Odebráno z fronty“ a můžeš ho vrátit.', { ok: 'Odebrat' }))) return;
      try {
        if (p.kind === 'svoz') { p.sh.lines.forEach(l => { if (!l.stocked) l.skip = true; }); check(await sb.from('oj_shipments').update({ lines: p.sh.lines, updated_at: nowIso() }).eq('id', p.id)); }
        else { check(await sb.from('oj_aufs').update({ stock_skip: true, updated_at: nowIso() }).eq('id', p.id)); p.auf.stock_skip = true; }
        drawOj(); toast('Odebráno z fronty');
      } catch (e) { toast(e.message, true); }
    };
  });
  $$('[data-back]', el).forEach(b => b.onclick = async () => { try { check(await sb.from('oj_aufs').update({ stock_skip: false, updated_at: nowIso() }).eq('id', b.dataset.back)); OJ.aufs.find(a => a.id === b.dataset.back).stock_skip = false; drawOj(); } catch (e) { toast(e.message, true); } });
  const all = $('#nsAll'); if (all) all.onchange = () => { OJ.nsSel = new Set(all.checked ? q.map(p => p.key) : []); sync(); };
  const push = $('#nsPush'); if (push) push.onclick = ojStockPush;
}
const ojPageHint = () => `<p class="muted small" style="margin:0 0 12px">Sem přibude zboží, které na nástěnce přesuneš do „${OJ_STAGE.delivered[0]}“. Zaškrtni, co chceš naskladnit, uprav počty v „Dorazilo“ (nebo řádek vyřaď) a pošli to do Shoptetu.</p>`;
async function ojStockPush() {
  const chosen = ojStockQueue().filter(p => OJ.nsSel.has(p.key));
  const list = chosen.flatMap(p => nsLeft(p));
  if (!list.length) return toast('Není co naskladňovat — všechny řádky jsou vyřazené.', true);
  const zero = list.filter(l => !(toNum(l.got ?? l.qty) > 0));
  if (zero.length) return toast('U ' + zero.map(l => l.code).join(', ') + ' je nulové množství. Doplň „Dorazilo“, nebo řádek vyřaď.', true);
  const stc = cfg(); const stockId = Number(stc.shoptetStockId) || 1; const stockName = stc.shoptetStockName || 'sklad ' + stockId;
  const odd = list.filter(l => !['ks', 'm²'].includes(l.unit)); const big = list.filter(l => toNum(l.got ?? l.qty) >= 5000).length;
  const ok = await modal({ title: 'Naskladnit do Shoptetu?',
    body: `<p>Do skladu <b>${esc(stockName)}</b> se <b>přidá</b>:</p><div class="push-list">${list.map(l => `<div><code>${esc(l.code)}</code><span>${esc(l.name)}</span><b>+${fmtQ(l.got ?? l.qty)} ${esc(l.unit)}</b></div>`).join('')}</div>
      ${odd.length ? `<p class="warn-t">⚠ U ${odd.map(l => esc(l.code)).join(', ')} je jednotka „${esc(odd[0].unit)}“. Ve Shoptetu se sklad počítá ve své jednotce (třeba m²) — ověř, že počet v „Dorazilo“ je ve stejné.</p>` : ''}${big ? `<p class="warn-t">⚠ ${big} řádků má velké množství — zkontroluj počty.</p>` : ''}
      <p class="muted small">Zápis do Shoptetu už jedním klikem nevrátíš. Co se povede, se nikdy nepošle podruhé.</p>`,
    actions: [{ label: 'Zrušit', value: false }, { label: `Naskladnit ${list.length} ${list.length === 1 ? 'řádek' : list.length < 5 ? 'řádky' : 'řádků'}`, value: true, cls: 'primary' }] });
  if (!ok) return;
  const btn = $('#nsPush'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Posílám do Shoptetu…'; }
  try {
    const shipIds = chosen.filter(p => p.kind === 'svoz').map(p => p.id);
    const loose = chosen.filter(p => p.kind === 'auf');
    if (loose.length) {
      // doručené objednávky bez svozu se vedou jako jeden příjem (svoz), ať je vidět, co se kdy naskladnilo
      const ref = nextRef(); const now = nowIso();
      const row = check(await sb.from('oj_shipments').insert({ reference: ref, title: ref, note: [...new Set(loose.map(p => p.sub).filter(Boolean))].join(' · '), status: 'arrived', delivered_at: now, created_by: S.me.id }).select().single());
      check(await sb.from('oj_aufs').update({ shipment_id: row.id, updated_at: now }).in('id', loose.map(p => p.id)));
      await loadOj();
      const lines = ojLinesFor(row.id).map(l => { const e = OJ.nsEdit[l.id]; return e ? { ...l, ...(e.got != null ? { got: e.got } : {}), ...(e.skip ? { skip: true } : {}) } : l; });
      check(await sb.from('oj_shipments').update({ lines, updated_at: now }).eq('id', row.id));
      loose.forEach(p => p.lines.forEach(l => { delete OJ.nsEdit[l.id]; }));
      shipIds.push(row.id);
    }
    let good = 0; const bad = [];
    for (const sid of shipIds) {
      const r = await shoptetCall({ action: 'svoz_stock_in', shipmentId: sid, stockId });
      good += r.results.filter(x => x.status === 'ok').length; bad.push(...r.results.filter(x => x.status === 'error'));
    }
    await loadOj(); OJ.nsSel.clear(); drawOj();
    if (!bad.length) toast(`Naskladněno do Shoptetu: ${good} řádků ✓`);
    else await modal({ title: good ? `Naskladněno ${good}, ale ${bad.length} se nepovedlo` : 'Naskladnění se nepovedlo', body: `<div class="push-list err">${bad.map(x => `<div><code>${esc(x.code)}</code><span>${esc(x.message || x.status)}</span></div>`).join('')}</div><p class="muted small">Co se povedlo, je označené. Ostatní zůstávají ve frontě a po opravě je můžeš poslat znovu.</p>`, actions: [{ label: 'Rozumím', value: null, cls: 'primary' }] });
  } catch (e) { toast(e.message, true); try { await loadOj(); } catch {} drawOj(); }
}
const ojNextStockCode = () => { const y = new Date().getFullYear(); const n = OJ.orders.map(o => (String(o.code).match(new RegExp('^NS-' + y + '-(\\d+)$')) || [])[1]).filter(Boolean).map(Number); return `NS-${y}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0')}`; };
async function ojManualOrder() {
  const v = await modal({ title: 'Nová objednávka', body: `<p class="muted small"><b>Na sklad</b> = zboží, které objednáváme jen tak (bez zákaznické objednávky), ať máme přehled, co je na cestě. <b>Zákaznická</b> = objednávka, která není ve Shoptetu ve stavu „Potřeba objednat“ (SK e-shop, zakázka…).</p>
      <label>Druh</label><div class="seg" id="kindSeg" style="width:100%"><button data-k="stock" class="on" style="flex:1">Na sklad</button><button data-k="customer" style="flex:1">Zákaznická (ruční)</button></div>
      <label>Označení objednávky</label><input data-k="code" value="${ojNextStockCode()}"><label>Číslo nabídky / reference (nepovinné — podle toho půjde hledat)</label><input data-k="ref" placeholder="např. číslo nabídky zákazníka"><label>Poznámka</label><input data-k="note" placeholder="např. doplnění skladu, akce, sezóna…">`, focus: '[data-k="note"]',
    actions: [{ label: 'Zrušit', value: null }, { label: 'Založit a přidat položky', cls: 'primary', value: bd => ({ code: $('input[data-k="code"]', bd).value.trim(), note: $('input[data-k="note"]', bd).value.trim(), ref: $('input[data-k="ref"]', bd).value.trim(), kind: $('#kindSeg .on', bd).dataset.k }) }] });
  if (!v || !v.code) return;
  try { check(await sb.from('oj_orders').insert({ code: v.code, note: v.note, ref: v.ref || '', manual: true, kind: v.kind, order_date: ymd(new Date()), active: true })); location.hash = orderHref(v.code); }
  catch (e) { toast(/duplicate|unique/i.test(e.message) ? 'Objednávka s tímto označením už existuje.' : e.message, true); }
}
document.addEventListener('click', e => { const b = e.target.closest('#kindSeg button'); if (b) { $$('#kindSeg button').forEach(x => x.classList.toggle('on', x === b)); const c = $('input[data-k="code"]'); if (c) { if (b.dataset.k === 'stock' && !c.value.trim()) c.value = ojNextStockCode(); if (b.dataset.k === 'customer' && /^NS-/.test(c.value)) c.value = ''; } } });

// =====================================================================
// NÁSTĚNKA OBJEDNÁVEK (jako Trello): sloupce = fáze, karty se přetahují myší nebo přes „⋯“
// =====================================================================
const OJ_COLS = ['order', 'ordered', 'transit', 'delivered', 'issue'];
const OJ_COL_COLOR = { rejected: 'var(--s-rejected)', postponed: 'var(--s-postponed)', sent: 'var(--s-sent)', confirmed: 'var(--s-confirmed)', draft: 'var(--muted)' };
const ojViewSeg = () => `<div class="seg" id="ojV"><button data-v="board" class="${OJ.view === 'board' ? 'on' : ''}">Nástěnka</button><button data-v="list" class="${OJ.view === 'list' ? 'on' : ''}">Seznam</button></div>`;
const ojKindSel = () => `<select id="ojKind" class="of-who" title="Druh objednávky"><option value="">Všechny objednávky</option><option value="customer" ${OJ.kind === 'customer' ? 'selected' : ''}>Zákaznické (Shoptet)</option><option value="stock" ${OJ.kind === 'stock' ? 'selected' : ''}>Na sklad (vlastní)</option></select>`;
const ojPaySel = () => `<select id="ojPay" class="of-who" title="Platba dodavateli"><option value="">Platba: vše</option><option value="unpaid" ${OJ.pay === 'unpaid' ? 'selected' : ''}>Nezaplaceno</option><option value="paid" ${OJ.pay === 'paid' ? 'selected' : ''}>Zaplaceno</option></select>`;
const ojFilterCount = () => (OJ.q ? 1 : 0) + (OJ.curSup || !OJ.sup ? 0 : 1) + (OJ.kind ? 1 : 0) + (OJ.pay ? 1 : 0);
// společný filtr nad nástěnkou i seznamem: hledání, dodavatel, druh, platba
const ojToolbar = extra => `<div class="oj-bar"><div class="search oj-q"><span class="ic">⌕</span><input id="ojq" placeholder="Hledat objednávku, zákazníka, č. obj. u dodavatele, položku…" value="${esc(OJ.q)}"></div>
  ${extra || ''}${OJ.curSup ? '' : `<select id="ojSupF" class="of-who" title="Filtrovat podle dodavatele">${supOptions(OJ.sup, 'Všichni dodavatelé')}</select>`}${ojKindSel()}${ojPaySel()}${ojFilterCount() ? `<button class="btn sm" id="ojClrF">✕ Zrušit filtry (${ojFilterCount()})</button>` : ''}
  <span class="grow"></span>${ojViewSeg()}<button class="btn primary of-new" id="ojManual">＋ Objednávka na sklad</button></div>`;
function ojBindBar() {
  $('#ojq').oninput = e => { OJ.q = e.target.value; const p = e.target.selectionStart; drawOj(); const n = $('#ojq'); n.focus(); n.setSelectionRange(p, p); };
  if ($('#ojSupF')) $('#ojSupF').onchange = e => { OJ.sup = e.target.value; drawOj(); };
  $('#ojPay').onchange = e => { OJ.pay = e.target.value; drawOj(); };
  const c = $('#ojClrF'); if (c) c.onclick = () => { OJ.q = ''; OJ.sup = ''; OJ.kind = ''; OJ.pay = ''; drawOj(); };
  $('#ojManual').onclick = ojManualOrder; ojBindView();
}
function ojBindView() { const k = $('#ojKind'); if (k) k.onchange = () => { OJ.kind = k.value; drawOj(); }; $$('#ojV button').forEach(b => b.onclick = () => { OJ.view = b.dataset.v; ls.set('vh_oj_view', OJ.view); drawOj(); }); }
function ojCard(i) {
  const o = i.o; const sup = i.sups.map(ojSupLabel).join(' · ');
  const its = i.orderable.slice(0, 3).map(x => `${esc(x.code)} · ${fmtQ(x.qty)} ${esc(unitCz(x.unit))}`).join('<br>') + (i.orderable.length > 3 ? `<br>+ ${i.orderable.length - 3} dalších` : '');
  return `<article class="card ojc${OJ.moved === o.code ? ' moved' : ''}" draggable="true" data-code="${esc(o.code)}">
    <div class="t"><span class="no">${highlight(o.code, OJ.q)}</span><span>${o.order_date ? czDate(String(o.order_date).slice(0, 10)) : ''}</span></div>
    ${o.customer ? `<div class="cu">${esc(o.customer)}</div>` : ''}
    ${o.ref ? `<div class="small"><span class="tag blue">${highlight(o.ref, OJ.q)}</span></div>` : ''}
    <div class="nt">${its || '<span class="muted">žádné položky k objednání</span>'}</div>
    ${i.aufs.length ? `<div class="small oj-ci">${i.aufs.slice(0, 2).map(a => [a.auf_number && '<b>' + esc(a.auf_number) + '</b>', a.amount_eur != null && fmtAmt(a), a.expected_at && !a.delivered_at && '📅 ' + czDate(a.expected_at)].filter(Boolean).join(' · ')).filter(Boolean).join('<br>')}</div>` : ''}
    ${i.aufs.some(a => a.status !== 'draft') ? `<div class="small oj-pay">${i.aufs.filter(a => a.status !== 'draft').slice(0, 2).map(ojPayTag).join(' ')}</div>` : ''}
    ${o.note ? `<div class="small muted oj-note">📝 ${esc(o.note)}</div>` : ''}
    ${OJ.comments.some(c => c.order_code === o.code) ? `<div class="small muted">💬 ${OJ.comments.filter(c => c.order_code === o.code).length}</div>` : ''}
    <div class="b">${sup ? `<span>${sup}</span>` : '<span class="tag">bez dodavatele</span>'}${o.kind === 'stock' ? '<span class="tag blue">na sklad</span>' : o.manual ? '<span class="tag grey">ruční</span>' : ''}${i.aufs.some(a => a.status === 'draft') ? '<span class="tag">e-mail neodeslán</span>' : ''}${waitTag(i).trim()}${i.manual ? '<span class="tag blue" title="Posunuto ručně — když se objednávka posune sama (potvrzení, svoz…), řídí se zase daty">ručně</span>' : ''}
      <span class="ojbtns"><button class="archbtn ojmv" title="Přesunout do jiného sloupce">⋯</button>${i.stage === 'delivered' ? '<button class="archbtn ojar" title="Archivovat">📦</button>' : ''}</span></div></article>`;
}
function drawOjBoard(el, list) {
  el.innerHTML = `${ojStockBanner()}
  ${ojToolbar()}
  <div class="board oj-board">${OJ_COLS.map(st => {
    const cards = list.filter(i => i.stage === st).sort((a, b) => String(b.o.order_date).localeCompare(String(a.o.order_date)) || b.o.code.localeCompare(a.o.code));
    const [lbl, sc] = OJ_STAGE[st];
    return `<section class="col" data-drop="${st}" style="--c:${OJ_COL_COLOR[sc]}"><div class="col-h">${lbl} <span class="cnt">${cards.length}</span>${st !== 'order' && cards.length ? `<button class="archbtn oj-cp" data-cp="${st}" title="Kopírovat soupis čísel objednávek u dodavatele a referencí">📋 <span class="oj-cpt">Kopírovat soupis</span></button>` : ''}</div>
      <div class="col-body">${cards.map(ojCard).join('') || '<div class="empty">Přetáhni sem kartu</div>'}</div>
      ${cards.length > 6 ? `<div class="col-more">↓ dalších ${cards.length - 6} — posuň v sloupci</div>` : ''}</section>`;
  }).join('')}</div>
  <p class="muted small" style="margin-top:8px">Kartu přetáhni do dalšího sloupce (nebo „⋯“) — otevře se okno, kam doplníš údaje: při <b>${OJ_STAGE.ordered[0]}</b> číslo objednávky, co a za kolik, při <b>${OJ_STAGE.transit[0]}</b> odhadované datum doručení, při <b>${OJ_STAGE.delivered[0]}</b> kontrolu a případnou reklamaci. Archivované a objednávky bez sledovaných položek jsou v „Seznam“.</p>`;
  ojBindBar();
  $$('.ojc', el).forEach(c => {
    c.onclick = e => { if (e.target.closest('.archbtn')) return; location.hash = orderHref(c.dataset.code); };
    c.ondragstart = e => { e.dataTransfer.setData('text/plain', c.dataset.code); e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => c.classList.add('dragging')); };
    c.ondragend = () => c.classList.remove('dragging');
  });
  limitCols(el);
  $$('.oj-cp', el).forEach(b => b.onclick = e => {
    e.stopPropagation(); const st = b.dataset.cp;
    const rows = [];
    for (const i of list.filter(x => x.stage === st)) for (const a of i.aufs) {
      const ok = st === 'ordered' ? !a.delivered_at && a.status !== 'confirmed' : st === 'transit' ? !a.delivered_at && a.status === 'confirmed' : st === 'delivered' ? !!a.delivered_at && a.delivery_status !== 'issue' : a.delivery_status === 'issue';
      if (ok) rows.push(ojRowOf(a));
    }
    ojCopyRows(rows, `Soupis: ${OJ_STAGE[st][0]}${OJ.curSup ? ' · ' + (ojSup(OJ.curSup) || {}).name : ''}`);
  });
  $$('.ojmv', el).forEach(b => b.onclick = async e => {
    e.stopPropagation(); const code = b.closest('.ojc').dataset.code; const inf = ojInfo(OJ.orders.find(x => x.code === code), OJ.curSup || undefined);
    const v = await popMenu(b, OJ_COLS.filter(c => c !== inf.stage).map(c => ({ label: '→ ' + OJ_STAGE[c][0], value: c, s: OJ_STAGE[c][1] })));
    if (v) ojMove(code, v);
  });
  $$('.ojar', el).forEach(b => b.onclick = async e => {
    e.stopPropagation(); const code = b.closest('.ojc').dataset.code;
    try { check(await sb.from('oj_orders').update({ archived: true, updated_at: nowIso() }).eq('code', code)); OJ.orders.find(x => x.code === code).archived = true; drawOj(); toast('Objednávka je v archivu (najdeš ji v „Seznam → Archiv“)'); } catch (er) { toast(er.message, true); }
  });
  $$('.col', el).forEach(col => {
    let depth = 0;
    col.ondragenter = e => { e.preventDefault(); depth++; col.classList.add('over'); };
    col.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
    col.ondragleave = () => { if (--depth <= 0) { depth = 0; col.classList.remove('over'); } };
    col.ondrop = e => { e.preventDefault(); depth = 0; col.classList.remove('over'); ojMove(e.dataTransfer.getData('text/plain'), col.dataset.drop); };
  });
}
// přetažení karty = skutečná změna stavu objednávky u dodavatele (vždy po jednom dodavateli)
async function ojMove(code, target) {
  const o = OJ.orders.find(x => x.code === code); if (!o) return;
  const sids = OJ.curSup ? [OJ.curSup] : [...new Set(ojInfo(o).sups.map(x => x.id))];
  if (!sids.length) return toast('Objednávka nemá sledovaného dodavatele — přiřaď ho v detailu.', true);
  try {
    let did = false;
    for (const sid of sids) { const ok = await ojMoveSup(o, sid, target); if (ok === false) break; did = true; }
    await loadOj(); OJ.moved = did ? code : ''; drawOj(); OJ.moved = '';
  } catch (e) { toast(e.message, true); }
}
const ojStageOf = (o, sid) => ojInfo(o, sid).stage;
async function ojMoveSup(o, sid, target) {
  const sup = ojSup(sid); let from = ojStageOf(o, sid);
  if (from === target) return true;
  const inf = () => ojInfo(o, sid);
  const aufsOf = st => inf().aufs.filter(a => st(a));
  const RK = { order: 1, ordered: 2, transit: 3, delivered: 4, issue: 5 };
  if (from === 'issue' && target === 'delivered') {
    const as = aufsOf(a => a.delivery_status === 'issue' && !a.issue_resolved_at);
    for (const a of as) check(await sb.from('oj_aufs').update({ issue_resolved_at: nowIso(), updated_at: nowIso() }).eq('id', a.id));
    toast('Reklamace vyřešena'); return true;
  }
  // dopředu
  if (RK[target] > RK[from]) {
    if (from === 'order') {
      if (target === 'issue' || target === 'delivered') { toast('Nejdřív zadej objednání.', true); return false; }
      if (!(await ojOrderedDialog(o, sid))) return false;
      await loadOj(); from = ojStageOf(o, sid);
    }
    if (target === 'ordered') return true;
    if (from === 'ordered') {
      if (!(await ojTransitDialog(o, sid, target === 'transit'))) return false;
      await loadOj(); from = ojStageOf(o, sid);
    }
    if (target === 'transit') return true;
    return await ojDeliveredDialog(o, sid, target === 'issue');
  }
  // zpět
  if (target === 'order') {
    const as = aufsOf(a => !a.delivered_at && !a.shipment_id);
    if (!as.length) { toast('Tuhle objednávku už nejde vrátit — je přijatá. Uprav ji v detailu.', true); return false; }
    if (!(await confirmBox('Zrušit objednání?', `Objednávka u ${sup.name} se smaže a položky se vrátí do „${OJ_STAGE.order[0]}“. E-mail, který už odešel, tím nevezmeš zpět.`, { ok: 'Zrušit objednání', danger: true }))) return false;
    for (const a of as) check(await sb.from('oj_aufs').delete().eq('id', a.id));
    toast('Vráceno do „' + OJ_STAGE.order[0] + '“'); return true;
  }
  if (from === 'delivered' || from === 'issue') {
    const as = aufsOf(a => a.delivered_at && !a.shipment_id);
    if (!as.length) { toast('Zboží je přijaté přes příjem (svoz) — uprav ho tam nebo v detailu objednávky.', true); return false; }
    for (const a of as) check(await sb.from('oj_aufs').update({ delivered_at: null, delivery_status: '', delivery_note: '', issue_resolved_at: null, updated_at: nowIso() }).eq('id', a.id));
    from = 'transit';
    if (target === 'transit') return true;
  }
  if (target === 'ordered') { for (const a of aufsOf(x => x.status === 'confirmed' && !x.delivered_at)) check(await sb.from('oj_aufs').update({ status: 'sent', confirmed_at: null, updated_at: nowIso() }).eq('id', a.id)); toast('Vráceno do „' + OJ_STAGE.ordered[0] + '“'); }
  return true;
}
const ojCurSel = cur => `<select data-k="cur" style="width:auto">${['EUR', 'USD', 'CZK'].map(c => `<option ${c === (cur || 'EUR') ? 'selected' : ''}>${c}</option>`).join('')}</select>`;
// okno „Objednáno“: číslo objednávky, co se objednalo, za kolik
// Shoptet: do objednávky zapíše číslo objednávky u dodavatele (interní poznámka) a přepne ji do stavu „Čeká na zboží“
const ojShoptetEligible = (o, sup) => !!o && !o.manual && o.kind !== 'stock' && !!sup && sup.active !== false;
const ojPushBox = (o, sup, on = true) => ojShoptetEligible(o, sup) ? `<label class="chk" style="display:flex;gap:8px;align-items:flex-start;margin-top:12px"><input type="checkbox" data-k="push" ${on ? 'checked' : ''}> <span>Propsat do Shoptetu: zapsat č. objednávky u dodavatele do poznámky objednávky <b>${esc(o.code)}</b> a přepnout ji do stavu <b>${esc((S.settings.data.ojWaitStatusName || 'Čeká na zboží'))}</b></span></label>` : '';
async function ojPushRef(o, sup, ref) {
  if (!ref) return;
  try {
    const { data, error } = await sb.functions.invoke('hub-orders', { body: { action: 'supplier_ref', orderCode: o.code, supplier: sup.name, ref, setStatus: true } });
    if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch {} throw new Error(m); }
    if (data && data.error) throw new Error(data.error);
    const bits = [];
    if (data.remark === 'added') bits.push('poznámka zapsána'); else if (data.remark === 'exists') bits.push('poznámka už tam byla');
    if (data.status === 'changed') bits.push(`stav → ${data.statusName}`); else if (data.status === 'already') bits.push(`stav už je ${data.statusName}`);
    const probs = [data.remark === 'failed' && 'Poznámku se nepodařilo zapsat: ' + data.remarkError, (data.status === 'failed' || data.status === 'notfound') && 'Stav se nepodařilo změnit: ' + data.statusError].filter(Boolean);
    if (data.status === 'changed') { try { await sb.from('oj_orders').update({ shoptet_status: data.statusName, updated_at: nowIso() }).eq('code', o.code); o.shoptet_status = data.statusName; } catch {} }
    if (probs.length) await modal({ title: 'Shoptet: část se nepovedla', body: `<p>${bits.length ? 'Povedlo se: ' + esc(bits.join(', ')) + '.' : ''}</p><ul class="problems">${probs.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p class="muted small">Vlastní objednávka v aplikaci je uložená. Zkontroluj objednávku ${esc(o.code)} ve Shoptetu a případně dopiš ručně.</p>`, actions: [{ label: 'Rozumím', value: null, cls: 'primary' }] });
    else toast('Shoptet · ' + o.code + ': ' + bits.join(', '));
  } catch (e) { toast('Shoptet: ' + e.message, true); }
}
async function ojOrderedDialog(o, sid) {
  const sup = ojSup(sid); const inf = ojInfo(o, sid); const todo = inf.todo;
  if (!todo.length) { toast('Není co objednávat.', true); return false; }
  const v = await modal({ title: `Objednáno u ${sup.name}`,
    body: `<p class="muted small">Objednávka ${esc(o.code)}${o.ref ? ' · ' + esc(o.ref) : ''}. Označ, co jsi objednal (množství jde upravit). <b>Neoznačené položky se označí „neobjednávat“</b> (např. máme skladem).</p>
      <label>Číslo objednávky u dodavatele (potvrzení)</label><input data-k="n" placeholder="číslo z potvrzení od dodavatele">
      <label>Co se objednalo</label><div class="ord-list">${todo.map(i => `<div class="ord-row" data-key="${esc(i.key)}"><label class="chk"><input type="checkbox" checked> <b>${esc(i.code)}</b> <span class="muted small">${esc(i.name)}</span></label><input type="number" step="any" min="0" class="ord-q" value="${i.qty}" inputmode="decimal"><span class="muted small">${esc(unitCz(i.unit))}</span></div>`).join('')}</div>
      <label>Nákupka — hodnota objednávky</label><div style="display:grid;grid-template-columns:1fr 90px;gap:8px"><input data-k="a" inputmode="decimal" placeholder="např. 1500,53">${ojCurSel('EUR')}</div>
      <label>Zaplaceno dne (nepovinné — když už je zaplaceno / záloha)</label><input type="date" data-k="pd">
      <label>Poznámka</label><textarea data-k="note" rows="2" placeholder="např. zbytek máme skladem, doprava paletou…">${esc(o.note || '')}</textarea>${ojPushBox(o, sup)}`, focus: '[data-k="n"]',
    actions: [{ label: 'Zrušit', value: null }, { label: 'Uložit: objednáno', cls: 'primary', value: bd => ({ n: $('[data-k="n"]', bd).value.trim(), a: toNum($('[data-k="a"]', bd).value), cur: $('[data-k="cur"]', bd).value, note: $('textarea[data-k="note"]', bd).value.trim(), pd: $('[data-k="pd"]', bd).value || null, push: !!($('[data-k="push"]', bd) || {}).checked, rows: $$('.ord-row', bd).map(r => ({ key: r.dataset.key, on: $('input[type=checkbox]', r).checked, qty: toNum($('.ord-q', r).value) })) }) }] });
  if (!v) return false;
  const chosen = v.rows.filter(r => r.on && r.qty > 0);
  if (!chosen.length) { toast('Nic jsi neoznačil.', true); return false; }
  const now = nowIso();
  const lines = chosen.map(r => { const i = todo.find(x => x.key === r.key); const pr = OJ.products[i.code] || {}; return { key: i.key, ourCode: i.code, code: pr.supplier_code || '', name: pr.supplier_name || '', csName: i.name, qty: r.qty, unit: unitCz(i.unit) }; });
  const row = check(await sb.from('oj_aufs').insert({ order_code: o.code, supplier_id: sid, status: 'sent', email_to: sup.email || '', subject: '', body: '', lines, sent_at: now, auf_number: v.n, amount_eur: v.a > 0 ? v.a : null, currency: v.cur, note: v.note, paid_at: v.pd, due_at: v.pd ? null : ojDueFromNow(), created_by: S.me.id }).select().single());
  for (const r of chosen) check(await sb.from('oj_items').update({ auf_id: row.id, decision: 'order', qty: r.qty }).eq('key', r.key));
  for (const r of v.rows.filter(x => !x.on)) check(await sb.from('oj_items').update({ decision: 'skip' }).eq('key', r.key));
  if (v.note && v.note !== o.note) { check(await sb.from('oj_orders').update({ note: v.note, updated_at: now }).eq('code', o.code)); o.note = v.note; }
  toast(`Objednáno u ${sup.name}`, { action: { label: 'Napsat e-mail', fn: () => ojAufMail(row.id) } });
  if (v.push && v.n) await ojPushRef(o, sup, v.n);
  return true;
}
// okno „Na cestě“: odhadované datum doručení (+ číslo potvrzení)
async function ojTransitDialog(o, sid, final) {
  const sup = ojSup(sid); const as = ojInfo(o, sid).aufs.filter(a => !a.delivered_at && a.status !== 'confirmed');
  if (!as.length) return true;
  const v = await modal({ title: `Na cestě od ${sup.name}`,
    body: `<p class="muted small">Dodavatel zboží potvrdil / odeslal. Doplň odhadované datum doručení — uvidíš ho v přehledu „Na cestě“.</p>
      ${as.map(a => `<div class="ord-aufrow" data-id="${a.id}" style="margin:10px 0;padding:10px;border:1px solid var(--line);border-radius:12px"><div class="small muted">${a.lines.map(l => `${esc(l.code || l.ourCode)} · ${fmtQ(l.qty)} ${esc(l.unit)}`).join(' | ')}</div>
        <label>Číslo objednávky u dodavatele</label><input data-k="n" value="${esc(a.auf_number)}" placeholder="číslo potvrzení od dodavatele">
        <label>Odhadované datum doručení</label><input type="date" data-k="e" value="${esc(a.expected_at || '')}"></div>`).join('')}${ojPushBox(o, sup)}`, focus: '[data-k="e"]',
    actions: [{ label: 'Zrušit', value: null }, { label: 'Uložit: na cestě', cls: 'primary', value: bd => ({ push: !!($('[data-k="push"]', bd) || {}).checked, rows: $$('.ord-aufrow', bd).map(r => ({ id: r.dataset.id, n: $('[data-k="n"]', r).value.trim(), e: $('[data-k="e"]', r).value || null })) }) }] });
  if (!v) return false;
  const now = nowIso();
  for (const r of v.rows) check(await sb.from('oj_aufs').update({ auf_number: r.n, expected_at: r.e, status: 'confirmed', confirmed_at: now, updated_at: now }).eq('id', r.id));
  if (final) toast('Označeno jako na cestě');
  if (v.push) for (const r of v.rows) { const prev = as.find(x => x.id === r.id); if (r.n) await ojPushRef(o, sup, r.n); }
  return true;
}
// okno „Doručeno“: v pořádku / reklamace / zkontrolovat a naskladnit
async function ojDeliveredDialog(o, sid, issueFirst) {
  const sup = ojSup(sid); const as = ojInfo(o, sid).aufs.filter(a => !a.delivered_at || (a.delivery_status === 'issue' && !a.issue_resolved_at));
  if (!as.length) return true;
  const v = await modal({ title: `Doručeno od ${sup.name}`,
    body: `<p class="muted small">Co přesně dorazilo? Vyber, jak to dopadlo.</p>
      <div class="seg" id="dlvSeg" style="width:100%"><button data-k="ok" class="${issueFirst ? '' : 'on'}" style="flex:1">Doručeno v pořádku</button><button data-k="issue" class="${issueFirst ? 'on' : ''}" style="flex:1">Reklamace</button></div>
      <label>Poznámka (u reklamace: co je špatně)</label><textarea data-k="note" rows="3" placeholder="např. chybí 2 balení, poškozená paleta…"></textarea>
      <p class="muted small" style="margin-top:10px">Chceš zboží rovnou <b>zkontrolovat po kusech a naskladnit do Shoptetu</b>? Použij poslední tlačítko.</p>`, focus: '[data-k="note"]',
    actions: [{ label: 'Zrušit', value: null }, { label: 'Uložit', value: bd => ({ mode: $('#dlvSeg .on', bd).dataset.k, note: $('textarea[data-k="note"]', bd).value.trim(), check: false }) }, { label: 'Zkontrolovat a naskladnit ›', cls: 'primary', value: bd => ({ mode: 'ok', note: $('textarea[data-k="note"]', bd).value.trim(), check: true }) }] });
  if (!v) return false;
  const now = nowIso();
  if (v.check) { await ojReceiveAuf(as.map(a => a.id)); return false; }
  for (const a of as) check(await sb.from('oj_aufs').update({ delivery_status: v.mode, delivery_note: v.note, delivered_at: a.delivered_at || now, issue_resolved_at: null, updated_at: now }).eq('id', a.id));
  toast(v.mode === 'issue' ? 'Označeno jako reklamace' : 'Označeno jako doručeno');
  return true;
}
document.addEventListener('click', e => { const b = e.target.closest('#dlvSeg button'); if (b) $$('#dlvSeg button').forEach(x => x.classList.toggle('on', x === b)); });
// e-mail k už vytvořenému objednání
async function ojAufMail(aufId) {
  await loadOj(); const a = OJ.aufs.find(x => x.id === aufId); if (!a) return; const sup = ojSup(a.supplier_id); const o = OJ.orders.find(x => x.code === a.order_code);
  if (!(await ojFillMissing(a.lines.map(l => ({ code: l.ourCode, name: l.csName || l.name })), sup))) return;
  const lines = a.lines.map(l => { const pr = OJ.products[l.ourCode] || {}; return { ...l, code: pr.supplier_code || l.code || '', name: pr.supplier_name || l.name || '' }; });
  const v = await ojMailDialog({ order: o, sup, mail: a.body ? { to: a.email_to, subject: a.subject, body: a.body } : ojBuildMail(o, sup, lines), auf: { ...a, status: 'draft' } });
  if (!v) return;
  check(await sb.from('oj_aufs').update({ email_to: v.to, subject: v.subject, body: v.body, lines, updated_at: nowIso() }).eq('id', aufId));
  await loadOj(); drawOj(); toast('E-mail uložen k objednávce');
}

// =====================================================================
// HISTORIE POHYBŮ SKLADOVÝCH ZÁSOB — odkud (příjemka / objednávka dodavateli / kontejner / nabídka), kdo, kdy, kolik
// =====================================================================
const MV = { rows: [], q: '', src: '', who: '', from: '', to: '', more: false, loading: false };
const MV_SRC = [['', 'Vše'], ['receipt', 'Příjemky'], ['svoz', 'Objednávky dodavatelům'], ['container', 'Kontejnery'], ['order', 'Nabídky → objednávky']];
function mvQuery(from, to) {
  let q = sb.from('stock_history').select('*').order('at', { ascending: false });
  if (MV.src) q = q.eq('source', MV.src);
  if (MV.who) q = q.eq('actor', MV.who);
  if (MV.from) q = q.gte('at', MV.from + 'T00:00:00');
  if (MV.to) q = q.lte('at', MV.to + 'T23:59:59');
  const t = MV.q.trim().replace(/[%,()]/g, ' ');
  if (t) q = q.or(`code.ilike.%${t}%,reference.ilike.%${t}%,extra.ilike.%${t}%`);
  return q.range(from, to);
}
const mvLink = r => ({ receipt: '#/s/' + r.ref_id, svoz: '#/svoz/' + r.ref_id, container: hasApp('kontejnery') ? '#/k/' + r.ref_id : '', order: '#/o/' + r.ref_id })[r.source] || '';
async function renderMoves() {
  shell('moves', `<div class="topbar"><h1>Historie pohybů</h1></div><div class="panel panel-b"><div class="sk" style="height:220px"></div></div>`);
  try { await Promise.all([loadSettings(), loadProducts()]); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  $('#main').innerHTML = `${pgHead('moves', 'Historie pohybů', 'Každý pohyb zásob, který aplikace poslala do Shoptetu: z jaké příjemky, objednávky, kontejneru, nabídky nebo inventury, kdo to udělal a kdy.')}
  <div class="topbar" style="gap:8px"><div class="search grow" style="max-width:420px"><span class="ic">⌕</span><input id="mvq" placeholder="Hledat kód zboží, číslo dokladu, kontejner…" value="${esc(MV.q)}"></div>
    <select id="mvwho" class="of-who"><option value="">Všichni uživatelé</option>${S.users.map(u => `<option value="${u.id}" ${MV.who === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
    <input type="date" id="mvfrom" value="${MV.from}" title="Od"><input type="date" id="mvto" value="${MV.to}" title="Do"><button class="btn sm" id="mvcsv">⬇ CSV</button></div>
  <div class="chips" id="mvsrc" style="margin-bottom:12px">${MV_SRC.map(([k, l]) => `<button class="chip ${MV.src === k ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
  <div id="mvsum" class="muted small" style="margin-bottom:8px"></div><div id="mvList"></div><div style="text-align:center;margin:14px 0"><button class="btn" id="mvmore" hidden>Načíst starší</button></div>`;
  let t = null; $('#mvq').oninput = e => { MV.q = e.target.value; clearTimeout(t); t = setTimeout(() => mvLoad(true), 300); };
  $('#mvwho').onchange = e => { MV.who = e.target.value; mvLoad(true); }; $('#mvfrom').onchange = e => { MV.from = e.target.value; mvLoad(true); }; $('#mvto').onchange = e => { MV.to = e.target.value; mvLoad(true); };
  $$('#mvsrc .chip').forEach(c => c.onclick = () => { MV.src = c.dataset.s; $$('#mvsrc .chip').forEach(x => x.classList.toggle('on', x === c)); mvLoad(true); });
  $('#mvmore').onclick = () => mvLoad(false);
  $('#mvcsv').onclick = mvCsv;
  mvLoad(true);
}
async function mvLoad(reset) {
  if (MV.loading) return; MV.loading = true;
  try {
    const start = reset ? 0 : MV.rows.length;
    const rows = check(await mvQuery(start, start + 99));
    MV.rows = reset ? rows : MV.rows.concat(rows); MV.more = rows.length === 100;
    mvDraw();
  } catch (e) { const l = $('#mvList'); if (l) l.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  MV.loading = false;
}
function mvDraw() {
  const el = $('#mvList'); if (!el) return;
  const stName = id => id == null ? '' : (Number(cfg().shoptetStockId) === Number(id) && cfg().shoptetStockName) ? cfg().shoptetStockName : 'sklad ' + id;
  const nameOf = c => ((S.products || []).find(p => p.code === c) || {}).name || '';
  const inn = MV.rows.filter(r => Number(r.amount) > 0).reduce((x, r) => x + Number(r.amount), 0), out = MV.rows.filter(r => Number(r.amount) < 0).reduce((x, r) => x + Number(r.amount), 0);
  $('#mvsum').innerHTML = MV.rows.length ? `Zobrazeno ${MV.rows.length} pohybů · přírůstek <b style="color:var(--ok,#16804a)">+${fmtQ(inn)}</b> · úbytek <b style="color:var(--danger)">${fmtQ(out)}</b>` : '';
  el.innerHTML = MV.rows.length ? `<div class="panel" style="overflow-x:auto"><table class="list"><thead><tr><th>Kdy</th><th class="r">Pohyb</th><th>Zboží</th><th>Odkud</th><th>Doklad</th><th>Kdo</th><th>Sklad</th></tr></thead><tbody>
    ${MV.rows.map(r => { const a = Number(r.amount); const href = mvLink(r); return `<tr><td class="nowrap">${esc(czDateTime(r.at))}</td><td class="r nowrap"><b style="color:${a >= 0 ? 'var(--ok,#16804a)' : 'var(--danger)'}">${a > 0 ? '+' : ''}${fmtQ(a)}</b></td>
      <td><b>${highlight(r.code, MV.q)}</b>${nameOf(r.code) ? `<div class="muted small">${esc(nameOf(r.code))}</div>` : ''}</td><td>${esc(r.source_label)}</td>
      <td>${href ? `<a href="${href}"><u>${highlight(r.reference || '—', MV.q)}</u></a>` : highlight(r.reference || '—', MV.q)}${r.extra ? `<div class="muted small">${esc(r.extra)}</div>` : ''}</td><td>${esc(userName(r.actor)) || '—'}</td><td class="muted small">${esc(stName(r.stock_id)) || ''}</td></tr>`; }).join('')}</tbody></table></div>`
    : '<div class="panel empty-big"><div class="ill">📜</div><h3>Žádné pohyby</h3><p>Pro tyhle filtry zatím nic není. Pohyby se tu objevují, jakmile naskladníš příjemku, kontejner, zásilku od dodavatele nebo založíš objednávku z nabídky.</p></div>';
  const m = $('#mvmore'); if (m) m.hidden = !MV.more;
}
async function mvCsv() {
  try {
    let all = [], start = 0;
    for (;;) { const rows = check(await mvQuery(start, start + 999)); all = all.concat(rows); if (rows.length < 1000 || all.length >= 20000) break; start += 1000; }
    const head = ['datum', 'pohyb', 'kod', 'nazev', 'odkud', 'doklad', 'poznamka', 'uzivatel', 'sklad'];
    const nameOf = c => ((S.products || []).find(p => p.code === c) || {}).name || '';
    const csv = '﻿' + [head, ...all.map(r => [new Date(r.at).toISOString(), String(r.amount).replace('.', ','), r.code, nameOf(r.code), r.source_label, r.reference, r.extra, userName(r.actor), r.stock_id ?? ''])].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'Historie_pohybu_skladu.csv'; document.body.appendChild(a); a.click(); a.remove();
    toast(`Staženo ${all.length} pohybů`);
  } catch (e) { toast(e.message, true); }
}

// ---------- doplnění kódu dodavatele (MPN) a anglického názvu před e-mailem ----------
// kód v e-mailu musí být ten, který zná dodavatel (MPN) — ne náš; doplněné údaje se uloží k produktu a příště už se neptám
async function ojFillMissing(items, sup) {
  const cz = sup.country === 'CZ';
  for (;;) {
    const miss = cz ? [] : items.filter(i => { const pr = OJ.products[i.code] || {}; return !pr.supplier_name && !OJ.fillSkip.has(i.code); });
    if (!miss.length) return true;
    const v = await modal({ title: 'Doplň údaje pro dodavatele',
      body: `<p class="muted small">Dodavateli <b>${esc(sup.name)}</b> pošleme <b>anglický název</b> produktu — dodavatel z něj pozná, co objednáváme. Kód dodavatele (MPN) je <b>nepovinný</b>; naše vlastní kódy se do e-mailu nikdy nedávají. Co doplníš, uloží se k produktu a příště se ptát nebudu.</p>
      <div style="max-height:52vh;overflow:auto">${miss.map(i => { const pr = OJ.products[i.code] || {}; return `<div class="fillrow" data-c="${esc(i.code)}" style="margin:10px 0;padding:10px;border:1px solid var(--line);border-radius:12px">
        <div><b>${esc(i.code)}</b> <span class="muted small">${esc(i.name)}</span></div>
        <label>Anglický název</label><input data-k="supplier_name" value="${esc(pr.supplier_name || '')}" placeholder="např. Decking board WPC dark brown, 3.6 m">
        <label>Kód u dodavatele (MPN) — nepovinné</label><input data-k="supplier_code" value="${esc(pr.supplier_code || (/^[A-Z]\d{2}[0-9A-Z]{9}$/.test(i.code) ? i.code : ''))}" placeholder="můžeš nechat prázdné"></div>`; }).join('')}</div>`,
      actions: [{ label: 'Zrušit', value: null }, { label: 'Pokračovat bez toho', value: 'skip' }, { label: 'Uložit a pokračovat', cls: 'primary', value: bd => $$('.fillrow', bd).map(r => ({ code: r.dataset.c, supplier_code: $('[data-k="supplier_code"]', r).value.trim(), supplier_name: ($('[data-k="supplier_name"]', r) || { value: undefined }).value?.trim() })) }] });
    if (!v) return false;
    if (v === 'skip') { miss.forEach(i => OJ.fillSkip.add(i.code)); return true; }
    try {
      for (const r of v) {
        const f = { updated_at: nowIso() }; const pr = OJ.products[r.code] || {};
        if (r.supplier_code) f.supplier_code = r.supplier_code;
        if (r.supplier_name) f.supplier_name = r.supplier_name;
        if (Object.keys(f).length > 1) { check(await sb.from('oj_products').update(f).eq('code', r.code)); Object.assign(pr, f); OJ.products[r.code] = pr; }
      }
    } catch (e) { toast(e.message, true); return false; }
    miss.forEach(i => OJ.fillSkip.add(i.code));
  }
}
const ojMailto = m => `mailto:${m.to.replace(/\s/g, '')}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body.replace(/\r?\n/g, '\r\n'))}`;
const ojGmail = m => `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(m.to.replace(/\s/g, ''))}&su=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
const ojOutlook = m => `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(m.to.replace(/\s/g, ''))}&subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
function ojOpenUrl(u, blank) { const a = document.createElement('a'); a.href = u; if (blank) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } document.body.appendChild(a); a.click(); a.remove(); }

// ---------- e-mail dodavateli s referencí (číslo objednávky) ----------
function ojBuildMail(order, sup, lines) {
  const cz = sup.country === 'CZ';
  const unitEn = u => ({ ks: 'pcs', 'm²': 'm²', bal: 'pack(s)' })[u] || u;
  const q = n => cz ? fmtQ(n).replace(/\s/g, '') : String(Math.round(Number(n) * 1000) / 1000);
  // do e-mailu jde kód dodavatele (MPN), pokud ho máme — náš interní kód tam nikdy není; u zahraničních dodavatelů anglický název
  const txt = lines.map((l, i) => { const pr = OJ.products[l.ourCode] || {}; const nm = cz ? (l.csName || '') : (pr.supplier_name || l.name || l.csName || ''); const head = [l.code, nm].filter(Boolean).join(' – ') || l.ourCode; return `${i + 1}. ${head} – ${q(l.qty)} ${cz ? l.unit : unitEn(l.unit)}`; });
  const sig = cfg().ojSignature || `${cz ? 'S pozdravem' : 'Best regards'},\n${S.me.name}\nVinylor.cz`;
  const ref = order.code;
  const body = cz
    ? [sup.contact ? `Dobrý den, ${sup.contact},` : 'Dobrý den,', '', `rádi bychom objednali${sup.customer_no ? ` (zákaznické č. ${sup.customer_no})` : ''}:`, '', ...txt, '', 'Prosíme o potvrzení objednávky a termín dodání.', '', `Naše reference objednávky: ${ref}`, '', 'Děkujeme.', '', sig].join('\n')
    : [sup.contact ? `Dear ${sup.contact},` : 'Dear Sir or Madam,', '', `we would like to place the following order${sup.customer_no ? ` (customer no. ${sup.customer_no})` : ''}:`, '', ...txt, '', 'Please confirm the order and let us know the expected delivery date.', '', `Our order reference: ${ref}`, '', 'Thank you in advance.', '', sig].join('\n');
  return { to: sup.email || '', subject: (cz ? 'Objednávka ' : 'Purchase order ') + ref, body };
}
// e-mailové okno: u nové objednávky umí AUF zároveň založit
async function ojMailDialog({ order, sup, mail, auf }) {
  const get = bd => ({ to: $('#mlTo', bd).value.trim(), subject: $('#mlSub', bd).value.trim(), body: $('#mlBody', bd).value });
  const canSend = !auf || auf.status === 'draft';
  // Enter v okně spouští POSLEDNÍ tlačítko, proto je poslední neškodné „Otevřít v e-mailu“ (okno se po něm znovu otevře)
  const actions = [{ label: 'Zavřít', value: null },
    { label: 'Kopírovat text', value: bd => { const m = get(bd); navigator.clipboard?.writeText(m.body).then(() => toast('Zkopírováno')); return { keep: true, ...m }; } },
    { label: 'Gmail', value: bd => { const m = get(bd); ojOpenUrl(ojGmail(m), true); return { keep: true, ...m }; } },
    { label: 'Outlook', value: bd => { const m = get(bd); ojOpenUrl(ojOutlook(m), true); return { keep: true, ...m }; } },
    ...(auf ? [] : [{ label: 'Uložit jen koncept', value: bd => ({ ...get(bd), sent: false }) }]),
    ...(canSend ? [{ label: 'Označit jako odesláno', value: bd => { const m = get(bd); if (!m.to) { toast('Doplň e-mail příjemce.', true); return { keep: true, ...m }; } return { ...m, sent: true }; }, cls: 'solid' }] : []),
    { label: 'Otevřít v e-mailu', cls: 'primary', value: bd => { const m = get(bd); ojOpenUrl(ojMailto(m)); return { keep: true, ...m }; } }];
  for (;;) {
    const v = await modal({ title: `E-mail dodavateli · ${sup.name}`,
      body: `<label>Komu</label><input id="mlTo" value="${esc(mail.to)}"><label>Předmět</label><input id="mlSub" value="${esc(mail.subject)}"><label>Text · reference <b>${esc(order.code)}</b></label><textarea id="mlBody" rows="14">${esc(mail.body)}</textarea>
      ${mail.to ? '' : '<p class="warn-t">⚠ Dodavatel nemá vyplněný e-mail — doplň ho výše nebo v záložce Dodavatelé.</p>'}<p class="muted small">Postup: klikni <b>Gmail</b>, <b>Outlook</b> nebo <b>Otevřít v e-mailu</b> (výchozí pošta) → odešli → vrať se sem a dej <b>Označit jako odesláno</b>. Objednávka pak čeká na potvrzení od dodavatele.</p>`, focus: '#mlBody', actions });
    if (v && v.keep) { mail = { to: v.to, subject: v.subject, body: v.body }; continue; }
    return v;
  }
}

// =====================================================================
// detail objednávky: položky → dodavatel → e-mail s referencí → AUF
// =====================================================================
async function renderOjOrder(code) {
  shell('orders', `<div class="topbar"><h1>Objednávka</h1></div><div class="panel panel-b"><div class="sk" style="height:260px"></div></div>`);
  try { await Promise.all([loadSettings(), loadOj(), loadProducts()]); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const order = () => OJ.orders.find(o => o.code === code);
  if (!order()) { $('#main').innerHTML = `<div class="panel empty-big"><div class="ill">🤷</div><h3>Objednávka ${esc(code)} nenalezena</h3><button class="btn primary" onclick="location.hash='#/objednavky'">Zpět</button></div>`; return; }
  const reload = async () => { await loadOj(); draw(); };
  const main = $('#main');
  main.innerHTML = `<div class="topbar"><a class="btn" href="#/objednavky">← Objednávky</a><h1 id="oTitle" style="margin:0"></h1><span id="oBadge"></span><span class="grow"></span><button class="btn" id="oArch"></button></div><div id="oBody"></div>
    <section class="panel oj-cm" id="oCm"><div class="panel-h">💬 Komentáře</div><div class="panel-b"><div id="oCmList" class="cms"></div>
      <div class="cm-new"><textarea id="oCmNew" rows="2" placeholder="Napiš komentář… (Ctrl+Enter odešle)"></textarea><button class="btn primary" id="oCmPost">Přidat komentář</button></div></div></section>`;
  $('#oCmPost').onclick = () => sendOjComment();
  $('#oCmNew').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendOjComment(); };
  main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');

  function draw() {
    const o = order(); if (!o) return; const inf = ojInfo(o);
    $('#oTitle').textContent = o.code; $('#oBadge').innerHTML = `<span class="st" data-s="${OJ_STAGE[inf.stage][1]}">${OJ_STAGE[inf.stage][0]}</span>`;
    $('#oArch').textContent = o.archived ? 'Vrátit z archivu' : 'Archivovat';
    $('#oArch').onclick = async () => { try { check(await sb.from('oj_orders').update({ archived: !o.archived, updated_at: nowIso() }).eq('code', code)); await reload(); } catch (e) { toast(e.message, true); } };
    // položky seskupené podle dodavatele
    const grp = new Map();
    for (const it of inf.items) { const sid = (OJ.products[it.code] || {}).supplier_id || ''; if (!grp.has(sid)) grp.set(sid, []); grp.get(sid).push(it); }
    const order_ = [...grp.keys()].sort((a, b) => (a === '') - (b === ''));
    $('#oBody').innerHTML = `
      <div class="panel panel-b" style="margin-bottom:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
        <div><label>Datum</label><div>${esc(String(o.order_date).slice(0, 10)) || '—'}</div></div>${o.kind === 'stock' ? '<div><label>Druh</label><div><span class="tag blue">na sklad</span> vlastní objednávka</div></div>' : `<div><label>Zákazník</label><div>${esc(o.customer) || '—'}</div></div>`}
        <div><label>Stav ve Shoptetu</label><div>${esc(o.shoptet_status) || (o.manual ? 'ruční objednávka' : '—')}</div></div>
        <div><label>Číslo nabídky / reference</label><input id="oRef" value="${esc(o.ref || '')}" placeholder="např. 26900021 nebo jméno zákazníka"></div>
        <div style="grid-column:1/-1"><label>Poznámka</label><input id="oNote" value="${esc(o.note)}" placeholder="např. objednáno jen 18 balení, zbytek máme skladem"></div></div>
      ${order_.map(sid => { const s = ojSup(sid); const its = grp.get(sid); const todo = its.filter(i => !ojItemSkipped(i) && !i.auf_id);
        return `<div class="panel" style="margin-bottom:14px;overflow-x:auto"><div style="display:flex;gap:10px;align-items:center;padding:12px 14px;flex-wrap:wrap"><b style="font-size:15px">${s ? ojSupLabel(s) : '⚠ Bez dodavatele'}</b><span class="grow"></span>
          ${s && todo.length ? `<button class="btn primary sm" data-mail="${sid}">✉ Objednat u dodavatele (${todo.length})</button>` : ''}</div>
          <table class="list"><thead><tr><th>Kód</th><th>Produkt</th><th class="r">Množství</th><th style="width:170px">Dodavatel</th><th>Stav</th><th></th></tr></thead><tbody>
          ${its.map(i => { const skip = ojItemSkipped(i); const a = OJ.aufs.find(x => x.id === i.auf_id);
            return `<tr class="${skip ? 'muted' : ''}"><td class="nowrap"><b>${esc(i.code)}</b></td><td>${esc(i.name)}</td>
              <td class="r nowrap">${i.auf_id ? `<b>${fmtQ(i.qty)}</b>` : `<input type="number" step="any" min="0" data-qty="${esc(i.key)}" value="${i.qty}" style="width:90px;text-align:right">`} ${esc(unitCz(i.unit))}</td>
              <td><select data-sup="${esc(i.code)}" ${i.auf_id ? 'disabled' : ''}>${supOptions((OJ.products[i.code] || {}).supplier_id)}</select></td>
              <td>${a ? `${aufBadge(a)}${a.auf_number ? ' <span class="small muted">' + esc(a.auf_number) + '</span>' : ''}` : skip ? '<span class="tag grey">neobjednává se</span>' : !ojRelevant(i) ? '<span class="tag grey" title="Dodavatel není sledován — Nastavení → Objednávky">ignorováno</span>' : '<span class="tag">k objednání</span>'}</td>
              <td class="nowrap">${i.auf_id ? '' : `<button class="btn sm" data-skip="${esc(i.key)}" data-to="${skip ? 'order' : 'skip'}">${skip ? 'Objednávat' : 'Neobjednávat'}</button>${i.manual ? ` <button class="btn sm" data-del="${esc(i.key)}">✕</button>` : ''}`}</td></tr>`; }).join('')}
          </tbody></table></div>`; }).join('') || '<div class="panel panel-b muted">Objednávka zatím nemá žádné položky.</div>'}
      <div style="margin-bottom:14px"><button class="btn" id="oAdd">＋ Přidat položku ručně</button></div>
      ${inf.aufs.length ? `<h3 style="margin:18px 0 8px">Objednávky u dodavatele (potvrzení)</h3>` : ''}
      ${inf.aufs.map(a => { const s = ojSup(a.supplier_id); const sh = OJ.shipments.find(x => x.id === a.shipment_id);
        return `<div class="panel panel-b" style="margin-bottom:12px" data-auf="${a.id}"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>${ojSupLabel(s)}</b>${aufBadge(a)}
          ${a.auf_number ? `<b>${esc(a.auf_number)}</b>` : ''}${a.amount_eur != null ? `<span>${fmtAmt(a)}</span>` : ''}${a.expected_at && !a.delivered_at ? `<span class="tag ${a.expected_at < ymd(new Date()) ? 'late' : 'blue'}" title="Očekávané dodání">📅 ${czDate(a.expected_at)}</span>` : ''}${sh ? `<a class="tag blue" href="#/svoz/${sh.id}">${esc(sh.reference || 'svoz')}</a>` : ''}${sh && sh.status === 'arrived' ? `<a class="btn sm primary" href="#/svoz/${sh.id}">📥 Naskladnit svoz</a>` : ''}
          ${a.delivery_status === 'issue' ? `<span class="tag" style="background:var(--s-rejected-bg,#fdd);color:var(--s-rejected,#c00)">${a.issue_resolved_at ? 'reklamace vyřešena' : 'reklamace'}</span>` : a.delivered_at ? '<span class="tag blue">doručeno</span>' : ''}<span class="grow"></span>
          ${a.status !== 'draft' ? ojPayTag(a) : ''}<button class="btn sm" data-amail="${a.id}">✉ E-mail</button>
          ${a.status !== 'draft' ? `<button class="btn sm ${a.paid_at ? '' : 'primary'}" data-pay="${a.id}">💶 ${a.paid_at ? 'Platba' : 'Označit zaplaceno'}</button>` : ''}
          ${a.status === 'draft' ? `<button class="btn sm primary" data-asent="${a.id}">Označit jako odesláno</button>` : ''}${a.status === 'confirmed' && !a.shipment_id ? `<button class="btn sm primary" data-recv="${a.id}" title="Zboží dorazilo — zkontrolovat a naskladnit">📥 Přijmout zboží</button><button class="btn sm" data-aun="${a.id}" title="Vrátit na „Čeká na potvrzení“">↩ Zrušit potvrzení</button>` : ''}${a.delivery_status === 'issue' && !a.issue_resolved_at ? `<button class="btn sm" data-resolve="${a.id}">✓ Reklamace vyřešena</button>` : ''}${a.auf_number && ojShoptetEligible(order(), ojSup(a.supplier_id)) ? `<button class="btn sm" data-repush="${a.id}" title="Znovu zapsat č. objednávky do Shoptetu a přepnout stav">↻ Do Shoptetu</button>` : ''}
          ${a.status === 'sent' ? `<button class="btn sm primary" data-conf="${a.id}">Zadat č. objednávky u dodavatele</button>` : ''}${a.status === 'confirmed' && !a.shipment_id ? `<button class="btn sm" data-conf="${a.id}">Upravit potvrzení</button>` : ''}
          ${!a.shipment_id ? `<button class="btn sm danger" data-adel="${a.id}">Smazat</button>` : ''}</div>
          <div class="small muted" style="margin-top:6px">${a.lines.map(l => `${esc(l.code)} · ${fmtQ(l.qty)} ${esc(unitCz(l.unit))}`).join(' &nbsp;|&nbsp; ')}${a.sent_at ? ' &nbsp;·&nbsp; odesláno ' + czDate(a.sent_at) : ''}</div></div>`; }).join('')}`;
    bind(inf);
    drawOjComments();
  }
  function drawOjComments() {
    const box = $('#oCm'); if (!box) return;
    const list = OJ.comments.filter(c => c.order_code === code);
    $('#oCmList').innerHTML = list.length ? list.map(cm => `<div class="cm ${cm.author === S.me.id ? 'mine' : ''}">
      <span class="av" title="${esc(userName(cm.author))}">${initials(cm.author)}</span>
      <div class="bub"><div class="h"><b>${esc(userName(cm.author) || 'neznámý')}</b><span title="${esc(czDateTime(cm.created_at))}">${esc(czDateTime(cm.created_at))} · ${ago(cm.created_at)}</span>
      ${cm.author === S.me.id || S.me.role === 'admin' ? `<button class="x" data-cid="${cm.id}" title="Smazat komentář">✕</button>` : ''}</div>
      <p>${esc(cm.text)}</p></div></div>`).join('') : '<div class="muted small">Zatím žádné komentáře. Pište sem, co se k objednávce děje — vidí to všichni a je u toho jméno autora.</div>';
    $$('[data-cid]', box).forEach(b => b.onclick = async () => {
      if (!(await confirmBox('Smazat komentář?', 'Komentář se nevratně odstraní.', { ok: 'Smazat', danger: true }))) return;
      try { check(await sb.from('oj_order_comments').delete().eq('id', b.dataset.cid)); OJ.comments = OJ.comments.filter(x => x.id !== b.dataset.cid); drawOjComments(); } catch (e) { toast(e.message, true); }
    });
  }
  async function sendOjComment() {
    const ta = $('#oCmNew'); const text = ta.value.trim(); if (!text) return;
    const btn = $('#oCmPost'); btn.disabled = true;
    try {
      const row = check(await sb.from('oj_order_comments').insert({ order_code: code, author: S.me.id, text }).select().single());
      OJ.comments.push(row); ta.value = ''; drawOjComments();
    } catch (e) { toast(e.message, true); }
    btn.disabled = false; ta.focus();
  }
  function bind(inf) {
    const body = $('#oBody');
    $('#oRef').onchange = async e => { try { check(await sb.from('oj_orders').update({ ref: e.target.value.trim(), updated_at: nowIso() }).eq('code', code)); order().ref = e.target.value.trim(); toast('Uloženo'); } catch (er) { toast(er.message, true); } };
    $('#oNote').onchange = async e => { try { check(await sb.from('oj_orders').update({ note: e.target.value, updated_at: nowIso() }).eq('code', code)); toast('Uloženo'); } catch (er) { toast(er.message, true); } };
    $$('[data-sup]', body).forEach(s => s.onchange = async () => { try { check(await sb.from('oj_products').update({ supplier_id: s.value || null, updated_at: nowIso() }).eq('code', s.dataset.sup)); await reload(); toast('Dodavatel uložen — platí pro tento produkt i příště'); } catch (e) { toast(e.message, true); } });
    $$('[data-qty]', body).forEach(i => i.onchange = async () => { const v = toNum(i.value); if (!(v > 0)) return; try { check(await sb.from('oj_items').update({ qty: v }).eq('key', i.dataset.qty)); await reload(); } catch (e) { toast(e.message, true); } });
    $$('[data-skip]', body).forEach(b => b.onclick = async () => { try { check(await sb.from('oj_items').update({ decision: b.dataset.to }).eq('key', b.dataset.skip)); await reload(); } catch (e) { toast(e.message, true); } });
    $$('[data-del]', body).forEach(b => b.onclick = async () => { if (!(await confirmBox('Smazat položku?', 'Ručně přidaná položka se odstraní.', { ok: 'Smazat', danger: true }))) return; try { check(await sb.from('oj_items').delete().eq('key', b.dataset.del)); await reload(); } catch (e) { toast(e.message, true); } });
    $('#oAdd').onclick = () => ojPickProducts(code, reload);
    $$('[data-mail]', body).forEach(b => b.onclick = () => ojOrderMail(code, b.dataset.mail, reload));
    $$('[data-pay]', body).forEach(b => b.onclick = async () => { try { if (await ojPayDialog(b.dataset.pay)) await reload(); } catch (e) { toast(e.message, true); } });
    $$('[data-amail]', body).forEach(b => b.onclick = async () => {
      const a = OJ.aufs.find(x => x.id === b.dataset.amail); const s = ojSup(a.supplier_id);
      const v = await ojMailDialog({ order: order(), sup: s || { name: '—', country: 'DE' }, mail: { to: a.email_to, subject: a.subject, body: a.body }, auf: a });
      if (!v) return;
      try { check(await sb.from('oj_aufs').update({ email_to: v.to, subject: v.subject, body: v.body, ...(v.sent && a.status === 'draft' ? { status: 'sent', sent_at: nowIso() } : {}), updated_at: nowIso() }).eq('id', a.id)); await reload(); } catch (e) { toast(e.message, true); }
    });
    $$('[data-conf]', body).forEach(b => b.onclick = async () => {
      const a = OJ.aufs.find(x => x.id === b.dataset.conf);
      const v = await modal({ title: 'Potvrzení od dodavatele', body: `<p class="muted small">Doplň číslo objednávky u dodavatele (z potvrzení) a částku z dokladu.</p><label>Číslo objednávky u dodavatele</label><input data-k="n" value="${esc(a.auf_number)}" placeholder="číslo z potvrzení"><label>Částka v EUR</label><input data-k="a" value="${a.amount_eur ?? ''}" placeholder="např. 1500,53"><label>Očekávané dodání (nepovinné — uvidíš to v přehledu „Na cestě“)</label><input type="date" data-k="e" value="${esc(a.expected_at || '')}">${ojPushBox(order(), ojSup(a.supplier_id), !a.auf_number)}`, focus: '[data-k="n"]',
        actions: [{ label: 'Zrušit', value: null }, { label: 'Uložit potvrzení', cls: 'primary', value: bd => ({ n: $('[data-k="n"]', bd).value.trim(), a: toNum($('[data-k="a"]', bd).value), e: $('[data-k="e"]', bd).value || null, push: !!($('[data-k="push"]', bd) || {}).checked }) }] });
      if (!v) return; if (!v.n) return toast('Doplň číslo objednávky u dodavatele', true);
      try { check(await sb.from('oj_aufs').update({ auf_number: v.n, amount_eur: v.a > 0 ? v.a : null, expected_at: v.e, status: 'confirmed', confirmed_at: a.confirmed_at || nowIso(), updated_at: nowIso() }).eq('id', a.id)); await reload(); toast('Potvrzení uloženo'); if (v.push) await ojPushRef(order(), ojSup(a.supplier_id), v.n); } catch (e) { toast(e.message, true); }
    });
    $$('[data-asent]', body).forEach(b => b.onclick = async () => {
      if (!(await confirmBox('Označit jako odesláno?', 'E-mail dodavateli jsi odeslal(a). Objednávka pak čeká na potvrzení od dodavatele.', { ok: 'Odesláno' }))) return;
      try { check(await sb.from('oj_aufs').update({ status: 'sent', sent_at: nowIso(), updated_at: nowIso() }).eq('id', b.dataset.asent)); await reload(); toast('Označeno jako odesláno — čeká se na potvrzení'); } catch (e) { toast(e.message, true); }
    });
    $$('[data-aun]', body).forEach(b => b.onclick = async () => {
      try { check(await sb.from('oj_aufs').update({ status: 'sent', confirmed_at: null, updated_at: nowIso() }).eq('id', b.dataset.aun)); await reload(); toast('Vráceno na „Čeká na potvrzení“'); } catch (e) { toast(e.message, true); }
    });
    $$('[data-recv]', body).forEach(b => b.onclick = () => ojReceiveAuf(b.dataset.recv));
    $$('[data-repush]', body).forEach(b => b.onclick = async () => { const a = OJ.aufs.find(x => x.id === b.dataset.repush); b.disabled = true; await ojPushRef(order(), ojSup(a.supplier_id), a.auf_number); await reload(); });
    $$('[data-resolve]', body).forEach(b => b.onclick = async () => { try { check(await sb.from('oj_aufs').update({ issue_resolved_at: nowIso(), updated_at: nowIso() }).eq('id', b.dataset.resolve)); await reload(); toast('Reklamace vyřešena'); } catch (e) { toast(e.message, true); } });
    $$('[data-adel]', body).forEach(b => b.onclick = async () => {
      if (!(await confirmBox('Smazat objednávku u dodavatele?', 'Položky se vrátí do „Objednat“. E-mail, který už odešel, tím nevezmeš zpět.', { ok: 'Smazat', danger: true }))) return;
      try { check(await sb.from('oj_aufs').delete().eq('id', b.dataset.adel)); await reload(); } catch (e) { toast(e.message, true); }
    });
  }
  draw();
}
// okno „Přidat zboží“: hledání v katalogu e-shopu, množství, přidání víc položek najednou
async function ojPickProducts(code, reload) {
  const prods = S.products || [];
  let added = 0;
  const bodyHtml = `<input id="ppq" placeholder="Hledat kód, název, EAN, dodavatele…" autocomplete="off"><div id="ppl" class="pp-list"></div><p class="muted small" id="ppn"></p>`;
  const done = modal({ title: 'Přidat zboží do objednávky', body: bodyHtml, focus: '#ppq', actions: [{ label: 'Hotovo', value: true, cls: 'primary' }] });
  setTimeout(() => {
    const bd = $$('.backdrop').pop(); if (!bd) return; const q = $('#ppq', bd); const list = $('#ppl', bd);
    const row = p => { const pr = OJ.products[p.code] || {}; const sup = ojSup(pr.supplier_id); return `<div class="pp-row" data-c="${esc(p.code)}"><div class="pp-i"><b>${esc(p.code)}</b> <span class="muted small">${sup ? ojSupLabel(sup) : esc(p.supplier || '')}</span><div class="small">${esc(p.name)}${p.variant ? ' · ' + esc(p.variant) : ''}</div></div><input class="pp-q" type="number" step="any" min="0" value="1" inputmode="decimal"><select class="pp-u"><option>ks</option><option>m²</option><option>bal</option></select><button class="btn sm primary pp-add">＋</button></div>`; };
    const draw = () => {
      const t = fold(q.value).trim();
      const hits = t ? prods.filter(p => p.text.includes(t)).slice(0, 25) : prods.slice(0, 0);
      list.innerHTML = hits.length ? hits.map(row).join('') : t ? `<div class="empty">Nic nenalezeno. <button class="btn sm" id="ppFree">Přidat „${esc(q.value.trim())}“ jako vlastní položku</button></div>` : '<div class="empty muted">Začni psát kód nebo název zboží…</div>';
      const free = $('#ppFree', bd); if (free) free.onclick = () => addItem({ code: q.value.trim(), name: q.value.trim() }, 1, 'ks', true);
    };
    async function addItem(p, qty, unit, custom) {
      if (!(qty > 0)) return toast('Zadej množství', true);
      try {
        const known = OJ.products[p.code];
        if (!known) { check(await sb.from('oj_products').insert({ code: p.code, name: p.name })); OJ.products[p.code] = { code: p.code, name: p.name, supplier_id: null, skip: false, supplier_code: '', supplier_name: '', shoptet_supplier: '' }; }
        const ex = OJ.items.find(i => i.key === code + '|' + p.code);
        check(await sb.from('oj_items').upsert({ key: code + '|' + p.code, order_code: code, code: p.code, name: p.name, qty: (ex && !ex.auf_id ? Number(ex.qty) : 0) + qty, unit, manual: true, active: true, order_date: ymd(new Date()) }, { onConflict: 'key' }));
        added++; $('#ppn', bd).textContent = `Přidáno položek: ${added}. Dodavatele přiřadíš v detailu objednávky.`; toast(`＋ ${p.code} · ${fmtQ(qty)} ${unit}`);
        if (custom) { q.value = ''; draw(); }
      } catch (e) { toast(e.message, true); }
    }
    q.oninput = draw;
    q.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); } };
    list.onclick = e => { const b = e.target.closest('.pp-add'); if (!b) return; const r = b.closest('.pp-row'); const p = prods.find(x => x.code === r.dataset.c); addItem(p, toNum($('.pp-q', r).value), $('.pp-u', r).value); };
    draw();
  }, 40);
  await done;
  if (added) { await reload(); }
}
async function ojOrderMail(code, sid, reload) {
  const o = OJ.orders.find(x => x.code === code); const sup = ojSup(sid); const inf = ojInfo(o);
  const todo = inf.items.filter(i => !ojItemSkipped(i) && !i.auf_id && (OJ.products[i.code] || {}).supplier_id === sid);
  if (!todo.length) return toast('Není co objednávat.', true);
  if (!(await ojFillMissing(todo, sup))) return;
  const lines = todo.map(i => { const pr = OJ.products[i.code] || {}; return { key: i.key, ourCode: i.code, code: pr.supplier_code || '', name: pr.supplier_name || '', csName: i.name, qty: Number(i.qty), unit: unitCz(i.unit) }; });
  const v = await ojMailDialog({ order: o, sup, mail: ojBuildMail(o, sup, lines), auf: null });
  if (!v) return;
  try {
    const row = check(await sb.from('oj_aufs').insert({ order_code: code, supplier_id: sid, status: v.sent ? 'sent' : 'draft', email_to: v.to, subject: v.subject, body: v.body, lines, sent_at: v.sent ? nowIso() : null, created_by: S.me.id }).select().single());
    check(await sb.from('oj_items').update({ auf_id: row.id, decision: 'order' }).in('key', lines.map(l => l.key)));
    await reload(); toast(v.sent ? 'Označeno jako odesláno — čeká se na potvrzení' : 'Uloženo jako koncept');
  } catch (e) { toast(e.message, true); }
}

// ---------- záložka AUFy ----------
function drawOjAufs() {
  const el = $('#ojBody'); const AU = OJ.curSup ? OJ.aufs.filter(a => a.supplier_id === OJ.curSup) : OJ.aufs;
  if (!AU.length) { el.innerHTML = '<div class="panel empty-big"><div class="ill">✉</div><h3>Zatím žádná potvrzení</h3><p>Potvrzení vznikne, když v detailu objednávky zadáš objednání u dodavatele.</p></div>'; return; }
  const F = [['', 'Vše', () => true], ['draft', 'Koncept', a => a.status === 'draft'], ['sent', 'Čeká na potvrzení', a => a.status === 'sent'], ['free', 'Bez svozu', a => a.status === 'confirmed' && !a.shipment_id], ['ship', 'Ve svozu', a => !!a.shipment_id], ['unpaid', 'K zaplacení', a => a.status !== 'draft' && !a.paid_at], ['paid', 'Zaplaceno', a => !!a.paid_at]];
  el.innerHTML = `<div class="topbar" style="margin:0 0 12px;gap:10px"><div class="search grow" style="max-width:480px"><span class="ic">⌕</span><input id="ojaq" placeholder="Hledat č. obj. u dodavatele, objednávku, dodavatele, kód…" value="${esc(OJ.aq)}"></div>
    <button class="btn sm" id="ojaCopy" title="Zkopírovat soupis čísel objednávek u dodavatele a referencí">📋 Kopírovat soupis</button><div class="chips" id="ojaf">${F.map(([k, l, fn]) => `<button class="chip ${OJ.af === k ? 'on' : ''}" data-f="${k}">${l} <span class="tag grey">${AU.filter(fn).length}</span></button>`).join('')}</div></div><div id="ojAl"></div>`;
  const draw = () => {
    const q = fold(OJ.aq).trim(); const fn = F.find(x => x[0] === OJ.af)[2];
    const list = AU.filter(fn).filter(a => !q || fold([a.auf_number, a.order_code, (ojSup(a.supplier_id) || {}).name, ...a.lines.map(l => l.code + ' ' + l.ourCode + ' ' + (l.csName || l.name || ''))].join(' ')).includes(q))
      .sort((x, y) => (x.status === 'confirmed') - (y.status === 'confirmed') || String(y.created_at).localeCompare(x.created_at));
    OJ._aufList = list;
    $('#ojAl').innerHTML = list.length ? `<div class="panel" style="overflow-x:auto"><table class="list"><thead><tr><th>Č. obj. u dodavatele</th><th>Dodavatel</th><th>Objednávka</th><th>Položek</th><th>Odesláno</th><th>Očekáváno</th><th class="r">Částka</th><th>Platba</th><th>Stav</th><th>Svoz</th></tr></thead><tbody>
    ${list.map(a => { const sh = OJ.shipments.find(x => x.id === a.shipment_id); return `<tr class="click" data-o="${esc(a.order_code)}"><td><b>${a.auf_number ? highlight(a.auf_number, OJ.aq) : '<span class="muted">čeká na číslo</span>'}</b></td><td>${ojSupLabel(ojSup(a.supplier_id))}</td><td><u>${highlight(a.order_code, OJ.aq)}</u></td><td>${a.lines.length}</td><td class="nowrap">${a.sent_at ? czDate(a.sent_at) : '—'}</td><td class="nowrap">${a.expected_at ? czDate(a.expected_at) : '—'}</td><td class="r nowrap">${fmtAmt(a)}</td><td class="nowrap">${a.status !== 'draft' ? ojPayTag(a) + ` <button class="btn sm" data-pay="${a.id}" title="Platba">💶</button>` : '—'}</td><td>${aufBadge(a)}</td><td>${sh ? esc(sh.reference || 'svoz') : '—'}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="panel empty-big"><div class="ill">🔍</div><h3>Nic nenalezeno</h3></div>';
    $$('#ojAl tr.click').forEach(r => r.onclick = e => { if (e.target.closest('[data-pay]')) return; location.hash = orderHref(r.dataset.o); });
    $$('#ojAl [data-pay]').forEach(b => b.onclick = async e => { e.stopPropagation(); try { if (await ojPayDialog(b.dataset.pay)) { await loadOj(); drawOj(); } } catch (er) { toast(er.message, true); } });
  };
  $('#ojaq').oninput = e => { OJ.aq = e.target.value; draw(); };
  $('#ojaCopy').onclick = () => ojCopyRows((OJ._aufList || []).map(ojRowOf), 'Soupis: ' + ((F.find(x => x[0] === OJ.af) || [])[1] || 'Vše'));
  $$('#ojaf .chip').forEach(c => c.onclick = () => { OJ.af = c.dataset.f; drawOjAufs(); });
  draw();
}

// =====================================================================
// svozy
// =====================================================================
function drawOjShipments() {
  const el = $('#ojBody'); const free = OJ.aufs.filter(a => a.status === 'confirmed' && !a.shipment_id && (!OJ.curSup || a.supplier_id === OJ.curSup));
  const rows = OJ.shipments.map(s => { const as = OJ.aufs.filter(a => a.shipment_id === s.id); return { s, as, total: as.reduce((x, a) => x + Number(a.amount_eur || 0), 0) }; }).filter(r => !OJ.curSup || r.as.some(a => a.supplier_id === OJ.curSup));
  el.innerHTML = `<div style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn primary" id="shNew">＋ Nový svoz</button><span class="muted small">${free.length ? `${free.length} potvrzených objednávek čeká na zařazení do svozu` : 'všechny potvrzené objednávky jsou ve svozu'}</span></div>
  ${rows.length ? `<div class="panel" style="overflow-x:auto"><table class="list"><thead><tr><th>Svoz</th><th>Dodavatel / poznámka</th><th>Objednávek</th><th class="r">Celkem</th><th>Stav</th><th>Doručeno</th><th></th></tr></thead><tbody>
  ${rows.map(({ s, as, total }) => `<tr class="click" data-id="${s.id}"><td><b>${esc(s.reference || s.title)}</b></td><td>${esc(s.note) || '—'}</td><td>${as.length}</td><td class="r nowrap">${fmtEur(total)}</td><td>${shipBadge(s.status)}</td><td class="nowrap">${s.delivered_at ? czDate(s.delivered_at) : '—'}</td><td class="nowrap">${s.status === 'arrived' && s.lines.some(l => !l.stocked && !l.skip) ? '<span class="btn sm primary">📥 Naskladnit</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`
  : `<div class="panel empty-big"><div class="ill">🚛</div><h3>Zatím žádný svoz</h3><p>Svoz je sběrná doprava od dodavatele. Zařadíš do něj objednávky, které dodavatel potvrdil.</p></div>`}`;
  $('#shNew').onclick = ojNewShipment;
  $$('tr.click', el).forEach(r => r.onclick = () => { location.hash = '#/svoz/' + r.dataset.id; });
}
const nextRef = () => { const y = new Date().getFullYear(); const nums = OJ.shipments.map(s => (String(s.reference).match(new RegExp('^SV-' + y + '-(\\d+)$')) || [])[1]).filter(Boolean).map(Number); return `SV-${y}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`; };
const aufPick = list => list.length ? list.map(a => `<label class="chk" style="display:flex;gap:8px;align-items:center;margin:4px 0"><input type="checkbox" value="${a.id}"><span><b>${esc(a.auf_number)}</b> · ${esc((ojSup(a.supplier_id) || {}).name || '')} · obj. ${esc(a.order_code)} · ${fmtAmt(a)}</span></label>`).join('') : '<p class="muted">Žádná potvrzená objednávka bez svozu. Nejdřív v detailu objednávky zadej číslo objednávky u dodavatele.</p>';
function ojLinesFor(shId, existing = []) {
  const byId = new Map(existing.map(l => [l.id, l])); const out = [];
  for (const a of OJ.aufs.filter(x => x.shipment_id === shId)) for (const l of a.lines) {
    const id = a.id.slice(0, 8) + '|' + l.ourCode; const old = byId.get(id) || {};
    out.push({ id, code: l.ourCode, name: (OJ.products[l.ourCode] || {}).name || l.name, qty: Number(l.qty), unit: unitCz(l.unit), aufId: a.id, aufNumber: a.auf_number, orderCode: a.order_code, ...(old.got != null ? { got: old.got } : {}), ...(old.stocked ? { stocked: true } : {}), ...(old.skip ? { skip: true } : {}) });
  }
  return out;
}
async function ojNewShipment() {
  const free = OJ.aufs.filter(a => a.status === 'confirmed' && !a.shipment_id && (!OJ.curSup || a.supplier_id === OJ.curSup));
  const v = await modal({ title: 'Nový svoz', body: `<label>Označení svozu</label><input data-k="ref" value="${nextRef()}"><label>Poznámka (dodavatel, spedice…)</label><input data-k="note" value="${OJ.curSup ? esc((ojSup(OJ.curSup) || {}).name || '') : ''}" placeholder="např. MEFO"><label>Které objednávky pojedou ve svozu</label><div style="max-height:260px;overflow:auto" id="pickBox">${aufPick(free)}</div>`, focus: '[data-k="ref"]',
    actions: [{ label: 'Zrušit', value: null }, { label: 'Vytvořit svoz', cls: 'primary', value: bd => ({ ref: $('[data-k="ref"]', bd).value.trim(), note: $('[data-k="note"]', bd).value.trim(), ids: $$('#pickBox input:checked', bd).map(x => x.value) }) }] });
  if (!v) return; if (!v.ref) return toast('Doplň označení svozu', true);
  try {
    const row = check(await sb.from('oj_shipments').insert({ reference: v.ref, title: v.ref, note: v.note, status: 'transit', created_by: S.me.id }).select().single());
    if (v.ids.length) check(await sb.from('oj_aufs').update({ shipment_id: row.id, updated_at: nowIso() }).in('id', v.ids));
    await loadOj(); check(await sb.from('oj_shipments').update({ lines: ojLinesFor(row.id) }).eq('id', row.id));
    location.hash = '#/svoz/' + row.id;
  } catch (e) { toast(/duplicate|unique/i.test(e.message) ? 'Takové označení už existuje.' : e.message, true); }
}

// zboží od dodavatele dorazilo přímo (bez sběrné dopravy): vytvoří příjem (svoz), označí doručeno a otevře kontrolu počtů + naskladnění
async function ojReceiveAuf(ids) {
  ids = [].concat(ids); const aufId = ids[0];
  const a = OJ.aufs.find(x => x.id === aufId); if (!a) return;
  const sup = ojSup(a.supplier_id);
  const ok = await confirmBox('Zboží dorazilo?', `Obj. u dodavatele ${a.auf_number || ''} · ${sup ? sup.name : ''} · objednávka ${a.order_code}. Otevřu kontrolu počtů, kde potvrdíš, co přesně přišlo, případně označíš reklamaci, a pak zboží naskladníš do Shoptetu.`, { ok: 'Ano, otevřít kontrolu' });
  if (!ok) return;
  try {
    const ref = nextRef(); const now = nowIso();
    const row = check(await sb.from('oj_shipments').insert({ reference: ref, title: ref, note: [sup && sup.name, a.order_code].filter(Boolean).join(' · '), status: 'arrived', delivered_at: now, created_by: S.me.id }).select().single());
    check(await sb.from('oj_aufs').update({ shipment_id: row.id, delivery_status: 'ok', delivered_at: now, updated_at: now }).in('id', ids));
    await loadOj(); check(await sb.from('oj_shipments').update({ lines: ojLinesFor(row.id) }).eq('id', row.id));
    location.hash = '#/svoz/' + row.id;
  } catch (e) { toast(e.message, true); }
}

async function renderShipment(id) {
  shell('orders', `<div class="topbar"><h1>Svoz</h1></div><div class="panel panel-b"><div class="sk" style="height:260px"></div></div>`);
  try { await Promise.all([loadSettings(), loadOj()]); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const sh = () => OJ.shipments.find(x => x.id === id);
  if (!sh()) { $('#main').innerHTML = `<div class="panel empty-big"><div class="ill">🤷</div><h3>Svoz nenalezen</h3><button class="btn primary" onclick="location.hash='#/objednavky'">Zpět</button></div>`; return; }
  const patch = async f => { check(await sb.from('oj_shipments').update({ ...f, updated_at: nowIso() }).eq('id', id)); Object.assign(sh(), f); };
  const reload = async () => { await loadOj(); draw(); };
  const main = $('#main');
  main.innerHTML = `<div class="topbar"><a class="btn" href="#/objednavky">← Objednávky</a><h1 id="sTitle" style="margin:0"></h1><span id="sBadge"></span><span class="grow"></span><button class="btn danger" id="sDel">Smazat</button></div><div id="sBody"></div>`;
  main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
  const syncLines = async () => { await patch({ lines: ojLinesFor(id, sh().lines) }); };

  function draw() {
    const s = sh(); if (!s) return; const as = OJ.aufs.filter(a => a.shipment_id === id); const locked = s.status === 'stocked';
    const total = as.reduce((x, a) => x + Number(a.amount_eur || 0), 0); const anyStocked = s.lines.some(l => l.stocked);
    $('#sTitle').textContent = s.reference || s.title; $('#sBadge').innerHTML = shipBadge(s.status);
    $('#sBody').innerHTML = `
    <div class="panel panel-b" style="margin-bottom:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">
      <div><label>Označení</label><input id="sRef" value="${esc(s.reference)}" ${locked ? 'disabled' : ''}></div><div><label>Poznámka</label><input id="sNote" value="${esc(s.note)}" ${locked ? 'disabled' : ''}></div>
      <div><label>Odesláno</label><input type="date" id="sShip" value="${esc(s.ship_date || '')}" ${locked ? 'disabled' : ''}></div>
      <div><label>Doručeno</label><input type="date" id="sDel2" value="${s.delivered_at ? esc(ymd(new Date(s.delivered_at))) : ''}" ${locked ? 'disabled' : ''}></div></div>
    <div class="panel" style="overflow-x:auto;margin-bottom:14px"><table class="list"><thead><tr><th>Č. obj. u dodavatele</th><th>Dodavatel</th><th>Objednávka</th><th class="r">Částka</th><th>Stav</th><th></th></tr></thead><tbody>
      ${as.map(a => `<tr><td><b>${esc(a.auf_number)}</b></td><td>${ojSupLabel(ojSup(a.supplier_id))}</td><td><a href="${orderHref(a.order_code)}"><u>${esc(a.order_code)}</u></a></td><td class="r nowrap">${fmtAmt(a)}</td>
        <td>${a.delivery_status === 'issue' ? `<span class="st" data-s="rejected">${a.issue_resolved_at ? 'Reklamace vyřešena' : 'Reklamace'}</span>${a.delivery_note ? ' <span class="small muted">' + esc(a.delivery_note) + '</span>' : ''}` : a.delivered_at ? '<span class="st" data-s="confirmed">Doručeno v pořádku</span>' : '<span class="st" data-s="postponed">Na cestě</span>'}</td>
        <td>${locked || a.delivery_status === 'issue' && false ? '' : `<button class="btn sm" data-rm="${a.id}" title="Vyjmout ze svozu" ${s.lines.some(l => l.aufId === a.id && l.stocked) ? 'disabled' : ''}>✕</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Svoz je prázdný — přidej objednávku.</td></tr>'}
      <tr><td colspan="3"><b>Celkem</b></td><td class="r nowrap"><b>${fmtEur(total)}</b></td><td colspan="2"></td></tr></tbody></table></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
      ${locked ? '' : '<button class="btn" id="sAdd">＋ Přidat objednávku do svozu</button>'}
      ${as.length ? '<button class="btn" id="sState">✎ Stav doručení</button>' : ''}
      ${s.status === 'transit' && as.length ? '<button class="btn primary" id="sArrive">📦 Svoz dorazil</button>' : ''}</div>
    ${s.status === 'transit' ? '<div class="panel panel-b muted">Až svoz dorazí, klikni na <b>Svoz dorazil</b>. Objeví se tabulka s počty a tlačítko pro naskladnění do Shoptetu.</div>' : stockPanel(s)}`;
    bind();
  }
  function stockPanel(s) {
    const lines = s.lines; const left = lines.filter(l => !l.stocked && !l.skip);
    const sk = cfg().shoptetStockName || 'Sklad ' + (cfg().shoptetStockId ?? 1);
    return `<h3 style="margin:0 0 8px">Naskladnění do Shoptetu</h3><div class="panel" style="overflow-x:auto;margin-bottom:12px"><table class="list"><thead><tr><th>Kód</th><th>Produkt</th><th>Č. obj. u dod.</th><th class="r">Objednáno</th><th class="r">Dorazilo</th><th></th></tr></thead><tbody>
      ${lines.map(l => `<tr data-l="${esc(l.id)}" class="${l.skip ? 'muted' : ''}"><td class="nowrap"><b>${esc(l.code)}</b></td><td>${esc(l.name)}</td><td class="small muted nowrap">${esc(l.aufNumber)}</td><td class="r nowrap">${fmtQ(l.qty)} ${esc(l.unit)}</td>
        <td class="r nowrap">${l.stocked ? `<b>${fmtQ(l.got ?? l.qty)}</b> ✓` : `<input type="number" step="any" min="0" data-got value="${l.got ?? l.qty}" style="width:100px;text-align:right" ${l.skip ? 'disabled' : ''}>`} ${esc(l.unit)}</td>
        <td>${l.stocked ? '' : `<label class="small"><input type="checkbox" data-skipl ${l.skip ? 'checked' : ''}> nenaskladňovat</label>`}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Žádné řádky</td></tr>'}</tbody></table></div>
      ${s.status === 'stocked' ? `<div class="panel panel-b">✅ Všechno je naskladněné do Shoptetu${s.stocked_at ? ' (' + czDateTime(s.stocked_at) + ')' : ''}.</div>` :
      `<div class="panel panel-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div class="grow"><b>Zkontroluj počty v „Dorazilo“ a naskladni vše jedním klikem.</b><div class="muted small">Do Shoptetu se <b>přičte</b> (nikdy nepřepíše) — sklad: ${esc(sk)}</div></div><button class="btn primary lg" id="sPush" ${left.length ? '' : 'disabled'}>📥 Naskladnit vše do Shoptetu (${left.length})</button></div>`}`;
  }
  function bind() {
    const b = $('#sBody'); const s = sh();
    $('#sRef').onchange = e => patch({ reference: e.target.value.trim(), title: e.target.value.trim() }).then(() => { $('#sTitle').textContent = sh().reference; }).catch(x => toast(x.message, true));
    $('#sNote').onchange = e => patch({ note: e.target.value.trim() }).catch(x => toast(x.message, true));
    $('#sShip').onchange = e => patch({ ship_date: e.target.value || null }).catch(x => toast(x.message, true));
    $('#sDel2').onchange = async e => { try { await patch({ delivered_at: e.target.value ? new Date(e.target.value + 'T12:00:00').toISOString() : null }); } catch (x) { toast(x.message, true); } };
    const add = $('#sAdd'); if (add) add.onclick = async () => {
      const free = OJ.aufs.filter(a => a.status === 'confirmed' && !a.shipment_id);
      const v = await modal({ title: 'Přidat objednávku do svozu', body: `<div style="max-height:300px;overflow:auto" id="pickBox">${aufPick(free)}</div>`, actions: [{ label: 'Zrušit', value: null }, { label: 'Přidat', cls: 'primary', value: bd => $$('#pickBox input:checked', bd).map(x => x.value) }] });
      if (!v || !v.length) return;
      try { check(await sb.from('oj_aufs').update({ shipment_id: id, updated_at: nowIso() }).in('id', v)); await loadOj(); await syncLines(); draw(); } catch (e) { toast(e.message, true); }
    };
    $$('[data-rm]', b).forEach(x => x.onclick = async () => {
      if (!(await confirmBox('Vyjmout objednávku ze svozu?', 'Objednávka se vrátí do seznamu „bez svozu“.', { ok: 'Vyjmout' }))) return;
      try { check(await sb.from('oj_aufs').update({ shipment_id: null, delivered_at: null, delivery_status: '', updated_at: nowIso() }).eq('id', x.dataset.rm)); await loadOj(); await syncLines(); draw(); } catch (e) { toast(e.message, true); }
    });
    const st = $('#sState'); if (st) st.onclick = async () => {
      const as = OJ.aufs.filter(a => a.shipment_id === id);
      const v = await modal({ title: 'Stav doručení', body: as.map(a => `<div style="margin:8px 0" data-a="${a.id}"><b>${esc(a.auf_number)}</b> · ${esc(a.order_code)}<div style="display:flex;gap:8px;margin-top:4px"><select data-ds><option value="" ${!a.delivery_status ? 'selected' : ''}>Na cestě</option><option value="ok" ${a.delivery_status === 'ok' ? 'selected' : ''}>Doručeno v pořádku</option><option value="issue" ${a.delivery_status === 'issue' ? 'selected' : ''}>Problém (reklamace)</option></select><input data-dn placeholder="poznámka k problému" value="${esc(a.delivery_note)}" class="grow"></div></div>`).join(''),
        actions: [{ label: 'Zrušit', value: null }, { label: 'Uložit', cls: 'primary', value: bd => $$('[data-a]', bd).map(r => ({ id: r.dataset.a, ds: $('[data-ds]', r).value, dn: $('[data-dn]', r).value.trim() })) }] });
      if (!v) return;
      try {
        for (const r of v) { const a = as.find(x => x.id === r.id); if (a.delivery_status === r.ds && a.delivery_note === r.dn) continue;
          check(await sb.from('oj_aufs').update({ delivery_status: r.ds, delivery_note: r.dn, delivered_at: r.ds ? (a.delivered_at || nowIso()) : null, issue_resolved_at: r.ds === 'issue' ? null : a.issue_resolved_at, updated_at: nowIso() }).eq('id', r.id)); }
        await reload();
      } catch (e) { toast(e.message, true); }
    };
    const arr = $('#sArrive'); if (arr) arr.onclick = async () => {
      if (!(await confirmBox('Svoz dorazil?', 'Všechny objednávky ve svozu se označí jako doručená v pořádku (problémy můžeš upravit ve „Stav doručení“) a odemkne se naskladnění.', { ok: 'Svoz dorazil' }))) return;
      try {
        const now = nowIso();
        const as = OJ.aufs.filter(a => a.shipment_id === id);
        for (const a of as) if (a.delivery_status !== 'issue') check(await sb.from('oj_aufs').update({ delivery_status: 'ok', delivered_at: a.delivered_at || now, updated_at: now }).eq('id', a.id));
        await patch({ status: 'arrived', delivered_at: s.delivered_at || now, lines: ojLinesFor(id, s.lines) }); await reload(); toast('Svoz označen jako doručený');
      } catch (e) { toast(e.message, true); }
    };
    $$('[data-got]', b).forEach(i => i.onchange = async () => { const l = sh().lines.find(x => x.id === i.closest('tr').dataset.l); const v = toNum(i.value); if (!(v >= 0)) return; l.got = v; try { await patch({ lines: sh().lines }); toast('Uloženo'); } catch (e) { toast(e.message, true); } });
    $$('[data-skipl]', b).forEach(i => i.onchange = async () => { const l = sh().lines.find(x => x.id === i.closest('tr').dataset.l); l.skip = i.checked; try { await patch({ lines: sh().lines }); draw(); } catch (e) { toast(e.message, true); } });
    const push = $('#sPush'); if (push) push.onclick = pushAll;
  }
  async function pushAll() {
    const s = sh(); const stc = cfg(); const stockId = Number(stc.shoptetStockId) || 1; const stockName = stc.shoptetStockName || 'sklad ' + stockId;
    const list = s.lines.filter(l => !l.stocked && !l.skip);
    if (!list.length) return toast('Není co naskladňovat.', true);
    const zero = list.filter(l => !(toNum(l.got ?? l.qty) > 0));
    if (zero.length) return toast('U ' + zero.map(l => l.code).join(', ') + ' je nulové množství. Doplň „Dorazilo“, nebo zaškrtni „nenaskladňovat“.', true);
    const odd = list.filter(l => !['ks', 'm²'].includes(l.unit)); const big = list.filter(l => toNum(l.got ?? l.qty) >= 5000).length;
    const ok = await modal({ title: 'Naskladnit svoz do Shoptetu?',
      body: `<p>Do skladu <b>${esc(stockName)}</b> se <b>přidá</b>:</p><div class="push-list">${list.map(l => `<div><code>${esc(l.code)}</code><span>${esc(l.name)}</span><b>+${fmtQ(l.got ?? l.qty)} ${esc(l.unit)}</b></div>`).join('')}</div>
        ${odd.length ? `<p class="warn-t">⚠ U ${odd.map(l => esc(l.code)).join(', ')} je jednotka „${esc(odd[0].unit)}“. Ve Shoptetu se sklad počítá ve své jednotce (třeba m²) — ověř, že počet v „Dorazilo“ je ve stejné.</p>` : ''}${big ? `<p class="warn-t">⚠ ${big} řádků má velké množství — zkontroluj počty.</p>` : ''}
        <p class="muted small">Zápis do Shoptetu už jedním klikem nevrátíš. Co se povede, se nikdy nepošle podruhé.</p>`,
      actions: [{ label: 'Zrušit', value: false }, { label: `Naskladnit ${list.length} ${list.length === 1 ? 'řádek' : list.length < 5 ? 'řádky' : 'řádků'}`, value: true, cls: 'primary' }] });
    if (!ok) return;
    const btn = $('#sPush'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Posílám do Shoptetu…';
    try {
      const r = await shoptetCall({ action: 'svoz_stock_in', shipmentId: id, stockId });
      await reload();
      const good = r.results.filter(x => x.status === 'ok').length; const bad = r.results.filter(x => x.status === 'error');
      if (!bad.length) toast(`Naskladněno do Shoptetu: ${good} řádků ✓`);
      else await modal({ title: good ? `Naskladněno ${good}, ale ${bad.length} se nepovedlo` : 'Naskladnění se nepovedlo', body: `<div class="push-list err">${bad.map(x => `<div><code>${esc(x.code)}</code><span>${esc(x.message || x.status)}</span></div>`).join('')}</div><p class="muted small">Co se povedlo, je označené. Ostatní můžeš po opravě poslat znovu.</p>`, actions: [{ label: 'Rozumím', value: null, cls: 'primary' }] });
    } catch (e) { toast(e.message, true); draw(); }
  }
  $('#sDel').onclick = async () => {
    if (sh().lines.some(l => l.stocked)) return toast('Svoz, který už je (částečně) naskladněný, smazat nejde.', true);
    if (!(await confirmBox('Smazat svoz?', 'Objednávky se vrátí do seznamu „bez svozu“.', { ok: 'Smazat', danger: true }))) return;
    try { check(await sb.from('oj_aufs').update({ shipment_id: null }).eq('shipment_id', id)); await patch({ deleted: true }); toast('Svoz smazán'); location.hash = '#/objednavky'; } catch (e) { toast(e.message, true); }
  };
  draw();
}

// ---------- produkty ↔ dodavatelé ----------
function drawOjProducts() {
  const el = $('#ojBody');
  const PF = [['', 'Vše', () => true], ['nosup', 'Bez dodavatele', p => !p.supplier_id], ['nocode', 'Chybí kód dodavatele (MPN)', p => p.supplier_id && !p.supplier_code], ['noen', 'Chybí anglický název', p => { const s = ojSup(p.supplier_id); return s && s.country !== 'CZ' && !p.supplier_name; }]];
  el.innerHTML = `<div class="topbar" style="margin:0 0 12px;gap:10px"><div class="search grow" style="max-width:420px"><span class="ic">⌕</span><input id="ojpq" placeholder="Hledat kód, název, MPN…" value="${esc(OJ.q)}"></div>
    <div class="chips" id="ojpf">${PF.map(([k, l, fn]) => { const n = Object.values(OJ.products).filter(fn).length; return `<button class="chip ${OJ.pf === k ? 'on' : ''}" data-f="${k}">${l}${k ? ` <span class="tag ${n ? '' : 'grey'}">${n}</span>` : ''}</button>`; }).join('')}</div></div><div id="ojPl"></div>`;
  $$('#ojpf .chip').forEach(c => c.onclick = () => { OJ.pf = c.dataset.f; drawOjProducts(); });
  const draw = () => {
    const pfn = PF.find(x => x[0] === OJ.pf)[2];
    const q = fold(OJ.q).trim(); const all = Object.values(OJ.products).filter(pfn).filter(p => !q || fold(p.code + ' ' + p.name + ' ' + p.supplier_code + ' ' + p.supplier_name).includes(q));
    const list = all.sort((a, b) => (!!a.supplier_id - !!b.supplier_id) || a.code.localeCompare(b.code)).slice(0, 300);
    $('#ojPl').innerHTML = !all.length ? '<div class="panel panel-b muted">Zatím žádné produkty.</div>' : `<div class="panel" style="overflow-x:auto"><table class="list"><thead><tr><th>Produkt</th><th style="width:170px">Dodavatel</th><th style="width:160px">Kód u dodavatele (MPN)</th><th style="width:220px">Název pro dodavatele (EN)</th><th>Neobj.</th></tr></thead><tbody>
      ${list.map(p => `<tr data-c="${esc(p.code)}"><td><b>${esc(p.code)}</b><div class="small muted">${esc(p.name)}</div></td><td><select data-f="supplier_id">${supOptions(p.supplier_id)}</select></td>
        <td><input data-f="supplier_code" value="${esc(p.supplier_code)}"></td><td><input data-f="supplier_name" value="${esc(p.supplier_name)}"></td><td><input type="checkbox" data-f="skip" ${p.skip ? 'checked' : ''}></td></tr>`).join('')}</tbody></table></div>${all.length > 300 ? `<p class="muted small">Zobrazeno 300 z ${all.length} — zpřesni hledání.</p>` : ''}`;
    $$('#ojPl [data-f]').forEach(f => f.onchange = async () => {
      const code = f.closest('tr').dataset.c; const k = f.dataset.f; const v = k === 'skip' ? f.checked : k === 'supplier_id' ? (f.value || null) : f.value.trim();
      try { check(await sb.from('oj_products').update({ [k]: v, updated_at: nowIso() }).eq('code', code)); OJ.products[code][k] = v; toast('Uloženo'); } catch (e) { toast(e.message, true); }
    });
  };
  $('#ojpq').oninput = e => { OJ.q = e.target.value; draw(); };
  draw();
}
function drawOjSuppliers() {
  const el = $('#ojBody');
  el.innerHTML = `<div style="margin-bottom:12px"><button class="btn primary" id="supNew">＋ Nový dodavatel</button></div><div class="panel" style="overflow-x:auto"><table class="list"><thead><tr><th>Dodavatel</th><th>E-mail</th><th>Kontakt</th><th>Zákaznické č.</th><th>Produktů</th></tr></thead><tbody>
  ${OJ.suppliers.map(s => `<tr class="click" data-id="${s.id}"><td><b>${ojSupLabel(s)}</b></td><td>${esc(s.email) || '—'}</td><td>${esc(s.contact) || '—'}</td><td>${esc(s.customer_no) || '—'}</td><td>${Object.values(OJ.products).filter(p => p.supplier_id === s.id).length}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Zatím nikdo</td></tr>'}</tbody></table></div>`;
  $('#supNew').onclick = () => ojEditSupplier(null);
  $$('tr.click', el).forEach(r => r.onclick = () => ojEditSupplier(r.dataset.id));
}
async function ojEditSupplier(id) {
  const s = id ? ojSup(id) : { name: '', country: 'DE', email: '', contact: '', customer_no: '', notes: '' };
  const f = (k, label, ph = '') => `<label>${label}</label><input data-k="${k}" value="${esc(s[k])}" placeholder="${esc(ph)}">`;
  const v = await modal({ title: id ? 'Dodavatel ' + s.name : 'Nový dodavatel',
    body: `${f('name', 'Název', 'např. MEFO')}<label>Země (české firmy dostanou e-mail česky, ostatní anglicky)</label><select data-k="country">${OJ_COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === s.country ? 'selected' : ''}>${n}</option>`).join('')}</select>${f('email', 'E-mail pro objednávky')}${f('contact', 'Kontaktní osoba (oslovení v e-mailu)')}${f('customer_no', 'Naše zákaznické číslo')}<label>Poznámka</label><textarea data-k="notes" rows="2">${esc(s.notes)}</textarea><label class="chk" style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" data-k="active" ${s.active === false ? '' : 'checked'}> Sledovat — počítat zboží tohoto dodavatele do „${OJ_STAGE.order[0]}“ a mít jeho záložku</label>`, focus: '[data-k="name"]',
    actions: [{ label: 'Zrušit', value: null }, ...(id ? [{ label: 'Smazat', value: 'del', cls: 'danger' }] : []), { label: 'Uložit', cls: 'primary', value: bd => Object.fromEntries($$('[data-k]', bd).map(x => [x.dataset.k, x.type === 'checkbox' ? x.checked : x.value.trim()])) }] });
  if (!v) return;
  try {
    if (v === 'del') { if (!(await confirmBox('Smazat dodavatele ' + s.name + '?', 'Produkty tohoto dodavatele zůstanou bez dodavatele.', { ok: 'Smazat', danger: true }))) return; check(await sb.from('oj_suppliers').delete().eq('id', id)); }
    else { if (!v.name) return toast('Doplň název', true); check(id ? await sb.from('oj_suppliers').update(v).eq('id', id) : await sb.from('oj_suppliers').insert(v)); }
    await loadOj(); drawOj();
  } catch (e) { toast(e.message, true); }
}

// =====================================================================
// KONTEJNERY — kontejnery na cestě, položky z e-shopu, vyhledávání „kdy k nám přijde …“
// Přístup jen pro uživatele s právem „kontejnery“ (hub_profiles.apps); stejně to hlídá i databáze (RLS).
// =====================================================================
function ctProgress(c) {
  if (c.status === 'delivered' || c.status === 'port') return 1;
  if (c.status === 'planned') return 0.02;
  const a = c.etd && new Date(c.etd + 'T12:00'), b = (c.ata || c.eta) && new Date((c.ata || c.eta) + 'T12:00');
  if (a && b && b > a) return Math.max(0.05, Math.min(0.95, (Date.now() - a) / (b - a)));
  return 0.45;
}
function ctCountUp() {
  if (CT.animated) return; CT.animated = true;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  $$('.cnt').forEach(el => {
    const to = Number(el.dataset.n) || 0; if (reduce || to < 2) return;
    const t0 = performance.now(); const step = t => { const k = Math.min(1, (t - t0) / 700); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    el.textContent = '0'; requestAnimationFrame(step);
  });
}
function ctSeaSvg() {
  const stack = (x, y, cols) => cols.map((c, i) => `<rect x="${x + i * 17}" y="${y}" width="15" height="9" rx="1" fill="${c}"/><rect x="${x + i * 17}" y="${y}" width="15" height="2" fill="#fff" opacity=".22"/>`).join('');
  const wave = (w, h) => { let d = `M0 ${h / 2}`; for (let x = 0; x < w; x += 80) d += ` q20 -${h / 2} 40 0 t40 0`; return d + ` V${h} H0 Z`; };
  return `<div class="ct-sea"><div class="ct-sea-txt"></div>
    <svg viewBox="0 0 1200 170" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <circle class="ct-sun" cx="980" cy="52" r="26"/>
      <g class="ct-cloud c1"><ellipse cx="200" cy="38" rx="42" ry="10"/><ellipse cx="228" cy="32" rx="26" ry="9"/></g>
      <g class="ct-cloud c2"><ellipse cx="620" cy="24" rx="36" ry="8"/><ellipse cx="644" cy="19" rx="22" ry="7"/></g>
      <g class="ct-ship-run"><g class="ct-bob">
        <g transform="translate(0,50) scale(1.4)">
          ${stack(34, 8, ['#c4372a', '#2563eb', '#d08700', '#16804a', '#7c3aed', '#0e7490'])}${stack(34, 17, ['#2563eb', '#16804a', '#c4372a', '#d08700', '#0e7490', '#7c3aed'])}${stack(34, 26, ['#d08700', '#c4372a', '#7c3aed', '#2563eb', '#16804a', '#c4372a'])}
          ${stack(51, -1, ['#16804a', '#d08700', '#2563eb', '#c4372a'])}
          <rect x="148" y="-6" width="26" height="44" rx="2" fill="#e8ebe6"/><rect x="152" y="0" width="18" height="6" fill="#4b5563"/><rect x="152" y="10" width="18" height="4" fill="#4b5563"/><rect x="158" y="-16" width="6" height="12" fill="#c4372a"/>
          <path d="M14 38 H184 L170 56 H30 Z" fill="#1f2937"/><path d="M14 38 H184 L182 42 H16 Z" fill="#c4372a"/>
        </g></g></g>
      <path class="ct-wave w3" d="${wave(2400, 40)}" transform="translate(0,130)"/>
      <path class="ct-wave w2" d="${wave(2400, 34)}" transform="translate(0,142)"/>
      <path class="ct-wave w1" d="${wave(2400, 30)}" transform="translate(0,152)"/>
    </svg></div>`;
}
const CT = { list: [], items: [], inv: [], q: '', filter: 'open', fresh: null, view: ls.get('vh_ct_view') === 'table' ? 'table' : 'cards' };
const CT_ST = { planned: ['Plánováno', 'draft'], sailing: ['Na cestě', 'sent'], port: ['V přístavu', 'postponed'], delivered: ['Doručeno', 'confirmed'] };
const hasApp = a => !!(S.me && Array.isArray(S.me.apps) && S.me.apps.includes(a));
const normCt = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normQ = s => fold(s).replace(/(\d)\s*(mm|m)\b/g, '$1$2').replace(/[^a-z0-9.,]+/g, ' ').trim();
const daysTo = d => d ? Math.round((new Date(d + 'T12:00') - new Date(ymd(new Date()) + 'T12:00')) / 864e5) : null;
const dayWords = n => n === null ? '' : n === 0 ? 'dnes' : n === 1 ? 'zítra' : n === -1 ? 'včera' : n > 0 ? `za ${n} ${n < 5 ? 'dny' : 'dní'}` : `před ${-n} ${-n < 5 ? 'dny' : 'dny'}`;
const ctBadge = s => `<span class="st" data-s="${CT_ST[s][1]}">${CT_ST[s][0]}</span>`;
const ctEta = c => c.status === 'delivered' ? (c.delivered_at || c.ata) : (c.ata || c.eta);
function trackLinks(c) {
  const out = [];
  const tid = c.tracking && c.tracking.t49_container_id;
  if (tid) out.push(['🗺️ Otevřít v Terminal49', `https://app.terminal49.com/containers/${encodeURIComponent(tid)}`]);
  else if (c.number) out.push(['🔎 Sledovat kontejner', `https://www.searates.com/container/tracking/?number=${encodeURIComponent(c.number)}`]);
  return out.map(([l, u]) => `<a class="btn sm" href="${u}" target="_blank" rel="noopener noreferrer">${l}</a>`).join(' ');
}
async function loadCt() {
  const [list, items, inv] = await Promise.all([
    fetchAll(() => sb.from('ct_containers').select('*').order('eta', { ascending: true, nullsFirst: false }).order('created_at')),
    fetchAll(() => sb.from('ct_items').select('*').order('sort').order('created_at')),
    fetchAll(() => sb.from('ct_invoices').select('*').order('created_at')),
  ]);
  CT.list = list; CT.items = items; CT.inv = inv;
}
function ctLocked(label) {
  shell('ct', `<div class="topbar"><h1>${label}</h1></div><div class="panel empty-big"><div class="ill">🔒</div><h3>Zatím jen pro vybrané uživatele</h3><p>Tuhle aplikaci teď vyvíjíme. Jakmile bude hotová, zpřístupníme ji.</p><button class="btn primary" onclick="location.hash='#/'">Zpět na nabídky</button></div>`);
}
async function renderCt() {
  if (!hasApp('kontejnery')) return ctLocked('Kontejnery');
  CT.animated = false;
  shell('ct', `<div class="topbar"><h1>Kontejnery</h1></div><div class="panel panel-b"><div class="sk" style="height:220px"></div></div>`);
  try { await Promise.all([loadCt(), loadProducts()]); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  $('#main').innerHTML = `${pgHead('ct', 'Kontejnery', 'Sledování plavby, faktury a naskladnění z kontejnerů.', `<div class="search pg-search"><span class="ic">⌕</span><input id="ctq" placeholder="Hledat kontejner, B/L, fakturu, produkt…" value="${esc(CT.q)}"></div><button class="btn primary of-new" id="ctNew">＋ Nový kontejner</button>`)}
  <div class="ct-beta"><span>🧪 Testovací verze</span> Kontejnery zatím zkoušíme. Údaje a sledování se ještě ladí, proto s nimi zacházej opatrně a chyby hlas Filipovi.</div><div id="ctHero"></div><div id="ctStats"></div><div class="chips" id="ctF" style="margin-bottom:12px"></div><div id="ctRes"></div><div id="ctList"></div>`;
  $('#ctNew').onclick = async e => { const b = e.currentTarget; b.disabled = true; try { const r = check(await sb.from('ct_containers').insert({ created_by: S.me.id }).select('id').single()); CT.fresh = r.id; location.hash = '#/k/' + r.id; } catch (er) { toast(er.message, true); b.disabled = false; } };
  $('#ctq').oninput = e => { CT.q = e.target.value; drawCt(); };
  drawCt();
}
function drawCt() {
  const open = CT.list.filter(c => !c.archived && c.status !== 'delivered');
  const next = open.filter(c => c.eta || c.ata).sort((a, b) => String(a.ata || a.eta).localeCompare(b.ata || b.eta))[0];
  const nSail = CT.list.filter(c => c.status === 'sailing' && !c.archived).length, nPort = CT.list.filter(c => c.status === 'port' && !c.archived).length, nDone = CT.list.filter(c => c.status === 'delivered' && !c.archived).length;
  const nextD = next ? daysTo(next.ata || next.eta) : null;
  if (!$('#ctHero .ct-sea')) $('#ctHero').innerHTML = ctSeaSvg();
  $('#ctHero .ct-sea-txt').innerHTML = `<div class="ct-sea-k">${nSail + nPort ? 'Právě na cestě' : 'Zatím klid na moři'}</div><div class="ct-sea-v"><span class="cnt" data-n="${nSail + nPort}">${nSail + nPort}</span> ${nSail + nPort === 1 ? 'kontejner' : nSail + nPort < 5 ? 'kontejnery' : 'kontejnerů'}</div><div class="ct-sea-s">${next ? `nejbližší <b>${esc(next.number || 'bez čísla')}</b> přistane ${dayWords(nextD)} · ${czDate(next.ata || next.eta)}` : 'zadej ETA u kontejneru a ukážu ti odpočet'}</div>`;
  $('#ctStats').innerHTML = `<div class="stats ct-stats">
    ${[['⚓', 'V přístavu', nPort, 'čeká na vyzvednutí', 'var(--s-postponed)'], ['🚢', 'Na cestě', nSail, 'kontejnerů na moři', 'var(--s-sent)'], ['🗓️', 'Nejbližší příjezd', null, next ? esc(next.number || 'bez čísla') + ' · ' + czDate(next.ata || next.eta) : 'zadej ETA u kontejneru', 'var(--brand)', next ? dayWords(nextD) : '—'], ['📦', 'Doručeno', nDone, 'celkem', 'var(--s-confirmed)']].map(([ic, k, v, sub, col, txt], n) => `<div class="panel stat ct-stat" style="--c:${col};--i:${n}"><span class="ct-ico">${ic}</span><div class="k">${k}</div><div class="v">${v === null ? txt : `<span class="cnt" data-n="${v}">${v}</span>`}</div><div class="s">${sub}</div></div>`).join('')}</div>`;
  ctCountUp();
  $('#ctF').innerHTML = [['open', 'Na cestě a v přístavu'], ['all', 'Všechny'], ['delivered', 'Doručené'], ['archive', 'Archiv']].map(([k, l]) => `<button class="chip ${CT.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('');
  $('#ctF').innerHTML += `<span class="grow"></span><button class="chip ${CT.view === 'cards' ? 'on' : ''}" data-v="cards">▦ Karty</button><button class="chip ${CT.view === 'table' ? 'on' : ''}" data-v="table">☰ Tabulka</button>`;
  $$('#ctF .chip[data-f]').forEach(b => b.onclick = () => { CT.filter = b.dataset.f; drawCt(); });
  $$('#ctF .chip[data-v]').forEach(b => b.onclick = () => { CT.view = b.dataset.v; ls.set('vh_ct_view', CT.view); drawCt(); });
  const q = normQ(CT.q); const tokens = q.split(' ').filter(Boolean);
  const itemsOf = id => CT.items.filter(i => i.container_id === id);
  // vyhledávání produktu: jednak podle textu v položce, jednak podle kódu produktu nalezeného v e-shopu
  const codes = new Set(tokens.length ? searchProducts(CT.q, true).map(p => p.code) : []);
  const itemHit = i => tokens.length && (codes.has(i.code) || tokens.every(t => normQ([i.code, i.name, i.note, i.ean, i.mpn].join(' ')).includes(t)));
  const invsOf = id => CT.inv.filter(v => v.container_id === id);
  const invText = v => normQ([v.number, v.supplier, v.note, v.file_name].join(' '));
  const invHit = v => tokens.length && tokens.every(t => invText(v).includes(t));
  const cHit = c => !tokens.length || tokens.every(t => normQ([c.number, c.bl, c.booking, c.supplier, c.carrier, c.vessel, c.pol, c.pod, c.note].join(' ')).includes(t)) || itemsOf(c.id).some(itemHit) || invsOf(c.id).some(invHit);
  const byFilter = c => CT.filter === 'archive' ? c.archived : c.archived ? false : CT.filter === 'open' ? c.status !== 'delivered' : CT.filter === 'delivered' ? c.status === 'delivered' : true;
  const hits = tokens.length ? CT.items.filter(itemHit).map(i => ({ i, c: CT.list.find(c => c.id === i.container_id) })).filter(x => x.c && !x.c.archived) : [];
  hits.sort((a, b) => (a.c.status === 'delivered') - (b.c.status === 'delivered') || String(ctEta(a.c) || '9').localeCompare(ctEta(b.c) || '9'));
  const invHits = tokens.length ? CT.inv.filter(invHit).map(v => ({ v, c: CT.list.find(c => c.id === v.container_id) })).filter(x => x.c && !x.c.archived) : [];
  const invPanel = invHits.length ? `<div class="panel" style="margin-bottom:14px;overflow-x:auto"><div style="padding:12px 14px"><b>🧾 Faktury</b></div><table class="list"><thead><tr><th>Faktura</th><th>Dodavatel</th><th class="r">Částka</th><th>Kontejner</th><th>Příjezd</th><th>Stav</th></tr></thead><tbody>
    ${invHits.map(({ v, c }) => `<tr class="click" data-c="${c.id}"><td><b>${highlight(v.number || v.file_name || '—', CT.q)}</b>${v.file_path ? ' 📄' : ''}</td><td>${esc(v.supplier) || '—'}</td><td class="r nowrap">${v.amount == null ? '—' : M(v.amount) + ' ' + esc(v.currency)}</td><td>${esc(c.number) || '—'}</td><td class="nowrap">${ctEta(c) ? czDate(ctEta(c)) : '—'}</td><td>${ctBadge(c.status)}</td></tr>`).join('')}</tbody></table></div>` : '';
  $('#ctRes').innerHTML = invPanel + (hits.length ? `<div class="panel" style="margin-bottom:14px;overflow-x:auto"><div style="padding:12px 14px"><b>🔎 Kdy k nám přijde „${esc(CT.q)}“</b></div><table class="list"><thead><tr><th>Produkt</th><th class="r">Množství</th><th>Kontejner</th><th>Příjezd</th><th>Stav</th></tr></thead><tbody>
    ${hits.map(({ i, c }) => { const d = daysTo(ctEta(c)); return `<tr class="click" data-c="${c.id}"><td><b>${esc(i.code)}</b><div class="small muted">${esc(i.name)}</div></td><td class="r nowrap">${fmtQ(i.qty)} ${esc(i.unit)}</td><td>${esc(c.number) || '—'}<div class="small muted">${esc(c.supplier)}</div></td><td class="nowrap"><b>${ctEta(c) ? czDate(ctEta(c)) : 'neznámé'}</b>${c.status !== 'delivered' && d !== null ? `<div class="small muted">${dayWords(d)}</div>` : ''}</td><td>${ctBadge(c.status)}</td></tr>`; }).join('')}</tbody></table></div>` : tokens.length && !invHits.length ? `<p class="muted small" style="margin:0 0 12px">Produkt „${esc(CT.q)}“ v žádném kontejneru nevidím.</p>` : '');
  const list = CT.list.filter(c => byFilter(c) && cHit(c));
  const cardsHtml = rows => `<div class="ct-cards">${rows.map((c, n) => {
    const its = itemsOf(c.id); const invs = invsOf(c.id); const d = daysTo(ctEta(c)); const late = c.status !== 'delivered' && c.eta && !c.ata && d !== null && d < 0;
    const pr = ctProgress(c); const col = { planned: 'var(--s-draft)', sailing: 'var(--s-sent)', port: 'var(--s-postponed)', delivered: 'var(--s-confirmed)' }[c.status];
    return `<div class="ct-card" data-c="${c.id}" style="--c:${col};--i:${Math.min(n, 12)}" tabindex="0">
      <div class="ct-card-top"><b class="ct-card-num">${highlight(c.number || 'bez čísla', CT.q)}</b>${ctBadge(c.status)}</div>
      <div class="ct-card-body">
        <div class="small muted">${esc(c.supplier) || 'dodavatel neuveden'}${c.carrier ? ' · ' + esc(c.carrier) : ''}${c.tracking && c.tracking.tr_id ? ' · 📡' : ''}</div>
        <div class="ct-voy"><span class="ct-port">${esc(c.pol) || '?'}</span><div class="ct-lane"><i style="width:${Math.round(pr * 100)}%"></i><span class="ct-ship" style="left:${Math.round(pr * 100)}%">${c.status === 'delivered' ? '✅' : c.status === 'port' ? '⚓' : '🚢'}</span></div><span class="ct-port r">${esc(c.pod) || '?'}</span></div>
        <div class="ct-card-eta"><div><div class="small muted">${c.status === 'delivered' ? 'Doručeno' : c.ata ? 'Dorazil' : 'Příjezd'}</div><b>${ctEta(c) ? czDate(ctEta(c)) : '—'}</b></div>${c.status !== 'delivered' && d !== null ? `<span class="ct-count ${late ? 'late' : ''}">${late ? 'po termínu · ' : ''}${dayWords(d)}</span>` : ''}</div>
        <div class="ct-chips">${its.slice(0, 3).map(i => `<span>${esc((i.name || i.code).slice(0, 26))}</span>`).join('')}${its.length > 3 ? `<span class="more">+${its.length - 3}</span>` : ''}${!its.length ? '<span class="more">bez položek</span>' : ''}</div>
      </div>
      <div class="ct-card-foot"><span>📦 ${its.length}</span><span>🧾 ${invs.length}${invs.some(v => v.file_path) ? ' 📄' : ''}</span>${c.stocked_at ? '<span class="tag blue">naskladněno</span>' : ''}</div></div>`;
  }).join('')}</div>`;
  const tableHtml = list.length ? `<div class="panel" style="overflow-x:auto"><table class="list"><thead><tr><th>Kontejner</th><th>Dodavatel / loď</th><th>Trasa</th><th>Příjezd (ETA)</th><th>Obsah</th><th>Faktury</th><th>Stav</th></tr></thead><tbody>
    ${list.map(c => { const its = itemsOf(c.id); const d = daysTo(ctEta(c)); const late = c.status !== 'delivered' && c.eta && !c.ata && d !== null && d < 0;
      return `<tr class="click" data-c="${c.id}"><td class="nowrap"><b>${highlight(c.number || 'bez čísla', CT.q)}</b>${c.bl ? `<div class="small muted">B/L ${esc(c.bl)}</div>` : ''}</td>
      <td>${esc(c.supplier) || '—'}<div class="small muted">${esc(c.vessel) || ''}${c.carrier ? ' · ' + esc(c.carrier) : ''}</div></td><td class="small">${esc(c.pol) || '?'} → ${esc(c.pod) || '?'}</td>
      <td class="nowrap"><b>${ctEta(c) ? czDate(ctEta(c)) : '—'}</b>${c.ata ? ' <span class="tag blue">dorazil</span>' : ''}${c.tracking && c.tracking.tr_id ? ' <span title="Sledováno v reálném čase">📡</span>' : ''}${c.status !== 'delivered' && d !== null ? `<div class="small ${late ? 'warn-t' : 'muted'}">${late ? 'po termínu · ' : ''}${dayWords(d)}</div>` : ''}</td>
      <td class="small">${its.length ? its.slice(0, 3).map(i => esc(i.name || i.code)).join('<br>') + (its.length > 3 ? `<br><span class="muted">+ ${its.length - 3} dalších</span>` : '') : '<span class="muted">bez položek</span>'}</td><td class="small">${invsOf(c.id).map(v => esc(v.number || 'faktura') + (v.file_path ? ' 📄' : '')).join('<br>') || '<span class="muted">—</span>'}</td><td>${ctBadge(c.status)}${c.stocked_at ? ' <span class="tag blue">naskladněno</span>' : ''}</td></tr>`; }).join('')}</tbody></table></div>`
    : `<div class="panel empty-big"><div class="ill">🚢</div><h3>${CT.list.length ? 'Nic nenalezeno' : 'Zatím žádný kontejner'}</h3><p>${CT.list.length ? 'Zkus jiné hledání nebo filtr.' : 'Založ první kontejner — číslo, loď, datum příjezdu a položky z e-shopu.'}</p></div>`;
  $('#ctList').innerHTML = list.length && CT.view === 'cards' ? cardsHtml(list) : tableHtml;
  $$('tr.click, .ct-card', $('#main')).forEach(r => { r.onclick = () => { location.hash = '#/k/' + r.dataset.c; }; r.onkeydown = e => { if (e.key === 'Enter') location.hash = '#/k/' + r.dataset.c; }; });
}

async function ctCall(body) {
  const { data, error } = await sb.functions.invoke('hub-containers', { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; if (j.problems) msg += ' (' + j.problems.map(p => p.code + ': ' + p.message).join('; ') + ')'; } catch {}
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}
const CT_CUR = ['EUR', 'USD', 'CZK', 'CNY'];
async function ctOpenInvoice(inv) {
  const w = window.open('about:blank', '_blank');
  try {
    const { data, error } = await sb.storage.from('ct-invoices').createSignedUrl(inv.file_path, 300);
    if (error) throw error;
    if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl;
  } catch (e) { if (w) w.close(); toast('PDF se nepodařilo otevřít: ' + e.message, true); }
}

let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet.css?v=1.9.4'; document.head.appendChild(css);
    const sc = document.createElement('script'); sc.src = 'vendor/leaflet.js?v=1.9.4'; sc.onload = () => res(window.L); sc.onerror = () => { leafletP = null; rej(new Error('Mapa se nenačetla')); };
    document.head.appendChild(sc);
  });
  return leafletP;
}
// mapa plavby: trasa a poloha lodi z Terminal49 (map_geojson), případně aspoň loď + cílový přístav
function ctHasMap(c) {
  const t = c.tracking || {};
  return !!((t.map && t.map.features && t.map.features.length) || t.position);
}
async function ctDrawMap(c) {
  const el = $('#ctMap'); if (!el) return;
  let L; try { L = await loadLeaflet(); } catch (e) { el.innerHTML = `<p class="muted small" style="padding:14px">${esc(e.message)}</p>`; return; }
  if (CT.map) { try { CT.map.remove(); } catch {} CT.map = null; }
  const t = c.tracking || {};
  const map = L.map(el, { scrollWheelZoom: false, worldCopyJump: true }); CT.map = map;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 9, attribution: '© OpenStreetMap' }).addTo(map);
  const group = L.featureGroup().addTo(map);
  const dot = (ll, label, cls) => L.marker(ll, { icon: L.divIcon({ className: '', html: `<div class="ct-pin ${cls}"><i></i>${label ? `<span>${esc(label)}</span>` : ''}</div>`, iconSize: [0, 0] }) });
  const shipIcon = ll => L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="ct-vessel">🚢</div>', iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 800 });
  const kind = f => String((f.properties && (f.properties.feature_type || '')) + ' ' + (f.properties && (f.properties.status || ''))).toLowerCase();
  if (t.map && t.map.features && t.map.features.length) {
    L.geoJSON(t.map, {
      style: f => { const k = kind(f); const done = /done|complete|past|travel/.test(k); const prog = /progress|current|active/.test(k); return { color: done || prog ? '#16804a' : '#6b7280', weight: done ? 3 : 2.5, dashArray: done ? null : '6 6', opacity: .95 }; },
      pointToLayer: (f, ll) => /vessel/.test(kind(f)) ? shipIcon(ll) : dot(ll, f.properties && f.properties.name, /pod|discharge|arriv|destin/.test(kind(f)) ? 'end' : 'start'),
    }).addTo(group);
  }
  if (t.position && !(t.map && t.map.features.some(f => /vessel/.test(kind(f))))) shipIcon([t.position.lat, t.position.lon]).addTo(group);
  const port = ctPort(c.pod);
  if (port && !(t.map && t.map.features.length)) { dot([port.lat, port.lon], c.pod, 'end').addTo(group); if (t.position) L.polyline([[t.position.lat, t.position.lon], [port.lat, port.lon]], { color: '#6b7280', weight: 2.5, dashArray: '6 6' }).addTo(group); }
  const b = group.getBounds();
  if (b.isValid()) { b.getSouthWest().equals(b.getNorthEast()) ? map.setView(b.getCenter(), 5) : map.fitBounds(b.pad(0.15)); } else map.setView([30, 20], 2);
  setTimeout(() => map.invalidateSize(), 150);
}
const CT_PORTS = [['hamburg', 53.54, 9.97], ['bremerhaven', 53.55, 8.55], ['bremen', 53.55, 8.55], ['wilhelmshaven', 53.52, 8.13], ['rotterdam', 51.95, 4.14], ['antwerp', 51.27, 4.35], ['antverpy', 51.27, 4.35], ['gdansk', 54.40, 18.67], ['gdynia', 54.53, 18.54], ['koper', 45.55, 13.73], ['trieste', 45.65, 13.76], ['rijeka', 45.32, 14.43], ['genoa', 44.41, 8.92], ['la spezia', 44.10, 9.83], ['le havre', 49.48, 0.11], ['felixstowe', 51.95, 1.32], ['barcelona', 41.35, 2.17], ['valencia', 39.44, -0.32], ['constanta', 44.17, 28.65], ['piraeus', 37.94, 23.63]];
const ctPort = name => { const n = fold(name || ''); const p = CT_PORTS.find(x => n.includes(x[0])); return p ? { lat: p[1], lon: p[2] } : null; };
const kmBetween = (a, b, c, d) => { const r = x => x * Math.PI / 180; const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return Math.round(12742 * Math.asin(Math.sqrt(h))); };
const CT_TSTATE = { new: 'nový', on_ship: 'na lodi', available: 'k vyzvednutí v terminálu', not_available: 'v terminálu, zatím nedostupný', grounded: 'uložený v terminálu', on_rail: 'na vlaku', picked_up: 'vyzvednutý', off_dock: 'mimo terminál', delivered: 'doručený', loaded: 'naložený', empty_returned: 'vrácený prázdný', awaiting_inland_transfer: 'čeká na přepravu dál' };
const CT_STEPS = [['planned', 'Plánováno'], ['sailing', 'Na cestě'], ['port', 'V přístavu'], ['delivered', 'Doručeno'], ['stocked', 'Naskladněno']];
const CT_RECV = { ok: ['OK', 'confirmed'], short: ['Méně', 'postponed'], more: ['Více', 'sent'], damaged: ['Poškozeno', 'rejected'], missing: ['Nedorazilo', 'rejected'] };
const recvBadge = s => CT_RECV[s] ? `<span class="st" data-s="${CT_RECV[s][1]}">${CT_RECV[s][0]}</span>` : '<span class="muted small">—</span>';

async function renderContainer(id) {
  if (!hasApp('kontejnery')) return ctLocked('Kontejner');
  shell('ct', `<div class="topbar"><h1>Kontejner</h1></div><div class="panel panel-b"><div class="sk" style="height:260px"></div></div>`);
  try { await Promise.all([loadCt(), loadProducts()]); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const cur = () => CT.list.find(c => c.id === id);
  if (!cur()) { $('#main').innerHTML = `<div class="panel empty-big"><div class="ill">🤷</div><h3>Kontejner nenalezen</h3><button class="btn primary" onclick="location.hash='#/kontejnery'">Zpět</button></div>`; return; }
  let mode = CT.fresh === id ? 'edit' : 'view'; CT.fresh = null;     // view = jen náhled · edit = úpravy · recv = příjem a naskladnění
  const sel = new Set();                                              // vybrané řádky k naskladnění
  const patch = async f => { check(await sb.from('ct_containers').update({ ...f, updated_at: new Date().toISOString() }).eq('id', id)); Object.assign(cur(), f); };
  const main = $('#main');
  main.innerHTML = `<div class="topbar"><a class="btn" href="#/kontejnery">← Kontejnery</a><span class="grow"></span><span id="cBar" class="row"></span></div><div id="cBody"></div>`;
  main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
  const stocked = () => !!cur().stocked_at;
  const itemsOf = () => CT.items.filter(i => i.container_id === id);
  const invsOf = () => CT.inv.filter(i => i.container_id === id);
  const lockedItem = i => i.stocked || stocked();
  const fld = (k, label, ph = '', type = 'text') => `<div><label>${label}</label><input data-k="${k}" type="${type}" value="${esc(cur()[k] ?? '')}" placeholder="${esc(ph)}"></div>`;
  const kv = (label, v) => v ? `<div class="ct-kv"><span>${label}</span><b>${v}</b></div>` : '';
  const amt = i => toNum(i.got ?? i.qty);
  const unitSum = its => { const m = {}; for (const i of its) m[i.unit || 'ks'] = (m[i.unit || 'ks'] || 0) + toNum(i.qty); return Object.entries(m).map(([u, n]) => fmtQ(n) + ' ' + u).join(' · '); };

  function bar() {
    const c = cur();
    $('#cBar').innerHTML = mode === 'edit'
      ? `<button class="btn" id="cArch">${c.archived ? 'Vrátit z archivu' : 'Archivovat'}</button><button class="btn danger" id="cDel">Smazat</button><button class="btn primary" id="cDone">✓ Hotovo</button>`
      : mode === 'recv'
        ? `<button class="btn" id="cBack">← Zpět na náhled</button>`
        : `<button class="btn" id="cEdit">✏️ Upravit</button><button class="btn primary" id="cRecv">📥 Naskladnit</button>`;
    const on = (sel2, fn) => { const e = $(sel2); if (e) e.onclick = fn; };
    on('#cEdit', () => { mode = 'edit'; draw(); });
    on('#cDone', () => { mode = 'view'; draw(); });
    on('#cBack', () => { mode = 'view'; draw(); });
    on('#cRecv', () => { mode = 'recv'; sel.clear(); itemsOf().filter(i => !lockedItem(i) && !i.custom && i.recv_state && i.recv_state !== 'missing').forEach(i => sel.add(i.id)); draw(); });
    on('#cArch', async () => { try { await patch({ archived: !cur().archived }); toast(cur().archived ? 'Archivováno' : 'Vráceno z archivu'); bar(); } catch (e) { toast(e.message, true); } });
    on('#cDel', async () => {
      if (stocked() || itemsOf().some(i => i.stocked)) return toast('Kontejner, který je (částečně) naskladněný, smazat nejde. Můžeš ho archivovat.', true);
      if (!(await confirmBox('Smazat kontejner?', 'Smaže se i jeho seznam položek a přiložené faktury.', { ok: 'Smazat', danger: true }))) return;
      try { const paths = invsOf().map(i => i.file_path).filter(Boolean); if (paths.length) await sb.storage.from('ct-invoices').remove(paths); check(await sb.from('ct_containers').delete().eq('id', id)); toast('Smazáno'); location.hash = '#/kontejnery'; } catch (e) { toast(e.message, true); }
    });
  }

  // ---------- hlavička: číslo, průběh, příjezd ----------
  function hero() {
    const c = cur(); const d = daysTo(ctEta(c)); const idx = stocked() ? 4 : Math.max(0, CT_STEPS.findIndex(x => x[0] === c.status));
    const steps = CT_STEPS.map(([k, l], n) => {
      const cls = n < idx ? 'done' : n === idx ? 'now' : '';
      const clickable = mode === 'edit' && k !== 'stocked';
      return `<${clickable ? 'button' : 'div'} class="ct-st ${cls}" ${clickable ? `data-st="${k}"` : ''}><i>${n < idx ? '✓' : n + 1}</i><span>${l}</span></${clickable ? 'button' : 'div'}>`;
    }).join('<u></u>');
    const late = c.status !== 'delivered' && c.eta && !c.ata && d !== null && d < 0;
    return `<div class="panel ct-hero"><div class="ct-hero-top"><div><div class="ct-num">${esc(c.number) || 'Nový kontejner'}</div><div class="muted">${esc(c.supplier) || 'dodavatel neuveden'}${c.carrier ? ' · ' + esc(c.carrier) : ''}${c.archived ? ' · <b>archivováno</b>' : ''}</div></div>
      <div class="ct-eta"><span class="muted small">${c.status === 'delivered' ? 'Doručeno' : c.ata ? 'Dorazil do přístavu' : 'Příjezd (ETA)'}</span><b>${ctEta(c) ? czDate(ctEta(c)) : '—'}</b>${c.status !== 'delivered' && d !== null ? `<span class="${late ? 'warn-t' : 'muted'} small">${late ? 'po termínu · ' : ''}${dayWords(d)}</span>` : ''}</div></div>
      <div class="ct-steps">${steps}</div></div>`;
  }

  // ---------- sledování (Terminal49) ----------
  function trackPanel() {
    const c = cur(); const t = c.tracking || {}; const on = !!(t.tr_id || t.t49_container_id);
    if (!on) return c.status === 'delivered' ? '' : `<div class="panel panel-b ct-sec ct-track"><div style="flex:1;min-width:220px"><b>📡 Sledování v reálném čase</b><div class="small muted">Napojení na Terminal49: stav, loď, ETA a (s doplňkovou licencí) poloha lodi. Po zapnutí se obnovuje samo zhruba každé 3 hodiny.</div></div><button class="btn primary" id="tkStart">Spustit sledování</button></div>`;
    const pos = t.position; const port = ctPort(c.pod);
    const km = pos && port ? kmBetween(pos.lat, pos.lon, port.lat, port.lon) : null;
    const ev = (t.events || []).slice(0, 8);
    return `<div class="panel ct-sec"><div class="panel-h">📡 Sledování <span class="sub">Terminal49${c.tracked_at ? ' · aktualizováno ' + czDateTime(c.tracked_at) : ''}</span><span class="grow"></span><button class="btn sm" id="tkRefresh">↻ Obnovit teď</button></div>
      <div class="panel-b" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
        <div class="ct-kv"><span>Stav u Terminal49</span><b>${t.status && t.status !== 'created' ? (t.status === 'failed' ? 'sledování selhalo: ' + esc(t.failed_reason || '') : 'čekáme na data od rejdaře') : esc(CT_TSTATE[t.state] || t.state || 'sledováno')}</b></div>
        ${t.terminal ? `<div class="ct-kv"><span>Terminál</span><b>${esc(t.terminal)}</b></div>` : ''}${t.voyage ? `<div class="ct-kv"><span>Plavba (voyage)</span><b>${esc(t.voyage)}</b></div>` : ''}${t.last_error ? `<div class="small warn-t" style="grid-column:1/-1">Poslední chyba: ${esc(t.last_error)}</div>` : ''}
        ${pos ? `<div class="ct-kv"><span>Poloha lodi${pos.at ? ' (' + czDateTime(pos.at) + ')' : ''}</span><b>${pos.lat.toFixed(2)}°, ${pos.lon.toFixed(2)}° <a href="https://www.openstreetmap.org/?mlat=${pos.lat}&mlon=${pos.lon}#map=5/${pos.lat}/${pos.lon}" target="_blank" rel="noopener noreferrer">mapa</a></b>${pos.speed != null ? `<small class="muted">rychlost ${esc(pos.speed)} uzlů</small>` : ''}</div>
          ${km != null ? `<div class="ct-kv"><span>Do ${esc(c.pod)}</span><b>asi ${km.toLocaleString('cs')} km</b><small class="muted">vzdušnou čarou</small></div>` : ''}`
          : t.routing === false ? `<div class="small muted" style="grid-column:1/-1">Poloha lodi na mapě vyžaduje u Terminal49 doplňkovou licenci (Routing Data). Stav, loď a datum příjezdu se sledují i bez ní.</div>` : t.routing_http && t.routing_http !== 200 ? `<div class="small muted" style="grid-column:1/-1">Mapu trasy se zatím nepodařilo načíst (Terminal49: ${esc(t.routing_http)}${t.routing_msg ? ' · ' + esc(t.routing_msg) : ''}).</div>` : ''}
      </div>
      ${ev.length ? `<div style="padding:0 16px 14px"><div class="small muted" style="margin-bottom:6px">Poslední události</div>${ev.map(e => `<div class="ct-ev"><span class="muted small nowrap">${e.at ? czDateTime(e.at) : ''}</span><span>${esc(String(e.e).replace(/^container\.transport\./, '').replace(/_/g, ' '))}${e.loc ? ' · ' + esc(e.loc) : ''}${e.vessel ? ' · ' + esc(e.vessel) : ''}</span></div>`).join('')}</div>` : ''}</div>`;
  }
  async function trackNow(btn, extra = {}) {
    const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Načítám…';
    try {
      const r = await ctCall({ action: 'ct_track', containerId: id, force: true, scac: extra.scac });
      if (r.needScac) {
        btn.disabled = false; btn.innerHTML = old;
        const v = await modal({ title: 'Který je to rejdař?', focus: '[data-sc]',
          body: `<p class="small">Terminal49 si není jistý rejdařem. Vyber ho, nebo napiš jeho SCAC kód (MSC = MSCU, Maersk = MAEU, CMA CGM = CMDU, Hapag-Lloyd = HLCU, ONE = ONEY, Evergreen = EGLV).</p>${r.candidates.length ? `<label>Návrhy</label><select data-pick><option value="">— vyber —</option>${r.candidates.map(x => `<option value="${esc(x.scac)}">${esc(x.name)} (${esc(x.scac)})</option>`).join('')}</select>` : ''}<label>SCAC kód</label><input data-sc maxlength="4" style="text-transform:uppercase">`,
          actions: [{ label: 'Zrušit', value: null }, { label: 'Pokračovat', cls: 'primary', value: bd => ($('[data-sc]', bd).value.trim() || ($('[data-pick]', bd) ? $('[data-pick]', bd).value : '')) }] });
        if (v) return trackNow(btn, { ...extra, scac: v });
        return;
      }
      if (!r.ok) toast(r.message || 'Sledování se nepovedlo', true);
      else toast(r.pending ? r.message : 'Sledování aktualizováno');
      await loadCt(); draw();
    } catch (e) {
      if (/TERMINAL49_API_KEY/.test(e.message)) await modal({ title: 'Sledování ještě není zapnuté', body: '<p>V Supabase chybí tajný klíč <b>TERMINAL49_API_KEY</b>. Přidej ho v Supabase → Edge Functions → Secrets (návod ti poslal Claude v chatu) a zkus to znovu.</p>', actions: [{ label: 'Rozumím', value: null, cls: 'primary' }] });
      else toast(e.message, true);
      btn.disabled = false; btn.innerHTML = old;
    }
  }

  // ---------- náhled ----------
  const t0 = c => { const t = c.tracking || {}; return t.position && t.position.at ? 'poloha lodi ' + czDateTime(t.position.at) : ''; };
  function viewBody() {
    const c = cur(); const its = itemsOf(); const invs = invsOf();
    const open = its.filter(i => !lockedItem(i) && !i.custom);
    const factsOnly = [kv('B/L', esc(c.bl)), kv('Booking', esc(c.booking)), kv('Loď', esc(c.vessel) + (c.imo ? ` <small class="muted">IMO ${esc(c.imo)}</small>` : '')), kv('Trasa', c.pol || c.pod ? esc(c.pol || '?') + ' → ' + esc(c.pod || '?') : ''),
      kv('Odplutí (ETD)', c.etd ? czDate(c.etd) : ''), kv('Skutečný příjezd', c.ata ? czDate(c.ata) : ''), kv('Doručeno k nám', c.delivered_at ? czDate(c.delivered_at) : ''), kv('Naskladněno', c.stocked_at ? czDate(String(c.stocked_at).slice(0, 10)) : '')].join('');
    return `${hero()}
    ${c.status === 'delivered' && !stocked() && open.length ? `<div class="oj-banner"><span>📥 Kontejner je doručený. Zkontroluj, co dorazilo, a naskladni ho do Shoptetu (zbývá ${open.length} ${open.length === 1 ? 'řádek' : open.length < 5 ? 'řádky' : 'řádků'}).</span><span class="grow"></span><button class="btn primary" id="cRecv2">📥 Naskladnit</button></div>` : ''}
    <div class="ct-grid">
      <div class="panel panel-b ct-facts"><h4>Informace</h4>${factsOnly || '<span class="muted small">Zatím bez údajů — doplň je v úpravách.</span>'}${c.note ? `<div class="ct-note"><span class="muted small">Poznámka</span><div>${esc(c.note)}</div></div>` : ''}${c.delivery_note ? `<div class="ct-note"><span class="muted small">Poznámka k doručení</span><div>${esc(c.delivery_note)}</div></div>` : ''}<div style="margin-top:12px">${trackLinks(c)}</div></div>
      <div class="panel panel-b ct-sum"><h4>Souhrn</h4><div class="ct-big">${its.length}<small> ${its.length === 1 ? 'položka' : its.length < 5 ? 'položky' : 'položek'}</small></div><div class="muted small">${unitSum(its) || '—'}</div>
        <div class="ct-big" style="margin-top:12px">${invs.length}<small> ${invs.length === 1 ? 'faktura' : invs.length < 5 ? 'faktury' : 'faktur'}</small></div><div class="muted small">${invs.filter(v => v.file_path).length} s PDF</div>
        <div class="ct-big" style="margin-top:12px">${its.filter(i => i.stocked).length}<small> / ${its.filter(i => !i.custom).length} naskladněno</small></div></div>
    </div>
    ${trackPanel()}
    ${ctHasMap(c) ? `<div class="panel ct-sec ct-mapbox"><div class="panel-h">🗺️ Mapa plavby<span class="sub">${t0(c)}</span><span class="grow"></span>${trackLinks(c)}</div><div id="ctMap"></div></div>` : ''}
    <div class="panel ct-sec"><div class="panel-h">Obsah kontejneru</div><div style="overflow-x:auto"><table class="list"><thead><tr><th>Kód</th><th>Produkt</th><th class="r">Objednáno</th><th class="r">Dorazilo</th><th>Příjem</th><th></th></tr></thead><tbody>
      ${its.map(i => `<tr><td class="nowrap"><b>${esc(i.code) || '—'}</b></td><td>${esc(i.name)}${i.custom ? ' <span class="tag">mimo Shoptet</span>' : ''}${i.note ? `<div class="small muted">${esc(i.note)}</div>` : ''}${!i.custom && (i.ean || i.mpn) ? `<div class="small muted">${[i.ean && 'EAN ' + esc(i.ean), i.mpn && 'MPN ' + esc(i.mpn)].filter(Boolean).join(' · ')}</div>` : ''}${i.recv_note ? `<div class="small warn-t">↳ ${esc(i.recv_note)}</div>` : ''}</td>
        <td class="r nowrap">${fmtQ(i.qty)} ${esc(i.unit)}</td><td class="r nowrap">${i.got == null ? '<span class="muted">—</span>' : `<b ${toNum(i.got) !== toNum(i.qty) ? 'class="warn-t"' : ''}>${fmtQ(i.got)} ${esc(i.unit)}</b>`}</td><td>${recvBadge(i.recv_state)}</td>
        <td class="small">${i.stocked ? '<span class="tag blue">naskladněno</span>' : i.custom ? '<span class="muted">nenaskladňuje se</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Zatím bez položek — přidej je v úpravách.</td></tr>'}</tbody></table></div></div>
    ${invoicesPanel(false)}`;
  }

  function invoicesPanel(editing) {
    const invs = invsOf();
    return `<div class="panel ct-sec"><div class="panel-h">Faktury <span class="sub">${invs.length ? invs.length : ''}</span><span class="grow"></span>${editing ? '<button class="btn sm" id="cInvAdd">＋ Přidat fakturu (PDF)</button>' : ''}</div><div style="overflow-x:auto"><table class="list"><thead><tr><th>Číslo faktury</th><th>Dodavatel</th><th class="r">Částka</th><th>Datum</th><th>PDF</th>${editing ? '<th></th>' : ''}</tr></thead><tbody>
      ${invs.map(v => editing
        ? `<tr data-v="${v.id}"><td><input data-vf="number" value="${esc(v.number)}" style="width:150px"></td><td><input data-vf="supplier" value="${esc(v.supplier)}"></td><td class="r nowrap"><input type="number" step="any" data-vf="amount" value="${v.amount ?? ''}" style="width:100px;text-align:right"> <select data-vf="currency" style="width:auto">${CT_CUR.map(x => `<option ${x === v.currency ? 'selected' : ''}>${x}</option>`).join('')}</select></td><td><input type="date" data-vf="issued_at" value="${v.issued_at || ''}"></td>
          <td>${v.file_path ? `<a href="#" data-pdf="${v.id}">📄 ${esc(v.file_name || 'faktura.pdf')}</a>` : '<span class="muted">bez PDF</span>'}</td><td><button class="btn sm" data-vrm="${v.id}">✕</button></td></tr>`
        : `<tr><td><b>${esc(v.number) || '—'}</b>${v.note ? `<div class="small muted">${esc(v.note)}</div>` : ''}</td><td>${esc(v.supplier) || '—'}</td><td class="r nowrap">${v.amount == null ? '—' : M(v.amount) + ' ' + esc(v.currency)}</td><td class="nowrap">${v.issued_at ? czDate(v.issued_at) : '—'}</td>
          <td>${v.file_path ? `<a href="#" data-pdf="${v.id}">📄 ${esc(v.file_name || 'faktura.pdf')}</a>` : '<span class="muted">bez PDF</span>'}</td></tr>`).join('') || `<tr><td colspan="${editing ? 6 : 5}" class="empty">Zatím žádná faktura${editing ? ' — přidej ji tlačítkem nahoře.' : '.'}</td></tr>`}</tbody></table></div></div>`;
  }

  // ---------- úpravy ----------
  function editBody() {
    const c = cur(); const its = itemsOf();
    return `${hero()}
    <div class="panel panel-b ct-sec"><div class="small" style="margin-bottom:12px">✏️ <b>Režim úprav</b> — změny se ukládají hned. Stav změníš kliknutím na krok nahoře.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">
      ${fld('number', 'Číslo kontejneru', 'např. MSCU1234567')}${fld('bl', 'B/L (konosament)')}${fld('booking', 'Booking')}${fld('supplier', 'Dodavatel')}${fld('carrier', 'Přepravce (rejdař)', 'např. MSC')}${fld('scac', 'Kód rejdaře (SCAC)', 'MSCU, MAEU… (prázdné = automaticky)')}
      ${fld('vessel', 'Loď')}${fld('imo', 'IMO lodi', '7 číslic')}${fld('pol', 'Přístav nalodění')}${fld('pod', 'Přístav vyloďení', 'např. Hamburk')}
      ${fld('etd', 'Odplutí (ETD)', '', 'date')}${fld('eta', 'Příjezd (ETA)', '', 'date')}${fld('ata', 'Skutečný příjezd', '', 'date')}${fld('delivered_at', 'Doručeno k nám', '', 'date')}</div>
      <label style="margin-top:12px">Poznámka</label><input data-k="note" value="${esc(c.note)}"><div style="margin-top:10px">${trackLinks(c)}</div></div>
    <div class="panel ct-sec"><div class="panel-h">Obsah kontejneru</div><div style="overflow-x:auto"><table class="list"><thead><tr><th>Kód</th><th>Produkt</th><th class="r" style="width:120px">Množství</th><th style="width:80px">Jednotka</th><th></th></tr></thead><tbody>
      ${its.map(i => `<tr data-i="${i.id}"><td class="nowrap">${i.custom && !lockedItem(i) ? `<input data-f="code" value="${esc(i.code)}" placeholder="kód" style="width:110px">` : `<b>${esc(i.code) || '—'}</b>`}</td>
        <td>${i.custom && !lockedItem(i) ? `<input data-f="name" value="${esc(i.name)}" placeholder="název"><input data-f="note" value="${esc(i.note)}" placeholder="EAN, MPN, poznámka…" style="margin-top:4px">` : esc(i.name)}${i.custom ? '<div style="margin-top:4px"><span class="tag">mimo Shoptet</span>' + (lockedItem(i) ? '' : ' <label style="display:inline"><input type="checkbox" data-f="custom" checked style="width:auto"> není v Shoptetu</label>') + '</div>' : ''}${i.stocked ? ' <span class="tag blue">naskladněno</span>' : ''}</td>
        <td class="r"><input type="number" step="any" min="0" data-f="qty" value="${i.qty}" style="width:100px;text-align:right" ${lockedItem(i) ? 'disabled' : ''}></td><td><input data-f="unit" value="${esc(i.unit)}" style="width:70px" ${lockedItem(i) ? 'disabled' : ''}></td>
        <td>${lockedItem(i) ? '' : `<button class="btn sm" data-rm="${i.id}">✕</button>`}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Zatím bez položek — přidej je níže.</td></tr>'}</tbody></table></div></div>
    ${stocked() ? '' : `<div class="panel panel-b ct-sec"><label>＋ Přidat produkt z e-shopu (kód, název, EAN, MPN…)</label><div style="position:relative"><input id="cAddQ" placeholder="např. Carrara click 6mm" autocomplete="off"><div id="cAddRes" class="results" hidden></div></div><div style="margin-top:10px"><button class="btn" id="cAddCustom">＋ Produkt, který není v Shoptetu</button> <span class="small muted">Do skladu se nenaskladní, jen se eviduje a dá se vyhledat.</span></div></div>`}
    ${invoicesPanel(true)}`;
  }

  // ---------- příjem a naskladnění ----------
  function recvBody() {
    const c = cur(); const its = itemsOf();
    const pickable = i => !lockedItem(i) && !i.custom;
    const chosen = its.filter(i => sel.has(i.id) && pickable(i));
    const todo = its.filter(pickable);
    return `${hero()}
    <div class="panel panel-b ct-sec"><div class="ct-flow"><span class="on">1 · Co dorazilo</span><u></u><span class="on">2 · Vyber a uprav množství</span><u></u><span>3 · Kontrola a schválení</span></div>
      <div style="display:grid;grid-template-columns:200px 1fr;gap:12px;margin-top:14px" class="ct-recv-top"><div><label>Doručeno k nám</label><input type="date" id="rDate" value="${esc(c.delivered_at || '')}"></div><div><label>Poznámka k doručení (stav obalů, poškození, rozdíly…)</label><input id="rNote" value="${esc(c.delivery_note)}" placeholder="např. 2 palety promáčknuté, jinak v pořádku"></div></div></div>
    <div class="panel ct-sec"><div class="panel-h">Příjem položek <span class="sub">${chosen.length} z ${todo.length} vybráno</span><span class="grow"></span>
      <button class="btn sm" id="rAllOk">Všechno dorazilo OK</button><button class="btn sm" id="rSelAll">Vybrat vše</button><button class="btn sm" id="rSelNone">Zrušit výběr</button></div>
      <div style="overflow-x:auto"><table class="list"><thead><tr><th style="width:34px"></th><th>Produkt</th><th class="r">Objednáno</th><th style="width:150px">Stav</th><th class="r" style="width:150px">Naskladnit množství</th><th style="min-width:180px">Poznámka</th></tr></thead><tbody>
      ${its.map(i => {
        const lk = lockedItem(i);
        return `<tr data-i="${i.id}" class="${lk ? 'ct-done' : ''}"><td>${pickable(i) ? `<input type="checkbox" data-sel ${sel.has(i.id) ? 'checked' : ''} style="width:auto">` : ''}</td>
          <td><b>${esc(i.code) || '—'}</b> ${i.custom ? '<span class="tag">mimo Shoptet</span>' : ''}${i.stocked ? ' <span class="tag blue">naskladněno</span>' : ''}<div class="small muted">${esc(i.name)}</div></td>
          <td class="r nowrap">${fmtQ(i.qty)} ${esc(i.unit)}</td>
          <td>${lk ? recvBadge(i.recv_state) : `<select data-r="recv_state"><option value="">— zkontrolovat —</option>${Object.entries(CT_RECV).map(([k, v]) => `<option value="${k}" ${i.recv_state === k ? 'selected' : ''}>${v[0] === 'OK' ? 'Dorazilo OK' : v[0] === 'Méně' ? 'Dorazilo méně' : v[0] === 'Více' ? 'Dorazilo více' : v[0]}</option>`).join('')}</select>`}</td>
          <td class="r nowrap">${lk || i.custom ? (i.got == null ? '—' : fmtQ(i.got) + ' ' + esc(i.unit)) : `<input type="number" step="any" min="0" data-r="got" value="${i.got ?? ''}" placeholder="${fmtQ(i.qty)}" style="width:100px;text-align:right"> ${esc(i.unit)}`}</td>
          <td>${lk ? esc(i.recv_note) : `<input data-r="recv_note" value="${esc(i.recv_note)}" placeholder="poznámka k řádku">`}</td></tr>`;
      }).join('') || '<tr><td colspan="6" class="empty">Kontejner nemá položky.</td></tr>'}</tbody></table></div>
      <div class="ct-foot"><span class="muted small">Naskladní se jen zaškrtnuté řádky, v množství ve sloupci „Naskladnit množství“ (prázdné = objednané). Zbytek můžeš naskladnit později.</span><span class="grow"></span>
        <button class="btn primary" id="rGo" ${chosen.length ? '' : 'disabled'}>📥 Naskladnit vybrané (${chosen.length}) do Shoptetu…</button></div></div>
    ${stocked() ? '<div class="panel panel-b ct-sec">✅ Všechno je naskladněné do Shoptetu.</div>' : ''}`;
  }

  function draw() {
    bar();
    $('#cBody').innerHTML = mode === 'edit' ? editBody() : mode === 'recv' ? recvBody() : viewBody();
    bind();
  }
  function bind() {
    const b = $('#cBody');
    $$('[data-pdf]', b).forEach(a => a.onclick = e => { e.preventDefault(); const v = CT.inv.find(x => x.id === a.dataset.pdf); if (v) ctOpenInvoice(v); });
    const r2 = $('#cRecv2'); if (r2) r2.onclick = () => $('#cRecv').click();
    if (mode === 'view' && $('#ctMap')) ctDrawMap(cur());
    const tk1 = $('#tkStart'); if (tk1) tk1.onclick = () => trackNow(tk1);
    const tk2 = $('#tkRefresh'); if (tk2) tk2.onclick = () => trackNow(tk2, { force: true });
    if (mode === 'recv') return bindRecv(b);
    if (mode !== 'edit') return;
    $$('[data-st]', b).forEach(x => x.onclick = async () => { const st = x.dataset.st; try { await patch({ status: st, ...(st === 'delivered' && !cur().delivered_at ? { delivered_at: ymd(new Date()) } : {}) }); draw(); } catch (e) { toast(e.message, true); } });
    $$('[data-k]', b).forEach(i => i.onchange = async () => {
      const k = i.dataset.k; let v = i.value.trim(); if (k === 'number') v = normCt(v); if (k === 'scac') v = v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); if (['etd', 'eta', 'ata', 'delivered_at'].includes(k)) v = v || null;
      try { await patch({ [k]: v }); if (k === 'number') i.value = v; if (['number', 'eta', 'ata', 'delivered_at', 'supplier', 'carrier'].includes(k)) draw(); } catch (e) { toast(e.message, true); }
    });
    $$('[data-i] [data-f]', b).forEach(i => i.onchange = async () => {
      const row = CT.items.find(x => x.id === i.closest('tr').dataset.i); const f = i.dataset.f;
      const v = f === 'custom' ? i.checked : (f === 'unit' || f === 'code' || f === 'name' || f === 'note') ? i.value.trim() : toNum(i.value);
      try { check(await sb.from('ct_items').update({ [f]: v }).eq('id', row.id)); row[f] = v; if (f === 'custom') draw(); } catch (e) { toast(e.message, true); }
    });
    $$('[data-rm]', b).forEach(x => x.onclick = async () => { try { check(await sb.from('ct_items').delete().eq('id', x.dataset.rm)); CT.items = CT.items.filter(i => i.id !== x.dataset.rm); draw(); } catch (e) { toast(e.message, true); } });
    $$('[data-v] [data-vf]', b).forEach(i => i.onchange = async () => {
      const row = CT.inv.find(x => x.id === i.closest('tr').dataset.v); const f = i.dataset.vf;
      const v = f === 'amount' ? (i.value.trim() === '' ? null : toNum(i.value)) : f === 'issued_at' ? (i.value || null) : i.value.trim();
      try { check(await sb.from('ct_invoices').update({ [f]: v }).eq('id', row.id)); row[f] = v; } catch (e) { toast(e.message, true); }
    });
    $$('[data-vrm]', b).forEach(x => x.onclick = async () => {
      const v = CT.inv.find(i => i.id === x.dataset.vrm);
      if (!(await confirmBox('Smazat fakturu?', `${v.number || 'Faktura'}${v.file_name ? ' · ' + v.file_name : ''} — smaže se i nahrané PDF.`, { ok: 'Smazat', danger: true }))) return;
      try { if (v.file_path) await sb.storage.from('ct-invoices').remove([v.file_path]); check(await sb.from('ct_invoices').delete().eq('id', v.id)); CT.inv = CT.inv.filter(i => i.id !== v.id); draw(); } catch (e) { toast(e.message, true); }
    });
    const add = $('#cInvAdd'); if (add) add.onclick = addInvoice;
    const ac = $('#cAddCustom'); if (ac) ac.onclick = addCustom;
    const q = $('#cAddQ'), res = $('#cAddRes');
    if (!q) return;
    q.oninput = () => {
      const f = searchProducts(q.value, false).slice(0, 8);
      res.hidden = !f.length;
      res.innerHTML = f.length ? f.map((p, k) => `<div class="res" data-p="${k}" style="padding:8px 12px;cursor:pointer"><b>${esc(p.code)}</b> ${esc(p.name)}${p.variant ? ', ' + esc(p.variant) : ''}${p.ean || p.mpn ? `<span class="small muted"> · ${[p.ean && 'EAN ' + esc(p.ean), p.mpn && 'MPN ' + esc(p.mpn)].filter(Boolean).join(' · ')}</span>` : ''}</div>`).join('') : '';
      $$('[data-p]', res).forEach(r => r.onmousedown = async e => {
        e.preventDefault(); const p = f[r.dataset.p]; const sort = itemsOf().length;
        try { const row = check(await sb.from('ct_items').insert({ container_id: id, code: p.code, name: p.name + (p.variant ? ', ' + p.variant : ''), qty: 1, unit: 'ks', sort, ean: p.ean || '', mpn: p.mpn || '' }).select().single()); CT.items.push(row); draw(); $('#cAddQ').focus(); }
        catch (er) { toast(er.message, true); }
      });
    };
    q.onblur = () => setTimeout(() => { res.innerHTML = ''; res.hidden = true; }, 150);
  }
  function bindRecv(b) {
    const setItem = async (row, f) => { check(await sb.from('ct_items').update(f).eq('id', row.id)); Object.assign(row, f); };
    $('#rDate').onchange = async e => { try { await patch({ delivered_at: e.target.value || null }); } catch (er) { toast(er.message, true); } };
    $('#rNote').onchange = async e => { try { await patch({ delivery_note: e.target.value.trim() }); } catch (er) { toast(er.message, true); } };
    $$('[data-sel]', b).forEach(x => x.onchange = () => { const idr = x.closest('tr').dataset.i; x.checked ? sel.add(idr) : sel.delete(idr); draw(); });
    $$('[data-r]', b).forEach(x => x.onchange = async () => {
      const row = CT.items.find(i => i.id === x.closest('tr').dataset.i); const f = x.dataset.r;
      try {
        if (f === 'recv_state') {
          const patchF = { recv_state: x.value };
          if (x.value === 'ok' && row.got == null) patchF.got = toNum(row.qty);
          if (x.value === 'missing') { patchF.got = 0; sel.delete(row.id); } else if (x.value) sel.add(row.id); else sel.delete(row.id);
          await setItem(row, patchF); draw();
        } else if (f === 'got') { const v = x.value.trim() === '' ? null : toNum(x.value); await setItem(row, { got: v }); if (v != null && v !== toNum(row.qty) && !row.recv_state) await setItem(row, { recv_state: v < toNum(row.qty) ? 'short' : 'more' }); draw(); }
        else await setItem(row, { recv_note: x.value.trim() });
      } catch (e) { toast(e.message, true); }
    });
    $('#rAllOk').onclick = async () => {
      try { for (const i of itemsOf().filter(i => !lockedItem(i) && !i.custom)) { await setItem(i, { recv_state: 'ok', ...(i.got == null ? { got: toNum(i.qty) } : {}) }); sel.add(i.id); } draw(); } catch (e) { toast(e.message, true); }
    };
    $('#rSelAll').onclick = () => { itemsOf().filter(i => !lockedItem(i) && !i.custom).forEach(i => sel.add(i.id)); draw(); };
    $('#rSelNone').onclick = () => { sel.clear(); draw(); };
    $('#rGo').onclick = () => ctStockFlow($('#rGo'));
  }
  async function addCustom() {
    const v = await modal({ title: 'Produkt mimo Shoptet', focus: '[data-n="name"]',
      body: `<label>Název produktu</label><input data-n="name" placeholder="např. Carrara click 6mm, bílá"><label>Kód / EAN / MPN <span class="muted">(volitelné, dá se podle něj hledat)</span></label><input data-n="code">
        <div style="display:grid;grid-template-columns:1fr 100px;gap:8px"><div><label>Množství</label><input data-n="qty" inputmode="decimal" value="1"></div><div><label>Jednotka</label><input data-n="unit" value="ks"></div></div><label>Poznámka</label><input data-n="note" placeholder="EAN, MPN, rozměr, barva…">`,
      actions: [{ label: 'Zrušit', value: null }, { label: 'Přidat', cls: 'primary', value: bd => Object.fromEntries($$('[data-n]', bd).map(x => [x.dataset.n, x.value.trim()])) }] });
    if (!v) return;
    if (!v.name) return toast('Doplň název produktu.', true);
    try {
      const row = check(await sb.from('ct_items').insert({ container_id: id, code: v.code, name: v.name, qty: toNum(v.qty) || 1, unit: v.unit || 'ks', note: v.note, custom: true, sort: itemsOf().length }).select().single());
      CT.items.push(row); draw(); toast('Přidáno');
    } catch (e) { toast(e.message, true); }
  }
  async function addInvoice() {
    const v = await modal({ title: 'Přidat fakturu', focus: '[data-n="number"]',
      body: `<label>Číslo faktury</label><input data-n="number" placeholder="např. INV-2026-0123"><label>Dodavatel</label><input data-n="supplier" value="${esc(cur().supplier)}">
        <div style="display:grid;grid-template-columns:1fr 100px;gap:8px"><div><label>Částka</label><input data-n="amount" inputmode="decimal"></div><div><label>Měna</label><select data-n="currency">${CT_CUR.map(x => `<option>${x}</option>`).join('')}</select></div></div>
        <label>Datum vystavení</label><input type="date" data-n="issued_at"><label>PDF faktury (max 15 MB)</label><input type="file" data-n="file" accept="application/pdf,.pdf"><label>Poznámka</label><input data-n="note">`,
      actions: [{ label: 'Zrušit', value: null }, { label: 'Přidat', cls: 'primary', value: bd => Object.fromEntries($$('[data-n]', bd).map(x => [x.dataset.n, x.type === 'file' ? x.files[0] : x.value.trim()])) }] });
    if (!v) return;
    const file = v.file;
    if (file && !(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) return toast('Nahrát jde jen PDF.', true);
    if (file && file.size > 15 * 1024 * 1024) return toast('PDF je větší než 15 MB.', true);
    if (!v.number && !file) return toast('Zadej číslo faktury nebo přilož PDF.', true);
    try {
      let path = null;
      if (file) { path = `${id}/${crypto.randomUUID()}.pdf`; const up = await sb.storage.from('ct-invoices').upload(path, file, { contentType: 'application/pdf' }); if (up.error) throw up.error; }
      const row = { container_id: id, number: v.number, supplier: v.supplier, amount: v.amount === '' ? null : toNum(v.amount), currency: v.currency, issued_at: v.issued_at || null, note: v.note, file_path: path, file_name: file ? file.name : null, file_size: file ? file.size : null, created_by: S.me.id };
      let ins; try { ins = check(await sb.from('ct_invoices').insert(row).select().single()); } catch (e) { if (path) await sb.storage.from('ct-invoices').remove([path]); throw e; }
      CT.inv.push(ins); draw(); toast('Faktura přidána');
    } catch (e) { toast(e.message, true); }
  }
  // naskladnění vybraných řádků: kontrola (nic se nezapisuje) → schválení opsáním čísla kontejneru
  async function ctStockFlow(btn) {
    const stc = cfg(); const stockId = Number(stc.shoptetStockId) || 1; const stockName = stc.shoptetStockName || 'sklad ' + stockId;
    const c = cur();
    if (!c.number) return toast('Kontejner nemá číslo — doplň ho v úpravách.', true);
    const chosen = itemsOf().filter(i => sel.has(i.id) && !lockedItem(i) && !i.custom);
    if (!chosen.length) return toast('Nejdřív zaškrtni řádky, které chceš naskladnit.', true);
    const unchecked = chosen.filter(i => !i.recv_state);
    if (unchecked.length) return toast('U ' + unchecked.map(i => i.code).join(', ') + ' nejdřív vyber stav příjmu (co dorazilo).', true);
    const bad = chosen.filter(i => !(amt(i) > 0));
    if (bad.length) return toast('U ' + bad.map(i => i.code).join(', ') + ' je nulové množství.', true);
    if (c.status !== 'delivered') {
      if (!(await confirmBox('Označit kontejner jako doručený?', 'Naskladnit jde jen doručený kontejner. Stav se změní na „Doručeno“.', { ok: 'Označit a pokračovat' }))) return;
      try { await patch({ status: 'delivered', ...(c.delivered_at ? {} : { delivered_at: ymd(new Date()) }) }); } catch (e) { return toast(e.message, true); }
    }
    const itemIds = chosen.map(i => i.id);
    btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = '<span class="spin"></span> Kontroluji…';
    let r;
    try { r = await ctCall({ action: 'ct_check', containerId: id, stockId, itemIds }); } catch (e) { toast(e.message, true); btn.disabled = false; btn.innerHTML = old; return; }
    btn.disabled = false; btn.innerHTML = old;
    const ordered = x => CT.items.find(i => i.id === x.id);
    const rows = r.lines.map(x => { const o = ordered(x); const diff = o && toNum(o.qty) !== x.amount; const pr = r.problems.find(p => p.id === x.id);
      return `<div ${pr ? 'class="err"' : ''}><code>${esc(x.code)}</code><span>${esc(x.shop || x.name)}${pr ? `<br><b class="warn-t">⚠ ${esc(pr.message)}</b>` : ''}${diff ? `<br><span class="warn-t small">objednáno ${fmtQ(o.qty)}, naskladňuje se ${fmtQ(x.amount)}</span>` : ''}${o && o.recv_note ? `<br><span class="small muted">↳ ${esc(o.recv_note)}</span>` : ''}</span><b>+${fmtQ(x.amount)} ${esc(x.unit)}</b></div>`; }).join('');
    const odd = r.lines.filter(x => !['ks', 'm²'].includes(x.unit));
    const rest = itemsOf().filter(i => !lockedItem(i) && !i.custom && !itemIds.includes(i.id)).length;
    const go = await modal({ title: r.ok ? 'Krok 3/4 · Kontrola před naskladněním' : 'Kontrola našla problémy',
      body: `<p>Kontejner <b>${esc(r.number)}</b> → sklad <b>${esc(r.stock.title || stockName)}</b>. Přičte se:</p><div class="push-list">${rows}</div>
        ${r.ok ? `${odd.length ? `<p class="warn-t">⚠ U ${odd.map(l => esc(l.code)).join(', ')} je jiná jednotka než ks / m². Ve Shoptetu se sklad počítá ve své jednotce — ověř množství.</p>` : ''}${rest ? `<p class="muted small">Zbývá ${rest} ${rest === 1 ? 'řádek' : rest < 5 ? 'řádky' : 'řádků'}, které se nenaskladní teď — půjdou později.</p>` : ''}<p class="muted small">Zatím se nic nezapsalo.</p>` : '<p class="muted small">Oprav to a spusť kontrolu znovu. Nic se nezapsalo.</p>'}`,
      actions: r.ok ? [{ label: 'Zrušit', value: false }, { label: 'Pokračovat ke schválení →', cls: 'primary', value: true }] : [{ label: 'Zavřít', value: false, cls: 'primary' }] });
    if (!go || !r.ok) return;
    const typed = await modal({ title: 'Krok 4/4 · Schválení', focus: '[data-cf]',
      body: `<p>Do Shoptetu se <b>přičte ${r.lines.length} ${r.lines.length === 1 ? 'položka' : r.lines.length < 5 ? 'položky' : 'položek'}</b>. Zápis už nejde vzít zpět (jen ručně ve Shoptetu).</p><p>Pro potvrzení opiš číslo kontejneru: <b>${esc(r.number)}</b></p><input data-cf autocomplete="off" placeholder="${esc(r.number)}" style="text-transform:uppercase">`,
      actions: [{ label: 'Zrušit', value: null }, { label: 'Naskladnit do Shoptetu', cls: 'primary', value: bd => $('[data-cf]', bd).value.trim() }] });
    if (typed == null) return;
    if (normCt(typed) !== normCt(r.number)) return toast('Číslo nesedí — nic se nenaskladnilo.', true);
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Posílám do Shoptetu…';
    try {
      const out = await ctCall({ action: 'ct_stock_in', containerId: id, stockId, sig: r.sig, confirm: typed, itemIds });
      await loadCt(); sel.clear(); draw();
      const good = out.results.filter(x => x.status === 'ok').length; const badr = out.results.filter(x => x.status === 'error' || x.status === 'duplicate');
      if (!badr.length) toast(`Naskladněno do Shoptetu: ${good} řádků ✓`);
      else await modal({ title: good ? `Naskladněno ${good}, ale ${badr.length} se nepovedlo` : 'Naskladnění se nepovedlo', body: `<div class="push-list err">${badr.map(x => `<div><code>${esc(x.code)}</code><span>${esc(x.message || x.status)}</span></div>`).join('')}</div><p class="muted small">Co se povedlo, je označené. Ostatní můžeš po opravě poslat znovu.</p>`, actions: [{ label: 'Rozumím', value: null, cls: 'primary' }] });
    } catch (e) { toast(e.message, true); btn.disabled = false; btn.innerHTML = old; }
  }
  draw();
}

// =====================================================================
// NÁVŠTĚVNOST PRODEJNY — rychlý zápis návštěv + přehled (konverze, koňáci)
// =====================================================================
const VISIT_COLS = 'id,visit_date,visit_time,persons,purpose,interest,result,doc_ref,order_value,note,staff,imported,created_by,last_edit_by,created_at,updated_at';
const BOUGHT = 'Objednávka na místě';
const VS = { list: [], period: ls.get('vh_vs_period') || 'month', from: '', to: '', q: '' };
const visitCfg = () => {
  const d = cfg();
  return {
    purposes: d.visitPurposes || ['Konzultace / výběr', 'Kalkulace', 'Platba objednávky', 'Pouze prohlídka', 'Jiné'],
    interests: d.visitInterests || ['WPC terasy', 'Vinylové podlahy', 'Obklady a dlažby', 'Příslušenství', 'Žula', 'Plotovky', 'Jiné', 'Nezjištěno'],
    results: d.visitResults || ['Bez dalšího kontaktu', 'Vizitka', 'Vzorek', 'Kontakt předán', 'Nabídka', BOUGHT, 'Objednávka později', 'Opakovaná návštěva', 'Jiné'],
    staff: d.visitStaff || ['Olča', 'Pavlík', 'Týna', 'Markéta'],
  };
};
const RESULT_TONE = { [BOUGHT]: 'ok', 'Nabídka': 'blue', 'Objednávka později': 'blue', 'Opakovaná návštěva': 'blue', 'Vzorek': 'neutral', 'Vizitka': 'neutral', 'Kontakt předán': 'neutral', 'Bez dalšího kontaktu': 'muted', 'Jiné': 'muted' };
const MONTHS = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'];
async function loadVisits() {
  const rows = await fetchAll(() => sb.from('store_visits').select(VISIT_COLS).eq('deleted', false).order('visit_date', { ascending: false }).order('created_at', { ascending: false }));
  VS.list = rows.map(r => ({ ...r, order_value: r.order_value == null ? null : Number(r.order_value), staff: r.staff || [] }));
}
function periodRange() {
  const t = new Date(); const y = t.getFullYear(), m = t.getMonth();
  switch (VS.period) {
    case 'month': return [ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))];
    case 'prev': return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))];
    case '30': return [ymd(new Date(Date.now() - 29 * 864e5)), ymd(t)];
    case 'year': return [`${y}-01-01`, `${y}-12-31`];
    case 'custom': return [VS.from || '0000-01-01', VS.to || '9999-12-31'];
    default: return ['0000-01-01', '9999-12-31'];
  }
}
function visitStats(list) {
  const persons = list.reduce((a, v) => a + v.persons, 0);
  const boughtRows = list.filter(v => v.result === BOUGHT);
  const bought = boughtRows.reduce((a, v) => a + v.persons, 0);
  const value = boughtRows.reduce((a, v) => a + (v.order_value || 0), 0);
  const count = (key, vals) => vals.map(k => ({ k, n: list.filter(v => v[key] === k).length }));
  const staff = {};
  for (const v of list) for (const s of v.staff) staff[s] = (staff[s] || 0) + 1;
  return { visits: list.length, persons, bought, conv: persons ? bought / persons : null, orders: boughtRows.length, value, avg: boughtRows.length ? value / boughtRows.length : null, count, staff };
}

async function renderVisits() {
  shell('visits', `<div class="topbar"><h1>Návštěvnost</h1></div><div class="panel panel-b"><div class="sk" style="height:260px"></div></div>`);
  try { await Promise.all([loadVisits(), loadSettings()]); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  if (!S.offers.length) refreshOffers(true).catch(() => {});
  const main = $('#main');
  main.innerHTML = `
  ${pgHead('visits', 'Návštěvnost', 'Počítání návštěv a nákupů v prodejně.')}
  <div class="topbar">
    <div class="chips" id="vsPeriod">
      ${[['month', 'Tento měsíc'], ['prev', 'Minulý měsíc'], ['30', '30 dní'], ['year', 'Letos'], ['all', 'Vše'], ['custom', 'Vlastní…']].map(([k, l]) => `<button class="chip ${VS.period === k ? 'on' : ''}" data-p="${k}">${l}</button>`).join('')}
    </div>
    <div class="row" id="vsCustom" ${VS.period === 'custom' ? '' : 'hidden'}><input type="date" id="vsFrom" value="${esc(VS.from)}" style="width:auto"> – <input type="date" id="vsTo" value="${esc(VS.to)}" style="width:auto"></div>
  </div>
  <section class="panel vs-form-panel" id="vsNew"></section>
  <div id="vsDash"></div>
  <section class="panel" style="margin-top:18px">
    <div class="panel-h">Zapsané návštěvy <span class="sub" id="vsCount"></span><span class="grow"></span>
      <div class="search" style="width:280px;max-width:100%"><span class="ic">⌕</span><input id="vsQ" placeholder="Hledat poznámku, číslo dokladu…" value="${esc(VS.q)}"></div></div>
    <div id="vsList" style="overflow-x:auto"></div>
  </section>`;
  main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
  $$('#vsPeriod .chip').forEach(c => c.onclick = () => {
    VS.period = c.dataset.p; ls.set('vh_vs_period', VS.period);
    $$('#vsPeriod .chip').forEach(x => x.classList.toggle('on', x === c));
    $('#vsCustom').hidden = VS.period !== 'custom';
    drawVisitDash(); drawVisitList();
  });
  const onCustom = () => { VS.from = $('#vsFrom').value; VS.to = $('#vsTo').value; drawVisitDash(); drawVisitList(); };
  $('#vsFrom').onchange = onCustom; $('#vsTo').onchange = onCustom;
  $('#vsQ').oninput = e => { VS.q = e.target.value; drawVisitList(); };
  visitForm($('#vsNew'), null, async row => {
    const r = check(await sb.from('store_visits').insert({ ...row, created_by: S.me.id, last_edit_by: S.me.id }).select(VISIT_COLS).single());
    VS.list.unshift({ ...r, order_value: r.order_value == null ? null : Number(r.order_value) });
    drawVisitDash(); drawVisitList(r.id);
    toast(`Návštěva zapsána · ${r.persons} ${r.persons === 1 ? 'osoba' : r.persons < 5 ? 'osoby' : 'osob'}`, { action: { label: 'Vrátit', fn: async () => {
      try { check(await sb.from('store_visits').update({ deleted: true }).eq('id', r.id)); VS.list = VS.list.filter(x => x.id !== r.id); drawVisitDash(); drawVisitList(); toast('Zápis zrušen'); } catch (err) { toast(err.message, true); }
    } } });
  });
  drawVisitDash(); drawVisitList();
}

// formulář návštěvy (nový zápis i úprava) — vše na ťuknutí
function visitForm(el, v, onSave, { compact = false, keepDate = '' } = {}) {
  const C = visitCfg();
  const lastStaff = (() => { try { return JSON.parse(ls.get('vh_vs_staff') || '[]'); } catch { return []; } })();
  const f = v ? { ...v, staff: [...v.staff] } : { visit_date: keepDate || ymd(new Date()), persons: 1, purpose: '', interest: '', result: '', doc_ref: '', order_value: null, note: '', staff: lastStaff.filter(s => C.staff.includes(s)) };
  const chips = (key, list, multi) => `<div class="chipset" data-key="${key}" ${multi ? 'data-multi="1"' : ''}>${list.map(x => {
    const on = multi ? f[key].includes(x) : f[key] === x;
    return `<button type="button" class="pick ${on ? 'on' : ''}" data-v="${esc(x)}" ${key === 'result' ? `data-tone="${RESULT_TONE[x] || 'neutral'}"` : ''}>${esc(x)}</button>`;
  }).join('')}</div>`;
  el.innerHTML = `
    ${compact ? '' : `<div class="panel-h"><span class="vs-ico">🚪</span>Zapsat návštěvu <span class="sub">— jedna návštěva nebo skupina = jeden zápis</span></div>`}
    <form class="vs-form ${compact ? '' : 'panel-b'}" autocomplete="off">
      <div class="vs-row vs-top">
        <div><label>Datum</label><input type="date" name="visit_date" value="${esc(f.visit_date)}" required></div>
        <div><label>Počet osob</label><div class="stepper vs-persons"><button type="button" data-a="minus" aria-label="Méně">−</button><input name="persons" inputmode="numeric" value="${f.persons}"><button type="button" data-a="plus" aria-label="Více">+</button></div></div>
        <div class="vs-staff"><label>Obsluhoval(a) <span class="muted">— koňák, lze víc</span></label>${chips('staff', C.staff, true)}</div>
      </div>
      <div class="vs-row"><label>Účel návštěvy</label>${chips('purpose', C.purposes)}</div>
      <div class="vs-row"><label>Sortiment / zájem</label>${chips('interest', C.interests)}</div>
      <div class="vs-row"><label>Výsledek</label>${chips('result', C.results)}</div>
      <div class="vs-row vs-bottom">
        <div><label>Č. nabídky / objednávky</label><input name="doc_ref" value="${esc(f.doc_ref)}" placeholder="např. 2026002692 nebo 26900003"><small class="muted" id="docHint"></small></div>
        <div><label>Hodnota objednávky</label><div class="fld"><input name="order_value" inputmode="decimal" value="${f.order_value == null ? '' : esc(numStr(f.order_value))}" placeholder="—"><span class="suf">Kč</span></div></div>
        <div class="vs-note"><label>Poznámka</label><input name="note" value="${esc(f.note)}" placeholder="co řešili, co si odnesli…"></div>
        <div class="vs-save"><button class="btn primary lg" type="submit">${v ? 'Uložit změny' : '＋ Zapsat návštěvu'}</button></div>
      </div>
    </form>`;
  const form = $('form', el);
  const highlightValue = () => { const want = f.result === BOUGHT || f.purpose === 'Platba objednávky'; $('[name="order_value"]', form).closest('div').classList.toggle('want', want && !toNum($('[name="order_value"]', form).value)); };
  form.addEventListener('click', e => {
    const b = e.target.closest('.pick');
    if (b) {
      const set = b.closest('.chipset'); const key = set.dataset.key; const val = b.dataset.v;
      if (set.dataset.multi) { f[key] = f[key].includes(val) ? f[key].filter(x => x !== val) : [...f[key], val]; b.classList.toggle('on'); }
      else { f[key] = f[key] === val ? '' : val; $$('.pick', set).forEach(x => x.classList.toggle('on', x.dataset.v === f[key])); }
      b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      highlightValue(); return;
    }
    const s = e.target.closest('[data-a]');
    if (s) { const i = $('[name="persons"]', form); i.value = Math.max(1, (parseInt(i.value, 10) || 1) + (s.dataset.a === 'plus' ? 1 : -1)); }
  });
  // číslo nabídky z Vinylor Hubu → doplní hodnotu
  $('[name="doc_ref"]', form).addEventListener('input', e => {
    const t = e.target.value.trim(); const o = t && S.offers.find(x => x.number === t);
    $('#docHint', form).textContent = o ? `nabídka ${o.number}: ${custLabel(o.customer)} · ${offMoney(o.total, o)}` : '';
    if (o && o.currency !== 'EUR' && !toNum($('[name="order_value"]', form).value)) { const i = $('[name="order_value"]', form); i.value = numStr(o.total); i.classList.remove('filled'); void i.offsetWidth; i.classList.add('filled'); }
    highlightValue();
  });
  $('[name="order_value"]', form).addEventListener('input', highlightValue);
  form.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const row = {
      visit_date: fd.get('visit_date'), persons: Math.max(1, parseInt(fd.get('persons'), 10) || 1),
      purpose: f.purpose, interest: f.interest, result: f.result, staff: f.staff,
      doc_ref: String(fd.get('doc_ref') || '').trim(), order_value: String(fd.get('order_value') || '').trim() === '' ? null : toNum(fd.get('order_value')),
      note: String(fd.get('note') || '').trim(),
    };
    if (!v) row.visit_time = new Date().toTimeString().slice(0, 8);
    if (!row.staff.length && !(await confirmBox('Kdo obsluhoval?', 'Není vybraný žádný koňák — návštěva se nikomu nezapočítá. Uložit i tak?', { ok: 'Uložit bez jména' }))) return;
    const btn = $('button[type="submit"]', form); btn.disabled = true; const label = btn.textContent; btn.innerHTML = '<span class="spin"></span> Ukládám…';
    try {
      await onSave(row);
      ls.set('vh_vs_staff', JSON.stringify(row.staff));
      if (!v) { // připravit další zápis: datum a obsluha zůstanou
        visitForm(el, null, onSave, { compact, keepDate: row.visit_date !== ymd(new Date()) ? row.visit_date : '' });
        el.classList.remove('saved'); void el.offsetWidth; el.classList.add('saved');
      }
    } catch (err) { toast(err.message, true); }
    btn.disabled = false; btn.textContent = label;
  });
  highlightValue();
}

function drawVisitDash() {
  const [from, to] = periodRange();
  const list = VS.list.filter(v => v.visit_date >= from && v.visit_date <= to);
  const st = visitStats(list);
  const C = visitCfg();
  const staffRank = Object.entries(st.staff).sort((a, b) => b[1] - a[1]);
  const maxStaff = staffRank[0]?.[1] || 1;
  const bars = (rows, total) => { const max = Math.max(1, ...rows.map(r => r.n)); return rows.filter(r => r.n).sort((a, b) => b.n - a.n).map(r => `
    <div class="hb"><span class="hb-l">${esc(r.k)}</span><span class="hb-t"><i style="width:${(r.n / max) * 100}%" ${r.tone ? `data-tone="${r.tone}"` : ''}></i></span><b>${r.n}</b><span class="hb-p">${total ? Math.round((r.n / total) * 100) : 0} %</span></div>`).join('') || '<div class="empty">Žádné návštěvy v období</div>'; };
  // měsíční konverze (všechny měsíce v období, kde něco je)
  const months = {};
  for (const v of list) { const k = v.visit_date.slice(0, 7); (months[k] = months[k] || { persons: 0, bought: 0 }); months[k].persons += v.persons; if (v.result === BOUGHT) months[k].bought += v.persons; }
  const mk = Object.keys(months).sort();
  const maxM = Math.max(1, ...mk.map(k => months[k].persons));
  $('#vsDash').innerHTML = `
  <div class="stats" style="margin-top:18px">
    <div class="panel stat" style="--c:var(--s-sent)"><div class="k">Návštěvníků</div><div class="v" data-n="${st.persons}">0</div><div class="s">${st.visits} zápisů v období</div></div>
    <div class="panel stat" style="--c:var(--brand)"><div class="k">Nakoupilo · konverze</div><div class="v">${st.bought} <span class="v-sub">${st.conv == null ? '—' : pct(st.conv * 100)}</span></div><div class="s">osob s objednávkou na místě</div></div>
    <div class="panel stat" style="--c:var(--s-confirmed)"><div class="k">Objednávky na místě</div><div class="v" data-n="${st.value}" data-k="kc">0 Kč</div><div class="s">${st.orders} objednávek</div></div>
    <div class="panel stat" style="--c:var(--s-postponed)"><div class="k">Průměrná objednávka</div><div class="v">${st.avg == null ? '—' : M(st.avg).replace(/,\d\d$/, '') + ' Kč'}</div><div class="s">hodnota / počet objednávek</div></div>
  </div>
  <div class="vs-grid">
    <section class="panel"><div class="panel-h">🏆 Nejlepší koňák <span class="sub">počet obsloužených návštěv</span></div><div class="panel-b">
      ${staffRank.length ? staffRank.map(([n, c], i) => `<div class="rank${i === 0 ? ' first' : ''}"><span class="rk">${i === 0 ? '🐎' : i + 1}</span><span class="rn">${esc(n)}</span><span class="hb-t"><i style="width:${(c / maxStaff) * 100}%"></i></span><b>${c}</b></div>`).join('') : '<div class="empty">Žádné návštěvy v období</div>'}
      <div class="hint">Společná obsluha se započítá každému uvedenému.</div>
    </div></section>
    <section class="panel"><div class="panel-h">📈 Měsíční konverze</div><div class="panel-b">
      ${mk.length ? `<div class="mchart">${mk.map(k => { const m = months[k]; const c = m.persons ? m.bought / m.persons : 0; return `
        <div class="mcol" title="${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}: ${m.persons} osob, nakoupilo ${m.bought}">
          <span class="mc-p">${Math.round(c * 100)} %</span>
          <div class="mc-bar" style="height:${(m.persons / maxM) * 100}%"><i style="height:${m.persons ? (m.bought / m.persons) * 100 : 0}%"></i></div>
          <span class="mc-n">${m.persons}</span><span class="mc-l">${MONTHS[Number(k.slice(5)) - 1].slice(0, 3)}</span>
        </div>`; }).join('')}</div>
        <div class="legend"><span><i class="lg-a"></i>návštěvníci</span><span><i class="lg-b"></i>nakoupilo na místě</span></div>` : '<div class="empty">Žádné návštěvy v období</div>'}
    </div></section>
  </div>
  <div class="vs-grid vs-grid3">
    <section class="panel"><div class="panel-h">Podle výsledku</div><div class="panel-b">${bars(C.results.map(k => ({ k, n: list.filter(v => v.result === k).length, tone: RESULT_TONE[k] })), st.visits)}</div></section>
    <section class="panel"><div class="panel-h">Podle účelu</div><div class="panel-b">${bars(C.purposes.map(k => ({ k, n: list.filter(v => v.purpose === k).length })), st.visits)}</div></section>
    <section class="panel"><div class="panel-h">Podle sortimentu</div><div class="panel-b">${bars(C.interests.map(k => ({ k, n: list.filter(v => v.interest === k).length })), st.visits)}</div></section>
  </div>`;
  $$('#vsDash [data-n]').forEach(v => tween(v, Number(v.dataset.n), v.dataset.k ? n => M(n).replace(/,\d\d$/, '') + ' Kč' : n => String(Math.round(n))));
}

function drawVisitList(newId) {
  const [from, to] = periodRange();
  const q = fold(VS.q).trim();
  const list = VS.list.filter(v => v.visit_date >= from && v.visit_date <= to && (!q || fold([v.note, v.doc_ref, v.purpose, v.interest, v.result, v.staff.join(' ')].join(' ')).includes(q)));
  $('#vsCount').textContent = `— ${list.length} v období`;
  const shown = list.slice(0, 300);
  $('#vsList').innerHTML = list.length ? `<table class="list vs-list"><thead><tr><th>Datum</th><th class="r">Osob</th><th>Účel</th><th>Sortiment</th><th>Výsledek</th><th class="r">Hodnota</th><th>Obsluha</th><th>Poznámka</th></tr></thead><tbody>
    ${shown.map(v => `<tr class="click${v.id === newId ? ' fresh' : ''}" data-id="${v.id}">
      <td class="nowrap">${czDate(v.visit_date)}${v.visit_time ? `<div class="muted small">${v.visit_time.slice(0, 5)}</div>` : ''}</td>
      <td class="r num-t"><b>${v.persons}</b></td>
      <td>${esc(v.purpose) || '<span class="muted">—</span>'}</td>
      <td>${esc(v.interest) || '<span class="muted">—</span>'}</td>
      <td>${v.result ? `<span class="res-tag" data-tone="${RESULT_TONE[v.result] || 'neutral'}">${esc(v.result)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="r nowrap num-t">${v.order_value ? M(v.order_value).replace(/,00$/, '') + ' Kč' : ''}${v.doc_ref ? `<div class="muted small">${highlight(v.doc_ref, VS.q)}</div>` : ''}</td>
      <td class="nowrap">${v.staff.map(s => `<span class="av" title="${esc(s)}">${esc(s.slice(0, 2))}</span>`).join(' ')}</td>
      <td class="vs-note-c">${highlight(v.note, VS.q)}</td>
    </tr>`).join('')}</tbody></table>${list.length > shown.length ? `<div class="empty">Zobrazeno prvních ${shown.length} z ${list.length} — zúžení období nebo hledání ukáže zbytek.</div>` : ''}`
    : '<div class="empty" style="padding:28px">V tomto období zatím žádné návštěvy.</div>';
  $$('#vsList tr.click').forEach(r => r.onclick = () => editVisit(r.dataset.id));
}

async function editVisit(id) {
  const v = VS.list.find(x => x.id === id); if (!v) return;
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = `<div class="modal vs-modal" role="dialog" aria-modal="true"><div class="row" style="justify-content:space-between"><h3>Návštěva ${czDate(v.visit_date)}</h3><div class="row"><button class="btn ghost danger" data-del>🗑 Smazat</button><button class="btn ghost" data-close>✕</button></div></div><div class="vs-edit"></div>
    <div class="muted small" style="margin-top:8px">Zapsal(a) ${esc(userName(v.created_by) || '—')} · ${czDateTime(v.created_at)}${v.imported ? ' · importováno z Excelu' : ''}</div></div>`;
  document.body.appendChild(bd);
  const close = () => { bd.classList.add('out'); document.removeEventListener('keydown', key); setTimeout(() => bd.remove(), 150); };
  const key = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  bd.addEventListener('mousedown', e => { if (e.target === bd) close(); });
  $('[data-close]', bd).onclick = close;
  $('[data-del]', bd).onclick = async () => {
    if (!(await confirmBox('Smazat návštěvu?', 'Zápis zmizí z přehledu i ze statistik.', { ok: 'Smazat', danger: true }))) return;
    try { check(await sb.from('store_visits').update({ deleted: true }).eq('id', id)); VS.list = VS.list.filter(x => x.id !== id); close(); drawVisitDash(); drawVisitList(); toast('Návštěva smazána'); }
    catch (err) { toast(err.message, true); }
  };
  visitForm($('.vs-edit', bd), v, async row => {
    const r = check(await sb.from('store_visits').update(row).eq('id', id).select(VISIT_COLS).single());
    Object.assign(v, r, { order_value: r.order_value == null ? null : Number(r.order_value) });
    close(); drawVisitDash(); drawVisitList(id); toast('Uloženo ✓');
  }, { compact: true });
}

// =====================================================================
// NÁSTĚNKA — nástěnky → sloupce → karty (jako Trello), živě pro celý tým
// =====================================================================
const LABEL_COLORS = { green: '#4bab5e', yellow: '#e2b203', orange: '#f5872f', red: '#e2483d', purple: '#9f6fdb', blue: '#2f7dd8', sky: '#36a4c7', pink: '#e06aa8', gray: '#8a948d' };
const BOARD_COLORS = ['#1a7f45', '#0f5c3a', '#2f6fbf', '#6b4fbb', '#b4572e', '#a3324a', '#3f6e6e', '#5a5f5c'];
const COVERS = ['', 'green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'pink'];
const BD = { boards: [], board: null, lists: [], cards: [], comments: {}, q: '', mine: false, drag: null, busy: 0, pending: false };
const between = (a, b) => (a == null ? (b == null ? 1000 : b - 1000) : b == null ? a + 1000 : (a + b) / 2);
const dueInfo = c => {
  if (!c.due_date) return null;
  const today = ymd(new Date());
  const d = new Date(c.due_date + 'T00:00');
  const label = d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
  if (c.done) return { cls: 'done', label, title: 'Hotovo' };
  if (c.due_date < today) return { cls: 'over', label, title: 'Po termínu' };
  if (c.due_date === today) return { cls: 'today', label: 'dnes', title: 'Termín je dnes' };
  return { cls: '', label, title: 'Termín' };
};
const labelOf = id => (BD.board?.labels || []).find(l => l.id === id);

// ---------- přehled nástěnek ----------
async function renderBoards() {
  shell('boards', `<div class="topbar"><h1>Nástěnka</h1></div><div class="board-tiles">${'<div class="sk" style="height:110px"></div>'.repeat(3)}</div>`);
  let boards, mine;
  try {
    [boards, mine] = await Promise.all([
      sb.from('board_boards').select('*').eq('archived', false).order('position').order('created_at').then(check),
      sb.from('board_cards').select('id,title,board_id,list_id,due_date,done,labels,assignees').eq('archived', false).contains('assignees', [S.me.id]).then(check),
    ]);
  } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  BD.boards = boards;
  const lists = mine.length ? check(await sb.from('board_lists').select('id,name').in('id', [...new Set(mine.map(c => c.list_id))])) : [];
  const counts = boards.length ? check(await sb.from('board_cards').select('board_id').eq('archived', false).in('board_id', boards.map(b => b.id))) : [];
  const main = $('#main');
  main.innerHTML = `
  ${pgHead('boards', 'Nástěnka', 'Sdílené úkoly a projekty týmu.')}
  <div class="board-tiles">
    ${boards.map((b, i) => `<a class="btile" href="#/b/${b.id}" style="--bc:${esc(b.color)};--i:${i}"><b>${esc(b.name)}</b><span>${counts.filter(c => c.board_id === b.id).length} karet</span></a>`).join('')}
    <button class="btile new" id="newBoard"><b>＋ Nová nástěnka</b><span>např. Prodejna, Marketing, Sklad…</span></button>
  </div>
  <section class="panel" style="margin-top:22px">
    <div class="panel-h">📌 Moje karty <span class="sub">přiřazené tobě, napříč nástěnkami</span></div>
    <div class="panel-b">${mine.length ? `<div class="mycards">${mine.sort((a, b) => (a.done - b.done) || String(a.due_date || '9').localeCompare(String(b.due_date || '9'))).map(c => {
      const due = dueInfo(c); const b = boards.find(x => x.id === c.board_id); const l = lists.find(x => x.id === c.list_id);
      return `<a class="mycard" href="#/b/${c.board_id}?c=${c.id}" data-card="${c.id}" data-board="${c.board_id}"><span class="dot" style="background:${esc(b?.color || '#999')}"></span><span class="t">${esc(c.title)}</span><span class="muted small">${esc(b?.name || '')} · ${esc(l?.name || '')}</span>${due ? `<span class="due ${due.cls}">📅 ${esc(due.label)}</span>` : ''}</a>`;
    }).join('')}</div>` : '<div class="empty">Nemáš přiřazené žádné karty. V detailu karty se přiřadíš kliknutím na své jméno.</div>'}</div>
  </section>`;
  main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
  $$('.mycard', main).forEach(a => a.onclick = e => { e.preventDefault(); BD.openCard = a.dataset.card; location.hash = '#/b/' + a.dataset.board; });
  $('#newBoard').onclick = async () => {
    const name = await promptBox('Nová nástěnka', 'Název nástěnky', '', { placeholder: 'např. Marketing, Prodejna Dobříš…', ok: 'Vytvořit' });
    if (!name || !name.trim()) return;
    try {
      const b = check(await sb.from('board_boards').insert({ name: name.trim(), color: BOARD_COLORS[boards.length % BOARD_COLORS.length], created_by: S.me.id, position: (boards.at(-1)?.position || 0) + 1000 }).select().single());
      check(await sb.from('board_lists').insert(['K řešení', 'Rozpracováno', 'Hotovo'].map((n, i) => ({ board_id: b.id, name: n, position: (i + 1) * 1000 }))));
      location.hash = '#/b/' + b.id;
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- jedna nástěnka ----------
async function loadBoard(id) {
  const [board, lists, cards, comments] = await Promise.all([
    sb.from('board_boards').select('*').eq('id', id).single().then(check),
    sb.from('board_lists').select('*').eq('board_id', id).eq('archived', false).order('position').then(check),
    fetchAll(() => sb.from('board_cards').select('*').eq('board_id', id).order('position')),
    fetchAll(() => sb.from('board_comments').select('id,card_id').eq('board_id', id)),
  ]);
  BD.board = board; BD.lists = lists; BD.cards = cards;
  BD.comments = {}; for (const c of comments) BD.comments[c.card_id] = (BD.comments[c.card_id] || 0) + 1;
}
async function renderBoard(id) {
  shell('boards', `<div class="topbar"><div class="sk" style="height:30px;width:260px"></div></div><div class="bcanvas">${'<div class="sk" style="width:280px;height:320px;flex:none"></div>'.repeat(4)}</div>`);
  try { await loadBoard(id); } catch (e) { $('#main').innerHTML = `<div class="panel empty-big"><div class="ill">🗂️</div><h3>Nástěnku se nepodařilo otevřít</h3><p>${esc(e.message)}</p><a class="btn" href="#/nastenka">← Zpět</a></div>`; return; }
  const main = $('#main');
  main.classList.add('main-board');
  main.innerHTML = `
  <div class="bhead" style="--bc:${esc(BD.board.color)}">
    <a class="btn ghost" href="#/nastenka" title="Všechny nástěnky">←</a>
    <h1 class="bname" id="bName" title="Klikni pro přejmenování">${esc(BD.board.name)}</h1>
    <span class="grow"></span>
    <div class="search" style="width:240px;max-width:100%"><span class="ic">⌕</span><input id="bQ" placeholder="Filtrovat karty…" value="${esc(BD.q)}"></div>
    <button class="chip ${BD.mine ? 'on' : ''}" id="bMine">Jen moje</button>
    <button class="btn" id="bMenu" title="Nastavení nástěnky">⋯</button>
  </div>
  <div class="bcanvas" id="bCanvas"></div>`;
  drawBoard();
  $('#bQ').oninput = e => { BD.q = e.target.value; drawBoard(); };
  $('#bMine').onclick = e => { BD.mine = !BD.mine; e.currentTarget.classList.toggle('on', BD.mine); drawBoard(); };
  $('#bName').onclick = () => renameBoard();
  $('#bMenu').onclick = async e => {
    const a = await popMenu(e.currentTarget, [
      { label: 'Přejmenovat nástěnku', value: 'rename' }, { label: 'Barva nástěnky', value: 'color' }, { label: 'Upravit názvy štítků', value: 'labels' },
      { label: 'Archivované karty', value: 'archive' }, { label: 'Archivovat nástěnku', value: 'del' },
    ]);
    if (a === 'rename') renameBoard();
    if (a === 'color') boardColor();
    if (a === 'labels') editLabels();
    if (a === 'archive') archivedCards();
    if (a === 'del' && await confirmBox('Archivovat nástěnku?', `Nástěnka „${BD.board.name}“ zmizí ze seznamu. Data zůstanou uložená.`, { ok: 'Archivovat', danger: true })) {
      check(await sb.from('board_boards').update({ archived: true }).eq('id', BD.board.id)); location.hash = '#/nastenka';
    }
  };
  // živé změny od ostatních
  let t = null;
  const refresh = () => { clearTimeout(t); t = setTimeout(async () => { if (BD.busy || BD.drag || $('.bl-composer textarea:focus, .bl-title-input')) { BD.pending = true; return; } try { await loadBoard(id); drawBoard(); refreshOpenCard(); } catch {} }, 450); };
  const ch = sb.channel('board-' + id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board_cards', filter: `board_id=eq.${id}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board_lists', filter: `board_id=eq.${id}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board_comments', filter: `board_id=eq.${id}` }, refresh)
    .subscribe();
  BD.flushPending = () => { if (BD.pending) { BD.pending = false; refresh(); } };
  routeCleanup = () => { try { sb.removeChannel(ch); } catch {} clearTimeout(t); $('#main')?.classList.remove('main-board'); };
  const want = BD.openCard || new URLSearchParams(location.hash.split('?')[1] || '').get('c');
  BD.openCard = null;
  if (want && BD.cards.some(c => c.id === want)) openCard(want);
}
async function renameBoard() {
  const n = await promptBox('Přejmenovat nástěnku', 'Název', BD.board.name, { ok: 'Uložit' });
  if (!n || !n.trim()) return;
  BD.board.name = n.trim(); $('#bName').textContent = BD.board.name;
  try { check(await sb.from('board_boards').update({ name: BD.board.name }).eq('id', BD.board.id)); } catch (err) { toast(err.message, true); }
}
async function boardColor() {
  const c = await modal({ title: 'Barva nástěnky', body: `<div class="swatches">${BOARD_COLORS.map(x => `<button class="sw ${x === BD.board.color ? 'on' : ''}" data-c="${x}" style="background:${x}"></button>`).join('')}</div>`,
    actions: [{ label: 'Zavřít', value: null }] , focus: '.sw.on' });
  void c;
}
document.addEventListener('click', async e => {
  const sw = e.target.closest('.swatches .sw'); if (!sw || !BD.board) return;
  BD.board.color = sw.dataset.c; $$('.swatches .sw').forEach(x => x.classList.toggle('on', x === sw));
  $('.bhead')?.style.setProperty('--bc', BD.board.color);
  try { check(await sb.from('board_boards').update({ color: BD.board.color }).eq('id', BD.board.id)); } catch (err) { toast(err.message, true); }
});
async function editLabels() {
  const res = await modal({
    title: 'Štítky nástěnky',
    body: `<p>Pojmenuj barevné štítky, ať všichni vědí, co znamenají.</p><div class="lbl-edit">${BD.board.labels.map(l => `<div class="row"><span class="lbl" style="background:${LABEL_COLORS[l.color]}">&nbsp;</span><input data-l="${l.id}" value="${esc(l.name)}" placeholder="bez názvu"></div>`).join('')}</div>`,
    actions: [{ label: 'Zrušit', value: null }, { label: 'Uložit', value: bd => $$('[data-l]', bd).map(i => ({ id: i.dataset.l, name: i.value.trim() })), cls: 'primary' }],
  });
  if (!res) return;
  BD.board.labels = BD.board.labels.map(l => ({ ...l, name: (res.find(r => r.id === l.id) || {}).name ?? l.name }));
  try { check(await sb.from('board_boards').update({ labels: BD.board.labels }).eq('id', BD.board.id)); drawBoard(); toast('Štítky uloženy'); } catch (err) { toast(err.message, true); }
}
async function archivedCards() {
  const arch = BD.cards.filter(c => c.archived);
  const bdEl = document.createElement('div');
  const r = modal({ title: 'Archivované karty', body: arch.length ? `<div class="arch">${arch.map(c => `<div class="row"><span class="grow">${esc(c.title)}</span><button class="btn sm" data-restore="${c.id}">Obnovit</button></div>`).join('')}</div>` : '<p class="muted">Žádné archivované karty.</p>' });
  void bdEl;
  setTimeout(() => $$('[data-restore]').forEach(b => b.onclick = async () => { await patchCard(b.dataset.restore, { archived: false }); b.closest('.row').remove(); drawBoard(); toast('Karta obnovena'); }));
  await r;
}

function visibleCards(listId) {
  const q = fold(BD.q).trim();
  return BD.cards.filter(c => c.list_id === listId && !c.archived
    && (!BD.mine || c.assignees.includes(S.me.id))
    && (!q || fold([c.title, c.description, ...c.labels.map(id => labelOf(id)?.name || '')].join(' ')).includes(q)))
    .sort((a, b) => a.position - b.position);
}
function cardHtml(c) {
  const due = dueInfo(c);
  const cl = c.checklist || []; const clDone = cl.filter(x => x.done).length;
  const labels = c.labels.map(labelOf).filter(Boolean);
  return `<article class="bc${c.done ? ' is-done' : ''}" draggable="true" data-id="${c.id}">
    ${c.cover ? `<div class="bc-cover" style="background:${LABEL_COLORS[c.cover]}"></div>` : ''}
    ${labels.length ? `<div class="bc-labels">${labels.map(l => `<span class="lbl" style="background:${LABEL_COLORS[l.color]}" title="${esc(l.name)}">${esc(l.name)}</span>`).join('')}</div>` : ''}
    <div class="bc-title">${highlight(c.title, BD.q)}</div>
    ${due || cl.length || BD.comments[c.id] || c.description || c.assignees.length ? `<div class="bc-badges">
      ${due ? `<span class="due ${due.cls}" title="${esc(due.title)}">${c.done ? '✓' : '📅'} ${esc(due.label)}</span>` : ''}
      ${c.description ? '<span title="Má popis">≡</span>' : ''}
      ${BD.comments[c.id] ? `<span title="Komentáře">💬 ${BD.comments[c.id]}</span>` : ''}
      ${cl.length ? `<span class="${clDone === cl.length ? 'cl-done' : ''}" title="Checklist">☑ ${clDone}/${cl.length}</span>` : ''}
      <span class="grow"></span>
      ${c.assignees.map(u => `<span class="av" title="${esc(userName(u))}">${initials(u)}</span>`).join('')}
    </div>` : ''}
  </article>`;
}
function drawBoard() {
  const cv = $('#bCanvas'); if (!cv) return;
  const scroll = { x: cv.scrollLeft, lists: Object.fromEntries($$('.bl-cards', cv).map(x => [x.dataset.list, x.scrollTop])) };
  cv.innerHTML = BD.lists.map(l => {
    const cards = visibleCards(l.id);
    return `<section class="bl" data-list="${l.id}">
      <header class="bl-head" draggable="true"><h3 class="bl-title" data-list="${l.id}">${esc(l.name)}</h3><span class="bl-count">${cards.length}</span><button class="ib bl-menu" data-list="${l.id}" title="Možnosti sloupce">⋯</button></header>
      <div class="bl-cards" data-list="${l.id}">${cards.map(cardHtml).join('')}</div>
      <div class="bl-foot"><button class="bl-add" data-list="${l.id}">＋ Přidat kartu</button></div>
    </section>`;
  }).join('') + `<div class="bl bl-new"><button class="bl-add" id="addList">＋ Přidat sloupec</button></div>`;
  cv.scrollLeft = scroll.x;
  $$('.bl-cards', cv).forEach(x => { x.scrollTop = scroll.lists[x.dataset.list] || 0; });
  bindBoard(cv);
}
function bindBoard(cv) {
  // karty: otevření + přetahování
  $$('.bc', cv).forEach(el => {
    el.onclick = () => openCard(el.dataset.id);
    el.ondragstart = e => { BD.drag = { type: 'card', id: el.dataset.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', el.dataset.id); requestAnimationFrame(() => el.classList.add('dragging')); };
    el.ondragend = () => { el.classList.remove('dragging'); $$('.bc-ph').forEach(x => x.remove()); BD.drag = null; BD.flushPending?.(); };
  });
  const ph = document.createElement('div'); ph.className = 'bc-ph';
  $$('.bl-cards', cv).forEach(zone => {
    zone.ondragover = e => {
      if (BD.drag?.type !== 'card') return;
      e.preventDefault();
      const after = [...zone.querySelectorAll('.bc:not(.dragging)')].find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      const dragged = $(`.bc[data-id="${BD.drag.id}"]`); if (dragged) ph.style.height = dragged.offsetHeight + 'px';
      after ? zone.insertBefore(ph, after) : zone.appendChild(ph);
    };
    zone.ondrop = async e => {
      if (BD.drag?.type !== 'card') return;
      e.preventDefault();
      const ids = [...zone.children].filter(x => x.matches('.bc:not(.dragging), .bc-ph')).map(x => (x.classList.contains('bc-ph') ? '__ph' : x.dataset.id));
      const i = ids.indexOf('__ph');
      const pos = (id) => BD.cards.find(c => c.id === id)?.position;
      const prev = i > 0 ? pos(ids[i - 1]) : null, next = i < ids.length - 1 ? pos(ids[i + 1]) : null;
      ph.remove();
      await moveCard(BD.drag.id, zone.dataset.list, between(prev, next));
    };
  });
  // sloupce: přetahování za hlavičku
  $$('.bl-head', cv).forEach(h => {
    h.ondragstart = e => { if (e.target.closest('.bc')) return; BD.drag = { type: 'list', id: h.closest('.bl').dataset.list }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'list'); requestAnimationFrame(() => h.closest('.bl').classList.add('dragging')); };
    h.ondragend = () => { h.closest('.bl').classList.remove('dragging'); BD.drag = null; BD.flushPending?.(); };
  });
  cv.ondragover = e => {
    if (BD.drag?.type !== 'list') return;
    e.preventDefault();
    const dragged = $(`.bl[data-list="${BD.drag.id}"]`);
    const after = [...cv.querySelectorAll('.bl:not(.dragging):not(.bl-new)')].find(l => { const r = l.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
    cv.insertBefore(dragged, after || $('.bl-new', cv));
  };
  cv.ondrop = async e => {
    if (BD.drag?.type !== 'list') return;
    e.preventDefault();
    const order = $$('.bl:not(.bl-new)', cv).map(x => x.dataset.list);
    const i = order.indexOf(BD.drag.id);
    const pos = id => BD.lists.find(l => l.id === id)?.position;
    const p = between(i > 0 ? pos(order[i - 1]) : null, i < order.length - 1 ? pos(order[i + 1]) : null);
    const l = BD.lists.find(x => x.id === BD.drag.id); l.position = p; BD.lists.sort((a, b) => a.position - b.position);
    try { check(await sb.from('board_lists').update({ position: p }).eq('id', l.id)); } catch (err) { toast(err.message, true); }
  };
  // přejmenování sloupce
  $$('.bl-title', cv).forEach(t => t.onclick = () => {
    const l = BD.lists.find(x => x.id === t.dataset.list);
    const inp = document.createElement('input'); inp.className = 'bl-title-input'; inp.value = l.name;
    t.replaceWith(inp); inp.focus(); inp.select();
    const done = async ok => {
      const v = inp.value.trim();
      if (ok && v && v !== l.name) { l.name = v; try { check(await sb.from('board_lists').update({ name: v }).eq('id', l.id)); } catch (err) { toast(err.message, true); } }
      drawBoard(); BD.flushPending?.();
    };
    inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = l.name; inp.blur(); } };
    inp.onblur = () => done(true);
  });
  $$('.bl-menu', cv).forEach(b => b.onclick = async () => {
    const l = BD.lists.find(x => x.id === b.dataset.list);
    const a = await popMenu(b, [{ label: 'Přejmenovat', value: 'ren' }, { label: 'Přidat kartu', value: 'add' }, { label: 'Archivovat všechny karty ve sloupci', value: 'arch' }, { label: 'Smazat sloupec', value: 'del' }]);
    if (a === 'ren') $(`.bl-title[data-list="${l.id}"]`)?.click();
    if (a === 'add') $(`.bl-add[data-list="${l.id}"]`)?.click();
    if (a === 'arch') {
      const cs = BD.cards.filter(c => c.list_id === l.id && !c.archived);
      if (!cs.length || !(await confirmBox('Archivovat karty?', `${cs.length} karet ze sloupce „${l.name}“ se přesune do archivu.`, { ok: 'Archivovat' }))) return;
      cs.forEach(c => { c.archived = true; }); drawBoard();
      try { check(await sb.from('board_cards').update({ archived: true }).in('id', cs.map(c => c.id))); toast(`Archivováno ${cs.length} karet`); } catch (err) { toast(err.message, true); }
    }
    if (a === 'del') {
      const n = BD.cards.filter(c => c.list_id === l.id && !c.archived).length;
      if (!(await confirmBox('Smazat sloupec?', n ? `Sloupec „${l.name}“ obsahuje ${n} karet — smažou se také.` : `Smazat prázdný sloupec „${l.name}“?`, { ok: 'Smazat', danger: true }))) return;
      BD.lists = BD.lists.filter(x => x.id !== l.id); drawBoard();
      try { check(await sb.from('board_lists').delete().eq('id', l.id)); } catch (err) { toast(err.message, true); }
    }
  });
  // přidání karty (zůstane otevřené pro další)
  $$('.bl-add[data-list]', cv).forEach(b => b.onclick = () => openComposer(b.dataset.list));
  $('#addList').onclick = async () => {
    const name = await promptBox('Nový sloupec', 'Název sloupce', '', { placeholder: 'např. Čeká na dodavatele', ok: 'Přidat' });
    if (!name || !name.trim()) return;
    try {
      const l = check(await sb.from('board_lists').insert({ board_id: BD.board.id, name: name.trim(), position: between(BD.lists.at(-1)?.position ?? null, null) }).select().single());
      BD.lists.push(l); drawBoard(); $('#bCanvas').scrollLeft = 1e6;
    } catch (err) { toast(err.message, true); }
  };
}
function openComposer(listId) {
  const foot = $(`.bl-add[data-list="${listId}"]`)?.closest('.bl-foot'); if (!foot) return;
  foot.innerHTML = `<div class="bl-composer"><textarea rows="2" placeholder="Co je potřeba udělat? (Enter = přidat)"></textarea><div class="row"><button class="btn primary sm" data-go>Přidat kartu</button><button class="ib" data-x title="Zavřít">✕</button></div></div>`;
  const ta = $('textarea', foot); ta.focus();
  const close = () => { drawBoard(); BD.flushPending?.(); };
  const add = async () => {
    const title = ta.value.trim(); if (!title) return close();
    ta.value = '';
    const last = visibleCards(listId).at(-1);
    const tmp = { id: 'tmp' + Date.now(), board_id: BD.board.id, list_id: listId, title, description: '', position: between(last?.position ?? null, null), labels: [], assignees: [], due_date: null, done: false, checklist: [], cover: '', archived: false };
    BD.cards.push(tmp);
    const zone = $(`.bl-cards[data-list="${listId}"]`); zone.insertAdjacentHTML('beforeend', cardHtml(tmp)); zone.scrollTop = zone.scrollHeight;
    BD.busy++;
    try {
      const { id, ...row } = tmp;
      const c = check(await sb.from('board_cards').insert({ ...row, created_by: S.me.id, last_edit_by: S.me.id }).select().single());
      Object.assign(tmp, c);
      const el = $(`.bc[data-id="${id}"]`); if (el) { el.dataset.id = c.id; el.classList.add('fresh'); el.onclick = () => openCard(c.id); }
    } catch (err) { BD.cards = BD.cards.filter(x => x !== tmp); toast(err.message, true); }
    BD.busy--;
    ta.focus();
  };
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); } if (e.key === 'Escape') close(); };
  $('[data-go]', foot).onclick = add;
  $('[data-x]', foot).onclick = close;
  ta.onblur = () => setTimeout(() => { if (document.activeElement !== ta && !foot.contains(document.activeElement) && !ta.value.trim()) close(); }, 150);
}
async function moveCard(id, listId, position) {
  const c = BD.cards.find(x => x.id === id); if (!c) return;
  const from = c.list_id;
  Object.assign(c, { list_id: listId, position });
  drawBoard();
  $(`.bc[data-id="${id}"]`)?.classList.add('moved-in');
  try {
    check(await sb.from('board_cards').update({ list_id: listId, position }).eq('id', id));
    if (from !== listId) { const l = BD.lists.find(x => x.id === listId); if (/hotovo|done/i.test(l?.name || '') && !c.done && c.due_date) patchCard(id, { done: true }); }
  } catch (err) { toast(err.message, true); }
}
const patchTimers = {};
async function patchCard(id, fields, { delay = 0 } = {}) {
  const c = BD.cards.find(x => x.id === id); if (!c) return;
  Object.assign(c, fields);
  const el = $(`.bc[data-id="${id}"]`); if (el) { el.outerHTML = cardHtml(c); bindBoard($('#bCanvas')); }
  const run = async () => { BD.busy++; try { check(await sb.from('board_cards').update(fields).eq('id', id)); } catch (err) { toast(err.message, true); } BD.busy--; };
  if (!delay) return run();
  const key = id + Object.keys(fields).join();
  clearTimeout(patchTimers[key]); patchTimers[key] = setTimeout(run, delay);
}

// ---------- detail karty ----------
let refreshOpenCard = () => {};
async function openCard(id) {
  const c = BD.cards.find(x => x.id === id); if (!c) return;
  $$('.backdrop').forEach(x => x.remove());
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = `<div class="modal card-modal" role="dialog" aria-modal="true"></div>`;
  document.body.appendChild(bd);
  const m = $('.card-modal', bd);
  let comments = [];
  const close = () => { bd.classList.add('out'); document.removeEventListener('keydown', key); refreshOpenCard = () => {}; setTimeout(() => bd.remove(), 150); };
  const key = e => { if (e.key === 'Escape' && !e.target.closest('textarea, input')) close(); };
  document.addEventListener('keydown', key);
  bd.addEventListener('mousedown', e => { if (e.target === bd) close(); });

  function draw() {
    const due = dueInfo(c);
    const cl = c.checklist || []; const clDone = cl.filter(x => x.done).length;
    m.innerHTML = `
      ${c.cover ? `<div class="cm-cover" style="background:${LABEL_COLORS[c.cover]}"></div>` : ''}
      <div class="cm-head">
        <textarea class="cm-title" rows="1">${esc(c.title)}</textarea>
        <button class="ib" data-close title="Zavřít (Esc)">✕</button>
      </div>
      <div class="cm-where">ve sloupci <select class="cm-list">${BD.lists.map(l => `<option value="${l.id}" ${l.id === c.list_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
      <div class="cm-body">
        <div class="cm-main">
          <div class="cm-meta">
            <div><label>Lidé</label><div class="cm-people">${S.users.filter(u => u.active !== false).map(u => `<button class="cm-person ${c.assignees.includes(u.id) ? 'on' : ''}" data-u="${u.id}" title="${esc(u.name)}"><span class="av">${initials(u.id)}</span>${esc(u.name.split(' ')[0])}</button>`).join('')}</div></div>
            <div><label>Termín</label><div class="row" style="flex-wrap:nowrap"><input type="date" class="cm-due" value="${esc(c.due_date || '')}" style="width:auto">
              <label class="cm-done"><input type="checkbox" ${c.done ? 'checked' : ''}> hotovo</label>${due ? `<span class="due ${due.cls}">${esc(due.title)}</span>` : ''}</div></div>
          </div>
          <div><label>Štítky</label><div class="cm-labels">${BD.board.labels.map(l => `<button class="lbl big ${c.labels.includes(l.id) ? 'on' : ''}" data-l="${l.id}" style="--lc:${LABEL_COLORS[l.color]}">${esc(l.name || ' ')}</button>`).join('')}<button class="ib" data-editlabels title="Pojmenovat štítky">✎</button></div></div>
          <div><label>Popis</label><textarea class="cm-desc" rows="4" placeholder="Podrobnosti, odkazy, kontakty…">${esc(c.description)}</textarea></div>
          <div>
            <label>Checklist ${cl.length ? `<span class="muted">${clDone}/${cl.length}</span>` : ''}</label>
            ${cl.length ? `<div class="prog cm-prog" data-st="${clDone === cl.length ? 'done' : 'part'}"><i style="width:${(clDone / cl.length) * 100}%"></i></div>` : ''}
            <div class="cm-cl">${cl.map(x => `<div class="cm-cli ${x.done ? 'on' : ''}" data-i="${x.id}"><label class="si-chk"><input type="checkbox" ${x.done ? 'checked' : ''}><span></span></label><input class="cm-clt" value="${esc(x.text)}"><button class="ib del" data-rm title="Odebrat">✕</button></div>`).join('')}</div>
            <input class="cm-cladd" placeholder="＋ Přidat položku (Enter)">
          </div>
          <div class="cm-comments">
            <label>Komentáře</label>
            <div class="compose"><textarea id="cmNew" rows="1" placeholder="Napiš komentář…"></textarea><button class="btn primary" id="cmPost" title="Odeslat (Ctrl+Enter)">➤</button></div>
            <div id="cmList">${comments.map(x => `<div class="cm ${x.author === S.me.id ? 'mine' : ''}"><span class="av">${initials(x.author)}</span><div class="bub"><div class="h"><b>${esc(userName(x.author))}</b><span title="${esc(czDateTime(x.created_at))}">${ago(x.created_at)}</span>${x.author === S.me.id || S.me.role === 'admin' ? `<button class="x" data-cdel="${x.id}">✕</button>` : ''}</div><p>${esc(x.text)}</p></div></div>`).join('') || '<div class="muted small">Zatím bez komentářů.</div>'}</div>
          </div>
        </div>
        <div class="cm-side">
          <label>Obálka</label>
          <div class="swatches small">${COVERS.map(x => `<button class="sw2 ${c.cover === x ? 'on' : ''}" data-cover="${x}" style="background:${x ? LABEL_COLORS[x] : 'repeating-linear-gradient(45deg,var(--surface-2) 0 4px,var(--panel) 4px 8px)'}" title="${x || 'bez obálky'}"></button>`).join('')}</div>
          <label style="margin-top:14px">Akce</label>
          <button class="btn sm" data-arch>${c.archived ? '↩ Obnovit z archivu' : '🗄 Archivovat'}</button>
          <button class="btn sm danger" data-del>🗑 Smazat kartu</button>
          <div class="muted small" style="margin-top:12px">Vytvořil(a) ${esc(userName(c.created_by) || '—')}<br>${c.created_at ? czDateTime(c.created_at) : ''}</div>
        </div>
      </div>`;
    const title = $('.cm-title', m); const grow = t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
    grow(title); grow($('.cm-desc', m));
    title.oninput = () => { grow(title); patchCard(c.id, { title: title.value }, { delay: 600 }); };
    title.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } };
    $('[data-close]', m).onclick = close;
    $('.cm-list', m).onchange = e => { const last = visibleCards(e.target.value).at(-1); moveCard(c.id, e.target.value, between(last?.position ?? null, null)); toast('Karta přesunuta do „' + BD.lists.find(l => l.id === e.target.value).name + '“'); };
    $$('[data-u]', m).forEach(b => b.onclick = () => { const u = b.dataset.u; patchCard(c.id, { assignees: c.assignees.includes(u) ? c.assignees.filter(x => x !== u) : [...c.assignees, u] }); b.classList.toggle('on'); });
    $('.cm-due', m).onchange = e => { patchCard(c.id, { due_date: e.target.value || null }); draw(); };
    $('.cm-done input', m).onchange = e => { patchCard(c.id, { done: e.target.checked }); draw(); };
    $$('[data-l]', m).forEach(b => b.onclick = () => { const l = b.dataset.l; patchCard(c.id, { labels: c.labels.includes(l) ? c.labels.filter(x => x !== l) : [...c.labels, l] }); b.classList.toggle('on'); });
    $('[data-editlabels]', m).onclick = async () => { await editLabels(); openCard(c.id); };
    const desc = $('.cm-desc', m); desc.oninput = () => { grow(desc); patchCard(c.id, { description: desc.value }, { delay: 700 }); };
    // checklist
    const saveCl = () => patchCard(c.id, { checklist: c.checklist });
    $$('.cm-cli', m).forEach(row => {
      const it = c.checklist.find(x => x.id === row.dataset.i);
      $('input[type="checkbox"]', row).onchange = e => { it.done = e.target.checked; saveCl(); draw(); };
      $('.cm-clt', row).oninput = e => { it.text = e.target.value; patchCard(c.id, { checklist: c.checklist }, { delay: 700 }); };
      $('[data-rm]', row).onclick = () => { c.checklist = c.checklist.filter(x => x !== it); saveCl(); draw(); };
    });
    const add = $('.cm-cladd', m);
    add.onkeydown = e => { if (e.key === 'Enter' && add.value.trim()) { c.checklist = [...(c.checklist || []), { id: crypto.randomUUID().slice(0, 8), text: add.value.trim(), done: false }]; saveCl(); draw(); $('.cm-cladd', m).focus(); } };
    // obálka, archiv, smazání
    $$('[data-cover]', m).forEach(b => b.onclick = () => { patchCard(c.id, { cover: b.dataset.cover }); draw(); });
    $('[data-arch]', m).onclick = () => { const a = !c.archived; patchCard(c.id, { archived: a }); drawBoard(); if (a) { close(); toast('Karta archivována', { action: { label: 'Vrátit', fn: () => { patchCard(c.id, { archived: false }); drawBoard(); } } }); } else draw(); };
    $('[data-del]', m).onclick = async () => {
      if (!(await confirmBox('Smazat kartu?', `„${c.title}“ se smaže i s komentáři. Tip: archivace jde vrátit, smazání ne.`, { ok: 'Smazat', danger: true }))) return;
      try { check(await sb.from('board_cards').delete().eq('id', c.id)); BD.cards = BD.cards.filter(x => x.id !== c.id); drawBoard(); close(); toast('Karta smazána'); } catch (err) { toast(err.message, true); }
    };
    // komentáře
    const ta = $('#cmNew', m);
    ta.oninput = () => grow(ta);
    const post = async () => {
      const text = ta.value.trim(); if (!text) return;
      try {
        const x = check(await sb.from('board_comments').insert({ card_id: c.id, board_id: c.board_id, author: S.me.id, text }).select().single());
        comments.unshift(x); BD.comments[c.id] = (BD.comments[c.id] || 0) + 1; patchCardFace(); draw(); $('#cmNew', m).focus();
      } catch (err) { toast(err.message, true); }
    };
    $('#cmPost', m).onclick = post;
    ta.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post(); };
    $$('[data-cdel]', m).forEach(b => b.onclick = async () => {
      if (!(await confirmBox('Smazat komentář?', 'Komentář se nevratně odstraní.', { ok: 'Smazat', danger: true }))) return;
      try { check(await sb.from('board_comments').delete().eq('id', b.dataset.cdel)); comments = comments.filter(x => x.id !== b.dataset.cdel); BD.comments[c.id]--; patchCardFace(); draw(); } catch (err) { toast(err.message, true); }
    });
  }
  const patchCardFace = () => { const el = $(`.bc[data-id="${c.id}"]`); if (el) { el.outerHTML = cardHtml(c); bindBoard($('#bCanvas')); } };
  const loadComments = async () => { comments = check(await sb.from('board_comments').select('*').eq('card_id', c.id).order('created_at', { ascending: false })); };
  draw();
  try { await loadComments(); if (!(m.contains(document.activeElement) && document.activeElement.matches('textarea, input'))) draw(); } catch {}
  refreshOpenCard = async () => {
    const i = BD.cards.findIndex(x => x.id === c.id);
    if (i < 0) { close(); return; }
    Object.assign(c, BD.cards[i]); BD.cards[i] = c; // detail i nástěnka sdílí stejný objekt
    if (m.contains(document.activeElement) && document.activeElement.matches('textarea, input:not([type="checkbox"])')) return; // nepřepisovat rozepsané
    try { await loadComments(); } catch {}
    draw();
  };
}
