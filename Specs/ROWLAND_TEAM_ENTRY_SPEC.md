# Rowland Cup Team Entry — Full Implementation Spec

> Target codebase: BHBC Membership Portal (Next.js App Router, TypeScript, Postgres/Supabase)
> Read `CLAUDE.md`, `CODING_STANDARDS.md`, and `SCHEMA.md` before implementing anything.
> Rowland Cup match/bracket management is already on Postgres (`rowland_comps`/`rowland_matches`/`rowland_settings`,
> `src/lib/rowland-supabase.ts`) — this spec adds the entry/payment/contact side on top of that, and changes how
> the committee builds next season's draw as a result.

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Schema Changes](#2-schema-changes)
3. [Data Layer](#3-data-layer)
4. [Public Entry Form](#4-public-entry-form)
5. [Token-Based Status Page](#5-token-based-status-page)
6. [Draw Setup Changes](#6-draw-setup-changes)
7. [Bank Reconciliation](#7-bank-reconciliation)
8. [Email Templates](#8-email-templates)
9. [Config](#9-config)
10. [Build Order](#10-build-order)
11. [Open Questions / Deliberately Deferred](#11-open-questions--deliberately-deferred)

---

## 1. Feature Overview

Today, entering a club into the Rowland Cup happens by hand — the committee types a club's name (and, historically, its Sheets-only `club_id`) directly into the bracket when setting up the draw. This is the single biggest source of the "Southwick vs Southwick Park" class of error: nothing stops a typo, and there's no record of who to actually contact for a given team beyond guessing from a club's general contact list.

This feature replaces that with a proper entry step: a club submits their own teams (with a named contact per team), pays a combined entry fee by bank transfer, and the committee's existing draw-setup screen picks teams from that confirmed pool instead of free-typing club names.

**The flow, end to end:**

1. A club follows a link (from the public website, into the portal) to a Rowland entry form.
2. They pick their club from the existing directory (`club_profiles`), then say how many teams they're entering for **Edward** and how many for **Gladys** — 0, 1, or 2 each. Note: at this stage they are NOT choosing "A" or "B" — that split is a later, entirely manual decision by the tournament committee once entries close (see §6). The club is just saying "we want to enter 1 or 2 teams into the Edward trophy" / "...into the Gladys trophy".
3. For each team they're entering, they give a contact name, phone number, and email — the same contact can be reused across teams, or each team can have a different one.
4. They tick a box agreeing that contact's name and details can be shown to opponent clubs once drawn. **This is mandatory to submit** — without it there's no way to show an opponent who to contact, so an entry can't be accepted without agreeing.
5. On submit, they see a single combined payment amount (£16 × total teams entered, fee configurable — see §9) and BHBC's bank details, with a reference of `EGR {club name}` (see §7.1).
6. Each named contact receives a confirmation email with a link back to a status page for the team(s) they're the contact for — no login needed, matches the existing token pattern used for Friendly games (`FRIENDLY_TOKEN_AUTH_SPEC.md`). That link is revocable by the committee if an entry looks suspicious or payment never arrives.
7. The committee reconciles incoming bank payments against entries (§7), and a payment-received confirmation email goes out once matched.
8. Once entries close, the committee sorts the pool of entered teams into division A / division B for each trophy — a manual balancing decision, not something the app calculates (§6.1) — then runs the existing hat draw against that pool instead of typing club names in from scratch.
9. From then on, when a club views the bracket and looks up their next opponent, the contact shown comes from the entry that was placed into that bracket slot, not from `club_contact_profiles` (§6.3).

**Explicitly out of scope for this phase**, matching the original migration plan's steady-state design: nothing about *login* changes — this is entirely token-based, same as the rest of Rowland's public/guest access.

---

## 2. Schema Changes

New migration, next number after `0050_drop_member_email_sent_status.sql`.

```sql
-- One row per club that enters a season. Payment is tracked here, combined across
-- every team that club enters — see §7.1 for why it's one payment, not one per team.
create table if not exists rowland_entries (
  id                    uuid primary key default gen_random_uuid(),
  club_name             text not null references club_profiles(club_name),
  season                text not null,               -- e.g. '2027'
  consent_to_publish    boolean not null default false,
  submitted_at          timestamptz not null default now(),
  amount_due_pence      int not null default 0,        -- snapshot: teams-at-submission x fee-at-submission
  amount_received_pence int not null default 0,
  payment_status        text not null default 'Unpaid' check (payment_status in ('Unpaid', 'Partial', 'Paid')),
  payment_received_at   timestamptz,
  notes                 text,
  unique (club_name, season)
);

-- One row per team a club enters. This is the pool the committee's draw-setup picker
-- draws from (§6), and it's also where the contact for that specific team lives —
-- no separate "contacts" table, since a contact only ever exists in the context of
-- the team(s) they're attached to (see the reasoning in the spec discussion — keeping
-- contact fields directly on this row is simpler than a joined contacts table, at the
-- cost of retyping the same name/phone/email if one person covers more than one team).
create table if not exists rowland_team_entries (
  id                  uuid primary key default gen_random_uuid(),
  rowland_entry_id    uuid not null references rowland_entries(id) on delete cascade,
  trophy              text not null check (trophy in ('edward', 'gladys')),
  team_number         smallint not null check (team_number in (1, 2)),
  contact_name        text not null,
  contact_phone       text not null,
  contact_email       text not null,
  -- Filled in later by the committee's sorting step (§6.1) — null until then.
  assigned_comp_id    text references rowland_comps(comp_id),
  assigned_team_letter text not null default '',
  created_at          timestamptz not null default now(),
  unique (rowland_entry_id, trophy, team_number)
);

-- Each team-entry's own status-check link (§5). One token per team, not per person —
-- if the same contact covers 2 teams they get 2 links, bundled into one email (§8.1)
-- rather than needing a join table to model "one token, multiple teams".
create table if not exists rowland_access_tokens (
  token           text primary key,
  team_entry_id   uuid not null references rowland_team_entries(id) on delete cascade,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz
);

-- The durable link the committee's draw placement needs (see §6.3) — once a team is
-- placed into a bracket slot, the match remembers which entry it came from, so the
-- opponent-contact lookup never has to guess from a name. Nullable because matches
-- created any other way (manual override, a late replacement) won't have one.
alter table rowland_matches add column if not exists home_team_entry_id uuid references rowland_team_entries(id);
alter table rowland_matches add column if not exists away_team_entry_id uuid references rowland_team_entries(id);

create index if not exists rowland_team_entries_entry_id_idx on rowland_team_entries (rowland_entry_id);
create index if not exists rowland_access_tokens_team_entry_id_idx on rowland_access_tokens (team_entry_id);

alter table rowland_entries enable row level security;
alter table rowland_team_entries enable row level security;
alter table rowland_access_tokens enable row level security;
```

**Why `assigned_comp_id` lives on `rowland_team_entries` as well as the link on `rowland_matches`:** the committee's sorting step (§6.1) happens *before* the actual hat draw places a team into a specific bracket position — `assigned_comp_id` records "this team goes in the A bracket" as soon as that decision is made, so the sorting screen can show progress (how many assigned to A vs B so far) even before the draw itself runs. `home_team_entry_id`/`away_team_entry_id` on `rowland_matches` records the second, later step — the same team actually being drawn into position 3, say.

**Propagating the link through the bracket:** when a team advances to the next round (`propagateRowlandWinnerForMatch` in `rowland-supabase.ts`), the entry link must travel with it, not just the club name/letter — otherwise the "who's my opponent's contact" lookup only works in Round 1. `RowlandTeamRef` (`src/types/rowland.ts`) gains an optional `teamEntryId` field alongside `clubName`/`teamLetter`, and `updateRowlandMatch`/`propagateRowlandWinnerForMatch` carry it through exactly like the other team fields already do.

---

## 3. Data Layer

New file `src/lib/rowland-entries-supabase.ts` — kept separate from `rowland-supabase.ts` (which owns comps/matches/the home-page message), same separation already used between `renewals-supabase.ts` and `banking-supabase.ts`.

### 3.1 Submission

```typescript
export interface TeamEntryInput {
  trophy: 'edward' | 'gladys';
  teamNumber: 1 | 2;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
}

export interface SubmitRowlandEntryInput {
  clubName: string;
  season: string;
  consentToPublish: boolean;
  teams: TeamEntryInput[];   // 1-4 entries, unique per (trophy, teamNumber)
}

// Creates (or adds to, if the club already has an entry this season via their token —
// see §5) the rowland_entries row and its rowland_team_entries rows in one transaction.
// amount_due_pence is computed here from getRowlandEntryFeePence() x teams.length,
// snapshotted onto rowland_entries so a later config change never retroactively alters
// what an already-submitted club owes.
export async function submitRowlandEntry(input: SubmitRowlandEntryInput): Promise<{
  entryId: string;
  amountDuePence: number;
  paymentReference: string;   // 'EGR {club name}', see §7.1
}>;
```

### 3.2 Reads

```typescript
export async function getRowlandEntry(id: string): Promise<RowlandEntryWithTeams | null>;
export async function getRowlandEntryByClub(clubName: string, season: string): Promise<RowlandEntryWithTeams | null>;

// The pool the draw-setup picker (§6) reads from — every team-entry for a trophy this
// season that hasn't been assigned to a bracket yet (or all of them, with their current
// assignment shown, depending on the UI — see §6.1).
export async function getUnassignedTeamEntries(trophy: 'edward' | 'gladys', season: string): Promise<TeamEntryWithClub[]>;
```

### 3.3 Committee actions

```typescript
// Sorting step (§6.1) — records which bracket division a team-entry has been assigned
// to. Does not touch rowland_matches at all; that only happens once the hat draw
// itself places the team into a specific slot (§6.2/6.3).
export async function assignTeamEntryToComp(teamEntryId: string, compId: RowlandCompId): Promise<void>;
```

### 3.4 Token resolution (§5)

```typescript
export async function createAccessToken(teamEntryId: string, expiresAt: string): Promise<string>;
export async function resolveAccessToken(token: string): Promise<TeamEntryWithClub | null>;  // null if missing/expired/revoked
export async function revokeAccessToken(token: string): Promise<void>;
```

---

## 4. Public Entry Form

New page, `app/rowland/enter/page.tsx`, route `/rowland/enter`. Public, no auth — already covered by `/rowland*`'s existing `PUBLIC_ACCESS_PIN` exemption (`isPinExempt()` in `middleware.ts`), but confirm this explicitly during build (§10) rather than assume.

**Form fields:**
1. Club — a searchable select against `club_profiles.club_name` (the same list `/api/rowland/clubs` already returns), not free text. If a club isn't in the directory yet, that's a Clubs-admin task first, out of scope here.
2. "How many teams for Edward?" / "How many teams for Gladys?" — 0/1/2 each.
3. For each team implied by the counts above, a contact block (name/phone/email) with a "same as [previous team]" convenience option to avoid retyping.
4. The consent checkbox — required, cannot submit without it (§1 step 4).
5. Hidden honeypot field, matching the existing `/api/apply` pattern exactly (`website` field, silently returns `{ success: true }` if filled — see `app/api/apply/route.ts`).
6. Simple IP-based rate limiting, same in-memory `Map`-based approach as `/api/apply` (`RATE_LIMIT_MINUTES`).

**On submit**, `POST /api/rowland/enter`:
- Validates the club exists, at least one team was entered, consent is ticked (reject server-side even if the client somehow allowed it through).
- Calls `submitRowlandEntry`.
- Creates an access token per team-entry (`createAccessToken`, expiring end-of-season — see §9 for the exact date).
- Groups newly-created team-entries by `contactEmail` and sends one confirmation email per unique address (§8.1), each listing every team that address is the contact for and its own status link(s).
- Returns the payment amount/reference so the confirmation page can show it immediately without waiting on email delivery.

---

## 5. Token-Based Status Page

New page `app/rowland/enter/status/page.tsx`, route `/rowland/enter/status?token=...` — same "lazy token, no login, resolved server-side per request" pattern as `FRIENDLY_TOKEN_AUTH_SPEC.md`.

Shows: which team (trophy + which of their club's teams this is), the contact details on file, and payment status for the whole club entry (since payment is combined — a contact for just one of a club's four teams still needs to see whether the club's overall payment has been received, not a meaningless per-team figure).

**Revocation:** an admin-only action (`revokeAccessToken`) sets `revoked_at`; a revoked token's status page shows a generic "this link is no longer valid, contact BHBC" message, matching the tone of the closed-club-login message already in place for Rowland (`Phase_0_1_Migration_Plan.md`'s club-login-closure design).

---

## 6. Draw Setup Changes

### 6.1 Sorting entries into A / B

A new section/tab on `app/rowland/admin/page.tsx` — that page already exists (a pre-existing per-competition admin overview, linked from the Navbar's "Rowland Admin" item) and gained an "Entries" tab when §3/§4 were built, alongside its original "Competitions" tab. This step would most naturally be a third tab there, or folded into "Entries". Shows the full pool of entered teams for a trophy, grouped by trophy, with a simple "assign to A" / "assign to B" action per team-entry (calls `assignTeamEntryToComp`). This is a manual, judgement-based step — the app does not attempt to balance the two sides automatically. It exists purely so the pool is sorted before the next step.

### 6.2 The existing hat draw, now fed by entries

`app/rowland/[compId]/setup/page.tsx`'s `ClubSelect` component currently searches all of `club_profiles`. It changes to instead search only `rowland_team_entries` rows already `assigned_comp_id`'d to this specific `compId` (via `getUnassignedTeamEntries`, filtered) — the committee can only place a team that's both entered *and* already sorted into this division. Picking one calls `setupRowlandBracket`/`updateRowlandMatch` exactly as today, but now also writes `home_team_entry_id`/`away_team_entry_id` (§6.3) alongside the club name and letter.

`assigned_team_letter` on `rowland_team_entries` gets set at the same moment, matching whatever letter the match ends up using — needed for display consistency if the same club has two teams in the same division.

### 6.3 Opponent contact lookup

`app/api/rowland/[compId]/next-match/route.ts` currently resolves an opponent's contact via `getContactsForClub()` (`club_contact_profiles`), filtered by a `CONTACT_ROLE_PREFIX` guess (`"ERowland A"`, `"GRowland B"`, etc.). That entire lookup is replaced: given the opponent match's `home_team_entry_id`/`away_team_entry_id` (whichever side isn't the requesting club), fetch that `rowland_team_entries` row directly and return its `contact_name`/`contact_phone`/`contact_email` — no role-string matching needed at all, and no possibility of showing the wrong person's details. If the link is null (a match with no entry behind it — shouldn't happen for anything drawn through this system, but matches created any other way), fall back to showing no contact rather than guessing.

---

## 7. Bank Reconciliation

Modelled on the existing Renewals bank rec (`src/lib/banking-supabase.ts`, `src/lib/banking-match.ts`) — same shape (a list of bank payments matched against the thing they're paying for), but its own version, since the existing matching logic is tuned to member surnames, not club names.

### 7.1 Reference format: a fixed `EGR` prefix + club name, no per-trophy suffix

Every club makes exactly **one combined payment** covering everything they entered that season — 4 teams entered means one £64 transfer, 1 team for Edward and 1 for Gladys means one £32 transfer. There's never a reason to split it by trophy, so the reference is `EGR {club name}` (e.g. `EGR Lands End Bowls Club`) — the same fixed `EGR` prefix on every entry, never varying by which trophy(s) a club actually entered. This still sidesteps the matching problem a per-trophy suffix would cause: banks frequently show initialised or abbreviated versions of a club's own name in the reference text (e.g. a payer typing "BHBC" instead of "Burgess Hill Bowls Club") — a fixed, known prefix gives the fuzzy matching in §7.2 a reliable anchor to search on (strip `EGR`, fuzzy-match what's left against `club_profiles.club_name`) without also risking a club getting a *variable* `ER`/`GR` suffix wrong or omitted, which is what the original "no suffix at all" version of this section was avoiding.

### 7.2 New table and matching

```sql
create table if not exists rowland_payments (
  id                      uuid primary key default gen_random_uuid(),
  date                    date not null,
  type                    text not null check (type in ('TRF', 'CDM', 'CHQ', 'CSH')),
  reference               text not null default '',
  amount_pence            int not null,
  status                  text not null default 'Unmatched' check (status in ('Unmatched', 'Matched', 'Deleted')),
  matched_rowland_entry_id uuid references rowland_entries(id),
  created_at              timestamptz not null default now()
);

alter table rowland_payments enable row level security;
```

One payment matches at most one `rowland_entries` row (unlike Renewals' `matched_users`, which can be a list — a single combined club payment never needs to split across multiple entries), so `matched_rowland_entry_id` is a plain nullable FK rather than a text list.

**Matching logic**, new `src/lib/rowland-payment-match.ts`: reuse `banking-match.ts`'s significant-word extraction approach (`extractSignificantWords`/`countMatchingWords`) scored against `club_profiles.club_name`, since club-name abbreviations (BHBC-style) need the same tolerant word matching member-surname references already need. Present ranked suggestions on a reconciliation screen (`app/rowland/admin/bank-rec/page.tsx`), let the admin confirm or manually search — same UX as the existing Renewals screen. On confirming a match, update the matched `rowland_entries.amount_received_pence`/`payment_status`/`payment_received_at`, and trigger the payment-received email (§8.2).

---

## 8. Email Templates

New templates under `src/lib/email/templates/`, following the existing visual style (`application-payment-request.html` as the closest precedent — same bank details, same layout).

### 8.1 `rowland-entry-confirmation.html`

Sent once per unique contact email at submission time (§4). Lists every team that address is the contact for (trophy + which team number), the club's total amount due, payment details (bank/sort code/account/reference — `EGR {club name}`, §7.1), the entry deadline (§9), and a status-check link per team-entry the contact covers.

### 8.2 `rowland-payment-received.html`

Sent when bank rec (§7.2) matches a payment and marks a `rowland_entries` row `Paid` (or the amount received reaches the amount due). Simple confirmation, no action needed — mirrors the "we'll add a payment received email" intent from the original design conversation, same spirit as a renewal payment-received notice.

---

## 9. Config

Two new keys in the existing `config` table (`getConfig`/`updateConfig`, `src/lib/config-supabase.ts`), no schema change needed:

| Key | Example value | Used by |
|---|---|---|
| `rowland_entry_fee` | `16.00` | `submitRowlandEntry`'s `amount_due_pence` calculation (pounds, parsed and converted to pence) |
| `rowland_entry_deadline` | `2027-02-28` | Shown on the entry form and in the confirmation email; also a reasonable `expires_at` default for access tokens (§2) |

`rowland_entry_deadline` wasn't explicitly requested as configurable — flagging it as an assumption, not a silent decision: it seemed natural to treat the same way as the fee rather than hardcode a date that changes every season, but easy to drop back to a hardcoded string if that's not wanted.

---

## 10. Build Order

1. Migration (§2) — `rowland_entries`, `rowland_team_entries`, `rowland_access_tokens`, `rowland_payments`, plus the two new nullable columns on `rowland_matches`. Verify against Dev before anything else, same pattern as every other migration this project.
2. `rowland-entries-supabase.ts` data layer (§3), verified standalone against Dev before any route exists (matches this project's established "verify before wiring in" pattern).
3. Public entry form + submit route (§4) — the highest-value piece on its own, usable even before draw-setup integration changes.
4. Confirmation + payment-received email templates (§8).
5. Token status page (§5).
6. Bank reconciliation (§7) — its own screen, its own table, can ship independently of the draw-setup changes.
7. Draw-setup integration (§6) — sorting screen, `ClubSelect` swap, opponent-contact lookup swap. Last, since it depends on entries already existing for the season being drawn, and — per the earlier conversation — this season's already-migrated bracket data will never be redrawn, so there's no urgency forcing this ahead of the entry form itself.
8. Confirm `/rowland/enter` and `/rowland/enter/status` are covered by the existing `PUBLIC_ACCESS_PIN` exemption (`isPinExempt()` in `middleware.ts`) — don't assume the `/rowland*` prefix exemption automatically covers a new subpath without checking.

---

## 11. Open Questions / Deliberately Deferred

- **Withdrawing/editing an entry after submission** — a club realising they entered the wrong number of teams, or needing to withdraw one, isn't designed yet. Minimal fix for now: they can return via their token and BHBC can adjust manually; a self-service edit flow is a future addition, not blocking.
- **What happens to a fully-unpaid entry by the deadline** — not decided. The original design conversation raised "unpaid-entry outcome" as open; this spec doesn't resolve it. Likely a manual committee call (revoke the token, exclude from the draw) rather than an automated cutoff, but worth confirming before build.
- **Whether an admin review/approval step exists before an entry counts as "in"** — not built here; as submitted, an entry is immediately eligible for the draw once payment is confirmed, no separate approval gate. Flagged in case that's not the intent.
