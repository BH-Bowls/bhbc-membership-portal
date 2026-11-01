-- 0081_honours_boards_a3_stacked.sql
-- Printed honours boards (0078–0080): adds a fourth layout,
--
--   'stacked_a3' — two A3 landscape sheets, one above the other, in one A2 portrait
--                  frame. The same layout as 'stacked' (two A2 sheets), scaled down:
--                  half the frames, names about 15pt instead of about 21pt.
--
-- The check lists every layout (including 0082's 'a2_plus_a3'), so 0081 and 0082 can be
-- applied in either order.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod —
-- BEFORE deploying the code that uses this layout.

alter table honours_boards drop constraint if exists honours_boards_layout_check;

alter table honours_boards
  add constraint honours_boards_layout_check
  check (layout in ('a2_plus_a3', 'stacked', 'stacked_a3', 'side_by_side', 'single'));
