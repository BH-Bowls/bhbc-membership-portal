/**
 * db-drill-restore-dev.ts
 *
 * Disaster-recovery DRILL: wipes the DEV database's public + website schemas and
 * rebuilds them from a full nightly backup (backups/*.sql.gz, downloaded from the
 * "BHBC Database Backups" Drive folder). Proves the backups actually restore.
 * See specs/DATABASE_BACKUP_SPEC.md §3 Step 6 / §6.
 *
 * Hardcoded to .env.dev.local and to the dev project ref — it refuses to run if that
 * file points anywhere else, so it can never touch production.
 *
 * Before wiping, it takes a full backup of dev as it is now
 * (backups/dev-before-drill-<stamp>.sql.gz) — to put dev back afterwards, run this
 * script again and pick that file. The wipe and restore are one transaction: if
 * anything fails, dev is left exactly as it was. Full psql output goes to backups/restore-dev-<stamp>.log.
 *
 * Run with:
 *   npm run db-drill-dev
 */

import { basename } from 'path';
import { ask } from './lib/backups';
import {
  readTarget, checkTarget, printTarget, chooseBackup, verifyBackup, dumpFull, restoreFull,
  checkRowCounts, restoreLogPath, DEV_PROJECT_REF, PRODUCTION_PROJECT_REF,
} from './lib/full-restore';

async function main() {
  const target = readTarget('.env.dev.local');
  if (target.projectRef === PRODUCTION_PROJECT_REF) {
    throw new Error('.env.dev.local points at PRODUCTION. Refusing to run a drill against it.');
  }
  checkTarget(target, DEV_PROJECT_REF, 'dev');
  printTarget(target, 'dev');

  const file = await chooseBackup();
  if (!file) return;

  console.log('\nChecking the backup is complete...');
  await verifyBackup(file);
  console.log('Backup OK.');

  console.log('\nThis will WIPE the dev database (public + website schemas) and rebuild it');
  console.log(`from ${file}.`);
  const answer = await ask('Type RESTORE DEV to continue: ');
  if (answer.trim() !== 'RESTORE DEV') {
    console.log('Cancelled — nothing changed.');
    return;
  }

  // Keep a copy of dev as it is now (test data etc.) — restore it afterwards by
  // running this script again and picking this file.
  console.log('\nBacking up dev as it is now (this can take a minute)...');
  const devFile = await dumpFull(target, 'dev-before-drill');
  console.log(`Dev backup saved and verified: ${devFile}`);

  const logFile = restoreLogPath('dev');
  console.log(`\nRestoring (full output in ${logFile})...`);
  const expected = await restoreFull(target, file, logFile);
  console.log('Restore committed.\n');

  const differences = checkRowCounts(target, expected);
  if (differences > 0) {
    console.log(`\n${differences} table(s) don't match the backup — check ${logFile}.`);
    process.exit(1);
  }
  console.log('\nDrill passed. Now log in to the app (npm run dev) and click round to confirm.');
  console.log(`To put dev back as it was, run npm run db-drill-dev again and choose ${basename(devFile)}.`);
}

main().catch((err) => {
  console.error('\nDRILL FAILED:', err.message);
  process.exit(1);
});
