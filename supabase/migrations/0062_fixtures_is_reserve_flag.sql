-- 0062_fixtures_is_reserve_flag.sql
-- Adds a proper flag for reserve/split fixtures (the auto-created "-2" game
-- createReserveFixture spins off an oversubscribed original), for the new Games
-- Stats page (app/friendlies/manage) which needs to count reserve games as their
-- own category. Previously the only way to identify one was parsing tab_name for
-- a "-2" suffix — fragile for a stats query. Explicit column instead.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table fixtures
  add column is_reserve boolean not null default false;
