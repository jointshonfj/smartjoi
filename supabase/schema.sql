-- =====================================================================
-- Vinylor Hub · databáze (Supabase projekt „vinylor-pickapp“)
-- Tabulky Hubu: hub_profiles, hub_settings, hub_products, offers,
-- offer_comments, offer_history. Tabulky pickappu se nemění.
-- Skript jde spustit i opakovaně.
-- =====================================================================

-- ---------- uživatelé ----------
create table if not exists public.hub_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text not null,
  email         text not null default '',          -- přihlašovací e-mail
  contact_email text not null default '',          -- e-mail do PDF (Vystavil)
  phone         text not null default '',
  role          text not null default 'user' check (role in ('admin', 'user')),
  must_change   boolean not null default true,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.hub_profiles enable row level security;

create or replace function public.hub_is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hub_profiles where id = auth.uid() and active);
$$;
create or replace function public.hub_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hub_profiles where id = auth.uid() and active and role = 'admin');
$$;

drop policy if exists hub_profiles_read on public.hub_profiles;
create policy hub_profiles_read on public.hub_profiles for select to authenticated using ((select public.hub_is_member()));

-- seznam jmen na přihlašovací obrazovce (jméno + přihlašovací e-mail)
create or replace function public.hub_login_users()
returns table (name text, email text)
language sql stable security definer set search_path = '' as $$
  select p.name, p.email from public.hub_profiles p where p.active order by p.name;
$$;
grant execute on function public.hub_login_users() to anon, authenticated;

create or replace function public.hub_update_my_contact(p_phone text, p_contact_email text)
returns void language sql security definer set search_path = '' as $$
  update public.hub_profiles set phone = left(coalesce(p_phone, ''), 40), contact_email = left(coalesce(p_contact_email, ''), 120)
  where id = auth.uid();
$$;
create or replace function public.hub_password_changed()
returns void language sql security definer set search_path = '' as $$
  update public.hub_profiles set must_change = false where id = auth.uid();
$$;
revoke execute on function public.hub_update_my_contact(text, text) from public, anon;
revoke execute on function public.hub_password_changed() from public, anon;
grant execute on function public.hub_update_my_contact(text, text) to authenticated;
grant execute on function public.hub_password_changed() to authenticated;

-- ---------- nastavení ----------
create table if not exists public.hub_settings (
  id   int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  products_synced_at timestamptz,
  products_error     text,
  products_error_at  timestamptz,
  products_count     int not null default 0
);
insert into public.hub_settings (id, data) values (1, jsonb_build_object(
  'csvUrl', '<ODKAZ NA CSV EXPORT PRODUKTŮ ZE SHOPTETU — nastav v aplikaci>',
  'numberPrefix', '{RR}9',
  'numberDigits', 5,
  'nextNumber', 1,
  'validDays', 14,
  'defaultDiscount', 2,
  'defaultVat', 21,
  'priceStep', 0.1,
  'agreeLine', 'Odsouhlasením nabídky souhlasím s všeobecnými obchodními podmínkami Gaviko Group s.r.o.',
  'terms', E'• V případě dopravy terasových prken je nutné zajistit si složení zboží z auta svépomocí.\n• Výpočet materiálu je pouze orientační.\n• Termín dodání nebo vyzvednutí zboží je plánován dle aktuální skladové dostupnosti jednotlivých položek.\n• Zboží není touto nabídkou rezervováno.\n• Přesný termín dodání či vyzvednutí bude upřesněn po odsouhlasení nabídky a přijetí platby. Do ceny Vám zahrnujeme individuální slevu 2% při platbě převodem na účet nebo hotově na pobočce Dobříš (neplatí pro dopravu).\n• Nabídka je platná do {platnost} nebo do vyprodání zásob.\n• V případě dotazů mě neváhejte kontaktovat.',
  'supplier', jsonb_build_object(
    'company', 'Gaviko Group s.r.o.', 'street', 'Chudenická 1059/30', 'city', '102 00 Praha', 'country', 'Česká republika',
    'ico', '09068864', 'dic', 'CZ09068864', 'phone', '724230683', 'mobile', '792335216',
    'email', 'info@vinylor.cz', 'web', 'www.vinylor.cz', 'bank', '')
)) on conflict (id) do nothing;
alter table public.hub_settings enable row level security;
drop policy if exists hub_settings_read on public.hub_settings;
drop policy if exists hub_settings_write on public.hub_settings;
create policy hub_settings_read on public.hub_settings for select to authenticated using ((select public.hub_is_member()));
create policy hub_settings_write on public.hub_settings for update to authenticated using ((select public.hub_is_member())) with check ((select public.hub_is_member()));
revoke update on public.hub_settings from authenticated;
grant update (data) on public.hub_settings to authenticated;

