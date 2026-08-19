-- 0009_clubs.sql
-- Phase 0/1 migration, Step 3 — Clubs & Club Contacts
-- Pure reference data — no login fields at all, since club login is being removed
-- entirely (see specs/Phase_0_1_Migration_Plan.md, "Club login removal & Rowland access
-- redesign"). club_name is the sole identifier (club_id is dropped entirely, its only
-- purpose was as a login identifier).
--
-- Not built here, deliberately: the Rowland contact/token tables (rowland_contacts,
-- rowland_contact_comps, rowland_access_tokens) — documented in the plan as a future
-- design, not part of Phase 1 execution, deferred until the public-website team-entry
-- feature exists and Rowland itself gets its own migration phase.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists club_profiles (
  club_name          text primary key,
  driving_band       text,
  address_1 text, address_2 text, post_code text,
  website text, latitude float, longitude float
);

alter table club_profiles enable row level security;

create table if not exists club_contact_profiles (
  id              uuid primary key default gen_random_uuid(),
  club_name       text not null references club_profiles(club_name),
  first_name text, last_name text, role text,   -- 'Match Secretary','Captain',...
  email text, mobile_number text
);

alter table club_contact_profiles enable row level security;
