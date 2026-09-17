-- 0060_bar_pricing_modes.sql
-- Replaces 0059's "always per-product discount" pricing with four selectable,
-- club-wide pricing modes (stored in the existing generic `config` table, no
-- new table needed):
--   single                   - one price, everyone pays it
--   split                    - independent member/visitor prices per product
--                               (the pre-0059 model -- price_pence/
--                               non_member_price_pence never stopped holding
--                               real values, so no backfill needed here)
--   member_discount          - one price per product; a flat club-wide % off
--                               a member's whole basket
--   member_product_discount  - one price per product; a club-wide default %
--                               that any product can override (0059's model,
--                               now correctly framed as one of four choices)
--
-- Also adds gross_total_pence/discount_pence to bar_sales so every sale
-- records what a visitor would have paid (gross) alongside what was actually
-- charged/debited (total_pence, meaning unchanged) -- the difference is the
-- member's saving, visible in history and ready for Xero tracking later.
-- bar_sale_items.unit_price_pence is untouched (still the actually-charged
-- per-unit price), so sum(items) = total_pence keeps holding for reporting.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

insert into config (key, value) values ('bar_pricing_mode', 'member_product_discount') on conflict (key) do nothing;
insert into config (key, value) values ('bar_member_discount_percent', '10') on conflict (key) do nothing;

-- member_discount_percent (0059, not null) -> nullable member_discount_override_percent:
-- null means "inherit bar_member_discount_percent", any set value (incl. 0) overrides it.
-- Existing rows keep their current values as explicit overrides.
alter table bar_products rename column member_discount_percent to member_discount_override_percent;
alter table bar_products alter column member_discount_override_percent drop not null;
alter table bar_products alter column member_discount_override_percent drop default;

alter table bar_sales add column gross_total_pence int;
alter table bar_sales add column discount_pence int;
update bar_sales set gross_total_pence = total_pence, discount_pence = 0 where gross_total_pence is null;
alter table bar_sales alter column gross_total_pence set not null;
alter table bar_sales alter column discount_pence set not null;
alter table bar_sales alter column discount_pence set default 0;
alter table bar_sales add constraint bar_sales_gross_check check (gross_total_pence >= 0);
alter table bar_sales add constraint bar_sales_discount_check check (discount_pence >= 0);

-- One place that knows how to price a line item under whatever mode is active,
-- so bar_wallet_purchase and bar_visitor_sale don't each duplicate the logic.
create or replace function bar_price_item(p_product_id uuid, p_is_member boolean, out gross_pence int, out net_pence int)
language plpgsql
as $$
declare
  v_mode text;
  v_global_rate int;
  v_base int; v_price int; v_non_member int; v_override int; v_active boolean;
begin
  select value into v_mode from config where key = 'bar_pricing_mode';
  select coalesce((select value::int from config where key = 'bar_member_discount_percent'), 0) into v_global_rate;

  select base_price_pence, price_pence, non_member_price_pence, member_discount_override_percent, active
    into v_base, v_price, v_non_member, v_override, v_active
    from bar_products where id = p_product_id;
  if not found or not v_active then raise exception 'Unknown or inactive product'; end if;

  if v_mode = 'single' then
    gross_pence := v_base;
    net_pence := v_base;
  elsif v_mode = 'split' then
    gross_pence := v_non_member;
    net_pence := case when p_is_member then v_price else v_non_member end;
  elsif v_mode = 'member_discount' then
    gross_pence := v_base;
    net_pence := case when p_is_member then bar_member_price(v_base, v_global_rate) else v_base end;
  else -- 'member_product_discount', and the fallback default
    gross_pence := v_base;
    net_pence := case when p_is_member then bar_member_price(v_base, coalesce(v_override, v_global_rate)) else v_base end;
  end if;
end;
$$;

create or replace function bar_wallet_purchase(p_user_name text, p_items jsonb, p_staff text)
returns jsonb
language plpgsql
as $$
declare
  v_gross_total int := 0; v_net_total int := 0; v_balance int; v_sale_id uuid;
  v_item jsonb; v_pid uuid; v_qty int; v_gross int; v_net int;
begin
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::int;
    if v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    select gross_pence, net_pence into v_gross, v_net from bar_price_item(v_pid, true);
    v_gross_total := v_gross_total + v_gross * v_qty;
    v_net_total := v_net_total + v_net * v_qty;
  end loop;
  if v_net_total <= 0 then raise exception 'Empty basket'; end if;

  select balance_pence into v_balance from bar_accounts where user_name = p_user_name for update;
  if v_balance is null then raise exception 'No bar account for this member'; end if;
  if v_balance < v_net_total then raise exception 'Insufficient balance'; end if;

  v_sale_id := gen_random_uuid();
  insert into bar_sales (id, payment_method, user_name, total_pence, gross_total_pence, discount_pence, staff)
    values (v_sale_id, 'wallet', p_user_name, v_net_total, v_gross_total, v_gross_total - v_net_total, p_staff);
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'qty')::int;
    select net_pence into v_net from bar_price_item(v_pid, true);
    insert into bar_sale_items (sale_id, product_id, qty, unit_price_pence)
      values (v_sale_id, v_pid, v_qty, v_net);
  end loop;

  update bar_accounts set balance_pence = balance_pence - v_net_total, updated_at = now()
    where user_name = p_user_name returning balance_pence into v_balance;
  insert into bar_ledger (user_name, type, amount_pence, balance_after_pence, staff, sale_id)
    values (p_user_name, 'purchase', -v_net_total, v_balance, p_staff, v_sale_id);

  return jsonb_build_object(
    'sale_id', v_sale_id, 'balance_pence', v_balance, 'total_pence', v_net_total,
    'gross_total_pence', v_gross_total, 'discount_pence', v_gross_total - v_net_total
  );
end;
$$;

create or replace function bar_visitor_sale(p_payment_method text, p_items jsonb, p_staff text, p_user_name text default null)
returns jsonb
language plpgsql
as $$
declare
  v_gross_total int := 0; v_net_total int := 0; v_sale_id uuid; v_is_member boolean;
  v_item jsonb; v_pid uuid; v_qty int; v_gross int; v_net int;
begin
  if p_payment_method not in ('card','cash') then raise exception 'Invalid payment method'; end if;
  v_is_member := p_user_name is not null;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'qty')::int;
    if v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    select gross_pence, net_pence into v_gross, v_net from bar_price_item(v_pid, v_is_member);
    v_gross_total := v_gross_total + v_gross * v_qty;
    v_net_total := v_net_total + v_net * v_qty;
  end loop;
  if v_net_total <= 0 then raise exception 'Empty basket'; end if;

  v_sale_id := gen_random_uuid();
  insert into bar_sales (id, payment_method, user_name, total_pence, gross_total_pence, discount_pence, staff)
    values (v_sale_id, p_payment_method, p_user_name, v_net_total, v_gross_total, v_gross_total - v_net_total, p_staff);
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'qty')::int;
    select net_pence into v_net from bar_price_item(v_pid, v_is_member);
    insert into bar_sale_items (sale_id, product_id, qty, unit_price_pence)
      values (v_sale_id, v_pid, v_qty, v_net);
  end loop;

  return jsonb_build_object(
    'sale_id', v_sale_id, 'total_pence', v_net_total,
    'gross_total_pence', v_gross_total, 'discount_pence', v_gross_total - v_net_total
  );
end;
$$;
