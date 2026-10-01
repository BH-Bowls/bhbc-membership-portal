-- 0067_bar_confirm_manual_bankings.sql
-- Implements specs/BAR_BANKING_XERO_SPEC.md sections 3-6:
--   3. A confirm gate on Day Ends -- reviewed (and, before confirming, corrected)
--      before they can be banked or exported. Confirming locks cash_removed_pence
--      and carried_forward/difference_reason; bar_unconfirm_day_end() reopens it,
--      but only if nothing downstream (a banking, an export) already depends on it.
--   4. Manual (off-till) Day End entries for cash that never went through the
--      till (raffle, teas) -- its own self-contained Day End + sale in one
--      transaction, never visible to the till's "sweep everything unlinked" query.
--   5. Cash banking batches -- grouping several confirmed Day Ends into one
--      paying-in-slip total.
--   6. The extended Xero export needs a new "Cash Banked" control account
--      (config key only here; the CSV-building lives in src/lib/xero-export.ts).
--
-- Apply to the Dev Supabase project first, verify, then apply to Prod.

-- ── 3. Confirm gate ──────────────────────────────────────────────────────────

alter table bar_day_ends add column confirmed_at timestamptz;
alter table bar_day_ends add column confirmed_by text;

create or replace function bar_confirm_day_end(p_day_end_id uuid, p_staff text)
returns bar_day_ends
language plpgsql
as $$
declare v_day_end bar_day_ends;
begin
  update bar_day_ends set confirmed_at = now(), confirmed_by = p_staff
    where id = p_day_end_id and confirmed_at is null
    returning * into v_day_end;
  if not found then raise exception 'Day end not found, or already confirmed'; end if;
  return v_day_end;
end;
$$;

-- Reopens a confirmed Day End for correction. Blocked once anything downstream
-- has relied on it (a banking record, a Xero export) -- undoing those first
-- would ripple further than a simple unconfirm should.
create or replace function bar_unconfirm_day_end(p_day_end_id uuid)
returns bar_day_ends
language plpgsql
as $$
declare v_day_end bar_day_ends;
begin
  select * into v_day_end from bar_day_ends where id = p_day_end_id for update;
  if not found then raise exception 'Day end not found'; end if;
  if v_day_end.xero_exported_at is not null then
    raise exception 'Cannot unconfirm -- already exported to Xero';
  end if;
  if exists (select 1 from bar_banking_day_ends where day_end_id = p_day_end_id) then
    raise exception 'Cannot unconfirm -- already included in a banking';
  end if;
  update bar_day_ends set confirmed_at = null, confirmed_by = null
    where id = p_day_end_id
    returning * into v_day_end;
  return v_day_end;
end;
$$;

-- Corrects an unconfirmed Day End's cash-count outcome (found the till float
-- wrong, or the original reason/carry-forward choice was wrong). Blocked once
-- confirmed (unconfirm first) or once a LATER Day End already exists and this
-- one actually carried something forward -- that later Day End already read
-- this one's carried-out figure as its own carried-in, so changing it now would
-- silently desync the chain. Editing the reason with no change to the money
-- outcome is always safe and always allowed.
create or replace function bar_edit_day_end(p_day_end_id uuid, p_cash_removed_pence int, p_carry_forward boolean, p_reason text default null)
returns bar_day_ends
language plpgsql
as $$
declare
  v_day_end bar_day_ends;
  v_later_exists boolean;
  v_old_carried_out int;
  v_new_carried_out int;
  v_difference int;
