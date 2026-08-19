-- 0036_season_planning_events.sql
-- Season Planning Stage 1 (Events) — adds the two planning-phase columns to
-- `fixtures` that 0023's own comment flagged as anticipated ("hard_block ...
-- most likely intended for the future Season Planning tool"). hard_block
-- itself needs no change here — Stage 1 just carries it forward from the
-- source row when it projects an Event into next season.
--
-- planning_status/planning_source are deliberately generic across
-- fixture_type, not Events-specific, so Stage 2 (Friendlies) and Stage 3
-- (Leagues) can reuse these same two columns rather than growing their own —
-- see specs/Planning_next_year_s_fixture_contacts.md.
--
-- NULL (not '') is the "not a planning row" default — it's how live/
-- historical fixtures (created via the normal in-season workflow in
-- fixtures-supabase.ts) are distinguished from rows this tool created.
--
-- The check constraint only allows the 4 values Stage 1 (Events) actually
-- uses. Friendlies' extra 'Email Sent' status (sits between Projected and
-- Confirmed, friendlies-only per the design doc) is deliberately NOT added
-- speculatively — Stage 2 will widen this constraint (drop + re-add) when
-- it's built.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table fixtures
  add column planning_status text
    check (planning_status is null or planning_status in ('Projected', 'Confirmed', 'Rearranged', 'Not Happening')),
  add column planning_source text
    check (planning_source is null or planning_source in ('Carried Forward', 'Manually Added'));
