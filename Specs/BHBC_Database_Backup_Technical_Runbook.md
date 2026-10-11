This is the technical companion to the **BHBC Database Backup Overview**, which is written for the Committee. It sits alongside the **BHBC Developer Technical Runbook** (`Specs/BHBC_Developer_Runbook.md`).

This document alone should be enough to understand, troubleshoot or rebuild the backup system from scratch, without any memory of how it was built. It is written for a different developer, or a fresh AI session with no history, picking it up because something broke.

The design history and the reasoning behind each decision are in `Specs/DATABASE_BACKUP_SPEC.md`.

------------------------------------------------------------------------

## 1. Architecture

A scheduled GitHub Actions workflow runs every night. It dumps production Postgres with `pg_dump`: the `public` and `website` schemas, schema plus data, as plain SQL, gzipped. It verifies the file, then uploads it with `rclone` to a regular Google Drive folder in the club's own `burgesshillbc@gmail.com` account, authenticating with **OAuth as that account**. Backups older than 90 days are deleted. If any step fails, an email is sent.

Two local TypeScript scripts restore a backup:

- one into the **dev** database only (a drill);
- one into **production**, with a mandatory safety backup first.

Both wipe and rebuild the two schemas in **one transaction**.

**Why this exists:** production Supabase is on the free plan, which keeps **no platform backups**. This is the only backup.

| | |
|---|---|
| Production project | `ovmaeycnlubjxsyrswoz` (Postgres 17.6 when built) |
| Dev project | `ofqepimyooesuckyrane` (also used by Vercel Preview / `staging`) |
| Repository | `BH-Bowls/bhbc-membership-portal`, private |
| Drive folder | **BHBC Database Backups** in `burgesshillbc@gmail.com`'s My Drive, shared with no one |
| Backup size | about 0.5 MB gzipped (October 2026) |

------------------------------------------------------------------------

## 2. The GitHub Actions workflow

**File:** `.github/workflows/db-backup.yml`. It is on `main` only; scheduled workflows run only from the default branch. Changing this file doesn't trigger a Vercel build.

**Triggers:**

- `schedule: '30 2 * * *'`: 02:30 UTC, which is 03:30 UK time in summer. GitHub can start scheduled runs some minutes late.
- `workflow_dispatch`: the **Run workflow** button. It has one tick box, **test_failure_alert**, which fails the run on purpose after the dump, so the alert email can be tested. Nothing is uploaded on a test run.

**Job settings:**

- `ubuntu-latest`, with `timeout-minutes: 20`;
- `permissions: contents: read`;
- a `concurrency` group, so two runs never overlap.

The dump is never uploaded as a GitHub artifact and never printed to the log.

**Steps, in order:**

1.  **Check settings.** Fails at once if the repository variable `PG_MAJOR` isn't set.
2.  **Install pg_dump and rclone.** Adds PostgreSQL's own apt repository (PGDG) and installs `postgresql-client-$PG_MAJOR`.
    - The workflow calls that version's `pg_dump` by its full path, `/usr/lib/postgresql/$PG_MAJOR/bin/pg_dump`.
    - The runner has an older `pg_dump` on its PATH, and `pg_dump` refuses to dump a server newer than itself. A bare `pg_dump` would therefore break.
3.  **Dump database:**

        set -euo pipefail
        pg_dump "$BACKUP_DATABASE_URL" --schema=public --schema=website --no-owner | gzip -9 > backup-<UTC stamp>.sql.gz

    - `pipefail` makes a failing `pg_dump` fail the step. Without it, the step would "succeed" with a near-empty gzip file.
    - `--schema=public --schema=website` limits the dump to the app's own schemas. `website` holds `website.public_fixtures` and the tables the public website reads.
    - Supabase's own schemas (`auth`, `storage`, `realtime`, …) are deliberately left out. The app uses NextAuth and Google Drive, not Supabase Auth or Storage, and restoring those schemas would clash with the ones Supabase manages.
    - `--no-owner` drops ownership statements, so the file restores into any Supabase project. Grants are kept.
