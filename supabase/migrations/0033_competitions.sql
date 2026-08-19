-- 0033_competitions.sql
-- Cut over the Competitions system from Google Sheets to Postgres: one
-- CompetitionsControl sheet + 12 per-competition match sheets + one
-- CompetitionsSettings key-value sheet -> three tables here.
--
-- competition_matches is a single unified table (comp_id column), not 12 separate
-- tables mirroring the old 12 sheets — simpler queries, no 12x schema duplication, and a
-- 13th competition needs no schema change. side1/side2 become real text[] arrays instead
-- of pipe-joined strings (pairs/triples store [skip, lead] or [skip, no2, lead]).
--
-- match_id is kept as the existing human-readable business key (e.g.
-- "mens-championship-r1-3", already globally unique across all competitions) rather than
-- replaced by the row's own uuid — the app's bracket-progression logic
-- (nextRoundTarget/propagateWinnerToNextRound) constructs and looks up matches by this ID
-- directly, so preserving it avoids rewriting that logic.

create table if not exists competitions (
  comp_id             text primary key,   -- e.g. 'mens-championship'
  display_name        text not null,
  comp_type           text not null default 'singles' check (comp_type in ('singles', 'pairs', 'triples')),
  status              text not null default 'Not Started' check (status in ('Not Started', 'Draw Done', 'In Progress', 'Complete')),
  year                int not null,
  finals_date         date,
  prelim_play_by      date,
  r1_play_by          date,
  r2_play_by          date,
  qf_play_by          date,
  sf_play_by          date,
  prelim_fixed        boolean not null default false,
  r1_fixed            boolean not null default false,
  r2_fixed            boolean not null default false,
  qf_fixed            boolean not null default false,
  sf_fixed            boolean not null default false,
  finals_fixed        boolean not null default false,
  draw_side_count     int,
  comp_start_date     date,
  comp_description    text,
  extra_description   text,
  markers_notes       text
);

create table if not exists competition_matches (
  id               uuid primary key default gen_random_uuid(),
  comp_id          text not null references competitions(comp_id) on delete cascade,
  match_id         text not null unique,
  round            text not null check (round in ('Prelim', 'R1', 'R2', 'QF', 'SF', 'F')),
  position         int not null,
  side1_usernames  text[] not null default '{}',
  side2_usernames  text[],   -- null = no opponent yet (bye slot not yet resolved)
  score1           int,
  score2           int,
  winner_side      smallint check (winner_side in (1, 2)),
  status           text not null default 'Pending' check (status in ('Pending', 'Complete', 'Walkover', 'Bye')),
  play_by_date     date,
  played_date      date,
  marker_username  text references users(username) on update cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

create index if not exists competition_matches_comp_id_idx on competition_matches (comp_id);

-- The three shared rules-text blocks (General Rules / Standard Scoring Procedure /
-- Marker Responsibilities), same key-value shape as the CompetitionsSettings sheet.
create table if not exists competition_settings (
  key         text primary key,
  value       text not null default ''
);

alter table competitions enable row level security;
alter table competition_matches enable row level security;
alter table competition_settings enable row level security;
