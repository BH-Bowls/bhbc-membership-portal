-- 0051_rowland_entries.sql
-- Rowland Cup team entry — see Specs/ROWLAND_TEAM_ENTRY_SPEC.md for the full design.
-- Schema + entry form only this pass — the bank-rec table (rowland_payments) and the
-- draw-setup link columns on rowland_matches are deliberately not part of this
-- migration, per the spec's build order (§10), decided later.

-- One row per club that enters a season. Payment tracking lives here (not per team) —
-- every team a club enters is paid for in a single combined bank transfer, so there's
-- never a reason to split payment status by team. See §7.1 of the spec for why the
-- payment reference is just the club name, no ER/GR suffix.
create table if not exists rowland_entries (
  id                    uuid primary key default gen_random_uuid(),
  club_name             text not null references club_profiles(club_name),
  season                text not null,               -- e.g. '2027'
  consent_to_publish    boolean not null default false,
  submitted_at          timestamptz not null default now(),
  amount_due_pence      int not null default 0,        -- snapshot: teams-at-submission x fee-at-submission
  amount_received_pence int not null default 0,
  payment_status        text not null default 'Unpaid' check (payment_status in ('Unpaid', 'Partial', 'Paid')),
  payment_received_at   timestamptz,
  notes                 text,
  unique (club_name, season)
);

-- One row per team a club enters — Edward and Gladys are entered separately, up to 2
-- teams (team_number 1/2) each. No separate "contacts" table: the contact for that
-- specific team lives directly on this row, since a contact only ever exists in the
-- context of the team(s) they're attached to. The same person's details may appear on
-- more than one row if a club reuses one contact across teams — a deliberate simplicity
-- trade-off over a joined contacts table (see Specs/ROWLAND_TEAM_ENTRY_SPEC.md §2).
--
-- assigned_comp_id/assigned_team_letter are NOT added yet — that's the draw-setup
-- integration (spec §6), deliberately deferred to a later migration once the committee
-- workflow around it is decided.
create table if not exists rowland_team_entries (
  id                  uuid primary key default gen_random_uuid(),
  rowland_entry_id    uuid not null references rowland_entries(id) on delete cascade,
  trophy              text not null check (trophy in ('edward', 'gladys')),
  team_number         smallint not null check (team_number in (1, 2)),
  contact_name        text not null,
  contact_phone       text not null,
  contact_email       text not null,
  created_at          timestamptz not null default now(),
  unique (rowland_entry_id, trophy, team_number)
);

-- Each team-entry's own status-check link (no login) — one token per team, not per
-- person, so a contact covering 2 teams gets 2 links (bundled into one email at send
-- time, not modelled as a shared token here). Same "lazy token, resolved server-side"
-- pattern as Friendly game tokens.
create table if not exists rowland_access_tokens (
  token           text primary key,
  team_entry_id   uuid not null references rowland_team_entries(id) on delete cascade,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz
);

create index if not exists rowland_team_entries_entry_id_idx on rowland_team_entries (rowland_entry_id);
create index if not exists rowland_access_tokens_team_entry_id_idx on rowland_access_tokens (team_entry_id);

alter table rowland_entries enable row level security;
alter table rowland_team_entries enable row level security;
alter table rowland_access_tokens enable row level security;

-- Config keys the entry form needs. rowland_entry_fee was explicitly requested as
-- configurable; rowland_entry_deadline and rowland_entry_season were not, but are
-- seeded the same way since they're the same kind of per-season value that would
-- otherwise need a code change every year — easy to hardcode instead if that's not
-- wanted. rowland_entry_season is which season's rowland_entries.season new
-- submissions get tagged with (independent of whether that season's rowland_comps
-- rows exist yet — entries are club-level, not tied to a specific comp). All three
-- are placeholders: update via the config table before entries actually open.
insert into config (key, value) values
  ('rowland_entry_fee', '16.00'),
  ('rowland_entry_deadline', '2027-02-28'),
  ('rowland_entry_season', '2027')
on conflict (key) do nothing;
