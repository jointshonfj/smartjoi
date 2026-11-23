// Vinylor Hub · PDF nabídky (pdfmake, generuje se přímo v prohlížeči)
// Čisté minimalistické rozložení: logo + titulek, dodavatel/odběratel, položky, rekapitulace DPH, podmínky.
const PDFMAKE = 'vendor/pdfmake.min.js'; // knihovny jsou přímo v aplikaci (žádný cizí server)
const FONTS = 'vendor/vfs_fonts.js';
const INK = '#1a1a1a';
const GREY = '#6b6b6b';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error('Nepodařilo se načíst ' + src)); };
    document.head.appendChild(s);
  });
}
// při výpadku sítě zkusí načtení ještě 2× znovu (s jiným parametrem, ať se nepoužije chybná kopie z mezipaměti)
async function loadWithRetry(src) {
  for (let i = 0; ; i++) {
    try { return await loadScript(i ? `${src}?r=${Date.now()}` : src); }
    catch (e) { if (i >= 2) throw e; await new Promise(r => setTimeout(r, 600 * (i + 1))); }
  }
}
let ready = null;
function ensurePdfMake() {
  if (!ready) {
    ready = (window.pdfMake && window.pdfMake.vfs ? Promise.resolve() : loadWithRetry(PDFMAKE).then(() => loadWithRetry(FONTS)))
      .catch(e => { ready = null; throw e; }); // neúspěch se nepamatuje, další pokus začne znovu
  }
  return ready;
}
const images = {};
async function dataUrl(path) {
  if (images[path]) return images[path];
  const blob = await (await fetch(path)).blob();
  images[path] = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  return images[path];
}
const czDots = s => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}. ${m}. ${y}`; };
const czLong = s => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${Number(d)}. ${Number(m)}. ${y}`; };

