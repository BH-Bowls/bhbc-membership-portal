-- 0025_bar.sql
-- Cashless bar (interim till): prepaid member wallets topped up with cash, plus a full
-- till that records every sale (wallet / card / cash) for anytime reporting.
--
-- Money is stored as integer PENCE everywhere. Balances live in bar_accounts but every
-- movement is also written to an append-only bar_ledger (audit trail). Balance-changing
-- operations go through the plpgsql functions below so they are atomic (row-locked) and
-- price the basket server-side (the client can never set a price).
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists bar_products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text not null,            -- 'beer','wine','zero_gf','soft','snack'
  price_pence int  not null check (price_pence >= 0),
  active      boolean not null default true,
  sort_order  int  not null default 0,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- One row per "cash member" (opt-in). Absence of a row = card-only member.
create table if not exists bar_accounts (
  user_name     text primary key references users(username) on update cascade,
  balance_pence int  not null default 0 check (balance_pence >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Every sale, any payment method (the till record).
create table if not exists bar_sales (
  id             uuid primary key default gen_random_uuid(),
  payment_method text not null check (payment_method in ('wallet','card','cash')),
  user_name      text references users(username) on update cascade,  -- null = visitor
  total_pence    int  not null check (total_pence >= 0),
  staff          text,                    -- the "Served by" bar person
  created_at     timestamptz not null default now(),
  voided         boolean not null default false,
  voided_at      timestamptz,
  voided_by      text
);

create table if not exists bar_sale_items (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references bar_sales(id) on delete cascade,
  product_id       uuid not null references bar_products(id),
  qty              int  not null check (qty > 0),
  unit_price_pence int  not null check (unit_price_pence >= 0)
);

-- Append-only audit of everything that moves a wallet balance.
create table if not exists bar_ledger (
  id                  uuid primary key default gen_random_uuid(),
  user_name           text not null references users(username) on update cascade,
  type                text not null check (type in ('topup','purchase','refund','adjustment')),
  amount_pence        int  not null,      -- signed: +topup, -purchase, -refund
  balance_after_pence int  not null,
  staff               text,
  sale_id             uuid references bar_sales(id),
  note                text,
  created_at          timestamptz not null default now()
);

create index if not exists bar_sales_created_idx  on bar_sales (created_at);
create index if not exists bar_ledger_user_idx    on bar_ledger (user_name, created_at);
create index if not exists bar_sale_items_sale_idx on bar_sale_items (sale_id);

alter table bar_products   enable row level security;
alter table bar_accounts   enable row level security;
alter table bar_sales      enable row level security;
alter table bar_sale_items enable row level security;
alter table bar_ledger     enable row level security;

-- ── Atomic money functions ───────────────────────────────────────────────────

-- Add credit to a member's wallet (cash top-up). Creates the account if needed.
create or replace function bar_topup(p_user_name text, p_amount_pence int, p_staff text, p_note text default null)
returns int
language plpgsql
as $$
declare v_balance int;
begin
  if p_amount_pence <= 0 then raise exception 'Top-up amount must be positive'; end if;
  insert into bar_accounts (user_name) values (p_user_name)
    on conflict (user_name) do nothing;
  update bar_accounts
    set balance_pence = balance_pence + p_amount_pence, updated_at = now()
    where user_name = p_user_name
    returning balance_pence into v_balance;
  insert into bar_ledger (user_name, type, amount_pence, balance_after_pence, staff, note)
    values (p_user_name, 'topup', p_amount_pence, v_balance, p_staff, p_note);
  return v_balance;
end;
$$;

-- Charge a basket to a member's wallet. p_items = jsonb array of {product_id, qty}.
-- Prices are read from bar_products (never trusted from the client). Fails if the
-- member has insufficient balance.
create or replace function bar_wallet_purchase(p_user_name text, p_items jsonb, p_staff text)
returns jsonb
language plpgsql
as $$
declare
  v_total int := 0; v_balance int; v_sale_id uuid;
  v_item jsonb; v_pid uuid; v_qty int; v_price int;
begin
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::int;
    if v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    select price_pence into v_price from bar_products where id = v_pid and active;
    if v_price is null then raise exception 'Unknown or inactive product'; end if;
    v_total := v_total + v_price * v_qty;
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
    select price_pence into v_price from bar_products where id = v_pid;
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

-- Record a card or cash sale with no wallet (visitors, or a member paying directly).
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
    select price_pence into v_price from bar_products where id = v_pid and active;
    if v_price is null then raise exception 'Unknown or inactive product'; end if;
    v_total := v_total + v_price * v_qty;
  end loop;
  if v_total <= 0 then raise exception 'Empty basket'; end if;

  v_sale_id := gen_random_uuid();
  insert into bar_sales (id, payment_method, user_name, total_pence, staff)
    values (v_sale_id, p_payment_method, null, v_total, p_staff);
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'qty')::int;
    select price_pence into v_price from bar_products where id = v_pid;
    insert into bar_sale_items (sale_id, product_id, qty, unit_price_pence)
      values (v_sale_id, v_pid, v_qty, v_price);
  end loop;

  return jsonb_build_object('sale_id', v_sale_id, 'total_pence', v_total);
end;
$$;

-- Void a sale. If it was a wallet sale, the balance is refunded (reversing ledger entry).
create or replace function bar_void_sale(p_sale_id uuid, p_staff text)
returns void
language plpgsql
as $$
declare v_sale bar_sales%rowtype; v_balance int;
begin
  select * into v_sale from bar_sales where id = p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.voided then raise exception 'Sale already voided'; end if;
  update bar_sales set voided = true, voided_at = now(), voided_by = p_staff where id = p_sale_id;
  if v_sale.payment_method = 'wallet' and v_sale.user_name is not null then
    update bar_accounts set balance_pence = balance_pence + v_sale.total_pence, updated_at = now()
      where user_name = v_sale.user_name returning balance_pence into v_balance;
    insert into bar_ledger (user_name, type, amount_pence, balance_after_pence, staff, sale_id, note)
      values (v_sale.user_name, 'adjustment', v_sale.total_pence, v_balance, p_staff, p_sale_id, 'Voided sale');
  end if;
end;
$$;

-- Refund cash from a member's wallet (they take notes back). Committee action.
create or replace function bar_refund(p_user_name text, p_amount_pence int, p_staff text, p_note text default null)
returns int
language plpgsql
as $$
declare v_balance int;
begin
  if p_amount_pence <= 0 then raise exception 'Refund must be positive'; end if;
  select balance_pence into v_balance from bar_accounts where user_name = p_user_name for update;
  if v_balance is null then raise exception 'No bar account'; end if;
  if v_balance < p_amount_pence then raise exception 'Refund exceeds balance'; end if;
  update bar_accounts set balance_pence = balance_pence - p_amount_pence, updated_at = now()
    where user_name = p_user_name returning balance_pence into v_balance;
  insert into bar_ledger (user_name, type, amount_pence, balance_after_pence, staff, note)
    values (p_user_name, 'refund', -p_amount_pence, v_balance, p_staff, coalesce(p_note, 'Cash refund'));
  return v_balance;
end;
$$;
