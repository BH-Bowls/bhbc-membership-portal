-- 0010_member_profiles_full_columns.sql
-- Phase 0/1 migration, Step 2 fix — complete member_profiles against SCHEMA.md's full
-- Members column list. The original 0004 migration matched the plan document's
-- illustrative SQL block, which (unlike the Games block) carried no "etc." marker and
-- was mistakenly treated as exhaustive. These are genuine, needed fields the plan never
-- explicitly discussed dropping — distinct from age/gmail_labels/the Friendlies counts,
-- which were all explicitly and deliberately excluded with stated reasons.
--
-- Column types follow SCHEMA.md's own type column: fields it types "Boolean" become real
-- booleans (social_emails, handbook_entry); fields it types "String" stay text even when
-- Y/N-shaped, matching the precedent already set by `honorary` in 0004 (also Y/N/blank,
-- kept as text, not converted).
--
-- One assumption, not explicitly confirmed: `address` (SCHEMA.md: "Combined multiline
-- address field (denormalised)") is dropped rather than ported, on the same reasoning
-- the plan already applied to full_name — a denormalised display copy of address_1/2/3,
-- not source data. Flag if this is wrong; trivial to add back.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table member_profiles
  add column title text,
  add column comments text,
  add column social_emails boolean not null default false,
  add column handbook_entry boolean not null default false,
  add column driving_away_matches text,
  add column driving_additional_info text,
  add column green_maintenance text,
  add column green_additional_info text,
  add column bar_duty text,
  add column bar_additional_info text,
  add column other_skills text,
  add column gmc text,                        -- 'GMC' or blank, not Y/N
  add column profile_updated_at timestamptz,   -- renamed from profile_updated_date for
                                                -- consistency with created_at/left_at
  add column renew_status text,                -- current renewal cycle status; Renewals
                                                -- itself stays on Sheets in Phase 1, but
                                                -- this is real member data, no stated
                                                -- reason to exclude it
  add column include text,                     -- controls renewal email inclusion
  add column renewal_email_sent_status text,
  add column member_email_sent_status text,
  add column label_0 text,
  add column label_3 text,
  add column darts text,
  add column label_bar_duty text,
  add column county_ladies text,
  add column label_green_maint text,
  add column label_9 text,
  add column label_10 text;
