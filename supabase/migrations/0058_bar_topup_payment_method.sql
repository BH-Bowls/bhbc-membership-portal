-- 0058_bar_topup_payment_method.sql
-- Top-ups were always assumed to be cash ("Add £X (cash taken)" in the till UI).
-- Adds a payment_method to bar_ledger so a top-up can be taken by card instead --
-- nullable so existing rows are untouched (treated as cash, matching the old
-- assumption); bar_topup defaults new rows to 'cash' too when the caller doesn't
-- specify one. Card top-ups must NOT be counted as cash landing in the till, so
-- the report layer (getReport in bar-supabase.ts) needs to split on this column
-- rather than treating every topup ledger row as cash-in.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table bar_ledger add column payment_method text check (payment_method in ('cash','card'));

create or replace function bar_topup(p_user_name text, p_amount_pence int, p_staff text, p_note text default null, p_payment_method text default 'cash')
returns int
language plpgsql
as $$
declare v_balance int;
begin
  if p_amount_pence <= 0 then raise exception 'Top-up amount must be positive'; end if;
  if p_payment_method not in ('cash','card') then raise exception 'Invalid payment method'; end if;
  insert into bar_accounts (user_name) values (p_user_name)
    on conflict (user_name) do nothing;
  update bar_accounts
    set balance_pence = balance_pence + p_amount_pence, updated_at = now()
    where user_name = p_user_name
    returning balance_pence into v_balance;
  insert into bar_ledger (user_name, type, amount_pence, balance_after_pence, staff, note, payment_method)
    values (p_user_name, 'topup', p_amount_pence, v_balance, p_staff, p_note, p_payment_method);
  return v_balance;
end;
$$;
