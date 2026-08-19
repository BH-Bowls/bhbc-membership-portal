-- 0023_rename_games_to_fixtures.sql
-- Renames games -> fixtures. The table has never held real data (still schema-only
-- from 0012), so a straight rename is safe with nothing to migrate. Season Planning
-- (built against this table next) needs the new name.
--
-- Adds 3 columns confirmed against the live "Games" sheet's real 31-column header
-- row. 0012's own column list, while cross-checked against SCHEMA.md, was missing
-- two real columns, and had 3 columns with no live equivalent (league, hard_block,
-- include — kept as-is, unused, most likely intended for the future Season Planning
-- tool rather than the current live sheet):
--   - needs_players: present on the live sheet, currently always blank in practice
--   - last_modified_date: present on the live sheet, real timestamptz values
--
-- Also adds `description` — a free-text field for whenever a fixture has no real
-- club opponent: ad-hoc games (Rowland internal rounds, representative fixtures,
-- one-off non-directory opponents like "Sussex County BA Under 25's"), league
-- calendar-placeholders ("No Game", "Reserve"), and purely social/internal events
-- (BBQ, Quiz, Coffee Morning). club_name's existing FK to club_profiles (from 0012)
-- stays untouched — it was already correctly designed as nullable; this just gives
-- the null case somewhere real to put its label instead of overloading club_name
-- with non-club text the way the live Sheet does today.
--
-- game_players (0013) is deliberately NOT renamed here — out of scope for this
-- pass, expected to be redesigned (not just renamed) once the roster/live-workflow
-- piece actually gets built, per the plan's own note that its data layer will look
-- very different.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table games rename to fixtures;

alter table fixtures
  add column description text,
  add column needs_players text,
  add column last_modified_date timestamptz;
