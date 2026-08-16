-- 0047_club_id_legacy.sql
-- club_id was dropped entirely in the original Clubs migration (0009_clubs.sql) since it
-- only ever existed as a login identifier there. It turns out Rowland's still-Sheets-based
-- match/bracket data (ROWLAND_SPREADSHEET_ID, not yet migrated) stores teams by that same
-- club_id (e.g. "burgess.hill") — and the values are hand-entered, not a deterministic
-- function of club_name (e.g. "Brighton @Preston" -> "brighton@preston", no dot), so they
-- can't be regenerated. Re-adding it here, nullable, purely so /api/rowland/clubs can move
-- off MATCH_DAY_CONTACTS_SPREADSHEET_ID onto Postgres without breaking those existing
-- references. Backfilled once from the live sheet by scripts/backfill-club-ids.ts — new
-- clubs created directly in Postgres going forward simply have no club_id (Rowland's club
-- picker excludes them, same as if they'd never been added to the old spreadsheet either).

alter table club_profiles add column if not exists club_id text;
