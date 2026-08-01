-- 0016_login_attempts.sql
-- Phase 0/1 migration, Step 1 fix — login_attempts table
-- Referenced throughout the plan ("LoginAttempts... store bare username soft-references,
-- becoming real FKs to users(username)") but never actually given a schema — found while
-- building the Postgres-backed auth data layer. Matches SCHEMA.md's LoginAttempts column
-- list (§1.2), UUID id instead of the sheet's counter-based id.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists login_attempts (
  id             uuid primary key default gen_random_uuid(),
  identifier     text not null,      -- username or email as typed, may not resolve to a user
  user_name      text references users(username) on update cascade,   -- null if not resolved
  success        boolean not null,
  failure_reason text,
  ip_address     text,
  user_agent     text,
  device_type    text,
  attempted_at   timestamptz not null default now()
);

alter table login_attempts enable row level security;
