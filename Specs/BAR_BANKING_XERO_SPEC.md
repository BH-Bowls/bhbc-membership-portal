# Bar Day End — Confirm, Bank & Xero Export Spec

*Status: proposal / not yet built. Written 23 September 2026.*

Scoped narrowly to the bar's existing Day End → Xero pipeline — not the full unified-accounts generalisation (`accounts`/`account_ledger`/`chargeable_items` covering Renewals and Rowland too) described in `specs/ACCOUNTS_SYSTEM_DESIGN.md`. This spec assumes that generalisation may or may not happen separately; everything here is written against the bar system as it exists today (`0063_bar_day_ends.sql`, `src/lib/bar-supabase.ts`, `src/lib/xero-export.ts`), and should be revisited if/when that wider migration happens.

---

## 1. What's already built (for context)

- `bar_day_ends` — one row per till cash-up. Created by `bar_create_day_end()` (`src/lib/bar-supabase.ts:461`), which sweeps up **every** `bar_sales`/`bar_ledger` row with `day_end_id IS NULL` at the moment it's called — not scoped to a device, session, or date, just "whatever hasn't been claimed yet" (see `getReport()` comment, `bar-supabase.ts:359`).
- `app/api/banking/bar-reconciliation` (Treasurer/Admin/T only) lists Day Ends and lets the treasurer export a selected batch to a Xero Manual Journal CSV (`src/lib/xero-export.ts`), marking them `xero_exported_at`.
- The export builds one journal per Day End (dated to that day, not merged across days), covering: top-ups (`Dr Cash/Card, Cr Wallet liability`), sales by nominal code and payment method (`Dr Cash/Card/Wallet liability, Cr Sales nominal code(s)`), refunds, and till cash variance (`bar_nominal_cash_variance_account`).
- Nominal-code config lives in `app/admin/config/page.tsx` (`BAR_NOMINAL_FIELDS`): Cash-in-hand, Card clearing, Wallet liability, Discounts given, Cash over/short, Default sales.
- **Not yet built, and what this spec covers:** a confirm/review gate on Day Ends, a cash-banking-batch layer, manual (off-till) Day End entries for envelope cash, and the further Xero journal that clears banked cash out of Cash-in-hand.

---

## 2. Problems this solves

- **Banking is irregular** — once or twice a week, sometimes fortnightly in winter — but Day Ends happen daily. Nothing today represents the actual act of taking cash to the bank, so nothing distinguishes "cash still in the safe" from "cash on its way to being banked" in the Xero export.
- **Non-till cash exists** — raffle money, teas collected in an envelope — counted by (potentially) anyone, not rung through the till, but still needs proper nominal coding and a route into the same reconciliation/export pipeline.
- **Day Ends need a review step** before being trusted downstream — variances should be checkable and correctable (with a reason) before a Day End can be banked or exported, not after.
- **Card (Square) settlement doesn't behave like cash.** Square already has its own accurate, date-structured settlement data; bundling card Day Ends into an arbitrary treasurer-curated batch (as cash needs) would just reconstruct — worse — something Square already knows precisely. See §8.

---

## 3. Confirm gate on Day End

Add to `bar_day_ends`:

```sql
alter table bar_day_ends add column confirmed_at timestamptz;
alter table bar_day_ends add column confirmed_by text;
```

A Day End must be confirmed before it can be included in a Banking record (§5) or a Xero export. Confirming is where the treasurer/cashier reviews the recorded cash variance and, if it's wrong, edits `cash_removed_pence` and the `reason` text directly on the Day End (no separate adjustment record — the existing variance + reason field covers it) before marking it confirmed.

---

## 4. Manual (off-till) Day End entries

For cash that never went through the till — raffle money, teas collected in an envelope — counted by anyone (not restricted to bar staff), and which must **not** get swept into a live till session's next cash-up.

### 4.1 Why this can't be a normal till sale

`bar_create_day_end()` links *everything* currently unlinked (`day_end_id IS NULL`) to whichever Day End it creates. If a manual entry sat as an ordinary unlinked `bar_sales` row — even briefly — the next real till cash-up (mid-shift, by someone else) would sweep it in and corrupt that session's float reconciliation. So a manual entry must create its **own sale and its own Day End in the same atomic step**, never left unlinked.

