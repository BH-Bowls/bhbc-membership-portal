# Spec: Member Availability (substrate) + Availability Planning (layer)

A two-layer redesign of `/availability`. The current event/poll system is **pull-based**: nobody's
availability is known until they answer a specific poll. This adds a **push-based** substrate
underneath it: a member declares their normal pattern once (a "standard week"), records ad-hoc
exceptions, and the system tracks dated **commitments** (bookings) from many sources. A
source-agnostic **resolver** turns all of that into "is member M free on date D, session S?", which
then **pre-fills polls** and **powers a group availability view that needs no poll at all**.

> Status: design accepted, not yet built. Greenfield substrate. Build it **native in Supabase**
> (see §8) while the rest of the app stays on Google Sheets.

---

## Open questions (decide before build)

1. **`max_games_per_day` default** when the Members-sheet column is blank — spec currently assumes
   **2**. Confirm, or change to 1.
2. **Open-poll "nudge"** — left where it currently lives (separate from "Coming Up"); only
   *confirmed/booked* items move to the `commitments` table in §7 step 1. Confirm this split is right,
   or decide whether nudges should also become commitments later.

---

## The two layers

1. **`member-availability` (substrate, NEW)** — owned by the individual member. *"When am I
   generally free / busy."* Three input sources + a resolver. Lives in Supabase.
2. **`availability-planning` (mostly REUSE)** — owned by organisers/groups. *"Find a date that
   works for this group."* This is today's `/availability` events/slots/responses/match-finder. It
   becomes a **consumer** of the substrate (reads it to pre-fill; writes commitments on conclusion).

The relationship is a **loop**: planning reads availability to pre-fill, and a concluded plan
*writes a commitment* that constrains every other plan. Triples-league dates, once teams are set,
show up as busy when planning the Aussie-pairs — automatically, because both are just consumers of
the same commitment store.

---

## Sessions (the unit of availability)

Three named **game sessions**, treated as sessions not clock times:

| Session | Nominal time | Real-world flex (informational only) |
|---|---|---|
| `morning` | 10:00 | may be arranged for 11:00, must finish by 14:00 |
| `afternoon` | 14:00 | — |
| `evening` | 18:00 | away games usually 17:00 meet |

- The availability grid a member taps = **these three sessions** only.
- The planner deals only in sessions; the *booked* event/game carries the real clock time.
- **Duties** (cleaning/sweeping, 08:00-or-before) are **NOT a fourth game slot**. They are
  `commitment` rows with `source = rota`, shown as an **early band above** the three sessions so a
  duty can mark you busy early without polluting the game grid. (See "Coming Up" — duties must never
  be dropped.)

---

## What already exists (reuse — do NOT fork)

- **Groups + group members** — `src/types/availability.ts` (`AvailabilityGroup*`),
  `src/lib/availability-groups-sheets.ts`. The group heatmap reads exactly these. Stay on Sheets for
  now.
- **Events / slots / responses / invitees** — `src/lib/availability-events-sheets.ts`. This *is* the
  planning layer; keep it. It gains: read-from-resolver pre-fill, and write-commitment-on-conclude.
- **Match-date-finder** — `specs/AVAILABILITY_MATCH_DATES_SPEC.md` + `app/availability/match/`. The
  date×time matrix UI is the same visual language the group heatmap wants — reuse the component.
- **Coming Up / diary** — `src/components/DiaryPanel.tsx` → `GET /api/diary` →
  `getDiaryItems()` in `src/lib/diary-sheets.ts`. Already an on-the-fly aggregation of dated
  commitments across 5 sheet sources. A `DiaryItem` **is** a commitment (date, type/source, label,
  subLabel, linkUrl). The new `commitments` table is designed as a **superset of `DiaryItem`** so the
  two converge. (See §7.)
- Patterns: `getColumnMap` dynamic columns, role guards (`role-utils.ts`), API route template,
  UTC-safe slot datetimes (`AVAILABILITY_SLOT_TIME_TZ_FIX`), `parseUKDate`/`date-utils.ts`,
  sessionStorage list cache, theme helpers.

---

## New / changed pieces

### 1. Data model (Supabase — see §8 for setup)

All tables key members by **`user_name`** (the Sheets login name). Display names are resolved at read
time from the Members sheet, exactly as `buildNameMap()` does today. No cross-store foreign keys.

