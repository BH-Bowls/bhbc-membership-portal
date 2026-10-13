-- 0076_label_layouts.sql
-- Named label-sheet layouts for Print Labels (/labels), replacing the single set
-- of sheet measurements that lived in the config table.
--
--   label_layouts — one row per sheet type (e.g. Avery L7163): label size, page
--                   margins, gaps, labels across/down, and whether a membership
--                   card is drawn with a cut-out outline (for a label bigger than
--                   a card) or fills the whole label (a card-sized sheet, or a
--                   sticker that goes onto a blank plastic card)
--
-- Each label type (address, booklet, locker, card) has a default layout, kept in
-- config as label_default_layout_<type> = the layout's id; /labels can still pick
-- any layout for one print run.
--
-- Stays in config: booklet_label_message, banner_url and printer_margin_mm (the
-- last is about the printer, not the sheet).
--
-- L7163 is seeded from the measurements already tuned in config, so existing
-- prints don't move. The other sizes are Avery's published ones; their margins and
-- gaps should be checked with a test print on plain paper held against a real sheet.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod —
-- BEFORE deploying the code that uses this table.

create table label_layouts (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  description    text,
  width_mm       numeric(6, 2) not null check (width_mm > 0),
  height_mm      numeric(6, 2) not null check (height_mm > 0),
  top_margin_mm  numeric(6, 2) not null default 0 check (top_margin_mm >= 0),
  left_margin_mm numeric(6, 2) not null default 0 check (left_margin_mm >= 0),
  column_gap_mm  numeric(6, 2) not null default 0 check (column_gap_mm >= 0),
  row_gap_mm     numeric(6, 2) not null default 0 check (row_gap_mm >= 0),
  per_row        integer not null check (per_row between 1 and 20),
  per_col        integer not null check (per_col between 1 and 50),
  card_outline   boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table label_layouts enable row level security;

-- L7163 from the current config values (falling back to Avery's figures if a key is missing)
insert into label_layouts (name, description, width_mm, height_mm, top_margin_mm, left_margin_mm, column_gap_mm, row_gap_mm, per_row, per_col, card_outline)
select
  'Avery L7163',
  'Sticky, 14 per sheet. Membership cards are drawn squashed to the label height.',
  coalesce((select nullif(value, '')::numeric from config where key = 'label_width_mm'), 99.1),
  coalesce((select nullif(value, '')::numeric from config where key = 'label_height_mm'), 38.1),
  coalesce((select nullif(value, '')::numeric from config where key = 'top_margin_mm'), 15.15),
  coalesce((select nullif(value, '')::numeric from config where key = 'left_margin_mm'), 4.76),
  coalesce((select nullif(value, '')::numeric from config where key = 'column_gap_mm'), 2.54),
  coalesce((select nullif(value, '')::numeric from config where key = 'row_gap_mm'), 0),
  coalesce((select nullif(value, '')::integer from config where key = 'labels_per_row'), 2),
  coalesce((select nullif(value, '')::integer from config where key = 'labels_per_col'), 7),
  true;

insert into label_layouts (name, description, width_mm, height_mm, top_margin_mm, left_margin_mm, column_gap_mm, row_gap_mm, per_row, per_col, card_outline) values
  ('Avery L7165', 'Sticky, 8 per sheet. Fits a full credit-card outline to cut out. Check margins with a test print.', 99.1, 67.7, 13.1, 4.65, 2.5, 0, 2, 4, true),
  ('Avery L7173', 'Sticky, 10 per sheet. Fits a full credit-card outline to cut out. Check margins with a test print.', 99.1, 57, 6, 4.65, 2.5, 0, 2, 5, true),
  ('Avery J4785 / L4785', 'Sticky name badges, 80 x 50 mm, 10 per sheet (J = inkjet, L = laser). Fits on a blank plastic card. Removable glue. Margins estimated - check with a test print.', 80, 50, 13.5, 20, 10, 5, 2, 5, false),
  ('Avery L7161', 'Sticky, 63.5 x 46.6 mm, 18 per sheet. Fits on a blank plastic card. Check margins with a test print.', 63.5, 46.6, 8.7, 7.25, 2.5, 0, 3, 6, false),
  ('Avery C32011', 'Business cards (not sticky), 85 x 54 mm, 10 per sheet, snap-out clean edges. Margins estimated - check with a test print.', 85, 54, 13.5, 15, 10, 0, 2, 5, false),
  ('Avery L7418', 'Name badge inserts (card, not sticky), 86 x 55 mm, 8 per sheet, micro-perforated. Margins estimated - check with a test print.', 86, 55, 23.5, 14, 10, 10, 2, 4, false);

-- Default layout per label type. updateConfig only updates existing keys, so they're created here.
insert into config (key, value) values
  ('label_default_layout_address', (select id::text from label_layouts where name = 'Avery L7163')),
  ('label_default_layout_booklet', (select id::text from label_layouts where name = 'Avery L7163')),
  ('label_default_layout_locker',  (select id::text from label_layouts where name = 'Avery L7163')),
  ('label_default_layout_card',    (select id::text from label_layouts where name = 'Avery J4785 / L4785'))
on conflict (key) do nothing;

-- The sheet measurements now live on the layouts
delete from config where key in (
  'label_width_mm', 'label_height_mm', 'top_margin_mm', 'left_margin_mm',
  'column_gap_mm', 'row_gap_mm', 'labels_per_row', 'labels_per_col'
);
