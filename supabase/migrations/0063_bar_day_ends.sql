-- 0063_bar_day_ends.sql
-- Bar End of Day / Treasurer reconciliation / Xero export groundwork.
--
-- Categories become real, admin-manageable data instead of the hardcoded 6 in
-- app/bar/page.tsx -- bar_products.category already had no check constraint
-- restricting it to those 6 (confirmed against 0025_bar.sql), so this just makes
-- that flexibility real and gives each category a place to hold a nominal code.
-- color_key must be one of the app's fixed Tailwind colour palette (JIT only
-- bundles literal class strings, so an arbitrary new category can't get an
-- arbitrary new colour at request time -- it picks from a fixed set instead).
--
-- bar_day_ends is the durable End-of-Day record: a bar person cashes up against
-- the till float, and every bar_ledger/bar_sales row not yet linked to a day end
-- (day_end_id is null) gets aggregated into one row and linked to it. Running the
-- cash-up again with no new activity finds nothing unlinked, so nothing changes.
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

create table if not exists bar_categories (
  key          text primary key,
  label        text not null,
  color_key    text not null,
  nominal_code text,
  sort_order   int not null default 0,
  active       boolean not null default true
);
alter table bar_categories enable row level security;

insert into bar_categories (key, label, color_key, sort_order) values
  ('beer', 'Beers / Lagers', 'amber', 1),
  ('wine', 'Wines', 'rose', 2),
  ('spirit', 'Spirits', 'purple', 3),
  ('zero_gf', '0% & Gluten Free', 'teal', 4),
  ('soft', 'Soft Drinks / Splashes', 'sky', 5),
  ('snack', 'Snacks', 'orange', 6)
on conflict (key) do nothing;

alter table bar_products add constraint bar_products_category_fkey foreign key (category) references bar_categories(key);
alter table bar_products add column nominal_code text;

create table bar_day_ends (
  id                        uuid primary key default gen_random_uuid(),
  staff                     text not null,
  created_at                timestamptz not null default now(),
  float_pence               int not null,
  cash_topups_pence         int not null,
  cash_sales_pence          int not null,
  refunds_pence             int not null,
  cash_expected_pence       int not null,
  cash_removed_pence        int not null,
  difference_reason         text,
  wallet_sales_pence        int not null,
  card_sales_pence          int not null,
  card_topups_pence         int not null,
  discounts_given_pence     int not null,
  outstanding_balance_pence int not null,
  xero_exported_at          timestamptz,
  xero_exported_by          text
);
alter table bar_day_ends enable row level security;

alter table bar_ledger add column day_end_id uuid references bar_day_ends(id);
alter table bar_sales add column day_end_id uuid references bar_day_ends(id);
create index bar_ledger_day_end_idx on bar_ledger (day_end_id);
create index bar_sales_day_end_idx on bar_sales (day_end_id);

-- Fixed control-account nominal codes + the till float. Seeded blank ('') --
-- functional until the Treasurer fills in real codes on the Bar tab of
-- /admin/config; updateConfig() only ever updates an existing key, never
-- inserts, so these must be seeded here to be editable at all.
insert into config (key, value) values ('bar_till_float_pence', '15000') on conflict (key) do nothing;
insert into config (key, value) values ('bar_nominal_cash_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('bar_nominal_card_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('bar_nominal_wallet_liability_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('bar_nominal_discounts_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('bar_nominal_cash_variance_account', '') on conflict (key) do nothing;
insert into config (key, value) values ('bar_nominal_default_sales_account', '') on conflict (key) do nothing;

create or replace function bar_create_day_end(p_staff text, p_cash_removed_pence int, p_reason text default null)
returns bar_day_ends
language plpgsql
as $$
declare
  v_float int;
  v_cash_topups int := 0;
  v_card_topups int := 0;
  v_refunds int := 0;
  v_wallet_sales int := 0;
  v_card_sales int := 0;
  v_cash_sales int := 0;
  v_discounts int := 0;
  v_cash_expected int;
  v_outstanding int := 0;
  v_day_end bar_day_ends;
begin
  select value::int into v_float from config where key = 'bar_till_float_pence';
  if v_float is null then v_float := 15000; end if;

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

  v_cash_expected := v_cash_topups + v_cash_sales - v_refunds;

  insert into bar_day_ends (
    staff, float_pence, cash_topups_pence, cash_sales_pence, refunds_pence,
    cash_expected_pence, cash_removed_pence, difference_reason,
    wallet_sales_pence, card_sales_pence, card_topups_pence, discounts_given_pence,
    outstanding_balance_pence
  ) values (
    p_staff, v_float, v_cash_topups, v_cash_sales, v_refunds,
    v_cash_expected, p_cash_removed_pence, p_reason,
    v_wallet_sales, v_card_sales, v_card_topups, v_discounts,
    v_outstanding
  ) returning * into v_day_end;

  -- Link everything unlinked, including voided sales/adjustment-only ledger rows
  -- (they don't contribute to the sums above, but must still stop showing up as
  -- "unlinked" in the next day end).
  update bar_ledger set day_end_id = v_day_end.id where day_end_id is null;
  update bar_sales set day_end_id = v_day_end.id where day_end_id is null;

  return v_day_end;
end;
$$;
