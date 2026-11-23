// Vinylor Hub · Edge Function „hub-cnb-rate“
// Vrátí kurz ČNB pro zadanou měnu a datum (api.cnb.cz nepovoluje volání přímo z prohlížeče).
//   GET ?currency=EUR&date=2026-10-17  →  { rate, validFor }
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function claims(jwt: string): Record<string, unknown> {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (claims((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')).aal !== 'aal2') return json({ error: 'Vyžaduje dvoufázové ověření.' }, 403);
    const u = new URL(req.url);
    let currency = u.searchParams.get('currency') || 'EUR';
    let date = u.searchParams.get('date') || '';
    if (req.method === 'POST') { const b = await req.json().catch(() => ({})); currency = b.currency || currency; date = b.date || date; }
    if (!/^[A-Z]{3}$/.test(currency)) return json({ error: 'Neplatná měna' }, 400);
    const q = new URLSearchParams({ lang: 'CZ' });
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) q.set('date', date);
    const r = await fetch('https://api.cnb.cz/cnbapi/exrates/daily?' + q);
    if (!r.ok) return json({ error: 'ČNB vrátila HTTP ' + r.status }, 502);
    const d = await r.json();
    const x = (d.rates || []).find((e: { currencyCode: string }) => e.currencyCode === currency);
    if (!x) return json({ error: 'Kurz nenalezen' }, 404);
    return json({ rate: x.rate / (x.amount || 1), validFor: x.validFor });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
