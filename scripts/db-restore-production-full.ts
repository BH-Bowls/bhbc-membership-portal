/**
 * db-restore-production-full.ts
 *
 * GENUINE PRODUCTION RESTORE: wipes production's public + website schemas and
 * rebuilds them from a full backup (backups/*.sql.gz — a nightly backup downloaded
 * from the "BHBC Database Backups" Drive folder, or a safety backup this script made).
 * Only for real disaster recovery. See specs/DATABASE_BACKUP_SPEC.md §6.
 *
 * Hardcoded to .env.prod.local and to the production project ref.
 *
 * Before touching anything it takes a SAFETY BACKUP of production as it is now
 * (backups/safety-before-restore-<stamp>.sql.gz) and verifies it — if that fails,
 * it stops. To undo a restore, run this script again and pick the safety backup.
 *
 * The wipe and restore are one transaction: if anything fails, production is left
 * exactly as it was. Full psql output goes to backups/restore-production-<stamp>.log.
 *
 * Run with:
 *   npm run db-restore-production-full
 */

import { basename } from 'path';
import { ask } from './lib/backups';
import {
  readTarget, checkTarget, printTarget, chooseBackup, verifyBackup, dumpFull, restoreFull,
  checkRowCounts, restoreLogPath, PRODUCTION_PROJECT_REF,
} from './lib/full-restore';

async function main() {
  const target = readTarget('.env.prod.local');
  checkTarget(target, PRODUCTION_PROJECT_REF, 'production');
  printTarget(target, 'production');

  const file = await chooseBackup();
  if (!file) return;

  console.log('\nChecking the backup is complete...');
  await verifyBackup(file);
  console.log(`Backup OK: ${basename(file)}`);

  console.log('\nTaking a safety backup of production as it is now (this can take a minute)...');
  const safetyFile = await dumpFull(target, 'safety-before-restore');
  console.log(`Safety backup saved and verified: ${safetyFile}`);

  console.log('\n*** This will WIPE PRODUCTION (public + website schemas) and rebuild it from');
  console.log(`*** ${basename(file)}`);
  console.log('*** Anything changed in production since that backup will be lost');
  console.log('*** (it is still in the safety backup above).');
  const answer = await ask('Type RESTORE PRODUCTION to continue: ');
  if (answer.trim() !== 'RESTORE PRODUCTION') {
    console.log('Cancelled — nothing changed. (The safety backup is kept.)');
    return;
  }

  const logFile = restoreLogPath('production');
  console.log(`\nRestoring (full output in ${logFile})...`);
  const expected = await restoreFull(target, file, logFile);
  console.log('Restore committed.\n');

  const differences = checkRowCounts(target, expected);
  if (differences > 0) {
    console.log(`\n${differences} table(s) don't match the backup — check ${logFile}.`);
  }
  console.log('\nNow check the live app. To undo this restore, run');
  console.log(`  npm run db-restore-production-full`);
  console.log(`and choose ${basename(safetyFile)}.`);
  if (differences > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nRESTORE FAILED:', err.message);
  process.exit(1);
});
