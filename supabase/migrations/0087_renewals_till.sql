-- 0087_renewals_till.sql
-- Paying a renewal at the bar till, by card or cash (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §8).
--
-- A till payment is a Banking payment that arrives already matched (source 'till'), plus
-- a renewal_transactions row so it goes in the renewals journal (Dr Card clearing or
-- Cash-in-hand, Cr Membership debtors). It never goes in the bar journal — so it isn't
-- mixed with bar takings — but the Day End must still know about it:
--   - cash renewal payments are physically in the till, so they're added to the Day End's
--     expected cash (otherwise each one shows as a surplus);
--   - card renewal payments are listed, so the till's card total can be checked against
--     the card machine's.
--
-- Apply BEFORE deploying the code that uses it.

-- ============================================================================
-- COLUMNS
-- ============================================================================

alter table renewal_payments add column if not exists day_end_id uuid references bar_day_ends(id);
alter table renewal_payments add column if not exists staff text;   -- who was serving
create index if not exists renewal_payments_till_unlinked_idx
  on renewal_payments (source) where source = 'till' and day_end_id is null;

alter table bar_day_ends add column if not exists renewal_cash_pence int not null default 0;
alter table bar_day_ends add column if not exists renewal_card_pence int not null default 0;

-- ============================================================================
-- RECORD A TILL PAYMENT — all or nothing
-- ============================================================================
-- Full amount due only (part payments go through Banking). p_amount must equal what's
-- outstanding right now, so the till can't take a stale amount if something changed
-- since the screen loaded. Returns the new P### payment id.

create or replace function renewals_record_till_payment(
  p_username     text,
  p_season_year  int,
  p_method       text,      -- 'card' or 'cash'
  p_amount       numeric,
  p_staff        text,      -- who was serving
  p_recorded_by  text       -- the till login
) returns text
language plpgsql
as $$
declare
  v_renewal   renewals;
  v_next      int;
  v_payment   text;
  v_today     date := (now() at time zone 'Europe/London')::date;
begin
  if p_method not in ('card', 'cash') then
    raise exception 'Payment method must be card or cash';
  end if;

  select * into v_renewal from renewals
   where lower(username) = lower(p_username) and season_year = p_season_year
   for update;
  if not found then
    raise exception 'No % renewal found for %', p_season_year, p_username;
  end if;
  if v_renewal.submitted_at is null then
    raise exception 'This renewal has not been submitted yet';
  end if;
  if v_renewal.voided_at is not null then
    raise exception 'This renewal has been voided';
  end if;
  if coalesce(v_renewal.outstanding, 0) <= 0 then
    raise exception 'This renewal is already paid';
  end if;
  if coalesce(v_renewal.outstanding, 0) <> p_amount then
    raise exception 'The amount due has changed to £% — please look the member up again', v_renewal.outstanding;
  end if;

  -- Same P### sequence as Banking and Stripe
  lock table renewal_payments in share row exclusive mode;
  select coalesce(max(substring(payment_id from 2)::int), 0) + 1
    into v_next
    from renewal_payments
   where payment_id ~ '^P[0-9]+$';
  v_payment := 'P' || lpad(v_next::text, 3, '0');

  insert into renewal_payments
    (payment_id, date, type, reference, amount, status, matched_users, source, staff)
  values
    (v_payment, v_today, case when p_method = 'card' then 'CDM' else 'CSH' end,
     'TILL ' || v_renewal.username, p_amount, 'Matched', v_renewal.username, 'till', p_staff);

  update renewals set
    card_machine = case when p_method = 'card' then coalesce(card_machine, 0) + p_amount else card_machine end,
    cash         = case when p_method = 'cash' then coalesce(cash, 0) + p_amount else cash end,
    banking      = coalesce(banking, 0) + p_amount,
    outstanding  = coalesce(outstanding, 0) - p_amount,
    date_paid    = v_today,
    payment_ids  = case when coalesce(payment_ids, '') = '' then v_payment else payment_ids || ',' || v_payment end,
    updated_at   = now()
  where id = v_renewal.id;

  insert into renewal_transactions
    (season_year, username, kind, txn_date, amount, source, method, payment_ids, created_by)
  values
    (p_season_year, v_renewal.username, 'payment', v_today, p_amount, 'till', p_method, v_payment,
     coalesce(nullif(p_staff, ''), p_recorded_by));

  return v_payment;
end;
$$;

