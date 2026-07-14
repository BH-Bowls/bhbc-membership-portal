# BHBC Membership Portal — Full Code Review

**Date:** 4 July 2026 · **Scope:** entire repo (430 source files, ~112k lines, 198 API routes, 110 pages) · **Version reviewed:** 1.21.0 + unpushed `f653a1c`
**Method:** systematic sweep of all API routes against the middleware public-route list; targeted reads of auth, impersonation, sheet-write, and progression logic; pattern greps for role checks, row-addressed writes, and read bursts.

Findings are severity-ranked. Each has file references and a recommended fix.

> **Status update (5 Jul 2026):** C1, H1, H2 and H3 have been FIXED (uncommitted, pending test).
> C1 — token bypass scoped to the four token paths. H1 — all 12 routes now use role-utils.
> H2 — buddy impersonation blocked for elevated-role targets; admin checks multi-role aware
> (including canManageUser / canEditProfileField / canEditPaymentFields / getManageableUsers).
> H3 — verifyPassword is bcrypt-only (XOR + plaintext-temp paths deleted); temp passwords are
> now bcrypt-hashed at write in setTemporaryPassword and changePassword. NOTE: any temp
> password issued before this change and not yet used will no longer verify — reissue via
> forgot-password. Remaining open: M1–M4, L1–L6.

---

## CRITICAL

### C1. PIN-gate token bypass is global — exposes the full member contact list
**Where:** `middleware.ts:124` (`hasToken = req.nextUrl.searchParams.has('token')`), `app/api/members/lookup/route.ts`
**What:** The PIN-gate bypass added for tokenised email links (shipped in 1.19.0) triggers on **any** URL carrying a `?token=` param — the token is never validated in middleware. `/api/members/lookup` has **no session check at all** (it relies entirely on the PIN gate) and returns every member's **mobile, landline and email**. So a logged-out visitor can fetch:
`/api/members/lookup?filter=none&token=anything`
and receive the entire membership's contact details, PIN or no PIN. Every other public route is similarly PIN-bypassable, but members/lookup is the one leaking personal data.
**Honest note:** this bypass was introduced during the availability token-parity work this month (my change).
**Fix (small):** scope the bypass to the paths that actually consume tokens:
```ts
const tokenPaths = ['/friendlies/game/', '/api/friendlies/game/', '/availability/guest/', '/api/availability/guest/'];
const hasToken = req.nextUrl.searchParams.has('token') && tokenPaths.some(p => pathname.startsWith(p));
```
**Also consider (M4):** whether `/api/members/lookup` should require a session regardless — contact data is public today whenever `PUBLIC_ACCESS_PIN` is unset.

---

## HIGH

### H1. Exact-string role comparisons defeat the multi-role model (escalation + denial)
The app's roles are a comma-separated string with `hasRole()` in `src/lib/role-utils.ts` as the correct accessor — but ~12 API routes compare the raw string:

| File | Line | Problem |
|---|---|---|
| `app/api/rowland/[compId]/setup/route.ts` | 21 | `role !== 'Member' && role !== 'Club'` → **Kiosk** and any multi-role member (e.g. `Member,RowlandPlayer`) count as committee and can rewrite the Rowland bracket |
| `app/api/rowland/[compId]/route.ts` | 11 | same blocklist pattern |
| `app/api/rowland/[compId]/matches/[matchId]/route.ts` | 30–33 | same; Kiosk passes as committee |
| `app/api/rowland/[compId]/matches/[matchId]/score-sheet/route.ts` | 25–27 | same |
| `app/api/rowland/message/route.ts` | 26 | multi-role members pass; can set the public Rowland banner |
| `app/api/leagues/message/route.ts` | 25 | same |
| `app/api/competitions/message/route.ts` | 26 | blocklist **omits `Club`** — external club logins can set the competitions message (Club role is allowed through `/api/` by middleware) |
| `app/api/suggestions/[id]/attachments/route.ts` | 64 | `role !== 'Member'` → Kiosk *and* Club treated as committee |
| `app/api/suggestions/[id]/attachments/[attachmentId]/route.ts` | 97 | same |
| `app/api/invite-games/[id]/attachments/[attachmentId]/route.ts` | 92 | blocklist; Club/Kiosk pass |
| `app/api/leagues/route.ts` | 26 | `role !== 'Admin'` → a multi-role `Admin,Captain` is **denied** (functionality bug) |
| `app/api/competitions/[compId]/export-sheet/route.ts` | 25 | same denial |

**Why it matters most for Kiosk:** the kiosk is a shared, physically accessible terminal at the club — any member standing at it inherits these accidental committee powers.
**Fix:** replace every raw comparison with `hasRole(role, …)` / an `isCommitteeMember()` helper; add `Club`/`Kiosk` to explicit blocklists where a blocklist is genuinely wanted. One sweep, mechanical.

### H2. Buddy impersonation has no role ceiling
**Where:** `src/lib/buddies-sheets.ts:236` (`targetUser.buddyUserName === currentUserName → allow`)
**What:** if a privileged user (Admin, Captain, Treasurer…) lists an ordinary member as their buddy — natural in a family club — that member can impersonate them and inherit **full privileges**, including admin pages and APIs.
**Also:** `buddies-sheets.ts:225` uses exact `currentUserRole === 'Admin'`, so a multi-role `Admin,Captain` can't use admin impersonation (denial variant of H1).
**Fix:** in `canImpersonate`, refuse buddy-rule impersonation when the target holds any elevated role (or strip elevated roles from the impersonated session); switch the admin check to `hasRole`.

