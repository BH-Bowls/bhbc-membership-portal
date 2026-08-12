-- 0022_clubs_full_columns.sql
-- Phase 1, member-access cutover — Clubs & Club Contacts. Same gap-class as every other
-- table this migration touched: 0009's illustrative block was incomplete against the
-- live Club/ClubContact TypeScript interfaces (src/lib/types/clubs.ts). Missing from
-- club_profiles: club_number, club_mobile, club_email_address, club_email_note,
-- general_information, address_3, address_4, miles, travel_time, and a last-updated
-- timestamp (the live sheet sets last_updated to today's date on every create/update).
-- Missing from club_contact_profiles: phone_number (landline — only mobile_number
-- existed) and notes.
--
-- Also new: petrol_bands. The live PetrolBands sheet (Band | Amount, e.g. A->£2, B->£3)
-- was never represented in the schema at all — it's a small, genuinely separate
-- reference table (driving-distance band -> reimbursement amount), not part of a club
-- record itself. Seeded with the same hardcoded fallback values the live code already
-- uses when the sheet is empty/missing (src/lib/clubs-sheets.ts's PETROL_BANDS_FALLBACK)
-- as a reasonable Dev default — check against the real PetrolBands sheet before Prod.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table club_profiles
  add column club_number text,
  add column club_mobile text,
  add column club_email_address text,
  add column club_email_note text,
  add column general_information text,
  add column address_3 text,
  add column address_4 text,
  add column miles text,
  add column travel_time text,
  add column updated_at timestamptz not null default now();

alter table club_contact_profiles
  add column phone_number text,
  add column notes text;

create table if not exists petrol_bands (
  band   text primary key,
  amount numeric not null
);

alter table petrol_bands enable row level security;

insert into petrol_bands (band, amount) values
  ('A', 2.00),
  ('B', 3.00),
  ('C', 4.00),
  ('D', 5.00)
on conflict (band) do nothing;
