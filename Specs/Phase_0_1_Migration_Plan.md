# Postgres Migration — Phase 0 & Phase 1 Plan

**Provenance:** the original draft of this plan was produced on claude.ai without access to this repository. It was first corrected against the live codebase and `specs/SCHEMA.md` (Claude Code, full-repo audit, 2026-07-27). A second, much longer claude.ai conversation (`specs/Planning_next_year_s_fixture_contacts.md`, exported 2026-07-28) then worked through the actual schema architecture, the Season Planning feature, and the Rowland/club-login redesign in much greater depth — that conversation is now the primary source for the architectural decisions below, superseding the first-pass corrections where the two disagree. **That second conversation never had repo access either** — a fresh Phase 0 audit (Claude Code, 2026-07-29) has since independently verified every code-level claim it introduced against the live source; corrections found are folded in below, marked where they diverge from what was assumed. Corrections and later refinements are folded directly into the plan rather than kept as a separate errata list — treat this as the current plan, not a diff.

**Purpose:** Phase 0 is an audit task, largely completed via direct codebase inspection. A small number of items remain genuinely open — either because they require live spreadsheet inspection Claude Code can't do unprompted, or because they're product decisions — marked **OPEN** below. Phase 1 is schema design + migration for Config, Users, Members, Clubs & Contacts, and core Games, in that order (see Migration Sequencing).

---

## Key architectural decision: `users` (UUID) + `member_profiles`, not a single `members` table

An earlier pass of this plan (2026-07-27) settled on a single `members` table keyed on `user_name` (text), specifically to avoid rewriting the ~15+ places in the live codebase that already treat `user_name` as the natural identifier. That decision has been **reversed** after working through two things that only became clear later:

**1. Kiosk and Captain are shared logins, not members — and today they're forced to exist as dummy rows in the Members sheet, polluting every member lookup.** A single wide `members` table with `account_type = 'shared'` for Kiosk/Captain would carry that exact problem straight into Postgres: two rows sitting among real members, ~55 of their ~60 columns meaningless. Splitting `users` (login mechanics only) from `member_profiles` (the ~60 domain columns) fixes this structurally — Kiosk/Captain get a `users` row and **no `member_profiles` row at all**, so they cannot appear in a member lookup; there's nothing there to return.

**2. Club login is being removed entirely** (see the dedicated section below), not just closed. That removes the only other reason a wide, multi-purpose auth table felt necessary — `clubs`/`club_contacts` becomes pure reference data with no login fields, no `account_type = 'club'`.

**Does the split reopen the ~15-reference rewrite risk?** No. `username` stays the natural key everywhere outside the `users`/`member_profiles` pair. `game_players.user_name`, `buddy_user_name`, `captain_username`, `CleaningRota`, `locked_by`, `last_modified_by`, etc. all keep storing plain text usernames — unchanged from how the app already works — they just gain a real foreign-key constraint against `users(username)` instead of being unenforced soft references, as they are in Sheets today.

**UUID vs. text primary key on `users` itself** was a genuine open question — a text `username` primary key is simpler and needs no join for the common "look up by username" case. It was settled by one concrete fact: **a member has changed their username once already** (reverting to a maiden name after divorce). With `users.id` as an immutable UUID and `username` as a separate unique-but-mutable column, that kind of change is a single-row `update users set username = ... where id = ...` with zero blast radius — nothing else needs to be touched. With a text primary key, every other table storing that username needs an explicit `on update cascade` foreign key to avoid silently breaking. **Decision: UUID `users.id`, with real `on update cascade` foreign keys from every other table's `user_name`/`username`-shaped column to `users(username)`** — so a rename cascades automatically in one transaction, something the current Sheets system cannot do at all (today, a rename means manually finding and editing every sheet by hand).

**The `username` column itself is not renamed to anything like `member_id`.** It isn't always a member (Kiosk/Captain use it too), and it isn't really an "id" — `users.id` already owns that meaning as the true immutable key. Same name, same meaning as today, just backed by real integrity underneath.

```sql
create table users (
  id                  uuid primary key default gen_random_uuid(),
  username            text not null unique,
  password_hash       text not null,
  is_temp_password    boolean not null default false,
  account_type        text not null check (account_type in ('member','shared')),
  is_active           boolean not null default true,   -- Leavers replacement, see Step 2
  last_login_at       timestamptz,
  reset_token         text,
  reset_token_expires timestamptz,
  created_at          timestamptz not null default now()
);

create table user_roles (             -- replaces the comma-separated `role` string column
  user_id  uuid references users(id) on delete cascade,
  role     text not null,             -- 'Captain','Admin','GMC',...
  primary key (user_id, role)
);
```

