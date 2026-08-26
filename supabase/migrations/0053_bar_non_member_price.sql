-- 0053_bar_non_member_price.sql
-- Adds a separate non-member price to bar_products, so the till can charge
-- visitors (cash/card, no wallet) more than members (wallet). One-time seed:
-- every existing product gets non_member_price_pence = price_pence + 10 —
-- a starting point to edit from Products admin, not an ongoing rule enforced
-- anywhere going forward (new products set both prices explicitly).
--
-- bar_visitor_sale is re-priced to read non_member_price_pence instead of
-- price_pence — it's the only RPC that serves non-members (bar_wallet_purchase
-- stays on price_pence; members never pay the non-member price).
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table bar_products add column non_member_price_pence int;
update bar_products set non_member_price_pence = price_pence + 10 where non_member_price_pence is null;
alter table bar_products alter column non_member_price_pence set not null;
alter table bar_products add constraint bar_products_non_member_price_check check (non_member_price_pence >= 0);

create or replace function bar_visitor_sale(p_payment_method text, p_items jsonb, p_staff text)
returns jsonb
language plpgsql
as $$
declare v_total int := 0; v_sale_id uuid; v_item jsonb; v_pid uuid; v_qty int; v_price int;
begin
  if p_payment_method not in ('card','cash') then raise exception 'Invalid payment method'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'qty')::int;
    if v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    select non_member_price_pence into v_price from bar_products where id = v_pid and active;
    if v_price is null then raise exception 'Unknown or inactive product'; end if;
    v_total := v_total + v_price * v_qty;
  end loop;
  if v_total <= 0 then raise exception 'Empty basket'; end if;

  v_sale_id := gen_random_uuid();
  insert into bar_sales (id, payment_method, user_name, total_pence, staff)
    values (v_sale_id, p_payment_method, null, v_total, p_staff);
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'qty')::int;
    select non_member_price_pence into v_price from bar_products where id = v_pid;
    insert into bar_sale_items (sale_id, product_id, qty, unit_price_pence)
      values (v_sale_id, v_pid, v_qty, v_price);
  end loop;

  return jsonb_build_object('sale_id', v_sale_id, 'total_pence', v_total);
end;
$$;
