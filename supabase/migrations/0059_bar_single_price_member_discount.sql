-- 0059_bar_single_price_member_discount.sql
-- Replaces the flat price_pence/non_member_price_pence pair with a single
-- base_price_pence (the visitor/full price) plus a member_discount_percent,
-- so a product's member price is always base_price_pence discounted by that
-- percentage rather than two independently-typed numbers that can drift apart.
--
-- Backfill keeps every product's *effective* prices unchanged on day one:
-- base_price_pence = the old non_member_price_pence, and
-- member_discount_percent = the percentage that recovers the old price_pence.
-- (A per-product quantity/whole-basket "volume discount" was discussed but is
-- deliberately out of scope here -- its exact shape wasn't pinned down.)
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table bar_products add column base_price_pence int;
alter table bar_products add column member_discount_percent int;

update bar_products set
  base_price_pence = non_member_price_pence,
  member_discount_percent = case
    when non_member_price_pence <= 0 then 0
    else round((1 - price_pence::numeric / non_member_price_pence) * 100)::int
  end
where base_price_pence is null;

alter table bar_products alter column base_price_pence set not null;
alter table bar_products alter column member_discount_percent set not null;
alter table bar_products alter column member_discount_percent set default 0;
alter table bar_products add constraint bar_products_base_price_check check (base_price_pence >= 0);
alter table bar_products add constraint bar_products_member_discount_check check (member_discount_percent between 0 and 100);

-- price_pence / non_member_price_pence are superseded but left in place for now
-- rather than dropped in the same migration that repoints every reader of them.

create or replace function bar_member_price(p_base_price_pence int, p_discount_percent int)
returns int
language sql
immutable
as $$
  select round(p_base_price_pence * (100 - p_discount_percent) / 100.0)::int;
$$;

create or replace function bar_wallet_purchase(p_user_name text, p_items jsonb, p_staff text)
returns jsonb
language plpgsql
as $$
declare
  v_total int := 0; v_balance int; v_sale_id uuid;
  v_item jsonb; v_pid uuid; v_qty int; v_base int; v_discount int; v_price int;
begin
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::int;
    if v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    select base_price_pence, member_discount_percent into v_base, v_discount from bar_products where id = v_pid and active;
    if v_base is null then raise exception 'Unknown or inactive product'; end if;
    v_total := v_total + bar_member_price(v_base, v_discount) * v_qty;
  end loop;
  if v_total <= 0 then raise exception 'Empty basket'; end if;

  select balance_pence into v_balance from bar_accounts where user_name = p_user_name for update;
  if v_balance is null then raise exception 'No bar account for this member'; end if;
  if v_balance < v_total then raise exception 'Insufficient balance'; end if;

  v_sale_id := gen_random_uuid();
  insert into bar_sales (id, payment_method, user_name, total_pence, staff)
    values (v_sale_id, 'wallet', p_user_name, v_total, p_staff);
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'qty')::int;
    select base_price_pence, member_discount_percent into v_base, v_discount from bar_products where id = v_pid;
    v_price := bar_member_price(v_base, v_discount);
    insert into bar_sale_items (sale_id, product_id, qty, unit_price_pence)
      values (v_sale_id, v_pid, v_qty, v_price);
  end loop;

  update bar_accounts set balance_pence = balance_pence - v_total, updated_at = now()
    where user_name = p_user_name returning balance_pence into v_balance;
  insert into bar_ledger (user_name, type, amount_pence, balance_after_pence, staff, sale_id)
    values (p_user_name, 'purchase', -v_total, v_balance, p_staff, v_sale_id);

  return jsonb_build_object('sale_id', v_sale_id, 'balance_pence', v_balance, 'total_pence', v_total);
end;
$$;

create or replace function bar_visitor_sale(p_payment_method text, p_items jsonb, p_staff text, p_user_name text default null)
returns jsonb
language plpgsql
as $$
declare v_total int := 0; v_sale_id uuid; v_item jsonb; v_pid uuid; v_qty int; v_base int; v_discount int; v_price int;
begin
  if p_payment_method not in ('card','cash') then raise exception 'Invalid payment method'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'qty')::int;
    if v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    select base_price_pence, member_discount_percent into v_base, v_discount from bar_products where id = v_pid and active;
    if v_base is null then raise exception 'Unknown or inactive product'; end if;
    v_price := case when p_user_name is not null then bar_member_price(v_base, v_discount) else v_base end;
    v_total := v_total + v_price * v_qty;
  end loop;
  if v_total <= 0 then raise exception 'Empty basket'; end if;

  v_sale_id := gen_random_uuid();
  insert into bar_sales (id, payment_method, user_name, total_pence, staff)
    values (v_sale_id, p_payment_method, p_user_name, v_total, p_staff);
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'qty')::int;
    select base_price_pence, member_discount_percent into v_base, v_discount from bar_products where id = v_pid;
    v_price := case when p_user_name is not null then bar_member_price(v_base, v_discount) else v_base end;
    insert into bar_sale_items (sale_id, product_id, qty, unit_price_pence)
      values (v_sale_id, v_pid, v_qty, v_price);
  end loop;

  return jsonb_build_object('sale_id', v_sale_id, 'total_pence', v_total);
end;
$$;
