# Database Backup & Restore — Spec

Automated nightly backups of production Postgres to Google Drive, plus two tested
restore scripts (a dev drill and a genuine production restore). Based on the system
built for the sister TDC-Payroll Portal, adapted for this project. Revised
2026-10-10 after review. Not yet built.

**Why this matters:** production is on Supabase's **free plan, which keeps no
backups at all**. Until this is built, there is no copy of the database anywhere
except the occasional manual `npm run db-dump`.

---

## 1. Decisions (settled)

| Question | Decision |
|---|---|
| What runs the backup | GitHub Actions, nightly + manual trigger. The repo is **private**, so scheduled workflows are never auto-disabled for inactivity. A ~2 minute nightly job is ~60 Actions minutes a month — well inside the free allowance. |
| What is dumped | Full **schema + data**, plain SQL, gzipped. Schemas **`public` and `website`** (`website` holds `website.public_fixtures`, migration 0054/0071). Self-contained: restores without relying on the migrations. |
| Where it goes | A regular folder in `burgesshillbc@gmail.com`'s own Drive, **shared with no one**. |
| How it gets there | `rclone`, authenticated with **OAuth as the real account** (not a service account — see §2). |
| Retention | **90 days.** Size is well within the 15GB quota. Deleted files skip the Drive bin (§5). |
| Encryption | **Not in v1.** The folder is unshared and the account is the club's own. Can be added later (gpg with a passphrase secret) without changing anything else. |
| Failure alert | **Yes** — the workflow emails on failure using the club's existing Gmail SMTP login (§5). |
| Restore scripts | Two new scripts, each **hardcoded** to its own env file (dev → `.env.local`, production → `.env.prod.local`), separate from the existing data-only `db-restore.ts`. |

---

## 2. Why OAuth, not a service account

Any file a service account uploads is owned by the service account, and service
accounts have zero Drive quota — the upload fails with
`403 storageQuotaExceeded` regardless of how the folder is shared. That is a Drive
rule, not a Workspace one. The workarounds (Shared Drives, domain-wide delegation)
are Workspace-only and unavailable on a personal Gmail account.

So uploads must be made **as `burgesshillbc@gmail.com`** via OAuth, so the files are
owned by, and count against, that account's own 15GB.

The project already has OAuth credentials — `GOOGLE_OAUTH_CLIENT_ID` /
`GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REFRESH_TOKEN` (used by
`src/lib/drive.ts` for attachments). Reuse them **only if Step 0 confirms** all
three of:

1. the refresh token belongs to `burgesshillbc@gmail.com` (the code alone doesn't
   prove this — `drive.ts` calls it "the personal OAuth account");
2. it has full Drive scope (`https://www.googleapis.com/auth/drive`) — with the
   narrower `drive.file`, rclone can't write into a folder created by hand;
3. the OAuth app is **In production**, not **Testing** — a Testing app's refresh
   tokens expire after 7 days, which would make the nightly backup start failing
   silently a week after setup.

If any of those fails, mint a fresh token with rclone (Step 0, fallback).

---

## 3. The plan

Steps marked **[You]** need the Google / GitHub / Supabase dashboards; **[Claude]**
steps are code in this repo.

### Step 0 — Pre-checks (~15 min) [You]

1. **OAuth app status.** Google Cloud Console (signed in as `burgesshillbc@gmail.com`)
   → APIs & Services → OAuth consent screen. Note the project that owns
   `GOOGLE_OAUTH_CLIENT_ID`, and whether Publishing status is **In production**.
   If it says **Testing**, click *Publish app* (an "unverified app" warning on your
   own account is fine), then mint a fresh token via the fallback below — tokens
   issued while in Testing still expire.
2. **Token owner and scope.** Easiest check: in Drive, open the attachments folder
   (`GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID`) and look at the **Owner** of a recently
   uploaded attachment. If it is `burgesshillbc@gmail.com`, the token is that
   account's and it can already create folders and files, so scope is fine.
   If it's anyone else, use the fallback.
