-- 0042_season_planning_capacity_config.sql
-- Season Planning — seeds the config keys the Friendlies same-day capacity
-- warnings read: green_total_rinks (the green's physical rink count),
-- capacity_warning_threshold (Home-rinks sum at which the amber warning
-- fires, before the hard ceiling), and max_players_per_day (a soft guide,
-- not enforced — a Home 6-rink game plus an Away 6-rink game the same day
-- doesn't clash on rinks at all since only Home fixtures count against the
-- green, but it can still strain the player pool, since an Away fixture
-- still needs a full team from the club).
--
-- updateConfig() (config-supabase.ts) only ever updates existing rows, never
-- inserts — these need to exist as real rows before /admin/config's General
-- tab can edit them, same reason every other config default gets seeded via
-- a migration rather than relying on the app to create it.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

insert into config (key, value) values
  ('season_planning_green_total_rinks', '6'),
  ('season_planning_capacity_warning_threshold', '5'),
  ('season_planning_max_players_per_day', '20')
on conflict (key) do nothing;
