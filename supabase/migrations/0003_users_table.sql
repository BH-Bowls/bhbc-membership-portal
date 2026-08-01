-- 0003_users_table.sql
-- Phase 0/1 migration, Step 1 — Users table
-- Auth mechanics only (login, password, role membership). Domain/profile data lives on
-- member_profiles (Step 2), joined via user_id — see specs/Phase_0_1_Migration_Plan.md,
-- "Key architectural decision" section, for the full reasoning behind this split and the
-- UUID-vs-text-PK decision.
--
-- Schema only — this does not populate real member data. That happens later, together
-- with Step 2 (member_profiles), as one deliberate migration-script run per the plan's
-- Cutover Procedure, not as part of standing up the schema itself.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists users (
  id                  uuid primary key default gen_random_uuid(),
  username            text not null unique,
  password_hash       text not null,
  is_temp_password    boolean not null default false,
  account_type        text not null check (account_type in ('member','shared')),
  is_active           boolean not null default true,   -- Leavers replacement, see Step 2
  last_login_at       timestamptz,
  reset_token         text,
  reset_token_expires timestamptz,
  created_at          timestamptz not null default now()
);

alter table users enable row level security;

create table if not exists user_roles (   -- replaces the comma-separated `role` string column
  user_id  uuid references users(id) on delete cascade,
  role     text not null,                 -- 'Captain','Admin','GMC',...
  primary key (user_id, role)
);

alter table user_roles enable row level security;
