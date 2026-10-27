# Renewals — Draft/Submit, Xero Journals, Void, and Paying Online or at the Bar

*Status: agreed design, not yet built (except §2). Written 15 October 2026. Revised 26 October 2026: Stripe added (§11) and Xero changed from sales invoices to daily summary journals (§6). The treasurer approved the Xero model on 26 October 2026, and all the assumptions in this spec have been confirmed.*

Brings renewals into the same Xero pipeline as the bar (`specs/BAR_BANKING_XERO_SPEC.md`), and gives members and bar staff a clear route from "renewal submitted" to "renewal paid" — online, by bank transfer, or at the bar by card or cash. Written against the code as it stands on `main` (`supabase/migrations/0031_renewals.sql`, `src/lib/renewals-supabase.ts`, `app/api/renewals/route.ts`, `app/renewals/page.tsx`, `src/lib/banking-supabase.ts`, `src/lib/xero-export.ts`).

Follow `specs/CODING_STANDARDS.md` throughout (no `?.` / `??`, explicit readable code, `text-gray-700` minimum).

---

## 1. Summary of decisions

| Area | Decision |
|---|---|
| Renewal form | **Save Draft** and **Submit** buttons. Drafts are amendable; Submit locks the renewal for good. |
| Not renewing | Submits immediately — no draft stage, nothing owed. Can be **reopened** back to a draft (§3.7), since nothing has gone to Xero. |
| Corrections after submit | The member's choices can't be changed. Financial corrections (extra charge, credit, refund) are made by the treasurer as **adjustments in the portal** (§6.7). |
| Void | Admin only, whole renewal only, only when **submitted and nothing at all paid**. Purely financial. |
| Xero | The portal holds all member detail. Xero gets a **daily summary Manual Journal** through a **Membership debtors** account and a clearing account per payment method (§6). No invoices or contacts. |
| Payment routes | Online by card via Stripe Checkout, either **as part of submitting** or later from My Account (§11, confirmed 26 Oct), bank transfer (Banking — exists), at the bar by card or cash (new till option). |
| Season year | Calendar year (`getCurrentSeasonYear()`) is correct — renewals go out in January after the year's first committee meeting. |
| Competitions | Entrants follow the competition's own `year` (§2.2, built). |
| 200 Club numbers | Members pick free numbers on the form; written to `two_hundred_club_entries` on Submit. 2027 is first come, first served. |
| Unpaid 200 Club entries | No app logic — GMC deletes non-payers by hand in `/200-club`. |
| Card terminal | **Square Terminal** (see §10). |

---

## 2. Already built (15 Oct 2026, uncommitted)

### 2.1 Bank details in config

- Migration `0077_bank_details_config.sql` — `bank_name`, `bank_sort_code`, `bank_account_number`, `bank_account_name`, seeded with the previously hardcoded HSBC details. **Apply before deploying.**
- `src/lib/bank-details.ts` — `getBankDetails()`; field names match the email placeholders (`{{bankName}}` etc.) so it can be spread into template variables.
- Used by: Renewals page (both payment boxes), Rowland Cup entry confirmation page, and the `renewal-confirmation`, `application-payment-request` and `rowland-entry-confirmation` email templates.
- Editable on `/admin/config` → General → Bank details.

### 2.2 Competitions entrants by competition year

- `getEntrantsFromRenewals(compId, seasonYear)` reads renewals for the given season, not the calendar year.
- `GET /api/competitions/[compId]/entrants?year=` — falls back to the competition's saved `year`.
- `/competitions/[compId]/setup` has a **Season** field on the dates step, saved with the dates. A competition that is still *Not Started* and whose saved year is earlier than this year defaults to the current year.

### 2.3 200 Club draw email optional

`/200-club` → Record a draw has an **Email the winners** tick box (default on).

### 2.4 Phase 1 — Draft / Submit (built 26 Oct 2026, branch `feature/renewals-draft-submit`, uncommitted)

§3.1–3.9 as written, using only the Phase 1 columns of §3.1:
- **Migration:** `0083_renewals_draft_submit.sql` adds `submitted_at` / `submitted_by` with the backfill, and `member_profiles.printed_membership_book`. **Apply before deploying.**
- **Lock:** enforced in the `PUT /api/renewals` route and again inside the UPDATE (`updateRenewal(..., { onlyIfDraft: true })`).
- **Server-controlled fields:** `renewalsClosed`, `submittedAt`/`submittedBy` and `confirmationEmailDate` are now stripped from the request body, so a member can no longer clear an admin's `renewals_closed` by sending it back.
- **Buttons:** the navbar has two slots, so renewing shows **Submit Renewal** and **Save Draft** there, and **Cancel changes** is on the page. All three are repeated at the bottom of the form.
- **Emails:** `renewal-confirmation.html` now takes its season from data (it was hardcoded as 2026).
- **Reopen and drafts:** reopen and the §3.9 draft filters are included (competition entrants, membership card and labels, Banking list and report, data export Status column).

### 2.6 Phase 2 — Admin member selector and Void (built 26 Oct 2026, same branch, uncommitted)

- **Migration:** `0084_renewals_void.sql` adds `voided_at`, `voided_by` and `void_reason`, with a check that a void needs a submission and a reason. **Apply before deploying.**
- **Member selector:** a real Admin (not impersonating) gets a **Member** selector at the top of `/renewals`, defaulting to "Me". Admins have no extra edit rights through it; the lock still applies.
- **Void button:** on a submitted, renewing renewal with nothing paid.
- **`GET /api/renewals/void`:** checks the void is allowed and lists the 200 Club numbers and competitions, each linked.
- **`POST /api/renewals/void`:** voids with a required reason, records the real Admin and sets `outstanding = 0`. The conditions are re-checked inside the UPDATE.
- **Voided renewals:** they show a grey "voided" banner and are excluded from Banking, the Banking report, the membership card and labels. They stay in competition entrants, because a void is financial only. The data export marks them "Voided".

### 2.7 Phase 3 — Renewals journal export (built 26 Oct 2026, same branch, uncommitted)

