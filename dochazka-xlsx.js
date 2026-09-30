// SmartJoi · DocházkoBot — „Evidence pracovní doby“ pro účetní (ExcelJS, podle předlohy)
import { MONTH_NAMES, hours } from './dochazka-core.js';

const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
let _ex = null;
export function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return _ex ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = EXCELJS_URL; s.onload = () => res(window.ExcelJS); s.onerror = () => { _ex = null; rej(new Error('Nepodařilo se načíst knihovnu pro Excel')); };
    document.head.appendChild(s);
  });
}
const T = m => m == null ? null : m / 1440;             // minuty → Excel čas
const F_TIME = 'h:mm;@', F_DUR = '[h]:mm;;', F_SUM = '[h]:mm', F_NUM = '#,##0.00';
const LAV = 'FFE6D5F3', GREY = 'FFD9D9D9', HOL = 'FFFFF2CC';
const thin = { style: 'thin' }, box = { top: thin, left: thin, bottom: thin, right: thin };

export function addAttendanceSheet(wb, comp, emp, sheetName) {
  const [Y, M] = comp.month.split('-').map(Number);
  const S = comp.sum;
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
  ws.columns = [9.5, 8.5, 7.5, 7.5, 7, 7, 6.5, 7.5, 8, 7, 7, 7, 7, 7.5, 8, 7, 8, 8.5, 8, 34].map(w => ({ width: w }));
  const font = (c, o = {}) => { c.font = { name: 'Arial', size: 8, ...o }; };
  const set = (addr, v, o = {}) => { const c = ws.getCell(addr); c.value = v; font(c, { size: o.size || 9, bold: !!o.bold }); if (o.fmt) c.numFmt = o.fmt; if (o.align) c.alignment = { horizontal: o.align, vertical: 'middle', wrapText: !!o.wrap }; return c; };

  // hlavička
  ws.mergeCells('A1:T1'); set('A1', 'EVIDENCE PRACOVNÍ DOBY', { bold: true, size: 11, align: 'center' });
  ws.getRow(2).height = 10;
  set('A3', 'Označení zaměstnavatele:'); set('E3', emp.employer || '');
  set('N3', 'ROK:', { align: 'right' }); set('O3', Y, { bold: true, align: 'left' });
  set('Q3', 'Měsíc:', { align: 'right' }); set('R3', MONTH_NAMES[M - 1], { bold: true });
  set('A4', 'Jméno a příjmení zaměstnance:'); set('E4', emp.name, { bold: true });
  set('N4', 'Svátky:', { align: 'right' }); set('O4', S.holidays || 0, { align: 'left' });
  set('Q4', 'Pracovních dnů:', { align: 'right' }); set('R4', S.workdays, { align: 'left' });
  set('A5', 'Pracovní poměr:'); set('E5', emp.contract || 'HPP');
  set('N5', 'Odpracováno dnů o víkendu:', { align: 'right' }); set('O5', S.weekendWorked, { align: 'left' });
  set('Q5', 'Odprac. prac. dnů:', { align: 'right' });
  set('A6', 'Týdenní pracovní doba:'); set('E6', `${String(emp.weekly_hours ?? 40).replace('.', ',')} h`);
  set('Q6', 'Přestávka na oběd:', { align: 'right' }); set('R6', T(Number(emp.lunch_minutes ?? 30)), { fmt: 'h:mm', align: 'left' });
  ws.getRow(7).height = 8;

  // záhlaví tabulky
  const H = (addr, text, o = {}) => { const c = ws.getCell(addr); c.value = text; font(c, { bold: o.bold !== false }); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = box; if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } }; };
  for (const [col, text] of [['A', 'Datum'], ['B', 'Den'], ['C', 'Začátek výkonu práce'], ['D', 'Konec výkonu práce'], ['G', 'Fond'], ['H', 'Čas v práci'], ['I', 'Odprac. hodin netto'], ['O', 'Dovolená'], ['P', 'Nemoc'], ['Q', 'Návštěva lékaře'], ['R', 'Chybí odpracovat'], ['S', 'Jiná placená překážka'], ['T', 'Poznámka']]) {
    ws.mergeCells(`${col}8:${col}9`); H(`${col}8`, text);
  }
  ws.mergeCells('E8:F8'); H('E8', 'Přestávka na oběd'); H('E9', 'Začátek', { bold: false }); H('F9', 'Konec', { bold: false });
  ws.mergeCells('J8:N8'); H('J8', 'Přesčas', { fill: LAV });
  H('J9', 'Začátek', { bold: false }); H('K9', 'Konec', { bold: false }); H('L9', 'Začátek', { bold: false }); H('M9', 'Konec', { bold: false }); H('N9', 'Celkem', { fill: LAV });
  ws.getRow(8).height = 19; ws.getRow(9).height = 19;

  // dny
  let r = 10;
  const cols = 'ABCDEFGHIJKLMNOPQRST'.split('');
  for (const d of comp.days) {
    const n = Math.max(1, d.segs.length), r0 = r;
    const fill = d.holiday ? HOL : d.weekend ? GREY : null;
    for (let i = 0; i < n; i++, r++) {
      ws.getRow(r).height = 13.25;
      for (const c of cols) { const cell = ws.getCell(`${c}${r}`); font(cell, { bold: c === 'A' || c === 'B' }); cell.border = box; cell.alignment = { horizontal: c === 'A' || c === 'B' || c === 'T' ? 'left' : 'center', vertical: 'middle' }; if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }; }
      const s = d.segs[i];
      if (s) { ws.getCell(`C${r}`).value = T(s.s); ws.getCell(`D${r}`).value = T(s.e); }
      for (const c of 'CDEFJKLM') ws.getCell(`${c}${r}`).numFmt = F_TIME;
      for (const c of 'GHINOPQRS') ws.getCell(`${c}${r}`).numFmt = F_DUR;
      // hodnoty (ne vzorce) — spočítá je aplikace; vzorce s časy nefungovaly v Numbers a v náhledech
      const len = s ? s.e - s.s : 0;
      ws.getCell(`H${r}`).value = T(len);
      ws.getCell(`I${r}`).value = T(Math.max(0, len - (i === 0 && d.lunch ? d.lunch.e - d.lunch.s : 0)));
    }
    const setV = (c, v) => { if (v) ws.getCell(`${c}${r0}`).value = T(v); };
    ws.getCell(`A${r0}`).value = new Date(Date.UTC(...d.date.split('-').map((x, i) => i === 1 ? +x - 1 : +x))); ws.getCell(`A${r0}`).numFmt = 'd.m.yyyy';
    ws.getCell(`B${r0}`).value = d.dayName;
    if (d.lunch) { ws.getCell(`E${r0}`).value = T(d.lunch.s); ws.getCell(`F${r0}`).value = T(d.lunch.e); }
    setV('G', d.fund);
    if (d.blocks[0]) { ws.getCell(`J${r0}`).value = T(d.blocks[0][0]); ws.getCell(`K${r0}`).value = T(d.blocks[0][1]); }
    if (d.blocks[1]) { ws.getCell(`L${r0}`).value = T(d.blocks[1][0]); ws.getCell(`M${r0}`).value = T(d.blocks[1][1]); }
    ws.getCell(`N${r0}`).value = T(d.over || 0);
    setV('O', d.vac); setV('P', d.sick); setV('Q', d.doc); setV('R', d.missing); setV('S', d.other);
    if (d.notes.length) ws.getCell(`T${r0}`).value = d.notes.join('; ');
    if (n > 1) for (const c of ['A', 'B', 'E', 'F', 'G', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T']) ws.mergeCells(`${c}${r0}:${c}${r - 1}`);
  }
  const last = r - 1;

  // souhrn
  let s = last + 4;
  set(`A${s}`, 'SOUHRN', { bold: true }); s += 2;
  const row = (label, minutes, o = {}) => {
    ws.mergeCells(`A${s}:D${s}`); ws.mergeCells(`E${s}:F${s}`);
    const a = set(`A${s}`, label, { align: 'left', wrap: true }); a.border = box;
    const e = ws.getCell(`E${s}`); e.value = T(minutes || 0); e.numFmt = F_SUM; font(e, { size: 9 }); e.border = box; e.alignment = { horizontal: 'left', vertical: 'middle' };
    if (o.fill) for (const c of [a, e]) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
    if (o.dec) { const g = ws.getCell(`G${s}`); g.value = hours(minutes || 0); g.numFmt = F_NUM; font(g, { size: 9 }); g.alignment = { horizontal: 'right', vertical: 'middle' }; }
    ws.getRow(s).height = 27; return s++;
  };
  row('Fond pracovní doby celkem:', S.fund);
  row('Čas v práci celkem:', S.work);
  row('Celkem odpracováno hodin včetně přesčasů:', S.netto);
  row('Odpracováno v pracovní dny včetně přesčasů celkem:', S.netto - S.nettoWeekend);
  row('Odpracováno o víkendu a ve svátek celkem:', S.nettoWeekend);
  s += 2; set(`A${s}`, 'SOUHRN PRO ÚČETNÍ', { bold: true }); s += 2;
  row('Odpracováno:', S.worked, { dec: true });
  row('Odpracováno včetně svátků a přesčasů:', S.workedTotal, { dec: true });
  row('Přesčas celkem:', S.over, { dec: true, fill: LAV });
  row('Přesčas v pracovní dny:', S.overWorkdays, { dec: true });
  row('Přesčas o víkendu a ve svátek:', S.overWeekend, { dec: true });
  row('Dovolená:', S.vac, { dec: true });
  row('Nemoc:', S.sick, { dec: true });
  row('Návštěva lékaře:', S.doc, { dec: true });
  row('Chybějící odpracovaný čas:', S.missing, { dec: true });
  row('Jiná placená překážka:', S.other, { dec: true });
  row('Státní svátky (placené):', S.holiday, { dec: true });
  const r5 = ws.getCell('R5'); r5.value = S.workedDays; r5.numFmt = F_NUM; font(r5, { size: 9, bold: true }); r5.alignment = { horizontal: 'left' };
  ws.views = [{ state: 'frozen', ySplit: 9 }];
  return ws;
}

export async function downloadWorkbook(fileName, build) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook(); wb.creator = 'SmartJoi · DocházkoBot'; wb.created = new Date();
  build(wb);
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
