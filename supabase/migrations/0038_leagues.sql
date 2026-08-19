-- 0038_leagues.sql
-- Cut over the Club Leagues system from Google Sheets to Postgres:
-- LeagueControl/LeagueTeams/LeagueSquad/LeagueMatches/LeagueSettings -> five tables here.
--
-- league_id/team_id/match_id keep their existing text business keys (e.g.
-- "league-1234567890", "{leagueId}-md1-1") rather than uuids — nothing about the
-- generation scheme needs to change, same precedent as competitions' match_id.
--
-- league_squad.team_id uses ON DELETE SET NULL (not the Sheets version's leave-it-
-- dangling behaviour) — this is the actual fix for the long-standing "deleting a
-- league team leaves an orphaned team_id in LeagueSquad" bug (a real member got stuck
-- unable to be reassigned). league_matches.home_team_id/away_team_id deliberately have
-- NO delete behaviour override (default RESTRICT) — a team with recorded match history
-- must not be silently deletable out from under those results.
--
-- scheduled_date/scheduled_time already exist as real columns for every league type
-- here (not just triples) — the sheet always had them, the app just never surfaced/
-- allowed editing them for pairs-type leagues. That's a pure application-layer/UI
-- change on top of this schema, not a schema change.

create table if not exists leagues (
  league_id           text primary key,
  name                text not null,
  type                text not null check (type in ('triples', 'pairs')),
  season              text not null,
  status              text not null default 'Not Started' check (status in ('Not Started', 'Entries Open', 'In Progress', 'Complete')),
  squad_size          int not null default 6,
  players_per_match   int not null default 3,
  date_label          text not null default 'Play on/at' check (date_label in ('Play on/at', 'Play by', 'Play start date')),
  legs                smallint not null default 2 check (legs in (1, 2)),
  message             text not null default ''
);

create table if not exists league_teams (
  team_id     text primary key,
  league_id   text not null references leagues(league_id) on delete cascade,
  team_name   text not null
);

create table if not exists league_squad (
  id            uuid primary key default gen_random_uuid(),
  league_id     text not null references leagues(league_id) on delete cascade,
  team_id       text references league_teams(team_id) on delete set null,   -- null = unassigned/reserve
  username      text not null references users(username),
  position      text not null default '',
  entered_date  date not null default current_date,
  unique (league_id, username)
);

create table if not exists league_matches (
  match_id        text primary key,
  league_id       text not null references leagues(league_id) on delete cascade,
  matchday        int not null default 1,
  home_team_id    text not null references league_teams(team_id),
  away_team_id    text not null references league_teams(team_id),
  scheduled_date  date,
  scheduled_time  text,    -- HH:MM
  play_by_date    date,
  home_score      int,
  away_score      int,
  home_adj        int,
  away_adj        int,
  home_points     int,
  away_points     int,
  status          text not null default 'Scheduled' check (status in ('Scheduled', 'Played', 'Walkover', 'Conceded', 'Not Played'))
);

create index if not exists league_teams_league_id_idx on league_teams (league_id);
create index if not exists league_squad_league_id_idx on league_squad (league_id);
create index if not exists league_matches_league_id_idx on league_matches (league_id);

-- The single site-wide leagues message shown on /leagues (distinct from each league's
-- own `message` column above) — same simple key-value shape as competition_settings.
create table if not exists league_settings (
  key    text primary key,
  value  text not null default ''
);

-- League rules documents etc. — same shape as suggestion_attachments/0037, LA- prefix
-- kept from the old sheet's attachment_id scheme.
create table if not exists league_attachments (
  attachment_id       text primary key,
  league_id           text not null references leagues(league_id) on delete cascade,
  type                text not null check (type in ('link', 'image', 'document')),
  drive_file_id        text,
  url                 text not null,
  description         text not null,
  file_name            text,
  mime_type            text,
  file_size            bigint,
  display_order        int not null default 0,
  added_at             timestamptz not null default now(),
  added_by_username    text not null references users(username),
  is_deleted           boolean not null default false
);

create index if not exists league_attachments_league_id_idx on league_attachments (league_id);

alter table leagues enable row level security;
alter table league_teams enable row level security;
alter table league_squad enable row level security;
alter table league_matches enable row level security;
alter table league_settings enable row level security;
alter table league_attachments enable row level security;