function buildDoc(o, settings, issuer, logo) {
  const C = window.Calc, M = C.money;
  const sup = settings.supplier || {};
  const c = o.customer || {};
  const eur = o.currency === 'EUR'; const CUR = eur ? '€' : 'Kč';
  const t = C.totals(o, eur ? 0.01 : settings.priceStep);
  const terms = String(o.terms || '').replace(/\{platnost\}/g, czLong(o.validUntil));
  const COLW = 237;

  const rule = (w, h = 0.8, color = INK) => ({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: w, y2: 0, lineWidth: h, lineColor: color }] });
  const label = text => ({ text: text.toUpperCase(), fontSize: 8, color: GREY, characterSpacing: 0.4, margin: [0, 7, 0, 6] });
  const kv = (k, v) => ({ columns: [{ text: k, color: GREY, width: 'auto' }, { text: v, alignment: 'right' }], margin: [0, 0, 0, 2] });
  const party = (title, name, sub, lines, rows) => ({
    width: COLW,
    stack: [
      rule(14, 0.8, INK), label(title),
      { text: name || ' ', fontSize: 11.5 },
      ...(sub ? [{ text: sub, color: GREY, margin: [0, 1, 0, 0] }] : []),
      ...lines.filter(Boolean).map(x => ({ text: x, color: GREY, margin: [0, 1, 0, 0] })),
      { text: ' ', fontSize: 8 },
      ...rows.filter(r => r[1]).map(r => kv(r[0], r[1])),
    ],
  });

  // ---- hlavička: logo | titulek + data ----
  const header = {
    columns: [
      { width: '*', image: logo, fit: [78, 78], margin: [-6, -4, 0, 0] },
      { width: COLW, stack: [
        rule(COLW, 2.4, INK),
        { text: 'Nabídka ' + o.number, fontSize: 21, bold: true, margin: [0, 12, 0, 12] },
        kv('Datum vytvoření', czDots(o.date)),
        kv('Platí do', czDots(o.validUntil)),
      ] },
    ],
    columnGap: 41,
  };

  // ---- dodavatel | odběratel ----
  const parties = {
    margin: [0, 26, 0, 0],
    columnGap: 41,
    columns: [
      party('Dodavatel', sup.company, '', [sup.street, sup.city], [
        ['IČO', sup.ico], ['DIČ', sup.dic], ['Telefon', sup.phone], ['Mobil', sup.mobile], ['E-mail', sup.email], ['Účet', eur ? (sup.bankEur || sup.bank) : sup.bank],
      ]),
      party('Odběratel', c.company || c.name, c.company && c.name ? c.name : '', [c.street, c.city, c.country && c.country !== 'Česká republika' ? c.country : ''], [
        ['IČO', c.ico], ['DIČ', c.dic], ['Telefon', c.phone], ['E-mail', c.email],
      ]),
    ],
  };
  const recipient = o.recipient && o.recipient.trim() ? {
    columns: [{ width: '*', text: '' }, { width: COLW, stack: [label('Konečný příjemce'), { text: o.recipient, color: GREY }] }], margin: [0, 2, 0, 0],
  } : null;

  // ---- úvodní poznámka (vidí zákazník) ----
  const intro = o.note && o.note.trim() ? { text: o.note, italics: true, color: GREY, margin: [0, 18, 0, 0] } : { text: '', margin: [0, 8, 0, 0] };

  // ---- položky ----
  const th = (text, align = 'right') => ({ text: text.toUpperCase(), fontSize: 8, color: GREY, alignment: align, characterSpacing: 0.3 });
  const body = [[th('Položka', 'left'), th('Množství'), th('J. cena'), th('Sleva'), th('DPH'), th('Cena')]];
  (o.items || []).forEach((it, i) => {
    const l = t.lines[i];
    body.push([
      { stack: [
        { text: `${it.name || ''}${it.variant ? ', ' + it.variant : ''}` },
        it.code ? { text: it.code, fontSize: 7.5, color: GREY, margin: [0, 1, 0, 0] } : '',
      ] },
      { text: `${C.qtyFmt(it.qty)} ${it.unit || ''}`, alignment: 'right', noWrap: true },
      { text: M(l.unitNet) + ' ' + CUR, alignment: 'right', noWrap: true },
      { text: Number(it.discount) ? C.qtyFmt(it.discount) + ' %' : '—', alignment: 'right', noWrap: true, color: Number(it.discount) ? INK : GREY },
      { text: C.qtyFmt(it.vatRate) + ' %', alignment: 'right', noWrap: true },
      { text: M(l.net) + ' ' + CUR, alignment: 'right', noWrap: true },
    ]);
  });
  if (!(o.items || []).length) body.push([{ text: 'Bez položek', color: GREY, colSpan: 6 }, '', '', '', '', '']);
  const items = {
    margin: [0, 16, 0, 0],
    table: { headerRows: 1, dontBreakRows: true, widths: ['*', 52, 66, 40, 34, 74], body },
    layout: {
      hLineWidth: (i, node) => (i === 1 || i === node.table.body.length ? 0.8 : 0),
      hLineColor: () => '#b8b8b8', vLineWidth: () => 0,
      paddingLeft: i => (i === 0 ? 0 : 6), paddingRight: (i, node) => (i === node.table.widths.length - 1 ? 0 : 6),
      paddingTop: () => 3.5, paddingBottom: () => 3.5,
    },
  };
  const netNote = { text: 'Ceny položek jsou uvedeny bez DPH.', fontSize: 7.5, color: GREY, alignment: 'right', margin: [0, 4, 0, 0] };

  // ---- rekapitulace DPH a celkem ----
  const rates = {};
  (o.items || []).forEach((it, i) => { const k = it.vatRate; rates[k] = rates[k] || { net: 0, tax: 0 }; rates[k].net += t.lines[i].net; rates[k].tax += t.lines[i].tax; });
  const recapBody = [[th('Sazba', 'left'), th('Základ'), th('DPH')]];
  for (const [rate, v] of Object.entries(rates)) recapBody.push([C.qtyFmt(rate) + ' %', { text: M(C.r2(v.net)) + ' ' + CUR, alignment: 'right' }, { text: M(C.r2(v.tax)) + ' ' + CUR, alignment: 'right' }]);
  const totals = {
    margin: [0, 14, 0, 0],
    unbreakable: true,
    columns: [
      { width: '*', text: '' },
      { width: 250, stack: [
        { table: { widths: ['*', 90, 80], body: recapBody }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: i => (i === 0 ? 0 : 4), paddingRight: (i, n) => (i === n.table.widths.length - 1 ? 0 : 4), paddingTop: () => 3, paddingBottom: () => 3 } },
        { margin: [0, 6, 0, 0], ...rule(250, 2, '#444') },
        { columns: [
          { text: 'Celkem k úhradě', color: GREY, margin: [0, 9, 0, 0] },
          { text: M(t.total) + ' ' + CUR, fontSize: 19, bold: true, alignment: 'right', margin: [0, 4, 0, 0] },
        ] },
      ] },
    ],
  };

  // ---- podmínky + vystavil ----
  const termsBlock = [settings.agreeLine, terms].filter(x => x && x.trim()).join('\n');
  const issuerRows = issuer ? [issuer.name, issuer.phone && 'Tel.: ' + issuer.phone, issuer.contact_email].filter(Boolean) : [];
  const tail = {
    margin: [0, 22, 0, 0],
    columns: [
      { width: '*', stack: termsBlock ? [rule(14), label('Podmínky'), { text: termsBlock, fontSize: 8.5, color: GREY, lineHeight: 1.25 }] : [] },
      ...(issuerRows.length ? [{ width: 150, stack: [rule(14), label('Vystavil'), { text: issuerRows[0] }, ...issuerRows.slice(1).map(x => ({ text: x, color: GREY, margin: [0, 1, 0, 0] }))] }] : []),
    ],
    columnGap: 40,
  };

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 46],
    info: { title: 'Nabídka ' + o.number, author: sup.company || 'Vinylor' },
    defaultStyle: { font: 'Roboto', fontSize: 9.5, color: INK, lineHeight: 1.15 },
    content: [header, parties, recipient, intro, items, netNote, totals, tail].filter(Boolean),
    footer: (page, pages) => ({
      margin: [40, 14, 40, 0], fontSize: 7.5, color: GREY,
      columns: [
        [sup.company, sup.ico && 'IČO ' + sup.ico, sup.web, sup.email].filter(Boolean).join('  ·  '),
        { text: pages > 1 ? `Strana ${page} / ${pages}` : '', alignment: 'right' },
      ],
    }),
  };
}

// mode: 'download' | 'open' (win = okno otevřené hned po kliknutí, kvůli blokování vyskakovacích oken)
export async function offerPdf(o, settings, issuer, mode, win) {
  await ensurePdfMake();
  const logo = await dataUrl('img/logo.png');
  const pdf = window.pdfMake.createPdf(buildDoc(o, settings, issuer, logo));
  if (mode === 'open') pdf.open({}, win);
  else pdf.download(`Nabidka_${o.number}.pdf`);
}
