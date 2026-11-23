// Vinylor Hub · Edge Function „hub-rozvoz“ — Rozvozy (plánování rozvozů objednávek)
//   { action: 'config_get' }                         → nastavení propojení (bez tajných hodnot) + veřejný klíč pro dlaždice mapy
//   { action: 'config_save', csvUrl?, tileKey?, routeKey? } → uloží propojení (jen správce); prázdné pole se nemění
//   { action: 'sync' }                               → stáhne CSV export objednávek ze Shoptetu, vybere objednávky k rozvozu,
//                                                      doplní souřadnice (Mapy.com) a uloží do rozvoz_orders
//   { action: 'route', stops: [{lat,lng}] }          → trasa od skladu přes zastávky (Mapy.com routing)
// Jen čtení ze Shoptetu (CSV export). Smí volat jen přihlášený aktivní uživatel s 2FA (AAL2).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const WAREHOUSE = { lat: 49.6992203, lng: 14.0045589 };
const ALLOWED = ['Nevyřízená', 'Zaplaceno', 'Vyřizuje se', 'SKLAD', 'Zabaleno - připraveno k expedici', 'Čeká na vyzvednutí přepravcem', 'Nedoplatek dopravy', 'Naše doprava'];
const ALIASES: Record<string, string> = Object.fromEntries([...ALLOWED.map(s => [s.toLowerCase(), s]), ['zabaleno – připraveno k expedici', 'Zabaleno - připraveno k expedici']]);
const GEO_PER_CALL = 40;

function claims(jwt: string): Record<string, unknown> {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}
function decode(buf: Uint8Array): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder('utf-8').decode(buf.subarray(3));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* ne utf-8 */ }
  try { return new TextDecoder('windows-1250').decode(buf); } catch { /* nepodporováno */ }
  return new TextDecoder('latin1').decode(buf);
}
function parseCSV(text: string, d: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const join = (a: string[], sep: string) => a.map(clean).filter(Boolean).join(sep);
const fmtAmt = (n: number) => Number.isInteger(n) ? String(n) : String(n).replace('.', ',');

const geoDiag: Record<string, string> = {};
async function geocodeMapy(address: string, key: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const r = await fetch(`https://api.mapy.com/v1/geocode?query=${encodeURIComponent(address)}&lang=cs&limit=1&apikey=${encodeURIComponent(key)}`, { headers: { 'X-Mapy-Api-Key': key, 'Accept': 'application/json' } });
    if (!r.ok) { geoDiag.mapy = 'Mapy.com HTTP ' + r.status; return null; }
    const j = await r.json();
    const p = (j.items || j.results || [])[0]?.position;
    const lat = Number(p?.lat), lng = Number(p?.lon ?? p?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat && lng) return { lat, lng };
    geoDiag.mapy = 'Mapy.com adresu nenašlo'; return null;
  } catch { geoDiag.mapy = 'Mapy.com nedostupné'; return null; }
}
// náhradní vyhledání adres bez klíče (Photon / data OpenStreetMap; Nominatim cloudové servery blokuje)
async function geocodePhoton(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=1&lat=49.8&lon=15.5`, { headers: { 'User-Agent': 'VinylorHub-Rozvoz/1.0', 'Accept': 'application/json' } });
    await sleep(250);
    if (!r.ok) { geoDiag.photon = 'Photon HTTP ' + r.status; return null; }
    const j = await r.json(); const c = j?.features?.[0]?.geometry?.coordinates;
    const lng = Number(c?.[0]), lat = Number(c?.[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat && lng) return { lat, lng };
    geoDiag.photon = 'Photon adresu nenašel'; return null;
  } catch { geoDiag.photon = 'Photon nedostupný'; return null; }
}
async function geocode(address: string, key: string) {
  if (key) { const g = await geocodeMapy(address, key); if (g) return g; }
  return await geocodePhoton(address);
}
// náhradní trasa bez klíče (veřejný server OSRM, bez aktuální dopravy)
async function routeOsm(pts: { lat: number; lng: number }[]) {
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${pts.map(p => `${p.lng},${p.lat}`).join(';')}?overview=full&geometries=geojson`, { headers: { 'User-Agent': 'VinylorHub-Rozvoz/1.0' } });
    if (!r.ok) return null;
    const j = await r.json(); const rt = j?.routes?.[0];
    if (!rt?.geometry?.coordinates?.length) return null;
    return { latlngs: rt.geometry.coordinates.map((c: number[]) => [c[1], c[0]]), lengthMeters: Number(rt.distance) || 0, durationSeconds: Number(rt.duration) || 0 };
  } catch { return null; }
}

