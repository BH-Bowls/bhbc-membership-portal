-- 0095_bar_staff_approvals.sql
-- The bar person serving confirms with their own card or PIN (src/lib/bar-card.ts):
--   * to approve Pay by Account / Top Up for a member who can't show their card or PIN
--     (forgotten card, no PIN set) — 'account';
--   * before a Day End, Void, Refund or Cash Movement.
-- Each approval is logged here: who was serving, how they confirmed, what it was for.
-- Sales don't carry it themselves, so the existing sale/top-up functions are unchanged;
-- sale_id links a Pay by Account approval to its sale (shown on the till's Sales list).

create table if not exists bar_staff_approvals (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('account', 'day_end', 'void', 'refund', 'cash_movement')),
  staff         text not null,                 -- the bar person serving, who confirmed
  method        text not null check (method in ('pin', 'card')),
  user_name     text,                          -- the member, for an account approval or refund
  amount_pence  int,
  sale_id       uuid,                          -- the sale, for a Pay by Account approval or a void
  note          text,                          -- e.g. 'Top up (cash)', 'Square top-up started'
  created_at    timestamptz not null default now()
);

create index if not exists bar_staff_approvals_sale_idx on bar_staff_approvals (sale_id) where sale_id is not null;

-- RLS on, no policies — the app uses the service_role key (see 0001_config_table.sql)
alter table bar_staff_approvals enable row level security;
-- New tables need an explicit grant (see 0094_service_role_grants.sql)
grant select, insert, update, delete on table bar_staff_approvals to service_role;

-- Who must confirm with their card or PIN before a Day End, Void, Refund or Cash
-- Movement: 'off' (no one), 'testing' (bar people with the Testing role), 'all'.
-- Approving a member's account payment is always available, whatever this says.
insert into config (key, value) values ('bar_staff_proof', 'off')
on conflict (key) do nothing;
