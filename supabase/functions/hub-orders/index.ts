// Vinylor Hub · Edge Function „hub-orders“ — propsání čísla objednávky u dodavatele do objednávky ve Shoptetu.
// Token je v Supabase Secrets (SHOPTET_API_TOKEN). Smí ji volat jen aktivní uživatel s 2FA (AAL2).
//   { action: 'supplier_ref', orderCode, supplier, ref, setStatus }
//     → do interní poznámky objednávky ve Shoptetu přidá řádek „Obj. u dodavatele (Gunreben): …“
//       a (když setStatus) přepne objednávku do stavu „Čeká na zboží“ (název jde změnit v Nastavení: ojWaitStatusName).
//   Šetrné k zákazníkovi: e-mail o změně stavu se standardně NEPOSÍLÁ (Nastavení: ojWaitEmail = '1' ho zapne).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const BASE = 'https://api.myshoptet.com/api';
const fold = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function claims(jwt: string): Record<string, unknown> {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
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
    const token = Deno.env.get('SHOPTET_API_TOKEN');
    if (!token) return json({ error: 'V Supabase Secrets chybí SHOPTET_API_TOKEN.' }, 503);

    const hdr = { 'Shoptet-Private-API-Token': token, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    const call = async (method: string, path: string, body?: unknown) => {
      const r = await fetch(BASE + path, { method, headers: hdr, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* ne JSON */ }
      return { status: r.status, json: j, text: j ? '' : t.slice(0, 200) };
    };
    const errText = (r: { json: any; text: string; status: number }) =>
      (r.json?.errors ? r.json.errors.map((e: any) => e.message || e.errorCode).filter(Boolean).join('; ') : r.text) || ('HTTP ' + r.status);
    const audit = (action: string, detail: Record<string, unknown>) => sb.from('hub_audit').insert({ actor: u.user.id, action, detail });
    const b = await req.json().catch(() => ({}));

    if (b.action === 'supplier_ref') {
      const orderCode = String(b.orderCode || '').trim();
      const supplier = String(b.supplier || '').trim().slice(0, 60);
      const ref = String(b.ref || '').trim().slice(0, 80);
      if (!/^[A-Za-z0-9_-]{3,40}$/.test(orderCode)) return json({ error: 'Neplatné číslo objednávky.' }, 400);
      if (!ref) return json({ error: 'Chybí číslo objednávky u dodavatele.' }, 400);
      // zapisujeme jen do objednávek, které sem přišly ze Shoptetu (ne do ručních)
      const { data: oo } = await sb.from('oj_orders').select('code, manual').eq('code', orderCode).maybeSingle();
      if (!oo || oo.manual) return json({ error: 'Tahle objednávka nepochází ze Shoptetu — nic jsem do něj nezapsal.' }, 409);
      const { data: cfg } = await sb.from('hub_settings').select('data').eq('id', 1).single();
      const waitName = String(cfg?.data?.ojWaitStatusName || 'Čeká na zboží');
      const sendEmail = cfg?.data?.ojWaitEmail === '1';

      const g = await call('GET', '/orders/' + encodeURIComponent(orderCode));
      if (g.status !== 200) return json({ error: `Shoptet: objednávka ${orderCode} — ` + errText(g) }, 502);
      const order = g.json?.data?.order || {};
      const result: Record<string, unknown> = { ok: true, order: orderCode };

      // 1) interní poznámka: přidat řádek (bez duplicit)
      const line = `Obj. u dodavatele${supplier ? ' (' + supplier + ')' : ''}: ${ref}`;
      const cur = String(order.notes?.eshopRemark || '');
      if (cur.includes(line)) result.remark = 'exists';
      else {
        const next = (cur ? cur.replace(/\s+$/, '') + '\n' : '') + line;
        let r = await call('PATCH', `/orders/${encodeURIComponent(orderCode)}/notes`, { data: { eshopRemark: next.slice(0, 4000) } });
        if (r.status === 404 || r.status === 405) r = await call('PATCH', `/orders/${encodeURIComponent(orderCode)}`, { data: { notes: { eshopRemark: next.slice(0, 4000) } } });
        const bad = r.status !== 200 || (r.json?.errors && r.json.errors.length);
        result.remark = bad ? 'failed' : 'added';
        if (bad) result.remarkError = errText(r);
      }

      // 2) stav „Čeká na zboží“
      if (b.setStatus) {
        const st = await call('GET', '/orders/statuses');
        const list: { id: number; name: string }[] = (st.json?.data?.statuses || []).map((s: any) => ({ id: s.id, name: s.name }));
        const want = list.find(s => fold(s.name) === fold(waitName));
        if (!want) { result.status = 'notfound'; result.statusError = `Stav „${waitName}“ ve Shoptetu nenalezen. Dostupné: ` + list.map(s => s.name).join(', '); }
        else if (Number(order.status?.id) === want.id) { result.status = 'already'; result.statusName = want.name; }
        else {
          // e-mail / SMS zákazníkovi se potlačují parametry v URL (jako u zakládání objednávky), ne v těle požadavku
          const qs = sendEmail ? '' : '?suppressEmailSending=true&suppressSmsSending=true';
          const body = { data: { statusId: want.id } };
          let r = await call('PATCH', `/orders/${encodeURIComponent(orderCode)}/status${qs}`, body);
          if (r.status === 404 || r.status === 405) r = await call('PATCH', `/orders/${encodeURIComponent(orderCode)}${qs}`, body);
          const bad = r.status !== 200 || (r.json?.errors && r.json.errors.length);
          result.status = bad ? 'failed' : 'changed'; result.statusName = want.name;
          if (bad) result.statusError = errText(r);
        }
      }
      await audit('shoptet_order_supplier_ref', { order: orderCode, supplier, ref, remark: result.remark, status: result.status ?? null });
      return json(result);
    }
    return json({ error: 'Neznámá akce' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
