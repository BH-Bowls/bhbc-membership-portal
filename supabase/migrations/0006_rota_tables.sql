-- 0006_rota_tables.sql
-- Phase 0/1 migration, Step 2 — Cleaning Rota / Sweeping Rota
-- Rolled into this step since both only depend on Users existing, nothing about Games.
-- Both currently use positionally-hardcoded columns in Sheets (no getColumnMap) — that
-- whole distinction simply stops existing once these are real table columns.
-- See specs/Phase_0_1_Migration_Plan.md, Step 2.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists cleaning_rota (
  id              uuid primary key default gen_random_uuid(),
  date            date not null,
  lead_username   text references users(username) on update cascade,
  second_username text references users(username) on update cascade,
  third_username  text references users(username) on update cascade,
  fourth_username text references users(username) on update cascade
);

alter table cleaning_rota enable row level security;

create table if not exists sweeping_rota (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  username    text references users(username) on update cascade,
  is_blocked  boolean not null default false
);

alter table sweeping_rota enable row level security;