### 4.2 Mechanism

New Postgres function, deliberately not reusing `bar_create_day_end()`:

```
bar_create_manual_day_end(p_counted_by text, p_product_id uuid, p_amount_pence int, p_note text)
```

In one transaction:
1. Create a new `bar_day_ends` row sized exactly to `p_amount_pence` (cash expected = cash removed — no variance is possible, it's definitionally what was counted).
2. Insert one `bar_sales` row (`payment_method = 'cash'`, no device, `staff = p_counted_by`) with `day_end_id` already set to the new Day End's id.
3. Insert one `bar_sale_items` row against `p_product_id`, `qty = 1`, `unit_price_pence = p_amount_pence`.

Because the sale is inserted with `day_end_id` already populated, it's never visible to the real till's "sweep everything unlinked" query, at no point in time.

### 4.3 Where this lives

**`/banking/bar-reconciliation`** (Treasurer/Admin only) — not `/bar`. Two reasons:
- "Who counted" needs a full membership search, not the till's fixed staff/served-by list — the shared Bar login's staff picker doesn't fit someone who isn't bar staff.
- It must happen as a single, self-contained step that can't get mixed into a live till session — which the `/bar` till UI, by design, doesn't offer (a normal sale there is deliberately left unlinked until the next cash-up sweeps it in).

### 4.4 UI entry point and fields

A **"+ Non-Till Cash"** button on the bar-reconciliation screen (alongside the confirmed/unbanked Day End list) opens the manual entry form:

- **Who counted** — member search (any member, not a fixed list).
- **Product group** — dropdown, defaults to the last one used (speeds up entering several envelopes in one sitting).
- **Product** — dropdown within that group, carries the nominal code (already set up once, invisibly, same as any bar product).
- **Amount** — single lump figure.

Submitting calls `bar_create_manual_day_end()` (§4.2) and the form resets ready for the next entry — several envelopes (different counters, different products) are typically entered back-to-back in one sitting, each as its own submission. Each submission produces its own standalone Day End (one per envelope/counter) — bundling different people's envelopes into one record would blur accountability for who counted what. The new Day End then appears in the ordinary confirmed/unbanked list (§3, §5) indistinguishable from a till-derived one.

### 4.5 New products needed

- **Teas** — already anticipated as a `chargeable_items` category in `ACCOUNTS_SYSTEM_DESIGN.md` §5.4.
- **Raffle** — not yet defined. Note this doesn't contradict that spec's §4 non-goal ("the raffle's £1 stays cash-only... no practical way to route it through the till") — that was about per-ticket digital tracking, which this still doesn't attempt. It just gives the counted total a nominal-coded entry point.

Open question: should "counted by" be a single name, or require a second witness/counter-check field, given there's no independent till-vs-cash check for this money the way real till sales get?

---

## 5. Cash banking batch

### 5.1 Schema

```sql
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

create table bar_banking_day_ends (
  banking_id uuid not null references bar_bankings(id) on delete cascade,
  day_end_id uuid not null references bar_day_ends(id),
  primary key (banking_id, day_end_id)
);
```

A Day End can belong to at most one Banking record (banked once). Only **confirmed** Day Ends (§3) not already in a Banking record are eligible for selection.

### 5.2 Workflow

On the bar-reconciliation screen: the treasurer/cashier sees confirmed, not-yet-banked Day Ends (till-derived and manual ones mixed together, indistinguishable at this point), selects whichever set is physically being taken to the bank, and creates one Banking record. If a variance is found while bundling — a further short/over discovered when re-counting notes for the bank — it's corrected on the underlying Day End itself (§3's variance + reason field), not a separate field at this step.

### 5.3 Order independence

A Day End can be Xero-exported (§6) before or after it's included in a Banking record. Xero export processes two independent pools each run — newly-confirmed-and-unexported Day Ends, and newly-created-and-unexported Banking records — so it doesn't matter which happens first, and running the export multiple times before a banking trip happens is safe.

---

## 6. Xero export — extended

