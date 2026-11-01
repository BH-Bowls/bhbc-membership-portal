-- 0092_bar_void_rules.sql
-- Voiding a bar sale (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §2.12):
--  * a sale already in a Day End can't be voided — the cash-up for that day is closed
--  * a Square Terminal card sale is refunded to the card when it's voided; the refund id
--    is kept on the sale

alter table bar_sales add column if not exists square_refund_id text;

create or replace function bar_void_sale(p_sale_id uuid, p_staff text)
returns void
language plpgsql
as $$
declare v_sale bar_sales%rowtype; v_balance int;
begin
  select * into v_sale from bar_sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.voided then raise exception 'Sale already voided'; end if;
  if v_sale.day_end_id is not null then
    raise exception 'This sale is in a Day End that has been done, so it can''t be voided';
  end if;
  update bar_sales set voided = true, voided_at = now(), voided_by = p_staff where id = p_sale_id;
  if v_sale.payment_method = 'wallet' and v_sale.user_name is not null then
    update bar_accounts set balance_pence = balance_pence + v_sale.total_pence, updated_at = now()
      where user_name = v_sale.user_name returning balance_pence into v_balance;
    insert into bar_ledger (user_name, type, amount_pence, balance_after_pence, staff, sale_id, note)
      values (v_sale.user_name, 'adjustment', v_sale.total_pence, v_balance, p_staff, p_sale_id, 'Voided sale');
  end if;
end;
$$;