**Migration and code:**
- **Migration:** `0085_renewals_xero_journal.sql`. **Apply before deploying.** It adds:
  - `renewal_xero_exports`, which stores each CSV;
  - the export links on `renewals`, plus `renewal_payments.source`;
  - `renewal_transactions`;
  - the `renewals_xero_record_export()` function, which records an export all or nothing;
  - config seeds.
- **Logic:** `src/lib/renewals-xero.ts`. Every event becomes postings, and the same postings drive the journal preview, the export and the debtors report, so they always agree.
- **Shared CSV format:** moved to `src/lib/xero-journal-csv.ts`. The bar export uses it unchanged.
- **Page:** `/banking/renewals-xero`, with Export (preview and history), Checks (debtors as at a date, transfers clearing), Adjustments, and Settings tabs. It's linked from `/banking` and the navbar.

**Differences from §6 as written:**
- **One ledger:** `renewal_transactions` holds payments *and* adjustments, instead of a separate `renewal_adjustments` table. A `method` column (card or cash) is ready for till payments.
- **Banking writes to the ledger:** `POST /api/banking/submit` now records each member's share of a match as a `payment` transaction, dated with the latest bank date of its payments. Banking only ever kept running totals on the renewal, which a daily journal can't use.
- **Two extra accounts:**
  - `renewals_nominal_donations_account` for Banking's donations;
  - `renewals_nominal_adjustments_account` for Banking's "difference", where a negative is written off.
- **Settings on the export page:** the account codes are edited there rather than on Admin config, because the treasurer isn't an Admin. Only `renewals_*` keys can be written there. Card clearing and Cash-in-hand are shown, but stay on Admin config → Bar.
- **Adjustments use Banking's columns:** a charge or credit goes on `difference`, and a refund comes off `banking`. That keeps Banking's own formula (outstanding = fee − banking + donations + difference) right on its next match.
- **Paid at submission:** §11.3a's `paid_at_submission` isn't handled yet. It comes with Stripe (Phase 5).

### 2.8 Phase 4 — My Account fee card (built 26 Oct 2026, same branch, uncommitted)

- **Data:** `getRenewalFeeStatuses()` in `src/lib/renewals-supabase.ts` gives each member's state this season: none, draft, not renewing, outstanding, paid or voided. It only reads, so opening My Account never creates a renewal row.
- **API:** `GET /api/account/renewal-fees` returns the member, then anyone who has them as their buddy, with the bank details and each member's `SUBS {username}` reference.
- **Card:** on the Membership Card tab of `/account`, below the card.
  - Draft: "saved as a draft — it isn't complete until it's submitted", with a link to `/renewals` for the member's own renewal.
  - Outstanding: the amount, the bank transfer reference with a Copy button, then one "How to pay" block (bank details, at the bar by card or cash).
  - Paid: "Membership paid — thank you."
  - Voided, not renewing and not started show nothing. The existing "Renew your membership" link still shows when the member's renewal is due and they have no fee entry.
- **Not yet:** the **Pay online** button comes with Stripe (Phase 5). "At the bar" is shown now, but the till's Membership fees option comes with Phase 6.
- **Buddies:** a buddy sees each managed member's entry, but only their own draft links to `/renewals`, because the renewal form's member selector is Admin-only.

### 2.9 Phase 5 — Stripe online payments (built 27 Oct 2026, same branch, uncommitted)

**Migration and code:**
- **Migration:** `0086_renewals_stripe.sql`. **Apply before deploying.** It adds:
  - on `renewals`: `stripe`, `paid_at_submission`, `pending_checkout_session_id`, `pending_checkout_expires_at`;
  - on `renewal_payments`: type `STR`, `stripe_session_id`, `stripe_payment_intent_id`, and a unique index on (session, member);
  - the `renewals_record_stripe_payment()` function, which records a whole session all or nothing and returns 0 if it was already recorded;
  - config `stripe_payments_enabled` (default `false`).
- **Package:** `stripe` 23.0.1, pinned, with API version `2026-09-30.endive`.
- **Code:** `src/lib/stripe.ts` (client, env getters, the enabled check) and `src/lib/stripe-payments.ts` (checkout, webhook handling, status, cancel).
- **Routes:**
  - `POST /api/payments/stripe/checkout` — My Account's Pay online.
  - `GET` / `POST /api/payments/stripe/status` — polling, and cancelling a held draft.
  - `POST /api/webhooks/stripe` — public in `proxy.ts` and PIN-exempt.
- **Renewals API:** `PUT /api/renewals` takes `action: 'pay'`.

**Pages:**
- **`/renewals`:**
  - **Submit and pay £X online** button at the bottom of the form, with a confirmation dialog.
  - **Pay online by card** in the Payment Details box once submitted, and on the submitted screen.
  - Banners for processing, paid, cancelled and expired.
  - A "payment in progress" banner with **Cancel the online payment** while a draft is held.
- **`/account`:** Pay online, with a tick list when there's more than one member, and a processing banner on return.
- **Banking report:** an "Online (Stripe)" total.
- **Xero journal:** a renewal paid at submission is journalled Dr Stripe clearing, Cr income. My Account payments go Dr Stripe clearing, Cr debtors through `renewal_transactions`.

**Differences from §11 as written:**
- **Config toggle:** on Admin config → **General**, not a Renewals tab, because there isn't one.
- **Return pages:** "Submit and pay online" returns to `/renewals` rather than `/account`, so the member lands back on their renewal. `&member=` brings an Admin back to the member they were working on.
- **Cancelling:** coming back via `cancel_url` expires the Stripe page straight away and releases the draft, rather than waiting up to 30 minutes for it to expire.
  - The cancel is made **by member**, using the session id stored on the renewal, because Stripe only fills in `{CHECKOUT_SESSION_ID}` on `success_url`.
  - It checks Stripe first, so a page that was paid after all gets recorded rather than cancelled.
  - The browser's own Back button doesn't reach `cancel_url`. The renewal then shows "payment in progress" with a **Cancel the online payment** button, and My Account shows "online payment in progress".
