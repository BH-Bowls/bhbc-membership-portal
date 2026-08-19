-- 0007_handicap_history.sql
-- Phase 0/1 migration, Step 2 — Handicap history
-- Genuinely new territory, no existing history/audit table. member_profiles.handicap
-- stays as the current-value cache the Handicap Competition Bracket already reads,
-- updated once a year from this table. See specs/Phase_0_1_Migration_Plan.md, Step 2.
--
-- Not built yet, deliberately: the pg_trgm fuzzy-match reviewed-import flow and the
-- future automated-calculation design (both explicitly deferred in the plan — the
-- calculation rule itself isn't confirmed, and automation needs Competitions-in-Postgres,
-- which is out of Phase 1 scope). This migration only stands up the table itself.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists handicap_history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id),
  year         int not null,
  handicap     int not null check (handicap between 0 and 10),
  source       text not null default 'Imported'
                 check (source in ('Imported','Calculated','Manual Override')),
  source_notes text,     -- raw 'C=7'/'H=6' notation, kept verbatim, not discarded
  imported_at  timestamptz not null default now(),
  imported_by  text references users(username) on update cascade,
  unique (user_id, year)
);

alter table handicap_history enable row level security;
