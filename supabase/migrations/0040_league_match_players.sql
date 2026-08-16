-- 0040_league_match_players.sql
-- New concept, not a migration of anything from Sheets (the old system had no
-- per-match lineup at all — only whole-team assignment via LeagueSquad.team_id).
--
-- A player's league match only shows up in their home-page Diary if they've been
-- specifically named here for that match — being on the team's overall squad is no
-- longer enough on its own. Both the committee and any squad member of either team
-- (self-service) can add/remove names, enforced in the API route, not here.

create table if not exists league_match_players (
  id                  uuid primary key default gen_random_uuid(),
  match_id            text not null references league_matches(match_id) on delete cascade,
  username            text not null references users(username),
  added_at            timestamptz not null default now(),
  added_by_username   text references users(username),
  unique (match_id, username)
);

create index if not exists league_match_players_match_id_idx on league_match_players (match_id);
create index if not exists league_match_players_username_idx on league_match_players (username);

alter table league_match_players enable row level security;