- **Catch-up when the webhook is missed** (found in testing 27 Oct): the webhook isn't the only way a payment is recorded. `reconcileCheckoutSession()` asks Stripe directly, with the secret key, so it can't be faked from the browser. A paid session is recorded exactly as the webhook would (idempotent), and an expired one releases its draft. It runs when the return page polls for status, when a held renewal is loaded, and before any save to a held renewal. A My Account payment whose webhook never arrives is only caught while its return page is open.
- **Webhook events:** `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.expired`. The newer Stripe CLI needs them listed with `--events`, and the live dashboard webhook needs the same three ticked.
- **Paid-at-submission ledger:** these payments get no `renewal_transactions` row, because the submission itself carries the Stripe posting. The Adjustments tab shows a "Paid online when submitted" line in its place.
- **200 Club picks:** §11.3a step 4's picks aren't handled, because the number picker is Phase 7.
- **Banking:** Stripe payments come in already Matched with `source = 'stripe'`, so the Banking match screen and the transfers clearing check never show them.

**Environment:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, with test keys on dev and preview. Pay online stays hidden until both the config switch and the secret key are set.

**Tested on dev, 27 Oct 2026:**
- Submit and pay.
- Pay from My Account.
- A buddy paying for two.
- A 3-D Secure card.
- Stripe's ← back link and the browser's Back button.
- Cancelling a held payment.
- Catching up on payments whose webhook was missed.

