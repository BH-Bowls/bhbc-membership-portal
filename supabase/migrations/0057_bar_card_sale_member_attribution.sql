-- 0057_bar_card_sale_member_attribution.sql
-- Lets "Pay by Card" for a known member be recorded against their name (for
-- history/stats) without touching their wallet, alongside the existing
-- wallet-only "Pay by Account". bar_visitor_sale previously always recorded
-- user_name = null; existing non-member callers are unaffected since the new
-- parameter defaults to null. When a member is attributed, price at the
-- member rate (price_pence) rather than the visitor rate (non_member_price_pence)
-- -- the price differential is member-vs-visitor, not payment-method.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create or replace function bar_visitor_sale(p_payment_method text, p_items jsonb, p_staff text, p_user_name text default null)
returns jsonb
language plpgsql
as $$
declare v_total int := 0; v_sale_id uuid; v_item jsonb; v_pid uuid; v_qty int; v_price int;
begin
  if p_payment_method not in ('card','cash') then raise exception 'Invalid payment method'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'qty')::int;
    if v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    if p_user_name is not null then
      select price_pence into v_price from bar_products where id = v_pid and active;
    else
      select non_member_price_pence into v_price from bar_products where id = v_pid and active;
    end if;
    if v_price is null then raise exception 'Unknown or inactive product'; end if;
    v_total := v_total + v_price * v_qty;
  end loop;
  if v_total <= 0 then raise exception 'Empty basket'; end if;

  v_sale_id := gen_random_uuid();
  insert into bar_sales (id, payment_method, user_name, total_pence, staff)
    values (v_sale_id, p_payment_method, p_user_name, v_total, p_staff);
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'qty')::int;
    if p_user_name is not null then
      select price_pence into v_price from bar_products where id = v_pid;
    else
      select non_member_price_pence into v_price from bar_products where id = v_pid;
    end if;
    insert into bar_sale_items (sale_id, product_id, qty, unit_price_pence)
      values (v_sale_id, v_pid, v_qty, v_price);
  end loop;

  return jsonb_build_object('sale_id', v_sale_id, 'total_pence', v_total);
end;
$$;
