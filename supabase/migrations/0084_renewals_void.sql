-- 0084_renewals_void.sql
-- Void renewal (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §5): an Admin can void a whole
-- submitted renewal while nothing at all has been paid on it. Purely financial — the
-- void sets outstanding to 0 and records who, when and why; it doesn't change the
-- member's choices, competition entries or 200 Club numbers.
--
-- Apply BEFORE deploying the code that reads these columns.

alter table renewals add column if not exists voided_at timestamptz;
alter table renewals add column if not exists voided_by text;
alter table renewals add column if not exists void_reason text;

alter table renewals drop constraint if exists renewals_void_needs_submit;
alter table renewals add constraint renewals_void_needs_submit
  check (voided_at is null or (submitted_at is not null and void_reason is not null and voided_by is not null));
