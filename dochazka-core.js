// SmartJoi · DocházkoBot — výpočet docházky (sdílí aplikace i SmartJoiAI na serveru)
// Časy se počítají v minutách od půlnoci. Záznam (entry):
//   { date:'2026-08-03', kind:'work'|'lunch'|'vacation'|'sick'|'ocr'|'doctor'|'doctor_family'|'other',
//     start:'06:40'|null, end:'17:01'|null, minutes:number|null, exact:bool, label:'původní kategorie', note:'' }

export const KIND_LABEL = {
  work: 'Práce', lunch: 'Oběd', vacation: 'Dovolená', sick: 'Nemoc', ocr: 'OČR',
  doctor: 'Návštěva lékaře', doctor_family: 'Lékař s čl. rodiny', other: 'Ostatní (placená překážka)',
};
export const DEFAULT_EMP = {
  daily_hours: 8, weekly_hours: 40, shift_start: '07:30', shift_end: '16:00', lunch_minutes: 30, lunch_after_minutes: 360,
  lunch_default: '12:00', round_start: 15, round_end: 5, end_tolerance: 10, alt_shift_start: '', alt_shift_end: '',
};
const DAY_NAMES = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
export const MONTH_NAMES = ['LEDEN', 'ÚNOR', 'BŘEZEN', 'DUBEN', 'KVĚTEN', 'ČERVEN', 'ČERVENEC', 'SRPEN', 'ZÁŘÍ', 'ŘÍJEN', 'LISTOPAD', 'PROSINEC'];

export const toMin = t => { if (t == null || t === '') return null; const m = String(t).match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
export const fmtHM = m => m == null ? '' : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
export const fmtClock = m => m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
export const hours = m => Math.round((m / 60) * 100) / 100;
const ceilTo = (m, s) => s > 1 ? Math.ceil(m / s) * s : m;
const floorTo = (m, s) => s > 1 ? Math.floor(m / s) * s : m;
const pad = n => String(n).padStart(2, '0');
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
// pondělí týdne, do kterého datum patří (klíč pro střídání směn)
export const weekOf = date => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); };
// Střídavá (delší) směna, např. kancelář 8:30–17:00 místo 7:30–16:00 — prohazují si ji i po dnech.
// Den je „delší směna“, když zaměstnanec odešel nejdřív 15 min před jejím koncem (typicky v 17:00),
// nebo přišel nejdřív 20 min před jejím začátkem. Ručně jde den přepnout (shiftDays[date] = 'alt' | 'normal').
export function autoAltDay(list, empIn = {}) {
  const alt = toMin(empIn.alt_shift_start), altEnd = toMin(empIn.alt_shift_end); if (alt == null || altEnd == null) return false;
  const work = (list || []).filter(e => e.kind === 'work' && toMin(e.start) != null && toMin(e.end) != null); if (!work.length) return false;
  const first = Math.min(...work.map(e => toMin(e.start))), last = Math.max(...work.map(e => toMin(e.end)));
  return last >= altEnd - 15 || first >= alt - 20;
}

