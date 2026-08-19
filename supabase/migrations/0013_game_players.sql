-- 0013_game_players.sql
-- Phase 0/1 migration, Step 4b — game_players, replacing the per-game sheet tabs
-- (SCHEMA.md §10.3's own EAV-pattern flag). Cross-checked against SCHEMA.md's Per-Game
-- Sheet Tabs column list, not just the plan's illustrative SQL.
--
-- Deliberately excluded from this table, not oversights:
--   - driver_bar: SCHEMA.md says this is "read from Members sheet" — general member
--     data displayed alongside a game's roster for convenience, not independent
--     per-game data. Belongs as a join against member_profiles, not a duplicated column
--     (same reasoning already applied to not duplicating email onto users).
--   - captain (per-row Y flag): redundant with games.captain_username — derivable by
--     checking whether this row's user_name matches that game's captain, not stored twice.
--   - name_down / picked / percent_played: cross-game aggregate stats shown for context
--     on a game's roster, not per-game facts. Become simple aggregate queries against
--     game_players once it has real data, not stored columns.
--   - driving / car_number ARE kept — genuine per-game-per-player facts (this game's
--     actual driving assignment), not derived from Members.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists game_players (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id),
  user_name   text not null references users(username) on update cascade,
  status      text,               -- 'E','M','D','P','R','T','A','C','EW','MW','DW','PW','RW','TW','AW'
  selected    text,               -- '', 'Y','R','T','O'
  team int, position text,        -- position: 'S','1','2','3', or blank
  driving text,                   -- 'D' driver, 'B' bar, or blank — this game's actual assignment
  car_number text,
  unique (game_id, user_name)
);

alter table game_players enable row level security;