`account_type = 'shared'` is deliberately generic (matches `SCHEMA.md` §10.2's own suggestion to replace the comma-separated role column). Captain and Kiosk are the complete set *today*, but a future shared login (a Bar duty login, say) is just a new `users` row with `account_type = 'shared'` — no schema change. **Confirmed 2026-07-29: Captain has no code marker by design, not by oversight** — it's an ordinary `Members`-row login (username `captains`, role `Captain`) used on a shared club computer; every captain also has their own personal login on their own device. Kiosk is the only one with a code-level special case (username `clubhouse`, `src/lib/auth.ts:217`) because it needed one for something else entirely — there's no general mechanism distinguishing "shared" logins in code today, which is exactly the gap `account_type = 'shared'` is introducing. **Practical implication for the migration script:** identifying which `users` rows get `account_type = 'shared'` (`captains`, `clubhouse`) is a manual/config-driven step (a short list of known shared usernames), not something derivable from any existing flag or pattern in the data. Two behaviours of shared logins carry forward unchanged from Sheets, not as regressions:

- **Attribution gets coarser on shared logins.** Anything recording "who did this" (`last_modified_by`, `locked_by`, `ImpersonationLog`) shows `captain`, not a real person, when used from the shared account — already exactly how it works today.
- **Session lifetime for "always logged in" shared devices** needs a deliberate decision (carry the normal expiry, or an explicit exemption for `account_type = 'shared'`) rather than falling out accidentally. **Verified 2026-07-29: the actual enforced expiry is 45-day inactivity / 90-day absolute** (`src/lib/auth.ts:264` sets `maxAge: 45 * 24 * 60 * 60`; the 90-day absolute ceiling is enforced separately at `auth.ts:213,221-228`) — not "30-day" as an earlier pass of this plan assumed. That 30-day figure traced back to a stale doc comment (`auth.ts:16`) that doesn't match the real `maxAge` three lines below it; worth fixing that comment while this code is being touched anyway, independent of the migration itself.

**Login by username or email** — confirmed most members already log in by email, not username; only a few use username. The query has to check both `users.username` and `member_profiles.email_address`:

```sql
select u.*
from users u
left join member_profiles mp on mp.user_id = u.id
where u.username = $1 or mp.email_address = $1;
```

**Email is deliberately not duplicated onto `users`** — same reasoning `SCHEMA.md` §10.8 already applies to `full_name`: a second copy is a sync-risk waiting to happen (miss one of the several code paths that update email — `profile-sheets.ts`, admin edits, onboarding — and login silently breaks while the profile looks correct), and the join costs nothing at this data volume (hundreds of members, occasional logins, not a hot path). Two follow-ons this makes necessary, since email login is the common case here, not a rare fallback:

- **Ambiguity handling.** `email_address` is nullable and not guaranteed unique (confirmed per `SCHEMA.md`) — a shared household email, most often partners but also (per your steer) parents sharing an email with children, mainly grandkids. If the email matches more than one row, don't attempt a password check against any of them — return a generic **"This email is linked to more than one account. Please log in with your username instead."** Don't name or hint at the username in that message — revealing which usernames exist to someone who's only proven they know an email address is a small but real information leak. Club contacts are **not** part of this concern — Rowland access is entirely token-based (see below), not login-based, so there's no club-side email-ambiguity case to design for.
- **Index `member_profiles.email_address`**, since this query now runs on most login attempts, not occasionally.
- **~6 members have no email address at all** (per your count) — for them, username is the *only* way to log in, not a fallback. Already handled correctly by the `username = $1 or email = $1` query design (no email means that side of the `or` just never matches), but worth an explicit test case in the pre-merge checklist — a no-email account is a real, current scenario, not an edge case to deprioritise.

`src/lib/auth-sheets.ts` (`findUserByIdentifier`, `authenticateUser`, `SharedEmailError`) already implements the shape of this logic today — port the pattern, adjusted for the new two-table join, don't redesign it from scratch.

**Phase 0, resolved 2026-07-29 (ballpark, not a formal count):** roughly **20–30 members across 10–15 shared-email households** will hit the disambiguation path, per your own estimate — mainly partners, but also parents sharing an email with (mainly grandchild) children. Good enough to plan around; a precise query against the live sheet before cutover would firm this up further but isn't blocking.

---

## Phase 0 — Audit: what's been confirmed, what's still open

- ~~Gmail Labels formula mapping~~ — **resolved 2026-07-29**, formula and full column-to-field mapping now in Step 2.
- ~~Duplicate-email audit~~ — **resolved 2026-07-29** (above), ~20-30 members / 10-15 households, your own estimate, good enough to plan around.
- **`CODING_STANDARDS.md` §21 violations exist today and must be brought into scope.** ~14 route files call `spreadsheets.values.*` directly, bypassing the data layer. Four touch **Members** specifically: `app/api/banking/report/route.ts`, `app/api/friendlies/stats/route.ts`, `app/api/friendlies/match-card/[tabDate]/route.ts`, `app/api/friendlies/manage/player-stats/route.ts`. These break outright once Members moves to Postgres — mandatory Step 2 scope, not optional cleanup.
- **`sheets.ts` is not the single touch point for Members data, but the independent-access surface is narrower than first assumed.** `getAllUsers()`/`getUserByUsername()`/auth all route through it. **Verified 2026-07-29, corrected:** of the six files originally suspected, only three genuinely maintain their own independent Members access — `profile-sheets.ts:182` (own `getColumnMap('Members')` call), `banking-sheets.ts:625` (same), and `data-export.ts` (its own `SHEET_REGISTRY`-driven schema/fetch path, `Members` entry with `joinKey: 'user_name'`). The other three already route through `sheets.ts`'s shared functions rather than maintaining a parallel column map: `buddies-sheets.ts` imports `getUserByUsername`/`getAllUsers` directly (no raw Sheets calls at all); `renewals-sheets.ts`'s own `getColumnMap` calls are for the *Renewals* sheet, not Members — its Members writes go through `sheets.ts`'s shared `updateEmailSentStatus()`; `competitions-sheets.ts`'s `CompMemberInfo` projection (`getMemberInfoMap()`) is built entirely from `getAllUsers()`, no independent column map. **No separate "Phase 0.5: consolidate everything onto `sheets.ts` first" step is worth doing** — it would mean designing the same granular functions twice, once against Sheets and again against Postgres, for no benefit. Design the new data-layer functions once, and update `profile-sheets.ts`, `banking-sheets.ts`, and `data-export.ts` as the three real call sites needing a coordinated swap, alongside `sheets.ts` itself — a smaller, more precise Step 2 scope than originally estimated.

---

## Club login removal & Rowland access redesign

This whole area changed shape substantially from the original plan, which only proposed *closing* club login as Rowland wound down. The actual decision is to **remove the concept of club login entirely**, including "impersonate as club" — Club-role login exists purely to record Rowland results, `/clubs` itself sees negligible real use, and `RowlandOrganiser` already has direct edit rights on any match via admin routes, so impersonation was never actually needed for legitimate troubleshooting, only for pretending-to-be-a-club testing.

**Worth knowing before removing it: the club forgot-password flow was never fully wired up anyway.** Verified 2026-07-29: the Clubs sheet does have `password_reset_token`/`password_reset_expires` columns (per `SCHEMA.md`), but a full-repo grep found **zero code references to either column** — no club-specific reset route exists today. That's part of the pain you already named (a club with a forgotten shared password has no self-service recovery path, only you resetting it and affecting everyone) — removing club login isn't walking back a working feature, it's removing a half-built one.

### Immediate: Sheets-based closure bridge (no Postgres dependency, ships independently)

A config flag (`rowland_club_login_closed`) plus a middleware gate, **not tied to a specific date** — triggered whenever this gets deployed, not a hard deadline. Two implementation details worth getting right:

1. **`/clublogin` is excluded from `middleware.ts`'s route matcher entirely** — middleware never runs on that page today. The flag check needs to live in `authenticateClub()` (`clubs-sheets.ts`) or the `/clublogin` route directly, not solely in middleware.
2. **Cookie-clear timing** — `req.nextauth.token` is parsed before the custom `middleware()` body runs, so clearing the session cookie only takes effect on the *next* request. The existing Club-role restriction block (`middleware.ts`, redirects non-`/rowland`/`/clubs`/etc. to `/clubs`) will still fire on the same request unless the new gate runs and short-circuits ahead of it.

**Behaviour, split by what's being hit:**

- **Any page/API request carrying an active Club-role session** (flag on) → middleware **clears the session cookie** (silent sign-out). For page requests, continues through to `/rowland` as an anonymous visitor — already public, already works today. No error, no dead end.
- **Landing directly on `/clublogin`** (no session, or one just cleared) → shows **"Rowland results are now closed — please contact the Rowland Organiser."**
- **API write attempts** (submitting a score) with an active Club-role session → can't redirect a `fetch` call, so returns **401/403** with the closure message as the body.

Worth keeping two "token" concepts distinct in implementation: this is clearing the **NextAuth session cookie** — a different mechanism from the **Rowland per-contact access token** below. `middleware.ts` already has a directly reusable pattern for the exemption itself: `PUBLIC_ACCESS_PIN`'s `isPinExempt()` helper already exempts `/rowland*` and guest-token paths the same way.

**This is explicitly a temporary bridge, not permanent infrastructure** — it becomes redundant the moment club login is removed for good via the steady-state design below, and isn't meant to be generalised into a reusable "wind down access" mechanism for other cases.

### Steady state: Rowland contact tokens (documented, deferred — not part of Phase 1 execution)

Replaces club login for Rowland entirely. Reuses the pattern already committed to in `specs/FRIENDLY_TOKEN_AUTH_SPEC.md` (lazy token, no login, resolved server-side per request) rather than inventing a new mechanism.

**Why not a login at all:** Rowland contacts churn every year — maintaining `users` rows that need creating/deactivating annually is exactly the kind of account-lifecycle overhead a token sidesteps. A token ties access directly to that season's contact + competition assignment; next season, fresh contacts, fresh tokens, old ones simply stop mattering.

```sql
create table rowland_contacts (
  id          uuid primary key default gen_random_uuid(),
  season      int not null,
  club_name   text not null references club_profiles(club_name),
  first_name text, last_name text, email text,
  notes       text
);

create table rowland_contact_comps (       -- same person, multiple competitions — no row duplication
  rowland_contact_id  uuid references rowland_contacts(id) on delete cascade,
  comp_id             text not null,       -- 'edward-a','edward-b','gladys-a','gladys-b'
  primary key (rowland_contact_id, comp_id)
);

create table rowland_access_tokens (
  id                  uuid primary key default gen_random_uuid(),
  rowland_contact_id  uuid not null references rowland_contacts(id) on delete cascade,
  token               text not null unique,
  expires_at          timestamptz,          -- naturally end-of-season
  revoked_at          timestamptz
);
```

**The token, once resolved, gates exactly what Club login gates today:** viewing the draw (already public), their next match + opponent contacts (existing `next-match?clubId=` route, `clubId` resolved from the token instead of a session), and entering a score (write checks the token's `club_name` is genuinely one of the two sides on that match).

**Bootstrap vs. steady state — a real gap, not assumed away.** This year's Rowland contacts have to be loaded as a one-time manual seed, since the self-service entry feature doesn't exist yet. From next year, a new **team-entry feature on the public website** becomes the actual collection point: clubs enter their team for next year's competition, provide contact details there, and that's when `rowland_contacts` rows and tokens get created — at which point manual entry stops being needed.

**A separate, related standalone contact list — `rowland_contacts` is deliberately not merged with `club_contact_profiles`, even when the same physical person appears in both.** A club's Match Secretary might use `fixtures@theirclub.com` for regular match-day business but a personal email for Rowland correspondence — that's a genuine, deliberate distinction someone made, not duplication to clean up. Don't attempt fuzzy-matching the two lists into a single "canonical contact" — unreliable, and there's no clear payoff.

**Two things noted as open, not blocking:** whether Rowland results specifically need a lightweight "entered via token, not a logged-in session" flag on the match row, given it affects standings rather than just attendance; and that a fixtures-secretary-style contact wanting a *real* login later (rather than a token) doesn't need a third mechanism — it's just `club_contact_profiles` gaining login fields whenever that's actually wanted, independent of the token system.

### `club_id` is dropped from the schema entirely

Its only purpose was "short login identifier for a club account" — gone once club login is gone. `club_name` (already the live natural key everywhere — Games, Rowland, Contacts) becomes the sole identifier; Postgres has no issue with `@`/`&` in a text primary key (`Brighton @Preston`, `East Preston & Kingston` confirmed fine). `RowlandMatch.home_club_id`/`away_club_id` (Sheet column names in `rowland-sheets.ts`; the app-level type nests this as `homeTeam.clubId`/`awayTeam.clubId`) become `home_club_name`/`away_club_name`.

---

## Caching & Egress Strategy

Confirmed free tier (verified July 2026): 500MB database, 5GB/month egress, 1GB file storage, 50,000 MAU, unlimited API requests, 2 active project cap, auto-pauses after a week of inactivity.

**This is a genuinely different constraint than Sheets gave, not a bigger version of it.** Sheets' problem was a *rate* limit (~100 requests/100s) — too many calls too quickly, which is why `withRetry` backoff exists. Supabase's free tier has unlimited requests; the real constraint is **total bytes moved per month**, regardless of request count. A single large result set costs more than a thousand small ones. The auto-pause-after-a-week is a separate thing worth knowing — if usage genuinely drops over winter, the project could pause, meaning a cold-start delay the first time someone opens the portal in spring.

**Is 5GB actually tight?** The risk isn't total data volume, it's *repetition* — `PROJECT_OVERVIEW.md` §11 already flags `getAllUsers()` fetching the entire Members sheet on every call; if that pattern carries over unchanged, a few hundred KB per fetch, multiplied across dozens of page loads a day, adds up faster than it sounds.

**What carries forward, adjusted for the real constraint:**

- **Select only the columns actually needed, every time** — a genuine Postgres advantage over Sheets (a range read always pulled every column; a Postgres/PostgREST query can ask for exactly `username, full_name, handicap`). Worth being an explicit rule in the new data-layer functions.
- **Extend the existing TTL-cache philosophy** (diary's per-user 48-hour cache, announcements' 30-minute shared cache) to Members list, Clubs list, config values — a cache hit costs zero egress, same as it costs zero Sheets-quota today.
- **The column-map cache's in-process, per-instance limitation carries forward unchanged** — on Vercel's serverless model, different invocations may not share memory at all. If egress does creep up in practice, a shared cache layer (Vercel KV or Upstash Redis, both have free tiers) is the proper fix — treat as "have ready if needed," not built speculatively on day one.
- **Monitor for real** — Supabase's dashboard shows egress directly; check it deliberately in the first few weeks post-launch.

---

## Dev/Test Environment Strategy

**Decided 2026-07-30. This is permanent infrastructure, not a migration-build tool** — it needs to keep working indefinitely for testing ordinary new feature work long after Phase 1 is complete and Members/Clubs/Games are fully on Postgres, not just during the migration itself. Sheets never allowed a real test environment — there's only ever one spreadsheet, so "test in a copy" was never actually possible, only "test carefully in prod." Postgres fixes this properly, permanently:

**A second Supabase project as Dev/Test**, using the free tier's 2-project allowance deliberately (one Prod, one Dev). Own connection string, own env vars. Maps directly onto the Vercel preview-branch workflow already in place (`CLAUDE.md`: feature branches → isolated preview URLs, always test on a preview before merging to `main`) — preview deployments point at Dev's credentials, `main`/production points at Prod's.

**Dev is seeded from a redacted copy of real data, refreshable on demand, not a one-off snapshot.** A script (not a manual process — build this as real tooling alongside Step 0, since it's needed from day one and every day after) has two source modes, used at different times but built as the same tool from the start:

- **Pre-cutover (during the Phase 1 migration itself):** reads from live Sheets, same read logic the actual migration script uses.
- **Post-cutover (permanent, ongoing steady state):** reads from Prod Postgres directly — this is the mode that matters for the long run, used every time any future feature needs a fresh, realistic, safe-to-break dataset to develop and test against, indefinitely.

Either way it **wipes and re-seeds Dev from scratch each time it's run** — full wipe-and-reseed rather than diffing/upserting, since Dev is disposable test data and this avoids any partial-state drift between runs, whether that run happens during Step 2 next month or for some unrelated feature two years from now. Two transforms applied unconditionally on every refresh, never optional:

- **`email_address` cycled deterministically across a fixed set of your own owned aliases** (`liamBH1@dasey.org.uk` … `liamBH9@dasey.org.uk`, cycling by row so every real address is replaced) — this is the actual safety property: **no real member email address ever exists in the Dev database**, so any email-sending code path exercised during testing (renewal reminders, password resets, bulk sends, application confirmations) can only ever land in a mailbox you control, even if the code under test is broken. Applies to every table holding an email — `member_profiles`, `applications`, `club_contact_profiles`.
- **`password_hash` overwritten with a single shared, known test-password hash** for every row — real hashes are one-way (bcrypt), so without this no seeded account could actually be logged into during testing.

**Lower priority, worth doing while the script exists but not the core safety property:** redacting `mobile`/`landline` too, since there's no reason test data needs real phone numbers (this app has no SMS-sending feature, so the "never contact a real person" guarantee is specifically about email — phone redaction here is general data hygiene, not a functional necessity).

**Schema changes become versioned migration files, applied to Dev first, then Prod** — not ad hoc edits run by hand against whichever database. This is also the answer to "does every change need to go in this plan document": individual schema tweaks going forward (like the `worker_additional_info` column added above) don't need updating here indefinitely — this document covers the one-time Phase 0/1 migration itself; once that's done, ongoing schema evolution is "add a migration file, apply to Dev, verify, apply to Prod," normal engineering rather than a planning-document update.

**Migration-branch deployments must point at Dev, never Prod.** Vercel supports separate env vars per deployment type (Production / Preview / Development). The migration work branch's **Preview** environment variables need to be set to the Dev Supabase project's credentials before the first push — otherwise a preview build could read or write real data through what's meant to be the safe sandbox. Confirm this in Vercel's project settings before pushing, not after. `main`'s Production env vars stay pointed at Sheets (and, later, Prod Postgres) throughout — the migration branch's preview deployments are fully isolated from production either way, per the existing branch/deploy workflow (`specs/CLAUDE.md`).

---

## Migration Sequencing

**Config + Maintenance Mode → Users → Members (`member_profiles`) → Clubs & Contacts → Games**, in that order — your explicit ordering, and it matches the dependency chain exactly: Config has nothing pointing at it; Users has nothing pointing at *it* either (it's what everything else references); Members/Clubs build on Users; Games needs all four to exist first (`captain_username` → users, `club_name` → clubs, player entries → members/users). No step needs revisiting once done, which is the property that matters more than risk-only staging: anything migrated *before* Users would have nothing but a bare Sheets string to point at.

**Season Planning's place in this sequence: decided 2026-07-30 — wait until Games (Step 4) is done, build it clean directly on Postgres.** No interim Sheets-based version, no `Games_{nextYear}` parallel-sheet workaround — that entire mechanism existed purely to work around Sheets having no year/season column, and simply isn't needed once `games`/`seasons` tables exist. Season Planning is therefore **not a predecessor to Members/Clubs/Contacts** (an earlier framing floated in the source conversation, before Config → Users → Members → Clubs → Games was settled as the concrete Phase 1 list) — it's downstream of Step 4a specifically (core `games`/`seasons` rows), buildable as soon as that lands, without waiting for 4b/4c.

*(For context: Season Planning proposes next year's fixture dates from this year's — most fixtures project forward via "same weekday, same occurrence-in-month," computed per fixture since a club's home/away friendlies can follow different patterns; output grouped by club so each fixtures secretary gets one consolidated list; needs its own "Fixtures Secretary" SMTP credentials, not yet set up. It grew substantially during design — a three-stage Events/Friendlies/Leagues workflow, Home-only rink-capacity checking, standing weekly reservations (Friday Night Drive, Monday Afternoon, league slots, Greenkeepers Morning) with a Hard Block concept for all-day closures, a type-aware status model (`Projected → Email Sent → Confirmed / Rearranged / Not Happening`), and Gmail-compose-link draft generation rather than automated sending. Full detail lives in `specs/Planning_next_year_s_fixture_contacts.md` if this gets built out.)*

---

## Phase 1 — Migration

### Step 0: Config table + Maintenance Mode

A straight key/value port of `Labels`:

```sql
create table config (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text   -- username, informational only
);

alter table config enable row level security;
```

**Standing rule from Step 0 onward, confirmed 2026-08-01: every table gets `enable row level security` with zero policies defined, no exceptions.** The app only ever talks to Postgres server-side via the `service_role` key (`src/lib/supabase.ts`), which bypasses RLS entirely regardless — so this costs nothing functionally. What it buys: Supabase auto-exposes every table via its REST API, gated by whichever key a caller uses; the `anon`/publishable key is meant to be safe to expose client-side *only if* RLS is locking down what it can touch. With RLS on and no policies, that key (and anything else that isn't `service_role`) is denied by default on every table — the correct posture given nothing client-side is ever meant to touch Postgres directly in this design.

`config-supabase.ts` replaces `config-sheets.ts` with identical signatures (verified 2026-07-29: the real function names are `getLabelConfig`/`updateLabelConfig`, `src/lib/config-sheets.ts:13,30` — not `getConfigValue`/`setConfigValue` as an earlier pass of this plan assumed) — the lowest-risk possible first migration (nothing depends on its shape, just key lookups), and a genuine rehearsal of the whole pattern (Supabase client setup, an env-var getter matching the existing `getSpreadsheetId()` convention) before anything with real stakes.

**Maintenance mode is the practical reason to do this first**, and needs it built as standing infrastructure (every later step wants the same freeze mechanism), not a one-off:

- **Two enforcement points, not one** — "only Admin can log in" and "only Admin can keep using the site" are different checks. `authenticateUser()` checks the flag before issuing a token (non-admin credentials, even if correct, get rejected with the maintenance message). `middleware.ts` checks the same flag on *every* request — someone already logged in gets redirected to a public `/maintenance` page on their very next request unless Admin. This is the one people usually forget, and it's the one that actually matters for a cutover, since you need everyone off the site, not just newly blocked from getting on.
- **Cache the flag in memory with a short TTL (15–30s)** — middleware runs on every request; hitting Postgres for one flag on every page load is wasteful. Same pattern as the existing diary/announcements caching.
- This mechanism *is* the "freeze writes" step of the cutover procedure below — flip it on, step 1 of cutover is done.
- **A separate, optional idea, not built now:** a static "Portal temporarily unavailable" page on the public Vercel website (not the portal itself), for the scenario the portal genuinely can't serve anything at all — a bad deploy, a crash — since at that point the portal's own middleware isn't running either, gated maintenance page or not. Complementary to, not a replacement for, the above; you'd point people to it manually during a real outage.

`age_reference_date` and `min_friendlies_for_competitions` config keys — see Step 2.

### Step 1: Users table

Covered in full above. `users` + `user_roles`, UUID PK, real `username` uniqueness, `account_type` limited to `'member'`/`'shared'` (no `'club'` — see the Rowland redesign above).

### Step 2: Members (`member_profiles`) table

```sql
create table member_profiles (
  user_id            uuid primary key references users(id),
  first_name text, last_name text, known_as text,
  email_address text,
  landline text, mobile text,
  address_1 text, address_2 text, address_3 text, post_code text, locker_no text,
  birthdate text,                -- freeform, not normalised — see Age note below
  member_type text,              -- PL, SL, PM, SM
  honorary text, year_started int,
  handicap int check (handicap between 0 and 10),
  buddy_user_name text references users(username) on update cascade,
  is_marker boolean not null default false,
  is_worker boolean not null default false,
  left_at timestamptz,           -- Leavers replacement, is_active lives on users
  leaver_reason text,
  created_at timestamptz not null default now()
);
```

No `email_address` (or any other member field) duplicated onto `users` — see the join-cost reasoning above. Deliberately no `user_name` column here either, for the same reason: the standard lookup pattern is `users join member_profiles on member_profiles.user_id = users.id where users.username = $1`, cheap at this data volume, and it means `username` has exactly one place it's ever stored as a primary/unique value.

**Applications — new scope, not a straight port.** Live code has one terminal status (`Rejected`) — no `Declined`/`Didn't Proceed` split. Adding it deliberately: applicants processed through approval sometimes go quiet with no payment, which the current single status can't distinguish from an active review-stage decline.

```sql
create table applications (
  id                uuid primary key default gen_random_uuid(),
  status            text not null default 'Submitted'
                      check (status in ('Submitted','Listed','Approved','Paid','Converted','Declined','Didn''t Proceed')),
  first_name text, last_name text, email text, mobile text,
  address_1 text, address_2 text, post_code text,
  requested_member_type text,
  submitted_at      timestamptz not null default now(),
  reviewed_by       text references users(username) on update cascade,
  reviewed_at       timestamptz,
  decision_reason   text,          -- informal free text — covers objections and threshold-cap declines alike, no separate objections table
  converted_user_id uuid references users(id)   -- set on Converted, links forward rather than deleting the application
);
```

Both new statuses are **manual-only, always your call** — `Didn't Proceed` never triggers automatically off elapsed time; the existing Diary/Coming Up passive-surfacing pattern (which already flags `Submitted`/`Listed` after 14 days) is the reminder, you decide.

**OPEN:** what should passively surface an `Approved`-but-unpaid applicant, the way `Listed` already surfaces after 14 days — a genuinely new gap, needs a trigger-condition decision when this piece gets built. **Verified 2026-07-29: the existing mechanism to extend is `applicationNeedsAction()` in `src/lib/applications-sheets.ts:305-338`**, which already surfaces two different cases through one function — `Submitted` immediately, `Listed` after the 14-day objection window (`OBJECTION_PERIOD_DAYS`, line 326) — feeding an Admin-only Diary item (`src/lib/diary-sheets.ts:1071-1085`, gated on `hasRole(currentUserRole, 'Admin')`, linking to `/admin/members/applications`). Adding an `Approved`-and-unpaid-after-N-days case is a third branch in the same function, not new infrastructure.

**Leavers — not a separate table at all**, an improvement over the current two-sheet approach rather than a port of it. `is_active` (on `users`, applies uniformly to any account type) + `left_at`/`leaver_reason` (on `member_profiles`) replace it. **Archive** = `is_active = false`, `left_at = now()`. **Reinstate** = flip both back. The member's ~60 fields of data never move or get copied between schemas — no risk of drift, unlike today's full-row sheet-to-sheet copy. **Verified 2026-07-29: the actual implementation is `src/lib/leavers-sheets.ts`** (not `members-admin.ts`, which handles member *creation* only) — `archiveMember()` (lines 365-418) and `reinstateMember()` (431-473) both use `buildMappedRow()` for the full-row copy, and deliberately skip `MEMBERS_COMPUTED_COLUMNS` (line 36) so ARRAYFORMULA-driven columns aren't clobbered — a detail the new design also needs to preserve conceptually (generated columns compute themselves, nothing copies into them). **Deliberately clear `user_roles` for that user on archive** — otherwise a departed member who held `Captain,GMC` keeps those role rows sitting around, harmless for login (blocked by `is_active` regardless) but a real risk for any future "list current captains" query that lists by role without also remembering to filter `is_active`.

**Cleaning Rota / Sweeping Rota — roll into this step**, since they only depend on Users existing, nothing about Games. Both currently use **positionally-hardcoded columns** (no `getColumnMap`) — confirmed also true of `markers-sheets.ts`, a third file with the same pattern. This whole positional-vs-dynamic-column distinction simply stops existing once these are real table columns.

```sql
create table cleaning_rota (
  id             uuid primary key default gen_random_uuid(),
  date           date not null,
  lead_username   text references users(username) on update cascade,
  second_username text references users(username) on update cascade,
  third_username  text references users(username) on update cascade,
  fourth_username text references users(username) on update cascade
);

create table sweeping_rota (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  username    text references users(username) on update cascade,
  is_blocked  boolean not null default false
);
```

**Markers — confirmed a member attribute, not an assignment record.** The sheet simply holds Name + Worker; there's a Lookup that lists markers, whether they're a worker, and contact details. `is_worker` and `is_marker` are currently linked in the sheet (Worker is only ever recorded for markers) but are being decoupled going forward, per your steer — Worker becomes a genuinely general-purpose flag, not marker-scoped. **New scope added 2026-07-30:** a `worker_additional_info` free-text column, since Worker availability is currently *assumed* 9-5 weekdays with no way to record exceptions — following the exact pattern already used elsewhere on this table (`driving_away_matches`/`driving_additional_info`, `green_maintenance`/`green_additional_info`, `bar_duty`/`bar_additional_info` — each availability flag paired with a free-text notes column):

```sql
alter table member_profiles
  add column is_marker boolean not null default false,
  add column is_worker boolean not null default false,
  add column worker_additional_info text;   -- exceptions to the default 9-5 weekday assumption
```

Migration script: both default `false`; `is_marker = true` for every username present in the current Markers sheet; `is_worker = true` wherever that sheet's Worker column was `Y`. No source data exists for `worker_additional_info` (it's new capture, not a port) — starts empty, populated going forward via whatever UI edits `is_worker` (presumably the existing Markers management page, extended with this field). The Markers Lookup becomes a trivial filtered query — no join needed, since contact details already live on `member_profiles` — and should surface `worker_additional_info` alongside the existing Worker Y/N column so the "assumed 9-5 unless noted" exception is actually visible to whoever's looking someone up.

**Calculated/formula columns:**

- **`full_known_as`/`full_name` — Postgres generated columns, deterministic, same-row-only.** Live formulas confirmed 2026-07-29: `Full Known As` = `=ARRAYFORMULA(IF(A2:A="","",IF(C2:C="",A2:A,C2:C)))`, `Full Name` = `=ARRAYFORMULA(IF(B2:B="","",D2:D&" "&B2:B))` — confirming column letters `A`=first_name, `B`=last_name, `C`=known_as, `D`=full_known_as (and, same as the Gmail Labels formula already showed, contradicting `SCHEMA.md`'s listed order, which puts `title` before `first_name` — the doc's column order still can't be trusted for letter-to-field mapping anywhere else in the sheet). The design already matched exactly, no change needed:
  ```sql
  full_known_as text generated always as (coalesce(nullif(known_as, ''), first_name)) stored,
  full_name      text generated always as (coalesce(nullif(known_as, ''), first_name) || ' ' || last_name) stored
  ```
  One Postgres quirk: a generated column can't reference another generated column, so `full_name` repeats the `coalesce` inline rather than building on `full_known_as`.
- **Age — dropped as a column entirely, computed on read, not stored.** Live formula confirmed 2026-07-29: `=ARRAYFORMULA(IF(N2:N="","",IFERROR(DATEDIF(N2:N,"1-Mar-2026","y"),"")))` — confirms `N`=birthdate, and confirms the design already matched (fixed reference date, not "today"). The formula anchors to a fixed date (`"1-Mar-2026"`) that's manually bumped forward once a year — a deliberate cutover point for age-banded renewal fees, not a live calculation. A generated column can't reference outside data anyway (Postgres requires same-row, immutable inputs), which is a good forcing function here — it stops the "quietly stale until someone remembers to edit the formula" failure mode outright rather than relocating it into SQL. `age_reference_date` becomes a `config` key (Step 0); age is computed via a view/function:
  ```sql
  select extract(year from age(
    make_date(extract(year from current_date)::int, 3, 1),
    birthdate::date
  ))::int as age
  ```
  **Phase 0 needs to confirm exactly how Renewals currently consumes this** — whether it reads a precomputed `age_demographic` band or recalculates — since the fee-tier logic has to produce identical results, not just "a reasonable age."
- **Gmail Labels — deliberately not a generated column.** Structurally it could be (all referenced columns live on the same row), but the Google Contacts Sync feature it feeds is still mid-design, with open questions about which fields get pushed — baking a rigid label format into schema now means a schema migration every time that still-being-designed feature's requirements change. Build as an application-level function in the new Members data layer instead — same output, editable without touching the table. **Formula and column mapping confirmed 2026-07-29, no longer blocked:**
  ```
  =ARRAYFORMULA(IF(A2:A="","",
        IF(Label_0<>"",Label_0,"")&
        IF(AgeDemographic<>""," ::: "&AgeDemographic,"")&
        IF(MemberType<>""," ::: "&MemberType,"")&
        " ::: Social "&IF(SocialEmails="N","No",MemberType)&
        IF(GMC<>""," ::: "&GMC,"")&
        IF(Darts<>""," ::: "&Darts,"")&
        IF(BarDuty="Y"," ::: Bar Duty","")&
        IF(CountyLadies<>""," ::: "&CountyLadies,"")&
        IF(GreenMaintenance="Y"," ::: Green Maint","")&
        IF(Label_9<>""," ::: "&Label_9,"")&
        IF(Label_10<>""," ::: "&Label_10,"")
      ))
  ```
  Column letters resolved to real fields: `X`→Social Emails, `AI`→Label_0, `AJ`→Age Demographic, `AK`→Member Type, `AM`→GMC, `AN`→Darts, `AP`→County Ladies, `AR`→Label_9, `AS`→Label_10, plus `AD`→Bar Duty and `AB`→Green Maintenance (both self-evident from the formula's own literal label strings). **One quirk worth confirming with you when this actually gets built, not silently reproduced without comment:** the `" ::: Social " & IF(SocialEmails="N","No",MemberType)` clause shows `Member Type` (e.g. `PL`/`SM`) as the value whenever Social Emails isn't `"N"`, rather than a plain "Yes" — presumably intentional (so the label reads e.g. "Social PL"), but worth verifying rather than assumed correct purely by inheriting it.
- **`Friendlies 2023`, old `2024`, and `Friendlies Last Year` — all three dropped entirely, no history table kept.** Confirmed no live *template document* references 2023/2024 (checked both renewal attachment `.docx` files directly — zero matches). **Correction, verified 2026-07-29: these columns are not dead in code, even though no template uses them.** `src/lib/sheets.ts:858-866` actively reads all three (`friendlies2023`, `friendlies2024`, and a `friendliesLastYear` parser handling an `'X'` manual-override sentinel), and `src/lib/email/member-mailer.ts:151-153` registers all three as available mail-merge placeholder fields (`'Friendlies 2023'`, `'Friendlies 2024'`, `'Friendlies Last Year'`) for *any* member email/attachment template, not just the two current renewal ones. Dropping the columns means also removing these two live code references, not just deleting sheet columns — "safe to drop" refers to the data model and current templates, not "nothing in the app currently touches them." `Friendlies Last Year` is replaced by a live query once `game_players` exists, on the explicit bet that `game_players` lands before next year's renewals cycle. **This is a real, named risk, not a hedge:** Renewals' ≥8-friendlies eligibility check (`app/api/renewals/route.ts`) has **no fallback data source** once these columns are gone — if `game_players` slips past the next renewals cycle for any reason, there's a genuine gap. Flagged in three places (here, Step 4, and Out of Scope) so it can't get lost.
  ```sql
  -- config table
  key: 'min_friendlies_for_competitions', value: '8'   -- becomes '6' the following year, manual edit
  ```
  Confirmed hardcoded in `app/api/renewals/route.ts` (`friendliesValue >= 8`) — that's the file to update to read from config, not `renewals-sheets.ts`.

**Handicap history — genuinely new territory, no existing history/audit table.** A separately-maintained external spreadsheet currently calculates next year's handicap from competition results (`C=7`/`H=6` notation — reached the QF in the Championship/Handicap competition respectively), with two known, real problems: no history kept, and the name list handed over regularly has spelling mismatches against Members (`Dacey` vs `Dasey`). The calculation rule itself is **not fully confirmed** even by you — worth deliberately *not* guessing at it now, since a wrong handicap has real fairness consequences in the Handicap Competition.

```sql
create table handicap_history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id),
  year         int not null,
  handicap     int not null check (handicap between 0 and 10),
  source       text not null default 'Imported'
                 check (source in ('Imported','Calculated','Manual Override')),
  source_notes text,     -- raw 'C=7'/'H=6' notation, kept verbatim, not discarded
  imported_at  timestamptz not null default now(),
  imported_by  text references users(username) on update cascade,
  unique (user_id, year)
);
```

`member_profiles.handicap` stays as the current-value cache the Handicap Competition Bracket already reads, updated once a year from this table. **Reviewed import, not raw paste-and-hope:** upload the external list each year → fuzzy-match names against `member_profiles` (Postgres `pg_trgm` handles `Dacey`/`Dasey`-style typos well) → high-confidence matches one-click confirm, anything ambiguous surfaced for manual resolution, never silently applied → confirmed rows write to `handicap_history` and update the cache. (`src/lib/banking-match.ts` has a word-overlap fuzzy matcher for payment-reference matching — not directly reusable here, word-overlap not trigram similarity, but worth a glance as prior art in this codebase.)

**Future design, explicitly deferred (not Phase 1): automated handicap calculation.** You want this to eventually pick up competition winners automatically and calculate next year's handicaps, with admin override and full history — `source = 'Manual Override'` already makes override a first-class citizen from day one, never blocked by whatever automation says. Two real, separate dependencies, both acknowledged as not there yet: **(a)** it needs match results from the Championship/Handicap brackets, and Competitions stays entirely on Sheets in Phase 1 — this can't be built until Competitions has its own migration phase; **(b)** the calculation rule itself needs to become an actual confirmed, written-down set of rules (what "reached QF" means precisely, the exact increment/decay logic, ties/byes) — your call, whenever you're ready to work through it the same iterative, verify-against-real-data way as everything else here.

### Step 3: Clubs & Club Contacts

Pure reference data in Phase 1 — no login fields at all, since club login is being removed entirely (see above).

```sql
create table club_profiles (
  club_name          text primary key,
  driving_band       text,
  address_1 text, address_2 text, post_code text,
  website text, latitude float, longitude float
);

create table club_contact_profiles (
  id              uuid primary key default gen_random_uuid(),
  club_name       text not null references club_profiles(club_name),
  first_name text, last_name text, role text,   -- 'Match Secretary','Captain',...
  email text, mobile_number text
);
```

Used directly by the Season Planning outreach tool (matching on `role` containing "Match Secretary", falling back to showing all of a club's contacts when none matches) whenever that gets built — no login concept riding on this table at all for now. An individual contact wanting a real login later (rather than the Rowland token) is a future addition of login fields here, not built speculatively now.

### Step 4: Games

Splits into three genuinely different pieces of work, not one atomic step — bundled into what people mean by "the Games sheet" is also the `Players` cross-reference (per-game tabs, `SCHEMA.md` §10.3's own EAV-pattern flag), Tea Rota (columns living directly on Games rows, not a separate sheet), and live workflow logic touching ~15 API routes (selection, the `locked_by`/`locked_at` lock, ICS generation, SSE-streamed bulk email).

**4a — core fixture rows.** "Season" doesn't exist as its own entity today. **Correction, verified 2026-07-29: there is no `season` field at all** — not even a plain string — on the `Game` type, in `friendlies-sheets.ts`'s row-mapping, or anywhere in `SCHEMA.md`'s Games column table (a `season` string column does exist, but only on the unrelated `RowlandControl`/`LeagueControl` sheets). The year is implicit purely in *which spreadsheet/tab is currently active* (`Games` vs. `Games 2026`) — the `seasons` table below is genuinely new structure with no existing column to migrate, not a normalisation of one.

```sql
create table seasons (
  id          uuid primary key default gen_random_uuid(),
  year        int not null unique,
  start_date  date not null,
  end_date    date not null,
  is_active   boolean not null default false   -- exactly one true at a time
);

create table games (
  id                    uuid primary key default gen_random_uuid(),
  season_id             uuid not null references seasons(id),
  fixture_type          text not null,      -- 'Friendly','Event','BL','JSL','MSL','N/S A','N/S B'
  club_name             text references club_profiles(club_name),   -- null for internal Events
  date date, time time,
  home_away             text check (home_away in ('H','A')),
  format                text,               -- '3 Rinks','4 Triples' etc.
  hard_block            boolean not null default false,

  game_status           text default '',    -- '', 'O','X','S','P','C','A' — live-season only
  max_capacity int, entered int default 0, selected int default 0,
  captain_username      text references users(username) on update cascade,
  locked_by             text references users(username) on update cascade,
  locked_at             timestamptz,
  tea_lead_username     text references users(username) on update cascade,
  tea_first_username    text references users(username) on update cascade,
  tea_second_username   text references users(username) on update cascade,
  -- dress, ladies_men, special_instructions etc.

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Rollover ("rename `Games` to `Games 2026`, create a fresh `Games`") becomes a one-transaction flag flip (`update seasons set is_active = false where year = 2026; update seasons set is_active = true where year = 2027`) instead of a manual Sheets rename — this is what makes Season Planning genuinely simpler once built against Postgres rather than Sheets (see Migration Sequencing above).

**4b — `game_players`, replacing the per-game sheet tabs:**

```sql
create table game_players (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id),
  user_name   text not null references users(username) on update cascade,
  status      text,   -- 'E','M','D','P','R'...
  selected    text, team int, position text,
  unique (game_id, user_name)
);
```

**This can't wait for "a later phase" without re-examining the Renewals dependency** — see the Step 2 note on `Friendlies Last Year`. Confirmed `game_players` doesn't exist relationally today (per-game tabs only), so deferring 4b past 4a is directionally fine, but if it slips past the next renewals cycle, there's a real gap with no fallback.

**4c — live workflow** (selection lock, tea-rota maintenance function — already has its own API surface today: `/api/tea-rota`, `/api/tea-rota/batch`, `/api/tea-rota/swap`, distinct from general fixture management, keep that separation — ICS calendar generation, SSE bulk email). Each of 4a/4b/4c is independently testable; **4a alone unblocks Season Planning** — it doesn't need 4b (`game_players`) or 4c (live workflow) to exist first.

### End of Phase 1 — Cutover Procedure

No dual-write — explicitly rejected as unneeded engineering overhead at this scale. A short, deliberate cutover window instead, done as a single sitting per major table group (Config first as a low-stakes rehearsal, then Users/Members together, then Clubs, then Games):

1. **Freeze writes** — the maintenance-mode flag from Step 0 *is* this step. Flip it on.
2. **Run the migration script** — read Members/Contacts (plus `LoginAttempts`/`ImpersonationLog`/`PasswordResetRequests` for their FK targets) → write into `users`/`member_profiles`/`user_roles`. No XOR-password handling needed (confirmed removed).
3. **Verify before cutting over** — row counts match, spot-check a sample, and **test real logins against the new Postgres-backed auth path before flipping the switch for everyone**. A login bug is the one class of bug where "found in testing" versus "found in production" is the difference between an annoyance and every member — admins included — locked out simultaneously.
4. **Cut over** — point `auth.ts` at the new data layer, re-enable the app.
5. **Export the old sheets as a static backup**, then **actually drop the live sheets/tabs** — not rename-and-keep-indefinitely. The backup is an "in case someone needs a setting three months from now" safety net, not a rollback mechanism.

On rollback: no dual-write means no live fallback once people start using the cutover — the honest options are "fix forward fast" or "redeploy the previous Sheets-backed version" (only clean if the freeze held). This is exactly why step 3's real-login testing matters more here than it would with a dual-write safety net.

Every auth-adjacent surface re-tested on a preview branch before merge, per `CODING_STANDARDS.md` §22: temp-password forced change, password reset token flow, rate limiting via `LoginAttempts`, impersonation start/stop (`ImpersonationLog`'s FK target), the Captain/Kiosk shared logins, session refresh picking up role changes mid-session. Club login testing drops out of this list entirely, since it no longer exists by the time Users/Members migrate.

---

## Explicitly out of scope for Phase 1

- Renewals, Banking, Competitions, Rowland (beyond the login-closure bridge), Leagues, rotas beyond Cleaning/Sweeping/Markers, Suggestions, Invite Games — remain on Sheets
- `game_players`'s live selection/lock/tea-rota workflow (Step 4c) — 4a/4b may need to land ahead of 4c given the Renewals dependency; not a strict "later phase" the way it first looked
- **Rowland contact tokens** — fully designed above, deferred until the public-website team-entry feature exists as the real collection point, and until Rowland itself gets its own migration phase
- **Season Planning** — decided: waits until Games Step 4a exists in Postgres, no interim Sheets build (see Migration Sequencing)
- **Automated handicap calculation** — designed, deferred on two dependencies: Competitions migrating, and the calculation rule itself getting confirmed
- Dual-write/live-fallback infrastructure — explicitly decided against
- Individual club-contact logins (Match Secretaries wanting real accounts) — `club_contact_profiles` supports adding login fields whenever actually wanted, not built speculatively now

---

## Validation checklist

**A full Phase 0 code audit (two parallel Explore passes, Claude Code, 2026-07-29) has independently verified every code-level claim introduced via the second claude.ai conversation, since that conversation — like the original draft — never had repo access.** Six real corrections came out of it (marked with `(corrected)` below); everything else checked out as claimed.

- [x] Members/Clubs/Contacts touch-point inventory — completed via live-code audit
- [x] §21 violations — found, listed above, mandatory Step 2 scope; all four files independently re-confirmed 2026-07-29
- [x] `sheets.ts` is not a single consolidation point for Members `(corrected)` — only `profile-sheets.ts`, `banking-sheets.ts`, and `data-export.ts` genuinely bypass it; `buddies-sheets.ts`, `renewals-sheets.ts`, and `competitions-sheets.ts`'s `CompMemberInfo` already route through its shared functions — Step 2's real refactor scope is narrower than first estimated
- [x] `LoginAttempts`/`ImpersonationLog`/`PasswordResetRequests`/`MemberEmails` write sites — confirmed, route through `sheets.ts`, store bare username soft-references (becoming real FKs to `users(username)`)
- [x] Legacy XOR password rows — confirmed removed, re-verified 2026-07-29 (only explanatory comments remain, zero executable XOR code anywhere)
- [x] Session expiry `(corrected)` — actually 45-day inactivity / 90-day absolute (`src/lib/auth.ts:264`), not 30-day; a stale doc comment in the same file caused the earlier 30-day assumption
- [x] Applications/Leavers sheet locations and admin routes — confirmed; Leavers implementation is specifically `src/lib/leavers-sheets.ts` `(corrected file citation)`, not `members-admin.ts`
- [x] Diary "overdue applications" logic — confirmed, `applications-sheets.ts:305-338` + `diary-sheets.ts:1071-1085`, Admin-only, surfaces both `Submitted` (immediate) and `Listed` (after 14 days) via one function
- [x] Cleaning/Sweeping/Tea rota routes and positional-column assumptions — confirmed, `markers-sheets.ts` added as a third positionally-hardcoded file, all re-verified 2026-07-29
- [x] Markers sheet — confirmed Name + Worker only, a member attribute, not an assignment record; `is_worker`/`is_marker` decoupled and a new `worker_additional_info` notes field added 2026-07-30 (new capture, no source data to port)
- [x] `renewals-sheets.ts` Age consumption — confirmed it's actually `app/api/renewals/route.ts` (`route.ts:49,83`), reads precomputed `age_demographic` from `sheets.ts`, does not recalculate
- [x] Gmail Labels column-letter mapping — **resolved 2026-07-29**, full formula + field mapping in Step 2; one behavioural quirk (the `Social` clause reusing `Member Type`) flagged for confirmation when actually built
- [x] ≥8-friendlies threshold location — confirmed hardcoded in `app/api/renewals/route.ts:95-98`
- [x] `Friendlies 2023`/`2024`/`Last Year` `(corrected)` — dropping the columns is still fine, but they're not inert: actively read in `sheets.ts:858-866` and registered as mail-merge placeholders in `member-mailer.ts:151-153` — dropping means removing those two live code references too, not just sheet columns; `game_players`-before-next-renewals-cycle remains a named, tracked risk
- [x] `club_id` — confirmed droppable entirely once club login is removed; `RowlandMatch.home_club_id`/`away_club_id` → `home_club_name`/`away_club_name`; club `password_reset_token`/`password_reset_expires` columns confirmed to have zero code references today (reset flow was never actually wired up)
- [x] Rowland login-closure bridge vs. `middleware.ts` — confirmed two real implementation gaps (`/clublogin` outside the matcher, cookie-clear timing), both addressed above, re-verified 2026-07-29
- [x] Handicap — confirmed genuinely new territory; calculation rule explicitly not guessed at; confirmed zero existing history/audit table of any kind
- [x] Season entity `(corrected)` — no `season` field exists anywhere on Games/Friendlies today, not even as a string; year is implicit only in which spreadsheet/tab is active
- [x] Config function names `(corrected)` — `getLabelConfig`/`updateLabelConfig` (`config-sheets.ts:13,30`), not `getConfigValue`/`setConfigValue`
- [x] Captain shared-login row — **confirmed 2026-07-29**, username **corrected 2026-08-01 against real live data**: an ordinary `Members` row (real username `captains`, lowercase — `Captains` was an unconfirmed assumption; `full_name` is literally "Captains Laptop") used on a shared club computer, by design has no code marker distinguishing it (captains also have their own personal logins); migration script identifies `captains`/`clubhouse` as `account_type = 'shared'` via a short known-username list, not derived from data
- [x] Real migration script run against live Members data (redacted) — **2026-08-01, `scripts/migrate-members.ts`**: 196 users, 194 member_profiles, 33 user_roles migrated to Dev successfully. Found and fixed live: Sheets timestamps are `DD/MM/YYYY HH:MM:SS`, not ISO despite `SCHEMA.md` claiming otherwise (see the note on `last_login_date` etc. — worth correcting that documentation separately); **3 real `buddy_user_name` anomalies exist in production data** (`torri.duffy`→`dawn.duffy`, `nigel.croucher`→`hazel.campell`, `frank.leach`→`annette.leach`, all non-matching current usernames — stale references or typos) — nulled by the script with a warning, **worth you reviewing and correcting in the live sheet independently of the migration**
- [x] Duplicate-email audit — **resolved 2026-07-29**: ~20-30 members / 10-15 shared-email households (your estimate, partners and parent/grandchild sharing), club contacts not a factor (token-based access); ~6 members with no email at all noted as a real username-only-login case to test explicitly
- [x] Season Planning ordering — **decided 2026-07-30**: wait for Games Step 4a (Postgres), no interim Sheets build
