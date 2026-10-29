-- 0082_honours_boards_a2_plus_a3.sql
-- Printed honours boards (0078–0081): adds the 'a2_plus_a3' layout and moves every board
-- onto it.
--
--   'a2_plus_a3' — an A2 portrait sheet (title, headings, 1976–2026) that never changes,
--                  and an A3 landscape sheet below it in its own frame (one-line title,
--                  headings, 2027–2052) reprinted each year. Both are 420mm wide, so the
--                  columns line up; names about 21pt.
--
-- The boards become:
--   Club Officers & Championships — President, Men's Captain, Ladies Captain,
--                                   Men's Championship, Ladies Maynard
--   Singles                       — the other 6 singles competitions
--   Pairs & Triples               — unchanged columns
--
-- Applies whether or not 0081 has been: the layout check is rebuilt here too.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod —
-- BEFORE deploying the code that uses this layout.

alter table honours_boards drop constraint if exists honours_boards_layout_check;

alter table honours_boards
  add constraint honours_boards_layout_check
  check (layout in ('a2_plus_a3', 'stacked', 'stacked_a3', 'side_by_side', 'single'));

-- The two championships join the officers
update honours_boards
set name = 'Club Officers & Championships',
    layout = 'a2_plus_a3',
    columns = '[
      {"field": "president",         "heading": "President",          "width": 1},
      {"field": "mens_captain",      "heading": "Men''s Captain",      "width": 1},
      {"field": "ladies_captain",    "heading": "Ladies Captain",     "width": 1},
      {"field": "mens_championship", "heading": "Men''s Championship", "width": 1},
      {"field": "ladies_maynard",    "heading": "Ladies Maynard",     "width": 1}
    ]'::jsonb,
    updated_at = now()
where name = 'Club Officers';

-- ...leaving Singles with six
update honours_boards
set layout = 'a2_plus_a3',
    columns = '[
      {"field": "mens_two_woods",   "heading": "Men''s Two Woods",  "width": 1},
      {"field": "ladies_two_woods", "heading": "Ladies Two Woods", "width": 1},
      {"field": "mixed_handicap",   "heading": "Mixed Handicap",   "width": 1},
      {"field": "oldland",          "heading": "Oldland",          "width": 1},
      {"field": "veterans_cup",     "heading": "Veterans Cup",     "width": 1},
      {"field": "centenary_cup",    "heading": "Centenary Cup",    "width": 1}
    ]'::jsonb,
    updated_at = now()
where name = 'Singles';

update honours_boards set layout = 'a2_plus_a3', updated_at = now() where name = 'Pairs & Triples';

-- New boards default to this layout too
alter table honours_boards alter column layout set default 'a2_plus_a3';
