// SmartJoi · DocházkoBot — „Evidence pracovní doby“ pro účetní (ExcelJS, věrně podle předlohy od účetní)
// Hodnoty spočítá aplikace (dochazka-core.js) a zapíšou se jako čísla — bez vzorců, aby soubor ukazoval
// správné součty v Excelu, Numbers, náhledu i v chráněném zobrazení.
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
const F_TIME = 'h:mm;@', F_LUNCH = 'h:mm', F_SUM = '[h]:mm:ss;@', F_NUM = '#,##0.00', F_DATE = 'mm-dd-yy'; // mm-dd-yy = vestavěné „krátké datum“ (v CZ Excelu 1.8.2026)
// barvy z předlohy (motiv Office)
const LAV = 'FFE6D5F3', GREEN = 'FFE2EFDA', BLUE = 'FFD9E1F2', YELLOW = 'FFFFF2CC', WEEKEND = 'FFF2F2F2', GREY = 'FFD9D9D9', HOL = 'FFFFF2CC';
const RED_T = 'FFC00000', BLUE_T = 'FF0070C0', RED = 'FFFF0000';
const thin = { style: 'thin' }, dbl = { style: 'double' }, box = { top: thin, left: thin, bottom: thin, right: thin };
const fillOf = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

export function addAttendanceSheet(wb, comp, emp, sheetName) {
  const [Y, M] = comp.month.split('-').map(Number);
  const S = comp.sum;
  const hasOther = S.other > 0, hasNotes = comp.days.some(d => d.notes.length);
  // sloupce A–R jako předloha; S (jiná překážka) a T (poznámka) jen když jsou potřeba
  const lastCol = hasNotes ? 'T' : hasOther ? 'S' : 'R';
  const ALL = 'ABCDEFGHIJKLMNOPQRST';
  const cols = ALL.slice(0, ALL.indexOf(lastCol) + 1).split('');
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
  ws.columns = cols.map(c => ({ width: { A: 8.83, B: 7, J: 7, R: 8.83, S: 9, T: 30 }[c] || 8.43 }));
  const font = (c, o = {}) => { c.font = { name: 'Arial', size: 8, ...o }; };
  const set = (addr, v, o = {}) => {
    const c = ws.getCell(addr); c.value = v;
    font(c, { size: o.size || 9, bold: !!o.bold, underline: !!o.underline, ...(o.color ? { color: { argb: o.color } } : {}) });
    if (o.fmt) c.numFmt = o.fmt;
    if (o.align || o.valign || o.wrap) c.alignment = { horizontal: o.align, vertical: o.valign, wrapText: !!o.wrap };
    if (o.fill) c.fill = fillOf(o.fill);
    return c;
  };

  // hlavička
  ws.mergeCells(`A1:${lastCol === 'T' ? 'T' : 'R'}1`); set('A1', 'EVIDENCE PRACOVNÍ DOBY', { bold: true, underline: true, size: 11, align: 'center', valign: 'top' });
  ws.getRow(2).height = 10.25;
  for (const r of [3, 4, 5, 6]) ws.getRow(r).height = 13.25;
  for (const r of [4, 5, 6]) ws.mergeCells(`A${r}:D${r}`);
  set('A3', 'Označení  zaměstnavatele: ', { align: 'left' }); set('E3', emp.employer || '', { align: 'left' });
  set('N3', 'ROK:', { align: 'right' }); set('O3', Y, { bold: true, align: 'left' });
  set('Q3', 'Měsíc:', { align: 'right' }); set('R3', MONTH_NAMES[M - 1], { bold: true, size: 8 });
  set('A4', 'Jméno a příjmení zaměstnance: ', { align: 'left' }); set('E4', emp.name, { bold: true });
  set('N4', 'Svátky:', { align: 'right', valign: 'top' }); set('O4', S.holidays || null, { align: 'left', valign: 'top' });
  set('Q4', 'Pracovních dnů:', { align: 'right' }); set('R4', S.workdays, { align: 'left' });
  set('A5', 'Pracovní poměr:', { align: 'left' }); set('E5', emp.contract || 'HPP');
  set('N5', 'Odpracováno dnů o víkendu:', { align: 'right', valign: 'top' }); set('O5', S.weekendWorked, { align: 'left', valign: 'top' });
  set('P5', null, { fill: GREEN }); set('Q5', 'Odprac. prac. dnů:', { align: 'right', fill: GREEN }); set('R5', S.workedDays, { bold: true, align: 'left', fmt: F_NUM, fill: GREEN });
  set('A6', 'Týdenní pracovní doba:  ', { align: 'left' }); set('E6', `${String(emp.weekly_hours ?? 40).replace('.', ',')} h`, { align: 'left' });
  set('Q6', 'Přestávka na oběd:', { align: 'right' }); set('R6', T(Number(emp.lunch_minutes ?? 30)), { fmt: F_LUNCH, align: 'left' });
  ws.getRow(7).height = 8.25;

  // záhlaví tabulky
  const H = (addr, text, o = {}) => { const c = ws.getCell(addr); c.value = text; font(c, { bold: o.bold !== false }); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = o.dbl ? { ...box, bottom: dbl } : box; if (o.fill) c.fill = fillOf(o.fill); };
  const heads = [['A', 'Datum'], ['B', 'Den'], ['C', 'Začátek výkonu práce'], ['D', 'Konec výkonu práce'], ['G', 'Fond'], ['H', 'Čas v práci'], ['I', 'Odprac. hodin netto', GREEN], ['O', 'Dovolená', BLUE], ['P', 'Nemoc', YELLOW], ['Q', 'Návštěva lékaře'], ['R', 'Chybí odpracovat']];
  if (hasOther) heads.push(['S', 'Jiná placená překážka']);
  if (hasNotes) heads.push(['T', 'Poznámka']);
  for (const [col, text, fill] of heads) { ws.mergeCells(`${col}8:${col}9`); H(`${col}8`, text, { fill, dbl: true }); }
  ws.mergeCells('E8:F8'); H('E8', 'Přestávka na oběd'); H('E9', 'Začátek', { bold: false, dbl: true }); H('F9', 'Konec', { bold: false, dbl: true });
  ws.mergeCells('J8:N8'); H('J8', 'Přesčas', { fill: LAV });
  for (const c of 'JKLM') H(`${c}9`, c === 'J' || c === 'L' ? 'Začátek' : 'Konec', { bold: false, dbl: true });
  H('N9', 'Celkem ', { fill: LAV, dbl: true });
  ws.getRow(8).height = 19; ws.getRow(9).height = 19;

  // dny
  let r = 10;
  for (const d of comp.days) {
    const n = Math.max(1, d.segs.length), r0 = r;
    const fill = d.holiday && !d.weekend ? HOL : d.weekend ? WEEKEND : null;
    for (let i = 0; i < n; i++, r++) {
      ws.getRow(r).height = 13.25;
      for (const c of cols) {
        const cell = ws.getCell(`${c}${r}`); font(cell, { bold: c === 'A' || c === 'B' }); cell.border = box;
        cell.alignment = { horizontal: c === 'A' || c === 'B' || c === 'T' ? 'left' : 'center' };
        if (fill) cell.fill = fillOf(fill);
        if ('CDGHIJKLMNOPQRS'.includes(c)) cell.numFmt = F_TIME; else if ('EF'.includes(c)) cell.numFmt = F_LUNCH;
      }
      const s = d.segs[i], len = s ? s.e - s.s : 0;
      if (s) { ws.getCell(`C${r}`).value = T(s.s); ws.getCell(`D${r}`).value = T(s.e); }
      ws.getCell(`H${r}`).value = T(len);                                                              // Čas v práci (D − C)
      ws.getCell(`I${r}`).value = T(Math.max(0, len - (i === 0 && d.lunch ? d.lunch.e - d.lunch.s : 0))); // netto (H − oběd)
    }
    const setV = (c, v) => { if (v) ws.getCell(`${c}${r0}`).value = T(v); };
    ws.getCell(`A${r0}`).value = new Date(Date.UTC(Y, M - 1, d.day)); ws.getCell(`A${r0}`).numFmt = F_DATE;
    ws.getCell(`B${r0}`).value = d.dayName;
    if (d.lunch) { ws.getCell(`E${r0}`).value = T(d.lunch.s); ws.getCell(`F${r0}`).value = T(d.lunch.e); }
    setV('G', d.fund);
    if (d.blocks[0]) { ws.getCell(`J${r0}`).value = T(d.blocks[0][0]); ws.getCell(`K${r0}`).value = T(d.blocks[0][1]); }
    if (d.blocks[1]) { ws.getCell(`L${r0}`).value = T(d.blocks[1][0]); ws.getCell(`M${r0}`).value = T(d.blocks[1][1]); }
    ws.getCell(`N${r0}`).value = T(d.over || 0);
    setV('O', d.vac); setV('P', d.sick); setV('Q', d.doc); setV('R', d.missing);
    if (hasOther) setV('S', d.other);
    if (hasNotes && d.notes.length) ws.getCell(`T${r0}`).value = d.notes.join('; ');
    if (n > 1) for (const c of ['A', 'B', 'G', 'O', 'P', 'Q', 'R', ...(hasOther ? ['S'] : []), ...(hasNotes ? ['T'] : [])]) ws.mergeCells(`${c}${r0}:${c}${r - 1}`);
  }
  const last = r - 1;

  // souhrn (rozložení jako předloha)
  const withHol = comp.days.some(d => d.holiday && !d.weekend && d.netto);
  let s = last + 4;
  set(`A${s}`, 'SOUHRN', { bold: true, underline: true, color: RED_T, align: 'left' }); ws.getRow(s + 1).height = 7; s += 2;
  const row = (label, minutes, o = {}) => {
    ws.mergeCells(`A${s}:D${s}`); ws.mergeCells(`E${s}:F${s}`);
    const col = o.red ? RED : undefined;
    set(`A${s}`, label, { align: 'left', wrap: true, color: col, fill: o.fill }).border = box;
    set(`E${s}`, T(minutes || 0), { align: 'left', fmt: F_SUM, color: col, fill: o.fill }).border = box;
    ws.getCell(`F${s}`).border = box;
    if (o.dec && minutes) set(`G${s}`, hours(minutes), { align: 'right', fmt: F_NUM });
    ws.getRow(s).height = 27; return s++;
  };
  row('Fond pracovní doby celkem:', S.fund);
  row('Čas v práci celkem:', S.work);
  row('Celkem odpracováno hodin včetně přesčasů:', S.netto, { fill: GREEN });
  row('Odpracováno v pracovní dny včetně přesčasů celkem:', S.netto - S.nettoWeekend);
  row(withHol ? 'Odpracováno o víkendu a ve svátek celkem:' : 'Odpracováno o víkendu celkem:', S.nettoWeekend);
  ws.getRow(s).height = 20; ws.getRow(s + 1).height = 20; ws.getRow(s + 2).height = 20; s += 2;
  set(`A${s}`, 'SOUHRN PRO ÚČETNÍ', { bold: true, underline: true, color: BLUE_T }); ws.getRow(s + 1).height = 7; s += 2;
  row('Odpracováno:', S.worked, { dec: true, fill: GREY });
  row('Odpracováno včetně svátků a přesčasů:', S.workedTotal, { dec: true, fill: GREY });
  row('Přesčas celkem:', S.over, { dec: true, fill: LAV });
  row('Přesčas v pracovní dny:', S.overWorkdays, { dec: true });
  row(withHol ? 'Přesčas o víkendu a ve svátek:' : 'Přesčas o víkendu:', S.overWeekend, { dec: true });
  row('Dovolená:', S.vac, { dec: true, fill: BLUE });
  row('Nemoc:', S.sick, { dec: true, fill: YELLOW });
  row('Návštěva lékaře:', S.doc, { dec: true });
  row('Chybějící odpracovaný čas:', S.missing, { dec: true, red: true });
  if (hasOther) row('Jiná placená překážka:', S.other, { dec: true });
  if (S.holiday) row('Státní svátky (placené):', S.holiday, { dec: true, fill: HOL });
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