**Go-live checklist:**
1. Apply migration 0086 on prod.
2. Treasurer: the club's Stripe account is verified, with HSBC set as the payout account.
3. In the Stripe dashboard (live), go to **Developers → Webhooks** and add an endpoint at `https://<portal domain>/api/webhooks/stripe`. Tick `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.expired`.
4. In Vercel, for **Production only**, set `STRIPE_SECRET_KEY` (`sk_live_…`) and `STRIPE_WEBHOOK_SECRET` (the live endpoint's `whsec_…`). Preview keeps the test keys.
5. In the Stripe dashboard, turn on **Settings → Customer emails → Successful payments**. Test mode never emails receipts.
6. Tick **Online renewal payments (Stripe)** on Admin config → General when ready.
7. Make one small live payment, then refund it in the Stripe dashboard and record the refund on the Adjustments tab.

**Testing locally:** `stripe login`, then:

`stripe listen --api-key sk_test_… --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.expired --forward-to localhost:3001/api/webhooks/stripe`

Without `--api-key`, the CLI can be linked to a different test environment from the key, and no events arrive.

### 2.5 Competitions eligibility from the friendlies data (built 26 Oct 2026, same branch)

- **Rule:** a playing member can enter club competitions if they made themselves available for at least `min_friendlies_for_competitions` friendlies in the previous season. The setting already existed (Admin config → General) but nothing read it. It's seeded at 8 and is **to be set to 6** for 2027.
- **Count:** worked out live from the fixture groups data (`getFriendliesAvailableCount()`). It's every entry the member didn't withdraw from, whatever became of the game (cancelled, abandoned and games left at Open all count), which is the same as the **Total** on Friendlies → My Stats. It no longer comes from a number on the member.
- **Override:** `competitions_eligible_override` on the admin member page still forces eligible or not eligible. Blank now means "use the count" (before, blank meant not eligible).
- **Logic:** `src/lib/competition-eligibility.ts`. The renewal form shows the member's count, and `PUT /api/renewals` refuses competition entries from an ineligible member.
- **Test year:** `RENEWALS_TEST_SEASON_YEAR` (dev and preview only, ignored on production) makes renewals act as another season for testing.

---

## 3. Renewal form — Draft / Submit

### 3.1 Schema

Add to `renewals`:

| Column | Type | Notes |
|---|---|---|
| `submitted_at` | `timestamptz` | null = draft (or not started) |
| `submitted_by` | `text` | username of whoever pressed Submit (member, buddy, or Admin) |
| `voided_at` | `timestamptz` | §5 |
| `voided_by` | `text` | §5 — the real Admin, never an impersonated user |
| `void_reason` | `text` | §5, required when voiding |
| `xero_submit_export_id` | `uuid` FK `renewal_xero_exports` | §6.4 — the export that included the submission |
| `xero_void_export_id` | `uuid` FK `renewal_xero_exports` | §6.4 — the export that included the void |
| `paid_at_submission` | `boolean default false` | §11.3a |
| `pending_checkout_session_id` | `text` | §11.3a |
| `pending_checkout_expires_at` | `timestamptz` | §11.3a |
| `stripe` | `numeric default 0` | §11.5 — amount paid online |

Voids are whole-renewal only. Partial corrections go in `renewal_adjustments` (§6.7).

**Backfill:** every existing row with `renewing_membership` not null gets `submitted_at = coalesce(confirmation_email_date, updated_at, created_at)` and `submitted_by = username`. Every save so far has behaved as a submission (each one sent the confirmation email).

### 3.2 States

| | Draft | Submitted | Voided |
|---|---|---|---|
| Member can amend | Yes | No | No |
| Shown on My Account | "Renewal saved as a draft — remember to submit it" | "Fee outstanding £X" (or Paid) | Nothing |
| Exported to Xero | No | Journal lines: Dr Membership debtors (or Stripe clearing if paid at submission), Cr income | Reversing lines, if the submission was exported |
| Payable (till, online, Banking match) | No | Yes, while `outstanding > 0` | No |

### 3.3 Buttons

- **Renewing:** navbar shows **Save Draft** and **Submit Renewal** (replacing today's single *Submit Renewal*). Submit asks for confirmation: *"Once submitted, your renewal can't be changed. Submit now?"*
- **Not renewing:** a single **Save** that submits immediately (`submitted_at` set, all fees zeroed as today).
- **Submitted:** form is read-only with a "Submitted on {date}" banner. No Edit button.

### 3.4 Server-side enforcement

`PUT /api/renewals` must refuse (409, *"This renewal has already been submitted and can't be changed"*) any update to a row with `submitted_at` set — **for every role, including Admin**. Today's "paid = locked" rule (`app/renewals/page.tsx`, `paymentReceived`) is enforced only in the browser and must not be relied on.

Request body gains `action: 'draft' | 'submit'`. Only `'submit'` sets `submitted_at`/`submitted_by` (the real user: `session.user.originalAdmin.userName` when impersonating, else `session.user.userName`).

Banking's `updateRenewalPayment()` is unaffected — it writes payment columns, not the member's choices.

### 3.5 Emails

| Event | Template | Content |
|---|---|---|
| Save Draft | **new** `renewal-draft.html` | Summary of choices so far. States clearly that this is **only a draft** and must be submitted before the renewal counts. **No bank details, no payment instructions.** Link to `/renewals`. |
| Submit (renewing) | existing `renewal-confirmation.html` | As today, plus how to pay: bank transfer (bank details from config, reference below), at the bar (card or cash), online (link to `/account`, when `stripe_payments_enabled` is on). |
| Submit (not renewing) | existing `renewal-cancellation.html` | Unchanged. |

Sent through `sendTemplateEmail` (pooled transporter) as today. Draft-reminder emails are **out of scope** — email strategy not yet decided.

### 3.6 Bank transfer reference

Change from `SUBS {SURNAME}` to **`SUBS {username}`** on the Renewals page and in `renewal-confirmation`. The username is unique, so Banking's auto-match (`specs/BANKING_RECONCILIATION_SPEC_V3_FINAL.md`, which already searches `userName`) finds exactly one member. Surnames match several (e.g. family members). The `SUBS` prefix is also what the Xero bank rule keys on (§6.5).

UK bank references are limited to 18 characters. A truncated reference still matches, because Banking's match is a substring search against the username.

### 3.7 Reopening a "not renewing" submission

A member who submitted **not renewing** and changes their mind can reopen it. Nothing was owed, so nothing was exported and there's nothing to undo in Xero.

- The read-only banner on a submitted not-renewing renewal shows a **Reopen renewal** button, available to anyone who can edit that renewal today (the member, their buddy, or an Admin via the §4 selector).
- Confirmation: *"Reopen your renewal? It will go back to a draft and you'll need to submit it again."*
- `PUT /api/renewals` with `action: 'reopen'` clears `submitted_at` / `submitted_by`. Allowed **only** when the row is submitted, not voided and `renewing_membership = 'No'`; every other submitted row still gets the §3.4 409.
- The form then behaves as a normal draft: the member chooses renewing, fills it in and submits as usual (confirmation email, exported, payable).
- No email on reopen.
- Not possible once the member has been archived — they can't sign in, and an Admin would have to restore them first.

### 3.8 Printed membership book question

The renewal form asks: **"Do you want a printed membership book? (contains contact names and fixtures)"** — Yes / No.

- **Stored on the member, not the renewal:** new column `member_profiles.printed_membership_book boolean` (null = never answered), in the next free migration. It's a standing preference that carries from year to year.
- **Asked every year:** the form pre-fills the member's current answer, so they confirm or change it at each renewal. If it's never been answered, nothing is pre-selected and an answer is **required** to submit.
- **Saved the same way as the volunteering questions** (`barDuty` etc.): read from the profile in `GET /api/renewals` (`printedMembershipBook`), sent in the `PUT` body, split off and written through `updateUserProfile()` in `src/lib/profile-supabase.ts` (add to its field map), not into `renewals`.
- **Only asked when renewing.** A "not renewing" submission leaves the value unchanged.
- **Picking it up:**
  - shown and editable on the admin member page (`/admin/members/list/[userName]`);
  - a **Printed book** filter on `/admin/members/list`, to get the list and count for the print run;
  - a column in the data export (`src/lib/data-export.ts`);
  - shown in the `renewal-confirmation` email summary.

### 3.9 Drafts are ignored everywhere else

Decided 26 Oct 2026: only the renewal form (and its draft email) sees drafts. Every other reader of `renewals` counts **submitted renewals only** (`submitted_at is not null`):
- `getRenewalCompetitionEntries()`, which feeds Competitions entrants (§2.2). Voided renewals stay in, because a void is financial only and competition entries are dealt with by hand (§5.2).
- `getLatestRenewedSeason()` / `getLatestRenewedSeasonsByUser()`, which feed the membership card and labels.
- Banking: `getRenewalsWithOutstanding()` and `app/api/banking/report/route.ts`. Voided renewals are also excluded, because nothing is owed.
- The 200 Club still-to-allocate list (§9.2).
- The data export (`src/lib/data-export.ts`): either only submitted rows, or a "Status" column (Draft / Submitted / Voided).

---

## 4. Admin member selector on `/renewals`

Admins get a **member selector** at the top of `/renewals`, defaulting to themselves. Selecting a member loads their renewal via `GET /api/renewals?userName=` (already allowed for Admin by `canManageUser()`); saves go through `PUT` with `userName` in the body (already supported).

Why not impersonation: impersonating swaps the session role to the member's (`src/lib/auth.ts`, `START_IMPERSONATION`), so an Admin-only Void button would never show, and the void would be recorded against the member. Impersonation continues to work as today for everything else.

Admins have no extra edit rights through the selector — the §3.4 lock still applies. The selector is how they reach **Void** (§5) and view any member's renewal status.

---

## 5. Void renewal

### 5.1 When it's offered

**Void renewal** button shown only when **all** are true:
- current user is Admin (real role, not impersonating);
- renewal is submitted (`submitted_at` not null);
- not already voided;
- **nothing has been paid** — `banking` is null or 0 and the four payment-type columns are all null/0. Part-paid renewals cannot be voided.

If anything has been paid, there is no void option. The treasurer records a credit adjustment and, if due, a refund (§6.7), and the member is archived as usual.

### 5.2 Dialog

1. **Reason** — required free text.
2. **Still attached** — informational list, only shown if non-empty:
   - 200 Club numbers held this season (from `two_hundred_club_entries`), each linking to `/200-club`;
   - competitions entered (`comp_*` / `sub_*` flags), each linking to `/competitions/[compId]`.

   The void does **not** remove these. They're listed so the Admin can deal with them by hand.
3. **Void** / **Cancel**.

### 5.3 Effect

`POST /api/renewals/void` (Admin only) `{ userName, reason }`:
- re-checks §5.1 server-side;
- sets `voided_at`, `voided_by` (real Admin), `void_reason`;
- sets `outstanding = 0` so the renewal drops out of Banking matching, My Account and the till;
- **does not** change `renewing_membership`, fees, competition flags, 200 Club entries or the member's archive status.

Xero consequence (§6.2):
- submission **not yet exported** → neither the submission nor the void is exported, because they cancel;
- submission **already exported** → reversing lines (Dr income, Cr Membership debtors) go in the journal for the void date.

---

## 6. Xero export — renewals journal

*Changed 26 Oct 2026 from sales invoices to summary journals. The treasurer's write-up (awaiting her approval) is the Claude Doc "Membership renewals: accounting in the portal and Xero".*

The portal holds all member-level detail. Xero gets one **Manual Journal per day** with renewal activity, showing **totals by account only** and no member names, in the same way as the bar's Day End journals (`src/lib/xero-export.ts`). No invoices, contacts or credit notes go to Xero.

### 6.1 Accounts

All of these are ordinary **current-asset** accounts, not bank accounts. Xero doesn't allow manual journals to post to bank accounts or to Accounts Receivable.

| Account | Config key | Holds |
|---|---|---|
| Membership debtors | `renewals_nominal_debtors_account` | Total owed by members on submitted renewals |
| Membership transfers clearing | `renewals_nominal_transfers_clearing_account` | Receipts on the HSBC feed that the portal hasn't yet exported as matched |
| Stripe clearing | `renewals_nominal_stripe_clearing_account` | Online card payments until Stripe pays out |
| Card clearing | `bar_nominal_card_account` (existing) | Card payments taken at the bar |
| Cash-in-hand | `bar_nominal_cash_account` (existing) | Cash payments taken at the bar |

Income (or fund) accounts, one per fee type:
- `renewals_nominal_playing_account`
- `renewals_nominal_social_account`
- `renewals_nominal_competitions_account`
- `renewals_nominal_200_club_account` — a **liability** account, not income (treasurer, 26 Oct)

The treasurer creates the accounts in Xero and enters the codes in config herself.

### 6.2 What goes in the journal

Each event goes into the journal for **its own date**.

| Event | Date | Dr | Cr |
|---|---|---|---|
| Renewal submitted (not paid at submission) | `submitted_at` | Membership debtors | Each income account (one line per non-zero fee) |
| Renewal submitted and paid online (§11.3a, `paid_at_submission`) | `submitted_at` | Stripe clearing | Each income account |
| Renewal voided (§5) | `voided_at` | Each income account | Membership debtors |
| Payment from the HSBC statement (`source = 'banking'`, any type: TRF, CHQ, CSH or CDM) | Bank date | Membership transfers clearing | Membership debtors |
| Card at the bar (`source = 'till'`, CDM) | Payment date | Card clearing | Membership debtors |
| Cash at the bar (`source = 'till'`, CSH) | Payment date | Cash-in-hand | Membership debtors |
| Online payment from My Account (`source = 'stripe'`) | Payment date | Stripe clearing | Membership debtors |
| Adjustment: extra charge (§6.7) | Created date | Membership debtors | The fee type's account |
| Adjustment: credit (§6.7) | Created date | The fee type's account | Membership debtors |
| Refund via HSBC (§6.7) | Created date | Membership debtors | Membership transfers clearing |
| Refund via Stripe (§6.7) | Created date | Membership debtors | Stripe clearing |

Every line of a given date and account is **summed into one line**, with a description giving the count, e.g. `Renewals submitted (12) – Playing membership`, `Bank transfers matched (5)`, `Card payments at the bar (3)`.

Rules:
- **Voided before its submission was exported:** both are left out, because they cancel.
- **The paid-at-submission Stripe payment** isn't exported separately. It's already covered by the submission line.
- **Only seasons ≥ `renewals_xero_first_season`** (seed `2027`) are exported. Membership debtors starts the 2027 season at zero.
- **Payments with no renewal yet** (unmatched in Banking) aren't exported. They sit in Membership transfers clearing in Xero until matched.

### 6.3 CSV format

The same **Manual Journal import** CSV as the bar, built with the same column constant and helpers as `buildXeroManualJournalCsv()` in `src/lib/xero-export.ts` (move the shared parts out so both use them):
- one journal (Narration + Date) per date, narration `Membership renewals {d MMM yyyy}`;
- each journal must balance;
- tax rate **No VAT** on every line (confirmed by the treasurer). Kept as config `renewals_xero_tax_rate` (seed `No VAT`) so it can be changed without code.

The column headings are confirmed: the treasurer imports the bar journal into Xero without problems, so the renewals journal reuses its format unchanged.

Export frequency is up to the treasurer, roughly weekly. Nothing in the design depends on it.

### 6.4 Export page and tracking

New page **`/banking/renewals-xero`** (Admin and Treasurer, checked as `Admin`, `Treasurer` or the legacy Treasurer code `T` — same guard as bar reconciliation), linked from `/banking`:
- **To export:** every unexported event, grouped by date, with a preview of each day's journal lines and totals.
- **Export** downloads the CSV and stamps every included event with the export's id, so nothing is ever exported twice.
- **History:** every past export with its date range, who produced it and when, and a **Download again** button.

Schema:
- New table `renewal_xero_exports`: `id uuid`, `exported_at`, `exported_by`, `from_date`, `to_date`, `csv text`. The CSV is stored, so a re-download is the identical file.
- `xero_export_id uuid` (FK) on `renewal_payments` and on `renewal_adjustments` (§6.7).
- On `renewals`, `xero_submit_export_id` and `xero_void_export_id` (both FK), listed in §3.1.

### 6.5 Xero setup (treasurer, one-off)

- Create the three new accounts in §6.1.
- Add a **bank rule** on the HSBC account: any receipt whose reference contains `SUBS` → Membership transfers clearing. A receipt with an unclear reference is coded there by hand, and the portal sorts out whose it is.
- **Stripe is not connected as a bank feed.** Each Stripe payout appears on the HSBC feed and is reconciled from Stripe clearing. The payout is net of Stripe's fees, and the difference is coded to bank charges, as with Square's payouts from Card clearing.
- Enter all the account codes on `/admin/config` → Renewals.

### 6.6 Checking against Xero

The export page has two reports, each as at any date and counting **exported events only**, so they compare like with like:
- **Debtors as at {date}:** each member's balance, with fees submitted − voids − payments ± adjustments. Its total equals Membership debtors in Xero on that date. It can also back up the year-end accounts.
- **Unmatched receipts:** Banking payments still `Unmatched`, plus matched ones not yet exported. Their total equals Membership transfers clearing in Xero.

Card clearing and Stripe clearing should zero once the payouts are reconciled. Cash-in-hand follows the bar's existing cash banked route.

### 6.7 Adjustments and refunds

These are financial corrections after submit, made by the treasurer. The member's form stays locked (§3.4), and void (§5) remains the route for an unpaid renewal.
- New table `renewal_adjustments`:
  - `id`, `season_year`, `username`;
  - `kind` — `'charge'`, `'credit'` or `'refund'`;
  - `fee_type` — `playing`, `social`, `competitions` or `200_club`; for charges and credits only;
  - `refund_via` — `'bank'` or `'stripe'`; for refunds only;
  - `amount` (> 0), `reason` (required), `created_by`, `created_at`, `xero_export_id`.
- Recorded from the Admin member view on `/renewals` (§4) or from `/banking`, by Admin and Treasurer only.
- **Effect on the renewal:** a charge adds to `outstanding`; a credit reduces it, and can take it below zero; a refund adds back to it. Both kinds of correction show in the member's payment history.
- **Refunds are paid outside the app:** a bank payment from HSBC, which the treasurer codes to Membership transfers clearing in Xero, or a refund in the Stripe dashboard.
- **Typical use:** a member who has paid and then leaves gets a credit for the unused fee, then a refund. This replaces "the treasurer raises a credit manually in Xero".

---

## 7. My Account — membership fee card

On `/account`, a card driven by the current season's renewal:

| Renewal state | Card |
|---|---|
| None and renewal due | Existing "Renew your membership" link |
| Draft | "Your renewal is saved as a draft — it isn't complete until you submit it." → `/renewals` |
| Submitted, `outstanding > 0` | "Membership fee outstanding: £X" with ways to pay: bank transfer (bank details from config, reference `SUBS {username}` with a copy button), at the bar (card or cash), **Pay online** (§11) |
| Submitted, paid | "Membership paid — thank you" (or omitted) |
| Voided | Nothing |

Respects buddies: a buddy sees the card for each member they manage.

---

## 8. Till — "Membership fees" option

### 8.1 Flow

New **Membership fees** button on the bar till (`/bar`):
1. **Find member** — search lists only renewals for the current season that are submitted, not voided, with `outstanding > 0`.
2. Shows the breakdown (membership, competitions, 200 Club) and **amount due**.
3. Choose **Card** or **Cash**.
   - **Card (now):** staff take the amount on the card machine, then tick **"Payment taken on the card machine"** to confirm.
   - **Card (later, §10):** the till sends the amount to the Square Terminal and waits for Square's confirmation — no tick box.
   - **Cash:** confirm amount received.
4. On confirm, the payment is recorded (§8.2) and a confirmation screen shows the renewal as paid.

Amount: **full amount due only** (part payments go through Banking).

### 8.2 Recording

Reuse Banking's tables so nothing is keyed twice:
- Insert a `renewal_payments` row: `type = 'CDM'` (card) or `'CSH'` (cash), `status = 'Matched'`, `matched_users = username`, `reference = 'TILL {username}'` (plus the Square payment ID when §10 is live), next `P###` id.
- Update the renewal via the same logic as `updateRenewalPayment()` — add to `card_machine` / `cash` and `banking`, reduce `outstanding`, set `date_paid`, append to `payment_ids`.
- Add to `renewal_payments`: `source text` (`'banking'` default, `'till'`), `day_end_id uuid` (FK `bar_day_ends`), `staff text`.

Banking shows these as already matched ("Paid at bar"), so the treasurer doesn't enter them again.

### 8.3 Day End and the bar Xero journal

- `bar_create_day_end()` also sweeps till renewal payments (`source = 'till'`, `day_end_id` null) into the Day End it creates.
- **Cash** renewal payments are added to the Day End's **expected cash** — the money is physically in the till. Without this, each one appears as a surplus.
- **Card** renewal payments are listed on the Day End so the till's card total matches the card machine's total.
- The Day End's **bar Xero journal does not post them**, so they're never mixed with bar takings. They go in the **renewals journal** instead (§6.2: Dr Card clearing or Cash-in-hand, Cr Membership debtors). They're listed on the Day End and in Bar Reconciliation as *"Renewal payments (in the renewals journal)"*, with member, username, method and amount.

---

## 9. 200 Club numbers on the renewal form

### 9.1 Flow

- The form keeps **Number of entries** (drives `club_200_fee` and the 200 Club journal line).
- For each entry the member either **picks a free number** (grid of numbers 1..`numbers` from that season's `two_hundred_club_settings`, taken ones disabled) or chooses **Any number**.
- Picks are **not reserved while the renewal is a draft.**
- **On Submit**, picked numbers are inserted into `two_hundred_club_entries` (`season`, `number`, `username`). `unique (season, number)` prevents clashes. If any pick has been taken since the form loaded, Submit fails with *"Number 23 has just been taken — please choose another"* and nothing is submitted.
- `club_200_preferred_numbers` is no longer written by the form (column kept for history).

### 9.2 `/200-club` — still to allocate

New list for GMC/Admin: members whose submitted renewal's `club_200_entries` is greater than the numbers they hold this season — i.e. "Any number" entries waiting to be given a number by hand. Manual sales and assignment continue as today.

### 9.3 Price from settings

Confirmed prices for 2027: **200 Club £6 per number**, **competitions £2 per entry**. These match the current constants `CLUB_200_ENTRY_FEE = 6` and `COMPETITION_ENTRY_FEE = 2` in `src/lib/renewals-supabase.ts`.

The 200 Club price is also held in `two_hundred_club_settings.price`, and the form's fee calculation (`app/renewals/page.tsx`) and `CLUB_200_ENTRY_FEE` should both read it, so there's one source. The 2027 settings row (price £6) must exist before renewals go out in January. If it's missing, the form shows "200 Club entries not yet open".

### 9.4 Rules

- **2027: first come, first served.** No carry-over of last season's numbers.
- **2028 (revisit then):** a previous holder may keep a number only if it was their preferred number and hasn't otherwise been allocated.
- **Non-payers:** GMC deletes their entries by hand in `/200-club`. A voided renewal's numbers are listed in the Void dialog (§5.2) but not removed automatically.

---

## 10. Square Terminal (later phase)

Decision: **Square Terminal** (about £149 + VAT, 1.75% per UK card, no per-transaction fee, no monthly fee). Chosen because:
- it's the device Square's **Terminal API** supports, so the till can push an amount to it;
- it has its own keypad for manual amounts, so it still works if the till is down;
- it's the only Square device with a built-in receipt printer.

Integration (server-driven, nothing on the bar PC): till → our API route → `POST /v2/terminals/checkouts` → Square webhook (polling fallback) → record the sale with Square's payment ID. Applies to ordinary card sales and to §8 renewal payments.

**Receipts (checked 26 Oct 2026):** yes. Square's docs list the UK for both the Terminal API and itemized checkouts (`order_id`), and say the Terminal "provides an itemized receipt using its built-in printer" ([Take Payments on Hardware](https://developer.squareup.com/docs/in-person-payment-options), [Take Payments for Orders](https://developer.squareup.com/docs/terminal-api/take-payments-for-orders)).
- **Default:** the customer chooses paper, email or no receipt on the Terminal's screen after paying.
- **Always print:** the Terminal's own printer setting can be set to print every receipt automatically, overriding `skip_receipt_screen`.
- **Itemized receipts:** pass an `order_id` (created through the Orders API) with the checkout. Without one, the receipt shows only the total. Forum posts from 2022–24 said this was US-only, but the current docs list the UK.
- **When the device arrives:** test one API checkout with and without an `order_id`, because the sandbox can't print.

---

## 11. Online payments — Stripe

Confirmed 26 Oct 2026: members can pay their renewal online by card through Stripe. (Stripe Terminal stays ruled out for the bar — §10.)

### 11.1 Scope

- **In scope:** paying a submitted renewal's `outstanding` amount online — the member's own, and any members they're buddy for, in one payment.
- **Out of scope (possible later uses of the same plumbing):** application fees, Rowland Cup entries, bar wallet top-ups, refunds from inside the app. The webhook and payment tables are built generically (`purpose` in the metadata) so these can be added without re-plumbing.

### 11.2 Approach — Stripe Checkout (hosted page)

The member is redirected to a **Stripe-hosted Checkout page** and back. Card details never touch our app or Vercel, which keeps the club at the lightest PCI level (SAQ A) and gives Apple Pay / Google Pay and 3-D Secure for free. No embedded card form.

### 11.3 Flow

1. **Pay online** button on the My Account fee card (§7) and on the submitted-renewal banner on `/renewals`. A buddy sees a tick list of their own renewal and each managed member's with `outstanding > 0` (all ticked by default).
2. `POST /api/payments/stripe/checkout` with `{ userNames: [...] }`. The server:
   - checks the session user may pay for each one (`canManageUser()`);
   - re-reads each renewal and **takes the amount from `outstanding` in the database, never from the browser**;
   - refuses drafts, voided renewals and anything with `outstanding <= 0`;
   - creates a Checkout Session: `mode: 'payment'`, currency GBP, one line item per member (`2027 membership — {full name}`), `customer_email` = payer's email, `expires_at` = now + 30 minutes (Stripe's minimum), and metadata `purpose = 'renewal'`, `season`, `payer`, and `{username: amount}` for each member;
   - returns the session URL; the browser redirects to it.
3. Member pays on Stripe's page. `success_url` → `/account?payment=processing`, `cancel_url` → `/account`.
4. **Stripe calls our webhook** (§11.4). The payment is recorded only there — never on the success redirect, which can be skipped or faked.
5. The success page shows "Payment received — updating your account…" and polls `GET /api/payments/stripe/status?session=` until the webhook has recorded it, then shows the fee card as Paid.

### 11.3a Submit and pay online (on the renewal form)

The main route, added 26 Oct 2026. Paying later from My Account (§11.3) stays as an option for anyone who submits without paying.

1. When `stripe_payments_enabled` is on and the renewal is "renewing" with a total above £0, `/renewals` shows a third button, **Submit and pay online**, beside Save Draft and Submit Renewal. It covers only the renewal being edited, not a buddy's other members.
2. Pressing it saves the form as a draft and runs every Submit check, including that the picked 200 Club numbers are still free. The server then creates a Checkout Session for the draft's total, calculated server-side, with metadata `purpose = 'renewal_submit'` and the renewal id.
3. While that session is open, the draft is held: new columns `renewals.pending_checkout_session_id` and `pending_checkout_expires_at`. `PUT /api/renewals` refuses edits until the session completes or expires, so the amount paid can't drift from the form.
4. **Webhook (`checkout.session.completed`)** does the Submit and the payment together:
   - sets `submitted_at` / `submitted_by`;
   - inserts the 200 Club picks;
   - records the `STR` payment (§11.5), leaving `outstanding = 0`;
   - sets `renewals.paid_at_submission = true`;
   - sends `renewal-confirmation` showing **Paid, thank you** in place of the how-to-pay section.

   If a picked 200 Club number was taken while the member was on Stripe's page, the renewal is still submitted. The entry becomes "Any number" and goes on the still-to-allocate list (§9.2), and the confirmation email says so.
5. **Abandoned or expired:** `cancel_url` is `/renewals?payment=cancelled`, which shows *"Your renewal hasn't been submitted. It's still a draft."* The hold is cleared on expiry (`checkout.session.expired` webhook, or on the next load after `pending_checkout_expires_at`).
6. **Xero:** a renewal with `paid_at_submission` is exported as **Dr Stripe clearing, Cr each income account**, and never touches Membership debtors (§6.2).

### 11.4 Webhook

`POST /api/webhooks/stripe`:
- Reads the **raw** body (`await request.text()`) and verifies the `Stripe-Signature` header with `STRIPE_WEBHOOK_SECRET`. Anything that fails verification gets 400 and is ignored.
- Handles `checkout.session.completed` where `payment_status = 'paid'`. Other events get 200 and are ignored.
- **Idempotent:** Stripe retries webhooks, so a session already recorded (unique `stripe_session_id`, §11.5) returns 200 without recording again.
- Must be added to both the public-route list and the PIN-gate exemptions in `proxy.ts` — Stripe has no session or PIN.

### 11.5 Recording the payment

Reuse Banking's tables, like the till (§8.2):
- New payment type **`STR`** (Stripe) alongside `TRF`/`CDM`/`CHQ`/`CSH` in `banking-supabase.ts` (`Payment.type`, both `validTypes` lists, `getPaymentTypeColumn()`), mapping to a new `renewals.stripe numeric default 0` column.
- One `renewal_payments` row **per member** paid for (a buddy paying for two members makes two rows), each with its own `P###` id: `type = 'STR'`, `status = 'Matched'`, `matched_users = username`, `reference = 'STRIPE {username}'`, `source = 'stripe'`.
- New `renewal_payments` columns: `stripe_session_id text`, `stripe_payment_intent_id text`, with a unique index on `(stripe_session_id, matched_users)`.
- The renewal is updated with the same logic as `updateRenewalPayment()`: add to `stripe` and `banking`, reduce `outstanding`, set `date_paid`, append to `payment_ids`.
- Banking shows these as already matched ("Paid online"), so the treasurer doesn't enter them again.

**Edge cases** (rare, because a submitted renewal can't change):
- *Paid at the bar or by transfer while the Checkout page was open* → the webhook records it anyway. `outstanding` goes negative (overpaid), and the payment is flagged in Banking for the treasurer to refund in the Stripe dashboard and record as a refund adjustment (§6.7).
- *Renewal voided while the Checkout page was open* → same: recorded and flagged for refund. (Void is only offered while nothing is paid, so it can't happen afterwards.)
- *Session expires unpaid* → nothing to do; the member can start again.

### 11.6 Fees

Stripe's online card rates ([stripe.com/gb/pricing](https://stripe.com/gb/pricing), checked 26 Oct 2026):
- **Standard UK cards: 1.5% + 20p**
- **Premium UK cards: 2.8% + 20p**
- EEA cards: 2.5% + 20p
- International cards: 3.15% + 20p

Examples: a £132 playing renewal costs the club £2.18 on a standard card (£3.90 on a premium card), and a £25 social renewal costs £0.58. **The club absorbs the fee** — UK law bans surcharging consumers for card payments — so the member pays exactly `outstanding`.

### 11.7 Xero

Stripe works the same way as Square at the bar (§6.2, §6.5):
- payments go into the renewals journal as **Dr Stripe clearing**: against income when paid at submission, otherwise against Membership debtors;
- Stripe is **not** connected to Xero as a bank feed. Each payout appears on the HSBC feed and is reconciled from Stripe clearing, with the fee difference coded to bank charges;
- Stripe clearing zeroes once the payouts are reconciled.

### 11.8 Receipts and emails

Turn on Stripe's own **email receipts** in the dashboard — no new template. The app sends no extra email on payment.

### 11.9 Config and environment

- Env vars, with getter functions (per the `specs/CLAUDE.md` env-var pattern): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. **Test-mode keys** on dev and preview, **live keys** on production only.
- Config key `stripe_payments_enabled` (Admin config, Renewals tab, default off) — hides every **Pay online** button, so the integration can be deployed before it's switched on.
- Package: `stripe` (server-only), pinned to a fixed API version.
- Local testing: Stripe CLI `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, and Stripe's test cards (including the 3-D Secure one).

### 11.10 Before building

The club needs a **Stripe account** in its own name (charity/club details, HSBC payout account, someone to verify identity). That's the treasurer's job and can take a few days.

---

## 12. Build order

| Phase | Scope | Depends on |
|---|---|---|
| 1 | §3 Draft/Submit, server lock, draft + submit emails, `SUBS {username}`, backfill, printed membership book question | — |
| 2 | §4 Admin member selector, §5 Void | 1 |
| 3 | §6 Renewals journal export, export history, debtors and unmatched-receipts reports, adjustments and refunds, Renewals config tab | 1, 2; treasurer's accounts set up in Xero |
| 4 | §7 My Account fee card | 1 |
| 5 | §11 Stripe online payments | 1, 4; club Stripe account |
| 6 | §8 Till Membership fees (tick-box card + cash), Day End sweep, Banking integration | 1 |
| 7 | §9 200 Club picker, price from settings, still-to-allocate list | 1 |
| 8 | §10 Square Terminal push | hardware |

Phases 1 and 7 must be live before January 2027 renewals go out. Phases 4 and 5 (My Account + Stripe) should be too if the Stripe account is ready, since January is when most renewals are paid.

---

## 13. Decisions log and remaining checks

Answered 26 Oct 2026:
- **Drafts:** ignored everywhere except the form (§3.9).
- **Assumptions:** every assumption in this spec is confirmed. That covers the Admin lock, full amount only at the till, `SUBS {username}`, no void once anything is paid, who can reopen, the printed book carry-forward and required answer, buddy multi-payment, the club absorbing Stripe fees, Admin/Treasurer-only adjustments, and bank-statement receipts going to transfers clearing.
- **Xero journal model:** approved by the treasurer, with:
  - 200 Club as a liability;
  - No VAT;
  - income booked at submission;
  - roughly weekly exports;
  - the bar journal format reused.
- **Setup:** the treasurer creates the Xero accounts and bank rule, and is setting up the Stripe account.
- **Prices:** 200 Club £6, competitions £2 each.
- **Bar top-ups:** no per-member detail in Xero, only in the portal. The bar journal stays as it is.

Checked 26 Oct 2026:
- **Square Terminal receipts:** supported in the UK (§10). Test on the real device once it arrives.
- **Stripe pricing:** 1.5% + 20p for standard UK cards, 2.8% + 20p for premium UK cards (§11.6).
- **200 Club 2027 settings:** **not there yet.** The dev database has only the 2026 row (£6, 100 numbers, 5 draws); production wasn't checked. GMC/Admin must add the 2027 season (£6) in `/200-club` before renewals open in January.
