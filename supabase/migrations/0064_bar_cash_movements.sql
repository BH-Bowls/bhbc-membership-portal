-- 0064_bar_cash_movements.sql
-- Cash Movement: a discouraged-but-needed way to record cash added to or
-- removed from the till for reasons that aren't a sale (float top-up, petty
-- cash, paying a delivery driver, banking excess cash, etc.). Rather than a
-- parallel system, it rides the existing bar_sales/bar_sale_items pipeline
-- (payment_method = 'cash', user_name = null) so it naturally rolls into the
-- Dayend screen's cash total and the Xero export's nominal-code split --
-- "just a cash sale", per the design, using a variable-price product whose
-- category/nominal code says what kind of movement it was.
--
-- The one real wrinkle: total_pence/unit_price_pence are constrained >= 0
-- everywhere else, but a removal is genuinely negative. bar_sales.is_cash_movement
-- flags which rows are allowed to break that, via a new relaxed check; there's
-- no local flag on bar_sale_items, so its check is dropped instead and left to
-- the RPC below (the only writer) to enforce sane values on ordinary sales.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

alter table bar_products add column variable_price boolean not null default false;

alter table bar_sales add column is_cash_movement boolean not null default false;
alter table bar_sales add column reason text;

alter table bar_sales drop constraint bar_sales_total_pence_check;
alter table bar_sales add constraint bar_sales_total_pence_check check (is_cash_movement or total_pence >= 0);
alter table bar_sales drop constraint bar_sales_gross_check;
alter table bar_sales add constraint bar_sales_gross_check check (is_cash_movement or gross_total_pence >= 0);

alter table bar_sale_items drop constraint bar_sale_items_unit_price_pence_check;

-- A starter category + a couple of example products so the feature is usable
-- immediately -- rename/add more via the till's existing Manage Categories /
-- product admin screens, same as any other category.
insert into bar_categories (key, label, color_key, sort_order) values
  ('till_adjustment', 'Till Adjustments', 'lime', 99)
on conflict (key) do nothing;

insert into bar_products (name, category, price_pence, base_price_pence, non_member_price_pence, variable_price, active, sort_order)
values
  ('Float Adjustment', 'till_adjustment', 0, 0, 0, true, true, 1),
  ('Petty Cash / Sundries', 'till_adjustment', 0, 0, 0, true, true, 2)
on conflict do nothing;

-- Records a signed cash movement as an ordinary cash sale of one variable-price
-- product, with a free-text reason. p_direction 'in' adds cash, 'out' removes it.
create or replace function bar_cash_movement(p_product_id uuid, p_amount_pence int, p_direction text, p_reason text, p_staff text)
returns jsonb
language plpgsql
as $$
declare v_sale_id uuid; v_signed int;
begin
  if p_direction not in ('in', 'out') then raise exception 'Invalid direction'; end if;
  if p_amount_pence <= 0 then raise exception 'Amount must be positive'; end if;
  if p_reason is null or trim(p_reason) = '' then raise exception 'Reason is required'; end if;
  if not exists (select 1 from bar_products where id = p_product_id and active) then
    raise exception 'Unknown or inactive product';
  end if;

  v_signed := case when p_direction = 'in' then p_amount_pence else -p_amount_pence end;
  v_sale_id := gen_random_uuid();

  insert into bar_sales (id, payment_method, user_name, total_pence, gross_total_pence, discount_pence, staff, is_cash_movement, reason)
    values (v_sale_id, 'cash', null, v_signed, v_signed, 0, p_staff, true, p_reason);
  insert into bar_sale_items (sale_id, product_id, qty, unit_price_pence)
    values (v_sale_id, p_product_id, 1, v_signed);

  return jsonb_build_object('sale_id', v_sale_id, 'total_pence', v_signed);
end;
$$;
