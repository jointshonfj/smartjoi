// Vinylor Hub · Edge Function „hub-shoptet“ — jediné místo, které mluví se Shoptet Private API.
// Token je v Supabase Secrets (SHOPTET_API_TOKEN), nikdy se nevrací do prohlížeče.
// Smí ji volat jen přihlášený aktivní uživatel s dokončeným 2FA (AAL2). Každý zápis jde do bezpečnostního deníku.
//   { action: 'status' }                                   → spojení, sklady, stavy objednávek (jen správce)
//   { action: 'stock_in', receiptId, stockId, items: [{ id, code, amount }] }  → naskladnění (jen přírůstek, nikdy přepsání)
//   { action: 'order_options' }                            → způsoby platby a dopravy, stavy objednávek (pro dialog překlopení)
//   { action: 'oj_sync' }                                  → OrderJoi: načte objednávky ve stavu „Potřeba objednat“
//   { action: 'svoz_stock_in', shipmentId, stockId }       → OrderJoi: svoz dorazil → naskladnění všech řádků
//   { action: 'inv_supplies', stockId, codes? }           → Inventura: aktuální zásoby ze Shoptetu (jen čtení)
//   { action: 'inv_apply', sessionId, stockId, items: [{ id, code, counted, system }] } → Inventura: nastaví fyzický stav (realStock) po schválení
//   { action: 'order_create', offerId, paymentGuid, shippingGuid, shippingPriceVat, statusId, sendEmail, allowNegative? }  → nabídka → objednávka (allowNegative: založit i při nedostatku na skladě, sklad se stáhne do mínusu)
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const BASE = 'https://api.myshoptet.com/api';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));


