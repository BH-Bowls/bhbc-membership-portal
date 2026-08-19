-- 0039_competition_match_time.sql
-- Add a played_time companion column to competition_matches.played_date — same
-- "arrange when you're actually playing" self-service model as playedDate/marker,
-- just extended to also capture a time, not just a date.

alter table competition_matches add column if not exists played_time text;   -- HH:MM