4.  **Verify dump.** Three checks:
    - `gzip -t` passes;
    - the file is at least 50 KB;
    - the last 10 lines contain `-- PostgreSQL database dump complete`.

    It is the last 10 lines, not the last line, because `pg_dump` 17.6 and later add `\restrict` / `\unrestrict` lines after it.
5.  **Test failure alert**, only if the tick box was ticked: `exit 1`.
6.  **Upload to Google Drive:** `rclone copy "$FILE" :drive: -v`.
    - The credentials come from `RCLONE_DRIVE_*` environment variables (§3), never from an rclone config file or a connection string. The token is JSON with commas and colons, which break rclone's `:drive,key=value:` syntax.
    - rclone logs that it can't save a refreshed access token. That is harmless, because it uses the refresh token every run.
7.  **Delete backups older than 90 days:**

        rclone delete :drive: --min-age 90d --include "backup-*.sql.gz" --drive-use-trash=false -v

    - `--drive-use-trash=false` matters: without it, deleted files sit in the Drive bin for 30 days and still count against the 15 GB quota.
    - The `--include` pattern means only nightly files are ever deleted. Anything else in the folder is left alone.
    - This step only runs after a successful upload, so a broken night never deletes old backups.
8.  **Email failure alert**, `if: failure()`. Sends a plain-text email with curl over `smtp://smtp.gmail.com:587` (STARTTLS), using the club Gmail login.
    - Subject: **"BHBC database backup FAILED"**. The body contains the run's URL.
    - `ALERT_EMAIL_TO` can hold several comma-separated addresses.
    - GitHub also sends its own "workflow failed" notification to the account that owns the workflow. Two emails per failure is expected.

------------------------------------------------------------------------

## 3. GitHub secrets and variables

Set these in GitHub → repository → Settings → Secrets and variables → Actions.

**Secrets:**

| Secret | What it holds |
|---|---|
| `BACKUP_DATABASE_URL` | Production's **session pooler** URL, port **5432**: Supabase → Connect → Session pooler. It is the same value as `SUPABASE_POOLER_URL` in `.env.prod.local`. Don't use the transaction pooler (port 6543), which breaks `pg_dump`. Don't use the direct address either, which is IPv6-only, and GitHub runners only have IPv4. |
| `GDRIVE_CLIENT_ID` | The OAuth client ID: the same value as the app's `GOOGLE_OAUTH_CLIENT_ID` |
| `GDRIVE_CLIENT_SECRET` | The OAuth client secret: the same value as `GOOGLE_OAUTH_CLIENT_SECRET` |
| `GDRIVE_TOKEN` | An rclone token JSON built from the app's existing refresh token (`GOOGLE_OAUTH_REFRESH_TOKEN`): `{"access_token":"","token_type":"Bearer","refresh_token":"<refresh token>","expiry":"0001-01-01T00:00:00Z"}` |
| `GDRIVE_FOLDER_ID` | The ID of the **BHBC Database Backups** folder, taken from its URL: `drive.google.com/drive/folders/<ID>` |
| `ALERT_SMTP_USER` | The club Gmail address (`SMTP_USER` in `.env.prod.local`) |
| `ALERT_SMTP_PASSWORD` | Its Gmail **app password** (`SMTP_PASSWORD`) |
| `ALERT_EMAIL_TO` | Who gets the failure email (comma-separated) |

**Variable** (a variable, not a secret):

| Variable | Value |
|---|---|
| `PG_MAJOR` | Production's Postgres major version, from `show server_version;` in the Supabase SQL Editor. It was `17` when built. |

------------------------------------------------------------------------

## 4. Google Drive authentication: why OAuth, not a service account

A service account has **no Drive storage quota** of its own. Any file it uploads to a regular My Drive folder fails with `403 storageQuotaExceeded`, however the folder is shared. The workarounds (Shared Drives, domain-wide delegation) need Google Workspace, and the club has a plain Gmail account.

So uploads are made **as `burgesshillbc@gmail.com`** through OAuth. The files are owned by that account and count against its 15 GB.

