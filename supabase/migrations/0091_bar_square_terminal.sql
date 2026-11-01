-- 0091_bar_square_terminal.sql
-- Square Terminal at the bar till (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §10).
--
-- The till sends a card amount to the Square Terminal through our API. Each request is a
-- row in square_checkouts holding what to record once it's paid (a sale's basket, a
-- top-up, or a membership fee). When Square says the checkout is COMPLETED — via the till
-- polling or Square's webhook, whichever comes first — the server records it from this
-- row, once (recorded_at is claimed atomically). Nothing is recorded for a checkout that
-- is cancelled or times out.

create table if not exists square_checkouts (
  id                 text primary key,             -- Square's terminal checkout id
  kind               text not null check (kind in ('sale', 'topup', 'membership')),
  payload            jsonb not null,               -- what to record: items / userName / staff …
  amount_pence       int not null check (amount_pence > 0),
  device_id          text not null,
  status             text not null default 'PENDING', -- Square's status, last seen
  cancel_reason      text,
  square_payment_id  text,
  recorded_at        timestamptz,                  -- set once the sale/top-up/fee is recorded
  result             jsonb,                        -- e.g. { saleId } / { balancePence } / { paymentId }
  record_error       text,                         -- paid on the Terminal but couldn't be recorded
  created_by         text not null,                -- the till login
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists square_checkouts_unrecorded_idx
  on square_checkouts (created_at) where recorded_at is null;

-- RLS on, no policies — the app uses the service_role key (see 0001_config_table.sql)
alter table square_checkouts enable row level security;

-- Which Square payment paid for a card sale (null for cash, wallet, or the card machine keypad)
alter table bar_sales add column if not exists square_payment_id text;

-- The paired Terminal's device id ('' = not paired: card sales use the tick-box flow).
-- Per database, so dev holds a sandbox test device and production the real one.
insert into config (key, value) values
  ('square_device_id', ''),
  ('square_device_name', '')
on conflict (key) do nothing;

-- A basket's total at the current prices — exactly what bar_visitor_sale() will charge
-- (same bar_price_item() call), so the Terminal is asked for the right amount.
create or replace function bar_quote_sale(p_items jsonb, p_user_name text default null)
returns int
language plpgsql
as $$
declare
  v_net_total int := 0; v_is_member boolean;
  v_item jsonb; v_pid uuid; v_qty int; v_gross int; v_net int;
begin
  v_is_member := p_user_name is not null;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid; v_qty := (v_item->>'qty')::int;
    if v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    select gross_pence, net_pence into v_gross, v_net from bar_price_item(v_pid, v_is_member);
    v_net_total := v_net_total + v_net * v_qty;
  end loop;
  if v_net_total <= 0 then raise exception 'Empty basket'; end if;
  return v_net_total;
end;
$$;
