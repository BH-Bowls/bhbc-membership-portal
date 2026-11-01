-- 0085_renewals_xero_journal.sql
-- Renewals → Xero summary journal (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §6).
--
-- The portal holds every member-level event; Xero gets one Manual Journal per day with
-- totals by account. To know what's been exported, every event carries the id of the
-- export that included it:
--   - a renewal's submission and its void (renewals.xero_submit_export_id / _void_)
--   - everything else that changes what a member owes, in renewal_transactions:
--     payments matched in Banking (and later the till and Stripe), and the treasurer's
--     adjustments (extra charge, credit, refund).
--
-- renewal_transactions is one ledger rather than the spec's separate
-- renewal_adjustments table, so payments and adjustments export, and add up for the
-- debtors report, the same way.
--
-- Apply BEFORE deploying the code that uses it.

-- ============================================================================
-- EXPORTS
-- ============================================================================

create table if not exists renewal_xero_exports (
  id             uuid primary key default gen_random_uuid(),
  exported_at    timestamptz not null default now(),
  exported_by    text not null,
  from_date      date not null,
  to_date        date not null,
  journal_count  int not null,
  csv            text not null      -- stored, so "Download again" gives the identical file
);

alter table renewal_xero_exports enable row level security;

alter table renewals add column if not exists xero_submit_export_id uuid references renewal_xero_exports(id);
alter table renewals add column if not exists xero_void_export_id uuid references renewal_xero_exports(id);

-- Where a Banking payment came from. Everything today comes from the HSBC statement
-- import or the Add Payments page; the till (§8) and Stripe (§11) add their own.
alter table renewal_payments add column if not exists source text not null default 'banking';
alter table renewal_payments drop constraint if exists renewal_payments_source_check;
alter table renewal_payments add constraint renewal_payments_source_check
  check (source in ('banking', 'till', 'stripe'));

-- ============================================================================
-- TRANSACTIONS
-- ============================================================================

create table if not exists renewal_transactions (
  id              uuid primary key default gen_random_uuid(),
  season_year     int not null,
  username        text not null references users(username) on update cascade,
  kind            text not null check (kind in ('payment', 'charge', 'credit', 'refund')),
  txn_date        date not null,              -- the journal date (bank date for a payment)
  amount          numeric(10,2) not null check (amount >= 0),
  -- payment only: the part of amount that's a donation, not a fee
  donation        numeric(10,2) not null default 0 check (donation >= 0),
  -- payment only: Banking's "difference" — added to what's owed (negative = written off)
  write_off       numeric(10,2) not null default 0,
  source          text check (source in ('banking', 'till', 'stripe')),
  method          text check (method in ('card', 'cash')),   -- till payments: which clearing account
  payment_ids     text,                       -- P### ids, for a payment
  fee_type        text check (fee_type in ('playing', 'social', 'competitions', '200_club')),
  refund_via      text check (refund_via in ('bank', 'stripe')),
  reason          text,
  created_by      text not null,
  created_at      timestamptz not null default now(),
  xero_export_id  uuid references renewal_xero_exports(id),
  constraint renewal_transactions_payment check (
    kind <> 'payment' or (source is not null and (amount > 0 or write_off <> 0) and donation <= amount)
  ),
  constraint renewal_transactions_adjustment check (
    kind not in ('charge', 'credit') or (fee_type is not null and amount > 0 and reason is not null)
  ),
  constraint renewal_transactions_refund check (
    kind <> 'refund' or (refund_via is not null and amount > 0 and reason is not null)
  )
);

create index if not exists renewal_transactions_user_idx on renewal_transactions (season_year, username);
create index if not exists renewal_transactions_unexported_idx on renewal_transactions (xero_export_id) where xero_export_id is null;

alter table renewal_transactions enable row level security;

-- ============================================================================
-- RECORD AN EXPORT — all or nothing
-- ============================================================================
-- Inserts the export and stamps every event it covers in one transaction. If any of
-- them was already stamped (two exports at once), it raises and nothing is saved, so
-- an event can never be in two exports.

create or replace function renewals_xero_record_export(
  p_exported_by   text,
  p_from_date     date,
  p_to_date       date,
  p_journal_count int,
  p_csv           text,
  p_submit_ids    uuid[],
  p_void_ids      uuid[],
  p_txn_ids       uuid[]
) returns uuid
language plpgsql
as $$
declare
  v_export_id uuid;
  v_count     int;
begin
  insert into renewal_xero_exports (exported_by, from_date, to_date, journal_count, csv)
  values (p_exported_by, p_from_date, p_to_date, p_journal_count, p_csv)
  returning id into v_export_id;

  update renewals set xero_submit_export_id = v_export_id
  where id = any(p_submit_ids) and xero_submit_export_id is null;
  get diagnostics v_count = row_count;
  if v_count <> coalesce(array_length(p_submit_ids, 1), 0) then
    raise exception 'Some renewals were already exported — reload and try again';
  end if;

  update renewals set xero_void_export_id = v_export_id
  where id = any(p_void_ids) and xero_void_export_id is null;
  get diagnostics v_count = row_count;
  if v_count <> coalesce(array_length(p_void_ids, 1), 0) then
    raise exception 'Some voids were already exported — reload and try again';
  end if;

  update renewal_transactions set xero_export_id = v_export_id
  where id = any(p_txn_ids) and xero_export_id is null;
  get diagnostics v_count = row_count;
  if v_count <> coalesce(array_length(p_txn_ids, 1), 0) then
    raise exception 'Some payments or adjustments were already exported — reload and try again';
  end if;

  return v_export_id;
end;
$$;

-- ============================================================================
-- CONFIG — account codes are entered by the treasurer on /banking/renewals-xero
-- ============================================================================

insert into config (key, value) values ('renewals_nominal_debtors_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('renewals_nominal_transfers_clearing_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('renewals_nominal_stripe_clearing_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('renewals_nominal_playing_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('renewals_nominal_social_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('renewals_nominal_competitions_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('renewals_nominal_200_club_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('renewals_nominal_donations_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('renewals_nominal_adjustments_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('renewals_xero_tax_rate', 'No VAT') on conflict (key) do nothing;
insert into config (key, value) values ('renewals_xero_first_season', '2027') on conflict (key) do nothing;