3. **Postgres version.** Supabase (production) → SQL Editor:
   `show server_version;` Note the major version (e.g. 15 or 17) — the workflow's
   `pg_dump` must be the same major version or newer.
4. **Session pooler URL.** Supabase (production) → Connect → **Session pooler**
   (port **5432**). `pg_dump` must use session mode — the transaction pooler
   (port 6543) breaks it. GitHub's runners only have IPv4 and the direct database
   address is IPv6-only, so a pooler URL is required either way.

**Fallback — fresh token (only if 1 or 2 failed):**

1. In the same Google Cloud project, confirm the Google Drive API is enabled.
2. Credentials → Create credentials → OAuth client ID → **Desktop app**.
3. On your PC: `rclone config` → new remote, type `drive`, enter that client
   ID/secret, scope **1 (full access)**, leave root folder blank, auto config **yes**.
   Log in as `burgesshillbc@gmail.com` in the browser and approve.
4. `rclone config show <remote-name>` — copy `client_id`, `client_secret` and the
   whole `token = {...}` JSON for Step 2.

### Step 1 — Drive folder (~2 min) [You]

Create **BHBC Database Backups** in `burgesshillbc@gmail.com`'s My Drive. Share it
with no one. Copy the folder ID from the URL
(`drive.google.com/drive/folders/<ID>`).

### Step 2 — GitHub secrets (~5 min) [You]

GitHub → repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `BACKUP_DATABASE_URL` | Production **session pooler** URL from Step 0.4 (port 5432) |
| `GDRIVE_CLIENT_ID` | `GOOGLE_OAUTH_CLIENT_ID`, or the fallback's client ID |
| `GDRIVE_CLIENT_SECRET` | `GOOGLE_OAUTH_CLIENT_SECRET`, or the fallback's secret |
| `GDRIVE_TOKEN` | Full rclone token JSON. Reusing the existing token: `{"access_token":"","token_type":"Bearer","refresh_token":"<GOOGLE_OAUTH_REFRESH_TOKEN>","expiry":"0001-01-01T00:00:00Z"}`. Fallback: paste rclone's token JSON as-is. |
| `GDRIVE_FOLDER_ID` | Folder ID from Step 1 |
| `ALERT_SMTP_USER` | The club Gmail address (`SMTP_USER` from `.env.prod.local`) |
| `ALERT_SMTP_PASSWORD` | Its app password (`SMTP_PASSWORD`) |
| `ALERT_EMAIL_TO` | Who gets failure emails (comma-separated) |

Also add a repository **variable** (not secret) `PG_MAJOR` = the version from
Step 0.3.

### Step 3 — The workflow [Claude]

