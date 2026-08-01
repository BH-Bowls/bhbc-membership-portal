-- 0001_config_table.sql
-- Phase 0/1 migration, Step 0 — Config table
-- Straight key/value port of the Google Sheets "Labels" sheet (PORTAL_CONFIG_SPREADSHEET_ID).
-- See specs/Phase_0_1_Migration_Plan.md, Step 0.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists config (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text   -- username, informational only
);

-- RLS on, no policies: our app only ever accesses Postgres via the service_role key
-- (src/lib/supabase.ts), which bypasses RLS entirely. Turning RLS on with zero policies
-- means every other key (anon/publishable) is denied by default — the correct posture
-- for a table nothing client-side should ever touch. Standard for every table going forward.
alter table config enable row level security;
