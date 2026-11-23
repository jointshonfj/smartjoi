-- =====================================================================
-- Vinylor Hub · automatické načítání produktů (už nasazeno v projektu vinylor-pickapp)
-- Každou hodinu v :07 zavolá Edge Function hub-products-sync (s veřejným anon klíčem).
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'hub-products-sync';
select cron.schedule('hub-products-sync', '7 * * * *', $$
  select net.http_post(
    url     := 'https://edmsimvtjqdyykzkpfhv.supabase.co/functions/v1/hub-products-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <ANON_KEY>'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