`.github/workflows/db-backup.yml` — see §5 for the full behaviour. Commit, push to
a branch, merge to `main` (scheduled workflows only run from the default branch;
workflow files don't affect the Vercel build).

### Step 4 — Prove the backup (~10 min) [You, Claude on hand]

1. Actions → *Database backup* → **Run workflow** (on `main`).
2. Check it goes green and `backup-YYYY-MM-DD-HHMM.sql.gz` appears in the Drive
   folder at a sensible size.
3. Run it again with **Test failure alert** ticked — it should fail deliberately and
   the alert email should arrive.
4. Download the file, open it (7-Zip), and check `-- PostgreSQL database dump complete`
   appears near the end.

If the upload fails with an insufficient-scope / `invalid_grant` error, go back to
Step 0's fallback.

### Step 5 — The restore scripts [Claude]

`scripts/db-drill-restore-dev.ts` and `scripts/db-restore-production-full.ts` —
see §6. Plus npm scripts `db-drill-dev` and `db-restore-production-full`.

### Step 6 — Dev disaster-recovery drill (~20 min) [You, Claude on hand]

1. Download last night's backup from Drive into `backups/`.
2. `npm run db-drill-dev` → pick the file → confirm.
3. Check: the script's row-count report matches production; log in to the app on
   `npm run dev` (pointed at Dev) and click round Members, Friendlies, Squads,
   Availability; check `/api` reads work (PostgREST schema reload, §6).

Do not move on until this passes.

### Step 7 — Production restore test (~20 min, quiet time) [You, Claude on hand]

1. Make one small, reversible change in production (e.g. edit an announcement's
   text) and note it.
2. Run the workflow manually so Drive has a backup from *before* the change — or
   use one taken before it.
3. `npm run db-restore-production-full` → pick that backup → type the phrase.
4. Confirm the change reverted, the app works, and the safety backup the script
   took first is in `backups/` with a sane size and the `dump complete` line near the end.

### Step 8 — Docs [Claude]

Update `specs/BHBC_Developer_Runbook.md` (technical: setup, secrets, restore
procedure, token re-minting) and `specs/BHBC_Committee_Overview.md` (plain English:
backed up nightly, kept 90 days, who gets alerts, how a restore happens), replacing
any "no backups" gap note.

---

## 4. Ongoing

- **Failure email** → read the run's log. Most likely causes: expired/revoked token
  (re-mint via Step 0 fallback, update `GDRIVE_TOKEN`), changed database password
  (update `BACKUP_DATABASE_URL`), or a Supabase major-version upgrade (bump
  `PG_MAJOR`).
- **Quarterly:** re-run the dev drill (Step 6) — a backup that has never been
  restored isn't proven.
- Changing the Supabase database password, or revoking the club account's app
  access in Google, breaks the backup until the secret is updated.

---

## 5. Workflow detail (`.github/workflows/db-backup.yml`)

- **Triggers:** `schedule` nightly at 02:30 UTC; `workflow_dispatch` with a boolean
  input `test_failure_alert`.
- **Runner:** `ubuntu-latest`, `timeout-minutes: 20`, `concurrency` group so two runs
  never overlap. `permissions: contents: read` only. Never uploads the dump as a
  GitHub artifact and never prints it to the log.
- **Install client:** add the PGDG apt repo and install
  `postgresql-client-${{ vars.PG_MAJOR }}`; call that version's `pg_dump` by full path
  (`/usr/lib/postgresql/$PG_MAJOR/bin/pg_dump`), not the runner's default.
- **Dump:**
  ```
  set -euo pipefail
  pg_dump "$BACKUP_DATABASE_URL" --schema=public --schema=website \
    --no-owner | gzip -9 > "backup-$STAMP.sql.gz"
  ```
  (`pipefail` so a failing `pg_dump` can't "succeed" as a tiny gzip.) Owner
  statements are dropped (`--no-owner`) so the file restores into any Supabase
  project; grants are kept.
- **Verify before upload:** `gzip -t` passes; size above a floor (50 KB); the last
  10 lines contain `-- PostgreSQL database dump complete` (recent pg_dump versions
  add a `\unrestrict` line after it, so not literally the last line).
- **Upload** — credentials as rclone environment variables, never in a connection
  string (the token JSON contains commas and colons, which break that syntax):
  ```
  env:
    RCLONE_DRIVE_CLIENT_ID: ${{ secrets.GDRIVE_CLIENT_ID }}
    RCLONE_DRIVE_CLIENT_SECRET: ${{ secrets.GDRIVE_CLIENT_SECRET }}
    RCLONE_DRIVE_TOKEN: ${{ secrets.GDRIVE_TOKEN }}
    RCLONE_DRIVE_ROOT_FOLDER_ID: ${{ secrets.GDRIVE_FOLDER_ID }}
    RCLONE_DRIVE_SCOPE: drive
  run: rclone copy backup-*.sql.gz :drive: -v
  ```
  rclone will log that it can't save the refreshed access token — harmless; it uses
  the refresh token each run.
- **Retention:**
  `rclone delete :drive: --min-age 90d --include "backup-*.sql.gz" --drive-use-trash=false -v`
  (without `--drive-use-trash=false`, deleted backups sit in the bin for 30 days and
  still count against the quota). Runs only after a successful upload, so a broken
  night never deletes old backups.
- **Test failure:** if `test_failure_alert` is ticked, a step runs `exit 1` after the
  dump (nothing uploaded).
- **Alert:** final step `if: failure()` sends an email via `smtp.gmail.com:587` using
  `ALERT_SMTP_USER`/`ALERT_SMTP_PASSWORD` to `ALERT_EMAIL_TO`, subject
  "BHBC database backup FAILED", body with the run URL. (Using a pinned version of a
  standard send-mail action, or a short `curl --url smtp://…` step.)

---

## 6. Restore scripts detail

Both in TypeScript, run via `tsx`, each loading **one hardcoded env file** itself
(not via the npm wrapper's `dotenv -e`), so neither can be pointed at the wrong
database by running the wrong npm script. Both print the target
`SUPABASE_DATABASE_NAME` and host before asking anything.

**Shared behaviour:**

- Lists `backups/*.sql.gz` (newest first) and asks which to restore. Needs a new
  lister — `scripts/lib/backups.ts`'s `listBackups()` only finds `.dump`; add an
  extension parameter.
- Uses `pgTool('psql')` / `pgTool('pg_dump')` from `scripts/lib/postgres-tools.ts`
  (Windows local paths, `POSTGRES_BIN_DIR` override) — the local PostgreSQL 18 tools
  can restore and dump older servers.
- Connects via that env file's `SUPABASE_POOLER_URL`; warns and stops if it's the
  transaction port (6543).
- **Wipe + restore in one transaction:** one `psql -v ON_ERROR_STOP=1` process whose
  stdin is `BEGIN;` + `DROP SCHEMA IF EXISTS website CASCADE; DROP SCHEMA IF EXISTS public CASCADE;`
  + the gunzipped dump + `COMMIT;`. The dump recreates both schemas (and their
  grants), so there's no expected "schema already exists" error, and **any error
  stops psql before `COMMIT` — the drop is rolled back and the database is left as it
  was.** (If the dump ever turns out to contain statements that can't run inside a
  transaction, Step 6 will show it; fall back to drop-then-restore with the safety
  backup as the undo.)
- **Circular FK:** not an issue here. A plain full dump creates tables, loads all
  data, *then* adds foreign keys, so the
  `availability_events.concluded_slot_id` ↔ `availability_slots.event_id` loop that
  the data-only `db-restore.ts` works around doesn't arise. Confirmed for real by
  Step 6.
- **After restore:** `NOTIFY pgrst, 'reload schema';` so the app's Supabase API sees
  the rebuilt tables; then print row counts for key tables (members/profiles,
  fixtures, fixture_entries, fixture_selections, availability_events, …).
- **Streaming:** gunzip → psql via pipes, never buffering a whole dump in memory
  (`execFileSync` hits ENOBUFS on large output). Full psql output goes to
  `backups/restore-<target>-<stamp>.log`; the terminal shows progress and the
  summary only.

**`db-drill-restore-dev.ts`** — hardcoded to `.env.local`. Refuses to run if that
file's database name/host matches `.env.prod.local`'s. Confirmation: type `DEV`.

**`db-restore-production-full.ts`** — hardcoded to `.env.prod.local`.

1. Shows target, chosen file, and the file's date.
2. **Safety backup first, mandatory:** full `pg_dump` (same flags as the workflow)
   of current production, streamed through gzip to
   `backups/safety-before-restore-<stamp>.sql.gz`, and verified (`dump complete` line
   near the end, size floor). If it fails, stop — nothing is touched.
3. Confirmation: type `RESTORE PRODUCTION` exactly.
4. Restore as above, then reminds you to check the app and that the safety file can
   undo the restore by running the script again with it.

Not changed: `db-dump.ts` / `db-restore.ts` (data-only refresh between environments)
stay as they are.

---

## 7. Notes

- `website` is the only extra schema today; if a migration ever adds another, add a
  `--schema=` for it to the workflow and restore drop list.
- Supabase's own platform schemas (auth, storage, realtime, …) are deliberately not
  dumped — the app uses NextAuth and Google Drive, not Supabase Auth/Storage.
- The `supabase_migrations` history table isn't in the dump. Migrations here are
  applied by hand, so restoring into a brand-new project only needs the dump; if the
  Supabase CLI's history ever matters, re-record it with `supabase migration repair`.