The backup **reuses the app's existing OAuth credentials**: the same client and refresh token that `src/lib/drive.ts` uses for attachments. On 2026-10-11 these were checked:

- the refresh token belongs to `burgesshillbc@gmail.com`;
- it has full Drive scope (`https://www.googleapis.com/auth/drive`). The narrower `drive.file` scope can't write into a folder created by hand;
- the OAuth app (in the Google Cloud project that owns `GOOGLE_OAUTH_CLIENT_ID`, under the same account) is **In production**, not **Testing**. A Testing app's refresh tokens expire after 7 days.

**If the token stops working** (`invalid_grant`, or an insufficient-scope error), mint a new one:

1.  Google Cloud Console (as `burgesshillbc@gmail.com`) → the same project → check the **Google Drive API** is enabled.
2.  Credentials → Create credentials → OAuth client ID → **Desktop app**. You can also reuse the existing client.
3.  On a PC, run `rclone config` → New remote, type `drive`. Enter the client ID and secret, choose scope **1 (full access)**, leave the root folder blank, and answer **yes** to auto config. Log in as `burgesshillbc@gmail.com` in the browser and approve.
4.  Run `rclone config show <remote>` and copy the whole `token = {...}` JSON into the `GDRIVE_TOKEN` secret. If you used a new client, update `GDRIVE_CLIENT_ID` and `GDRIVE_CLIENT_SECRET` too.
5.  If the app's attachments use the same token, decide whether to update `GOOGLE_OAUTH_REFRESH_TOKEN` in Vercel as well.

------------------------------------------------------------------------

## 5. The restore scripts

Both scripts are run locally with `tsx`. They restore the `.sql.gz` files the workflow makes.

They are **not** the same as `db-dump.ts` / `db-restore.ts`, which copy **data only** between environments in `.dump` format and rely on the migrations for the table structure. Don't mix the two formats.

| npm script | File | Target |
|---|---|---|
| `npm run db-drill-dev` | `scripts/db-drill-restore-dev.ts` | Dev only |
| `npm run db-restore-production-full` | `scripts/db-restore-production-full.ts` | Production |

The shared engine is `scripts/lib/full-restore.ts`. It also uses the helpers in `scripts/lib/backups.ts` and `scripts/lib/postgres-tools.ts`.

### Requirements on the PC

- **PostgreSQL client tools.** `pgTool()` looks in `C:\Program Files\PostgreSQL\18\bin` by default; set `POSTGRES_BIN_DIR` to override it. The local tools must be the same major version as the server or newer. PG 18 dumps and restores the PG 17 server.
- **`.env.dev.local` and `.env.prod.local`** in the project root. Each needs:
  - `SUPABASE_POOLER_URL`: the session pooler on port 5432;
  - `SUPABASE_DATABASE_NAME`, which is shown on screen.
- The backup file in **`backups/`**, which is gitignored. Download it there from the Drive folder.

### Safety rails, both scripts

- **One env file each, read directly with dotenv `parse`.** `process.env` is not used, so a variable set in the shell can't redirect the restore. The dev script only reads `.env.dev.local`; the production script only reads `.env.prod.local`.
- **Project ref check.** The ref is taken from the pooler URL's username (`postgres.<ref>`) and must match the hardcoded `DEV_PROJECT_REF` / `PRODUCTION_PROJECT_REF`. The dev script also refuses outright if its env file points at production.
- **Refuses port 6543**, the transaction pooler.
- **Shows the target first:** database name, project ref, host and env file.
- **Verifies the chosen backup before anything else:** it decompresses cleanly, is at least 50 KB, and contains `dump complete` near the end.
- **Typed confirmation:** `RESTORE DEV` or `RESTORE PRODUCTION`.
- **Takes a backup of the target first:**
  - Dev: `backups/dev-before-drill-<local stamp>.sql.gz`;
  - Production: `backups/safety-before-restore-<local stamp>.sql.gz`, which is mandatory and taken **before** the confirmation prompt.

  It uses the same `pg_dump` flags as the workflow, streamed through gzip, and is verified. If it fails, the script stops and nothing is touched.

  To undo a restore, run the same script again and choose that file.

