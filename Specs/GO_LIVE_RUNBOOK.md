# Go-Live Runbook

Practical, step-by-step companion to `specs/Phase_0_1_Migration_Plan.md`'s "Cutover
Procedure" — that document explains the *design decisions* (no dual-write, why a
single deliberate cutover window); this one is the actual commands, in order, proven
against a real dry run of the full sequence on the dev database on 2026-08-17.

No dual-write, by design — see the plan doc for why. That means there's no live
fallback once people start using the cutover; the honest rollback options are "fix
forward fast" or "redeploy the previous Sheets-backed version" (only clean if the
write-freeze held).

---

## 1. Environments

| | Name | Reference ID | Region |
|---|---|---|---|
| Dev | BH-Bowls Dev | `ofqepimyooesuckyrane` | West Europe (London) |
| Prod | BH-Bowls Production | `ovmaeycnlubjxsyrswoz` | West Europe (London) |

(`npx supabase projects list` shows these again anytime, plus which one is currently
linked — check this before running anything destructive.)

- **Dev** — Supabase project used for local development and Vercel Preview
  deployments. Safe to break, reset, and fill with test data. Real member emails
  never live here (see §5, redaction).
- **Prod** — created 2026-08-17. Not yet seeded as of writing (§3). Holds real member
  data once it is. Vercel Production points here.

