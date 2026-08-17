/**
 * db-restore.ts
 *
 * Restores a backup from backups/ (see db-dump.ts) into whichever database
 * SUPABASE_POOLER_URL points at. Lists what's available and prompts for which file
 * (Enter accepts the most recent). Shared by both npm run db-restore-dev and
 * npm run db-restore-production — which target it hits depends only on which .env
 * file the npm script loads, not on anything in this file.
 *
 * Handles the one genuine circular FK pair in this schema
 * (availability_events.concluded_slot_id <-> availability_slots.event_id) by
 * dropping that one constraint before restoring and re-adding it after.
 * `pg_restore --disable-triggers` does NOT work on Supabase — confirmed 2026-08-17,
 * the connecting role gets "permission denied: ... is a system trigger" trying to
 * disable the implicit RI_ConstraintTrigger objects backing FK constraints, even on
 * tables it owns. Dropping/re-adding the constraint itself (normal DDL on a table we
 * own) is the workaround — see specs/GO_LIVE_RUNBOOK.md §5 for the full story.
 *
 * config/petrol_bands duplicate-key errors from pg_restore are EXPECTED and
 * harmless — those two tables are seeded directly by the migration files, not by
 * this restore, so a freshly-reset target already has those exact rows. pg_restore
 * exits non-zero whenever it hits any ignored error (even these harmless ones), so
 * that failure is caught here and doesn't stop the constraint from being re-added —
 * but the output is still shown live so you can confirm it's *only* those two.
 *
 * SAFETY: this mutates whichever database SUPABASE_POOLER_URL points at, in place.
 * Requires typed confirmation before doing anything, and prints the target name —
 * there is deliberately no --force/--yes flag to skip that. This script does NOT
 * reset anything itself — it checks the users row count first and warns loudly if
 * the target isn't empty (npm run db-reset-dev / db-reset-production for a clean
 * baseline first), but doesn't block a deliberate no-op re-run.
 *
 * Run with:
 *   npm run db-restore-dev          (restores into dev, via .env.local)
 *   npm run db-restore-production   (restores into prod, via .env.prod.local — only
 *                                     ever for genuine disaster recovery, never to
 *                                     push dev/test data into prod)
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { ask, listBackups, BACKUPS_DIR } from './lib/backups';
import { pgTool } from './lib/postgres-tools';
import { getSupabaseClient } from '../src/lib/supabase';

const CIRCULAR_FK_TABLE = 'public.availability_events';
const CIRCULAR_FK_CONSTRAINT = 'availability_events_concluded_slot_id_fkey';
const CIRCULAR_FK_DEFINITION = 'FOREIGN KEY (concluded_slot_id) REFERENCES availability_slots(id)';

// Same project ref lookup as the db-reset-* npm scripts — needed here so this
// script can offer to run the reset itself instead of just describing it.
const PROJECT_REFS: Record<string, string> = {
  dev: 'ofqepimyooesuckyrane',
  production: 'ovmaeycnlubjxsyrswoz',
};

// .cmd on Windows since npx isn't a real .exe there — avoids needing shell: true
// (and its arg-escaping deprecation warning) just to resolve the command.
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function resetTarget(databaseName: string) {
  const key = /dev/i.test(databaseName) ? 'dev' : /prod/i.test(databaseName) ? 'production' : null;
  if (!key) {
    throw new Error(`Can't tell dev from production from SUPABASE_DATABASE_NAME ("${databaseName}") — reset manually with npm run db-reset-dev or db-reset-production.`);
  }
  const projectRef = PROJECT_REFS[key];
  console.log(`\nLinking to ${key} (${projectRef})...`);
  execFileSync(NPX, ['supabase', 'link', '--project-ref', projectRef], { stdio: 'inherit' });
  console.log(`\nResetting ${key} schema (npx supabase db reset --linked)...`);
  execFileSync(NPX, ['supabase', 'db', 'reset', '--linked'], { stdio: 'inherit' });
}

async function main() {
  const poolerUrl = process.env.SUPABASE_POOLER_URL;
  if (!poolerUrl) {
    throw new Error('SUPABASE_POOLER_URL is not set — fill it in from the Dashboard\'s Connect panel (Shared Pooler) first.');
  }
  const databaseName = process.env.SUPABASE_DATABASE_NAME || '(SUPABASE_DATABASE_NAME not set)';

  const available = listBackups();
  if (available.length > 0) {
    console.log('Available backups:');
    for (const f of available) console.log(`  ${f}`);
    console.log();
  } else {
    console.log('No backups found in backups/ — run npm run db-dump first.\n');
  }

  const defaultFile = available.length > 0 ? available[available.length - 1] : '';
  const nameAnswer = await ask(`Backup file name to restore${defaultFile ? ` [${defaultFile}]` : ''}: `);
  const name = nameAnswer.trim() || defaultFile;
  if (!name) {
    console.log('No file specified — aborted.');
    process.exit(1);
  }
  const inputFile = join(BACKUPS_DIR, name);
  if (!existsSync(inputFile)) {
    console.log(`"${inputFile}" doesn't exist — aborted.`);
    process.exit(1);
  }

  // A restore doesn't reset anything itself — it just inserts on top of whatever's
  // already there. If the target isn't empty, every row already present fails as a
  // duplicate-key conflict instead of landing, which is confusing to read as a wall
  // of "did this actually work?" errors. Check first and say so plainly.
  let existingUserCount: number | null = null;
  try {
    const { count } = await getSupabaseClient().from('users').select('id', { count: 'exact', head: true });
    existingUserCount = count ?? 0;
  } catch {
    // Non-fatal — if this check itself fails, fall through to the restore attempt
    // and let pg_restore's own errors (if any) speak for themselves.
  }

  console.log(`\n*** This will restore ${name} into the database below, in place.`);
  if (existingUserCount === null) {
    console.log('*** Could not check whether the target already has data (see above if an');
    console.log('*** error was printed) — existing rows in tables the dump touches will');
    console.log('*** conflict unless the target\'s schema was reset first.');
  } else if (existingUserCount > 0) {
    console.log(`*** TARGET IS NOT EMPTY — ${existingUserCount} existing users row(s) found.`);
    console.log('*** This restore will NOT reset anything on its own; every already-present');
    console.log('*** row will fail as a harmless-but-noisy duplicate-key conflict rather than');
    console.log('*** update, unless you reset first.');
    console.log(`\nTarget database: ${databaseName}`);
    const resetAnswer = await ask('Reset the target schema first for a clean baseline? [Y/n]: ');
    if (resetAnswer.trim().toLowerCase() !== 'n') {
      resetTarget(databaseName);
      existingUserCount = 0;
    } else {
      console.log('Skipping reset — proceeding with restore on top of existing data.');
    }
  } else {
    console.log('*** Target appears empty (0 users rows) — clean baseline, as expected.');
  }
  console.log(`\nTarget database: ${databaseName}\n`);

  const confirmAnswer = await ask('Type "restore" to continue, anything else to abort: ');
  if (confirmAnswer.trim() !== 'restore') {
    console.log('Aborted — no changes made.');
    process.exit(1);
  }

  console.log(`\n1. Dropping ${CIRCULAR_FK_CONSTRAINT} (circular FK workaround)...`);
  execFileSync(pgTool('psql'), [poolerUrl, '-c', `ALTER TABLE ${CIRCULAR_FK_TABLE} DROP CONSTRAINT ${CIRCULAR_FK_CONSTRAINT};`], { stdio: 'inherit' });

  console.log(`\n2. Restoring ${name}...`);
  try {
    execFileSync(pgTool('pg_restore'), ['-d', poolerUrl, inputFile], { stdio: 'inherit' });
  } catch {
    console.warn('\npg_restore reported errors above — check they match ONLY the expected');
    console.warn('config/petrol_bands duplicate-key warnings (harmless) before trusting this restore.');
  }

  console.log(`\n3. Re-adding ${CIRCULAR_FK_CONSTRAINT}...`);
  execFileSync(pgTool('psql'), [poolerUrl, '-c', `ALTER TABLE ${CIRCULAR_FK_TABLE} ADD CONSTRAINT ${CIRCULAR_FK_CONSTRAINT} ${CIRCULAR_FK_DEFINITION};`], { stdio: 'inherit' });

  console.log('\nDone.');

  // Whatever just landed is real member data (emails, password hashes) until
  // redacted — only nudge this for dev, never for a production restore.
  if (/dev/i.test(databaseName)) {
    console.log('\nThis is real member data now. Redact it before using dev for testing:');
    console.log('  npx dotenv -e .env.local -- npx tsx scripts/redact-dev-database.ts');
  }
}

main().catch((err) => {
  console.error('RESTORE FAILED:', err.message);
  process.exit(1);
});