**`standard_week`** — recurring template. One row per (member, weekday, session).
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `user_name` | text | FK-by-convention to Members sheet |
| `weekday` | int | 0=Sun … 6=Sat |
| `session` | text | `morning` \| `afternoon` \| `evening` |
| `status` | text | `free` \| `busy` (free is the default; rows only stored for `busy`, or store all 21 — implementer's call) |
| `label` | text | optional, e.g. "Work", "Grandchildren". No detail required. |
| `updated_at` | timestamptz | |

**`availability_overrides`** — ad-hoc, date-specific exceptions; **beat** the standard week.
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `user_name` | text | |
| `date` | date | the specific day |
| `session` | text | one session, or `all` for the whole day |
| `status` | text | `free` \| `busy` — supports both "unavailable this Tue PM" and "free all next week" |
| `label` | text | optional reason |
| `created_at` | timestamptz | |

**`commitments`** — dated bookings emitted by sources; the **strongest** signal. Superset of
`DiaryItem` (`src/types/diary.ts`) so Coming Up can render straight off it.
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `user_name` | text | |
| `date` | date | |
| `session` | text | `early` (duties) \| `morning` \| `afternoon` \| `evening` \| `all` |
| `source` | text | `availability` \| `friendly` \| `competition` \| `rota` \| `marker` \| `external` … (discriminator) |
| `source_ref` | text | id of the originating record (e.g. eventId) — for idempotent upsert/delete |
| `status` | text | `committed` \| `tentative` |
| `type` | text | maps to `DiaryItemType` (icon) — `cleaning`, `friendly`, `competition`, `marker`, `availability_confirmed`, … |
| `label` | text | `DiaryItem.label` |
| `sub_label` | text | `DiaryItem.subLabel` |
| `link_url` | text | `DiaryItem.linkUrl` |
| `created_at` | timestamptz | |

> **Day 1 writer:** the availability planner only (on conclude). Other sources keep flowing through
> their existing Sheet readers in `getDiaryItems()` until they migrate (§7).

**Members sheet (Google Sheets, existing):** add **`max_games_per_day`** column (integer; `1` or
`2`; default `2` if blank). Read via `getColumnMap` like every other member field. The resolver reads
it; no Supabase storage.

### 2. The resolver (the heart of the substrate)

`src/lib/member-availability.ts` (Supabase data layer) — one core function, source-agnostic:

```
resolveAvailability(userNames: string[], startDate, endDate)
  → Map<user_name, Map<`${date}:${session}`, EffectiveStatus>>
```

`EffectiveStatus = 'free' | 'busy_committed' | 'busy_personal' | 'unknown'`.

Resolution order (highest wins), per (member, date, session):
1. **`commitments`** for that date/session → `busy_committed` (a real booking).
2. **`availability_overrides`** for that date (session-specific or `all`) → `free` / `busy_personal`.
3. **`standard_week`** for that weekday/session → `free` / `busy_personal`.
4. Nothing → `unknown`.

`max_games_per_day = 1`: if a member is already `busy_committed` (or said yes) in one session that
day, the **other game sessions that day** are downgraded for pre-fill purposes (see §5). The resolver
exposes the raw per-session status; the max-games rule is applied by the pre-fill consumer so the
heatmap can still show true availability.

### 3. `/my-availability` — the standard-week editor (NEW page)

Member-facing. A **7×3 tap grid** (weekdays × the three sessions), free-by-default, tap to toggle a
session busy and optionally label it ("Work", "Grandchildren", "Exercise class"). Plus:
- An **overrides** section: pick a date (or a week) + session(s) + free/busy + optional reason.
  Handles both "away this fortnight" and "free this one Saturday despite the usual".
- The **duties band** shown read-only above the grid for the coming weeks (from `commitments` where
  `source = rota`) so members see the early-morning duties that the standard week can't express.
- `max_games_per_day` toggle (writes to the Members sheet).
- Use `useEditMode` (CODING_STANDARDS §19) for the edit/save buffer.

### 4. Group availability heatmap (NEW view, no poll required)

A read-only view per group: rows = upcoming dates, columns = the three sessions (matrix component
reused from the match-finder), each cell a **count/heat** of how many group members are
`free` vs `busy` per `resolveAvailability` over the group's roster. This is the "look at the group's
availability" capability and it needs **zero** events/responses — it reads the substrate directly.
Manage/organiser scope as existing (creator/Admin), per-route.

### 5. Pre-fill (planning reads the substrate)

When the respond grid for a planning/match event loads, seed each member's cells from
`resolveAvailability` over the event's dates:
- `busy_committed` → pre-fill **No**, and lock or strongly warn ("booked: County Triples"). This is
  the headline win — selectors stop double-booking people.
- `busy_personal` (override or standard week) → pre-fill **No** (soft; member can flip).
- `max_games_per_day = 1` and already committed/yes elsewhere that day → other sessions pre-fill
  **No/unlikely**.
- `free` / `unknown` → blank or **Maybe**.

**Guardrail:** pre-fill is a *default the member can override per event*. The explicit poll response
remains the source of truth for that event. Pre-fill never auto-commits.

### 6. Conclusion writeback (planning writes the substrate) — **day 1**

When a planning event concludes on a date (existing `concludeEvent`), **emit one `commitment` row per
participant who is in** (said Yes / selected), with `source = availability`, `source_ref = eventId`,
the concluded date + session (derived from the slot time → nearest session), and `DiaryItem`-shaped
label/subLabel/linkUrl. Upsert keyed on (`source`, `source_ref`, `user_name`) so re-concluding or
reopening is idempotent (reopen → delete those rows). This single change is what makes the
triples→pairs loop work and what feeds Coming Up (§7).

### 7. "Coming Up" migration — strangler-fig, not big-bang

`getDiaryItems()` currently merges 5 Sheet-derived sources. Migrate gradually:
1. **Now:** add a **commitments reader** (Supabase) as a source in `getDiaryItems()`, and **move
   availability's contribution to it** — i.e. replace the `fetchAvailabilityItems` *confirmed-items*
   branch with rows from the `commitments` table written in §6. (Keep the open-poll "nudge" behaviour
   wherever it currently lives.)
2. **Keep** the other Sheet readers (cleaning, sweeping, friendlies, comps, marker) exactly as they
   are.
3. **Later, per module:** as each migrates to also write `commitments` rows, delete its bespoke reader
   from the aggregator.
4. **End state:** Coming Up = a single ordered Supabase query, including the early-morning duties
   band.

Because a `commitment` is a superset of `DiaryItem`, the new reader maps 1:1 onto the existing render
path in `DiaryPanel.tsx` — no UI change.

### 8. Supabase setup (the Sheets ↔ Supabase seam)

- **Coexistence:** Supabase holds only the substrate (§1). Everything else stays on Google Sheets.
  The boundary is `user_name`; there are no cross-store joins and no cross-store transactions.
- **Client:** add `src/lib/supabase.ts` with a **service-role** server client (the direct analogue of
  the Google service account). Server-side only — never expose the service key to the browser. Keep
  NextAuth for auth; do **not** adopt Supabase Auth.
- **Env getters** (CODING_STANDARDS §20): `getSupabaseUrl()`, `getSupabaseServiceKey()` — throw a
  clear message if missing. New `.env.local` entries: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Data layer only:** all Supabase access goes through `src/lib/member-availability.ts` (and a
  `commitments` helper), mirroring rule §21 ("always use the data layer"). No Supabase calls from
  routes/pages.
- **API routes** keep the standard template (session → role guard → data layer → JSON), §7 of
  standards.
- **Local dev:** a Supabase project (cloud free tier is fine) or local stack; document the two env
  vars in `.env.local`.

---

## Access

Open to any logged-in member (matches current availability). `/my-availability` edits only the
caller's own rows. Group heatmap + manage scoped to creator/Admin per-route. Add new page routes to
`middleware.ts` (§22), not per-page guards.

---

## Build order

1. **Supabase plumbing** — client, env getters, the three tables, `max_games_per_day` column.
2. **Resolver + `member-availability.ts`** data layer (read path).
3. **`/my-availability`** editor (standard week + overrides). Ships standalone — members can fill in
   their week before anything consumes it.
4. **Group heatmap** (read-only; reuses groups + matrix). High value, low risk, no event changes.
5. **Conclusion writeback** (§6) + **commitments reader** into `getDiaryItems()` (§7 step 1).
6. **Pre-fill** into the respond/match grids (§5).
7. *(Later)* per-module commitment writers; retire Sheet readers from the diary aggregator.

---

## Future (designed-for, NOT built now)

- After the wider Supabase migration, **friendlies / leagues / competitions / duties / marking** each
  write `commitments` rows directly. The resolver and heatmap need no change — they were always
  source-agnostic.
- **Miscellaneous external comps** (county/national triples/rinks) are **not** a special object: they
  are ordinary planning events whose conclusion (§6) emits commitments. No new machinery.
- Optional precise time ranges on the standard week (the session model is deliberately coarse for v1).

---

## Build notes / gotchas

- **No `?.` / `??` / functional chains** — explicit code (CODING_STANDARDS §3; the maintainer reads
  Apps Script-style code).
- **UTC-safe** slot↔session mapping: derive session from a slot's UTC time; build/display datetimes
  UTC (`AVAILABILITY_SLOT_TIME_TZ_FIX`).
- **Idempotent commitment upsert** keyed on (`source`, `source_ref`, `user_name`) — reopening an event
  must cleanly remove its commitments.
- **Pre-fill is advisory**; explicit responses win. Never let pre-fill silently enter someone in a
  game.
- **Duties must never be dropped** from Coming Up during the migration — verify the early band renders
  before retiring any Sheet reader.
- Service-role Supabase key is **server-only**. Never ships to the client.
- Heatmap matrix must degrade on mobile (stack / horizontal scroll), as the match grid does.
