-- 0088_honours_board_style.sql
-- Printed honours boards (0078–0082): the club's saved print style — background, bleed,
-- stripes, lines, colours and fonts — as one JSON config value, edited in
-- Config > Honours Boards > Print style. Empty means the default look (white sheet,
-- stone stripes, green headings); see src/types/honours-board-style.ts.
--
-- The config endpoint only updates keys that already exist, so the key is created here.
-- Apply to the Dev Supabase project first, verify, then apply to Prod —
-- BEFORE deploying the code that uses it.

insert into config (key, value) values
  ('honours_board_style', '')
on conflict (key) do nothing;
