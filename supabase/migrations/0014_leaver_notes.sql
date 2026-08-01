-- 0014_leaver_notes.sql
-- Phase 0/1 migration, Step 2 fix — leaver_notes column
-- Found while building the Leavers migration: the live Leavers sheet has both
-- left_reason and left_notes as distinct fields, but 0004's member_profiles only added
-- leaver_reason. Same gap-class as the earlier member_profiles/users fixes (0010, 0011).
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table member_profiles
  add column leaver_notes text;
