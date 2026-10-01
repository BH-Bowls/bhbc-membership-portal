-- 0065_bar_carry_forward.sql
-- Lets a bar person defer a cash-count difference to the next cash-up instead of
-- always having to give a reason for it -- the human-factor case where nobody's
-- got time to properly cash up. "Carried forward" is a single running number
-- (config bar_cash_carried_forward_pence, like the till float, admin-editable as
-- a manual correction if it ever needs fixing): each Day End snapshots what it
-- was coming IN (carried_in_pence) and, if the box was ticked, the difference
-- itself becomes the new value for next time -- so carried_out is never stored,
-- just derived as carried_forward ? (cash_expected_pence - cash_removed_pence) : 0
-- (see mapDayEndRow() in src/lib/bar-supabase.ts).
--
-- The difference (and so the carried amount) can be negative: removing MORE cash
-- than the books say is "expected" (e.g. topping up the float from personal cash,
-- or a genuine till shortfall) is carried forward the same way, just lowering
-- next time's starting point instead of raising it.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

insert into config (key, value) values ('bar_cash_carried_forward_pence', '0') on conflict (key) do nothing;

alter table bar_day_ends add column carried_in_pence int not null default 0;
alter table bar_day_ends add column carried_forward boolean not null default false;

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
  v_discounts int := 0;
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
    coalesce(sum(case when payment_method = 'cash' then total_pence else 0 end), 0),
    coalesce(sum(discount_pence), 0)
    into v_wallet_sales, v_card_sales, v_cash_sales, v_discounts
    from bar_sales where day_end_id is null and voided = false;

  select coalesce(sum(balance_pence), 0) into v_outstanding from bar_accounts;

  v_cash_expected := v_carried_in + v_cash_topups + v_cash_sales - v_refunds;
  v_difference := v_cash_expected - p_cash_removed_pence;

  if v_difference <> 0 and not p_carry_forward and (p_reason is null or trim(p_reason) = '') then
    raise exception 'A reason is required when the difference is not carried forward';
  end if;

  v_carried_out := case when p_carry_forward then v_difference else 0 end;

  insert into bar_day_ends (
    staff, float_pence, carried_in_pence, cash_topups_pence, cash_sales_pence, refunds_pence,
    cash_expected_pence, cash_removed_pence, carried_forward, difference_reason,
    wallet_sales_pence, card_sales_pence, card_topups_pence, discounts_given_pence,
    outstanding_balance_pence
  ) values (
    p_staff, v_float, v_carried_in, v_cash_topups, v_cash_sales, v_refunds,
    v_cash_expected, p_cash_removed_pence, p_carry_forward, p_reason,
    v_wallet_sales, v_card_sales, v_card_topups, v_discounts,
    v_outstanding
  ) returning * into v_day_end;

  update config set value = v_carried_out::text where key = 'bar_cash_carried_forward_pence';

  -- Link everything unlinked, including voided sales/adjustment-only ledger rows
  -- (they don't contribute to the sums above, but must still stop showing up as
  -- "unlinked" in the next day end).
  update bar_ledger set day_end_id = v_day_end.id where day_end_id is null;
  update bar_sales set day_end_id = v_day_end.id where day_end_id is null;

  return v_day_end;
end;
$$;
