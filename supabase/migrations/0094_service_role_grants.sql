-- 0094_service_role_grants.sql
-- From 2026-10-30 Supabase no longer auto-grants Data API access to new tables in the
-- public schema. Without a grant, supabase-js gets "permission denied for table ...".
-- That hits any table created after the cutoff (square_checkouts from 0091 if it was
-- applied on/after 2026-10-30) and EVERY table on a fresh rebuild (new project,
-- preview branch, local `supabase db reset`), since those run 0001+ after the cutoff.
--
-- The portal only talks to Postgres server-side with the service-role key
-- (src/lib/supabase.ts), and every table has RLS on with no policies, so only
-- service_role needs access. anon/authenticated are deliberately NOT granted anything.
--
-- Idempotent: safe to run on databases that already have these grants.

grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;

-- Tables/sequences created by later migrations get the same grants automatically
-- (applies to objects created by the role running migrations, i.e. postgres).
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select, update on sequences to service_role;
