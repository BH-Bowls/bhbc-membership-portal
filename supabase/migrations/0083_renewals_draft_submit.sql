-- 0083_renewals_draft_submit.sql
-- Renewals Draft/Submit (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §3) and the printed
-- membership book question (§3.8).
--
-- submitted_at null = draft (or not started). Once set, PUT /api/renewals refuses any
-- change to the renewal, for every role — the only exception is reopening a
-- "not renewing" submission (§3.7), which clears it again.
--
-- Backfill: every save before this migration behaved as a submission (each one sent the
-- confirmation email), so every row that has an answer to renewing_membership is treated
-- as submitted.
--
-- Apply BEFORE deploying the code that reads these columns.

alter table renewals add column if not exists submitted_at timestamptz;
alter table renewals add column if not exists submitted_by text;

update renewals
set submitted_at = coalesce(confirmation_email_date, updated_at, created_at),
    submitted_by = username
where renewing_membership is not null
  and submitted_at is null;

create index if not exists renewals_submitted_idx on renewals (season_year, submitted_at);

-- A standing preference that carries from year to year; null = never answered.
alter table member_profiles add column if not exists printed_membership_book boolean;