**Vercel**: `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are set twice in Project
Settings → Environment Variables — once scoped to **Production** (prod project),
once scoped to **Preview** (dev project). No code changes needed; Vercel injects the
right pair per deployment automatically based on which environment it's building for.

**Local**: `.env.local` stays pointed at **dev** permanently — it's what `npm run dev`
and most script runs use by default. A separate `.env.prod.local` (never committed —
covered by the repo's `.env*` gitignore rule) holds prod credentials, used only when
explicitly passed:
```powershell
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-members.ts --no-redact
```
`npm run live` runs the local dev server against `.env.prod.local` instead of
`.env.local`, with a startup warning — use sparingly and deliberately.

Both files set `SUPABASE_DATABASE_NAME` to a plain human label matching the real
project name (`BH-Bowls Dev` / `BH-Bowls Production`) — `redact-dev-database.ts`
prints this alongside the raw `SUPABASE_URL` before its confirmation prompt, so
there's a name you can actually recognise at a glance, not just an opaque project
ref, in the one moment that matters most for checking you're pointed at the right
database.

---

## 2. Create the prod database

Supabase CLI, installed as a project devDependency (already done — `supabase` is in
`package.json`):

```powershell
npx supabase login
npx supabase link --project-ref ovmaeycnlubjxsyrswoz
```
(Prod's reference ID — see the table in §1. You'll be prompted for the database
password set when the project was created.)

Apply all 47 migrations in one command — confirmed working against the dev project on
2026-08-17, applied all `supabase/migrations/*.sql` files in order with no manual
intervention:

```powershell
npx supabase db reset --linked
```
Two warnings are expected and harmless: `no files matched pattern: supabase/seed.sql`
(this project doesn't use Supabase's seed-file mechanism) and a Docker warning about
an optional local schema-diff cache (irrelevant — this resets the *remote* linked
project, not a local one).

**Prod was created and linked 2026-08-17** (`npx supabase projects list` shows which
project is currently linked — the ● column). To switch the CLI back to dev for local
work: `npx supabase link --project-ref ofqepimyooesuckyrane`. Always check which
project is linked before running anything destructive — `db reset --linked` targets
whichever one that is, with no additional confirmation prompt of its own.

---

## 3. Seed prod from live Sheets

One sitting, in this exact order — verified against every script's own FK dependency
comments. Scripts 6–15 aren't order-dependent relative to each other, only relative to
members/leavers (3–4).

```powershell
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-config.ts
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-clubs.ts --no-redact
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-members.ts --no-redact
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-leavers.ts --no-redact
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-applications.ts --no-redact
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-fixtures.ts
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-rotas.ts
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-availability.ts
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-renewals.ts
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-competitions.ts
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-two-hundred-club.ts
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-announcements.ts
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-suggestions.ts
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-leagues.ts
npx dotenv -e .env.prod.local -- npx tsx scripts/migrate-invite-games.ts
```

**`--no-redact` only on the 4 that redact by default** (clubs, members, leavers,
applications) — everything else already writes real data unconditionally, no flag
needed. Getting `--no-redact` wrong (forgetting it) is safe — the script just
defaults to writing fake emails/passwords into prod, which is obviously wrong but
easy to spot and re-run; there's no flag that makes the *opposite* mistake possible.

**Before step 2** (`migrate-clubs.ts`), confirm `migrate-contacts-to-club-contacts.ts`
has already been run against the real production Match Day Contacts spreadsheet at
some point — it's a Sheets-to-Sheets prep step (not a Postgres migration), producing
the "Club Contacts" tab that `migrate-clubs.ts` reads from. Check that tab exists and
looks right on the live sheet; this script is not part of the numbered sequence above.

`.env.prod.local` needs the real spreadsheet IDs (`MEMBERS_SPREADSHEET_ID`,
`LEAGUES_SPREADSHEET_ID`, etc.) alongside the prod Supabase credentials for this step
— these scripts read live Sheets regardless of what the deployed app needs.

**Run one at a time.** A failure partway through is much easier to diagnose
immediately than after all 15 have run — check the printed row counts and any
warnings before moving to the next one. (`migrate-availability.ts` in particular
validates group_id/event_id against a stale reference and skips it with a clear
warning rather than crashing the batch — if you see that kind of warning on any
script, it's telling you exactly which sheet row is the problem.)

---

## 4. Verify before cutting over

- Row counts roughly match what you'd expect from the source sheets.
- Spot-check a sample of members, a few renewals, a competition bracket.
- **Real login testing against the new Postgres-backed auth path** — this is the one
  category of bug where "found in testing" vs "found in production" is the difference
  between an annoyance and every member (admins included) locked out simultaneously.
- Re-test every auth-adjacent surface on the preview deployment pointed at prod data
  before merging: temp-password forced change, password reset token flow, rate
  limiting, impersonation start/stop, session refresh on a mid-session role change.

---

## 5. Backup, and updating dev from live afterward

**All of the raw commands below are wrapped as npm scripts** — `npm run db-login`,
`db-list`, `db-link-dev`, `db-link-production`, `db-reset-dev` / `db-reset-production`
(link + `db reset --linked` in one step — clean, empty schema, §2's command under a
shorter name), `db-dump` (prompts for a name, Enter accepts a timestamp default, saves
to `backups/<name>.dump` — that folder is gitignored, real member data never belongs
in git history), `db-restore-dev` / `db-restore-production` (both run
`scripts/db-restore.ts`, which lists what's in `backups/`, prompts for which one,
checks the target's `users` row count and warns loudly if it isn't empty — a restore
never resets anything itself, so an already-populated target just means every row
fails as a harmless-but-noisy duplicate-key conflict, run `db-reset-dev` /
`db-reset-production` first for a clean baseline — handles the circular-FK drop/re-add
automatically, and asks for typed confirmation before touching anything; on a
successful dev restore it also prints the `redact-dev-database.ts` command below as a
reminder, since restored data is real member data until that's run — see its own
header comment for the full reasoning). They need `SUPABASE_POOLER_URL` filled in on
both `.env.local` and `.env.prod.local` (Dashboard → Connect → Shared Pooler, per
below) — everything past this paragraph is the manual version, kept for reference/
troubleshooting, not the day-to-day path once the scripts are working.

**`npx supabase db dump --linked` doesn't work on this machine** — it needs Docker
Desktop (which isn't installed) even when targeting a remote linked project via
`--linked`. Use `pg_dump`/`psql` directly instead — standard Postgres client tools,
installed via the official Windows installer
(https://www.postgresql.org/download/windows/, "Command Line Tools" component is
enough). Confirmed working 2026-08-17 at `C:\Program Files\PostgreSQL\18\bin\`.

**The "Direct connection" string from the dashboard's Connect panel doesn't work
either** — it's IPv6-only unless you pay for the Dedicated IPv4 add-on ($4/month),
and most networks (including this one) can't resolve/route to it, failing with
`could not translate host name ... Name or service not known`. **Use the Shared
Pooler connection string instead** — it accepts IPv4 by default, no add-on needed.
Find it in the dashboard's Connect panel (a connection-type selector alongside
"Direct" — not one of the Framework/Server/ORM/MCP tabs, which are for other
purposes entirely), **on the specific project you're connecting to** — don't reuse
one project's string with just the project ref swapped in for the other; the pooler
node number isn't consistent across projects (confirmed: prod is `aws-0-eu-west-2`,
dev is `aws-1-eu-west-2`, same region, different node). The shape is otherwise the
same: username becomes `postgres.<project-ref>` (project ref appended) rather than
plain `postgres`, host is `aws-<N>-<region>.pooler.supabase.com` rather than
`db.<project-ref>.supabase.co`.

**Always scope `pg_dump` to `--schema=public --data-only`** — a full dump captures
Supabase's own internal platform schemas too (`auth`, `storage`, `realtime`, `vault`,
etc.), which every Supabase project auto-provisions itself at creation time. Restoring
those again always collides ("already exists"), and you don't have permission to alter
Supabase's own managed schemas anyway. None of that is our data — schema structure
for our own tables always comes from `supabase/migrations/*.sql` via `db reset
--linked` (§2), never from a raw dump; `pg_dump` here is only ever for the actual
`public`-schema data.

**Also use `--format=custom` (a `.dump` file, not plain `.sql`)** — `public` has one
genuine circular FK pair, `availability_events.concluded_slot_id` →
`availability_slots` and `availability_slots.event_id` → `availability_events` (the
same reason `migrate-availability.ts` inserts events, then slots, then backfills
events in a deliberate second pass — a plain `pg_dump`/`psql` restore doesn't know
that trick). Custom format lets restore disable FK-checking triggers for the load
instead:

```powershell
"C:\Program Files\PostgreSQL\18\bin\pg_dump" "postgresql://postgres.ovmaeycnlubjxsyrswoz:[password]@aws-0-eu-west-2.pooler.supabase.com:5432/postgres" --schema=public --data-only --format=custom -f backup.dump
```

Restore, if ever needed, uses `pg_restore` (not `psql`, since it's custom format now)
— **`--disable-triggers` does NOT work on Supabase**, confirmed 2026-08-17: the
connecting role gets `permission denied: "RI_ConstraintTrigger_..." is a system
trigger` — Supabase's managed Postgres doesn't grant real rights to disable FK
constraint triggers, even on tables you own. Instead, drop the one circular FK
constraint manually before restoring, restore without any special flag, then re-add
it:

```powershell
"C:\Program Files\PostgreSQL\18\bin\psql" "postgresql://postgres.<project-ref>:[password]@aws-<N>-eu-west-2.pooler.supabase.com:5432/postgres" -c "ALTER TABLE public.availability_events DROP CONSTRAINT availability_events_concluded_slot_id_fkey;"

"C:\Program Files\PostgreSQL\18\bin\pg_restore" -d "postgresql://postgres.<project-ref>:[password]@aws-<N>-eu-west-2.pooler.supabase.com:5432/postgres" backup.dump

"C:\Program Files\PostgreSQL\18\bin\psql" "postgresql://postgres.<project-ref>:[password]@aws-<N>-eu-west-2.pooler.supabase.com:5432/postgres" -c "ALTER TABLE public.availability_events ADD CONSTRAINT availability_events_concluded_slot_id_fkey FOREIGN KEY (concluded_slot_id) REFERENCES availability_slots(id);"
```

**Restoring into a target that already has data in those tables will hit "relation
already exists"/duplicate-key errors** — reset the target's schema first
(`db reset --linked`, §2) for a clean, empty baseline before restoring a data-only
dump into it. Two harmless exceptions: `config` and `petrol_bands` get their rows
seeded directly by the migration files themselves (not by any data-sync), so a fresh
`db reset --linked` already recreates them — restoring prod's copies of those same
rows always hits a duplicate-key conflict on just those two tables. Expected, not a
real problem; `pg_restore` reports it as `errors ignored on restore: 2` and restores
everything else normally.

(Password is the Postgres database password, set at project creation — Supabase only
shows it once; reset it from the dashboard if lost. Different from
`SUPABASE_SERVICE_ROLE_KEY`, which is a JWT for the client library, not valid here.)

**Updating dev from live, post-cutover** — once Sheets are retired (§7), the
`migrate-*.ts` scripts stop being usable as a dev-refresh mechanism (nothing left to
read from). From that point on, refreshing dev means a genuine database-to-database
copy:

1. **Re-link the CLI to dev first** — `--linked` always targets whichever project is
   currently linked, and it's easy to still be linked to prod from an earlier step:
   ```powershell
   npx supabase link --project-ref ofqepimyooesuckyrane
   ```
2. Reset dev's schema (`db reset --linked`, now correctly targeting dev, §2) — clean,
   empty tables matching the migrations exactly, ready for a data-only restore.
3. Dump prod: the `pg_dump` command above, pointed at prod's pooler connection string
   (this one connects directly with its own connection string, not via `--linked`, so
   the CLI's linked project doesn't matter for this step).
4. Restore into dev: the drop-constraint / `pg_restore` / re-add-constraint sequence
   above, pointed at dev's pooler connection string instead — this brings real member
   emails and password hashes into dev, which is not safe to leave as-is. Expect the
   `config`/`petrol_bands` duplicate-key warnings (harmless, see above).
5. **Redact immediately**:
   ```powershell
   npx dotenv -e .env.local -- npx tsx scripts/redact-dev-database.ts
   ```
   Scrambles every password hash to a shared known test password and cycles every
   member/leaver/application/club-contact email across the 9 owned aliases — same
   scope and same values as the migration scripts' own default redaction (§3), just
   applied to rows already in the database instead of rows being freshly inserted.
   Requires typed confirmation and prints the target `SUPABASE_URL` before doing
   anything — always read that URL before typing "redact", since this script has no
   way to know which project you meant to target.

---

## 6. The cutover window

One deliberate sitting, per the plan doc's design (no dual-write):

1. **Freeze writes** — flip maintenance mode on via `/admin/config` (the
   `maintenance_mode` config key `isMaintenanceModeOn()` reads).
2. **Re-run §3's script sequence once more** for a final delta, if meaningful time
   passed since it was last run — captures any last-minute Sheets edits.
3. **Verify** — re-check row counts and do one final real login test.
4. **Merge `feature/postgres-migration` → `main`** — needs an explicit go-ahead at
   the time, separate from everything else in this runbook; `main` auto-deploys to
   Production.
5. **Verify the live deployment** — hit a few real pages/routes, confirm no errors.
6. **Flip maintenance mode off.**

## 7. Aftercare

- Export the old Sheets as a static backup (download/copy, not just leave them live),
  then actually lock or archive them — not leave them editable indefinitely as a
  "just in case" crutch.
- Watch logs closely for the first while (Vercel → the deployment's Logs tab, scoped
  to Production; remember it's per-request, not retroactive — watch it live rather
  than checking back later).
- Remove the 6 spreadsheet env vars from Vercel Production entirely (they were only
  ever needed for the one-off script runs in §3, never by the running app) —
  `FRIENDLIES_SPREADSHEET_ID` and the Google service account credentials stay, still
  genuinely needed until Friendlies' own migration (Step 4b).
- On rollback: no dual-write means no live fallback — "fix forward fast" or redeploy
  the previous Sheets-backed version, which is only clean if the write-freeze held.
