-- =====================================================================
-- Vinylor Hub · zabezpečení (nasazeno 20. 10. 2026 v projektu vinylor-pickapp)
-- =====================================================================
-- 1) Data jen s dokončeným 2FA: všechna RLS pravidla volají hub_is_member()/hub_is_admin(),
--    které vyžadují v tokenu aal = 'aal2' (heslo + kód z ověřovací aplikace).
create or replace function public.hub_is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal', '') = 'aal2'
     and exists (select 1 from public.hub_profiles where id = auth.uid() and active);
$$;
create or replace function public.hub_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal', '') = 'aal2'
     and exists (select 1 from public.hub_profiles where id = auth.uid() and active and role = 'admin');
$$;

-- 2) Žádný veřejný seznam uživatelů
drop function if exists public.hub_login_users();

-- 3) Účet vznikne jen přes správce (Edge Function hub-admin nastaví app_metadata.hub_invited).
--    Pojistka, i kdyby se v Supabase znovu zapnula registrace.
create or replace function public.hub_block_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.raw_app_meta_data->>'hub_invited', '') <> 'true' then
    raise exception 'Registrace je vypnutá. Účty zakládá správce Vinylor Hubu.';
  end if;
  return new;
end $$;
drop trigger if exists hub_block_signup on auth.users;
create trigger hub_block_signup before insert on auth.users for each row execute function public.hub_block_signup();

-- 4) Vlastní profil před dokončením 2FA (jen jméno/role/aktivní)
create or replace function public.hub_my_profile()
returns table (id uuid, name text, role text, must_change boolean, active boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.role, p.must_change, p.active from public.hub_profiles p where p.id = auth.uid();
$$;

-- 5) Bezpečnostní deník — zapisuje server/hub_log, čte jen správce
create table if not exists public.hub_audit (
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  actor uuid references public.hub_profiles(id) on delete set null, action text not null, target uuid, detail jsonb not null default '{}'::jsonb
);
alter table public.hub_audit enable row level security;
create policy hub_audit_read on public.hub_audit for select to authenticated using ((select public.hub_is_admin()));
-- hub_log(p_action, p_detail): povolené akce login / mfa_verified / mfa_enrolled / logout / password_changed

-- 6) Jen pro service roli (Edge Function hub-admin): odhlášení ze všech zařízení, přehled 2FA
-- hub_revoke_sessions(p_user uuid)  → delete from auth.sessions where user_id = p_user
-- hub_users_security()              → id, last_sign_in_at, mfa, banned

-- 7) Naskladnění do Shoptetu: zámek proti dvojímu odeslání (zapisuje jen Edge Function hub-shoptet)
-- shoptet_stock_log(receipt_id, item_id, code, amount, stock_id, request_id, actor, at) — primary key (receipt_id, item_id)

-- 8) Překlopení nabídky do objednávky: zámek (zapisuje jen Edge Function hub-shoptet)
-- shoptet_order_log(offer_id PK, order_code, actor, total_offer, total_shoptet, at)

-- 9) Pojistka registrací používá krátkodobé pozvánky: hub-admin zapíše e-mail do hub_invites na 2 minuty a teprve pak založí účet.
-- Trigger hub_block_signup pustí jen účet s platnou pozvánkou (nebo s app_metadata.hub_invited = true).
