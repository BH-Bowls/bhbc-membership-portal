-- 0089_honours_board_line_spacing.sql
-- Printed honours boards: the line spacing that goes with the row control — snug (names
-- as big as the row allows, the original look), comfortable or generous (same rows,
-- smaller names, more space between them). Edited beside Row control in
-- Config > Honours Boards > Sheets. Empty means snug; see src/types/honours-boards.ts.
--
-- The config endpoint only updates keys that already exist, so the key is created here.
-- Apply to the Dev Supabase project first, verify, then apply to Prod —
-- BEFORE deploying the code that uses it.

insert into config (key, value) values
  ('honours_board_line_spacing', '')
on conflict (key) do nothing;
