-- 0011_users_full_columns.sql
-- Phase 0/1 migration, Step 1 fix — complete users against SCHEMA.md's full auth-field
-- list. Same gap-class as 0010's member_profiles fix: the original 0003 migration
-- matched the plan's illustrative SQL literally rather than cross-checking SCHEMA.md.
--
-- Named with the _at suffix already used for last_login_at/created_at, rather than the
-- sheet's _date naming, for consistency within this table.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table users
  add column last_login_failed_at    timestamptz,
  add column last_password_reset_at timestamptz;
