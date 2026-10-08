# Spec: Fixture Groups — Friendlies to Postgres, External Leagues, Club Teams

Moves the last Google Sheets dependency (friendlies rosters) into Postgres, and in doing so builds one
entry/selection model that also covers external league fixtures and "Club Teams" (Gladys/Edward
Rowland teams, Top Clubs, Tony Alcock, etc.).

> Status: design agreed in chat 2026-10-02/03. Phase 1 built on `feature/fixture-groups` (2026-10-03),
> not yet applied or tested — see §13 for what changed during the build. Off-season build; cut over before the
> 2027 season opens. 2026 friendlies data is imported (see §9).

---

## 1. Why

What still lives in the Friendlies spreadsheet (`FRIENDLIES_SPREADSHEET_ID`, `src/lib/friendlies-sheets.ts`):

| Sheets structure | Holds | Problem |
|---|---|---|
| `Players` sheet (row per member, **column per game**) | One code per cell (`E/M/D/P/R/T/C/A` + `W` suffix) + cached stat columns | One code packs 4 facts (entry source, selection, withdrawal, game outcome). Stats are copies rewritten by `update-stats`. "Last 6" relies on column order. |
| Per-game tab (cloned from `Template Game Sheet`) | Roster: selected, team, position, driving, car, status, captain flag, token, ack, snapshotted stats | Duplicates the Players cell; hand-synced by `update-stats` / `repair-entries`. Token/ack columns created lazily. |
| `_SelectionCache` tab | JSON snapshot of selection-helper output | Exists only to freeze stats. |
| `ManageLog` tab | Audit trail | Wrong home. |
| `fixtures.entered/selected/reserves` (Postgres) | Hand-maintained counts | Drift; every mutation has to patch them. |

Linked games (`fixtures.paired = 'Y'/'C'` + same date) and reserve games (`is_reserve` + `-2` tab name)
are bolted on, and nothing stops a player being entered in both halves of a linked pair.

`game_players` (`0013`) was never used by any code and is replaced.

## 2. Concepts

- **Fixture** — one game (existing `fixtures` table, unchanged in role).
- **Fixture group** — the thing people enter. Two kinds:
  - **Occasion** (friendlies): one playing occasion. Usually one fixture; two or more when games are
    *linked* (home+away, home+home, away+away on the same date) or a reserve game is added. A player
    plays in **at most one** fixture of an occasion.
  - **Squad** (external leagues, Club Teams): a season-long squad. Contains many fixtures; a squad
    member can be selected for any number of them.
- **Entry** — a member's place in a group (the pool / the squad).
- **Selection** — an entry picked for a specific fixture, with team/position.

A friendly **reserve** is simply an entry with no selection in its group. Leagues and Club Teams have
no reserves — only selected teams.

UI names: friendlies stay "Friendlies"; external leagues "Leagues" (careful — the existing internal
Leagues feature, `leagues-supabase.ts`, is unrelated); squads for ad-hoc competitions are **"Club
Teams"** (avoid "Competitions", which is the internal hat-draw feature).

## 3. Schema

New migration `0072_fixture_groups.sql` (additive), then `0073_fixture_groups_cleanup.sql` after
cutover (drops) — same two-step pattern as lockers 0069/0070. Apply to Dev first, then Prod.

