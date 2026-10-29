-- 0086_renewals_stripe.sql
-- Paying renewals online through Stripe Checkout (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §11).
--
-- A Stripe payment is recorded only by the webhook, through
-- renewals_record_stripe_payment() below, which does everything in one transaction and
-- is safe to call twice for the same Checkout session (Stripe retries webhooks).
--
-- Apply BEFORE deploying the code that uses it.

-- ============================================================================
-- RENEWALS
-- ============================================================================

-- Running total paid online, alongside bank_transfer / card_machine / cheque / cash
alter table renewals add column if not exists stripe numeric(10,2) not null default 0;

-- §11.3a "Submit and pay online": the webhook submitted the renewal and took the payment
-- together. Its journal lines are Dr Stripe clearing, Cr income — never Membership debtors.
alter table renewals add column if not exists paid_at_submission boolean not null default false;

-- While a "Submit and pay online" Checkout page is open, the draft is held so the amount
-- being paid can't drift from the form. Cleared by the webhook, or once it expires.
alter table renewals add column if not exists pending_checkout_session_id text;
alter table renewals add column if not exists pending_checkout_expires_at timestamptz;

-- ============================================================================
-- PAYMENTS
-- ============================================================================

alter table renewal_payments drop constraint if exists renewal_payments_type_check;
alter table renewal_payments add constraint renewal_payments_type_check
  check (type in ('TRF', 'CDM', 'CHQ', 'CSH', 'STR'));

alter table renewal_payments add column if not exists stripe_session_id text;
alter table renewal_payments add column if not exists stripe_payment_intent_id text;

-- One row per member paid for in a session — the guard against recording a retried
-- webhook twice
create unique index if not exists renewal_payments_stripe_session_member_idx
  on renewal_payments (stripe_session_id, matched_users)
  where stripe_session_id is not null;

-- ============================================================================
-- RECORD A STRIPE PAYMENT — all or nothing, once per session
-- ============================================================================
-- p_items: [{"username": "...", "amount": 132.00}, ...] — one per member paid for.
-- p_submit: true for §11.3a — also submits the (single) draft renewal and marks it
--           paid_at_submission. Its payment isn't a renewal_transactions row, because
--           the submission itself is journalled against Stripe clearing.
-- Returns the number of members recorded; 0 means the session was already recorded.

create or replace function renewals_record_stripe_payment(
  p_session_id        text,
  p_payment_intent_id text,
  p_paid_date         date,
  p_season_year       int,
  p_payer             text,
  p_items             jsonb,
  p_submit            boolean
) returns int
language plpgsql
as $$
declare
  v_item      jsonb;
  v_username  text;
  v_amount    numeric(10,2);
  v_next      int;
  v_payment   text;
  v_count     int := 0;
  v_updated   int;
begin
  -- Serialise Stripe recordings (and the P### numbering) against each other
  lock table renewal_payments in share row exclusive mode;

  if exists (select 1 from renewal_payments where stripe_session_id = p_session_id) then
    return 0;
  end if;

  select coalesce(max(substring(payment_id from 2)::int), 0)
    into v_next
    from renewal_payments
   where payment_id ~ '^P[0-9]+$';

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_username := v_item->>'username';
    v_amount := (v_item->>'amount')::numeric;
    v_next := v_next + 1;
    v_payment := 'P' || lpad(v_next::text, 3, '0');

    insert into renewal_payments
      (payment_id, date, type, reference, amount, status, matched_users, source,
       stripe_session_id, stripe_payment_intent_id)
    values
      (v_payment, p_paid_date, 'STR', 'STRIPE ' || v_username, v_amount, 'Matched', v_username, 'stripe',
       p_session_id, p_payment_intent_id);

    update renewals set
      stripe       = coalesce(stripe, 0) + v_amount,
      banking      = coalesce(banking, 0) + v_amount,
      outstanding  = coalesce(outstanding, 0) - v_amount,
      date_paid    = p_paid_date,
      payment_ids  = case when coalesce(payment_ids, '') = '' then v_payment else payment_ids || ',' || v_payment end,
      submitted_at = case when p_submit then now() else submitted_at end,
      submitted_by = case when p_submit then p_payer else submitted_by end,
      paid_at_submission = case when p_submit then true else paid_at_submission end,
      pending_checkout_session_id = case when p_submit then null else pending_checkout_session_id end,
      pending_checkout_expires_at = case when p_submit then null else pending_checkout_expires_at end,
      updated_at   = now()
    where lower(username) = lower(v_username)
      and season_year = p_season_year;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'No % renewal found for %', p_season_year, v_username;
    end if;

    if not p_submit then
      insert into renewal_transactions
        (season_year, username, kind, txn_date, amount, source, payment_ids, created_by)
      values
        (p_season_year, v_username, 'payment', p_paid_date, v_amount, 'stripe', v_payment, p_payer);
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ============================================================================
-- CONFIG
-- ============================================================================

-- Hides every "Pay online" button until switched on (Admin config → Renewals)
insert into config (key, value) values ('stripe_payments_enabled', 'false') on conflict (key) do nothing;
