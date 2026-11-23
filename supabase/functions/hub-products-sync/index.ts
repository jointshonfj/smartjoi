// Vinylor Hub · Edge Function „hub-products-sync“
// Stáhne CSV export produktů ze Shoptetu (odkaz v hub_settings.data.csvUrl)
// a uloží je do tabulky hub_products. Volá ji plánovač (každou hodinu)
// a tlačítko „Načíst produkty teď“ v Nastavení. verify_jwt = zapnuté.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function decode(buf: Uint8Array): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder('utf-8').decode(buf.subarray(3));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* not utf-8 */ }
  try { return new TextDecoder('windows-1250').decode(buf); } catch { /* unsupported */ }
  return new TextDecoder('latin1').decode(buf);
}
function parseCSV(text: string, d: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
const num = (s: unknown) => { const n = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

function claims(jwt: string): Record<string, unknown> {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}

async function runSync(sb: any, minGapMs: number) {
  const { data: st, error: e1 } = await sb.from('hub_settings').select('*').eq('id', 1).single();
  if (e1) throw new Error('hub_settings: ' + e1.message);
  const now = new Date().toISOString();
  const fail = async (msg: string) => {
    await sb.from('hub_settings').update({ products_error: msg, products_error_at: now }).eq('id', 1);
    return { ok: false, error: msg };
  };
  if (st.products_synced_at && Date.now() - Date.parse(st.products_synced_at) < minGapMs) return { ok: true, skipped: true, count: st.products_count };
  const url = st.data?.csvUrl;
  if (!url) return fail('Není nastavený odkaz na CSV export produktů (Nastavení).');

  let text: string;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'VinylorHub/1.0' } });
    if (!res.ok) return fail('Shoptet vrátil HTTP ' + res.status);
    text = decode(new Uint8Array(await res.arrayBuffer()));
  } catch (e) { return fail('Nepodařilo se stáhnout CSV: ' + (e as Error).message); }

  const rows = parseCSV(text, ';');
  const headers = (rows.shift() || []).map(h => h.trim());
  const col = (n: string) => headers.indexOf(n);
  const iCode = col('code'), iName = col('name'), iPrice = col('price');
  if (iCode < 0 || iName < 0 || iPrice < 0) return fail('V CSV chybí sloupce code / name / price.');
  // výchozí kategorie produktu (sloupec „Výchozí kategorie“ v exportu; jako záloha „Kategorie“)
  const iCat = (() => { const a = headers.findIndex(h => /^defaultcategory$/i.test(h)); if (a >= 0) return a; return headers.findIndex(h => /^categor/i.test(h)); })();
  const iVar = headers.map((h, i) => (h.startsWith('variant:') ? i : -1)).filter(i => i >= 0);
  const get = (r: string[], n: string) => { const i = col(n); return i >= 0 ? String(r[i] ?? '').trim() : ''; };

  // identifikátory pro hledání: EAN, MPN / číslo dílu, výrobce a vše, co jim je podobné (název sloupce se u Shoptetu může lišit)
  const idCols = headers.map((h, i) => ({ h: h.toLowerCase(), i })).filter(x => /ean|gtin|barcode|mpn|part|plu|number|sku|manufact|producer/.test(x.h) && x.h !== 'code' && x.h !== 'paircode');
  const first = (r: string[], re: RegExp) => { const x = idCols.find(c => re.test(c.h)); return x ? String(r[x.i] ?? '').trim() : ''; };

  const map = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const code = String(r[iCode] ?? '').trim();
    if (!code) continue;
    map.set(code, {
      code,
      name: String(r[iName] ?? '').trim(),
      variant: iVar.map(i => String(r[i] ?? '').trim()).filter(Boolean).join(' / '),
      supplier: get(r, 'supplier'),
      category: iCat >= 0 ? String(r[iCat] ?? '').trim().slice(0, 200) : '',
      price_vat: num(r[iPrice]) ?? 0,
      standard_price: num(get(r, 'standardPrice')),
      action_price: num(get(r, 'actionPrice')),
      ean: first(r, /^(ean|gtin|barcode)/),
      mpn: first(r, /^(mpn|partnumber|part_number|part number|productnumber|manufacturercode)/),
      manufacturer: first(r, /^manufact|^producer/),
      keywords: [...new Set(idCols.map(c => String(r[c.i] ?? '').trim()).filter(Boolean))].join(' '),
      visible: (get(r, 'productVisibility') || 'visible') === 'visible' && get(r, 'variantVisibility') !== '0',
      updated_at: now,
    });
  }
  const items = [...map.values()];
  if (!items.length) return fail('CSV neobsahuje žádné produkty.');

  for (let i = 0; i < items.length; i += 500) {
    const { error } = await sb.from('hub_products').upsert(items.slice(i, i + 500), { onConflict: 'code' });
    if (error) return fail('hub_products: ' + error.message);
  }
  // produkty, které z exportu zmizely
  const { error: e2 } = await sb.from('hub_products').delete().lt('updated_at', now);
  if (e2) return fail('hub_products: ' + e2.message);

  const { data: fresh } = await sb.from('hub_settings').select('data').eq('id', 1).single();
  await sb.from('hub_settings').update({ products_synced_at: now, products_error: null, products_count: items.length, data: { ...(fresh?.data || {}), csvHeaders: headers } }).eq('id', 1);
  return { ok: true, count: items.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    // plánovač volá s veřejným klíčem (role anon) → nejvýš jednou za 50 min; člověk z aplikace jen s 2FA
    const c = claims((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
    if (c.role !== 'anon' && c.aal !== 'aal2') return new Response(JSON.stringify({ ok: false, error: 'Vyžaduje dvoufázové ověření.' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const result = await runSync(sb, c.role === 'anon' ? 50 * 60_000 : 20_000);
    return new Response(JSON.stringify(result), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