-- ============================================================================
-- DAY END — also sweeps till renewal payments
-- ============================================================================
-- As 0066, plus: unlinked till renewal payments are totalled by method, cash ones are
-- added to cash expected, and all of them are linked to the new Day End. The bar
-- Xero journal doesn't post either total (src/lib/xero-export.ts) — the renewals
-- journal does.

create or replace function bar_create_day_end(p_staff text, p_cash_removed_pence int, p_carry_forward boolean, p_reason text default null)
returns bar_day_ends
language plpgsql
as $$
declare
  v_float int;
  v_carried_in int := 0;
  v_cash_topups int := 0;
  v_card_topups int := 0;
  v_refunds int := 0;
  v_wallet_sales int := 0;
  v_card_sales int := 0;
  v_cash_sales int := 0;
  v_cash_movements int := 0;
  v_discounts int := 0;
  v_renewal_cash int := 0;
  v_renewal_card int := 0;
  v_cash_expected int;
  v_difference int;
  v_carried_out int := 0;
  v_outstanding int := 0;
  v_day_end bar_day_ends;
begin
  select value::int into v_float from config where key = 'bar_till_float_pence';
  if v_float is null then v_float := 15000; end if;

  select value::int into v_carried_in from config where key = 'bar_cash_carried_forward_pence';
  if v_carried_in is null then v_carried_in := 0; end if;

  select
    coalesce(sum(case when payment_method = 'card' then amount_pence else 0 end), 0),
    coalesce(sum(case when payment_method = 'card' then 0 else amount_pence end), 0)
    into v_card_topups, v_cash_topups
    from bar_ledger where day_end_id is null and type = 'topup';

  select coalesce(sum(-amount_pence), 0) into v_refunds
    from bar_ledger where day_end_id is null and type = 'refund';

  select
    coalesce(sum(case when payment_method = 'wallet' then total_pence else 0 end), 0),
    coalesce(sum(case when payment_method = 'card' then total_pence else 0 end), 0),
    coalesce(sum(case when payment_method = 'cash' and not is_cash_movement then total_pence else 0 end), 0),
    coalesce(sum(case when payment_method = 'cash' and is_cash_movement then total_pence else 0 end), 0),
    coalesce(sum(discount_pence), 0)
    into v_wallet_sales, v_card_sales, v_cash_sales, v_cash_movements, v_discounts
    from bar_sales where day_end_id is null and voided = false;

  -- Membership fees taken at the till (renewals spec §8.3)
  select
    coalesce(sum(case when type = 'CSH' then round(amount * 100)::int else 0 end), 0),
    coalesce(sum(case when type = 'CDM' then round(amount * 100)::int else 0 end), 0)
    into v_renewal_cash, v_renewal_card
    from renewal_payments where source = 'till' and day_end_id is null and status <> 'Deleted';

  select coalesce(sum(balance_pence), 0) into v_outstanding from bar_accounts;

  v_cash_expected := v_carried_in + v_cash_topups + v_cash_sales + v_cash_movements + v_renewal_cash - v_refunds;
  v_difference := v_cash_expected - p_cash_removed_pence;

  if v_difference <> 0 and not p_carry_forward and (p_reason is null or trim(p_reason) = '') then
    raise exception 'A reason is required when the difference is not carried forward';
  end if;

  v_carried_out := case when p_carry_forward then v_difference else 0 end;

  insert into bar_day_ends (
    staff, float_pence, carried_in_pence, cash_topups_pence, cash_sales_pence, cash_movements_pence, refunds_pence,
    cash_expected_pence, cash_removed_pence, carried_forward, difference_reason,
    wallet_sales_pence, card_sales_pence, card_topups_pence, discounts_given_pence,
    outstanding_balance_pence, renewal_cash_pence, renewal_card_pence
  ) values (
    p_staff, v_float, v_carried_in, v_cash_topups, v_cash_sales, v_cash_movements, v_refunds,
    v_cash_expected, p_cash_removed_pence, p_carry_forward, p_reason,
    v_wallet_sales, v_card_sales, v_card_topups, v_discounts,
    v_outstanding, v_renewal_cash, v_renewal_card
  ) returning * into v_day_end;

  update config set value = v_carried_out::text where key = 'bar_cash_carried_forward_pence';

  -- Link everything unlinked, including voided sales/adjustment-only ledger rows
  -- (they don't contribute to the sums above, but must still stop showing up as
  -- "unlinked" in the next day end).
  update bar_ledger set day_end_id = v_day_end.id where day_end_id is null;
  update bar_sales set day_end_id = v_day_end.id where day_end_id is null;
  update renewal_payments set day_end_id = v_day_end.id where source = 'till' and day_end_id is null;

  return v_day_end;
end;
$$;
