-- 0015_applications_full_columns.sql
-- Phase 0/1 migration, Step 2 fix — complete applications against the live Application
-- TypeScript interface (src/lib/applications-sheets.ts). No SCHEMA.md documentation
-- exists for Applications at all, so the live interface is the only source of truth —
-- same gap-class as the member_profiles/users/leaver_notes fixes (0010, 0011, 0014).
--
-- One naming decision, not silently made: the live data already has `decisionNotes`,
-- which looks like the same concept as this table's `decision_reason` (both: free text
-- explaining an admin's decision on an application). Treated as one field — renamed
-- rather than kept as two overlapping columns. Flag if these were actually meant to be
-- distinct (e.g. general notes vs. specifically a decline reason).
--
-- reviewed_by/reviewed_at (from the original 0005 migration) have no direct source in
-- the live sheet at all — the live system doesn't track who reviewed an application,
-- only who it was converted by (converted_user_id, already correctly FK'd). Left as-is:
-- new capture going forward, nothing to backfill.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table applications
  add column known_as text,
  add column gender text,
  add column landline text,
  add column address_3 text,
  add column age_demographic text,
  add column dob text,                    -- freeform, matches birthdate's treatment elsewhere
  add column ft_education text,
  add column previous_experience text,
  add column disabilities text,
  add column proposer_name text,
  add column seconder_name text,
  add column listed_date timestamptz,
  add column fee_due numeric,
  add column fee_paid numeric,
  add column payment_method text,
  add column payment_date timestamptz,
  add column approved_at timestamptz,
  add column converted_at timestamptz;

alter table applications rename column decision_reason to decision_notes;
