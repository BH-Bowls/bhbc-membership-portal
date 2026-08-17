-- 0048_rowland.sql
-- Cut over Rowland Cup match/bracket management from Google Sheets
-- (ROWLAND_SPREADSHEET_ID: RowlandControl + 4 per-competition match sheets +
-- RowlandSettings) to Postgres. Mirrors the Competitions cutover (0033) — one
-- unified rowland_matches table (comp_id column) instead of 4 separate tables.
--
-- Teams are identified by club_name directly (home_club_name/away_club_name), not
-- club_id — per specs/Phase_0_1_Migration_Plan.md's Rowland redesign section: club_id
-- only ever existed as a bridge so this still-Sheets-based data could keep using the
-- same hand-entered ids the old sheets stored. No FK to club_profiles(club_name) —
-- historical match results should survive a club being renamed or removed from the
-- directory, same as competition_matches.side1_usernames carries no hard FK either.
--
-- Rowland *contacts*/tokens (the team-entry feature) are a separate, deliberately
-- deferred piece — not part of this cutover, see the plan doc's "steady state"
-- section.

create table if not exists rowland_comps (
  comp_id         text primary key,   -- 'edward-a' | 'edward-b' | 'gladys-a' | 'gladys-b'
  comp_name       text not null,
  season          text not null default '',
  status          text not null default 'Not Started' check (status in ('Not Started', 'Draw Done', 'In Progress', 'Complete')),
  num_teams       int not null default 0,
  prelim_play_by  date,
  r1_play_by      date,
  r2_play_by      date,
  qf_play_by      date,
  sf_play_by      date,
  f_play_by       date
);

create table if not exists rowland_matches (
  id                uuid primary key default gen_random_uuid(),
  comp_id           text not null references rowland_comps(comp_id) on delete cascade,
  match_id          text not null unique,
  round             text not null check (round in ('Prelim', 'R1', 'R2', 'QF', 'SF', 'F')),
  position          int not null,
  home_club_name    text,
  home_team_letter  text not null default '',
  away_club_name    text,
  away_team_letter  text not null default '',
  home_players      text[] not null default '{}',
  away_players      text[] not null default '{}',
  home_score        int,
  away_score        int,
  winner_side       smallint check (winner_side in (1, 2)),
  status            text not null default 'Pending' check (status in ('Pending', 'Played', 'Walkover', 'Bye')),
  play_by_date      date,
  played_date       date,
  notes             text not null default '',
  score_sheet_url   text
);

create index if not exists rowland_matches_comp_id_idx on rowland_matches (comp_id);

-- Single 'message' row today (mirrors the old RowlandSettings Key|Value sheet), same
-- key-value shape as competition_settings/league_settings for consistency.
create table if not exists rowland_settings (
  key   text primary key,
  value text not null default ''
);

alter table rowland_comps enable row level security;
alter table rowland_matches enable row level security;
alter table rowland_settings enable row level security;