begin
  select * into v_day_end from bar_day_ends where id = p_day_end_id for update;
  if not found then raise exception 'Day end not found'; end if;
  if v_day_end.confirmed_at is not null then
    raise exception 'Day end is confirmed and locked -- unconfirm it first';
  end if;

  select exists (select 1 from bar_day_ends where created_at > v_day_end.created_at) into v_later_exists;
  v_old_carried_out := case when v_day_end.carried_forward then v_day_end.cash_expected_pence - v_day_end.cash_removed_pence else 0 end;
  v_new_carried_out := case when p_carry_forward then v_day_end.cash_expected_pence - p_cash_removed_pence else 0 end;
  if v_later_exists and v_old_carried_out <> v_new_carried_out then
    raise exception 'Cannot change this figure -- a later cash-up has already used what this one carried forward. Only the reason can still be edited.';
  end if;

  v_difference := v_day_end.cash_expected_pence - p_cash_removed_pence;
  if v_difference <> 0 and not p_carry_forward and (p_reason is null or trim(p_reason) = '') then
    raise exception 'A reason is required when the difference is not carried forward';
  end if;

  update bar_day_ends set
    cash_removed_pence = p_cash_removed_pence,
    carried_forward = p_carry_forward,
    difference_reason = p_reason
    where id = p_day_end_id
    returning * into v_day_end;

  -- Only safe to update the live running figure if nothing has read the old
  -- value yet -- if a later Day End already exists, config now belongs to that
  -- later point in the chain, not this historical one.
  if not v_later_exists then
    update config set value = v_new_carried_out::text where key = 'bar_cash_carried_forward_pence';
  end if;

  return v_day_end;
end;
$$;

-- ── 4. Manual (off-till) Day End entries ─────────────────────────────────────

insert into bar_categories (key, label, color_key, sort_order) values
  ('non_till_cash', 'Non-Till Cash', 'indigo', 100)
on conflict (key) do nothing;

insert into bar_products (name, category, price_pence, base_price_pence, non_member_price_pence, variable_price, active, sort_order)
values
  ('Raffle', 'non_till_cash', 0, 0, 0, true, true, 1),
  ('Teas', 'non_till_cash', 0, 0, 0, true, true, 2)
on conflict do nothing;

