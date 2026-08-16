-- 0043_reservations_and_rinks.sql
-- Season Planning — replaces Events' hard_block boolean with a real rink
-- count (rinks_required), adds an event_type classification (Social/
-- Fixture/External) so Social events (not on the green) and External events
-- (happen at another club, so Format is informational but Rinks Required is
-- 0) don't get counted in capacity math the same way a home Fixture-type
-- event does, and adds a standing reservations table for the club's regular
-- weekly green commitments (league nights, Friday Night Drive, Greenkeepers
-- morning, etc).
--
-- No real hard_block data exists yet (verified before writing this
-- migration — the column has never been set true on a real row), so this is
-- a clean rename-with-type-change, not a data migration.
--
-- Reservations are deliberately NOT season-scoped rows — they're a standing
-- list. start_date/end_date are both null for a reservation that recurs
-- every season (falls back to the two config default-window keys seeded
-- below, projected onto whichever season year is being viewed), or both set
-- for a one-off run with its own explicit dates (e.g. a specific 6-week
-- beginners course) — the check constraint enforces they're set together.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table fixtures
  add column event_type text
    check (event_type is null or event_type in ('Social', 'Fixture', 'External')),
  add column rinks_required int not null default 0,
  drop column hard_block;

create table reservations (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  weekday        int not null check (weekday between 0 and 6), -- 0=Sun..6=Sat
  time           time not null,
  rinks_reserved int not null check (rinks_reserved >= 0),
  start_date     date,
  end_date       date,
  created_at     timestamptz not null default now(),
  check ((start_date is null) = (end_date is null))
);
alter table reservations enable row level security;

insert into config (key, value) values
  ('season_planning_reservation_default_start', '15-04'), -- DD-MM, no year — projected onto whichever season year is being viewed
  ('season_planning_reservation_default_end', '30-09')
on conflict (key) do nothing;
