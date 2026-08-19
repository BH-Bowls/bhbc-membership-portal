-- 0008_seed_step2_config.sql
-- Phase 0/1 migration, Step 2 — config keys referenced by this step
-- age_reference_date has no consumer yet (Renewals stays on Sheets in Phase 1) but is
-- seeded now since it's cheap and the key needs to exist before updateLabelConfig()
-- can ever update it. min_friendlies_for_competitions is the >=8 threshold currently
-- hardcoded in app/api/renewals/route.ts.

insert into config (key, value) values
  ('age_reference_date', '03-01'),   -- MM-DD, i.e. 1 March; bumped forward manually each year
  ('min_friendlies_for_competitions', '8')
on conflict (key) do nothing;
