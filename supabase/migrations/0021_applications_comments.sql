-- 0021_applications_comments.sql
-- Phase 1, member-access cutover — real gap found while building applications-supabase.ts:
-- the live Application interface has a `comments` field (free text captured on the public
-- /apply form, written by app/api/apply/route.ts) that was never added to the applications
-- table — 0015's full-columns pass missed it, and migrate-applications.ts silently drops it
-- on migration. Not currently displayed anywhere in the admin review UI, but it's real
-- applicant-submitted data that should not be lost going forward.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table applications
  add column comments text;
