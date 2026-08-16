-- 0045_report_definitions.sql
-- Cut over the Data Export / Report Builder's saved definitions from the
-- ReportDefinitions sheet to Postgres. The `definition` JSON blob's shape
-- (ReportDefinition in src/lib/types/data-export.ts) is unchanged — this table
-- just replaces where it's stored, same as the old sheet's column C.
--
-- No migration script for existing saved reports: this lands alongside a full
-- rebuild of the report engine itself (every source except Players moved off raw
-- Sheets reads onto the real Postgres tables — those had gone stale, no longer
-- being written to since each underlying feature migrated), so old saved
-- definitions would need re-verifying against the new source list anyway.

create table if not exists report_definitions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  definition  jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table report_definitions enable row level security;