-- Cash that never went through the till (raffle, teas), counted by anyone.
-- Creates its own sale AND its own Day End in one transaction, with day_end_id
-- already set on the sale -- never visible, even briefly, to the till's
-- bar_create_day_end() sweep of "everything currently unlinked". Cash expected
-- always equals cash removed (it's definitionally what was counted), so there's
-- no variance and no involvement with the carry-forward chain.
create or replace function bar_create_manual_day_end(p_counted_by text, p_product_id uuid, p_amount_pence int, p_note text default null)
returns bar_day_ends
language plpgsql
as $$
declare
  v_float int;
  v_outstanding int := 0;
  v_sale_id uuid;
  v_day_end bar_day_ends;
begin
  if p_amount_pence <= 0 then raise exception 'Amount must be positive'; end if;
  if not exists (select 1 from bar_products where id = p_product_id and active) then
    raise exception 'Unknown or inactive product';
  end if;

  select value::int into v_float from config where key = 'bar_till_float_pence';
  if v_float is null then v_float := 15000; end if;
  select coalesce(sum(balance_pence), 0) into v_outstanding from bar_accounts;

  insert into bar_day_ends (
    staff, float_pence, carried_in_pence, cash_topups_pence, cash_sales_pence, cash_movements_pence, refunds_pence,
    cash_expected_pence, cash_removed_pence, carried_forward, difference_reason,
    wallet_sales_pence, card_sales_pence, card_topups_pence, discounts_given_pence, outstanding_balance_pence
  ) values (
    p_counted_by, v_float, 0, 0, p_amount_pence, 0, 0,
    p_amount_pence, p_amount_pence, false, p_note,
    0, 0, 0, 0, v_outstanding
  ) returning * into v_day_end;

  v_sale_id := gen_random_uuid();
  insert into bar_sales (id, payment_method, user_name, total_pence, gross_total_pence, discount_pence, staff, day_end_id)
    values (v_sale_id, 'cash', null, p_amount_pence, p_amount_pence, 0, p_counted_by, v_day_end.id);
  insert into bar_sale_items (sale_id, product_id, qty, unit_price_pence)
    values (v_sale_id, p_product_id, 1, p_amount_pence);

  return v_day_end;
end;
$$;

-- ── 5. Cash banking batches ──────────────────────────────────────────────────

create table bar_bankings (
  id               uuid primary key default gen_random_uuid(),
  banked_date      date not null,
  total_pence      int  not null,
  banked_by        text not null,
  note             text,
  xero_exported_at timestamptz,
  xero_exported_by text,
  created_at       timestamptz not null default now()
);
alter table bar_bankings enable row level security;

create table bar_banking_day_ends (
  banking_id uuid not null references bar_bankings(id) on delete cascade,
  day_end_id uuid not null references bar_day_ends(id),
  primary key (banking_id, day_end_id)
);
alter table bar_banking_day_ends enable row level security;

-- A Day End can belong to at most one Banking record (banked once).
create unique index bar_banking_day_ends_day_end_unique on bar_banking_day_ends (day_end_id);

create or replace function bar_create_banking(p_banked_by text, p_banked_date date, p_day_end_ids uuid[], p_note text default null)
returns bar_bankings
language plpgsql
as $$
declare
  v_total int;
  v_count int;
  v_banking bar_bankings;
begin
  if p_day_end_ids is null or array_length(p_day_end_ids, 1) is null then
    raise exception 'Select at least one day end';
  end if;

  select count(*), coalesce(sum(cash_removed_pence), 0) into v_count, v_total
    from bar_day_ends d
    where d.id = any(p_day_end_ids)
      and d.confirmed_at is not null
      and not exists (select 1 from bar_banking_day_ends b where b.day_end_id = d.id);

  if v_count <> array_length(p_day_end_ids, 1) then
    raise exception 'One or more day ends are not confirmed, already banked, or do not exist';
  end if;

  insert into bar_bankings (banked_date, total_pence, banked_by, note)
    values (p_banked_date, v_total, p_banked_by, p_note)
    returning * into v_banking;

  insert into bar_banking_day_ends (banking_id, day_end_id)
    select v_banking.id, unnest(p_day_end_ids);

  return v_banking;
end;
$$;

create or replace function bar_add_day_end_to_banking(p_banking_id uuid, p_day_end_id uuid)
returns bar_bankings
language plpgsql
as $$
declare v_banking bar_bankings;
begin
  select * into v_banking from bar_bankings where id = p_banking_id for update;
  if not found then raise exception 'Banking not found'; end if;
  if v_banking.xero_exported_at is not null then raise exception 'Already exported to Xero'; end if;
  if not exists (select 1 from bar_day_ends where id = p_day_end_id and confirmed_at is not null) then
    raise exception 'Day end not found or not confirmed';
  end if;
  if exists (select 1 from bar_banking_day_ends where day_end_id = p_day_end_id) then
    raise exception 'Day end is already in a banking';
  end if;

  insert into bar_banking_day_ends (banking_id, day_end_id) values (p_banking_id, p_day_end_id);

  update bar_bankings set total_pence = (
    select coalesce(sum(d.cash_removed_pence), 0) from bar_banking_day_ends b
      join bar_day_ends d on d.id = b.day_end_id where b.banking_id = p_banking_id
  ) where id = p_banking_id returning * into v_banking;

  return v_banking;
end;
$$;

create or replace function bar_remove_day_end_from_banking(p_banking_id uuid, p_day_end_id uuid)
returns bar_bankings
language plpgsql
as $$
declare v_banking bar_bankings;
begin
  select * into v_banking from bar_bankings where id = p_banking_id for update;
  if not found then raise exception 'Banking not found'; end if;
  if v_banking.xero_exported_at is not null then raise exception 'Already exported to Xero'; end if;

  delete from bar_banking_day_ends where banking_id = p_banking_id and day_end_id = p_day_end_id;

  update bar_bankings set total_pence = (
    select coalesce(sum(d.cash_removed_pence), 0) from bar_banking_day_ends b
      join bar_day_ends d on d.id = b.day_end_id where b.banking_id = p_banking_id
  ) where id = p_banking_id returning * into v_banking;

  return v_banking;
end;
$$;

-- ── 6. Xero: new control account for cash in transit to the bank ────────────

insert into config (key, value) values ('bar_nominal_cash_banked_account', '') on conflict (key) do nothing;
