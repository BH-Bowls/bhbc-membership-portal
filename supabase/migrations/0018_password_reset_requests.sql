-- 0018_password_reset_requests.sql
-- Phase 0/1 migration, Step 1 fix — password_reset_requests table
-- Backs the forgot-password rate limit (max 3/hour), matching the PasswordResetRequests
-- sheet. reset_token/reset_token_expires themselves already live on users (Step 1).
-- Found while cutting over the forgot-password/reset-password flow.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists password_reset_requests (
  id           uuid primary key default gen_random_uuid(),
  identifier   text not null,     -- username or email as typed, may not resolve to a user
  user_name    text references users(username) on update cascade,   -- null if not resolved
  requested_at timestamptz not null default now()
);

alter table password_reset_requests enable row level security;
