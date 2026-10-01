-- 0068_club_friendly_planning_notes.sql
-- Free-text notes about a club specifically for friendly-fixture planning (e.g.
-- preferred dates, format quirks, anything the Fixtures Secretary should remember
-- when arranging next season's games) — distinct from the general_information
-- field, which is member-facing club info shown on the public /clubs page.
-- Surfaced in club maintenance (/clubs/[clubName]) and on the Season Planning
-- Club Info page (/fixtures/season-planning/friendlies/clubs/[clubName]).
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table club_profiles
  add column friendly_planning_notes text;
