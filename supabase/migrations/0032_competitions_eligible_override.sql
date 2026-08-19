-- 0032_competitions_eligible_override.sql
-- Manual admin override for club-competitions entry eligibility.
--
-- The original eligibility rule was "played >= 8 friendlies last season, OR an admin
-- manually approved an exception ('X' sentinel)". friendlies_last_year was deliberately
-- dropped from member_profiles in 0004 — meant to become a live query against
-- game_players once real Friendlies data lives in Postgres (still Sheets-only, deferred
-- with the rest of Friendlies migration). Until that data exists there's no count to
-- check at all, so the automatic half of the rule can't run.
--
-- Decided: default to NOT eligible when unset (renewals are already closed for this
-- season; by the time they reopen next season, a full season of real Postgres Friendlies
-- data should exist to compute this properly) — an admin sets this explicitly per member
-- in the meantime. null = no override set, true = eligible, false = explicitly not
-- eligible (kept distinct from null so an admin can override a future computed value too).

alter table member_profiles add column if not exists competitions_eligible_override boolean;