```sql
-- 0072_fixture_groups.sql
drop table if exists game_players;   -- 0013, never held data (verify count = 0 on prod first)

create table fixture_groups (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references seasons(id),
  kind          text not null check (kind in ('occasion','squad')),
  entry_mode    text not null check (entry_mode in ('self','manager')),
  label         text not null,             -- 'Arundel + Adastra', 'MSL 2027', 'Gladys Rowland 2027'
  squad_type    text check (squad_type in ('league','club_team')),   -- squads only
  league_type   text,                      -- 'MSL','BL','JSL','N/S A','N/S B' (league squads)
  status        text not null default 'active' check (status in ('active','archived')),
  created_by    text not null references users(username) on update cascade,
  created_at    timestamptz not null default now(),
  check ((kind = 'squad') = (squad_type is not null))
);

create table fixture_group_managers (
  group_id   uuid not null references fixture_groups(id) on delete cascade,
  username   text not null references users(username) on update cascade,
  added_by   text references users(username) on update cascade,
  added_at   timestamptz not null default now(),
  primary key (group_id, username)
);

alter table fixtures
  add column group_id   uuid references fixture_groups(id),
  add column reserve_of uuid references fixtures(id),
  add column result     text check (result in ('W','L','D'));
create index on fixtures (group_id);

create table fixture_entries (
  id                    uuid primary key default gen_random_uuid(),
  group_id              uuid not null references fixture_groups(id) on delete cascade,
  username              text not null references users(username) on update cascade,
  entry_source          text not null check (entry_source in ('self','buddy','manager')),
  entered_by            text not null references users(username) on update cascade,
  entered_at            timestamptz not null default now(),
  status                text not null default 'entered' check (status in ('entered','withdrawn')),
  withdrawn_by          text references users(username) on update cascade,
  withdrawn_at          timestamptz,
  preferred_fixture_id  uuid references fixtures(id) on delete set null,
  preference            text check (preference in ('preferred','only')),
  cancellation_acknowledged_at timestamptz,
  token                 text not null unique,   -- generated in app (crypto.randomBytes(32).hex)
  unique (group_id, username),
  check ((preferred_fixture_id is null) = (preference is null)),
  check ((status = 'withdrawn') = (withdrawn_at is not null))
);
create index on fixture_entries (username);

create table fixture_selections (
  id            uuid primary key default gen_random_uuid(),
  fixture_id    uuid not null references fixtures(id) on delete cascade,
  entry_id      uuid not null references fixture_entries(id) on delete cascade,
  selection     text not null check (selection in ('Y','O')),   -- O = playing for the opposition
  team          smallint,
  position      text check (position in ('S','1','2','3')),
  driving       text check (driving = 'Y'),   -- 'Y' = driving to this away game (a checkbox)
  car_number    text,
  confirmed_at  timestamptz,
  withdrawn_by  text references users(username) on update cascade,   -- squads: per-fixture withdrawal
  withdrawn_at  timestamptz,
  selected_at   timestamptz not null default now(),
  unique (fixture_id, entry_id)
);
create index on fixture_selections (entry_id);

create table friendlies_manage_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  username    text references users(username) on update cascade,
  action      text not null,
  group_id    uuid references fixture_groups(id) on delete set null,
  fixture_id  uuid references fixtures(id) on delete set null,
  old_status  text,
  new_status  text,
  details     jsonb
);

-- Availability planner link (§8)
alter table availability_groups
  add column fixture_group_id uuid unique references fixture_groups(id) on delete set null;
alter table availability_group_members
  add column active boolean not null default true;

alter table fixture_groups          enable row level security;
alter table fixture_group_managers  enable row level security;
alter table fixture_entries         enable row level security;
alter table fixture_selections      enable row level security;
alter table friendlies_manage_log   enable row level security;
```

Rules not expressible as plain constraints are enforced in the data layer / RPCs (§5):
fixtures in a group share a date (occasions only); `preferred_fixture_id` is in the entry's group;
occasion entries have at most one selection; `reserve_of` points to a fixture in the same group.

```sql
-- 0073_fixture_groups_cleanup.sql (after cutover is verified)
alter table fixtures
  drop column paired,
  drop column is_reserve,       -- replaced by reserve_of is not null
  drop column entered,
  drop column selected,
  drop column reserves;
```

Check every reader of those columns first (`fixtures-supabase.ts`, `reservations-supabase.ts`,
`data-export.ts`, `app/fixtures/manage/*`, `app/api/fixtures/manage/*`, help pages).

### Views

- `fixture_group_counts` — per group: entered (status entered), withdrawn, reserves (entered with no
  selection in the group — occasions only).
- `fixture_counts` — per fixture: selected (`Y`, not withdrawn), opposition (`O`), withdrawn.
- `friendly_player_stats` — per season, per member (§7).
- `league_player_stats` — per squad group, per member: appearances, withdrawals (§7).

