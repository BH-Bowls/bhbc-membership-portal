-- 0052_rowland_team_entry_status.sql
-- Lets the committee withdraw/suspend a specific team from the draw (e.g. payment
-- never arrives) without deleting the entry record — preserves the audit trail
-- ("this club entered, but was withdrawn for non-payment") rather than silently
-- disappearing rows. "Suspend a whole club" is just withdrawing every one of that
-- club's teams — no separate club-level status needed on rowland_entries.

alter table rowland_team_entries
  add column if not exists status text not null default 'Entered' check (status in ('Entered', 'Withdrawn'));
