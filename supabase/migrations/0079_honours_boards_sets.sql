-- 0079_honours_boards_sets.sql
-- Printed honours boards (0078) now print as a *set* of two sheets per board, hung one
-- above the other: the top sheet carries the title and column headings, the bottom
-- sheet is rows only. Both share one row height, so the bottom sheet holds more years.
-- The app works out the top/bottom split from the years per set.
--
--   honours_board_years_per_set — years on the top and bottom sheets together (replaces
--                                 honours_board_years_per_sheet; 2 × 30 = 60, so the
--                                 first set still runs 1976–2035)
--   honours_board_sheet_size    — 'A2' (each sheet its own A2 frame) or 'A3' (both sheets
--                                 in one A2 frame); same layout, A2 is 1.41× larger
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod —
-- BEFORE deploying the code that uses these keys.

insert into config (key, value) values
  ('honours_board_years_per_set', '60'),
  ('honours_board_sheet_size', 'A2')
on conflict (key) do nothing;

delete from config where key = 'honours_board_years_per_sheet';
