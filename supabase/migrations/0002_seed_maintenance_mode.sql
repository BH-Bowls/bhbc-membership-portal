-- 0002_seed_maintenance_mode.sql
-- Seeds the maintenance_mode key so it can be toggled via Supabase's Table Editor
-- (Dev, for now) or later via the admin config UI once that's cut over to Postgres.
-- updateLabelConfig() only updates existing keys, so this row must exist upfront.

insert into config (key, value)
values ('maintenance_mode', 'false')
on conflict (key) do nothing;
