-- Renewals + RenewalPayments, cut over from the "Renewals"/"RenewalPayments" Google Sheets.
--
-- season_year makes this a real multi-year history table rather than the Sheets version's
-- single current-cycle row-per-member (that sheet has no year column at all — it's wiped
-- and reused each season by hand). No in-app reset/archive mechanism exists today, so
-- rather than build one, this keeps every season's data and callers filter to the current
-- season_year themselves.
--
-- Three consumers share this table (confirmed by reading all three before designing this):
--   1. The member-facing renewal form (renewals-supabase.ts / app/api/renewals)
--   2. Competitions' entrant lookup (competitions-sheets.ts's getEntrantsFromRenewals reads
--      the per-competition comp_*/sub_* flags directly)
--   3. Banking's payment reconciliation (banking-sheets.ts's getRenewalsWithOutstanding/
--      updateRenewalPayment read+write the payment/banking columns directly)

create table if not exists renewals (
  id                          uuid primary key default gen_random_uuid(),
  username                    text not null references users(username) on update cascade,
  season_year                 int not null,

  renewing_membership         boolean,  -- null = not yet decided this season
  -- The Sheets version overloaded renewing_membership with a third sentinel value ('X')
  -- meaning "an admin has locked this member's renewal" (blocks the member's own edit
  -- access, shown as a "renewals closed" message) — kept as its own column here instead
  -- of losing renewing_membership's clean boolean semantics.
  renewals_closed              boolean not null default false,
  playing_fee                 numeric(10,2) not null default 0,
  social_fee                  numeric(10,2) not null default 0,
  competitions_fee            numeric(10,2) not null default 0,
  club_200_fee                numeric(10,2) not null default 0,
  total_fee_due                numeric(10,2) not null default 0,

  -- Per-competition entry flags — read directly by Competitions' entrant lookup
  comp_mens_championship      boolean not null default false,
  comp_ladies_maynard         boolean not null default false,
  comp_mens_two_wood          boolean not null default false,
  comp_ladies_two_wood        boolean not null default false,
  comp_married_pairs          boolean not null default false,
  comp_drawn_pairs            boolean not null default false,
  comp_australian_pairs       boolean not null default false,
  comp_drawn_triples          boolean not null default false,
  comp_handicap                boolean not null default false,
  comp_oldlands                boolean not null default false,
  comp_veterans                 boolean not null default false,
  sub_drawn_pairs              boolean not null default false,
  sub_australian_pairs        boolean not null default false,
  sub_drawn_triples            boolean not null default false,

  -- 200 Club
  club_200_entries             int not null default 0,
  club_200_preferred_numbers   text,

  -- Duty preferences
  cleaning_dates_to_avoid     text,
  tea_dates_to_avoid          text,

  -- Payment / banking — read and written directly by Banking's reconciliation
  outstanding                  numeric(10,2),
  banking                      numeric(10,2),
  donations                    numeric(10,2),
  difference                   numeric(10,2),
  bank_transfer                 numeric(10,2),
  card_machine                  numeric(10,2),
  cheque                        numeric(10,2),
  cash                          numeric(10,2),
  payment_ids                  text,
  payment_notes                 text,
  date_paid                     date,

  confirmation_email_date      timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz,

  unique (username, season_year)
);

create index if not exists renewals_season_year_idx on renewals (season_year);

create table if not exists renewal_payments (
  id             uuid primary key default gen_random_uuid(),
  payment_id     text not null unique,   -- human-readable P001-style reference, kept as-is
  date           date not null,
  type           text not null check (type in ('TRF', 'CDM', 'CHQ', 'CSH')),
  reference      text,
  amount         numeric(10,2) not null,
  status         text not null default 'Unmatched' check (status in ('Unmatched', 'Matched', 'Deleted')),
  matched_users  text,   -- comma-separated usernames, kept as-is to match existing matching logic
  created_at     timestamptz not null default now()
);

alter table renewals enable row level security;
alter table renewal_payments enable row level security;
