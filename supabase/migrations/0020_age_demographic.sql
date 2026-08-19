-- 0020_age_demographic.sql
-- Phase 0/1 migration, Step 2 correction — age_demographic column
-- Reverses part of the earlier "Age" design decision. The plan treated
-- age_demographic as purely formula-computed and dropped it in favour of computing on
-- read from birthdate + age_reference_date. Found while building updateUserProfile:
-- the live profile-sheets.ts lets users/admins directly SET ageDemographic as a plain
-- field (validated against 'U18'/'18-24'/'25-59'/'60+'/'80+'), independent of any
-- formula — it is not purely derived in practice. Dropping it would silently break
-- profile editing. The raw numeric `age` (from birthdate) stays dropped/computed-on-read
-- as originally decided — only age_demographic (the band, directly editable) is restored.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table member_profiles
  add column age_demographic text
    check (age_demographic in ('U18','18-24','25-59','60+','80+') or age_demographic is null);
