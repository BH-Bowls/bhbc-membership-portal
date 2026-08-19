-- 0034_two_hundred_club.sql
-- Cut over the "200 Club" fundraiser from Google Sheets to Postgres: three tabs
-- (200 Club / 200 Club Settings / 200 Club Winners) -> three tables here.
--
-- amounts is a real numeric[] array (prize per position, 1st = amounts[0])
-- instead of the old " / "-delimited string. winners is a pure append log (never
-- updated/deduped) and stores `member` as a display-name snapshot at draw time,
-- same as the old sheet — no username FK there, matching prior behaviour.

create table if not exists two_hundred_club_settings (
  season   text primary key,
  draws    int not null default 6,
  price    numeric(10,2) not null default 6,
  numbers  int not null default 200,
  amounts  numeric(10,2)[] not null default '{}'
);

create table if not exists two_hundred_club_entries (
  id       uuid primary key default gen_random_uuid(),
  season   text not null,
  number   text not null,
  username text not null references users(username),   -- absent row = unassigned, no blank-holder rows are stored
  unique (season, number)
);

create table if not exists two_hundred_club_winners (
  id         uuid primary key default gen_random_uuid(),
  season     text not null,
  date       text not null,   -- display string (e.g. "10 May 2026"), same as the old sheet
  position   int not null,
  number     text not null,
  member     text not null default '',
  amount     numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists two_hundred_club_entries_season_idx on two_hundred_club_entries (season);
create index if not exists two_hundred_club_winners_season_idx on two_hundred_club_winners (season);

alter table two_hundred_club_settings enable row level security;
alter table two_hundred_club_entries enable row level security;
alter table two_hundred_club_winners enable row level security;
