-- 0028_sweeping_rota_date_unique.sql
-- sweeping_rota.date was meant to be unique from 0027 (the whole feature assumes at
-- most one row per date — every single-row lookup uses .maybeSingle(), which throws
-- if more than one row matches), but the constraint didn't end up on the deployed
-- table, breaking batchAddSweepingAssignments's upsert(..., { onConflict: 'date' }).
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table sweeping_rota add constraint sweeping_rota_date_key unique (date);