function coords(payload: any): number[][] {
  const g = payload?.geometry?.geometry?.coordinates ?? payload?.geometry?.coordinates ?? payload?.features?.[0]?.geometry?.coordinates;
  if (!g || !g.length) return [];
  if (typeof g[0]?.[0] === 'number') return g;
  const out: number[][] = [];
  const walk = (v: any) => { if (!v || !v.length) return; if (typeof v[0]?.[0] === 'number') { out.push(...v); return; } v.forEach(walk); };
  walk(g); return out;
}
function pick(payload: any, keys: string[]): number {
  for (const src of [payload, payload?.properties, payload?.geometry?.properties, payload?.features?.[0]?.properties]) {
    if (!src) continue;
    for (const k of keys) { const v = Number(src[k]); if (src[k] != null && Number.isFinite(v)) return v; }
  }
  return 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await sb.auth.getUser(jwt);
    if (!u?.user) return json({ error: 'Nepřihlášen' }, 401);
    if (claims(jwt).aal !== 'aal2') return json({ error: 'Vyžaduje dvoufázové ověření.' }, 403);
    const { data: me } = await sb.from('hub_profiles').select('role, active').eq('id', u.user.id).single();
    if (!me || !me.active) return json({ error: 'Účet nemá přístup.' }, 403);
    const b = await req.json().catch(() => ({}));
    const { data: cfg } = await sb.from('rozvoz_config').select('*').eq('id', 1).single();
    const pub = (c: any) => ({ ok: true, tileKey: c?.tile_key || '', hasCsv: !!c?.csv_url, hasRoute: !!(c?.route_key || c?.tile_key), syncedAt: c?.synced_at || null, count: c?.order_count || 0 });

    if (b.action === 'config_get') return json(pub(cfg));

    if (b.action === 'config_save') {
      if (me.role !== 'admin') return json({ error: 'Jen pro správce.' }, 403);
      const patch: Record<string, string> = {};
      const csv = clean(b.csvUrl); if (csv) { if (!/^https:\/\//i.test(csv)) return json({ error: 'Odkaz na export musí začínat https://' }, 400); patch.csv_url = csv; }
      const tk = clean(b.tileKey); if (tk) patch.tile_key = tk;
      const rk = clean(b.routeKey); if (rk) patch.route_key = rk;
      if (Object.keys(patch).length) {
        const { error } = await sb.from('rozvoz_config').update(patch).eq('id', 1);
        if (error) return json({ error: error.message }, 500);
        await sb.from('hub_audit').insert({ actor: u.user.id, action: 'rozvoz_config', detail: { fields: Object.keys(patch) } });
      }
      const { data: c2 } = await sb.from('rozvoz_config').select('*').eq('id', 1).single();
      return json(pub(c2));
    }

    if (b.action === 'sync') {
      for (const k of Object.keys(geoDiag)) delete geoDiag[k];
      if (!cfg?.csv_url) return json({ ok: false, error: 'Není nastavený odkaz na CSV export objednávek (⚙ Propojení).' });
      const key = cfg.route_key || cfg.tile_key;
      let text: string;
      try {
        const res = await fetch(cfg.csv_url, { headers: { 'User-Agent': 'VinylorHub-Rozvoz/1.0' }, redirect: 'follow' });
        if (!res.ok) return json({ ok: false, error: 'Shoptet export se nepodařilo stáhnout. HTTP ' + res.status });
        text = decode(new Uint8Array(await res.arrayBuffer()));
      } catch (e) { return json({ ok: false, error: 'Nepodařilo se stáhnout export: ' + (e as Error).message }); }
      if (!text || text.length < 10) return json({ ok: false, error: 'Stažený Shoptet export je prázdný.' });
      const first = text.split(/\r?\n/)[0] || '';
      const delim = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
      const rows = parseCSV(text, delim);
      if (rows.length < 2) return json({ ok: false, error: 'Shoptet export neobsahuje žádné objednávky.' });
      const idx: Record<string, number> = {}; rows[0].forEach((h, i) => { const k = clean(h); if (k) idx[k] = i; });
      if (idx.code === undefined || idx.statusName === undefined) return json({ ok: false, error: 'V exportu chybí sloupec code / statusName.' });
      const v = (r: string[], h: string) => idx[h] === undefined ? '' : clean(r[idx[h]]);
      const addrOf = (row: string[], c: 'delivery' | 'bill') => {
        const street = join([v(row, c + 'Street'), v(row, c + 'HouseNumber')], ' ');
        const city = v(row, c + 'City'), zip = v(row, c + 'Zip');
        return { city, zip, hasData: !!(street || city), full: join([street, join([zip, city], ' '), v(row, c + 'CountryName') || 'Česká republika'], ', ') };
      };
      const orders = new Map<string, { code: string; status: string; address: string; city: string; zip: string; total: number; paid: number; items: string[] }>();
      for (const row of rows.slice(1)) {
        const code = v(row, 'code'); const st = clean(v(row, 'statusName')); const status = ALIASES[st.toLowerCase()] || st;
        if (!code || !ALLOWED.includes(status)) continue;
        const d = addrOf(row, 'delivery'); const bl = addrOf(row, 'bill'); const use = d.hasData ? d : bl;
        if (!use.hasData) continue;
        if (!orders.has(code)) orders.set(code, { code, status, address: use.full, city: use.city, zip: use.zip, total: num(v(row, 'totalPriceWithVat')), paid: num(v(row, 'amountPaid')), items: [] });
        const name = v(row, 'itemName'); const amt = num(v(row, 'itemAmount'));
        if (name) orders.get(code)!.items.push((amt ? fmtAmt(amt) + '× ' : '') + name);
      }
      // souřadnice: nejdřív z uložených objednávek (stejná adresa), nové adresy přes Mapy.com
      const cache = new Map<string, { lat: number | null; lng: number | null; tried: boolean }>();
      for (let off = 0; ; off += 1000) {
        const { data } = await sb.from('rozvoz_orders').select('address,lat,lng,geo_tried').range(off, off + 999);
        (data || []).forEach((x: any) => cache.set(x.address, { lat: x.lat, lng: x.lng, tried: x.geo_tried }));
        if (!data || data.length < 1000) break;
      }
      const need = [...new Set([...orders.values()].map(o => o.address))].filter(a => { const c = cache.get(a); return !c || !(c.lat && c.lng); }).sort((a, b) => (cache.get(a)?.tried ? 1 : 0) - (cache.get(b)?.tried ? 1 : 0));
      let geocoded = 0;
      for (const a of need.slice(0, GEO_PER_CALL)) {
        const g = await geocode(a, key);
        cache.set(a, { lat: g?.lat ?? null, lng: g?.lng ?? null, tried: true }); if (g) geocoded++;
        await sleep(80);
      }
      const geoRemaining = need.filter(a => { const c = cache.get(a); return !(c?.lat && c?.lng) && !c?.tried; }).length;
      const now = new Date().toISOString();
      const out = [...orders.values()].map(o => { const c = cache.get(o.address); return { code: o.code, status: o.status, address: o.address, city: o.city, zip: o.zip, lat: c?.lat ?? null, lng: c?.lng ?? null, total: o.total, paid: o.paid, items: [...new Set(o.items)].join(' | '), geo_tried: !!c?.tried || !!(c?.lat && c?.lng), synced_at: now }; });
      for (let i = 0; i < out.length; i += 200) {
        const { error } = await sb.from('rozvoz_orders').upsert(out.slice(i, i + 200), { onConflict: 'code' });
        if (error) return json({ ok: false, error: error.message }, 500);
      }
      await sb.from('rozvoz_orders').delete().lt('synced_at', now);
      const missing = out.filter(o => !(o.lat && o.lng)).length;
      await sb.from('rozvoz_config').update({ synced_at: now, order_count: out.length }).eq('id', 1);
      return json({ ok: true, orders: out.length, geocoded, missing, geoRemaining, geoDiag: Object.values(geoDiag).join('; ') });
    }

    if (b.action === 'route') {
      const stops = Array.isArray(b.stops) ? b.stops : [];
      if (!stops.length || stops.length > 16) return json({ ok: false, message: 'Vyber 1 až 16 objednávek.' });
      const key = cfg?.route_key || cfg?.tile_key || '';
      const pts = [{ lat: WAREHOUSE.lat, lng: WAREHOUSE.lng }];
      for (const s of stops) { const lat = Number(s.lat), lng = Number(s.lng); if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ ok: false, message: 'Jedna z objednávek nemá platné souřadnice.' }); pts.push({ lat, lng }); }
      let why = 'Není nastavený klíč Mapy.com.';
      if (key) {
        const c = (p: { lat: number; lng: number }) => `${p.lng},${p.lat}`;
        let url = `https://api.mapy.com/v1/routing/route?apikey=${encodeURIComponent(key)}&start=${encodeURIComponent(c(pts[0]))}&end=${encodeURIComponent(c(pts[pts.length - 1]))}&routeType=car_fast_traffic&format=geojson`;
        const way = pts.slice(1, -1).map(c); if (way.length) url += '&waypoints=' + encodeURIComponent(way.join(';'));
        try {
          const res = await fetch(url, { headers: { 'X-Mapy-Api-Key': key } });
          if (!res.ok) why = 'Mapy.com vrátily chybu HTTP ' + res.status + '.';
          else {
            const payload: any = await res.json();
            const latlngs = coords(payload).filter(p => p && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]))).map(p => [Number(p[1]), Number(p[0])]);
            if (latlngs.length) return json({ ok: true, latlngs, lengthMeters: pick(payload, ['length', 'distance', 'lengthMeters']), durationSeconds: pick(payload, ['duration', 'time', 'durationSeconds']) });
            why = 'V odpovědi Mapy.com nebyla nalezena geometrie trasy.';
          }
        } catch { why = 'Nepodařilo se spojit s Mapy.com.'; }
      }
      const alt = await routeOsm(pts);
      if (alt) return json({ ok: true, ...alt, note: `${why} Trasa je vypočtená náhradní službou (bez aktuální dopravy, čas je orientační).` });
      return json({ ok: false, message: why + ' Náhradní služba také neodpověděla.' });
    }
    return json({ error: 'Neznámá akce.' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