### How the restore works

The script runs one `psql -X -q -v ON_ERROR_STOP=1` process whose input is:

    BEGIN;
    DROP SCHEMA IF EXISTS website CASCADE;
    DROP SCHEMA IF EXISTS public CASCADE;
    <the gunzipped dump>
    COMMIT;

- **All or nothing.** Any error stops psql before `COMMIT`, so everything rolls back, the drop included, and the database is left exactly as it was. This happened for real during the first drill, and Dev was unchanged.
- **Streaming throughout:** file → gunzip → filter → psql through pipes. A dump is never held in memory; a buffered `execFileSync` capture hits `ENOBUFS` on large output. Keep it that way if you change the scripts.
- **Lines skipped:** `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin …` (12 lines when built). The dump contains Supabase's own admin defaults, and the `postgres` login isn't allowed to change another role's defaults: the error is *"permission denied to change default privileges"*.
  - The skipped lines only affect objects that `supabase_admin` itself creates. All the app's tables are created by `postgres`, whose own defaults are restored.
  - The number skipped is written to the log.
- **Rows counted:** each `COPY … FROM stdin` block is counted as it streams through. After the restore, the live row count of every table is compared with the backup, and any mismatch is listed.
- **API schema reload:** `NOTIFY pgrst, 'reload schema';` makes the Supabase API (PostgREST) see the rebuilt tables.
- **Logs:** the terminal shows progress and a summary only. The full psql output goes to `backups/restore-dev-<stamp>.log` or `backups/restore-production-<stamp>.log`. Expect `NOTICE: drop cascades to …` lines there; they are normal.
- **No circular foreign-key problem.** A full dump loads all the data *before* adding foreign keys, so the `availability_events` ↔ `availability_slots` loop that `db-restore.ts` works around doesn't arise.

### After a production restore: redeploy in Vercel

**The database is restored, but the live app can still show the old data.** Several server-side caches live in memory on each running Vercel server, and a restore bypasses the app, so nothing clears them:

- `members-supabase.ts`: all users and profiles, for **24 hours**;
- `home-cache.ts`: the diary (48 hours), announcements (30 minutes) and other home-page data (24 hours);
- smaller caches in `fixture-groups-supabase.ts`, `drive.ts` and `maintenance.ts`.

This was found in the live test on 2026-10-11. The restored postcode was correct in the database but not on screen.

**Fix:** Vercel → the production project → the current production deployment → **Redeploy**. It rebuilds the same commit. Fresh servers have empty caches.

If the redeploy shows as **Canceled**, the project's ignored-build-step rule (it builds only when `package.json` changed) has blocked it. In that case, push a commit that changes `package.json` instead.

### Expected timings (October 2026)

- Safety backup: about 30 seconds.
- Restore: about a minute.
- During the restore the old tables are locked, so the live app may error for a few seconds.

------------------------------------------------------------------------

## 6. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Failure email, and the log shows `invalid_grant` or a 401/403 from Drive | The OAuth token was revoked or expired, or the app's access was removed in the club account's Google security settings. Mint a new token (§4). |
| `pg_dump: error: aborting because of server version mismatch` | Supabase upgraded Postgres. Set `PG_MAJOR` to the new major version. |
| `password authentication failed` / connection errors in the dump step | The production database password changed. Update `BACKUP_DATABASE_URL`, and `.env.prod.local` too. |
| The failure email doesn't arrive | Gmail app passwords are revoked when the account password changes. Create a new app password and update `ALERT_SMTP_PASSWORD`, and the app's own `SMTP_PASSWORD` in Vercel. |
| No runs at all | Scheduled workflows only run from `main`, and GitHub disables them after 60 days without activity on *public* repos (this repo is private). Check the Actions tab: the workflow may need re-enabling. |
| "Backup is under 50 KB" or "does not end with … dump complete" | The dump was cut short. Re-run it by hand. If it keeps failing, read the dump step's log. |
| A restore stops with `psql stopped with an error … NOTHING was changed` | Read the end of the `backups/restore-*.log` file. If it's a permissions error on a new kind of Supabase-owned statement, add that line prefix to the skip list in `full-restore.ts`, as for `supabase_admin`. |
| A restore finishes, but the app shows old data | The in-memory caches: redeploy in Vercel (§5). |
| A restore finishes, but the app's API returns "relation not found" | PostgREST didn't reload. Run `NOTIFY pgrst, 'reload schema';` in the SQL Editor. |

