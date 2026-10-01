# Unified Accounts System — Design Spec

*Status: proposal / not yet built. Written 26 August 2026.*

---

## 1. Why

Three money systems exist today, built at different times, that all do a version of the same thing — take money from a member or a visiting club, and eventually reconcile it against the bank:

- **`/bar`** — cash-member wallets. Fully built on Postgres (`0025_bar.sql`). A member tops up, spends from balance or pays card/cash.
- **Renewals** — membership fees, paid once a year, reconciled against bank statement lines by hand (`/banking`, `src/lib/banking-supabase.ts`, `src/lib/banking-match.ts`).
- **Rowland Cup entries** — visiting clubs pay £16/team to enter (`0051_rowland_entries.sql`). Payment status is a manual Paid/Unpaid flag on `rowland_entries` — there is no bank-rec for this yet.

These are separate today, but they're the same shape: something owes an amount, money arrives (bank transfer, cash, card), someone matches the two up. The bar wallet already has the cleanest version of this (an append-only ledger with atomic Postgres functions) — this spec generalises that pattern to cover Renewals and Rowland too, rather than building a fourth parallel system.

This also solves a real, separately-requested problem: the club is moving to **Xero** for its accounts, and Xero needs an itemised, categorised export (nominal codes), not a lump sum. A unified ledger is what makes that export possible — right now the £132 a member pays covering a renewal + two 200 Club entries + eight comp entries has no single place it's recorded as those five separate lines.

---

## 2. Current state (as built today — read from the live code, not assumed)

