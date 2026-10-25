-- 0078_honours_boards.sql
-- Printed honours boards for the clubhouse wall (Admin > Config > Honours Boards).
--
--   honours_boards — one row per board (one A2 acrylic frame holding two A3
--                    landscape sheets, stacked). `columns` is the board's columns
--                    left to right, as a JSON array of
--                    {"field": <website.honours_internal column>, "heading": <text>, "width": <relative width>}
--                    — width 1 suits a single name, ~1.5 a pair, ~2 a triple.
--
-- Two config keys decide which years go on which sheet, for every board:
--   honours_board_start_year      — the first year on the wall (top sheet of the first frame)
--   honours_board_years_per_sheet — rows per A3 sheet; also sets row height and text size
-- Sheets run in blocks from the start year: 1976–2005 top, 2006–2035 bottom, then
-- a second frame from 2036. Only the sheet holding the current year ever changes.
-- Raising the start year later (e.g. to 1986) instead rolls the oldest years off the wall.
--
-- Honours data itself stays in website.honours_internal; this is print layout only,
-- so it lives in public alongside label_layouts.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod —
-- BEFORE deploying the code that uses this table.

create table honours_boards (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  display_order integer not null default 0,
  columns       jsonb not null default '[]'::jsonb check (jsonb_typeof(columns) = 'array'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table honours_boards enable row level security;

-- Two boards, grouped by theme: officers and singles events, then pairs and triples
insert into honours_boards (name, display_order, columns) values
  ('Club Officers & Singles', 1, '[
    {"field": "president",         "heading": "President",          "width": 1},
    {"field": "mens_captain",      "heading": "Men''s Captain",      "width": 1},
    {"field": "ladies_captain",    "heading": "Ladies Captain",     "width": 1},
    {"field": "mens_championship", "heading": "Men''s Championship", "width": 1},
    {"field": "ladies_maynard",    "heading": "Ladies Maynard",     "width": 1},
    {"field": "mens_two_woods",    "heading": "Men''s Two Woods",    "width": 1},
    {"field": "ladies_two_woods",  "heading": "Ladies Two Woods",   "width": 1},
    {"field": "mixed_handicap",    "heading": "Mixed Handicap",     "width": 1},
    {"field": "oldland",           "heading": "Oldland",            "width": 1},
    {"field": "veterans_cup",      "heading": "Veterans Cup",       "width": 1},
    {"field": "centenary_cup",     "heading": "Centenary Cup",      "width": 1}
  ]'::jsonb),
  ('Pairs & Triples', 2, '[
    {"field": "drawn_pairs",      "heading": "Drawn Pairs",      "width": 1.5},
    {"field": "australian_pairs", "heading": "Australian Pairs", "width": 1.5},
    {"field": "married_pairs",    "heading": "Married Pairs",    "width": 1.2},
    {"field": "drawn_triples",    "heading": "Drawn Triples",    "width": 2}
  ]'::jsonb);

insert into config (key, value) values
  ('honours_board_start_year', '1976'),
  ('honours_board_years_per_sheet', '30')
on conflict (key) do nothing;
