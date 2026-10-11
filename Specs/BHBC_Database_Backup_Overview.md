**Purpose of this document**

This explains in plain English how the Membership Portal's database is backed up every night, and the two ways a backup can be restored if that's ever needed. It is written for the Committee.

Full developer-level detail is in the separate **BHBC Database Backup Technical Runbook**, for whoever maintains the code.

------------------------------------------------------------------------

## Why this matters

The portal's database is everything the portal knows: members, profiles, renewals, friendlies, squads, leagues, competitions, availability, the bar accounts and the locker register.

It is hosted on Supabase's free plan, and **that plan keeps no backups of its own**. The nightly job described here is the club's only backup of that data.

------------------------------------------------------------------------

## What happens every night, automatically

At about 3:30am every night (02:30 UTC), a scheduled job:

1.  Takes a full copy of the live database.
2.  Checks that the copy is complete and not suspiciously small.
3.  Saves it to a Google Drive folder called **BHBC Database Backups**, in the club's own `burgesshillbc@gmail.com` account. The file is named with the date and time, for example `backup-2026-10-11-0230.sql.gz`.
4.  Deletes any backup older than 90 days, so the folder doesn't keep growing. A backup is about 0.5 MB, so this uses very little of the account's storage.

The job runs on GitHub's own servers, so nothing needs to be left switched on and nobody needs to remember to do it. Anyone with access to the club's GitHub can also run it by hand: GitHub → the `bhbc-membership-portal` repository → **Actions** → **Database backup** → **Run workflow**.

The Drive folder is shared with no one. It holds members' personal details, so it should stay that way.

------------------------------------------------------------------------

## If a backup fails

If a night's backup doesn't complete, two emails arrive:

- one titled **"BHBC database backup FAILED"**, sent from the club's Gmail account;
- one from GitHub itself, saying the workflow failed.

A failed night doesn't delete anything: the older backups are only tidied up after a new one has been saved. One failed night isn't urgent, but it should be looked at within a few days. The Technical Runbook lists the usual causes, and most are a two-minute fix.

------------------------------------------------------------------------

## It has been tested for real

This wasn't just assumed to work. On 11 October 2026:

- A backup of the live database was restored into the test (dev) database. Every table and every row matched.
- As a deliberate live test, a member's postcode was changed on the real portal, and a backup was restored over the live database. The postcode went back to its earlier value. All 80 tables (8,462 rows) matched the backup.
- The failure email was tested and arrived.

------------------------------------------------------------------------

## Restoring a backup to the test database (safe)

Use this to check a backup is good, or to look at what the data was on a particular day, without touching the live portal at all. It needs the developer's PC (Liam's, at present).

1.  Download the backup for the date you want from the **BHBC Database Backups** Drive folder into the project's `backups` folder.
2.  Run `npm run db-drill-dev`, choose the file, and type `RESTORE DEV` to confirm.
3.  Before changing anything, it saves a copy of the test database as it was, so it can be put back afterwards.

This command can only ever affect the test database. It checks which database it is pointed at and refuses to run against the live one.

------------------------------------------------------------------------

## Restoring a backup to the live portal (emergency use only)

This is for when something has genuinely gone wrong and the club needs to go back to an earlier point in time. It replaces **everything** in the live database with what the backup contains, so anything entered on the portal since that backup is lost. That includes renewals, entries, bar sales and profile changes.

1.  Download the right backup from Drive into the `backups` folder, as above.
2.  Run `npm run db-restore-production-full` and choose the file.
3.  Before changing anything, it automatically saves a copy of the live database as it is right now. If the restore turns out to be the wrong call, that copy puts things back.
4.  You must type the exact phrase `RESTORE PRODUCTION` to continue, not just "yes", so it can't be confirmed out of habit.
5.  The restore takes about a minute. The portal may show errors for a few seconds while it runs, so do it at a quiet time if possible.
6.  **Afterwards, redeploy the portal in Vercel.** The portal keeps some data in memory for up to a day, so until it's redeployed it can still show the old information, even though the database has been restored. This was found during the live test.

If anything goes wrong part-way through, nothing is changed: the restore is all-or-nothing, so the live database stays exactly as it was.

------------------------------------------------------------------------

## What this depends on

- **The club's `burgesshillbc@gmail.com` Google account.** It owns the Drive folder, and the backup job uploads as that account. This is the club's own account rather than an individual's, so it isn't tied to any one person. Removing the portal's access to the account's Google Drive, or deleting the Drive folder, would stop the backups. The failure email would then say so.
- **The club's GitHub account**, which runs the nightly job.
- **A developer to restore.** Taking backups is fully automatic, but restoring one needs someone with the project set up on their PC. At present that is only Liam; see the "No backup developer" risk in the **BHBC Committee Overview**.

------------------------------------------------------------------------

**For logins and passwords**, see the Accounts & credentials table in the **BHBC Developer Technical Runbook**.