// ---------- státní svátky ČR ----------
function easter(y) { // gregoriánský algoritmus
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
export function czHolidays(y) {
  const H = { '01-01': 'Nový rok, Den obnovy samostatného českého státu', '05-01': 'Svátek práce', '05-08': 'Den vítězství', '07-05': 'Den slovanských věrozvěstů Cyrila a Metoděje',
    '07-06': 'Den upálení mistra Jana Husa', '09-28': 'Den české státnosti', '10-28': 'Den vzniku samostatného československého státu', '11-17': 'Den boje za svobodu a demokracii',
    '12-24': 'Štědrý den', '12-25': '1. svátek vánoční', '12-26': '2. svátek vánoční' };
  const out = {}; for (const [k, v] of Object.entries(H)) out[`${y}-${k}`] = v;
  const e = easter(y);
  const add = (days, name) => { const d = new Date(e.getTime() + days * 864e5); out[d.toISOString().slice(0, 10)] = name; };
  add(-2, 'Velký pátek'); add(1, 'Velikonoční pondělí');
  return out;
}

// ---------- čtení exportu z docházkového systému (text z PDF) ----------
const CZ_MON = { led: 1, úno: 2, uno: 2, bře: 3, bre: 3, dub: 4, kvě: 5, kve: 5, čvn: 6, cvn: 6, čer: 6, čvc: 7, cvc: 7, srp: 8, zář: 9, zar: 9, říj: 10, rij: 10, lis: 11, pro: 12 };
export function kindFromLabel(label) {
  const l = String(label || '').normalize('NFC').toLowerCase();
  if (/oběd|obed|přestávk|prestavk/.test(l)) return 'lunch';
  if (/dovolen/.test(l)) return 'vacation';
  if (/očr|ocr|ošetřován/.test(l)) return 'ocr';
  if (/(lék|lek).*(čl|cl|rod)|doprovod/.test(l)) return 'doctor_family';
  if (/lékař|lekar|lékaře|lekare/.test(l)) return 'doctor';
  if (/nemoc|pn\b|neschopn/.test(l)) return 'sick';
  if (/práce|prace|home|služeb|sluzeb|školení|skoleni/.test(l)) return 'work';
  return 'other';
}
const durMin = s => { const h = /(\d+)\s*h/.exec(s), m = /(\d+)\s*min/.exec(s); return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0); };
export function parseAttendanceText(raw) {
  const text = String(raw || '').normalize('NFC').replace(/\s+/g, ' ');
  const entries = [];
  const re = /(\d{1,2})\.? ([A-Za-zÁ-žÀ-ÿ]{3})[a-zá-ž]*\.? (\d{4}) \[[^\]]{1,4}\],? (\d{1,2}:\d{2})(?: ?\[[^\]]*\])? (\d{1,2})\.? ([A-Za-zÁ-žÀ-ÿ]{3})[a-zá-ž]*\.? (\d{4}) \[[^\]]{1,4}\],? (\d{1,2}:\d{2})(?: ?\[[^\]]*\])? (.{2,60}?) (\d+h(?: \d+ ?min)?|\d+ ?min)\b/g;
  let m;
  while ((m = re.exec(text))) {
    const mon = CZ_MON[m[2].toLowerCase()]; if (!mon) continue;
    const label = m[9].trim();
    const kind = kindFromLabel(label);
    const date = ymd(+m[3], mon, +m[1]);
    const e = { date, kind, start: m[4].padStart(5, '0'), end: m[8].padStart(5, '0'), minutes: durMin(m[10]), exact: false, label };
    if (ymd(+m[7], CZ_MON[m[6].toLowerCase()] || mon, +m[5]) !== date) e.note = 'končí jiný den';
    entries.push(e);
  }
  let employee = (/Úprava záznamů\s*-\s*(.+?)\s+(?:Vytvořit|Začátek)/.exec(text) || /Osoba\s+([A-ZÁ-Ž][^\s]+\s+[A-ZÁ-Ž][^\s]+)/.exec(text) || [])[1] || null;
  const num = r => { const x = r.exec(text); return x ? Number(x[1].replace(',', '.')) : null; };
  const report = /Časový fond|Čas v práci \(netto\)/.test(text) ? {
    fund: num(/Časový fond\s+([\d]+,\d+)/), netto: num(/Čas v práci \(netto\)\s+([\d]+,\d+)/), vacation: num(/Dovolená\s+([\d]+,\d+)/),
    doctor: num(/Návštěva lékaře\s+([\d]+,\d+)/), workdays: num(/Počet pracovních dnů\s+(\d+)/), missing: num(/Chybějící odpracovaný čas\s+([\d]+,\d+)/),
  } : null;
  const per = /Období\s+(\S+)\s+(\d{4})/.exec(text);
  return { entries, employee, report, period: per ? `${per[1]} ${per[2]}` : null };
}

