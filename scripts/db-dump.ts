/**
 * db-dump.ts
 *
 * Dumps public-schema DATA ONLY (not Supabase's own internal platform schemas —
 * auth/storage/realtime/etc, every project auto-provisions those itself — and not
 * table structure, which always comes from supabase/migrations/*.sql instead) from
 * whichever database SUPABASE_POOLER_URL points at, to backups/<name>.dump. Prompts
 * for the name (Enter accepts a timestamp default) — backups/ is gitignored, real
 * member data must never end up in git history.
 *
 * Custom format (not plain SQL) — needed because of one genuine circular FK pair in
 * this schema, availability_events.concluded_slot_id <-> availability_slots.event_id
 * (same reason migrate-availability.ts inserts events, then slots, then backfills
 * events in a second pass). See db-restore.ts for the matching restore-side handling,
 * and specs/GO_LIVE_RUNBOOK.md §5 for the full story of how this was worked out.
 *
 * Run with:
 *   npm run db-dump   (dumps whichever project .env.prod.local points at)
 */

import { execFileSync } from 'child_process';
import { join } from 'path';
import { ensureBackupsDir, ask, defaultBackupName, BACKUPS_DIR } from './lib/backups';
import { pgTool } from './lib/postgres-tools';

async function main() {
  const poolerUrl = process.env.SUPABASE_POOLER_URL;
  if (!poolerUrl) {
    throw new Error('SUPABASE_POOLER_URL is not set — fill it in from the Dashboard\'s Connect panel (Shared Pooler) first.');
  }
  const databaseName = process.env.SUPABASE_DATABASE_NAME || '(SUPABASE_DATABASE_NAME not set)';

  ensureBackupsDir();
  const suggested = defaultBackupName();
  const answer = await ask(`Backup name (saved to backups/<name>.dump) [${suggested}]: `);
  const name = answer.trim() || suggested;
  const outputFile = join(BACKUPS_DIR, `${name}.dump`);

  console.log(`\nDumping public schema (data only) from: ${databaseName}`);
  console.log(`Output file: ${outputFile}\n`);

  execFileSync(pgTool('pg_dump'), [poolerUrl, '--schema=public', '--data-only', '--format=custom', '-f', outputFile], { stdio: 'inherit' });

  console.log(`\nDone. Wrote ${outputFile}.`);
}

main().catch((err) => {
  console.error('DUMP FAILED:', err.message);
  process.exit(1);
});
