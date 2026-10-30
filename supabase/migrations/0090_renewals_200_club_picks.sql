-- 0090_renewals_200_club_picks.sql
-- 200 Club numbers chosen on the renewal form (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §9).
--
-- club_200_picked_numbers holds the numbers the member chose, saved with the draft so
-- they come back when the form is reopened. Nothing is reserved while it's a draft: on
-- Submit the picks are inserted into two_hundred_club_entries (unique (season, number)
-- stops two members getting the same number). Entries beyond the picks are "Any number"
-- and show on /200-club as still to allocate. Kept after Submit as a record of what was
-- asked for. club_200_preferred_numbers (the old free-text box) is no longer written.

alter table renewals add column if not exists club_200_picked_numbers text[] not null default '{}';
