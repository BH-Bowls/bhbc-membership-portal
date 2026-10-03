-- 0073_fixture_groups_cleanup.sql
-- Phase 2 of specs/FIXTURE_GROUPS_SPEC.md: drop the fixtures columns that fixture
-- groups (0072) replaced.
--
--   paired      '' / 'Y' / 'C' same-date linking flag — linked games are now fixtures
--               sharing a fixture group ("Open linked with …" on the manage page). The
--               Fixtures Admin "Paired game" checkbox is gone.
--   is_reserve  reserve-game flag — replaced by reserve_of (the game it was split from).
--   entered / selected / reserves
--               hand-maintained counts — replaced by the fixture_live_counts view, which
--               every getFixtures read merges in.
--
-- Apply AFTER the code that stops reading/writing these columns is deployed, and after
-- the 2026 import (scripts/import-friendlies-2026.ts) has run on that database — the
-- import reads `paired` from here while it exists (it falls back to the spreadsheet's
-- Games tab afterwards, which only holds pairings made before the August cutover).
-- Same two-step pattern as lockers 0069 → 0070.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table fixtures
  drop column if exists paired,
  drop column if exists is_reserve,
  drop column if exists entered,
  drop column if exists selected,
  drop column if exists reserves;
