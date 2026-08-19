-- 0019_impersonation_log.sql
-- Phase 0/1 migration, Step 1 fix — impersonation_log table
-- Referenced throughout the plan ("ImpersonationLog... becoming real FKs to
-- users(username)") but never given a schema, same gap-class as login_attempts (0016)
-- and password_reset_requests (0018). Matches SCHEMA.md's ImpersonationLog columns
-- (§1.3), UUID id instead of the sheet's counter-based id.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists impersonation_log (
  id               uuid primary key default gen_random_uuid(),
  session_id       text not null,
  action           text not null check (action in ('START','STOP')),
  admin_user_name  text references users(username) on update cascade,
  admin_name       text,
  admin_role       text,
  target_user_name text references users(username) on update cascade,
  target_name      text,
  target_role      text,
  ip_address       text,
  user_agent       text,
  logged_at        timestamptz not null default now()
);

alter table impersonation_log enable row level security;
