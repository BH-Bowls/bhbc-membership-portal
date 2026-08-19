-- 0027_cleaning_sweeping_rota.sql
-- Cutover of Cleaning Rota and Sweeping Rota to Postgres. Per
-- specs/Phase_0_1_Migration_Plan.md, both were meant to "roll into Step 2" (Members)
-- since they only depend on users existing, nothing about Games — that never actually
-- happened until now. Markers is NOT included here: is_marker/is_worker/
-- worker_additional_info already exist as member_profiles columns (0004) and are
-- already populated by migrate-members.ts — Markers only needed its live page/API
-- wired to those columns, not a new table.
--
-- cleaning_rota.date is a real `date` column, even though the live CleaningRota
-- sheet's Date column is read via FORMATTED_VALUE only, which renders as
-- "Sat, 05 September" — no year. migrate-rotas.ts assumes every row belongs to the
-- current season/calendar year when converting to a real date (decided 2026-08,
-- since the rota is rebuilt each season rather than kept as multi-year history).
-- The app layer (cleaning-rota-supabase.ts) reformats the stored date back to the
-- "Sat, 05 September" display string on read, so nothing above the data layer needs
-- to know it's backed by a real date column.
--
-- sweeping_rota.date is also a real `date` column: the live SweepingRota sheet's Date
-- column is read through normalizeToUKDate, which does carry a full DD/MM/YYYY value.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

-- *_username columns are nullable (NULL = unassigned) rather than
-- not-null-default-'' — an empty string can never satisfy the FK to users(username),
-- so blank has to mean NULL here. Naming matches fixtures.captain_username/
-- tea_lead_username's own convention (bare field names in the TS layer, _username
-- suffix on the actual column).
create table if not exists cleaning_rota (
  id              uuid primary key default gen_random_uuid(),
  date            date not null unique,   -- see note above re: assumed year
  lead_username   text references users(username) on update cascade,
  second_username text references users(username) on update cascade,
  third_username  text references users(username) on update cascade,
  fourth_username text references users(username) on update cascade
);

alter table cleaning_rota enable row level security;

create table if not exists sweeping_rota (
  id            uuid primary key default gen_random_uuid(),
  date          date not null unique,
  username      text references users(username) on update cascade,
  is_blocked    boolean not null default false
);

alter table sweeping_rota enable row level security;