### H3. Legacy password tiers: plaintext temp + XOR hashes at rest
**Where:** `src/lib/auth-sheets.ts:106–124` (`verifyPassword`)
**What:** three verification tiers — bcrypt (good), **plaintext temp passwords stored in the sheet**, and **legacy XOR hashes**. Anyone with sheet access (committee, or a compromised service account) can read temp passwords directly; XOR is trivially breakable.
**Mitigations already present:** temp passwords force a change on login (middleware redirect), so the plaintext window is bounded.
**Fix:** on successful login with an XOR-verified password, rehash to bcrypt and write back (transparent migration); consider generating temp passwords as one-time links instead of sheet-stored strings. Low urgency, high hygiene value.

---

## MEDIUM

### M1. Client-supplied row numbers written without verification (systemic)
**Where:** 6 routes take `[rowNumber]` from the URL (`cleaning-rota`, `clubs/[clubName]/contacts`, `fixtures/manage/game`, `leagues/[leagueId]/squad`, `markers`, `tea-rota`), and 13 libs use `deleteDimension`; e.g. `updateFixture` (`src/lib/friendlies-sheets.ts:5185`) writes blind to the given row.
**What:** if rows shift between the client's read and its write (someone else deletes/inserts a row), the write lands on the **wrong record** — silent data corruption. Low frequency at club scale, but the failure mode is nasty.
**Fix pattern (already in the repo):** the tea-duty swap verifies the expected value at the target cell before writing (`friendlies-sheets.ts` ~4756: *"Cannot swap: you are not assigned"*). Apply the same verify-key-cell-before-write guard to the row-addressed update/delete paths, starting with deletes.

### M2. Remaining quota hotspots (post Members/Games caching)
- `app/api/friendlies/games/route.ts:87` — `Promise.all` of `getGameSheet(...)` per S-status game the user is selected in: a burst of uncached per-tab reads on every `/friendlies` load, per user.
- `app/api/competitions/my/route.ts` — reads per-competition match sheets (up to 11 reads/visit).
- `app/api/rowland/participants` + rowland detail — multiple reads per page (visible in your July logs).
**Fix:** short-TTL caches with the same fresh-on-write discipline as Games, or batchGet the per-comp sheets. Measure first — these may now be tolerable under the retry wrapper.

### M3. Four libs still bypass the Members cache
`src/lib/banking-sheets.ts:628`, `internal-games-sheets.ts:135,229`, `social-events-sheets.ts:134,220`, `suggestions-sheets.ts:357` read `Members!…` directly through the shared client instead of `getAllUsers()`. Low traffic, but each is a full-sheet read that could be free.

### M4. `/members` page + lookup API are public by design — confirm that's intended
With `PUBLIC_ACCESS_PIN` unset, member names **and contact details** are on the open internet (`middleware.ts:23` public pages list; C1 API). Even with the PIN set, it's one shared club-wide secret. Worth an explicit decision: require login for contact data, or accept the PIN as sufficient.

---

## LOW / HEALTH

- **L1. Next 16 deprecation:** `middleware.ts` convention is deprecated → rename to `proxy.ts` (warning on every dev boot).
- **L2. Duplicated infrastructure:** `getColumnLetter` ×8 files, `getColumnMap` ×6, two Sheets clients + two retry wrappers (`sheets.ts` vs `friendlies-sheets.ts`). Consolidating into one client/util module would have prevented several past bugs (cache bypass, invalidation gaps).
- **L3. Near-identical message routes:** `rowland/message`, `leagues/message`, `competitions/message` are copy-paste variants with drifted role checks (see H1) — unify into one helper.
- **L4. Role-name drift:** `'Super Admin'`, `'superadmin'` both special-cased (`buddies-sheets.ts:225`, `sweeping-rota/route.ts:42`); pick one canonical name in role-utils.
- **L5. `/api/friendlies/manage/players`** is session-only (all members can list players) — comment says intentional; confirm.
- **L6. Cache View counters are per-lambda** (documented on the page) — fine, just reiterating logs are the source of truth.

## What's in good shape (worth saying)
- **Default-deny middleware**: everything requires a session unless explicitly public; public write handlers all enforce their own 401s (verified all 31).
- **Guest surfaces are hardened**: availability guest routes have rate limiting + honeypot; friendlies token actions validate stored tokens server-side.
- **The caching layer** (Members 24h / Games 90s) has the right correctness carve-outs: auth reads, lock checks, and status-gating reads all bypass cache.
- **Competitions corrections** (new) gate winner-changes on the next round being unplayed — consistent with the sheet-integrity mindset the codebase needs.
- Data layers consistently normalise column maps; API routes follow a recognisable session → guard → data-layer → JSON shape.

## Suggested fix order
1. **C1** — scope the PIN token bypass (5-line middleware change). *Do this before anything else ships.*
2. **H1** — mechanical `hasRole` sweep of the 12 routes (also fixes the two admin-denial bugs).
3. **H2** — buddy impersonation role ceiling.
4. **M1** — verify-before-write on the row-addressed deletes first, updates second.
5. **H3 / M2 / M3** — as maintenance batches, measured against live quota logs.