| Area | Table(s) | Data layer | Notes |
|---|---|---|---|
| Bar wallets | `bar_accounts`, `bar_ledger`, `bar_sales`, `bar_sale_items`, `bar_products` | `src/lib/bar-supabase.ts` | Fully built, atomic plpgsql functions (`bar_topup`, `bar_wallet_purchase`, `bar_visitor_sale`, `bar_void_sale`, `bar_refund`). Opt-in — a row in `bar_accounts` only exists for members who've chosen to hold a cash balance. |
| Renewals | `renewals` (`0031_renewals.sql`) | `src/lib/renewals-supabase.ts` | One row per member per `season_year`. Carries fee columns (`playing_fee`, `social_fee`, `competitions_fee`, `club_200_fee`), per-competition entry flags, and payment/banking columns (`outstanding`, `banking`, `donations`, `difference`, `bank_transfer`/`card_machine`/`cheque`/`cash`, `payment_ids`, `date_paid`). |
| Renewal payments / bank rec | `renewal_payments` (same migration) | `src/lib/banking-supabase.ts`, `src/lib/banking-match.ts` | `banking-match.ts` has real, working fuzzy-match logic: strips "SUBS"/"MEMBERSHIP"/"RENEWAL" from a bank reference, scores against member full name/last name/username, includes buddies automatically, only commits when a selected group's totals exactly balance (`checkAmountsMatch`). This logic is worth keeping — see §7. |
| Rowland Cup entries | `rowland_entries`, `rowland_team_entries`, `rowland_access_tokens` (`0051_rowland_entries.sql`) | `src/lib/rowland-entries-supabase.ts` | `amount_due_pence`/`amount_received_pence`/`payment_status` on `rowland_entries`, but reconciliation is a manual `PATCH .../payment` route (`markEntryPaid`/`markEntryUnpaid`) — no bank-rec table exists yet (deliberately deferred per the entry spec's build order). A per-team access token already exists (`rowland_access_tokens`) for the organiser's status-check link — no login, expiring token, same pattern as Friendly game tokens. |
| 200 Club | fee captured on `renewals` (`club_200_fee`, `club_200_entries`, `club_200_preferred_numbers`) | mostly still Sheets-based for the draw/winners side | Entry *payment* already rides on the Renewals fee total; only the draw administration is separate. |
| Old banking spec | `specs/BANKING_RECONCILIATION_SPEC_V3_FINAL.md` | — | **Superseded.** Written Dec 2024 for the pre-migration, Sheets-only system (a separate "RenewalPayments" sheet, single-letter A/T role checks). The actual reconciliation logic it describes (reference-stripping, substring matching, exact-total commit) survived the migration nearly unchanged into `banking-match.ts` and is the thing this spec builds on — but the document itself, and its Sheets-specific mechanics, should be treated as historical from here on. |

**What this tells us:** the bar wallet is the most mature piece and the template to generalise. Renewals bank-rec already has good matching logic, just scoped to one table. Rowland has the token-access pattern already solved, just not the money side.

---

## 3. Goals

- One account per member (reusing the existing opt-in `bar_accounts` row) and one account per visiting club for Rowland, sharing the same ledger and balance mechanics.
- Renewals and Rowland entries both **debit** an account; bar purchases, top-ups, and future in-person renewal payments all move through the **same ledger**.
- A **due date** on debits so a January renewal that isn't payable until end-February doesn't show as debt in the meantime.
- Bank reconciliation that can match a statement line against **any** account (member or Rowland), not just Renewals — generalising the existing `banking-match.ts` logic rather than replacing it.
- A stored bank-reference alias per account (e.g. "SG Smith" vs "S & M Smith"), reassignable when it turns out wrong.
- A generalised "chargeable item" model so Membership, 200 Club, Comp Entries, and Teas can share the same basket/sale mechanism the bar already uses for drinks and snacks — because that's what Xero needs itemised.
- Nominal-code tagging (global default + per-item override) so a treasurer-triggered batch export to Xero can post categorised lines.
- Two-tier bar pricing (member/wallet price vs visitor/card-or-cash price), driven by **payment method**, not identity.
- A shared, locked-down "Bar" login (matching the existing `captains`/`clubhouse` shared-login pattern) that can sell, top up, and refund, with a mandatory "served by" selection per transaction.
- `valid_until` stored on the member record, set atomically when a renewal is reconciled.

## 4. Non-goals (explicitly out of scope)

- **No debt write-off / bad-debt feature.** A member isn't allowed to carry debt past the due date in normal operation; any exceptional case uses the existing generic `adjustment` ledger type. No dedicated UI.
- **No per-transaction Xero sync.** Export is a treasurer-triggered batch, not a live integration.
- **No full Renewals-table redesign here.** The `renewals` table's non-payment fields (competition flags, duty preferences, etc.) are out of scope. Only the payment-related columns migrate to the new ledger; the rest is untouched for now and "needs more thought" per the club treasurer — noted as an open item in §12.
- **No new digital tracking system for Teas beyond the existing Match Card.** Today, tea money (£2/member, covering them and their opponent) is collected pre-game via numbered jars, one per rink in use, cross-referenced against the team sheet's rink allocations — the captain checks each jar balances before play and chases any shortfall. This is being replaced (not left alongside) by moving collection to the bar: the £2 is marked against a member's name on the Match Card — either self-written or entered by the bar volunteer when the member buys drinks after the game — rung up as a "Teas" chargeable item (§5.4), and the captain of the day checks the Match Card once the bar's settled down, the same role the jar-check played before. The raffle's £1 stays cash-only and out of scope — no practical way to route it through the till.

---

## 5. Data model

### 5.1 Accounts

Generalise `bar_accounts` into `accounts`, adding an owner type:

```sql
create table accounts (
  id             uuid primary key default gen_random_uuid(),
  owner_type     text not null check (owner_type in ('member', 'rowland')),
  user_name      text references users(username) on update cascade,   -- set when owner_type = 'member'
  club_name      text references club_profiles(club_name),            -- set when owner_type = 'rowland'
  balance_pence  int  not null default 0,   -- see §6: can go negative between due date and payment
  bank_reference text,     -- stored alias for auto-matching, e.g. 'SG Smith', 'HKBC'
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint accounts_owner_check check (
    (owner_type = 'member' and user_name is not null and club_name is null) or
    (owner_type = 'rowland' and club_name is not null and user_name is null)
  ),
  unique (owner_type, user_name),
  unique (owner_type, club_name)
);
```

A member account is created the first time they need one (renewal, top-up, or opting in at the bar) — same lazy-creation approach `bar_topup` already uses (`insert ... on conflict (user_name) do nothing`). A Rowland account is created when a club's entry form is submitted.

`balance_pence` here is the **raw ledger total**, which can be negative once a due debit has passed its date. The *displayed/spendable* balance is computed separately — see §6.

### 5.2 Ledger

Generalise `bar_ledger` into `account_ledger`, adding `effective_date` (the due-date mechanic) and a link to the generalised sale:

```sql
create table account_ledger (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references accounts(id),
  type                text not null check (type in ('topup', 'purchase', 'refund', 'adjustment', 'debit')),
  amount_pence        int  not null,        -- signed: +credit, -debit
  effective_date      date not null default current_date,   -- when this entry counts toward spendable balance
  balance_after_pence int  not null,        -- raw running total at the time of this entry, not date-adjusted
  staff               text,
  sale_id             uuid references sales(id),
  payment_method       text check (payment_method in ('cash', 'card', 'bank_transfer', 'cheque', 'wallet')),
  note                text,
  created_at          timestamptz not null default now()
);

create index account_ledger_account_idx on account_ledger (account_id, effective_date);
```

`type = 'debit'` is new — it covers renewal fees, 200 Club entries, comp entries, and Rowland entries posted ahead of their due date. Bar purchases keep using `purchase` as today. `payment_method` is new at the ledger level (it didn't exist before as an explicit field — top-ups and in-person payments were implicit) — this is what feeds the Xero cash/card/account breakdown.

### 5.3 Balance computation — the due-date mechanic

Per the user's confirmed decision, this is **computed on read, not a cached column matured by a scheduled job**:

```sql
select coalesce(sum(amount_pence), 0) as spendable_balance_pence
from account_ledger
where account_id = $1
  and effective_date <= current_date;
```

A renewal posted in January with `effective_date = '2027-02-28'` doesn't touch the member's spendable balance until that date passes. The *raw* balance (all entries, ignoring `effective_date`) is available too, for admin/treasurer views that need to see what's coming — but the member-facing balance and the bar's "can this member afford this" check both use the date-filtered query above.

### 5.4 Chargeable items — generalising `bar_products`

Rename/broaden `bar_products` to `chargeable_items`, adding a category that spans physical stock and non-stock charges, plus the nominal code needed for Xero (§9):

```sql
create table chargeable_items (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  category        text not null,   -- 'beer','wine','zero_gf','soft','snack','membership','200_club','comp_entry','teas','rowland_entry'
  member_price_pence  int not null check (member_price_pence >= 0),
  visitor_price_pence int not null check (visitor_price_pence >= 0),
  nominal_code    text,     -- Xero nominal code override; null = use the category's default (§9)
  active          boolean not null default true,
  sort_order      int not null default 0,
  updated_by      text,
  updated_at      timestamptz not null default now(),
  unique (name, category)
);
```

`price_pence` splits into `member_price_pence`/`visitor_price_pence` (§10). Non-bar items (Membership, 200 Club Entry, Comp Entry, Teas) get rows here too — same price for both columns where the member/visitor distinction doesn't apply (e.g. a comp entry costs the same regardless of payment method), different where it does (Teas has always been a flat £2, no member/visitor split intended — set both columns equal at £2.00).

### 5.5 Sales — generalising `bar_sales`/`bar_sale_items`

Rename `bar_sales`/`bar_sale_items` to `sales`/`sale_items`, and widen `payment_method` to include the two new in-person methods and `account_id` to point at the new unified `accounts` table instead of `user_name` directly:

```sql
create table sales (
  id             uuid primary key default gen_random_uuid(),
  payment_method text not null check (payment_method in ('wallet', 'card', 'cash', 'bank_transfer', 'cheque')),
  account_id     uuid references accounts(id),   -- null = visitor, no account
  total_pence    int  not null check (total_pence >= 0),
  staff          text not null,   -- "served by" — now required, not optional (see §11)
  created_at     timestamptz not null default now(),
  voided         boolean not null default false,
  voided_at      timestamptz,
  voided_by      text
);

create table sale_items (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references sales(id) on delete cascade,
  item_id          uuid not null references chargeable_items(id),
  qty              int  not null check (qty > 0),
  unit_price_pence int  not null check (unit_price_pence >= 0),
  nominal_code     text not null   -- copied from chargeable_items at sale time, so a later nominal-code edit doesn't rewrite history
);
```

This is the piece that makes the £132 renewal example work: a treasurer reconciling that payment creates one `sale` with five `sale_items` (Membership £110, 200 Club Entry ×2 @£6, Comp Entry ×8 @£2), each carrying its own `nominal_code`. Xero export reads `sale_items`, not a single lump figure.

### 5.6 Bank reconciliation — generalising `renewal_payments`

Rename `renewal_payments` to `bank_statement_lines`, drop the Renewals-specific `matched_users` free-text column in favour of a real link table (so a statement line can match against any mix of member and Rowland accounts):

```sql
create table bank_statement_lines (
  id             uuid primary key default gen_random_uuid(),
  payment_id     text not null unique,   -- kept: human-readable P001-style reference
  date           date not null,
  type           text not null check (type in ('TRF', 'CDM', 'CHQ', 'CSH')),
  reference      text,
  amount         numeric(10,2) not null,
  status         text not null default 'Unmatched' check (status in ('Unmatched', 'Matched', 'Deleted')),
  created_at     timestamptz not null default now()
);

create table bank_statement_line_matches (
  bank_statement_line_id uuid not null references bank_statement_lines(id) on delete cascade,
  account_id              uuid not null references accounts(id),
  amount_pence            int  not null,
  primary key (bank_statement_line_id, account_id)
);
```

`findMatchingRenewals`/`countMatchingWords`/`extractSearchTerm`/`checkAmountsMatch` in `src/lib/banking-match.ts` carry over almost unchanged — they just need to run against `accounts` (member name fields, plus Rowland's `club_name`) instead of `RenewalForBanking[]`. This is a genuine reuse, not a rewrite: the matching logic already handles buddies, partial references, and exact-total-only auto-commit, which is exactly what's needed for the wider account set too.

When a match is confirmed, `accounts.bank_reference` is updated with the statement line's `reference` text (only if not already set, or on explicit override — see §7.2 for reassignment).

### 5.7 `valid_until` on the member record

A new stored (not computed) date column, likely on `member_profiles` given that's where `max_games_per_day` and similar per-member state already live:

```sql
alter table member_profiles add column valid_until date;
```

Set atomically alongside the ledger credit when a renewal reconciles — i.e. in the same database transaction/function that posts the `account_ledger` credit, not a separate step that could get out of sync.

---

## 6. Renewal / debit flow

1. Member submits their renewal form (unchanged UI). Total fee due is calculated as today.
2. Instead of writing to `renewals.outstanding`/`banking`/etc. directly, the system posts a `sale` (payment_method to be decided — see §12 open item on how "just submitted, not yet paid" is represented) with `sale_items` for each fee component (Playing, Competitions, 200 Club, per-comp entries), each carrying its own `nominal_code`, and an `account_ledger` entry of `type = 'debit'` for the total, dated with `effective_date` = the renewal's due date (e.g. end of February).
3. Until that date, the member's spendable balance (§5.3) doesn't reflect the debit.
4. When the treasurer reconciles a matching bank statement line (or records a cash/card/cheque payment taken in person — same flow, see below), a `topup`-type ledger entry brings the balance back up, and `member_profiles.valid_until` is set in the same transaction.

**In-person payment** (cash, card, or cheque taken at the bar or by the treasurer directly) uses the same `bar_topup`-style function, just with `payment_method` set to `cash`/`card`/`cheque` instead of defaulting to `bank_transfer`. This is the explicit `payment_method` field the current top-up mechanism doesn't have today — needed both for the Xero breakdown and because "how did this member pay" is now a real question once there are five ways to pay instead of one. Cash top-ups are notes only (no coins) — a UI/process constraint, not a schema one.

**Renewal-form top-up nudge:** the renewal form offers an optional extra line — a voluntary bar-balance top-up (e.g. £20/£50) added to the same total the member pays. E.g. Membership £110 + 200 Club £6 + Comp Entries £12 + Bar Top-up £20 = £148 in one bank transfer. This is a single `sale` with one extra `sale_item` of category `bar_topup`-equivalent (or simply an additional `account_ledger` credit posted alongside the debit in the same reconciling transaction) — no new mechanism, just an optional extra line item on the existing basket. Reduces the number of separate top-up transactions the treasurer has to reconcile.

---

## 7. Bank reconciliation

### 7.1 Matching (reuse, generalise)

The existing `banking-match.ts` logic — strip "SUBS"/"MEMBERSHIP"/"RENEWAL", score against name fields, include buddies, only commit on an exact-total match — is kept and extended to search across all accounts, not just renewal-outstanding members. Rowland matching adds `club_name` (and any stored `bank_reference` alias) as a search field, using the same word-scoring approach already in `countMatchingWords`.

### 7.2 Stored reference + reassignment

`accounts.bank_reference` speeds up future auto-matching for ambiguous cases (two "S Smith"s disambiguated as "SG Smith" vs "S & M Smith"). Because a stored alias can turn out to be wrong (assigned to the wrong Smith), the account management screen needs an explicit **reassign** action: move a bank reference (and, if the match already posted, the underlying ledger entries) from one account to another. This is a correction tool for committee/treasurer use, not a member-facing feature.

---

## 8. Rowland account access

Rowland already has the right token mechanism (`rowland_access_tokens` — expiring, per-team, no login). Extend it (or add a parallel `account_access_tokens` scoped to `owner_type = 'rowland'`) so the same token an organiser gets by email also lets them view their club's account balance and transaction history — reusing the existing "lazy token, resolved server-side" pattern rather than inventing a new one.

Internally, **Rowland Organiser** (an existing BHBC committee role, `hasRole(role, 'RowlandOrganiser')`) can view any Rowland account through the normal logged-in admin UI — distinct from a visiting club's own organiser, who only ever sees their own club's account via the token link.

---

## 9. Xero export

- **Trigger:** treasurer-initiated batch, not automatic and not per-transaction.
- **Content:** every `sale_item` since the last export, grouped by `nominal_code`, further split by `payment_method` where the treasurer wants that breakdown (bar takings by cash/card/account is the explicit example given).
- **Nominal codes:** held on `chargeable_items.nominal_code` (per §5.4), with a global default nominal code for general bar sales and overrides for specific items (Teas gets its own code; other bar products can too, if ever needed). `sale_items.nominal_code` is copied at sale time so historical exports don't shift if a code is edited later.
- **Mechanism:** out of scope to fully design here — depends on what Xero's API actually wants (journal entries vs. invoices vs. bank transactions). Flagged as an open item in §12; needs its own short spec once the treasurer has confirmed which Xero object type the export should create.

---

## 10. Bar pricing — member vs visitor

Two prices per chargeable item (`member_price_pence`, `visitor_price_pence`), selected by **payment method**, not by who the person is:

- Paying from account balance (`payment_method = 'wallet'`) → member price.
- Paying card or cash → visitor price.

This works because only members can hold an `accounts` balance in the first place — a member paying cash gets the visitor price too, which is the intended incentive (push people toward paying by balance, which also reduces cash handling).

### 10.1 Suggested 2026/2027 bottled beer pricing

Current price (unchanged since 2023): **£2.60**. The relevant ONS series is **RPI: Beer** (mnemonic `CZCG`, dataset `MM23`) — a better fit for bottled ale than the broader alcohol-and-tobacco CPI composite. Annual increases: 2023 +9.6%, 2024 +4.6%, 2025 +3.2%, 2026 running at roughly +2.2% (decelerating from +4.2% in January). Compounding from the 2023 baseline gives an inflation-adjusted "now" price of roughly **£3.11**, and continuing the current ~2.2% run-rate into next season gives roughly **£3.18** for 2027.

Agreed prices, phased more gradually than the full ONS-implied jump (to ~£3.11 in one step) — a 30p rise in 2026, then a further 10p in 2027 — while keeping a consistent 10p member/visitor gap and round figures a bar volunteer can give change against easily:

| Season | Member (wallet) | Visitor (card/cash) |
|---|---|---|
| 2026 | £2.90 | £3.00 |
| 2027 | £3.00 | £3.10 |

This also applies only to the bottled-beer category as a concrete example — whether other categories (wine, soft drinks, snacks) get repriced at the same time is a separate committee decision, noted as open in §12.

---

## 11. The bar till and served-by

Away from this system, bar volunteers today work entirely manually: totalling drink prices from memory or a printed list, then entering the total into a manual till — nothing links to a Member Account, and nothing records what was actually sold. This is what the bar system replaces: a tablet running a big-button till screen, one button per product showing its price (e.g. "Fursty Ferret — £2.90"), linked directly to `accounts` so a sale can be charged to a member's balance instead of worked out by hand.

The tablet itself uses **one shared login** (matching the existing `captains`/`clubhouse` pattern — locked-down navbar, no admin access) — it isn't a per-volunteer login.

**"Served by" is a required button selection at the start of every sale or top-up**, not a dropdown. A dropdown is too easy to leave on whoever used it last, which undermines the accountability the field exists for; getting the right name recorded matters most for top-ups, since that's real money moving into or out of an account, but the same button applies to ordinary sales too. Default the button selection to the last person used on that device (so the common case — one person on the bar for a whole session — is still one tap), but require an explicit tap every time rather than letting a stale value silently carry through. `sales.staff` becomes `not null` (§5.5) to enforce this at the data layer too.

---

## 12. Permissions

| Role | Can do |
|---|---|
| Shared "Bar" login | Sell items (any payment method), top up, refund. No bank rec, no account management, no admin/committee pages. |
| Member, role Admin or Treasurer | Bank reconciliation, account management (reassign bank references), view any account, trigger Xero export. |
| Member, role RowlandOrganiser | View any Rowland account. |
| Visiting club organiser (token link, no login) | View their own club's Rowland account only. |
| Ordinary member (logged in normally) | View their own account balance and transaction history only. |

---

## 13. Migration approach

This is a large surface area touching three existing systems, so a phased build is recommended over one big-bang migration:

1. **Schema first:** create `accounts`, `account_ledger`, `chargeable_items`, `sales`, `sale_items`, `bank_statement_lines`, `bank_statement_line_matches` alongside the existing `bar_*`/`renewals`/`rowland_entries` tables — nothing switches over yet.
2. **Backfill:** migrate existing `bar_accounts`/`bar_ledger` rows into `accounts`/`account_ledger` (owner_type = 'member'), since that data is already in the right shape.
3. **Bar cutover:** point the bar UI at the new tables (`chargeable_items` instead of `bar_products`, etc.), retire the old `bar_*` names once verified.
4. **Rowland cutover:** create a Rowland `accounts` row per existing `rowland_entries` row, migrate the manual Paid/Unpaid status into a proper debit + reconciled-payment ledger pair, wire the token-based balance view (§8).
5. **Renewals cutover:** the biggest piece — switch renewal submission to post a debit with `sale_items`, switch `/banking` to reconcile against `accounts`/`bank_statement_lines` instead of `renewals`/`renewal_payments` directly, add `valid_until`. This is where the "Renewals table still needs more thought" open item (§12 below) should get resolved before starting.
6. **Xero export:** once the above is stable and at least one full renewal cycle has run through it.

Each phase should get its own short verification pass (real Dev data, not synthetic) before moving to the next, consistent with how the rest of the Postgres migration has been done.

---

## 14. Open questions (not blocking, but need answers before or during build)

- **Xero API shape:** which Xero object (journal, invoice, bank transaction) the batch export should create — needs the treasurer's input on how Xero is actually being used day to day.
- **Renewals table restructuring:** exactly which non-payment columns stay on `renewals` vs move elsewhere — explicitly flagged by the club treasurer as needing more thought, not designed here.
- **Other bar categories' pricing:** whether wine/soft drinks/snacks get repriced alongside bottled beer, or beer is a standalone first step.
- **"Not yet paid" sale state:** whether a renewal submission (debit posted, no payment yet) needs its own `sales` row at submission time, or whether the debit ledger entry alone is sufficient until payment actually arrives — affects whether `sale_items`/nominal-code detail is captured at submission or only at reconciliation time.