------------------------------------------------------------------------

## 7. Ongoing care

- **Quarterly:** run the dev drill (`npm run db-drill-dev`) on a recent nightly backup. A backup that has never been restored isn't proven. Afterwards, put Dev back from its `dev-before-drill` file, so real member data doesn't sit in Dev.
- **If a migration adds a new schema**, add it to the `--schema=` flags in the workflow **and** to `BACKUP_SCHEMAS` in `scripts/lib/full-restore.ts`.
- **After a Supabase major-version upgrade**, update `PG_MAJOR`. Also make sure the local PostgreSQL tools are at that version or newer.
- **Retention** is the `--min-age 90d` value in the workflow.

------------------------------------------------------------------------

## 8. What isn't in a backup

- **Supabase's own schemas** (`auth`, `storage`, …). They aren't used by the app.
- **The `supabase_migrations` history table.** Migrations are applied by hand, so restoring into an existing project needs nothing more. If you restore into a **brand-new** Supabase project and the CLI's history matters, re-record it with `supabase migration repair`.
- **File attachments.** These live in Google Drive, not the database. The database only holds their Drive file IDs.
- **Environment variables and secrets.** These are in Vercel, GitHub and the local `.env.*.local` files.

------------------------------------------------------------------------

## 9. Rebuilding from scratch

If everything were lost except this repository:

1.  Get a Google OAuth client and a full-Drive-scope refresh token for `burgesshillbc@gmail.com` (§4), with the OAuth app **In production**.
2.  Create the **BHBC Database Backups** folder in that account's My Drive and share it with no one.
3.  Set the secrets and the `PG_MAJOR` variable (§3).
4.  Run the workflow by hand, then run it again with **test_failure_alert** ticked. Check the file reaches Drive and the email arrives.
5.  Download the file and run the dev drill.

The workflow and the scripts need no changes, only the credentials and IDs they're given.

------------------------------------------------------------------------

## 10. Testing record

All tests were on 2026-10-11:

- **Workflow:** a manual run uploaded a verified backup to Drive. A run with `test_failure_alert` ticked failed as intended, and both emails arrived.
- **Dev drill 1:** stopped with *"permission denied to change default privileges"* and rolled back cleanly, with Dev unchanged. This led to the `supabase_admin` skip.
- **Dev drill 2:** a pre-migration production backup restored into Dev. 72 tables and 5,062 rows matched.
- **Dev:** a post-migration production backup restored into Dev, and the app was tested against it. Dev was then put back from its `dev-before-drill` file.
- **Production:** a member's postcode was changed, then a backup was restored over production. 80 tables and 8,462 rows matched. The database showed the original postcode, and after a Vercel redeploy so did the app. This led to §5's redeploy step.

------------------------------------------------------------------------

## 11. Quick reference: files

- `.github/workflows/db-backup.yml`: the nightly workflow (on `main`)
- `scripts/db-drill-restore-dev.ts`: the dev drill (`npm run db-drill-dev`)
- `scripts/db-restore-production-full.ts`: the production restore (`npm run db-restore-production-full`)
- `scripts/lib/full-restore.ts`: the shared restore engine (target checks, verify, dump, one-transaction restore, row counts)
- `scripts/lib/backups.ts`, `scripts/lib/postgres-tools.ts`: helpers (the `backups/` folder, prompts, and the local `pg_dump` / `psql` paths)
- `backups/` (gitignored): downloaded backups, safety and dev-before-drill backups, and restore logs. They contain real member data, so never commit them or share them.
- `Specs/DATABASE_BACKUP_SPEC.md`: the original design and its reasoning
