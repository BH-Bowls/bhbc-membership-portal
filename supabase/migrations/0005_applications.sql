-- 0005_applications.sql
-- Phase 0/1 migration, Step 2 — applications table
-- New scope, not a straight port: live code only has a single terminal 'Rejected'
-- status. Adding a Declined/Didn't Proceed split — see specs/Phase_0_1_Migration_Plan.md,
-- Step 2, for the full reasoning. Both new statuses are manual-only, never automatic.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists applications (
  id                uuid primary key default gen_random_uuid(),
  status            text not null default 'Submitted'
                      check (status in ('Submitted','Listed','Approved','Paid','Converted','Declined','Didn''t Proceed')),
  first_name text, last_name text, email text, mobile text,
  address_1 text, address_2 text, post_code text,
  requested_member_type text,
  submitted_at      timestamptz not null default now(),
  reviewed_by       text references users(username) on update cascade,
  reviewed_at       timestamptz,
  decision_reason   text,          -- informal free text — covers objections and threshold-cap declines alike
  converted_user_id uuid references users(id)   -- set on Converted, links forward rather than deleting the application
);

alter table applications enable row level security;