## 4. Lifecycle

### Occasion groups (friendlies)

- Season Planning is untouched: it still creates plain fixtures with `group_id` null.
- **Open** a single fixture → creates a group of one (`kind occasion`, `entry_mode self`), sets
  `group_id`, sets the fixture to `O`.
- **Open as linked** — select 2+ fixtures on the manage page → one group. Rules: same date, all
  status `''`, none already grouped. Default label "Arundel + Adastra". Unlinked games on the same date
  (morning/afternoon/evening) are unaffected unless linked deliberately.
- **Close / reopen entries** act on the group: every fixture in the group moves together (`O` ↔ `X`).
- After close, each fixture moves independently: `X` Selecting → `S` Selected → `P` Played, or `C`/`A`.
  `fixtures.game_status` stays the per-fixture source of truth (Season Planning, Diary and website
  read it).
- **Add reserve game** — creates a fixture in the same group with `reserve_of` = the original. It
  supplies **both sides**: teams needed = teams parsed from format × 2 (e.g. "2 Triples" → 4 teams).
- **Cancel one fixture of a linked group** — the captain is asked "Return its N selected players to
  the reserves?". **Yes** → its selections are deleted, so those players rejoin the group pool and can be
  picked for the other game. **No** (the default — often there's no point) → selections are kept as
  they were, the fixture is just marked `C`. Selected players are notified as today either way.
- **Cancel a single-fixture group, or abandon any fixture** — no prompt; selections are kept (there's
  no other game to move to, and an abandoned game has already been played in part).
- **Link later** (merge two open groups) — blocked if any member is entered in both; lists them.
  Rare, but supported.
- **Unlink** (move a fixture out into its own group) — its selected players move with it; blocked
  while the group still has unallocated reserves who'd need a home; preferences pointing at the moved
  fixture are cleared. Rare, but supported.

### Squad groups

- No open/close: a squad group stays `active` all season (self-entry leagues accept joins/withdrawals
  throughout; manager-only Club Teams are edited by the manager).
- Each fixture: `''` → `X` Selecting → `S` Selected/published → `P` Played (`result` W/L/D) or `C`.
  `O` is not used for squad fixtures.
- **Leagues**: Admin/Captain creates "MSL 2027" etc. each season (`squad_type league`,
  `entry_mode self`), names its manager(s), and attaches that season's fixtures of the matching
  `fixture_type` (fixed dates, from Season Planning).
- **Club Teams**: any logged-in member can create one (`squad_type club_team`, `entry_mode manager`);
  creator becomes manager and can add co-managers. Manager builds the squad (no public Enter button)
  and handles withdrawals. Fixtures are created ad hoc as rounds come up (`fixture_type 'Club Team'`),
  opponent + home/away + date filled in when known; **date may be null** until agreed. Publish requires
  a date. No link to the Rowland bracket.

### Permissions

- Friendlies management: Captain, Admin (as today).
- Squad groups: anyone in `fixture_group_managers` for that group, plus **Captain and Admin for all
  groups**.

## 5. Entering and selecting

All entry creation (self, buddy, captain/manager) goes through one server function
(`addEntries` in the data layer, backed by an RPC that locks the group's fixtures row-wise so capacity
checks can't race).

| Check | Self / buddy | Captain / manager |
|---|---|---|
| Group open (occasions) / squad is self-entry | Block | n/a — can add any time |
| Gender eligibility (`canEnterGame`) | Block | Warn |
| On teas for **any fixture in this group** (friendlies only) | Block | Warn: "Jim is on teas for this game — add anyway?" |
| Already entered in this group | Block | Block |
| Capacity (sum of `max_capacity` of non-reserve fixtures in the group) | Block | Bypass (as today) |

Warnings are two-phase: the add call returns warnings; the UI confirms and resends with `confirm: true`.
The tea check is per group only — there are no checks on the tea rota side, and no time-of-day clash
logic. (Fixes today's gap: the tea check is client-side only on `app/friendlies/page.tsx`, so manual
adds, buddy entries and stale pages all bypass it.)

`entry_source`: `self` when the player enters themselves; `buddy` when entered via the buddy option
(`on_behalf_of`); `manager` when a captain/organiser adds them. `entered_by` records who.

### Preferences (occasions with 2+ fixtures only)

When entering a group with more than one fixture, the enter dialog lists its fixtures and the player
may choose one as **Preferred** or **Only** (or no preference). Single-fixture groups show nothing.
A preference for fixture X also covers any fixture with `reserve_of = X`.

On the selection page for fixture F: entries whose preference is `only` for another fixture are greyed
and selecting them gives a "marked Arundel only — select anyway?" warning; entries `preferred` for F are
flagged.

### Selection

- **Occasions**: the selection page for fixture F shows F's selections + the group's pool (entries with
  no selection in the group). Players selected into another fixture of the group don't appear.
  Selecting = insert a `fixture_selections` row (guarded: insert only succeeds if the entry still has no
  selection in the group — "Jim has just been selected for Adastra"); back to reserve = delete the row
  (team/position/driving cleared by definition). The per-fixture selection lock
  (`fixtures.locked_by/locked_at`) stays.
- **Close** no longer needs `markBlankSelectionsAsReserve` — unselected *is* reserve.
- **Squads**: the selection page for fixture F lists the whole squad with each member's availability
  hint (§8) and their appearances so far; pick into 2–3 teams. No reserves.
- **League teas** (home league fixtures): the manager picks two squad members (not necessarily playing)
  into `fixtures.tea_lead_username` / `tea_first_username`. If a tea person withdraws from the squad,
  their tea slots on upcoming fixtures are cleared and the manager is told. Publish checks both are
  still in the squad. The tea rota page stays Friendly-only (already filtered in `getTeaRotaList`).
  Away fixtures: no teas.

### Withdrawal

- **Occasion, group open**: entry row is deleted (as today — no withdrawn stat). Logged.
- **Occasion, after close**: `status = 'withdrawn'`, `withdrawn_by/at` set; any selection row is kept so
  the card can say "withdrew — was playing for Arundel". Captain emails as today.
- **Rejoin** (existing route): status back to `entered`, `withdrawn_*` cleared; selection (if kept)
  restored as selected-unconfirmed.
- **Captain "remove player"**: entry deleted, logged to `friendlies_manage_log`.
- **Squads**: leaving the squad = entry `status withdrawn`; dropping out of one fixture after being
  picked = `fixture_selections.withdrawn_at`.

### Confirm / acknowledge / tokens

- Confirm → `fixture_entries.confirmed_at` for friendlies (reserves confirm too and have no selection row); `fixture_selections.confirmed_at` for squad fixtures. Moving a friendly player between reserve and playing clears it (they confirm again), as before.
- Acknowledge cancellation → `fixture_entries.cancellation_acknowledged_at`.
- Token is created with the entry (no lazy column). Email links carry the fixture in the URL
  (`/friendlies/game/[tabDate]?token=`); validation = token matches an entry whose group contains
  that fixture, and the fixture date is not in the past (same expiry rule as today). Replaces
  `ensurePlayerToken` in `src/lib/email/friendlies.ts` (4 call sites).

## 6. UI

### Player list (`/friendlies`)

The data layer returns one card shape:

```ts
{ group: FixtureGroup | null, games: Fixture[], myEntry: Entry | null, mySelection: Selection | null }
```

- Not yet opened → `group` null, one game — renders as today.
- Opened single game → looks **exactly** as today; the group is invisible. Counts read as now
  ("15 entered · 12 selected · 3 reserves").
- Linked → one card with a line per game and a shared reserves line; each game line links to that
  game's page; "You: playing for Arundel" / "You: reserve for Arundel + Adastra" links to the right
  page.

Replaces `groupPairedGames()` / `GameOrPair` in `src/lib/friendlies-utils.ts`.

### Game page / match card (`/friendlies/game/[tabDate]`, `/friendlies/match-card/[tabDate]`)

One page per fixture, as today (teams, positions, driving, venue, contacts, petrol, dress). For linked
groups the reserves section reads "Reserves (shared with Adastra)" and appears on each game's page.

### Management

- Manage list shows groups explicitly (including groups of one), with per-fixture status.
- "Open as linked" multi-select action.
- Selection page as §5, plus the existing selection-helper analysis computed live (no cache).

### Leagues / Club Teams

- Player view: "My squads" — leagues I'm in (with join/withdraw for self-entry leagues), upcoming
  fixtures, my selections, published teams, "Can't make this one" button (writes an availability
  override for that date — §8).
- Manager view: squad list, fixtures (Club Teams: add fixture, date optional), selection page,
  publish (emails — same templates as friendlies), result W/L/D, "Ask squad" (§8).

## 7. Stats (computed, never stored)

No snapshot at close; no `_SelectionCache`. On a fixture's selection page, stats **exclude that
fixture's own group** so the captain's picks don't move the numbers they're looking at.

`friendly_player_stats` (occasion groups, active season — same rules as today's
`update-stats/route.ts`):

| Stat | Rule |
|---|---|
| name_down | Entries (not withdrawn) in groups that have closed, counted per entry: selected `Y` in a fixture not `C`/`A`, or unselected reserve in a group not wholly `C`/`A` |
| picked | Selection `Y`, fixture status `X`/`S`/`P`, entry not withdrawn |
| percent_played | picked / name_down (0 when name_down = 0) |
| future_entered | Entries in groups still open |
| withdrawn | Entries with status `withdrawn` |
| cancelled | Entries whose fixture (or, for reserves, whole group) is `C`/`A` |
| last 6 | Last 6 entries **by fixture date**, rendered with the legacy codes (P, R, O, C, A; `W` suffix if withdrawn) |

`O` (playing for the opposition) counts in neither name_down nor picked (as today); `player-stats`
reports it separately.

`league_player_stats`: per squad group — appearances, withdrawals. Kept entirely separate from
friendlies stats.

A `fixture_entry_codes` view emitting the legacy `PlayerEntryStatus` code per entry may be used during
cutover so UI types (`PlayerEntryStatus`, `last6Games`) keep working.

## 8. Availability

- **Weekly availability (squads)**: the selection page shows "Away — Holiday" for squad members with a
  busy `availability_overrides` row covering the fixture date (session `all` or matching). "Can't make
  this one" on a league fixture writes such an override. No new table.
- **Ask squad** (squad groups, managers only):
  - First click: creates an `availability_groups` row named after the squad, `fixture_group_id` set,
    members = current squad (non-withdrawn entries), and opens it in the planner.
  - Later clicks: same group; sync membership — add new squad members, set leavers `active = false`
    (never deleted, so past poll responses remain), reactivate rejoiners — then open it.
  - Inactive members are excluded from **new** polls only.
  - A linked availability group is **locked in the planner**: no manage/edit/delete/member actions;
    dates are typed into a new poll by the manager in the planner as normal.
  - Access: all squad managers + Captain + Admin (exception to the planner's `created_by` ownership).
  - Heat map: unchanged for now.

## 9. Import (2026 season)

One-off script `scripts/import-friendlies-2026.ts` (dry-run by default, `--apply` to write):

1. For each 2026 fixture with a `tab_name` and a per-game tab / Players column:
   - Group: create one per fixture; fixtures with `paired` `Y`/`C` on the same date share one group;
     `is_reserve` fixtures get `reserve_of` = their original and join its group.
   - Entries from the Players column (any non-blank code): `entry_source` `self` for `E`, `manager`
     for `M` (buddy entries can't be distinguished historically — recorded as `self`); `entered_by`
     = username / unknown; `entered_at` = fixture's open date if known, else import time.
   - Withdrawn (`…W`) → `status withdrawn`.
   - Selections from the game tab: `Y`/`O` → selection rows with team/position/driving/car; game-tab
     status `Y` → `confirmed_at`; ack column → `cancellation_acknowledged_at`; existing tokens kept.
   - `R` / blank → entry only (reserve). **`T`** → report for manual decision (should be none in 2026).
2. Conflicts (game tab vs Players column disagree; player in tab but not column or vice versa;
   username not in `users`) are written to a report, not guessed.
3. ManageLog tab rows → `friendlies_manage_log`.
4. Verify: per-player stats from the new views match the Players sheet's stat columns for 2026;
   discrepancies listed.

Earlier seasons are not imported.

## 10. Code changes

New `src/lib/fixture-groups-supabase.ts` (groups, managers, entries, selections, stats, tokens, log).
Keep return shapes (`GameSheetPlayer`, `PlayerEntry`, `PlayerStats`, `MatchCardData`) where possible
so routes mostly swap imports.

| Route / file | Change |
|---|---|
| `friendlies/enter`, `add-players`, `manage/add-player` | → `addEntries` (all checks, §5) |
| `friendlies/withdraw`, `rejoin`, `remove-player` | → entry status / delete + log |
| `friendlies/confirm`, `acknowledge`, `game/[tabDate]/token-action`, `validate-token` | → selection/entry columns, token rule §5 |
| `friendlies/games`, `entered-players`, `game/[tabDate]`, `match-card/[tabDate]`, `stats` | → read model + card shape |
| `manage/status` | open/open-linked/close/reopen at group level; cancel in a linked group optionally returns players to pool (§4); drop `createGameColumn`/`createGameSheet`/`markGamePlayerEntriesAs`/`markBlankSelectionsAsReserve`/`updateGameSheetStats` |
| `manage/update-selection`, `manage/game/[tabDate]`, `selection-helper` | → selections; helper computed live |
| `manage/move-reserve` | → generic "move selection within group" (covers reserve games and linked games) |
| `manage/add-reserve-game` | → fixture in same group with `reserve_of` |
| `manage/player-stats`, `games-stats` | → views |
| `manage/update-stats`, `manage/get-stats`, `manage/repair-entries` | **Delete** |
| `admin/cache` | Remove Games-cache stats |
| `src/lib/email/friendlies.ts` | Tokens from entries |
| `src/lib/diary-sheets.ts` | Read entries/selections instead of the Players sheet |
| `src/lib/friendlies-utils.ts` | Drop `groupPairedGames`; team count rule ×2 for reserve games |
| `src/lib/friendlies-sheets.ts` | **Delete**; remove `FRIENDLIES_SPREADSHEET_ID` from env |
| New: squad pages + APIs | Leagues / Club Teams (§4, §6, §8) |

## 11. Phasing

1. **Schema + friendlies parity on Postgres** — 0072, data layer, route cutover, card shape, groups of
   one, linked open, reserve-game-in-group, preferences, tea check server-side, live stats. Import 2026.
   Delete Sheets code. *(Removes the last Sheets dependency.)*
2. **0073 cleanup** — code done (2026-10-03): `paired` / `is_reserve` / stored counts no longer read or written; Fixtures Admin "Paired game" checkbox removed; linking is only "Open linked with …". Apply `0073` after Phase 1 is deployed and the 2026 import has run on Prod.
3. **External leagues** — squad groups, managers, self-entry, selection, league teas, publish/emails,
   results, availability hints, "Can't make this one".
4. **Club Teams** — manager-only squads, ad-hoc dateless fixtures, "Ask squad" planner link.

## 12. Deliberately out of scope

- Selection change history (who moved Jim from reserve to Arundel) — only add/withdraw/remove are
  recorded.
- Tea-rota-side clash checks; time-of-day/session clash logic.
- League tables / other clubs' results — W/L/D only.
- Link to the Rowland Cup bracket.
- "Either A or B but not C" preferences in 3+ game groups.
- Availability heat map changes.
- Importing seasons before 2026.

## 13. Phase 1 implementation notes (2026-10-03)

Where the build refined the design above — the code and `0072_fixture_groups.sql` are the
source of truth:

- **Confirmation** lives on `fixture_entries.confirmed_at` for friendlies (reserves confirm
  and have no selection row); `fixture_selections.confirmed_at` is for squad fixtures.
- **Driving** is a `'Y'` checkbox on the selection (the old tab column), not `D`/`B`.
- **`fixture_entries.car_number`** holds the player's offer at entry ("making my own way"
  = `O`); it's copied onto the selection when they're picked.
- **One selection per friendly entry** is enforced by the database: `fixture_selections.one_per_entry`
  + a partial unique index, so two captains can't pick the same reserve for linked games.
- **Counts** come from the `fixture_live_counts` view (merged into every `getFixtures` read);
  the stored `entered/selected/reserves` columns are now unused until 0073 drops them.
  **Stats** are computed in `src/lib/fixture-groups-supabase.ts` (not SQL views) from one
  season-wide read — simpler to keep in step with the rules in §7.
- **Entry RPC** `fixture_group_enter` locks the group row and enforces capacity + uniqueness;
  eligibility (teas, section) is checked first by `checkEntryEligibility`.
- **Legacy codes** (`E/M/D/P/R/C/A` + `W`) are derived on read (`getPlayerEntries`,
  `getGameSheet`) so the pages and diary kept working; nothing stores them.
- **`tab_name`** stays as the fixture's URL key (`/friendlies/game/[tabDate]`). Reserve games
  are still named `<tab>-2`, but identified by `reserve_of`.
- **Linking** is only "Open linked with …" on the manage page (Phase 2 removed the old
  `paired` flag and its Fixtures Admin checkbox, and the "Paired" column from the data export).
- **Import after 0073**: the import reads `paired` from the fixtures table while it exists,
  otherwise from the spreadsheet's Games tab (pre-August pairings only) — so run it on Prod
  before applying 0073.
- **Manage list** shows a linked occasion as one row while Upcoming/Open only; from Selecting
  on, each game has its own row (own selection/publish). The selection page shows the other
  games in the group with links.
- **Publish emails**: in a linked group the shared reserves are emailed with the last main
  game to be published, so nobody gets the same reserve email twice. Cancel emails go to the
  cancelled game's players, plus the reserves only when no other game in the group goes ahead.
- **Deleted**: `src/lib/friendlies-sheets.ts`, routes `manage/update-stats`, `manage/get-stats`,
  `manage/repair-entries`, `manage/move-reserve`; the Games-cache diagnostics.
- **Import**: `scripts/import-friendlies-2026.ts` (dry run by default; `--apply --as=<username>`).
  `migrate-members.ts` now wipes the new tables before users, so re-run the import after it.

## 14. Phase 3 implementation notes — external leagues (2026-10-03)

- **Squads** menu item → `/squads` (list, join/leave, Captain/Admin create), `/squads/[groupId]`
  (fixtures, published teams, squad list with appearances, organiser tools),
  `/squads/fixture/[fixtureId]` (organiser's team picker; members see the published team).
  Data layer `src/lib/squads-supabase.ts`; emails `src/lib/email/squads.ts`; APIs under `/api/squads`.
- **One shared N/S squad** feeds both N/S A and N/S B fixtures (`league_type = 'N/S'`). A player
  can't be picked for two of the squad's fixtures on the same date — the save reports a conflict.
- **Creating** a league squad (Captain/Admin) attaches every active-season fixture of its type(s);
  fixtures added later in Season Planning are attached automatically whenever the squad loads.
- **Organisers** = `fixture_group_managers`; any organiser, Captain or Admin can change them.
- **Lifecycle per fixture**: Not picked (`''`) → Picking (`X`, set on first save) → Published (`S`)
  → Played (`P`, W/L/D + optional scores) or Cancelled (`C`); Unpublish and Reinstate undo.
- **Availability**: "Can't make this one" writes a busy `availability_overrides` row for that date
  and session (from the fixture time); the picker shows any busy override (incl. holidays entered on
  the availability page) as "Away — <label>".
- **Dropping out** of a published fixture sets `fixture_selections.withdrawn_at` and emails the
  organisers. **Leaving the squad** clears picks and tea slots on upcoming fixtures and emails the
  organisers what needs replacing.
- **Teas** (home): two squad members in `tea_lead_username`/`tea_first_username`; publish refuses a
  tea person no longer in the squad. Non-playing tea people get their own email.
- **Diary**: published upcoming fixtures you're playing in (`league` item) or on teas for (`tea`).
- Not done: magic-link tokens in squad emails (links go to the logged-in pages); league stats
  beyond per-squad appearances; "Ask squad" (Phase 4).

## 15. Phase 4 implementation notes — Club Teams (2026-10-03)

- **Start a Club Team** on `/squads` (any member; they become its organiser, optional
  co-organisers). `squad_type = 'club_team'`, `entry_mode = 'manager'`: no Join button — the
  organiser adds/removes squad members. `/squads` lists League squads and Club Teams separately.
- **Fixtures** are added on the squad page as rounds come up (`fixture_type = 'Club Team'`):
  opponent from the club directory or free text, home/away, format, Ladies/Men, and a date that
  can stay blank ("Date TBC") until agreed. Edit details / Delete per fixture. Publishing needs a
  date; picking the team doesn't. Undated fixtures sort last and count as upcoming.
- **`getFixtures` leaves Club Team fixtures out** unless a caller asks for that type, so undated
  fixtures never reach the fixtures/clubs/friendlies pages.
- **Ask squad** (organisers, Captain, Admin — shown on league squads too) calls
  `syncSquadAvailabilityGroup`: creates the squad's availability group on first use
  (`availability_groups.fixture_group_id`), then each time adds new squad members, marks leavers
  `active = false` and reactivates rejoiners, and opens it in the planner.
- **Planner rules for a squad's group**: squad organisers/Captain/Admin can open it, create polls
  and see the heatmap (`canAccessGroup`); it can't be edited or deleted, and members can't be
  added/removed there (banner links back to the squad). Inactive members are left out of new poll
  invites, nudges and the heatmap, and appear on a poll's roster only if they'd already answered it.
- Poll-level actions (edit/conclude a poll) stay with the poll's creator and Admin, as before.

## 16. Squads use the friendlies picker (2026-10-07)

Replaces the separate squad picker (`/squads/fixture/...`, removed) — squad games are picked
and played through exactly the same pages as friendlies:

- **Selection**: `/friendlies/manage/game/[tabName]` (helper, swap, print picker, match card,
  lock, drafts, captain, driving). Squad fixtures get a stable `tab_name` and start as Selecting
  when they join their squad (`ensureSquadFixtureKeys`). Everyone in the squad is on the roster —
  picked players Y, the rest R. Stats column = this squad's games since joining (picked / games);
  `squadNote` shows "Away — <label>" (availability override) or "Playing <other N/S team> that day".
  Home league games show the two **Teas** selectors (saved with the selection).
- **Permissions**: `canManageGame` — Captain/Admin, or the squad's organisers — on the selection,
  lock, helper, message, pickup, add/remove player and publish routes. The proxy lets any logged-in
  member reach the game and print-picker pages; the APIs enforce it. Organisers who aren't Captains
  can only publish / republish / unpublish via the friendlies status route.
- **Publish**: the friendlies publish email (with Confirm/Withdraw links) to the **picked players
  only** (not the whole squad as reserves); teas get the squad teas email. Emails name the game
  "N/S A v Newick" / "<Club Team> v <opponent>".
- **Player actions** branch on the group kind (`confirmForFixture`, `withdrawFromFixture`,
  `rejoinFixture`): for squads they act on that fixture's selection only — withdrawing never takes
  anyone out of the squad; a squad reserve who withdraws is marked unavailable that day. Drop-outs
  email the squad's organisers (`notifySquadOrganisersOfDropOut`), not the Captains.
- **Squad page** keeps: fixture list with View game / Pick team links, Record result (W/L/D),
  Cancel, Reinstate, Club Team fixture add/edit/delete, Ask squad, squad + organiser management.
  "Remove completely" from a squad game's player list takes them out of the squad.
- **Game lookup**: `getGameByIdOrTab` finds Club Team games, which `getFixtures` leaves out.
