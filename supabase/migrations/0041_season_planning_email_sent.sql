-- 0041_season_planning_email_sent.sql
-- Season Planning — widens the planning_status constraint (added generic
-- across fixture_type in 0036) to add 'Email Sent', per the settled design:
-- Friendlies get the full Projected -> Email Sent -> Confirmed chain, since
-- outreach emails are a real intermediate step Events never needed.
--
-- 0036's own comment already flagged this exact move ("Stage 2 will widen
-- this constraint (drop + re-add) when it's built"). Rearranged/Not Happening
-- stay dropped — Stage 1 replaced those with plain Edit/Delete after using it
-- in practice, and Friendlies follows the same simplified model.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table fixtures drop constraint if exists fixtures_planning_status_check;

alter table fixtures
  add constraint fixtures_planning_status_check
    check (planning_status is null or planning_status in ('Projected', 'Email Sent', 'Confirmed'));
