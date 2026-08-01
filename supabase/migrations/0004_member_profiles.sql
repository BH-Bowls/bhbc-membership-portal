-- 0004_member_profiles.sql
-- Phase 0/1 migration, Step 2 — member_profiles table
-- Domain/profile data only; login mechanics live on users (Step 1), joined via user_id.
-- See specs/Phase_0_1_Migration_Plan.md, Step 2.
--
-- Deliberately excluded from this table (see the plan for why):
--   - age / age_demographic: dropped entirely, computed on read once there's a real
--     consumer (Renewals, which stays on Sheets throughout Phase 1) — not built yet.
--   - gmail_labels: becomes an application-level function once Google Contacts Sync is
--     built (still mid-design) — not built yet.
--   - friendlies_2023 / friendlies_2024 / friendlies_last_year: dropped entirely, no
--     replacement column — Friendlies Last Year becomes a live query against
--     game_players once that exists (Step 4b).
--
-- Schema only — real member data migration happens later as one deliberate run,
-- together with Step 1's users table, per the plan's Cutover Procedure.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists member_profiles (
  user_id            uuid primary key references users(id),
  first_name text, last_name text, known_as text,
  full_known_as text generated always as (coalesce(nullif(known_as, ''), first_name)) stored,
  full_name      text generated always as (coalesce(nullif(known_as, ''), first_name) || ' ' || last_name) stored,
  email_address text,
  landline text, mobile text,
  address_1 text, address_2 text, address_3 text, post_code text, locker_no text,
  birthdate text,                -- freeform, not normalised — matches live Sheets data
  member_type text,              -- PL, SL, PM, SM
  honorary text, year_started int,
  handicap int check (handicap between 0 and 10),
  buddy_user_name text references users(username) on update cascade,
  is_marker boolean not null default false,
  is_worker boolean not null default false,
  worker_additional_info text,   -- exceptions to the default 9-5 weekday assumption
  left_at timestamptz,           -- Leavers replacement; is_active lives on users
  leaver_reason text,
  created_at timestamptz not null default now()
);

alter table member_profiles enable row level security;
