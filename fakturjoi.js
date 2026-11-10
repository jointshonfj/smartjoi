/* SmartJoi — Aplikace 08: FakturJoi (faktury, odběratelé, hlídání limitu obratu)
   Modul dostává pomocné funkce z app.js (createFj), aby nemusel sdílet žádný globální stav. */
import qrcode from './qr.js?v=20261110a';

// ---------- formátování ----------
const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const MON_S = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
const nf0 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NB = ' ';
const kc = n => { n = Number(n) || 0; return (Number.isInteger(n) ? nf0 : nf2).format(n) + NB + 'Kč'; };
const kc2 = n => nf2.format(Number(n) || 0) + NB + 'Kč';
const D = iso => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${+d}.${+m}.${y}`; };
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const toNum = s => { const x = String(s ?? '').replace(/\s/g, '').replace(',', '.'); return x === '' ? null : Number(x); };
const lineTotal = it => r2((toNum(it.qty) ?? 1) * (toNum(it.price) || 0));
const ymLabel = ym => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

// ---------- účet → IBAN → QR platba (SPD) ----------
export function czIban(acc) {
  const m = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(String(acc || '').replace(/\s/g, ''));
  if (!m) return '';
  const bban = m[3] + (m[1] || '').padStart(6, '0') + m[2].padStart(10, '0');
  let r = 0; for (const ch of bban + '123500') r = (r * 10 + +ch) % 97;
  return 'CZ' + String(98 - r).padStart(2, '0') + bban;
}
const ascii = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .,\-/]/g, '').toUpperCase();
function spdString(inv, sup) {
  const iban = czIban(sup.bank_account);
  if (!iban || !(inv.total > 0)) return '';
  const vs = String(inv.vs || '').replace(/\D/g, '').slice(0, 10);
  return `SPD*1.0*ACC:${iban}*AM:${inv.total.toFixed(2)}*CC:CZK*DT:${inv.due.replaceAll('-', '')}${vs ? `*X-VS:${vs}` : ''}*MSG:${ascii('Faktura ' + inv.number).slice(0, 60)}`;
}
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ scalable: true, margin: 0 });
}

// ---------- načtení / normalizace dat ----------
export function fjNormalize({ settings, clients, invoices }) {
  const s = settings || {};
  return {
    settings: { name: s.name || '', address: s.address || '', ico: s.ico || '', dic: s.dic || '', email: s.email || '', phone: s.phone || '', bank_account: s.bank_account || '', payment_method: s.payment_method || 'Bankovním převodem', due_days: s.due_days ?? 14, ceiling: Number(s.ceiling ?? 2000000), footer_note: s.footer_note ?? '' },
    clients: clients.map(c => ({ ...c })),
    invoices: invoices.map(i => ({ ...i, issued: String(i.issued).slice(0, 10), due: String(i.due).slice(0, 10), paid_at: i.paid_at ? String(i.paid_at).slice(0, 10) : null, total: Number(i.total), items: Array.isArray(i.items) ? i.items : [] })),
  };
}

const PAY = ['Bankovním převodem', 'Hotově', 'Kartou', 'Dobírkou'];
const isTransfer = m => /převod/i.test(m || '');
const ST = { issued: ['Čeká na úhradu', 'info'], overdue: ['Po splatnosti', 'bad'], paid: ['Uhrazeno', 'ok'], cancelled: ['Storno', ''] };

export function createFj(c) {
  const { sb, ui, $, esc, toast, act, ok, plural, todayIso, addDays, closeModal, SJCalendar } = c;
  const S = () => c.S();
  const I = () => S().inv;
  const base = '#/fakturjoi';
  const clientById = id => I().clients.find(x => x.id === id);
  const invById = id => I().invoices.find(x => x.id === id);
  const eff = i => i.status === 'issued' && i.due < todayIso() ? 'overdue' : i.status;
  const live = () => I().invoices.filter(i => i.status !== 'cancelled');
  const sum = list => r2(list.reduce((s, i) => s + i.total, 0));
  const curYear = () => +todayIso().slice(0, 4);
  const years = () => [...new Set([curYear(), ...I().invoices.map(i => +i.issued.slice(0, 4))])].sort((a, b) => b - a);
  const selYear = () => (ui.fjYear && years().includes(ui.fjYear)) ? ui.fjYear : curYear();

  // posledních 12 kalendářních měsíců včetně aktuálního
  function windowMonths() {
    const t = todayIso(); const y = +t.slice(0, 4), m = +t.slice(5, 7); const out = [];
    for (let k = 11; k >= 0; k--) { let mm = m - k, yy = y; while (mm < 1) { mm += 12; yy--; } out.push(`${yy}-${String(mm).padStart(2, '0')}`); }
    return out;
  }
  function stats() {
    const L = live(), months = windowMonths(), ceiling = I().settings.ceiling || 0;
    const rolling = sum(L.filter(i => months.includes(i.issued.slice(0, 7))));
    const year = sum(L.filter(i => +i.issued.slice(0, 4) === curYear()));
    const open = L.filter(i => i.status === 'issued'), over = open.filter(i => i.due < todayIso());
    const pct = ceiling > 0 ? rolling / ceiling : 0;
    return { months, ceiling, rolling, year, pct, remaining: r2(ceiling - rolling), open: sum(open), openN: open.length, over: sum(over), overN: over.length };
  }

  // ---------- API pro hub / kalendář ----------
  const counts = () => I() ? stats() : null;
  function attention() {
    if (!I()) return [];
    const s = stats(), out = [];
    if (s.overN) out.push({ n: s.overN, label: s.overN === 1 ? 'faktura po splatnosti' : s.overN < 5 ? 'faktury po splatnosti' : 'faktur po splatnosti', href: base + '/faktury', tone: 'bad' });
    if (s.ceiling && s.pct >= 0.8) out.push({ n: Math.round(s.pct * 100), label: '% limitu obratu', href: base, tone: s.pct >= 1 ? 'bad' : 'warn' });
    return out;
  }
  function hubBadges() {
    if (!I()) return '<span class="badge">nenačteno</span>';
    const s = stats();
    return `<span class="badge">letos ${esc(kc(s.year))}</span>${s.overN ? `<span class="badge bad"><span class="dot"></span>${plural(s.overN, 'faktura', 'faktury', 'faktur')} po splatnosti</span>` : s.openN ? `<span class="badge info">${s.openN} čeká na úhradu</span>` : '<span class="badge ok"><span class="dot"></span>Vše uhrazeno</span>'}${s.ceiling ? `<span class="badge ${s.pct >= 1 ? 'bad' : s.pct >= 0.8 ? 'warn' : ''}">${Math.round(s.pct * 100)} % limitu</span>` : ''}`;
  }
  const synced = new Set();
  async function syncCal() {
    if (!I()) return;
    for (const i of I().invoices) {
      const key = `${i.id}|${i.status}|${i.due}|${i.number}`;
      if (synced.has(key)) continue;
      try {
        if (i.status === 'issued') await SJCalendar.upsert({ app: 'fakturjoi', ref: 'faktura:' + i.id, title: `💸 Splatnost faktury ${i.number}`, date: i.due, details: `Faktura ${i.number} — splatnost ${D(i.due)}.`, url: location.origin + location.pathname + '#/fakturjoi/f/' + i.id });
        else if (S().events.some(e => e.ref === 'faktura:' + i.id)) await SJCalendar.remove('faktura:' + i.id);
        synced.add(key);
      } catch (e) { console.warn('FakturJoi kalendář', e); }
    }
  }
  function crumb(tab, id) {
    let tail = '';
    if (I()) {
      if (tab === 'f' || tab === 'e') { const i = invById(id); tail = i ? `<span>/</span><b>${esc(i.number)}</b>` : ''; }
      else if (tab === 'nova') tail = '<span>/</span><b>Nová faktura</b>';
      else if (tab === 'o') { const x = clientById(id); tail = x ? `<span>/</span><b>${esc(x.name)}</b>` : ''; }
    }
    return `<span>/</span><a href="${base}">FakturJoi</a>${tail}`;
  }

  // ---------- skeleton ----------
  function modal(w, html) {
    $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal" style="max-width:${w}px">${html}</div></div>`;
    document.querySelectorAll('#modal-root [data-close]').forEach(b => b.onclick = closeModal);
  }
  const nextNumber = (issued) => {
    const yy = String(issued || todayIso()).slice(2, 4), re = new RegExp(`^${yy}-(\\d+)$`);
    const max = Math.max(0, ...I().invoices.map(i => { const m = re.exec(i.number); return m ? +m[1] : 0; }));
    return `${yy}-${String(max + 1).padStart(3, '0')}`;
  };
  const vsOf = n => String(n || '').replace(/\D/g, '').slice(0, 10);

  function renderApp(tab, id) {
    if (!I()) { $('#view').innerHTML = '<div class="card empty">FakturJoi se nepodařilo načíst.</div>'; return; }
    if (tab !== 'nova' && tab !== 'e') ui.fjDraft = null;
    syncCal();
    if (tab === 'f') return renderDetail(id);
    if (tab === 'nova' || tab === 'e') return renderEditor(tab, id);
    if (tab === 'o') return renderClient(id);
    const T = [['', 'Přehled'], ['faktury', 'Faktury'], ['odberatele', 'Odběratelé'], ['nastaveni', 'Nastavení']];
    let h = `<div class="page-head"><div><div class="eyebrow">Aplikace 08 · faktury</div><h1>FakturJoi 🧾</h1></div>
      <button class="btn primary" id="fj-new">＋ Faktura</button></div>
      <div class="tabs">${T.map(([k, l]) => `<button class="tab ${k === tab ? 'active' : ''}" data-fjtab="${k}">${l}</button>`).join('')}</div>`;
    h += tab === 'faktury' ? listHtml() : tab === 'odberatele' ? clientsHtml() : tab === 'nastaveni' ? settingsHtml() : overviewHtml();
    $('#view').innerHTML = h;
    document.querySelectorAll('[data-fjtab]').forEach(b => b.onclick = () => { location.hash = base + (b.dataset.fjtab ? '/' + b.dataset.fjtab : ''); });
    $('#fj-new').onclick = () => { location.hash = base + '/nova'; };
    document.querySelectorAll('[data-go]').forEach(r => r.onclick = e => { if (e.target.closest('a,button')) return; location.hash = r.dataset.go; });
    document.querySelectorAll('[data-fjyear]').forEach(b => b.onclick = () => { ui.fjYear = +b.dataset.fjyear; c.render(); });
    if (tab === 'faktury') bindList();
    else if (tab === 'odberatele') $('#fj-newc').onclick = () => clientModal(null);
    else if (tab === 'nastaveni') bindSettings();
  }

  const badge = i => { const [l, t] = ST[eff(i)]; return `<span class="badge ${t}">${esc(l)}</span>`; };
  const yearChips = () => years().length > 1 ? `<div class="chips">${years().map(y => `<button class="chip ${y === selYear() ? 'on' : ''}" data-fjyear="${y}">${y}</button>`).join('')}</div>` : '';

  // ---------- přehled ----------
  function overviewHtml() {
    const s = stats(), y = selYear(), L = live().filter(i => +i.issued.slice(0, 4) === y);
    const tone = s.pct >= 1 ? 'bad' : s.pct >= 0.8 ? 'warn' : 'ok';
    const avg = s.rolling / 12, monthsLeft = avg > 0 && s.remaining > 0 ? s.remaining / avg : null;
    const byMonth = s.months.map(m => ({ m, v: sum(live().filter(i => i.issued.slice(0, 7) === m)) }));
    const max = Math.max(1, ...byMonth.map(x => x.v));
    const groups = {};
    for (const i of L) { const k = i.client_id || i.client_name; (groups[k] ||= { name: i.client_name, id: i.client_id, n: 0, v: 0 }); groups[k].n++; groups[k].v += i.total; }
    const top = Object.values(groups).sort((a, b) => b.v - a.v);
    const yTotal = sum(L);
    const recent = [...I().invoices].sort((a, b) => b.issued.localeCompare(a.issued) || b.number.localeCompare(a.number)).slice(0, 5);
    return `<div class="stats">
      <div class="stat"><div class="v eur">${esc(kc(yTotal))}</div><div class="l">vyfakturováno v roce ${y}</div></div>
      <div class="stat"><div class="v eur">${esc(kc(s.open))}</div><div class="l">čeká na úhradu · ${plural(s.openN, 'faktura', 'faktury', 'faktur')}</div></div>
      <div class="stat"><div class="v eur" style="color:${s.overN ? 'var(--bad)' : 'inherit'}">${esc(kc(s.over))}</div><div class="l">po splatnosti · ${plural(s.overN, 'faktura', 'faktury', 'faktur')}</div></div>
      <div class="stat"><div class="v eur" style="color:${s.remaining < 0 ? 'var(--bad)' : 'inherit'}">${esc(kc(Math.abs(s.remaining)))}</div><div class="l">${s.remaining < 0 ? 'nad limitem obratu' : 'zbývá do limitu obratu'}</div></div>
    </div>
    <div class="card fj-ceil ${tone}"><div class="card-head"><div><h2>Limit obratu</h2>
      <div class="sub">Posledních 12 kalendářních měsíců (${esc(ymLabel(s.months[0]))} – ${esc(ymLabel(s.months[11]))}). Počítám vystavené faktury bez stornovaných.</div></div>
      <span class="badge ${tone === 'ok' ? '' : tone}">${Math.round(s.pct * 100)} %</span></div>
      <div class="fj-meter" role="img" aria-label="Vyčerpáno ${Math.round(s.pct * 100)} % limitu"><i style="width:${Math.min(100, s.pct * 100).toFixed(1)}%"></i><b style="left:80%"></b></div>
      <div class="fj-meter-l"><span><b>${esc(kc(s.rolling))}</b> z ${esc(kc(s.ceiling))}</span><span>${s.remaining >= 0 ? `zbývá ${esc(kc(s.remaining))}` : `přes limit o ${esc(kc(-s.remaining))}`}</span></div>
      <div class="small muted" style="margin-top:8px">V kalendářním roce ${curYear()} dosud ${esc(kc(s.year))}.${monthsLeft && monthsLeft < 37 ? ` Při průměru ${esc(kc(Math.round(avg)))} měsíčně by limit vyšel zhruba za ${monthsLeft < 1 ? 'méně než měsíc' : plural(Math.round(monthsLeft), 'měsíc', 'měsíce', 'měsíců')} (orientačně).` : ''}${s.pct >= 1 ? ' <b>Limit je překročen — proberte s účetní plátcovství DPH.</b>' : ''}</div>
    </div>
    <div class="card"><div class="card-head"><div><h2>Fakturace po měsících</h2><div class="sub">Posledních 12 měsíců podle data vystavení.</div></div></div>
      <div class="fj-bars">${byMonth.map(x => `<div class="fj-bar" title="${esc(ymLabel(x.m))}: ${esc(kc(x.v))}"><span class="bv">${x.v ? (x.v >= 1000 ? nf0.format(Math.round(x.v / 1000)) + ' k' : nf0.format(x.v)) : ''}</span><i style="height:${Math.max(2, Math.round(x.v / max * 140))}px"></i><span class="bl">${MON_S[+x.m.slice(5, 7) - 1]}</span></div>`).join('')}</div>
    </div>
    <div class="grid-2" style="align-items:start">
      <div class="card"><div class="card-head"><div><h2>Komu fakturuju</h2><div class="sub">Rok ${y}</div></div>${yearChips()}</div>
        ${top.length ? `<div class="fj-top">${top.map(t => `<a class="fj-top-r" href="${t.id ? base + '/o/' + t.id : base + '/odberatele'}"><div class="row" style="justify-content:space-between;gap:10px"><b>${esc(t.name)}</b><span class="tnum">${esc(kc(t.v))}</span></div><div class="fj-share"><i style="width:${yTotal ? (t.v / yTotal * 100).toFixed(1) : 0}%"></i></div><div class="small muted">${plural(t.n, 'faktura', 'faktury', 'faktur')} · ${yTotal ? Math.round(t.v / yTotal * 100) : 0} %</div></a>`).join('')}</div>` : '<div class="empty">V tomto roce zatím žádná faktura.</div>'}
      </div>
      <div class="card"><div class="card-head"><div><h2>Poslední faktury</h2></div><a class="btn sm ghost" href="${base}/faktury">Všechny</a></div>
        ${recent.length ? `<div class="table-wrap"><table><tbody>${recent.map(i => `<tr class="fj-tr" data-go="${base}/f/${i.id}"><td><b>${esc(i.number)}</b><div class="sub">${esc(i.client_name)}</div></td><td class="r tnum">${esc(kc(i.total))}</td><td>${badge(i)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Zatím žádné faktury.</div>'}
      </div>
    </div>`;
  }

  // ---------- seznam faktur ----------
  const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function listFiltered() {
    const y = ui.fjListYear ?? 'all', f = ui.fjFilter || 'all', q = fold(ui.fjSearch || '');
    return [...I().invoices].filter(i => (y === 'all' || +i.issued.slice(0, 4) === y) && (f === 'all' || eff(i) === f) && (!q || fold(`${i.number} ${i.client_name} ${i.client_ico} ${i.note}`).includes(q)))
      .sort((a, b) => b.issued.localeCompare(a.issued) || b.number.localeCompare(a.number));
  }
  function listHtml() {
    const rows = listFiltered(), y = ui.fjListYear ?? 'all', f = ui.fjFilter || 'all';
    const F = [['all', 'Vše'], ['issued', 'Čeká na úhradu'], ['overdue', 'Po splatnosti'], ['paid', 'Uhrazené'], ['cancelled', 'Storno']];
    return `<div class="card"><div class="card-head" style="flex-wrap:wrap;gap:10px">
        <div class="chips">${F.map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-fjf="${k}">${l}</button>`).join('')}</div>
        <div class="chips"><button class="chip ${y === 'all' ? 'on' : ''}" data-fjly="all">Všechny roky</button>${years().map(v => `<button class="chip ${y === v ? 'on' : ''}" data-fjly="${v}">${v}</button>`).join('')}</div></div>
      <div class="row" style="gap:8px;margin-bottom:10px;flex-wrap:wrap"><input type="search" id="fj-q" class="grow" placeholder="Hledat číslo, odběratele, IČO…" value="${esc(ui.fjSearch || '')}"><button class="btn sm ghost" id="fj-csv" title="Seznam zobrazených faktur pro účetní">⬇ CSV</button></div>
      ${rows.length ? `<div class="table-wrap"><table class="fj-list"><thead><tr><th>Číslo</th><th>Odběratel</th><th>Vystaveno</th><th>Splatnost</th><th class="r">Částka</th><th>Stav</th></tr></thead><tbody>
        ${rows.map(i => `<tr class="fj-tr ${i.status === 'cancelled' ? 'cx' : ''}" data-go="${base}/f/${i.id}"><td><a href="${base}/f/${i.id}"><b>${esc(i.number)}</b></a></td><td>${esc(i.client_name)}</td><td>${esc(D(i.issued))}</td><td>${esc(D(i.due))}</td><td class="r tnum">${esc(kc2(i.total))}</td><td>${badge(i)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="4"><b>Celkem ${plural(rows.filter(i => i.status !== 'cancelled').length, 'faktura', 'faktury', 'faktur')}</b> <span class="muted small">(bez stornovaných)</span></td><td class="r tnum"><b>${esc(kc2(sum(rows.filter(i => i.status !== 'cancelled'))))}</b></td><td></td></tr></tfoot></table></div>` : '<div class="empty">Nic nenalezeno.</div>'}
    </div>`;
  }
  function bindList() {
    document.querySelectorAll('[data-fjf]').forEach(b => b.onclick = () => { ui.fjFilter = b.dataset.fjf; c.render(); });
    document.querySelectorAll('[data-fjly]').forEach(b => b.onclick = () => { ui.fjListYear = b.dataset.fjly === 'all' ? 'all' : +b.dataset.fjly; c.render(); });
    $('#fj-q').oninput = e => { ui.fjSearch = e.target.value; const pos = e.target.selectionStart; c.render(); const q = $('#fj-q'); q.focus(); q.setSelectionRange(pos, pos); };
    $('#fj-csv').onclick = () => {
      const q = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
      const head = ['Číslo', 'Odběratel', 'IČO', 'DIČ', 'Vystaveno', 'Splatnost', 'Uhrazeno', 'Částka', 'Stav', 'Způsob platby', 'VS'];
      const lines = listFiltered().map(i => [i.number, i.client_name, i.client_ico, i.client_dic, i.issued, i.due, i.paid_at || '', String(i.total).replace('.', ','), ST[eff(i)][0], i.payment_method, i.vs].map(q).join(';'));
      const blob = new Blob(['﻿' + [head.map(q).join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `faktury-${ui.fjListYear ?? 'vse'}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
  }

  // ---------- odběratelé ----------
  const clientStats = id => { const L = live().filter(i => i.client_id === id); return { n: L.length, total: sum(L), year: sum(L.filter(i => +i.issued.slice(0, 4) === curYear())), last: L.map(i => i.issued).sort().pop() || null, open: sum(L.filter(i => i.status === 'issued')) }; };
  function clientsHtml() {
    const list = I().clients.map(x => ({ x, s: clientStats(x.id) })).sort((a, b) => b.s.total - a.s.total || a.x.name.localeCompare(b.x.name, 'cs'));
    return `<div class="card"><div class="card-head"><div><h2>Odběratelé</h2><div class="sub">Komu fakturuješ a kolik celkem.</div></div><button class="btn sm primary" id="fj-newc">＋ Odběratel</button></div>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Název</th><th>IČO</th><th class="r">Faktur</th><th class="r">Letos</th><th class="r">Celkem</th><th>Naposledy</th></tr></thead><tbody>
      ${list.map(({ x, s }) => `<tr class="fj-tr" data-go="${base}/o/${x.id}"><td><a href="${base}/o/${x.id}"><b>${esc(x.name)}</b></a>${s.open ? `<div class="sub">čeká ${esc(kc(s.open))}</div>` : ''}</td><td>${esc(x.ico || '—')}</td><td class="r">${s.n}</td><td class="r tnum">${esc(kc(s.year))}</td><td class="r tnum">${esc(kc(s.total))}</td><td>${esc(D(s.last))}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Zatím žádný odběratel.</div>'}</div>`;
  }
  function renderClient(id) {
    const x = clientById(id);
    if (!x) { $('#view').innerHTML = `<div class="card empty"><div class="big">🧾</div><b>Odběratel nenalezen.</b><div class="small"><a href="${base}/odberatele">Zpět na odběratele</a></div></div>`; return; }
    const s = clientStats(id), invs = I().invoices.filter(i => i.client_id === id).sort((a, b) => b.issued.localeCompare(a.issued) || b.number.localeCompare(a.number));
    $('#view').innerHTML = `
      <div class="row" style="gap:8px;margin-bottom:14px;flex-wrap:wrap"><a class="btn sm ghost" href="${base}/odberatele">← Odběratelé</a><span class="grow"></span>
        <button class="btn sm" id="fjc-edit">Upravit</button><a class="btn sm primary" href="${base}/nova/c:${x.id}">＋ Faktura</a></div>
      <div class="card"><h1 style="margin:0 0 6px">${esc(x.name)}</h1>
        <div class="small">${esc(x.address || 'Adresa není vyplněná')}</div>
        <div class="small muted" style="margin-top:4px">${[x.ico && 'IČO ' + esc(x.ico), x.dic && 'DIČ ' + esc(x.dic), x.email && esc(x.email)].filter(Boolean).join(' · ') || ''}</div>
        ${x.note ? `<div class="small" style="margin-top:8px">${esc(x.note)}</div>` : ''}</div>
      <div class="stats"><div class="stat"><div class="v eur">${esc(kc(s.total))}</div><div class="l">fakturováno celkem</div></div><div class="stat"><div class="v eur">${esc(kc(s.year))}</div><div class="l">v roce ${curYear()}</div></div>
        <div class="stat"><div class="v">${s.n}</div><div class="l">faktur</div></div><div class="stat"><div class="v eur">${esc(kc(s.open))}</div><div class="l">čeká na úhradu</div></div></div>
      <div class="card"><div class="card-head"><h2>Faktury</h2></div>${invs.length ? `<div class="table-wrap"><table><tbody>${invs.map(i => `<tr class="fj-tr ${i.status === 'cancelled' ? 'cx' : ''}" data-go="${base}/f/${i.id}"><td><a href="${base}/f/${i.id}"><b>${esc(i.number)}</b></a></td><td>${esc(D(i.issued))}</td><td class="r tnum">${esc(kc2(i.total))}</td><td>${badge(i)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Zatím žádná faktura.</div>'}</div>`;
    document.querySelectorAll('[data-go]').forEach(r => r.onclick = e => { if (e.target.closest('a,button')) return; location.hash = r.dataset.go; });
    $('#fjc-edit').onclick = () => clientModal(x);
  }
  // onDone(id) — po uložení nového odběratele (editor faktury si ho vybere)
  function clientModal(x, onDone) {
    const v = x || { name: '', address: '', ico: '', dic: '', email: '', note: '' };
    modal(560, `<div class="modal-head"><h2>${x ? 'Upravit odběratele' : 'Nový odběratel'}</h2><button class="icon-btn" data-close>✕</button></div>
      <div class="stack"><label class="field"><span>Název / jméno</span><input type="text" id="fc-name" value="${esc(v.name)}"></label>
        <label class="field"><span>Adresa</span><input type="text" id="fc-addr" value="${esc(v.address)}" placeholder="Ulice č.p., PSČ Město"></label>
        <div class="grid-2"><label class="field"><span>IČO</span><input type="text" inputmode="numeric" id="fc-ico" value="${esc(v.ico)}"></label>
          <label class="field"><span>DIČ</span><input type="text" id="fc-dic" value="${esc(v.dic)}"></label></div>
        <label class="field"><span>E-mail (pro odeslání faktury)</span><input type="email" id="fc-mail" value="${esc(v.email)}"></label>
        <label class="field"><span>Poznámka</span><input type="text" id="fc-note" value="${esc(v.note)}"></label></div>
      <div class="modal-foot">${x ? '<button class="btn ghost" id="fc-del" style="margin-right:auto;color:var(--bad)">Smazat</button>' : ''}<button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="fc-save">Uložit</button></div>`);
    $('#fc-name').focus();
    $('#fc-save').onclick = () => {
      const row = { name: $('#fc-name').value.trim(), address: $('#fc-addr').value.trim(), ico: $('#fc-ico').value.replace(/\s/g, ''), dic: $('#fc-dic').value.replace(/\s/g, '').toUpperCase(), email: $('#fc-mail').value.trim(), note: $('#fc-note').value.trim() };
      if (!row.name) return toast('Doplň název odběratele');
      if (row.ico && !/^\d{6,10}$/.test(row.ico)) return toast('IČO má obsahovat jen číslice');
      closeModal();
      act(async () => {
        if (x) { ok(await sb.from('invoice_clients').update(row).eq('id', x.id)); return x.id; }
        return ok(await sb.from('invoice_clients').insert(row).select().single()).id;
      }, 'Uloženo ✓').then(id => { if (id && onDone) onDone(id); });
    };
    if (x) $('#fc-del').onclick = () => {
      if (I().invoices.some(i => i.client_id === x.id)) return toast('Odběratel má faktury — smazat ho nejde');
      if (!confirm(`Smazat odběratele ${x.name}?`)) return;
      closeModal(); act(async () => ok(await sb.from('invoice_clients').delete().eq('id', x.id)), 'Smazáno').then(() => { location.hash = base + '/odberatele'; });
    };
  }

  // ---------- nastavení ----------
  function settingsHtml() {
    const s = I().settings;
    return `<div class="card"><div class="card-head"><div><h2>Moje údaje (dodavatel)</h2><div class="sub">Zobrazují se na každé nové faktuře. U už vystavených faktur zůstávají údaje, jaké platily v den vystavení.</div></div></div>
      <div class="stack"><div class="grid-2">
        <label class="field"><span>Jméno / firma</span><input type="text" id="fs-name" value="${esc(s.name)}"></label>
        <label class="field"><span>Adresa</span><input type="text" id="fs-addr" value="${esc(s.address)}"></label>
        <label class="field"><span>IČO</span><input type="text" id="fs-ico" value="${esc(s.ico)}"></label>
        <label class="field"><span>DIČ (nechej prázdné, když nejsi plátce)</span><input type="text" id="fs-dic" value="${esc(s.dic)}"></label>
        <label class="field"><span>Bankovní účet</span><input type="text" id="fs-bank" value="${esc(s.bank_account)}" placeholder="123456789/0800"></label>
        <label class="field"><span>Výchozí způsob platby</span><select id="fs-pay">${PAY.map(p => `<option ${p === s.payment_method ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <label class="field"><span>Výchozí splatnost (dní)</span><input type="text" inputmode="numeric" id="fs-due" value="${esc(s.due_days)}"></label>
        <label class="field"><span>Limit obratu (Kč)</span><input type="text" inputmode="numeric" id="fs-ceil" value="${esc(s.ceiling)}"></label>
        <label class="field"><span>E-mail na faktuře</span><input type="text" id="fs-mail" value="${esc(s.email)}"></label>
        <label class="field"><span>Telefon na faktuře</span><input type="text" id="fs-tel" value="${esc(s.phone)}"></label></div>
        <label class="field"><span>Text v patičce faktury</span><input type="text" id="fs-foot" value="${esc(s.footer_note)}" placeholder="Nejsem plátce DPH"></label></div>
      <div class="small muted" style="margin-top:10px">Limit obratu je pro hlídání plátcovství DPH (ve výchozím nastavení 2 000 000 Kč za 12 kalendářních měsíců). Je to jen orientační přehled — rozhodující výpočet patří účetní. FakturJoi zatím neumí faktury s DPH, jen pro neplátce.</div>
      <div class="modal-foot" style="padding:14px 0 0"><button class="btn primary" id="fs-save">Uložit nastavení</button></div></div>`;
  }
  function bindSettings() {
    $('#fs-save').onclick = () => {
      const row = { id: 1, name: $('#fs-name').value.trim(), address: $('#fs-addr').value.trim(), ico: $('#fs-ico').value.replace(/\s/g, ''), dic: $('#fs-dic').value.replace(/\s/g, '').toUpperCase(), bank_account: $('#fs-bank').value.replace(/\s/g, ''),
        payment_method: $('#fs-pay').value, due_days: toNum($('#fs-due').value), ceiling: toNum($('#fs-ceil').value), email: $('#fs-mail').value.trim(), phone: $('#fs-tel').value.trim(), footer_note: $('#fs-foot').value.trim(), updated_at: new Date().toISOString() };
      if (!row.name) return toast('Doplň jméno');
      if (row.bank_account && !czIban(row.bank_account)) return toast('Účet zadej ve tvaru 123456789/0800 (nebo 19-123456789/0800)');
      if (row.due_days == null || !Number.isInteger(row.due_days) || row.due_days < 0 || row.due_days > 365) return toast('Splatnost: celé číslo dní, 0–365');
      if (row.ceiling == null || !(row.ceiling >= 0)) return toast('Limit obratu musí být číslo');
      act(async () => ok(await sb.from('invoice_settings').upsert(row)), 'Uloženo ✓');
    };
  }

  // ---------- často účtované položky ----------
  const MONTH_RE = /(leden|únor|březen|duben|květen|červen|červenec|srpen|září|říjen|listopad|prosinec)\s+(\d{4})/i;
  // „… - Září 2026“ → měsíc před datem vystavení (služby se fakturují zpětně)
  function adaptText(text, issued) {
    const m = MONTH_RE.exec(text); if (!m) return text;
    let y = +issued.slice(0, 4), mo = +issued.slice(5, 7) - 1; if (mo < 1) { mo = 12; y--; }
    let name = MONTHS[mo - 1]; if (m[1][0] === m[1][0].toUpperCase()) name = name[0].toUpperCase() + name.slice(1);
    return text.replace(MONTH_RE, `${name} ${y}`);
  }
  function usualItems(clientId, issued) {
    const g = new Map();
    for (const inv of live().sort((a, b) => a.issued.localeCompare(b.issued))) for (const it of inv.items) {
      if (!it.text || !(Number(it.price) > 0) && !(Number(it.price) < 0)) continue;
      const key = it.text.toLowerCase().replace(MONTH_RE, '#');
      const e = g.get(key) || { text: it.text, price: it.price, qty: it.qty ?? 1, unit: it.unit || '', all: 0, mine: 0 };
      e.all++; if (clientId && inv.client_id === clientId) e.mine++; e.text = it.text; e.price = it.price; e.qty = it.qty ?? 1; e.unit = it.unit || '';
      g.set(key, e);
    }
    let list = [...g.values()];
    if (clientId && list.some(e => e.mine)) list = list.filter(e => e.mine);
    return list.sort((a, b) => (b.mine - a.mine) || (b.all - a.all)).slice(0, 6).map(e => ({ ...e, text: adaptText(e.text, issued) }));
  }

  // ---------- editor faktury ----------
  function newDraft(src, clientId) {
    const s = I().settings, today = todayIso();
    const d = { id: null, number: nextNumber(today), client_id: clientId || '', issued: today, due: addDays(today, s.due_days), payment_method: s.payment_method, vs: '', status: 'issued', paid_at: '', items: [{ text: '', qty: '1', unit: '', price: '' }], note: '', numAuto: true, dueAuto: true, vsAuto: true, supplier: null };
    if (src) { d.client_id = src.client_id || ''; d.payment_method = src.payment_method; d.items = src.items.map(it => ({ text: adaptText(it.text, d.issued), qty: String(it.qty ?? 1), unit: it.unit || '', price: String(it.price ?? '') })); d.note = src.note || ''; }
    d.vs = vsOf(d.number);
    return d;
  }
  function draftOf(inv) {
    return { id: inv.id, number: inv.number, client_id: inv.client_id || '', issued: inv.issued, due: inv.due, payment_method: inv.payment_method, vs: inv.vs, status: inv.status, paid_at: inv.paid_at || '', items: inv.items.map(it => ({ text: it.text, qty: String(it.qty ?? 1), unit: it.unit || '', price: String(it.price ?? '') })), note: inv.note || '', numAuto: false, dueAuto: false, vsAuto: false, supplier: inv.supplier || null };
  }
  function renderEditor(tab, id) {
    const key = tab + ':' + id;
    if (!ui.fjDraft || ui.fjDraftKey !== key) {
      let d;
      if (tab === 'e') { const inv = invById(id); if (!inv) { $('#view').innerHTML = `<div class="card empty"><b>Faktura nenalezena.</b><div class="small"><a href="${base}/faktury">Zpět</a></div></div>`; return; } d = draftOf(inv); }
      else if (id && id.startsWith('c:')) d = newDraft(null, id.slice(2));
      else d = newDraft(id ? invById(id) : null);
      ui.fjDraft = d; ui.fjDraftKey = key;
    }
    const d = ui.fjDraft, editing = tab === 'e';
    const back = editing ? `${base}/f/${d.id}` : `${base}/faktury`;
    $('#view').innerHTML = `
      <div class="row" style="gap:8px;margin-bottom:14px"><a class="btn sm ghost" href="${back}">← Zpět</a></div>
      <div class="card fj-edit"><h1 style="margin:0 0 14px">${editing ? 'Upravit fakturu ' + esc(d.number) : 'Nová faktura'}</h1>
        <div class="grid-2">
          <label class="field"><span>Odběratel</span><select id="fe-client"><option value="">— vyber odběratele —</option>${I().clients.map(x => `<option value="${x.id}" ${x.id === d.client_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="__new">＋ Nový odběratel…</option></select></label>
          <label class="field"><span>Číslo faktury</span><input type="text" id="fe-number" value="${esc(d.number)}"></label>
          <label class="field"><span>Datum vystavení</span><input type="date" id="fe-issued" value="${esc(d.issued)}"></label>
          <label class="field"><span>Datum splatnosti</span><input type="date" id="fe-due" value="${esc(d.due)}"></label>
          <label class="field"><span>Způsob platby</span><select id="fe-pay">${[...new Set([...PAY, d.payment_method])].map(p => `<option ${p === d.payment_method ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
          <label class="field"><span>Variabilní symbol</span><input type="text" inputmode="numeric" id="fe-vs" value="${esc(d.vs)}"></label>
        </div>
        <h3 style="margin:18px 0 8px">Položky</h3>
        <div id="fe-sug" class="fj-sug"></div>
        <div id="fe-items"></div>
        <div class="row" style="justify-content:space-between;align-items:center;margin-top:8px"><button class="btn sm ghost" id="fe-add">＋ Položka</button><div class="fj-total">Celkem <b id="fe-total"></b></div></div>
        <label class="field" style="margin-top:14px"><span>Poznámka na faktuře (nepovinné)</span><input type="text" id="fe-note" value="${esc(d.note)}"></label>
        <div class="grid-2" style="margin-top:12px">
          <label class="field"><span>Stav</span><select id="fe-status"><option value="issued" ${d.status === 'issued' ? 'selected' : ''}>Čeká na úhradu</option><option value="paid" ${d.status === 'paid' ? 'selected' : ''}>Uhrazeno</option><option value="cancelled" ${d.status === 'cancelled' ? 'selected' : ''}>Storno</option></select></label>
          <label class="field" id="fe-paid-f"><span>Datum úhrady</span><input type="date" id="fe-paid" value="${esc(d.paid_at || '')}"></label>
        </div>
        <div class="modal-foot" style="padding:16px 0 0"><a class="btn ghost" href="${back}">Zrušit</a><button class="btn primary" id="fe-save">Uložit fakturu</button></div>
      </div>`;
    const recalc = () => {
      let t = 0; d.items.forEach((it, i) => { const l = lineTotal(it); t += l; const el = document.querySelector(`[data-lt="${i}"]`); if (el) el.textContent = l ? kc2(l) : '—'; });
      $('#fe-total').textContent = kc2(r2(t));
    };
    const drawItems = () => {
      $('#fe-items').innerHTML = `<div class="fj-rows">${d.items.map((it, i) => `<div class="fj-row">
        <textarea rows="1" data-i="${i}" data-f="text" placeholder="Popis položky (další řádek = podrobnost pod položkou)" aria-label="Popis">${esc(it.text)}</textarea>
        <input type="text" inputmode="decimal" data-i="${i}" data-f="qty" value="${esc(it.qty)}" aria-label="Množství" title="Množství">
        <input type="text" data-i="${i}" data-f="unit" value="${esc(it.unit)}" placeholder="ks" aria-label="Jednotka" title="Jednotka">
        <input type="text" inputmode="decimal" data-i="${i}" data-f="price" value="${esc(it.price)}" placeholder="Cena za jednotku" aria-label="Cena" title="Cena za jednotku v Kč">
        <span class="fj-lt tnum" data-lt="${i}">—</span>
        <button class="icon-btn" data-rm="${i}" title="Odebrat položku" aria-label="Odebrat">✕</button></div>`).join('')}</div>`;
      document.querySelectorAll('#fe-items [data-f]').forEach(el => el.oninput = () => { d.items[+el.dataset.i][el.dataset.f] = el.value; recalc(); });
      document.querySelectorAll('#fe-items [data-rm]').forEach(b => b.onclick = () => { if (d.items.length > 1) d.items.splice(+b.dataset.rm, 1); else d.items[0] = { text: '', qty: '1', unit: '', price: '' }; drawItems(); });
      recalc();
    };
    const emptyRow = it => !it.text.trim() && !String(it.price).trim();
    const addItem = u => {
      const row = { text: u.text, qty: String(u.qty ?? 1), unit: u.unit || '', price: String(u.price) };
      const last = d.items[d.items.length - 1];
      if (last && emptyRow(last)) d.items[d.items.length - 1] = row; else d.items.push(row);
      drawItems();
    };
    const drawSug = () => {
      const list = usualItems(d.client_id, d.issued), box = $('#fe-sug');
      box.innerHTML = list.length ? `<div class="small muted" style="margin-bottom:6px">${d.client_id && clientById(d.client_id) ? 'Co ' + esc(clientById(d.client_id).name) + ' obvykle fakturuješ' : 'Často fakturuješ'} — klepnutím přidáš:</div><div class="chips">${list.map((u, i) => `<button type="button" class="chip" data-sug="${i}" title="${esc(u.text)}">${esc(u.text.split('\n')[0].slice(0, 46))}${u.text.split('\n')[0].length > 46 ? '…' : ''} · ${esc(kc(u.price))}</button>`).join('')}</div>` : '';
      box.querySelectorAll('[data-sug]').forEach(b => b.onclick = () => addItem(list[+b.dataset.sug]));
      return list;
    };
    drawItems();
    drawSug();
    $('#fe-add').onclick = () => { d.items.push({ text: '', qty: '1', unit: '', price: '' }); drawItems(); const last = document.querySelectorAll('#fe-items [data-f="text"]'); last[last.length - 1].focus(); };
    const payUi = () => { $('#fe-paid-f').style.display = d.status === 'paid' ? '' : 'none'; };
    payUi();
    $('#fe-client').onchange = e => {
      if (e.target.value === '__new') { e.target.value = d.client_id; return clientModal(null, nid => { d.client_id = nid; c.render(); }); }
      d.client_id = e.target.value;
      const list = drawSug();
      if (!editing && d.items.length === 1 && emptyRow(d.items[0]) && list[0]) addItem(list[0]);   // předvyplň nejčastější položku
    };
    $('#fe-number').oninput = e => { d.number = e.target.value.trim(); d.numAuto = false; if (d.vsAuto) { d.vs = vsOf(d.number); $('#fe-vs').value = d.vs; } };
    $('#fe-vs').oninput = e => { d.vs = e.target.value.replace(/\D/g, '').slice(0, 10); d.vsAuto = false; };
    $('#fe-issued').onchange = e => {
      d.issued = e.target.value || todayIso();
      if (d.numAuto) { d.number = nextNumber(d.issued); $('#fe-number').value = d.number; if (d.vsAuto) { d.vs = vsOf(d.number); $('#fe-vs').value = d.vs; } }
      if (d.dueAuto) { d.due = addDays(d.issued, I().settings.due_days); $('#fe-due').value = d.due; }
      drawSug();
    };
    $('#fe-due').onchange = e => { d.due = e.target.value; d.dueAuto = false; };
    $('#fe-pay').onchange = e => { d.payment_method = e.target.value; };
    $('#fe-note').oninput = e => { d.note = e.target.value; };
    $('#fe-status').onchange = e => { d.status = e.target.value; if (d.status === 'paid' && !d.paid_at) { d.paid_at = todayIso(); $('#fe-paid').value = d.paid_at; } payUi(); };
    $('#fe-paid').onchange = e => { d.paid_at = e.target.value; };
    $('#fe-save').onclick = () => saveDraft(d, editing);
  }
  function saveDraft(d, editing) {
    const cl = clientById(d.client_id);
    if (!cl) return toast('Vyber odběratele');
    if (!d.number) return toast('Doplň číslo faktury');
    if (I().invoices.some(i => i.number === d.number && i.id !== d.id)) return toast(`Faktura s číslem ${d.number} už existuje`);
    if (!d.issued || !d.due) return toast('Doplň data');
    if (d.due < d.issued) return toast('Splatnost nemůže být před vystavením');
    const items = [];
    for (const it of d.items) {
      if (!it.text.trim() && !String(it.price).trim()) continue;
      const qty = toNum(it.qty) ?? 1, price = toNum(it.price);
      if (!it.text.trim()) return toast('Doplň popis u každé položky');
      if (price == null || !isFinite(price) || !isFinite(qty)) return toast('Množství a cena musí být čísla');
      items.push({ text: it.text.trim(), qty, unit: it.unit.trim(), price });
    }
    if (!items.length) return toast('Přidej aspoň jednu položku');
    if (d.status === 'paid' && !d.paid_at) return toast('Doplň datum úhrady');
    const s = I().settings;
    const row = { number: d.number, client_id: cl.id, issued: d.issued, due: d.due, payment_method: d.payment_method, vs: d.vs, items, total: r2(items.reduce((t, it) => t + lineTotal(it), 0)), status: d.status, paid_at: d.status === 'paid' ? d.paid_at : null, note: d.note.trim(), updated_at: new Date().toISOString() };
    const old = editing ? invById(d.id) : null;
    if (!old || old.client_id !== cl.id) Object.assign(row, { client_name: cl.name, client_address: cl.address, client_ico: cl.ico, client_dic: cl.dic });
    if (!old || !old.supplier) row.supplier = { name: s.name, address: s.address, ico: s.ico, dic: s.dic, bank_account: s.bank_account, footer_note: s.footer_note, email: s.email, phone: s.phone };
    ui.fjDraft = null;
    act(async () => {
      let nid = d.id;
      if (editing) ok(await sb.from('invoices').update(row).eq('id', d.id));
      else nid = ok(await sb.from('invoices').insert(row).select().single()).id;
      if (row.status !== 'issued') { try { await SJCalendar.remove('faktura:' + nid); } catch {} }
      await c.loadState(); await syncCal();
      return nid;
    }, 'Uloženo ✓').then(nid => { if (nid) location.hash = `${base}/f/${nid}`; });
  }

  // ---------- detail + papír ----------
  function paperHtml(inv) {
    const sup = inv.supplier || I().settings, st = eff(inv);
    const spd = inv.status === 'issued' && isTransfer(inv.payment_method) ? spdString(inv, sup) : '';
    const multi = inv.items.some(it => (+it.qty || 1) !== 1 || it.unit);
    return `<article class="fj-paper" id="fj-paper">
      ${inv.status === 'cancelled' ? '<div class="fj-stamp">STORNO</div>' : ''}
      <img src="logo.png" alt="" class="fj-p-logo" width="84" height="84">
      <div class="fj-p-top"><h2 class="fj-p-h">Faktura ${esc(inv.number)}</h2>
        <div class="fj-p-amt"><span class="k">Částka k úhradě</span><b>${esc(kc2(inv.total))}</b></div></div>
      <div class="fj-p-meta"><dl>
          <dt>Bankovní účet</dt><dd>${esc(sup.bank_account || '—')}</dd>
          <dt>Variabilní symbol</dt><dd>${esc(inv.vs || '—')}</dd>
          <dt>Způsob platby</dt><dd>${esc(inv.payment_method)}</dd></dl>
        <dl><dt>Datum vystavení</dt><dd>${esc(D(inv.issued))}</dd><dt>Datum splatnosti</dt><dd>${esc(D(inv.due))}</dd>${inv.status === 'paid' && inv.paid_at ? `<dt>Uhrazeno</dt><dd>${esc(D(inv.paid_at))}</dd>` : ''}</dl></div>
      <table class="fj-p-items"><thead><tr><th>Fakturujeme vám následující</th><th class="r">Celkem</th></tr></thead><tbody>
        ${inv.items.map(it => `<tr><td>${esc(it.text.split('\n')[0])}${it.text.includes('\n') ? `<div class="q pl">${esc(it.text.split('\n').slice(1).join('\n'))}</div>` : ''}${multi ? `<div class="q">${esc(nf2.format(+it.qty || 1).replace(',00', ''))}${it.unit ? NB + esc(it.unit) : ''} × ${esc(kc2(it.price))}</div>` : ''}</td><td class="r">${esc(kc2(lineTotal(it)))}</td></tr>`).join('')}</tbody></table>
      ${inv.note ? `<div class="fj-p-note">${esc(inv.note)}</div>` : ''}
      <div class="fj-p-sum">${spd ? `<div class="fj-p-qr"><div class="qr">${qrSvg(spd)}</div><span>QR platba</span></div>` : '<span></span>'}
        <div class="fj-p-tot"><span class="k">Celkem</span><b>${esc(kc2(inv.total))}</b></div></div>
      <table class="fj-p-foot"><tbody>
        <tr><th>Dodavatel</th><td><b>${esc(sup.name)}</b>, ${esc(sup.address)}</td><td>${sup.ico ? 'IČO: ' + esc(sup.ico) : ''}</td><td>${sup.dic ? 'DIČ: ' + esc(sup.dic) : esc(String(sup.footer_note || '').toUpperCase())}</td></tr>
        <tr><th>Odběratel</th><td><b>${esc(inv.client_name)}</b>, ${esc(inv.client_address)}</td><td>${inv.client_ico ? 'IČO: ' + esc(inv.client_ico) : ''}</td><td>${inv.client_dic ? 'DIČ: ' + esc(inv.client_dic) : ''}</td></tr></tbody></table>
      ${sup.dic && sup.footer_note ? `<div class="fj-p-fn">${esc(sup.footer_note)}</div>` : ''}
    </article>`;
  }
  function renderDetail(id) {
    const inv = invById(id);
    if (!inv) { $('#view').innerHTML = `<div class="card empty"><div class="big">🧾</div><b>Faktura nenalezena.</b><div class="small"><a href="${base}/faktury">Zpět na faktury</a></div></div>`; return; }
    const cl = clientById(inv.client_id), st = eff(inv);
    const mail = `mailto:${encodeURIComponent(cl?.email || '')}?subject=${encodeURIComponent('Faktura ' + inv.number)}&body=${encodeURIComponent(`Dobrý den,\n\nv příloze posílám fakturu ${inv.number} na částku ${kc2(inv.total)}, splatnost ${D(inv.due)}.\n\nDěkuji,\n${(inv.supplier || I().settings).name}`)}`;
    $('#view').innerHTML = `
      <div class="fj-bar-top fj-noprint">
        <div class="row" style="gap:8px;flex-wrap:wrap"><a class="btn sm ghost" href="${base}/faktury">← Faktury</a><span class="grow"></span>
          ${badge(inv)}</div>
        <div class="row" style="gap:8px;flex-wrap:wrap;margin:10px 0 14px">
          <button class="btn sm primary" id="fd-print">🖨 Tisk / uložit PDF</button>
          <a class="btn sm" href="${mail}">✉ E-mail</a>
          ${inv.status === 'issued' ? '<button class="btn sm" id="fd-paid">✓ Uhrazeno</button>' : ''}
          ${inv.status === 'paid' ? '<button class="btn sm ghost" id="fd-unpaid">Zrušit úhradu</button>' : ''}
          <a class="btn sm ghost" href="${base}/e/${inv.id}">Upravit</a>
          <a class="btn sm ghost" href="${base}/nova/${inv.id}">Duplikovat</a>
          ${inv.status === 'cancelled' ? '<button class="btn sm ghost" id="fd-restore">Obnovit</button><button class="btn sm ghost" id="fd-del" style="color:var(--bad)">Smazat</button>' : '<button class="btn sm ghost" id="fd-cancel" style="color:var(--bad)">Storno</button>'}
        </div>
        ${cl ? `<div class="small muted" style="margin-bottom:10px">Odběratel: <a href="${base}/o/${cl.id}">${esc(cl.name)}</a>${inv.status === 'paid' && inv.paid_at ? ` · uhrazeno ${esc(D(inv.paid_at))}` : ''}</div>` : ''}
      </div>
      <div class="fj-sheet">${paperHtml(inv)}</div>`;
    const upd = (patch, msg) => act(async () => { ok(await sb.from('invoices').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', inv.id)); if (patch.status && patch.status !== 'issued') { try { await SJCalendar.remove('faktura:' + inv.id); } catch {} } await c.loadState(); await syncCal(); }, msg);
    $('#fd-print').onclick = () => print(inv);
    if ($('#fd-paid')) $('#fd-paid').onclick = () => {
      modal(380, `<div class="modal-head"><h2>Faktura ${esc(inv.number)} uhrazena</h2><button class="icon-btn" data-close>✕</button></div>
        <label class="field"><span>Datum úhrady</span><input type="date" id="fp-date" value="${todayIso()}"></label>
        <div class="modal-foot"><button class="btn ghost" data-close>Zrušit</button><button class="btn primary" id="fp-ok">Uložit</button></div>`);
      $('#fp-ok').onclick = () => { const v = $('#fp-date').value || todayIso(); closeModal(); upd({ status: 'paid', paid_at: v }, 'Uhrazeno ✓'); };
    };
    if ($('#fd-unpaid')) $('#fd-unpaid').onclick = () => upd({ status: 'issued', paid_at: null }, 'Úhrada zrušena');
    if ($('#fd-cancel')) $('#fd-cancel').onclick = () => { if (confirm(`Stornovat fakturu ${inv.number}? Číslo zůstane obsazené a do limitu obratu se nezapočítá.`)) upd({ status: 'cancelled', paid_at: null }, 'Stornováno'); };
    if ($('#fd-restore')) $('#fd-restore').onclick = () => upd({ status: 'issued' }, 'Obnoveno');
    if ($('#fd-del')) $('#fd-del').onclick = () => { if (!confirm(`Smazat stornovanou fakturu ${inv.number} natrvalo? Číslo ${inv.number} pak zůstane v číselné řadě volné — v účetnictví to obvykle není žádoucí.`)) return; act(async () => { ok(await sb.from('invoices').delete().eq('id', inv.id)); try { await SJCalendar.remove('faktura:' + inv.id); } catch {} }, 'Smazáno').then(() => { location.hash = base + '/faktury'; }); };
  }
  function print(inv) {
    const t = document.title; document.title = `Faktura ${inv.number}`; document.body.classList.add('fj-print');
    const done = () => { document.body.classList.remove('fj-print'); document.title = t; removeEventListener('afterprint', done); };
    addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  }

  return { render: renderApp, crumb, counts, attention, hubBadges, syncCal };
}