// ---------- výpočet měsíce ----------
export function computeMonth(month, entries, empIn = {}, opts = {}) {
  const emp = { ...DEFAULT_EMP, ...Object.fromEntries(Object.entries(empIn || {}).filter(([, v]) => v !== null && v !== undefined && v !== '')) };
  const [Y, M] = month.split('-').map(Number);
  const nDays = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  const hol = czHolidays(Y);
  const hasAlt = toMin(emp.alt_shift_start) != null && toMin(emp.alt_shift_end) != null, shiftDays = opts.shiftDays || {};
  const dayFund = Math.round(Number(emp.daily_hours) * 60);
  const byDate = {}; for (const e of entries || []) (byDate[e.date] ||= []).push(e);
  const days = [];
  for (let d = 1; d <= nDays; d++) {
    const date = ymd(Y, M, d), dow = new Date(Date.UTC(Y, M - 1, d)).getUTCDay();
    const weekend = dow === 0 || dow === 6, holiday = hol[date] || null;
    const list = byDate[date] || [];
    const notes = [];
    const alt = !weekend && hasAlt && (shiftDays[date] === 'alt' || (shiftDays[date] !== 'normal' && autoAltDay(list, emp)));
    const altManual = !weekend && hasAlt && !!shiftDays[date];
    const shiftStart = toMin(alt ? emp.alt_shift_start : emp.shift_start), shiftEnd = toMin(alt ? emp.alt_shift_end : emp.shift_end);
    // pracovní úseky (vnitřní hranice se nezaokrouhlují, jen příchod a odchod)
    const work = list.filter(e => e.kind === 'work' && toMin(e.start) != null && toMin(e.end) != null)
      .map(e => ({ s: toMin(e.start), e: toMin(e.end), rs: toMin(e.start), re: toMin(e.end), exact: !!e.exact })).sort((a, b) => a.s - b.s);
    // sloučit navazující / překrývající se úseky
    const segs = [];
    for (const w of work) { const last = segs[segs.length - 1]; if (last && w.s <= last.e) { last.e = Math.max(last.e, w.e); last.re = Math.max(last.re, w.re); last.exactEnd = w.exact; } else segs.push({ ...w, exactStart: w.exact, exactEnd: w.exact }); }
    if (segs.length) {
      const f = segs[0], l = segs[segs.length - 1];
      if (!f.exactStart) f.s = ceilTo(f.s, +emp.round_start);
      if (!l.exactEnd) { let e = floorTo(l.e, +emp.round_end); if (!weekend && !holiday && e > shiftEnd && e - shiftEnd <= +emp.end_tolerance) e = shiftEnd; l.e = e; }
      for (const s of segs) if (s.e < s.s) s.e = s.s;
    }
    const workMin = segs.reduce((t, s) => t + (s.e - s.s), 0);
    // oběd
    let lunch = null;
    if (workMin > +emp.lunch_after_minutes) {
      const L = +emp.lunch_minutes, pref = toMin(emp.lunch_default);
      const inSeg = segs.find(s => s.s <= pref && s.e >= pref + L);
      if (inSeg) lunch = { s: pref, e: pref + L };
      else {
        const before = [...segs].reverse().find(s => s.e <= pref + L && s.e - s.s >= L);
        const after = segs.find(s => s.s >= pref && s.e - s.s >= L);
        if (before) { const e = Math.max(before.s + L, floorTo(before.e, 30)); lunch = { s: e - L, e }; }
        else if (after) { const s = Math.min(after.e - L, ceilTo(after.s, 30)); lunch = { s, e: s + L }; }
        else { const big = segs.reduce((a, b) => (b.e - b.s > a.e - a.s ? b : a), segs[0]); lunch = { s: big.s + Math.floor((big.e - big.s - L) / 2), e: 0 }; lunch.e = lunch.s + L; }
      }
    }
    const netto = Math.max(0, workMin - (lunch ? lunch.e - lunch.s : 0));
    // nepřítomnosti (minuty)
    const absMin = k => list.filter(e => e.kind === k).reduce((t, e) => t + (e.minutes != null && e.minutes !== '' ? Number(e.minutes) : Math.max(0, (toMin(e.end) ?? 0) - (toMin(e.start) ?? 0))), 0);
    const vac = absMin('vacation'), sickOnly = absMin('sick'), ocr = absMin('ocr'), docOnly = absMin('doctor'), docFam = absMin('doctor_family'), other = absMin('other');
    const sick = sickOnly + ocr, doc = docOnly + docFam;
    if (ocr) notes.push(`OČR ${fmtHM(ocr)} h`);
    if (docFam) notes.push(`lékař s čl. rodiny ${fmtHM(docFam)} h`);
    if (other) notes.push(`ostatní ${fmtHM(other)} h`);
    for (const e of list) if (e.note) notes.push(e.note);
    const fund = weekend ? 0 : dayFund;
    let holidayMin = 0, over = 0, missing = 0;
    if (holiday && !weekend) { holidayMin = dayFund; notes.unshift('Státní svátek – ' + holiday); over = netto; }
    else if (holiday && weekend) { notes.unshift('Státní svátek – ' + holiday); over = netto; }
    else if (weekend) over = netto;
    else {
      const covered = netto + vac + sick + doc + other;
      over = Math.max(0, covered - fund); missing = Math.max(0, fund - covered);
    }
    // přesčas do sloupců Začátek/Konec (ráno před směnou, zbytek na konci dne)
    const blocks = [];
    if (over > 0 && segs.length) {
      if (weekend || holiday) blocks.push([segs[0].s, segs[0].s + over]);
      else {
        const first = segs[0].s, last = segs[segs.length - 1].e;
        const morning = Math.min(over, Math.max(0, shiftStart - first));
        if (morning > 0) blocks.push([first, first + morning]);
        const rest = over - morning; if (rest > 0) blocks.push([last - rest, last]);
      }
    }
    days.push({ date, day: d, dow, dayName: DAY_NAMES[dow], weekend, holiday, alt, altManual, shift: [shiftStart, shiftEnd], segs, lunch, workMin, netto, fund, vac, sick, doc, other, over, blocks, missing, holidayMin, notes, entries: list });
  }
  const sum = k => days.reduce((t, x) => t + (x[k] || 0), 0);
  const weekendDays = days.filter(x => x.weekend || x.holiday);
  const S = {
    fund: sum('fund'), work: sum('workMin'), netto: sum('netto'), over: sum('over'),
    overWeekend: weekendDays.reduce((t, x) => t + x.over, 0), nettoWeekend: weekendDays.reduce((t, x) => t + x.netto, 0),
    vac: sum('vac'), sick: sum('sick'), doc: sum('doc'), other: sum('other'), missing: sum('missing'), holiday: sum('holidayMin'),
    workdays: days.filter(x => !x.weekend && !x.holiday).length, holidays: days.filter(x => x.holiday && !x.weekend).length,
    weekendWorked: days.filter(x => (x.weekend || x.holiday) && x.netto > 0).length,
  };
  S.overWorkdays = S.over - S.overWeekend;
  S.worked = S.fund - S.vac - S.sick - S.doc - S.other - S.missing - S.holiday;   // „Odpracováno“ (pro účetní)
  S.workedTotal = S.worked + S.holiday + S.over;                                   // „včetně svátků a přesčasů“
  S.workedDays = Math.round((S.worked / (Number(emp.daily_hours) * 60)) * 100) / 100;
  return { month, emp, days, sum: S };
}
