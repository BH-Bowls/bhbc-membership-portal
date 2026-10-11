-- 0075_halveit_money_and_order.sql
-- Halve It nights gain:
--   money_in_pence / money_out_pence — the night's takings and what was paid out
--     (nightly winnings, and the monthly prize on the first night of the next
--     month). The balance isn't stored: each night's brought-forward is worked out
--     in date order from the start of the season, which always starts at £0 (the
--     season's balance goes to charity).
--   player_order — tonight's players in the order they're written on the game
--     sheets, so score entry runs down the sheet. Purely for entry; no stats use it.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod —
-- BEFORE deploying the code that uses these columns.

alter table halveit_nights
  add column money_in_pence  integer not null default 0 check (money_in_pence >= 0),
  add column money_out_pence integer not null default 0 check (money_out_pence >= 0),
  add column player_order    uuid[]  not null default '{}';
