-- 0024_fixtures_paired_text.sql
-- fixtures.paired was created as `boolean not null default false` in 0012, but the
-- real field carries three meaningful states, not two: '' (not paired), 'Y' (linked,
-- still open for combined entry), 'C' (linked, closed/split — see
-- app/api/fixtures/manage/game/[rowNumber]/route.ts's mismatched-pairs check, which
-- treats both 'Y' and 'C' as "paired" but needs to tell them apart). A boolean can't
-- represent this — switching to text to match the live Sheet's actual values.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table fixtures
  alter column paired drop default,
  alter column paired type text using (case when paired then 'Y' else '' end),
  alter column paired set default '';
