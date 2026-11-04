-- 0096_data_checks.sql
-- Data checks: a read-only sanity check of the bar, renewals and Xero data, shown on
-- /banking/data-checks. data_checks() returns one row per problem found; nothing
-- returned means everything that can be cross-checked agrees.
--
-- severity: 'error'   — figures that should always agree don't (money appeared, vanished
--                       or was counted twice), or a record is broken
--           'warning' — something to look at: overdue, unusual, or a setting not filled in
--           'info'    — for the Treasurer's information, not a fault
--
-- Each check runs in its own block, so one that fails to run (e.g. a column renamed
-- later) reports itself and the rest still run. It only reads — safe on production.
-- Renewals checks cover seasons from renewals_xero_first_season (the go-live season) on.
--
-- Apply BEFORE deploying the code that uses it.

create or replace function data_checks_gbp(p_pence bigint)
returns text
language sql
immutable
as $$
  select case when p_pence < 0 then '-£' else '£' end || to_char(abs(p_pence) / 100.0, 'FM999999990.00');
$$;

create or replace function data_checks_when(p_at timestamptz)
returns text
language sql
immutable
as $$
  select to_char(p_at at time zone 'Europe/London', 'DD Mon YYYY HH24:MI');
$$;

-- A Day End made from Non-Till Cash (raffle, teas) rather than by cashing up the till:
-- it never sweeps the till's records and isn't part of the carried-forward chain.
create or replace function data_checks_is_manual_day_end(p_day_end bar_day_ends)
returns boolean
language sql
stable
as $$
  select p_day_end.carried_in_pence = 0
     and p_day_end.cash_expected_pence = p_day_end.cash_removed_pence
     and p_day_end.wallet_sales_pence = 0
     and p_day_end.card_sales_pence = 0
     and not exists (select 1 from bar_ledger l where l.day_end_id = p_day_end.id)
     and exists (
       select 1 from bar_sales s
         join bar_sale_items i on i.sale_id = s.id
         join bar_products p on p.id = i.product_id
        where s.day_end_id = p_day_end.id and p.category = 'non_till_cash'
     );
$$;

create or replace function data_checks()
returns table (area text, check_name text, severity text, detail text, member_username text, link text)
language plpgsql
stable
set search_path = public
as $$
#variable_conflict use_column
declare
  v_first_season int;
