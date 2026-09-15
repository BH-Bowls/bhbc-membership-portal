-- 0054_website_schema.sql
-- New "website" schema holding content for the public bhbc-website site
-- (currently Google Sheets tabs in the WEBSITE_CONTENT_SHEET_ID spreadsheet).
-- Only the service_role key ever touches this schema — from the website's
-- server-side reads and the portal's forthcoming Admin > Website section —
-- so RLS is enabled with no policies (deny-all for anon/authenticated) and
-- grants are restricted to service_role.

create schema if not exists website;

-- ----- Committee ----------------------------------------------------------

create table website.committee (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  role           text not null,
  email          text,
  display_order  integer not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);

-- ----- Coaches --------------------------------------------------------------

create table website.coaches (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  qualification  text not null,
  bio            text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);

-- ----- Announcements --------------------------------------------------------

create table website.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  type        text not null check (type in ('open-day', 'visiting-side', 'event', 'notice')),
  cta_label   text,
  cta_url     text,
  start_date  date not null,
  end_date    date not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create index announcements_active_dates_idx on website.announcements (active, start_date, end_date);

-- ----- Rowland Cup interest submissions --------------------------------------

create table website.rowland_interest (
  id            uuid primary key default gen_random_uuid(),
  submitted_at  timestamptz not null default now(),
  club_name     text not null,
  contact_name  text not null,
  email         text not null,
  phone         text,
  division      text,
  notes         text
);

-- ----- Honours — internal (club) record --------------------------------------
-- One row per season year. Column names match the current display labels in
-- the website's HONOURS_LABELS (lib/honours.ts), not the legacy sheet headers
-- (e.g. mens_maynard -> mixed_handicap) — see specs/HONOURS_DELTA_SPEC.md and
-- the website CLAUDE.md for the historical reason the two diverged.

create table website.honours_internal (
  year               integer primary key,
  president          text,
  mens_captain       text,
  ladies_captain     text,
  mens_championship  text,
  mixed_handicap     text,
  mens_two_woods     text,
  ladies_maynard     text,
  ladies_two_woods   text,
  drawn_pairs        text,
  drawn_triples      text,
  oldland            text,
  veterans_cup       text,
  married_pairs      text,
  australian_pairs   text,
  centenary_cup      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);

-- ----- Honours — external (county/national) results --------------------------
-- Multiple rows per year allowed.

create table website.honours_external (
  id          uuid primary key default gen_random_uuid(),
  year        integer not null,
  competition text not null,
  detail      text,
  created_at  timestamptz not null default now()
);

create index honours_external_year_idx on website.honours_external (year);

-- ----- RLS + grants -----------------------------------------------------------

alter table website.committee         enable row level security;
alter table website.coaches           enable row level security;
alter table website.announcements     enable row level security;
alter table website.rowland_interest  enable row level security;
alter table website.honours_internal  enable row level security;
alter table website.honours_external  enable row level security;

grant usage on schema website to service_role;
grant all on all tables in schema website to service_role;
alter default privileges in schema website grant all on tables to service_role;
