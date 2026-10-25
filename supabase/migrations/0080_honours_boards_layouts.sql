-- 0080_honours_boards_layouts.sql
-- Printed honours boards (0078, 0079): each board now chooses its own layout, instead of
-- every board sharing one sheet size.
--
--   honours_boards.layout — 'stacked'      two A2 landscape sheets, one above the other
--                                          (title and headings on the top sheet)
--                           'side_by_side' two A3 portrait sheets side by side in one A2
--                                          landscape frame (title on the left sheet,
--                                          headings on both)
--                           'single'       one A3 portrait sheet holding every year so far,
--                                          reprinted each year with the text a little smaller
--
-- Also:
--   * splits "Club Officers & Singles" into Club Officers (President and Captains, two A3
--     sheets side by side) and Singles (the 8 singles competitions, stacked A2)
--   * years per set 60 → 71: rows at the same spacing as the Blizzard Graphics boards,
--     names about 24pt, first set runs 1976–2046
--   * removes honours_board_sheet_size (replaced by the per-board layout)
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod —
-- BEFORE deploying the code that uses this column.

alter table honours_boards
  add column layout text not null default 'stacked'
  check (layout in ('stacked', 'side_by_side', 'single'));

-- The singles competitions move to a board of their own
insert into honours_boards (name, display_order, layout, columns) values
  ('Singles', 2, 'stacked', '[
    {"field": "mens_championship", "heading": "Men''s Championship", "width": 1},
    {"field": "ladies_maynard",    "heading": "Ladies Maynard",     "width": 1},
    {"field": "mens_two_woods",    "heading": "Men''s Two Woods",    "width": 1},
    {"field": "ladies_two_woods",  "heading": "Ladies Two Woods",   "width": 1},
    {"field": "mixed_handicap",    "heading": "Mixed Handicap",     "width": 1},
    {"field": "oldland",           "heading": "Oldland",            "width": 1},
    {"field": "veterans_cup",      "heading": "Veterans Cup",       "width": 1},
    {"field": "centenary_cup",     "heading": "Centenary Cup",      "width": 1}
  ]'::jsonb)
on conflict (name) do nothing;

-- ...leaving the officers on the first board
update honours_boards
set name = 'Club Officers',
    layout = 'side_by_side',
    columns = '[
      {"field": "president",      "heading": "President",      "width": 1},
      {"field": "mens_captain",   "heading": "Men''s Captain",  "width": 1},
      {"field": "ladies_captain", "heading": "Ladies Captain", "width": 1}
    ]'::jsonb,
    updated_at = now()
where name = 'Club Officers & Singles';

update honours_boards set display_order = 3, updated_at = now() where name = 'Pairs & Triples';

-- Insert in case 0079 hasn't been applied, then set the new value either way
insert into config (key, value) values ('honours_board_years_per_set', '71')
on conflict (key) do update set value = '71';

delete from config where key in ('honours_board_sheet_size', 'honours_board_years_per_sheet');