begin
  begin
    select nullif(trim(value), '')::int into v_first_season from config where key = 'renewals_xero_first_season';
  exception when others then
    v_first_season := null;
  end;
  v_first_season := coalesce(v_first_season, 2027);

  -- ==========================================================================
  -- BAR ACCOUNTS — members' money
  -- ==========================================================================

  begin
    return query
    with ledger as (
      select user_name, sum(amount_pence)::bigint as total from bar_ledger group by user_name
    )
    select 'Bar accounts', 'Balance matches history', 'error',
           'Balance is ' || data_checks_gbp(coalesce(a.balance_pence, 0)) ||
           ' but the account history adds up to ' || data_checks_gbp(coalesce(l.total, 0)),
           coalesce(a.user_name, l.user_name), '/banking/member-accounts'
      from bar_accounts a
      full outer join ledger l on l.user_name = a.user_name
     where coalesce(a.balance_pence, 0) <> coalesce(l.total, 0);
  exception when others then
    return query select 'Bar accounts', 'Balance matches history', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    with purchases as (
      select sale_id, count(*) as n, sum(amount_pence)::bigint as total
        from bar_ledger where type = 'purchase' and sale_id is not null group by sale_id
    )
    select 'Bar accounts', 'Account payment taken from the account', 'error',
           'Sale ' || data_checks_when(s.created_at) || ' for ' || data_checks_gbp(s.total_pence) ||
           case when s.user_name is null then ' was paid by account but has no member'
                when p.n is null then ' was paid by account but nothing was taken from the account'
                when p.n > 1 then ' was taken from the account ' || p.n || ' times'
                else ' but ' || data_checks_gbp(-p.total) || ' was taken from the account' end,
           s.user_name, '/banking/member-accounts'
      from bar_sales s
      left join purchases p on p.sale_id = s.id
     where s.payment_method = 'wallet'
       and (s.user_name is null or p.n is null or p.n > 1 or p.total <> -s.total_pence);
  exception when others then
    return query select 'Bar accounts', 'Account payment taken from the account', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Bar accounts', 'Every account purchase has a sale', 'error',
           'A purchase of ' || data_checks_gbp(-l.amount_pence) || ' on ' || data_checks_when(l.created_at) ||
           case when l.sale_id is null then ' has no sale'
                when s.id is null then ' points to a sale that doesn''t exist'
                else ' points to a sale that wasn''t paid by account' end,
           l.user_name, '/banking/member-accounts'
      from bar_ledger l
      left join bar_sales s on s.id = l.sale_id
     where l.type = 'purchase'
       and (l.sale_id is null or s.id is null or s.payment_method <> 'wallet');
  exception when others then
    return query select 'Bar accounts', 'Every account purchase has a sale', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    with voids as (
      select sale_id, count(*) as n, sum(amount_pence)::bigint as total
        from bar_ledger where type = 'adjustment' and sale_id is not null group by sale_id
    )
    select 'Bar accounts', 'Voided account sales paid back', 'error',
           'Sale ' || data_checks_when(s.created_at) || ' for ' || data_checks_gbp(s.total_pence) ||
           case when s.voided and v.n is null then ' was voided but the money wasn''t put back on the account'
                when s.voided and v.n > 1 then ' was voided and the money put back ' || v.n || ' times'
                when s.voided then ' was voided but ' || data_checks_gbp(v.total) || ' was put back'
                else ' isn''t voided but money was put back on the account as if it was' end,
           s.user_name, '/banking/member-accounts'
      from bar_sales s
      left join voids v on v.sale_id = s.id
     where s.payment_method = 'wallet'
       and ((s.voided and (v.n is null or v.n > 1 or v.total <> s.total_pence))
            or (not s.voided and v.n is not null));
  exception when others then
    return query select 'Bar accounts', 'Voided account sales paid back', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Bar accounts', 'Money held for leavers', 'warning',
           case when u.username is null then 'Account holds ' || data_checks_gbp(a.balance_pence) || ' but the member no longer exists'
                else 'Account holds ' || data_checks_gbp(a.balance_pence) || ' but the member is no longer active' end,
           a.user_name, '/banking/member-accounts'
      from bar_accounts a
      left join users u on u.username = a.user_name
     where a.balance_pence > 0 and (u.username is null or not u.is_active);
  exception when others then
    return query select 'Bar accounts', 'Money held for leavers', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Bar accounts', 'Manual adjustments (last 30 days)', 'info',
           data_checks_gbp(l.amount_pence) || ' on ' || data_checks_when(l.created_at) ||
           coalesce(' by ' || nullif(l.staff, ''), '') || coalesce(' — ' || nullif(l.note, ''), ''),
           l.user_name, '/banking/member-accounts'
      from bar_ledger l
     where l.type = 'adjustment' and l.sale_id is null
       and l.created_at > now() - interval '30 days';
  exception when others then
    return query select 'Bar accounts', 'Manual adjustments (last 30 days)', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  -- ==========================================================================
  -- BAR SALES
  -- ==========================================================================

  begin
    return query
    with items as (
      select sale_id, sum(qty * unit_price_pence)::bigint as total, count(*) as n
        from bar_sale_items group by sale_id
    )
    select 'Bar sales', 'Sale total matches its items', 'error',
           'Sale ' || data_checks_when(s.created_at) || ' (' || s.payment_method || ') is ' || data_checks_gbp(s.total_pence) ||
           case when i.n is null then ' but has no items' else ' but its items add up to ' || data_checks_gbp(i.total) end,
           s.user_name, '/banking/bar-reconciliation'
      from bar_sales s
      left join items i on i.sale_id = s.id
     where coalesce(i.total, 0) <> s.total_pence or i.n is null;
  exception when others then
    return query select 'Bar sales', 'Sale total matches its items', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Bar sales', 'Full price less discount equals the total', 'error',
           'Sale ' || data_checks_when(s.created_at) || ': full price ' || data_checks_gbp(s.gross_total_pence) ||
           ' less discount ' || data_checks_gbp(s.discount_pence) || ' isn''t the total ' || data_checks_gbp(s.total_pence),
           s.user_name, '/banking/bar-reconciliation'
      from bar_sales s
     where s.gross_total_pence - s.discount_pence <> s.total_pence;
  exception when others then
    return query select 'Bar sales', 'Full price less discount equals the total', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Bar sales', 'Sales with nothing to pay', 'warning',
           'Sale ' || data_checks_when(s.created_at) || ' (' || s.payment_method || ') is for £0.00',
           s.user_name, '/banking/bar-reconciliation'
      from bar_sales s
     where s.total_pence = 0 and not s.voided;
  exception when others then
    return query select 'Bar sales', 'Sales with nothing to pay', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Bar sales', 'Voided after its Day End', 'warning',
           'Sale ' || data_checks_when(s.created_at) || ' for ' || data_checks_gbp(s.total_pence) ||
           ' was voided ' || data_checks_when(s.voided_at) || ', after the Day End of ' || data_checks_when(d.created_at) ||
           ' that counted it',
           s.user_name, '/banking/bar-reconciliation'
      from bar_sales s
      join bar_day_ends d on d.id = s.day_end_id
     where s.voided and s.voided_at > d.created_at;
  exception when others then
    return query select 'Bar sales', 'Voided after its Day End', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Bar sales', 'Voided card sale refunded to the card', 'warning',
           'Square card sale ' || data_checks_when(s.created_at) || ' for ' || data_checks_gbp(s.total_pence) ||
           ' was voided but there''s no record of the refund to the card — check the Square dashboard',
           s.user_name, '/banking/bar-reconciliation'
      from bar_sales s
     where s.voided and s.square_payment_id is not null and s.square_refund_id is null;
  exception when others then
    return query select 'Bar sales', 'Voided card sale refunded to the card', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Bar sales', 'Product prices', case when p.member_discount_override_percent not between 0 and 100 then 'error' else 'warning' end,
           p.name || ': ' ||
           case when p.member_discount_override_percent not between 0 and 100
                  then 'member discount is ' || p.member_discount_override_percent || '%'
                else 'visitor price ' || data_checks_gbp(p.non_member_price_pence) || ' is less than the member price ' || data_checks_gbp(p.price_pence) end,
           null::text, '/bar'
      from bar_products p
     where p.active
       and (p.member_discount_override_percent not between 0 and 100
            or (not p.variable_price and p.non_member_price_pence is not null and p.non_member_price_pence < p.price_pence));
  exception when others then
    return query select 'Bar sales', 'Product prices', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  -- ==========================================================================
  -- DAY END AND CASH
  -- ==========================================================================

  begin
    return query
    select 'Day End', 'Cash expected adds up', 'error',
           'Day End ' || data_checks_when(d.created_at) || ' (' || d.staff || '): cash expected is ' || data_checks_gbp(d.cash_expected_pence) ||
           ' but carried in + cash sales + cash movements + cash top-ups + membership cash − refunds = ' ||
           data_checks_gbp(d.carried_in_pence + d.cash_sales_pence + d.cash_movements_pence + d.cash_topups_pence + d.renewal_cash_pence - d.refunds_pence),
           null::text, '/banking/bar-reconciliation'
      from bar_day_ends d
     where d.cash_expected_pence <> d.carried_in_pence + d.cash_sales_pence + d.cash_movements_pence
                                   + d.cash_topups_pence + d.renewal_cash_pence - d.refunds_pence;
  exception when others then
    return query select 'Day End', 'Cash expected adds up', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  -- The Day End's stored totals against the records linked to it. A sale voided after
  -- the Day End still counts here (it was counted at the time) — that's reported on its own.
  begin
    return query
    with sales as (
      select d.id,
             coalesce(sum(s.total_pence) filter (where s.payment_method = 'wallet'), 0)::bigint as wallet,
             coalesce(sum(s.total_pence) filter (where s.payment_method = 'card'), 0)::bigint as card,
             coalesce(sum(s.total_pence) filter (where s.payment_method = 'cash'), 0)::bigint as cash,
             coalesce(sum(s.discount_pence), 0)::bigint as discounts
        from bar_day_ends d
        left join bar_sales s on s.day_end_id = d.id and (not s.voided or s.voided_at > d.created_at)
       group by d.id
    ), ledger as (
      select d.id,
             coalesce(sum(l.amount_pence) filter (where l.type = 'topup' and l.payment_method is distinct from 'card'), 0)::bigint as cash_topups,
             coalesce(sum(l.amount_pence) filter (where l.type = 'topup' and l.payment_method = 'card'), 0)::bigint as card_topups,
             coalesce(sum(-l.amount_pence) filter (where l.type = 'refund'), 0)::bigint as refunds
        from bar_day_ends d
        left join bar_ledger l on l.day_end_id = d.id
       group by d.id
    ), fees as (
      select d.id,
             coalesce(sum(round(p.amount * 100)) filter (where p.type = 'CSH'), 0)::bigint as cash,
             coalesce(sum(round(p.amount * 100)) filter (where p.type = 'CDM'), 0)::bigint as card
        from bar_day_ends d
        left join renewal_payments p on p.day_end_id = d.id and p.status <> 'Deleted'
       group by d.id
    )
    select 'Day End', 'Totals match the sales in it', 'error',
           'Day End ' || data_checks_when(d.created_at) || ' (' || d.staff || ') — saved figure vs its records: ' ||
           concat_ws('; ',
             case when d.wallet_sales_pence <> s.wallet then 'account sales ' || data_checks_gbp(d.wallet_sales_pence) || ' vs ' || data_checks_gbp(s.wallet) end,
             case when d.card_sales_pence <> s.card then 'card sales ' || data_checks_gbp(d.card_sales_pence) || ' vs ' || data_checks_gbp(s.card) end,
             case when d.cash_sales_pence + d.cash_movements_pence <> s.cash then 'cash sales and movements ' || data_checks_gbp(d.cash_sales_pence + d.cash_movements_pence) || ' vs ' || data_checks_gbp(s.cash) end,
             case when d.discounts_given_pence <> s.discounts then 'discounts ' || data_checks_gbp(d.discounts_given_pence) || ' vs ' || data_checks_gbp(s.discounts) end,
             case when d.cash_topups_pence <> l.cash_topups then 'cash top-ups ' || data_checks_gbp(d.cash_topups_pence) || ' vs ' || data_checks_gbp(l.cash_topups) end,
             case when d.card_topups_pence <> l.card_topups then 'card top-ups ' || data_checks_gbp(d.card_topups_pence) || ' vs ' || data_checks_gbp(l.card_topups) end,
             case when d.refunds_pence <> l.refunds then 'refunds ' || data_checks_gbp(d.refunds_pence) || ' vs ' || data_checks_gbp(l.refunds) end,
             case when d.renewal_cash_pence <> f.cash then 'membership cash ' || data_checks_gbp(d.renewal_cash_pence) || ' vs ' || data_checks_gbp(f.cash) end,
             case when d.renewal_card_pence <> f.card then 'membership card ' || data_checks_gbp(d.renewal_card_pence) || ' vs ' || data_checks_gbp(f.card) end
           ),
           null::text, '/banking/bar-reconciliation'
      from bar_day_ends d
      join sales s on s.id = d.id
      join ledger l on l.id = d.id
      join fees f on f.id = d.id
     where d.wallet_sales_pence <> s.wallet or d.card_sales_pence <> s.card
        or d.cash_sales_pence + d.cash_movements_pence <> s.cash or d.discounts_given_pence <> s.discounts
        or d.cash_topups_pence <> l.cash_topups or d.card_topups_pence <> l.card_topups or d.refunds_pence <> l.refunds
        or d.renewal_cash_pence <> f.cash or d.renewal_card_pence <> f.card;
  exception when others then
    return query select 'Day End', 'Totals match the sales in it', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  -- Each till cash-up starts from what the one before carried forward.
  begin
    return query
    with till as (
      select d.*,
             lag(d.created_at) over (order by d.created_at) as prev_at,
             lag(case when d.carried_forward then d.cash_expected_pence - d.cash_removed_pence else 0 end)
               over (order by d.created_at) as prev_carried_out
        from bar_day_ends d
       where not data_checks_is_manual_day_end(d)
    )
    select 'Day End', 'Carried forward follows on', 'warning',
           'Day End ' || data_checks_when(t.created_at) || ' (' || t.staff || ') started with ' || data_checks_gbp(t.carried_in_pence) ||
           ' carried in, but the Day End before it (' || data_checks_when(t.prev_at) || ') carried forward ' ||
           data_checks_gbp(t.prev_carried_out) || ' — fine only if someone corrected the carried-forward figure in Config',
           null::text, '/banking/bar-reconciliation'
      from till t
     where t.prev_at is not null and t.carried_in_pence <> t.prev_carried_out;
  exception when others then
    return query select 'Day End', 'Carried forward follows on', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    with last_till as (
      select d.* from bar_day_ends d
       where not data_checks_is_manual_day_end(d)
       order by d.created_at desc limit 1
    ), cfg as (
      select nullif(trim(value), '')::int as pence from config where key = 'bar_cash_carried_forward_pence'
    )
    select 'Day End', 'Carried forward follows on', 'warning',
           'The carried-forward figure in Config is ' || data_checks_gbp(coalesce(c.pence, 0)) ||
           ' but the last Day End (' || data_checks_when(t.created_at) || ') carried forward ' ||
           data_checks_gbp(case when t.carried_forward then t.cash_expected_pence - t.cash_removed_pence else 0 end) ||
           ' — fine only if someone corrected it on purpose',
           null::text, '/admin/config'
      from last_till t
      left join cfg c on true
     where coalesce(c.pence, 0) <> case when t.carried_forward then t.cash_expected_pence - t.cash_removed_pence else 0 end;
  exception when others then
    return query select 'Day End', 'Carried forward follows on', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  -- Every till Day End sweeps up everything not yet in one, so nothing older than the
  -- latest should be left out.
  begin
    return query
    with last_till as (
      select max(d.created_at) as at from bar_day_ends d where not data_checks_is_manual_day_end(d)
    ), missed as (
      select 'Sale' as what, s.created_at, s.total_pence::bigint as pence
        from bar_sales s, last_till t where s.day_end_id is null and s.created_at < t.at
      union all
      select 'Account ' || l.type, l.created_at, l.amount_pence::bigint
        from bar_ledger l, last_till t where l.day_end_id is null and l.created_at < t.at
      union all
      select 'Membership payment', p.created_at, round(p.amount * 100)::bigint
        from renewal_payments p, last_till t
       where p.source = 'till' and p.day_end_id is null and p.status <> 'Deleted' and p.created_at < t.at
    )
    select 'Day End', 'Everything is in a Day End', 'error',
           m.what || ' of ' || data_checks_gbp(m.pence) || ' on ' || data_checks_when(m.created_at) ||
           ' isn''t in any Day End, though a later one has been done',
           null::text, '/banking/bar-reconciliation'
      from missed m;
  exception when others then
    return query select 'Day End', 'Everything is in a Day End', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    with waiting as (
      select min(s.created_at) as oldest, count(*) as n from bar_sales s where s.day_end_id is null
    )
    select 'Day End', 'Day End done recently', 'warning',
           w.n || ' sale(s) are waiting for a Day End, the oldest from ' || data_checks_when(w.oldest),
           null::text, '/bar'
      from waiting w
     where w.n > 0 and w.oldest < now() - interval '7 days';
  exception when others then
    return query select 'Day End', 'Day End done recently', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Day End', 'Day Ends confirmed', 'warning',
           'Day End ' || data_checks_when(d.created_at) || ' (' || d.staff || ') has not been confirmed after 7 days',
           null::text, '/banking/bar-reconciliation'
      from bar_day_ends d
     where d.confirmed_at is null and d.created_at < now() - interval '7 days';
  exception when others then
    return query select 'Day End', 'Day Ends confirmed', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Day End', 'Cash banked', 'warning',
           'Day End ' || data_checks_when(d.created_at) || ' (' || d.staff || '): ' || data_checks_gbp(d.cash_removed_pence) ||
           ' removed from the till but not in a banking after 21 days',
           null::text, '/banking/bar-reconciliation'
      from bar_day_ends d
     where d.cash_removed_pence <> 0 and d.created_at < now() - interval '21 days'
       and not exists (select 1 from bar_banking_day_ends b where b.day_end_id = d.id);
  exception when others then
    return query select 'Day End', 'Cash banked', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    with totals as (
      select b.id, count(d.id) as n,
             coalesce(sum(d.cash_removed_pence), 0)::bigint as removed,
             count(d.id) filter (where d.confirmed_at is null) as unconfirmed
        from bar_bankings b
        left join bar_banking_day_ends bd on bd.banking_id = b.id
        left join bar_day_ends d on d.id = bd.day_end_id
       group by b.id
    )
    select 'Day End', 'Bankings match their Day Ends', 'error',
           'Banking of ' || to_char(b.banked_date, 'DD Mon YYYY') || ' (' || b.banked_by || ') is ' || data_checks_gbp(b.total_pence) ||
           case when t.n = 0 then ' but has no Day Ends'
                when t.removed <> b.total_pence then ' but its Day Ends add up to ' || data_checks_gbp(t.removed)
                else ' but includes ' || t.unconfirmed || ' Day End(s) that aren''t confirmed' end,
           null::text, '/banking/bar-reconciliation'
      from bar_bankings b
      join totals t on t.id = b.id
     where t.n = 0 or t.removed <> b.total_pence or t.unconfirmed > 0;
  exception when others then
    return query select 'Day End', 'Bankings match their Day Ends', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  -- ==========================================================================
  -- CARD PAYMENTS — Square Terminal and Stripe
  -- ==========================================================================

  begin
    return query
    select 'Card payments', 'Square payments recorded', 'error',
           'Square ' || q.kind || ' of ' || data_checks_gbp(q.amount_pence) || ' on ' || data_checks_when(q.created_at) ||
           ' was paid on the Terminal but not recorded' || coalesce(': ' || q.record_error, ''),
           coalesce(q.payload->>'userName', q.payload->>'username'), '/bar'
      from square_checkouts q
     where q.recorded_at is null and (q.status = 'COMPLETED' or q.record_error is not null);
  exception when others then
    return query select 'Card payments', 'Square payments recorded', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Card payments', 'Square payments finished', 'warning',
           'Square ' || q.kind || ' of ' || data_checks_gbp(q.amount_pence) || ' started ' || data_checks_when(q.created_at) ||
           ' is still ' || q.status || ' — check the Square dashboard to see whether it was paid',
           coalesce(q.payload->>'userName', q.payload->>'username'), '/bar'
      from square_checkouts q
     where q.recorded_at is null and q.status in ('PENDING', 'IN_PROGRESS', 'CANCEL_REQUESTED')
       and q.created_at < now() - interval '1 hour';
  exception when others then
    return query select 'Card payments', 'Square payments finished', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Card payments', 'Square payments recorded', 'error',
           'Square ' || q.kind || ' of ' || data_checks_gbp(q.amount_pence) || ' on ' || data_checks_when(q.created_at) ||
           ' says it was recorded, but the ' ||
           case when q.kind = 'sale' then 'sale' else 'membership payment' end || ' it points to doesn''t exist',
           coalesce(q.payload->>'userName', q.payload->>'username'), '/bar'
      from square_checkouts q
     where q.recorded_at is not null
       and ((q.kind = 'sale' and q.result ? 'saleId'
              and not exists (select 1 from bar_sales s where s.id::text = q.result->>'saleId'))
         or (q.kind = 'membership' and q.result ? 'paymentId'
              and not exists (select 1 from renewal_payments p where p.payment_id = q.result->>'paymentId')));
  exception when others then
    return query select 'Card payments', 'Square payments recorded', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Card payments', 'Online renewal payments finished', 'warning',
           'An online payment for the ' || r.season_year || ' renewal was started but not recorded (expired ' ||
           data_checks_when(r.pending_checkout_expires_at) || ') — check Stripe to see whether it was paid',
           r.username, '/banking'
      from renewals r
     where r.pending_checkout_session_id is not null
       and r.pending_checkout_expires_at < now() - interval '1 hour'
       and not exists (select 1 from renewal_payments p where p.stripe_session_id = r.pending_checkout_session_id);
  exception when others then
    return query select 'Card payments', 'Online renewal payments finished', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  -- ==========================================================================
  -- RENEWALS (from the go-live season)
  -- ==========================================================================

  begin
    return query
    select 'Renewals', 'Fee adds up', 'error',
           r.season_year || ' fee is ' || data_checks_gbp(round(r.total_fee_due * 100)::bigint) ||
           ' but playing + social + competitions + 200 Club = ' ||
           data_checks_gbp(round((r.playing_fee + r.social_fee + r.competitions_fee + r.club_200_fee) * 100)::bigint),
           r.username, '/banking/report'
      from renewals r
     where r.season_year >= v_first_season and r.submitted_at is not null
       and r.total_fee_due <> r.playing_fee + r.social_fee + r.competitions_fee + r.club_200_fee;
  exception when others then
    return query select 'Renewals', 'Fee adds up', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Renewals', 'Amount owed adds up', 'error',
           r.season_year || ': owes ' || data_checks_gbp(round(coalesce(r.outstanding, 0) * 100)::bigint) ||
           ' but fee − paid + donations + differences = ' ||
           data_checks_gbp(round((r.total_fee_due - coalesce(r.banking, 0) + coalesce(r.donations, 0) + coalesce(r.difference, 0)) * 100)::bigint),
           r.username, '/banking/report'
      from renewals r
     where r.season_year >= v_first_season and r.submitted_at is not null and r.voided_at is null
       and coalesce(r.outstanding, 0) <> r.total_fee_due - coalesce(r.banking, 0) + coalesce(r.donations, 0) + coalesce(r.difference, 0);
  exception when others then
    return query select 'Renewals', 'Amount owed adds up', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  -- What the renewal says was paid against the payments and adjustments that go to Xero.
  -- Renewals paid online as they were submitted have no payment row, so are left out.
  begin
    return query
    with txns as (
      select season_year, lower(username) as username,
             coalesce(sum(amount) filter (where kind = 'payment'), 0) - coalesce(sum(amount) filter (where kind = 'refund'), 0) as paid,
             coalesce(sum(write_off) filter (where kind = 'payment'), 0)
               + coalesce(sum(amount) filter (where kind = 'charge'), 0)
               - coalesce(sum(amount) filter (where kind = 'credit'), 0) as differences
        from renewal_transactions
       where season_year >= v_first_season
       group by season_year, lower(username)
    )
    select 'Renewals', 'Payments match what goes to Xero', 'warning',
           r.season_year || ': ' ||
           concat_ws('; ',
             case when coalesce(r.banking, 0) <> coalesce(t.paid, 0)
                  then 'renewal shows ' || data_checks_gbp(round(coalesce(r.banking, 0) * 100)::bigint) || ' paid, the Xero records ' || data_checks_gbp(round(coalesce(t.paid, 0) * 100)::bigint) end,
             case when coalesce(r.difference, 0) <> coalesce(t.differences, 0)
                  then 'renewal shows ' || data_checks_gbp(round(coalesce(r.difference, 0) * 100)::bigint) || ' differences, the Xero records ' || data_checks_gbp(round(coalesce(t.differences, 0) * 100)::bigint) end
           ) || ' — was something changed in Banking without going through Adjustments?',
           r.username, '/banking/renewals-xero'
      from renewals r
      left join txns t on t.season_year = r.season_year and t.username = lower(r.username)
     where r.season_year >= v_first_season and r.submitted_at is not null and not r.paid_at_submission
       and (coalesce(r.banking, 0) <> coalesce(t.paid, 0) or coalesce(r.difference, 0) <> coalesce(t.differences, 0));
  exception when others then
    return query select 'Renewals', 'Payments match what goes to Xero', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Renewals', 'Overpaid', 'warning',
           r.season_year || ': paid ' || data_checks_gbp(round(-r.outstanding * 100)::bigint) || ' more than owed',
           r.username, '/banking/report'
      from renewals r
     where r.season_year >= v_first_season and r.submitted_at is not null and r.voided_at is null and r.outstanding < 0;
  exception when others then
    return query select 'Renewals', 'Overpaid', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Renewals', 'Voided renewals refunded', 'warning',
           r.season_year || ' renewal was voided ' || data_checks_when(r.voided_at) || ' but ' ||
           data_checks_gbp(round(r.banking * 100)::bigint) || ' paid hasn''t been refunded',
           r.username, '/banking/renewals-xero'
      from renewals r
     where r.season_year >= v_first_season and r.voided_at is not null and coalesce(r.banking, 0) > 0;
  exception when others then
    return query select 'Renewals', 'Voided renewals refunded', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Renewals', 'Payments and adjustments belong to a renewal', 'error',
           'A ' || t.kind || ' of ' || data_checks_gbp(round(t.amount * 100)::bigint) || ' on ' || to_char(t.txn_date, 'DD Mon YYYY') ||
           ' is for a ' || t.season_year || ' renewal that ' ||
           case when r.id is null then 'doesn''t exist' else 'was never submitted' end,
           t.username, '/banking/renewals-xero'
      from renewal_transactions t
      left join renewals r on lower(r.username) = lower(t.username) and r.season_year = t.season_year
     where t.season_year >= v_first_season and (r.id is null or r.submitted_at is null);
  exception when others then
    return query select 'Renewals', 'Payments and adjustments belong to a renewal', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Renewals', 'Matched payments have a member', 'error',
           'Payment ' || p.payment_id || ' (' || p.type || ', ' || data_checks_gbp(round(p.amount * 100)::bigint) || ', ' ||
           to_char(p.date, 'DD Mon YYYY') || ') is matched but ' ||
           case when coalesce(trim(p.matched_users), '') = '' then 'to nobody' else 'to ' || p.matched_users || ', who isn''t a member' end,
           null::text, '/banking'
      from renewal_payments p
     where p.status = 'Matched'
       and (coalesce(trim(p.matched_users), '') = ''
            or exists (
              select 1 from unnest(string_to_array(p.matched_users, ',')) as m(username)
               where not exists (select 1 from users u where lower(u.username) = lower(trim(m.username)))
            ));
  exception when others then
    return query select 'Renewals', 'Matched payments have a member', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Renewals', 'Payments taken at the bar go to Xero', 'error',
           'Payment ' || p.payment_id || ' (' || data_checks_gbp(round(p.amount * 100)::bigint) || ', ' || to_char(p.date, 'DD Mon YYYY') ||
           ') was taken at the bar but has no Xero record',
           p.matched_users, '/banking/renewals-xero'
      from renewal_payments p
     where p.source = 'till' and p.status <> 'Deleted'
       and not exists (
         select 1 from renewal_transactions t
          where t.kind = 'payment' and t.source = 'till'
            and p.payment_id = any(string_to_array(replace(coalesce(t.payment_ids, ''), ' ', ''), ','))
       );
  exception when others then
    return query select 'Renewals', 'Payments taken at the bar go to Xero', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    with waiting as (
      select count(*) as n, min(p.date) as oldest from renewal_payments p
       where p.status = 'Unmatched' and p.date < current_date - 30
    )
    select 'Renewals', 'Bank payments matched', 'warning',
           w.n || ' payment(s) in Banking are still unmatched after 30 days, the oldest from ' || to_char(w.oldest, 'DD Mon YYYY'),
           null::text, '/banking'
      from waiting w
     where w.n > 0;
  exception when others then
    return query select 'Renewals', 'Bank payments matched', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  -- ==========================================================================
  -- XERO — renewals journal
  -- ==========================================================================

  begin
    return query
    select 'Xero', 'Export records are consistent', 'error',
           r.season_year || ' renewal: ' ||
           case when r.xero_submit_export_id is not null and r.submitted_at is null then 'exported as submitted, but it isn''t submitted'
                else 'its void was exported but the renewal itself never was' end,
           r.username, '/banking/renewals-xero'
      from renewals r
     where (r.xero_submit_export_id is not null and r.submitted_at is null)
        or (r.xero_void_export_id is not null and r.xero_submit_export_id is null);
  exception when others then
    return query select 'Xero', 'Export records are consistent', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    with waiting as (
      select r.submitted_at as at from renewals r
       where r.season_year >= v_first_season and r.renewing_membership and r.submitted_at is not null
         and r.voided_at is null and r.xero_submit_export_id is null
      union all
      select r.voided_at from renewals r
       where r.season_year >= v_first_season and r.voided_at is not null
         and r.xero_submit_export_id is not null and r.xero_void_export_id is null
      union all
      select t.created_at from renewal_transactions t
       where t.season_year >= v_first_season and t.xero_export_id is null
    ), summary as (
      select count(*) as n, min(at) as oldest from waiting where at < now() - interval '31 days'
    )
    select 'Xero', 'Renewals exported to Xero', 'warning',
           s.n || ' renewal event(s) are more than a month old and not yet exported to Xero, the oldest from ' || data_checks_when(s.oldest),
           null::text, '/banking/renewals-xero'
      from summary s
     where s.n > 0;
  exception when others then
    return query select 'Xero', 'Renewals exported to Xero', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    with blank as (
      select string_agg(replace(replace(key, 'renewals_nominal_', ''), '_account', ''), ', ' order by key) as keys
        from config where key like 'renewals_nominal_%' and coalesce(trim(value), '') = ''
    )
    select 'Xero', 'Account codes filled in', 'warning',
           'Renewals → Xero account codes not filled in: ' || replace(b.keys, '_', ' '),
           null::text, '/banking/renewals-xero'
      from blank b where b.keys is not null;
  exception when others then
    return query select 'Xero', 'Account codes filled in', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    with blank as (
      select string_agg(replace(replace(key, 'bar_nominal_', ''), '_account', ''), ', ' order by key) as keys
        from config where key like 'bar_nominal_%' and coalesce(trim(value), '') = ''
    )
    select 'Xero', 'Account codes filled in', 'warning',
           'Bar Xero account codes not filled in (Config → Bar): ' || replace(b.keys, '_', ' '),
           null::text, '/admin/config'
      from blank b where b.keys is not null;
  exception when others then
    return query select 'Xero', 'Account codes filled in', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  -- ==========================================================================
  -- 200 CLUB (from the go-live season)
  -- ==========================================================================

  begin
    return query
    with held as (
      select season, lower(username) as username, count(*) as n
        from two_hundred_club_entries group by season, lower(username)
    )
    select '200 Club', 'Numbers match the renewal', 'warning',
           h.season || ': holds ' || h.n || ' number(s) but ' ||
           case when r.id is null then 'has no renewal'
                when r.voided_at is not null then 'the renewal was voided'
                when r.submitted_at is null then 'the renewal hasn''t been submitted'
                else 'paid for ' || r.club_200_entries end,
           h.username, '/200-club'
      from held h
      left join renewals r on lower(r.username) = h.username and r.season_year::text = h.season
     where h.season ~ '^[0-9]+$' and h.season::int >= v_first_season
       and (r.id is null or r.voided_at is not null or r.submitted_at is null or h.n > r.club_200_entries);
  exception when others then
    return query select '200 Club', 'Numbers match the renewal', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  -- ==========================================================================
  -- BAR CARDS AND PINS
  -- ==========================================================================

  begin
    return query
    select 'Bar cards', 'Cards are unique', 'error',
           'Shares a membership card code with ' || (count(*) over (partition by u.card_token) - 1) || ' other member(s) — reset their cards',
           u.username, '/admin/members'
      from users u
     where u.card_token in (select card_token from users group by card_token having count(*) > 1);
  exception when others then
    return query select 'Bar cards', 'Cards are unique', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Bar cards', 'Cards are valid', 'error',
           'Membership card code is the wrong length — reset their card',
           u.username, '/admin/members'
      from users u
     where u.is_active and coalesce(length(u.card_token), 0) <> 32;
  exception when others then
    return query select 'Bar cards', 'Cards are valid', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Bar cards', 'PINs locked', 'info',
           'Bar PIN is locked after too many wrong tries — they can reset it in My Account, or an admin can clear it',
           u.username, '/admin/members'
      from users u
     where u.is_active and u.bar_pin_failures >= 5;
  exception when others then
    return query select 'Bar cards', 'PINs locked', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;

  begin
    return query
    select 'Bar cards', 'Approved by the person serving (last 30 days)', 'info',
           count(*) || ' account payment(s) approved without the member''s card or PIN, ' ||
           data_checks_gbp(coalesce(sum(a.amount_pence), 0)::bigint) || ' in all',
           a.staff, '/bar'
      from bar_staff_approvals a
     where a.kind = 'account' and a.created_at > now() - interval '30 days'
     group by a.staff;
  exception when others then
    return query select 'Bar cards', 'Approved by the person serving (last 30 days)', 'error', 'This check could not run: ' || sqlerrm, null::text, null::text;
  end;
end;
$$;

-- Read by the server only (service role). Functions are executable by everyone by
-- default, so take that away — the results name members and their balances.
revoke execute on function data_checks() from public, anon, authenticated;
grant execute on function data_checks() to service_role;
revoke execute on function data_checks_gbp(bigint) from public, anon, authenticated;
grant execute on function data_checks_gbp(bigint) to service_role;
revoke execute on function data_checks_when(timestamptz) from public, anon, authenticated;
grant execute on function data_checks_when(timestamptz) to service_role;
revoke execute on function data_checks_is_manual_day_end(bar_day_ends) from public, anon, authenticated;
grant execute on function data_checks_is_manual_day_end(bar_day_ends) to service_role;