### 6.1 Per-Day-End journal (unchanged)

Exactly what `xero-export.ts` already builds: top-ups, sales by nominal code and payment method, refunds, till cash variance. Still one journal per Day End, dated to that day.

### 6.2 New: per-Banking-record journal

One journal per Banking record (not per Day End inside it):

```
Dr "Cash Banked"    <batch total>
Cr "Cash-in-hand"   <batch total>
```

"Cash Banked" is a new **Balance Sheet** control account (not P&L) — same species as Card clearing. New admin config field: `bar_nominal_cash_banked_account`.

This deliberately excludes any bank deposit fee — the amount here is the full gross total the included Day Ends summed to. The fee (if the bank charges one for cash deposits — see the earlier discussion on Post Office/branch cash-handling charges) is only applied later, against the real bank statement line:

```
Dr Bank (net received)
Dr Bank charges (the fee)
Cr "Cash Banked" (gross)
```

— an ordinary Xero bank-reconciliation step (manual split, or a Bank Rule if the fee is a known fixed formula), outside this app entirely.

### 6.3 Idempotency

Both `bar_day_ends` and `bar_bankings` carry their own `xero_exported_at`/`xero_exported_by`. Each export run picks up everything newly eligible from both tables. Effect: if the treasurer exports while cash is still unbanked, Xero's Cash-in-hand balance should equal exactly the total of all confirmed-but-unbanked cash. Once a Banking record covering that cash is created and exported, Cash-in-hand drops by that batch's total — to zero, if the batch included everything that was sitting there.

---

## 7. Three-tier control-account structure

| | Till/safe | In transit | Real bank |
|---|---|---|---|
| **Cash** | Cash-in-hand | Cash Banked (new, §6.2) | Bank |
| **Card** | Card clearing | Square Clearing (Square's own account, §8) | Bank |

Same shape both times: money moves through an intermediate control account between being recorded and being confirmed on the actual bank statement. Not a coincidence — it's the general pattern this whole design keeps landing on.

---

## 8. Card / Square handling

Recap of the conclusion reached in discussion, not yet verified against the live Xero/Square setup:

- **Preferred:** connect Square's own Xero integration, but remap its "sales" leg to post to `bar_nominal_card_account` (Card clearing) instead of a P&L Sales account. If Square's connection wizard allows mapping that field to a Balance Sheet account (unverified — needs checking directly in the UI), Square's integration then handles fee-splitting and payout-matching automatically, using its own accurate settlement data, and Card clearing self-zeros per payout with no manual batching needed. Since the two credits/debits into that account would come from two independent systems (the till and Square's own record), it also becomes a genuine control check — it should only zero out if the till and Square agree on a day's card takings.
- **Fallback**, if that account-mapping restriction turns out to block it: reuse the `bar_bankings`/`bar_banking_day_ends` mechanism from §5, but selection must be date/payout-matched against Square's own settlement reports (which day-ends' totals sum to a specific Square payout), not an arbitrary bundle the way cash naturally works — because Square's payout grouping is external and fixed, not something a treasurer should be reconstructing by eye.
- **Not building the fallback UI now.** Verify the Square account-mapping capability first — if it works, card needs no manual batching feature at all.

---

## 9. Open questions

- Does creating a Banking record count as its own confirmation, or does it need a separate lock/confirm step distinct from the confirmation already required on its underlying Day Ends?
- Square's Xero app: can its sales-account mapping target a Balance Sheet account? Needs testing directly in the connection wizard — not confirmable from documentation alone.
- BHBC's actual bank's cash-deposit fee structure (branch counter vs Post Office vs night safe) — unconfirmed, affects whether the final Cash Banked → Bank leg needs a fee split, and whether a Xero Bank Rule can automate it.
- "Counted by" on manual Day End entries (§4.4) — single name, or a second witness/counter-check field for accountability, given there's no till-derived variance check on this money.
- Should "Raffle" (and any other manual-entry-only chargeable items) carry a distinct nominal code from general bar sales, or fall under a shared "Fundraising/Other" code? Not decided here — same open item as §14 of `ACCOUNTS_SYSTEM_DESIGN.md` re: other bar categories' coding.
