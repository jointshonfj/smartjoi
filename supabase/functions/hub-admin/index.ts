// Vinylor Hub · Edge Function „hub-admin“ — správa uživatelů
// Smí ji použít jen správce, který je přihlášený s dokončeným 2FA (AAL2).
//   { action: 'list' }                         → uživatelé + stav 2FA + poslední přihlášení
//   { action: 'create', name, email, role? }   → nový účet + dočasné heslo
//   { action: 'reset', id }                    → nové dočasné heslo + odhlášení ze všech zařízení
//   { action: 'reset_mfa', id }                → zrušení 2FA (ztracený telefon) + odhlášení
//   { action: 'signout', id }                  → odhlášení ze všech zařízení
//   { action: 'active', id, active }           → zablokovat / povolit přístup
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function claims(jwt: string): Record<string, unknown> {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}
function tempPassword() {
  // 18 znaků, bez zaměnitelných znaků; vždy písmena, číslice i symbol
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(16));
  const s = [...b].map(x => abc[x % abc.length]).join('');
  return s.slice(0, 6) + '-' + s.slice(6, 11) + '-' + s.slice(11) + '7';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await sb.auth.getUser(jwt); // ověří podpis i platnost tokenu
    if (!u?.user) return json({ error: 'Nepřihlášen' }, 401);
    if (claims(jwt).aal !== 'aal2') return json({ error: 'Vyžaduje dvoufázové ověření.' }, 403);
    const { data: me } = await sb.from('hub_profiles').select('role, active').eq('id', u.user.id).single();
    if (!me || !me.active || me.role !== 'admin') return json({ error: 'Jen pro správce.' }, 403);

    const audit = (action: string, target: string | null, detail: Record<string, unknown> = {}) =>
      sb.from('hub_audit').insert({ actor: u.user.id, action, target, detail });
    const b = await req.json();
    const id = b.id ? String(b.id) : '';
    if (id && !/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Neplatné ID' }, 400);
    if (id) { const { data: p } = await sb.from('hub_profiles').select('id').eq('id', id).maybeSingle(); if (!p) return json({ error: 'Uživatel nenalezen' }, 404); }

    if (b.action === 'list') {
      const { data, error } = await sb.rpc('hub_users_security');
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, users: data });
    }
    if (b.action === 'create') {
      const name = String(b.name || '').trim().slice(0, 80), email = String(b.email || '').trim().toLowerCase();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Vyplň jméno a platný e-mail.' }, 400);
      const password = tempPassword();
      // pozvánka na 2 minuty: databázová pojistka proti cizím registracím pustí jen e-mail, který správce právě zakládá
      await sb.from('hub_invites').upsert({ email, expires_at: new Date(Date.now() + 120_000).toISOString(), created_by: u.user.id });
      const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name }, app_metadata: { hub_invited: true } });
      await sb.from('hub_invites').delete().eq('email', email);
      if (error) return json({ error: /already|registered|exists/i.test(error.message) ? 'Uživatel s tímto e-mailem už existuje.' : error.message }, 400);
      const { error: e2 } = await sb.from('hub_profiles').insert({ id: data.user.id, name, email, role: b.role === 'admin' ? 'admin' : 'user', must_change: true });
      if (e2) { await sb.auth.admin.deleteUser(data.user.id); return json({ error: e2.message }, 400); }
      await audit('user_created', data.user.id, { email });
      return json({ ok: true, password });
    }
    if (b.action === 'reset') {
      const password = tempPassword();
      const { error } = await sb.auth.admin.updateUserById(id, { password });
      if (error) return json({ error: error.message }, 400);
      await sb.from('hub_profiles').update({ must_change: true }).eq('id', id);
      await sb.rpc('hub_revoke_sessions', { p_user: id });
      await audit('password_reset', id);
      return json({ ok: true, password });
    }
    if (b.action === 'reset_mfa') {
      if (id === u.user.id) return json({ error: 'Vlastní 2FA si zruš v Můj účet — nebo ať to udělá jiný správce.' }, 400);
      const { data: f, error } = await sb.auth.admin.mfa.listFactors({ userId: id });
      if (error) return json({ error: error.message }, 400);
      for (const x of f.factors || []) await sb.auth.admin.mfa.deleteFactor({ id: x.id, userId: id });
      await sb.rpc('hub_revoke_sessions', { p_user: id });
      await audit('mfa_reset', id, { factors: (f.factors || []).length });
      return json({ ok: true });
    }
    if (b.action === 'signout') {
      await sb.rpc('hub_revoke_sessions', { p_user: id });
      await audit('signed_out_everywhere', id);
      return json({ ok: true });
    }
    if (b.action === 'active') {
      if (id === u.user.id) return json({ error: 'Sám sebe zablokovat nejde.' }, 400);
      const active = !!b.active;
      const { error } = await sb.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
      if (error) return json({ error: error.message }, 400);
      await sb.from('hub_profiles').update({ active }).eq('id', id);
      if (!active) await sb.rpc('hub_revoke_sessions', { p_user: id });
      await audit(active ? 'user_unblocked' : 'user_blocked', id);
      return json({ ok: true });
    }
    return json({ error: 'Neznámá akce' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
