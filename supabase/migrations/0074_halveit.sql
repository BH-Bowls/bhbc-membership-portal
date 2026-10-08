-- 0074_halveit.sql
-- Halve It: the winter darts league, played on Wednesday nights through the closed
-- bowls season. Completely self-contained — nothing else in the portal reads these
-- tables, and the only link out is to users (who's on the team).
--
-- Seasons aren't a table: a season is the year the darts season starts, mirroring
-- the bowls seasons ("2026" = October 2026 to March 2027). A night's season is
-- derived from its date (July–December = that year, January–June = the year
-- before) and stored on the row so a season's nights can be queried directly.
--
-- Only raw scores are stored. Every league table, ranking and record is computed
-- from them at read time, so the scoring options can change without touching data.
--
--   halveit_players  — the team for a season; members can be added at any time,
--                      and made inactive rather than removed once they have scores
--   halveit_settings — per-season knobs (min games to qualify for the average
--                      table, how many games count in the Best N table); a season
--                      with no row uses the defaults
--   halveit_nights   — one per Wednesday; draft until finalised, and only final
--                      nights count towards the league
--   halveit_scores   — one row per player per game per night; no row = didn't
--                      play that game (players come and go through the evening)
--
-- Managed by the Darts role (or Admin); viewable by all members.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table halveit_players (
  id          uuid primary key default gen_random_uuid(),
  season      integer not null check (season between 2000 and 2100),
  username    text not null references users(username) on update cascade on delete restrict,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (season, username)
);

create table halveit_settings (
  season                 integer primary key check (season between 2000 and 2100),
  min_games_for_average  integer not null default 10 check (min_games_for_average >= 1),
  best_n_games           integer not null default 20 check (best_n_games >= 1),
  updated_at             timestamptz not null default now()
);

create table halveit_nights (
  id           uuid primary key default gen_random_uuid(),
  season       integer not null check (season between 2000 and 2100),
  night_date   date not null unique,
  games_count  integer not null default 1 check (games_count between 1 and 50),
  status       text not null default 'draft' check (status in ('draft', 'final')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index halveit_nights_season_idx on halveit_nights (season);

create table halveit_scores (
  night_id   uuid not null references halveit_nights(id) on delete cascade,
  player_id  uuid not null references halveit_players(id) on delete restrict,
  game_no    integer not null check (game_no >= 1),
  score      integer not null check (score between 0 and 999),
  primary key (night_id, player_id, game_no)
);

create index halveit_scores_player_idx on halveit_scores (player_id);

alter table halveit_players enable row level security;
alter table halveit_settings enable row level security;
alter table halveit_nights enable row level security;
alter table halveit_scores enable row level security;
