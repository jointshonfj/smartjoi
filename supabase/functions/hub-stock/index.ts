// Vinylor Hub · Edge Function „hub-stock“ — Zásoby: jen ČTENÍ ze Shoptet Private API (do Shoptetu nic nezapisuje).
//   { action: 'stock_sync', stockId }           → načte aktuální stavy zásob celého skladu do tabulky stk_levels
//   { action: 'sales_sync', days, batch }       → načte prodeje z objednávek za posledních `days` dní do stk_sales
//        po dávkách (batch objednávek na jedno volání); vrací `remaining` — klient volá dokud není 0
// Token je v Supabase Secrets (SHOPTET_API_TOKEN). Smí volat jen přihlášený aktivní uživatel s 2FA (AAL2).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const BASE = 'https://api.myshoptet.com/api';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function claims(jwt: string): Record<string, unknown> {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}
const CANCELLED = /storn|zruš|zrus|cancel/i;

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
    const token = Deno.env.get('SHOPTET_API_TOKEN');
    if (!token) return json({ error: 'V Supabase Secrets chybí SHOPTET_API_TOKEN.' }, 503);
    const hdr = { 'Shoptet-Private-API-Token': token, 'Accept': 'application/json' };
    const get = async (path: string) => {
      const r = await fetch(BASE + path, { headers: hdr });
      const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* ne JSON */ }
      return { status: r.status, json: j, text: j ? '' : t.slice(0, 200) };
    };
    const errText = (r: { json: any; text: string; status: number }) =>
      (r.json?.errors ? r.json.errors.map((e: any) => e.message || e.errorCode).filter(Boolean).join('; ') : r.text) || ('HTTP ' + r.status);
    const b = await req.json().catch(() => ({}));
    const now = new Date().toISOString();

    // ---- aktuální zásoby celého skladu ----
    if (b.action === 'stock_sync') {
      const stockId = Number(b.stockId);
      if (!Number.isInteger(stockId)) return json({ error: 'Neplatný sklad.' }, 400);
      const AMT = ['realStock', 'amount', 'quantity', 'amountInStock', 'inStock'];
      const rowsOut: { code: string; stock: number; synced_at: string }[] = []; let sample: any = null; let unknownShape = false; let total = 0;
      for (let page = 1; page <= 30; page++) {
        const r = await get(`/stocks/${stockId}/supplies?itemsPerPage=1000&page=${page}`);
        if (r.status !== 200) return json({ error: 'Shoptet nevrátil zásoby: ' + errText(r) }, 502);
        const rows: any[] = r.json?.data?.supplies || [];
        if (!sample && rows.length) sample = rows[0];
        for (const it of rows) {
          const code = String(it.code ?? it.productCode ?? '').trim(); if (!code) continue;
          total++;
          const f = AMT.find(k => it[k] != null && Number.isFinite(Number(it[k])));
          if (!f) { unknownShape = true; continue; }
          rowsOut.push({ code, stock: Number(it[f]), synced_at: now });
        }
        const pages = Number(r.json?.data?.paginator?.pageCount ?? 0);
        if (rows.length < 1000 || (pages && page >= pages)) break;
        await sleep(250);
      }
      if (unknownShape || !rowsOut.length) return json({ ok: false, unknownShape, total, sampleKeys: sample ? Object.keys(sample) : [], error: 'Nepodařilo se rozpoznat pole s množstvím v odpovědi Shoptetu.' });
      for (let i = 0; i < rowsOut.length; i += 500) {
        const { error } = await sb.from('stk_levels').upsert(rowsOut.slice(i, i + 500), { onConflict: 'code' });
        if (error) return json({ error: 'Uložení zásob: ' + error.message }, 500);
      }
      await sb.from('stk_config').update({ stock_synced_at: now }).eq('id', 1);
      return json({ ok: true, saved: rowsOut.length, total });
    }

    // ---- prodeje z objednávek (po dávkách) ----
    if (b.action === 'sales_sync') {
      const days = Math.min(180, Math.max(7, Number(b.days) || 60));
      const batch = Math.min(50, Math.max(5, Number(b.batch) || 40));
      const since = new Date(Date.now() - days * 864e5); since.setUTCHours(0, 0, 0, 0);
      const from = since.toISOString().slice(0, 19) + '+00:00';
      const list: any[] = [];
      for (let page = 1; page <= 60; page++) {
        const r = await get(`/orders?creationTimeFrom=${encodeURIComponent(from)}&itemsPerPage=50&page=${page}`);
        if (r.status !== 200) return json({ ok: false, error: 'Shoptet nevrátil objednávky: ' + errText(r) });
        list.push(...(r.json?.data?.orders || []));
        if (page >= (r.json?.data?.paginator?.pageCount || 1)) break;
        await sleep(120);
      }
      const known = new Set<string>();
      for (let off = 0; ; off += 1000) {
        const { data, error } = await sb.from('stk_sales_orders').select('order_code').gte('sold_at', since.toISOString().slice(0, 10)).range(off, off + 999);
        if (error) return json({ ok: false, error: error.message }, 500);
        (data || []).forEach((x: { order_code: string }) => known.add(x.order_code));
        if (!data || data.length < 1000) break;
      }
      const fresh = list.filter(o => o.code && !known.has(String(o.code)));
      // stornované objednávky se jen označí (neprodaly se)
      const canc = fresh.filter(o => CANCELLED.test(String(o.status?.name || '')));
      if (canc.length) {
        const { error } = await sb.from('stk_sales_orders').upsert(canc.map(o => ({ order_code: String(o.code), sold_at: String(o.creationTime || now).slice(0, 10), status: String(o.status?.name || '').slice(0, 80), cancelled: true })), { onConflict: 'order_code' });
        if (error) return json({ ok: false, error: error.message }, 500);
      }
      const todo = fresh.filter(o => !CANCELLED.test(String(o.status?.name || '')));
      const part = todo.slice(0, batch);
      let lines = 0;
      for (const o of part) {
        const d = await get('/orders/' + encodeURIComponent(o.code));
        if (d.status !== 200) return json({ ok: false, error: `Objednávka ${o.code}: ` + errText(d), remaining: todo.length });
        const od = d.json?.data?.order || {};
        const sum = new Map<string, number>();
        for (const it of od.items || []) {
          if (it.itemType !== 'product') continue;
          const code = String(it.code || '').trim(); const qty = Number(it.amount) || 0;
          if (!code || qty <= 0) continue;
          sum.set(code, (sum.get(code) || 0) + qty);
        }
        const day = String(o.creationTime || now).slice(0, 10);
        if (sum.size) {
          const { error } = await sb.from('stk_sales').upsert([...sum].map(([code, qty]) => ({ order_code: String(o.code), code, qty, sold_at: day })), { onConflict: 'order_code,code' });
          if (error) return json({ ok: false, error: error.message }, 500);
          lines += sum.size;
        }
        const { error: e2 } = await sb.from('stk_sales_orders').upsert({ order_code: String(o.code), sold_at: day, status: String(o.status?.name || '').slice(0, 80), cancelled: false }, { onConflict: 'order_code' });
        if (e2) return json({ ok: false, error: e2.message }, 500);
        await sleep(150);
      }
      const remaining = todo.length - part.length;
      // staré záznamy mimo okno se uklidí
      const cut = new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10);
      await sb.from('stk_sales').delete().lt('sold_at', cut); await sb.from('stk_sales_orders').delete().lt('sold_at', cut);
      if (!remaining) await sb.from('stk_config').update({ sales_synced_at: now }).eq('id', 1);
      return json({ ok: true, orders: list.length, processed: part.length, lines, remaining });
    }
    return json({ error: 'Neznámá akce.' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
