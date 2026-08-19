-- 0029_member_availability.sql
-- Member Availability substrate, per specs/MEMBER_AVAILABILITY_SPEC.md. Three tables +
-- one member_profiles column. The planning layer (events/slots/responses, groups) stays
-- entirely on Google Sheets — this substrate is additive, joined only by username.
--
-- resolveAvailability() precedence (highest wins), per (username, date, session):
--   1. commitments            -> busy_committed (a real booking)
--   2. availability_overrides -> free / busy_personal
--   3. standard_week          -> free / busy_personal
--   4. nothing                -> unknown
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

-- Recurring weekly template. One row per (member, weekday, session) that has been set —
-- absence of a row means "unknown", not "free"; the resolver treats no-data as unknown,
-- distinct from an explicit free/busy row.
create table if not exists standard_week (
  id         uuid primary key default gen_random_uuid(),
  username   text not null references users(username) on update cascade,
  weekday    int  not null check (weekday between 0 and 6),   -- 0=Sun ... 6=Sat
  session    text not null check (session in ('morning','afternoon','evening')),
  status     text not null check (status in ('free','busy')),
  label      text,                                             -- optional, e.g. "Work"
  updated_at timestamptz not null default now(),
  unique (username, weekday, session)
);

alter table standard_week enable row level security;

-- Ad-hoc, date-specific exceptions; beats the standard week for that date/session.
create table if not exists availability_overrides (
  id         uuid primary key default gen_random_uuid(),
  username   text not null references users(username) on update cascade,
  date       date not null,
  session    text not null check (session in ('morning','afternoon','evening','all')),
  status     text not null check (status in ('free','busy')),
  label      text,                                             -- optional reason
  created_at timestamptz not null default now(),
  unique (username, date, session)
);

alter table availability_overrides enable row level security;

-- Dated bookings emitted by other modules; the strongest signal. Superset of DiaryItem
-- (src/types/diary.ts) so "Coming Up" can eventually read straight off this table.
create table if not exists commitments (
  id         uuid primary key default gen_random_uuid(),
  username   text not null references users(username) on update cascade,
  date       date not null,
  session    text not null check (session in ('early','morning','afternoon','evening','all')),
  source     text not null check (source in ('availability','friendly','competition','rota','marker','external')),
  source_ref text,          -- id of the originating record (e.g. eventId) — idempotency key
  status     text not null check (status in ('committed','tentative')),
  type       text,          -- maps to DiaryItemType (icon), e.g. 'friendly', 'availability_confirmed'
  label      text,          -- DiaryItem.label
  sub_label  text,          -- DiaryItem.subLabel
  link_url   text,          -- DiaryItem.linkUrl
  created_at timestamptz not null default now(),
  unique (source, source_ref, username)
);

alter table commitments enable row level security;

-- Personal per-member setting (decided 2026-08-12: member_profiles column, not a Members-
-- sheet column as the spec originally proposed — Members data is fully on Postgres now).
-- Only consulted by pre-fill on an individual poll's respond grid; never affects the
-- resolver's raw output or the group heatmap. Distinct from Season Planning's separate,
-- unbuilt "max players per day" whole-club green-capacity concept — do not conflate.
alter table member_profiles
  add column if not exists max_games_per_day int not null default 2 check (max_games_per_day in (1, 2));