// --- výpočet ceny: stejný jako v aplikaci (calc.js), aby objednávka seděla s nabídkou na haléř ---
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
function unitNet(priceVat: number, vat: number, step: number) {
  const net = r2(priceVat / (1 + vat / 100)); const st = step || 0.01;
  return r2(Math.round(net / st + 1e-9) * st);
}
function lineOf(it: any, step: number) {
  const qty = Number(it.qty || 0), vat = Number(it.vatRate ?? 21), disc = Number(it.discount || 0);
  const jc = unitNet(Number(it.priceVat || 0), vat, step);
  const net = r2(qty * jc * (1 - disc / 100)); const tax = r2(net * vat / 100);
  return { jc, net, tax, total: r2(net + tax) };
}
const COUNTRY: Record<string, string> = { 'česká republika': 'CZ', 'česko': 'CZ', 'czech republic': 'CZ', 'slovensko': 'SK', 'slovenská republika': 'SK', 'německo': 'DE', 'polsko': 'PL', 'rakousko': 'AT' };
function normPhone(raw: string): string | null {
  const d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (/^\+\d{9,15}$/.test(d)) return d;
  if (/^00\d{9,15}$/.test(d)) return '+' + d.slice(2);
  if (/^\d{9}$/.test(d)) return '+420' + d;
  if (/^\d{11,13}$/.test(d)) return '+' + d;
  return null;
}

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

    if (b.action === 'status') {
      if (me.role !== 'admin') return json({ error: 'Jen pro správce.' }, 403);
      const [eshop, stocks, statuses, products] = await Promise.all([
        call('GET', '/eshop'), call('GET', '/stocks'), call('GET', '/orders/statuses'), call('GET', '/products?itemsPerPage=1'),
      ]);
      if (eshop.status === 401 || eshop.status === 403) return json({ ok: false, error: 'Shoptet odmítl token (' + errText(eshop) + '). Zkontroluj ho v administraci.' });
      const d = eshop.json?.data || {};
      return json({
        ok: eshop.status === 200,
        shop: { company: d.contactInformation?.company || d.billingInformation?.company || null, urls: d.urls ?? null },
        stocks: (stocks.json?.data?.stocks || []).map((s: any) => ({ id: s.id, title: s.title })),
        defaultStockId: stocks.json?.data?.defaultStockId ?? null,
        statuses: (statuses.json?.data?.statuses || []).map((s: any) => ({ id: s.id, name: s.name })),
        products: products.json?.data?.paginator?.totalCount ?? null,
      });
    }

    if (b.action === 'stock_in') {
      const stockId = Number(b.stockId);
      const receiptId = String(b.receiptId || '');
      const items = Array.isArray(b.items) ? b.items : [];
      if (!Number.isInteger(stockId) || !/^[0-9a-f-]{36}$/.test(receiptId)) return json({ error: 'Neplatná příjemka nebo sklad.' }, 400);
      if (!items.length || items.length > 100) return json({ error: 'Pošli 1 až 100 položek.' }, 400);
      const { data: rc } = await sb.from('stock_receipts').select('id').eq('id', receiptId).eq('deleted', false).maybeSingle();
      if (!rc) return json({ error: 'Příjemka nenalezena.' }, 404);
      const stocks = await call('GET', '/stocks');
      if (!(stocks.json?.data?.stocks || []).some((s: any) => s.id === stockId)) return json({ error: 'Takový sklad ve Shoptetu neexistuje.' }, 400);

      const results: { id: string; code: string; status: string; message?: string }[] = [];
      for (const it of items) {
        const id = String(it.id || '').slice(0, 40), code = String(it.code || '').trim().slice(0, 64), amount = Number(it.amount);
        if (!id || !code || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) { results.push({ id, code, status: 'error', message: 'Neplatný kód nebo množství.' }); continue; }
        // 1) zamknout položku v deníku PŘED odesláním
        const { error: le } = await sb.from('shoptet_stock_log').insert({ receipt_id: receiptId, item_id: id, code, amount, stock_id: stockId, actor: u.user.id });
        if (le) {
          if ((le as { code?: string }).code === '23505') results.push({ id, code, status: 'duplicate', message: 'Tato položka už byla do Shoptetu odeslána.' });
          else results.push({ id, code, status: 'error', message: le.message });
          continue;
        }
        // 2) odeslat přírůstek (amountChange = relativní změna, nikdy absolutní přepsání)
        let r;
        try { r = await call('PATCH', `/stocks/${stockId}/movements`, { data: [{ productCode: code, amountChange: amount }] }); }
        catch (e) { r = { status: 0, json: null, text: (e as Error).message }; }
        const failed = r.status !== 200 || (r.json?.errors && r.json.errors.length);
        if (failed) {
          // chyba je jednoznačná (Shoptet nic nezapsal) → odemknout, ať jde zkusit znovu. Při výpadku spojení (status 0) zámek ZŮSTÁVÁ.
          if (r.status !== 0) await sb.from('shoptet_stock_log').delete().eq('receipt_id', receiptId).eq('item_id', id);
          results.push({ id, code, status: 'error', message: r.status === 0 ? 'Spojení se Shoptetem se přerušilo — ověř stav ve Shoptetu a napiš správci, než to zkusíš znovu.' : errText(r) });
        } else {
          await sb.from('shoptet_stock_log').update({ request_id: r.json?.metadata?.requestId ?? null }).eq('receipt_id', receiptId).eq('item_id', id);
          results.push({ id, code, status: 'ok' });
        }
        await sleep(250); // šetříme limity Shoptet API
      }
      await audit('shoptet_stock_in', { receipt: receiptId, stock: stockId, ok: results.filter(x => x.status === 'ok').length, failed: results.filter(x => x.status === 'error').length, duplicate: results.filter(x => x.status === 'duplicate').length });
      return json({ ok: true, results });
    }

    if (b.action === 'order_options') {
      const [e, st] = await Promise.all([call('GET', '/eshop?include=paymentMethods,shippingMethods'), call('GET', '/orders/statuses')]);
      const d = e.json?.data || {};
      const vis = (g: any) => (g?.retail?.methods || []).filter((m: any) => m.visible).map((m: any) => ({ guid: m.guid, name: m.name }));
      return json({ ok: e.status === 200, payments: vis(d.paymentMethods), shippings: vis(d.shippingMethods), statuses: (st.json?.data?.statuses || []).map((x: any) => ({ id: x.id, name: x.name })) });
    }

    if (b.action === 'order_create') {
      const offerId = String(b.offerId || '');
      if (!/^[0-9a-f-]{36}$/.test(offerId)) return json({ error: 'Neplatná nabídka.' }, 400);
      const payGuid = String(b.paymentGuid || ''), shipGuid = String(b.shippingGuid || '');
      if (!/^[0-9a-f-]{36}$/.test(payGuid) || !/^[0-9a-f-]{36}$/.test(shipGuid)) return json({ error: 'Vyber způsob platby a dopravy.' }, 400);
      const statusId = Number(b.statusId ?? -1);
      const shipPrice = Math.max(0, Number(b.shippingPriceVat || 0));
      if (!Number.isInteger(statusId) || !Number.isFinite(shipPrice) || shipPrice > 1_000_000) return json({ error: 'Neplatný stav nebo cena dopravy.' }, 400);

      const { data: offer } = await sb.from('offers').select('*').eq('id', offerId).eq('deleted', false).maybeSingle();
      if (!offer) return json({ error: 'Nabídka nenalezena.' }, 404);
      if (offer.shoptet_order) return json({ error: `Nabídka je už propojená s objednávkou ${offer.shoptet_order}.` }, 409);
      const { data: cfg } = await sb.from('hub_settings').select('data').eq('id', 1).single();
      const step = Number(cfg?.data?.priceStep) || 0.1;
      const stockId = Number(cfg?.data?.shoptetStockId) || 1;
      const c = offer.customer || {};
      const items: any[] = Array.isArray(offer.items) ? offer.items : [];

      // --- kontrola údajů (srozumitelné chyby ještě před odesláním) ---
      const problems: string[] = []; const warnings: string[] = [];
      if (!items.length) problems.push('Nabídka nemá žádné položky.');
      const noCode = items.filter(i => !String(i.code || '').trim());
      if (noCode.length) problems.push(`Položky bez kódu produktu se do Shoptetu nepřenesou: ${noCode.map(i => i.name || 'bez názvu').slice(0, 4).join(', ')}. Doplň kód z e-shopu, nebo položku odeber.`);
      if (items.some(i => !(Number(i.qty) > 0))) problems.push('Některá položka má nulové množství.');
      const fullName = String(c.name || c.company || '').trim();
      if (!fullName) problems.push('Doplň jméno nebo firmu zákazníka.');
      const email = String(c.email || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push('Doplň platný e-mail zákazníka (Shoptet ho vyžaduje).');
      const street = String(c.street || '').trim();
      if (!street) problems.push('Doplň ulici zákazníka.');
      const zm = String(c.city || '').trim().match(/^(\d{3}\s?\d{2})\s+(.+)$/);
      if (!zm) problems.push('Doplň „PSČ a město“ ve tvaru např. 150 01 Praha.');
      const country = COUNTRY[String(c.country || 'Česká republika').toLowerCase().trim()];
      if (!country) problems.push(`Neznámá země „${c.country}“ — použij Česká republika / Slovensko / Německo / Polsko / Rakousko.`);
      if (problems.length) return json({ ok: false, problems });
      let phone = normPhone(c.phone || '');
      if (c.phone && !phone) warnings.push(`Telefon „${c.phone}“ má nepoužitelný formát, do objednávky se nepřenesl.`);

      // --- zámek: jedna nabídka = nejvýš jedna objednávka ---
      const totals = items.map(i => lineOf(i, step));
      const offerNet = r2(totals.reduce((a, x) => a + x.net, 0)); const offerTotal = r2(totals.reduce((a, x) => a + x.total, 0));
      const { error: le } = await sb.from('shoptet_order_log').insert({ offer_id: offerId, actor: u.user.id, total_offer: offerTotal });
      if (le) return json({ error: (le as { code?: string }).code === '23505' ? 'Z této nabídky už se objednávka zakládá nebo byla založena. Zkontroluj Shoptet.' : le.message }, 409);

      // interní poznámka v objednávce (zákazník ji nevidí): odkud objednávka vznikla a z jaké nabídky
      const { data: people } = await sb.from('hub_profiles').select('id, name').in('id', [offer.issued_by, u.user.id].filter(Boolean));
      const nameOf = (id: string) => (people || []).find((x: { id: string }) => x.id === id)?.name || '';
      const remark = `Vytvořeno z nabídky č. ${offer.number} ve Vinylor Hubu` + (b.allowNegative === true ? ' · sklad stažen do mínusu (potvrzeno)' : '') + (nameOf(offer.issued_by) ? ` · vystavil(a): ${nameOf(offer.issued_by)}` : '') + (nameOf(u.user.id) ? ` · překlopil(a): ${nameOf(u.user.id)}` : '') + ` · ${new Date().toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' })}`;

      const payload = {
        data: {
          externalCode: String(offer.number).slice(0, 255), email, phone: phone || undefined,
          notes: { eshopRemark: remark.slice(0, 1000) },
          statusId, sourceId: -2, language: 'cs', vatPayer: true, vatMode: 'Normal', addressesEqual: true, stockId,
          paymentMethodGuid: payGuid, shippingGuid: shipGuid, currency: { code: 'CZK' },
          billingAddress: {
            company: c.company ? String(c.company).slice(0, 255) : undefined, fullName: fullName.slice(0, 255), street: street.slice(0, 255),
            city: zm![2].trim().slice(0, 255), zip: zm![1].replace(/\s/g, '').replace(/^(\d{3})(\d{2})$/, '$1 $2'), countryCode: country,
            companyId: c.ico ? String(c.ico).slice(0, 18) : undefined, taxId: c.dic ? String(c.dic).slice(0, 16) : undefined, vatId: c.dic ? String(c.dic).slice(0, 16) : undefined,
          },
          items: [
            ...items.map((i, k) => ({
              itemType: 'product', code: String(i.code).trim().slice(0, 64), name: `${i.name || ''}${i.variant ? ', ' + i.variant : ''}`.slice(0, 250),
              amount: String(i.qty), amountUnit: String(i.unit || 'ks').slice(0, 16), vatRate: Number(i.vatRate ?? 21).toFixed(2),
              unitPriceWithoutVat: totals[k].jc.toFixed(2), priceRatio: (1 - Number(i.discount || 0) / 100).toFixed(4),
            })),
            { itemType: 'billing', name: String(b.paymentName || 'Platba').slice(0, 250), vatRate: '21.00', itemPriceWithVat: '0' },
            { itemType: 'shipping', name: String(b.shippingName || 'Doprava').slice(0, 250), vatRate: '21.00', itemPriceWithVat: shipPrice.toFixed(2) },
          ],
        },
      };
      // nedostatek na skladě: Shoptet objednávku nepustí, pokud produkt nesmí do mínusu. S potvrzením uživatele ji založíme bez automatického stažení ze skladu
      // (suppressStockMovements) a sklad pak stáhneme sami zvlášť, aby šlo případně zjistit, co se povedlo.
      const allowNeg = b.allowNegative === true;
      const qp = [b.sendEmail ? '' : 'suppressEmailSending=true', allowNeg ? 'suppressStockMovements=true' : ''].filter(Boolean);
      const q = qp.length ? '?' + qp.join('&') : '';
      let r;
      try { r = await call('POST', '/orders' + q, payload); } catch (e) { r = { status: 0, json: null, text: (e as Error).message }; }
      const order = r.json?.data?.order;
      if (!order?.code) {
        if (r.status !== 0) await sb.from('shoptet_order_log').delete().eq('offer_id', offerId); // jednoznačné selhání → jde zkusit znovu
        const msg = r.status === 0 ? 'Spojení se Shoptetem se přerušilo. Než to zkusíš znovu, zkontroluj ve Shoptetu, zda objednávka nevznikla, a napiš správci.' : 'Shoptet objednávku odmítl: ' + errText(r);
        const stockShort = r.status !== 0 && !allowNeg && /sklad|zásob|zasob|stock|inventor|dostupn|available|množstv|mnozstv|amount|quantity/i.test(errText(r));
        await audit('shoptet_order_rejected', { offer: offer.number, status: r.status, error: errText(r).slice(0, 400), stockShort });
        return json({ ok: false, stockShort, problems: [msg] });
      }
      const negMoves: { code: string; ok: boolean; message?: string }[] = [];
      if (allowNeg) {
        // sklad stáhneme položku po položce (relativní změna), případné chyby půjdou do upozornění
        for (const i of items) {
          const code = String(i.code).trim().slice(0, 64);
          let mv;
          try { mv = await call('PATCH', `/stocks/${stockId}/movements`, { data: [{ productCode: code, amountChange: -Number(i.qty) }] }); } catch (e) { mv = { status: 0, json: null, text: (e as Error).message }; }
          const bad = mv.status !== 200 || (mv.json?.errors && mv.json.errors.length);
          negMoves.push({ code, ok: !bad, message: bad ? (mv.status === 0 ? 'spojení se přerušilo' : errText(mv)) : undefined });
          await sleep(250);
        }
        for (const m of negMoves.filter(x => !x.ok)) warnings.push(`Sklad u ${m.code} se nepodařilo stáhnout (${m.message}). Objednávka je založená — stáhni zboží ručně ve Shoptetu.`);
      }
      const shoptetTotal = Number(order.price?.withVat ?? NaN);
      await sb.from('shoptet_order_log').update({ order_code: order.code, total_shoptet: Number.isFinite(shoptetTotal) ? shoptetTotal : null }).eq('offer_id', offerId);
      // nabídka → stav „Překlopena do Shoptetu“ + číslo objednávky + historie
      await sb.from('offers').update({ status: 'confirmed', status_at: new Date().toISOString(), shoptet_order: String(order.code) }).eq('id', offerId);
      await sb.from('offer_history').insert({ offer_id: offerId, author: u.user.id, action: 'status', from_status: offer.status, to_status: 'confirmed', note: 'objednávka ' + order.code });
      await audit('shoptet_order_create', { offer: offer.number, order: order.code, offerTotal, shoptetTotal: Number.isFinite(shoptetTotal) ? shoptetTotal : null, negativeStock: allowNeg, movesFailed: negMoves.filter(x => !x.ok).length });
      const diff = Number.isFinite(shoptetTotal) ? r2(shoptetTotal - offerTotal) : null;
      if (diff !== null && Math.abs(diff) > 0.05) warnings.push(`Celkem v nabídce je ${offerTotal.toFixed(2)} Kč, ve Shoptetu ${shoptetTotal.toFixed(2)} Kč (rozdíl ${diff.toFixed(2)} Kč). Zkontroluj objednávku.`);
      const adminUrl = typeof order.adminUrl === 'string' && order.adminUrl.startsWith('https://www.vinylor.cz/admin/') ? order.adminUrl : null;
      return json({ ok: true, negative: allowNeg, code: order.code, adminUrl, offerTotal, offerNet, shoptetTotal: Number.isFinite(shoptetTotal) ? shoptetTotal : null, toPay: order.price?.toPay ?? null, warnings });
    }
    // ---- OrderJoi: objednávky ve stavu „Potřeba objednat“ → položky k objednání ----
    if (b.action === 'oj_sync') {
      const { data: cfg } = await sb.from('hub_settings').select('data').eq('id', 1).single();
      const statusId = Number(cfg?.data?.ojStatusId) || 87;
      const list: any[] = [];
      for (let page = 1; page <= 5; page++) {
        const r = await call('GET', `/orders?statusId=${statusId}&itemsPerPage=50&page=${page}`);
        if (r.status !== 200) return json({ ok: false, error: 'Shoptet: ' + errText(r) });
        list.push(...(r.json?.data?.orders || []));
        if (page >= (r.json?.data?.paginator?.pageCount || 1)) break;
      }
      const now = new Date().toISOString();
      const items: any[] = []; const prods = new Map<string, any>(); const seenOrders: string[] = [];
      for (const o of list.slice(0, 150)) {
        const d = await call('GET', '/orders/' + encodeURIComponent(o.code));
        if (d.status !== 200) return json({ ok: false, error: `Objednávka ${o.code}: ` + errText(d) });
        const od = d.json?.data?.order || {};
        seenOrders.push(String(o.code));
        const sum = new Map<string, any>();
        for (const it of od.items || []) {
          if (it.itemType !== 'product') continue;
          const code = String(it.code || '').trim(); if (!code) continue;
          const qty = Number(it.amount) || 0; if (qty <= 0) continue;
          const key = o.code + '|' + code;
          const ex = sum.get(key);
          if (ex) { ex.qty += qty; continue; }
          const customer = String(o.company || o.fullName || '').slice(0, 120);
          sum.set(key, { key, order_code: String(o.code), code, name: String(it.name || code).slice(0, 250), qty, unit: String(it.amountUnit || 'ks').slice(0, 16), customer, order_date: String(o.creationTime || '').slice(0, 10), active: true, last_seen: now });
          if (!prods.has(code)) prods.set(code, { code, name: String(it.name || code).slice(0, 250), shoptet_supplier: String(it.supplierName || '').slice(0, 120) });
        }
        items.push(...sum.values());
        await sleep(150);
      }
      // hlavičky objednávek (kód, datum, zákazník, stav ve Shoptetu); ručně zadané objednávky se nemažou
      const ords = list.slice(0, 150).map((o: any) => ({ code: String(o.code), order_date: String(o.creationTime || '').slice(0, 10), customer: String(o.company || o.fullName || '').slice(0, 120), shoptet_status: String(o.status?.name || ''), active: true, updated_at: now }));
      for (let i = 0; i < ords.length; i += 200) {
        const { error } = await sb.from('oj_orders').upsert(ords.slice(i, i + 200), { onConflict: 'code' });
        if (error) return json({ ok: false, error: error.message });
      }
      for (let i = 0; i < items.length; i += 200) {
        const { error } = await sb.from('oj_items').upsert(items.slice(i, i + 200), { onConflict: 'key' });
        if (error) return json({ ok: false, error: error.message });
      }
      const pl = [...prods.values()];
      for (let i = 0; i < pl.length; i += 200) {
        const { error } = await sb.from('oj_products').upsert(pl.slice(i, i + 200), { onConflict: 'code', ignoreDuplicates: true });
        if (error) return json({ ok: false, error: error.message });
      }
      // doplnit dodavatele ze Shoptetu produktům, kterým ho ještě nikdo nenastavil
      for (const p of pl) if (p.shoptet_supplier) await sb.from('oj_products').update({ shoptet_supplier: p.shoptet_supplier }).eq('code', p.code).eq('shoptet_supplier', '');
      const keep = new Set(items.map(i => i.key));
      const { data: act } = await sb.from('oj_items').select('key').eq('active', true).eq('manual', false).limit(10000);
      const gone = (act || []).map((r: { key: string }) => r.key).filter((k: string) => !keep.has(k));
      for (let i = 0; i < gone.length; i += 200) await sb.from('oj_items').update({ active: false }).in('key', gone.slice(i, i + 200));
      // objednávky, které už nejsou ve stavu „Potřeba objednat“, jen označit (zůstávají, dokud se nedoručí)
      const keepOrders = new Set(ords.map((o: any) => o.code));
      const { data: actO } = await sb.from('oj_orders').select('code').eq('active', true).eq('manual', false);
      const goneO = (actO || []).map((r: { code: string }) => r.code).filter((c: string) => !keepOrders.has(c));
      for (let i = 0; i < goneO.length; i += 200) await sb.from('oj_orders').update({ active: false, updated_at: now }).in('code', goneO.slice(i, i + 200));
      await sb.from('hub_settings').update({ data: { ...(cfg?.data || {}), ojLastSync: now } }).eq('id', 1);
      return json({ ok: true, orders: seenOrders.length, items: items.length, removed: gone.length, at: now });
    }

    // ---- OrderJoi: svoz dorazil → naskladnit všechny řádky do Shoptetu (jen přírůstek) ----
    if (b.action === 'svoz_stock_in') {
      const shipmentId = String(b.shipmentId || ''); const stockId = Number(b.stockId);
      if (!/^[0-9a-f-]{36}$/.test(shipmentId) || !Number.isInteger(stockId)) return json({ error: 'Neplatný svoz nebo sklad.' }, 400);
      const { data: sh } = await sb.from('oj_shipments').select('*').eq('id', shipmentId).eq('deleted', false).maybeSingle();
      if (!sh) return json({ error: 'Svoz nenalezen.' }, 404);
      if (!['arrived', 'stocked'].includes(sh.status)) return json({ error: 'Svoz musí být ve stavu „Dorazil“. Nejdřív ho tak označ.' }, 409);
      const stocks = await call('GET', '/stocks');
      if (!(stocks.json?.data?.stocks || []).some((s: any) => s.id === stockId)) return json({ error: 'Takový sklad ve Shoptetu neexistuje.' }, 400);
      const lines: any[] = Array.isArray(sh.lines) ? sh.lines : [];
      if (!lines.length || lines.length > 150) return json({ error: 'Svoz má 1 až 150 řádků.' }, 400);
      const results: { id: string; code: string; status: string; message?: string }[] = [];
      for (const ln of lines) {
        const id = String(ln.id || '').slice(0, 40), code = String(ln.code || '').trim().slice(0, 64);
        const amount = Number(ln.got ?? ln.qty);
        if (ln.stocked) { results.push({ id, code, status: 'duplicate', message: 'Už naskladněno.' }); continue; }
        if (ln.skip) { results.push({ id, code, status: 'skipped' }); continue; }
        if (!id || !code || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) { results.push({ id, code, status: 'error', message: 'Neplatný kód nebo množství.' }); continue; }
        const { error: le } = await sb.from('shoptet_svoz_log').insert({ shipment_id: shipmentId, line_id: id, code, amount, stock_id: stockId, actor: u.user.id });
        if (le) { results.push({ id, code, status: (le as { code?: string }).code === '23505' ? 'duplicate' : 'error', message: (le as { code?: string }).code === '23505' ? 'Tato položka už byla do Shoptetu odeslána.' : le.message }); continue; }
        let r;
        try { r = await call('PATCH', `/stocks/${stockId}/movements`, { data: [{ productCode: code, amountChange: amount }] }); }
        catch (e) { r = { status: 0, json: null, text: (e as Error).message }; }
        const failed = r.status !== 200 || (r.json?.errors && r.json.errors.length);
        if (failed) {
          if (r.status !== 0) await sb.from('shoptet_svoz_log').delete().eq('shipment_id', shipmentId).eq('line_id', id);
          results.push({ id, code, status: 'error', message: r.status === 0 ? 'Spojení se Shoptetem se přerušilo — ověř stav ve Shoptetu a napiš správci, než to zkusíš znovu.' : errText(r) });
        } else {
          await sb.from('shoptet_svoz_log').update({ request_id: r.json?.metadata?.requestId ?? null }).eq('shipment_id', shipmentId).eq('line_id', id);
          results.push({ id, code, status: 'ok' });
        }
        await sleep(250);
      }
      const okIds = new Set(results.filter(x => x.status === 'ok').map(x => x.id));
      const { data: fresh } = await sb.from('oj_shipments').select('lines').eq('id', shipmentId).single();
      const upd = (fresh?.lines || lines).map((l: any) => okIds.has(String(l.id)) ? { ...l, stocked: true } : l);
      const all = upd.every((l: any) => l.stocked || l.skip);
      await sb.from('oj_shipments').update({ lines: upd, stock_id: stockId, updated_at: new Date().toISOString(), ...(all ? { status: 'stocked', stocked_at: new Date().toISOString() } : {}) }).eq('id', shipmentId);
      await audit('shoptet_svoz_stock_in', { shipment: shipmentId, stock: stockId, ok: okIds.size, failed: results.filter(x => x.status === 'error').length });
      return json({ ok: true, results, all });
    }
    // --- Inventura: přečtení aktuálních zásob (jen čtení) ---
    if (b.action === 'inv_supplies') {
      const stockId = Number(b.stockId);
      if (!Number.isInteger(stockId)) return json({ error: 'Neplatný sklad.' }, 400);
      const want = Array.isArray(b.codes) && b.codes.length ? new Set(b.codes.map((c: unknown) => String(c).trim())) : null;
      const AMT = ['realStock', 'amount', 'quantity', 'amountInStock', 'inStock'];
      const map: Record<string, number> = {}; let sample: any = null; let unknownShape = false; let total = 0;
      for (let page = 1; page <= 30; page++) {
        const r = await call('GET', `/stocks/${stockId}/supplies?itemsPerPage=1000&page=${page}`);
        if (r.status !== 200) return json({ error: 'Shoptet nevrátil zásoby: ' + errText(r) }, 502);
        const rows: any[] = r.json?.data?.supplies || [];
        if (!sample && rows.length) sample = rows[0];
        for (const it of rows) {
          const code = String(it.code ?? it.productCode ?? '').trim(); if (!code) continue;
          total++;
          if (want && !want.has(code)) continue;
          const f = AMT.find(k => it[k] != null && Number.isFinite(Number(it[k])));
          if (!f) { unknownShape = true; continue; }
          map[code] = Number(it[f]);
        }
        const pages = Number(r.json?.data?.paginator?.pageCount ?? 0);
        if (rows.length < 1000 || (pages && page >= pages)) break;
        await sleep(250);
      }
      return json({ ok: true, supplies: map, total, unknownShape, sampleKeys: sample ? Object.keys(sample) : [] });
    }

    // --- Inventura: nastavení fyzického stavu (realStock = napočteno) po schválení ---
    if (b.action === 'inv_apply') {
      const stockId = Number(b.stockId); const sessionId = String(b.sessionId || '');
      const items = Array.isArray(b.items) ? b.items : [];
      if (!Number.isInteger(stockId) || !/^[0-9a-f-]{36}$/.test(sessionId)) return json({ error: 'Neplatná inventura nebo sklad.' }, 400);
      if (!items.length || items.length > 100) return json({ error: 'Pošli 1 až 100 položek.' }, 400);
      const { data: ses } = await sb.from('inv_sessions').select('id,status').eq('id', sessionId).maybeSingle();
      if (!ses) return json({ error: 'Inventura nenalezena.' }, 404);
      if (ses.status !== 'review') return json({ error: 'Inventura musí být ve stavu „ke schválení“.' }, 400);
      const stocks = await call('GET', '/stocks');
      if (!(stocks.json?.data?.stocks || []).some((s: any) => s.id === stockId)) return json({ error: 'Takový sklad ve Shoptetu neexistuje.' }, 400);
      const results: { id: string; code: string; status: string; message?: string }[] = [];
      for (const it of items) {
        const id = String(it.id || '').slice(0, 40), code = String(it.code || '').trim().slice(0, 64), counted = Number(it.counted);
        const system = it.system == null || it.system === '' ? null : Number(it.system);
        if (!id || !code || !Number.isFinite(counted) || counted < 0 || counted > 1_000_000) { results.push({ id, code, status: 'error', message: 'Neplatný kód nebo množství.' }); continue; }
        const { data: row } = await sb.from('inv_items').select('id,counted_qty,applied_at').eq('id', id).eq('session_id', sessionId).maybeSingle();
        if (!row || Number(row.counted_qty) !== counted) { results.push({ id, code, status: 'error', message: 'Položka v inventuře neodpovídá odeslané hodnotě — načti stránku znovu.' }); continue; }
        const { error: le } = await sb.from('inv_apply_log').insert({ session_id: sessionId, item_id: id, code, counted, system_qty: Number.isFinite(system as number) ? system : null, stock_id: stockId, actor: u.user.id });
        if (le) { results.push({ id, code, status: (le as { code?: string }).code === '23505' ? 'duplicate' : 'error', message: (le as { code?: string }).code === '23505' ? 'Tato položka už byla do Shoptetu odeslána.' : le.message }); continue; }
        let r;
        try { r = await call('PATCH', `/stocks/${stockId}/movements`, { data: [{ productCode: code, realStock: counted }] }); }
        catch (e) { r = { status: 0, json: null, text: (e as Error).message }; }
        const failed = r.status !== 200 || (r.json?.errors && r.json.errors.length);
        if (failed) {
          if (r.status !== 0) await sb.from('inv_apply_log').delete().eq('session_id', sessionId).eq('item_id', id);
          results.push({ id, code, status: 'error', message: r.status === 0 ? 'Spojení se Shoptetem se přerušilo — ověř stav ve Shoptetu a napiš správci, než to zkusíš znovu.' : errText(r) });
        } else {
          await sb.from('inv_apply_log').update({ request_id: r.json?.metadata?.requestId ?? null }).eq('session_id', sessionId).eq('item_id', id);
          await sb.from('inv_items').update({ applied_at: new Date().toISOString() }).eq('id', id);
          results.push({ id, code, status: 'ok' });
        }
        await sleep(300);
      }
      // položky bez rozdílu se neposílají → jen se označí jako vyřízené (níže)
      const { data: left } = await sb.from('inv_items').select('id,system_qty,counted_qty').eq('session_id', sessionId).is('applied_at', null).not('counted_qty', 'is', null);
      const pending = (left || []).filter((x: any) => !(x.system_qty != null && Number(x.system_qty) === Number(x.counted_qty)));
      const noChange = (left || []).filter((x: any) => x.system_qty != null && Number(x.system_qty) === Number(x.counted_qty)).map((x: any) => x.id);
      if (noChange.length) await sb.from('inv_items').update({ applied_at: new Date().toISOString() }).in('id', noChange);
      const done = pending.length === 0;
      if (done) await sb.from('inv_sessions').update({ status: 'done', done_at: new Date().toISOString(), updated_at: new Date().toISOString(), stock_id: stockId }).eq('id', sessionId);
      await audit('shoptet_inventory_apply', { session: sessionId, stock: stockId, ok: results.filter(x => x.status === 'ok').length, failed: results.filter(x => x.status === 'error').length, duplicate: results.filter(x => x.status === 'duplicate').length });
      return json({ ok: true, results, done });
    }
    return json({ error: 'Neznámá akce' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