-- ---------- produkty (plní Edge Function hub-products-sync) ----------
create table if not exists public.hub_products (
  code           text primary key,
  name           text not null default '',
  variant        text not null default '',
  supplier       text not null default '',
  price_vat      numeric(12,2) not null default 0,
  standard_price numeric(12,2),
  action_price   numeric(12,2),
  visible        boolean not null default true,
  updated_at     timestamptz not null default now()
);
alter table public.hub_products enable row level security;
drop policy if exists hub_products_read on public.hub_products;
create policy hub_products_read on public.hub_products for select to authenticated using ((select public.hub_is_member()));

-- ---------- nabídky ----------
create table if not exists public.offers (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  status        text not null default 'draft' check (status in ('draft', 'sent', 'postponed', 'confirmed', 'rejected')),
  status_at     timestamptz not null default now(),
  date          date not null,
  valid_until   date not null,
  customer      jsonb not null default '{}'::jsonb,
  recipient     text not null default '',
  items         jsonb not null default '[]'::jsonb,
  note          text not null default '',
  terms         text not null default '',
  shoptet_order text not null default '',
  net           numeric(14,2) not null default 0,
  total         numeric(14,2) not null default 0,
  created_by    uuid references public.hub_profiles(id) on delete set null,
  issued_by     uuid references public.hub_profiles(id) on delete set null,
  last_edit_by  uuid references public.hub_profiles(id) on delete set null,
  version       int not null default 1,
  deleted       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists offers_status_idx on public.offers (status) where not deleted;
create index if not exists offers_created_by_idx on public.offers (created_by);
create index if not exists offers_issued_by_idx on public.offers (issued_by);
create index if not exists offers_last_edit_by_idx on public.offers (last_edit_by);
alter table public.offers enable row level security;
drop policy if exists offers_read on public.offers;
drop policy if exists offers_update on public.offers;
create policy offers_read on public.offers for select to authenticated using ((select public.hub_is_member()));
create policy offers_update on public.offers for update to authenticated using ((select public.hub_is_member())) with check ((select public.hub_is_member()));

-- hlídání úprav: verze, kdo upravil, neměnné sloupce, stav jen přes funkci, mazání jen autor/správce
create or replace function public.offers_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.id := old.id; new.number := old.number; new.created_by := old.created_by; new.created_at := old.created_at;
    if new.status is distinct from old.status or new.status_at is distinct from old.status_at then
      if coalesce(current_setting('hub.via_rpc', true), '') <> 'on' then
        raise exception 'Stav se mění tlačítkem stavu.';
      end if;
    end if;
    if new.deleted and not old.deleted and old.created_by is distinct from auth.uid() and not public.hub_is_admin() then
      raise exception 'Smazat může jen autor nebo správce.';
    end if;
    if not new.deleted and old.deleted and not public.hub_is_admin() then
      raise exception 'Obnovit může jen správce.';
    end if;
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  new.last_edit_by := coalesce(auth.uid(), old.last_edit_by);
  return new;
end $$;
drop trigger if exists offers_before_update on public.offers;
create trigger offers_before_update before update on public.offers for each row execute function public.offers_before_update();

create table if not exists public.offer_comments (
  id         uuid primary key default gen_random_uuid(),
  offer_id   uuid not null references public.offers(id) on delete cascade,
  author     uuid not null default auth.uid() references public.hub_profiles(id) on delete cascade,
  text       text not null check (length(text) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists offer_comments_offer_idx on public.offer_comments (offer_id);
create index if not exists offer_comments_author_idx on public.offer_comments (author);
alter table public.offer_comments enable row level security;
drop policy if exists offer_comments_read on public.offer_comments;
drop policy if exists offer_comments_insert on public.offer_comments;
drop policy if exists offer_comments_delete on public.offer_comments;
create policy offer_comments_read on public.offer_comments for select to authenticated using ((select public.hub_is_member()));
create policy offer_comments_insert on public.offer_comments for insert to authenticated with check ((select public.hub_is_member()) and author = (select auth.uid()));
create policy offer_comments_delete on public.offer_comments for delete to authenticated using (author = (select auth.uid()) or (select public.hub_is_admin()));

create table if not exists public.offer_history (
  id          bigint generated always as identity primary key,
  offer_id    uuid not null references public.offers(id) on delete cascade,
  at          timestamptz not null default now(),
  author      uuid references public.hub_profiles(id) on delete set null,
  action      text not null,
  from_status text,
  to_status   text,
  note        text
);
create index if not exists offer_history_offer_idx on public.offer_history (offer_id);
create index if not exists offer_history_author_idx on public.offer_history (author);
alter table public.offer_history enable row level security;
drop policy if exists offer_history_read on public.offer_history;
create policy offer_history_read on public.offer_history for select to authenticated using ((select public.hub_is_member()));

-- nová nabídka (nebo kopie existující) s dalším číslem z řady
create or replace function public.hub_create_offer(p_copy_from uuid default null)
returns public.offers language plpgsql security definer set search_path = '' as $$
declare
  s jsonb; prefix text; digits int; n int; num text; today date; src public.offers; o public.offers;
begin
  if not public.hub_is_member() then raise exception 'Nepřihlášen'; end if;
  select data into s from public.hub_settings where id = 1 for update;
  today := (now() at time zone 'Europe/Prague')::date;
  prefix := replace(replace(coalesce(s->>'numberPrefix', ''), '{RRRR}', to_char(today, 'YYYY')), '{RR}', to_char(today, 'YY'));
  prefix := regexp_replace(prefix, '\D', '', 'g');   -- jen číslice (variabilní symbol)
  digits := coalesce((s->>'numberDigits')::int, 5);
  if length(prefix) + digits > 10 then raise exception 'Číslo nabídky by mělo víc než 10 číslic — zkrať předponu nebo počet číslic v Nastavení.'; end if;
  n := greatest(coalesce((s->>'nextNumber')::int, 1), 1);
  loop
    num := prefix || lpad(n::text, digits, '0');
    exit when not exists (select 1 from public.offers where number = num);
    n := n + 1;
  end loop;
  update public.hub_settings set data = jsonb_set(data, '{nextNumber}', to_jsonb(n + 1)) where id = 1;

  insert into public.offers (number, date, valid_until, terms, created_by, issued_by, last_edit_by)
  values (num, today, today + coalesce((s->>'validDays')::int, 14), coalesce(s->>'terms', ''), auth.uid(), auth.uid(), auth.uid())
  returning * into o;

  if p_copy_from is not null then
    select * into src from public.offers where id = p_copy_from;
    if found then
      update public.offers set customer = src.customer, recipient = src.recipient, items = src.items, note = src.note,
        terms = src.terms, net = src.net, total = src.total where id = o.id returning * into o;
    end if;
  end if;
  insert into public.offer_history (offer_id, author, action, note)
  values (o.id, auth.uid(), 'created', case when src.id is not null then 'kopie z ' || src.number end);
  return o;
end $$;

create or replace function public.hub_set_offer_status(p_id uuid, p_status text, p_shoptet_order text default null)
returns public.offers language plpgsql security definer set search_path = '' as $$
declare o public.offers;
begin
  if not public.hub_is_member() then raise exception 'Nepřihlášen'; end if;
  select * into o from public.offers where id = p_id and not deleted for update;
  if not found then raise exception 'Nabídka nenalezena'; end if;
  perform set_config('hub.via_rpc', 'on', true);
  if o.status is distinct from p_status then
    insert into public.offer_history (offer_id, author, action, from_status, to_status) values (o.id, auth.uid(), 'status', o.status, p_status);
    update public.offers set status = p_status, status_at = now(), shoptet_order = coalesce(left(p_shoptet_order, 60), shoptet_order)
      where id = p_id returning * into o;
  elsif p_shoptet_order is not null then
    update public.offers set shoptet_order = left(p_shoptet_order, 60) where id = p_id returning * into o;
  end if;
  perform set_config('hub.via_rpc', 'off', true);
  return o;
end $$;
revoke execute on function public.hub_create_offer(uuid) from public, anon;
revoke execute on function public.hub_set_offer_status(uuid, text, text) from public, anon;
grant execute on function public.hub_create_offer(uuid) to authenticated;
grant execute on function public.hub_set_offer_status(uuid, text, text) to authenticated;
revoke execute on function public.hub_is_member() from public, anon;
revoke execute on function public.hub_is_admin() from public, anon;
grant execute on function public.hub_is_member() to authenticated;
grant execute on function public.hub_is_admin() to authenticated;
revoke execute on function public.offers_before_update() from public, anon, authenticated;
