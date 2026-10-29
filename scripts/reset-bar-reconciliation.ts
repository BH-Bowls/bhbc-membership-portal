/**
 * Resets the Treasurer Bar Reconciliation workflow back to the start, for
 * re-running a test of it end to end:
 *   - deletes every Banking record (bar_bankings; its bar_banking_day_ends
 *     links go with it via ON DELETE CASCADE)
 *   - clears every Day End's Xero export stamp (xero_exported_at/_by)
 *   - clears every Day End's confirmation (confirmed_at/_by), so they all land
 *     back in "Needs Confirmation"
 *
 * Day Ends themselves, and the sales/ledger rows linked to them, are left
 * alone — this only undoes the Treasurer's confirm/bank/export steps, not the
 * bar's own cash-ups. Anything already imported into Xero has to be voided
 * there separately.
 *
 * SAFETY: mutates whichever database SUPABASE_URL points at. Prints the
 * target and current counts, and requires typed confirmation — no --yes flag.
 *
 * Run with:
 *   npx dotenv -e .env.dev.local -- npx tsx scripts/reset-bar-reconciliation.ts
 *   npx dotenv -e .env.prod.local -- npx tsx scripts/reset-bar-reconciliation.ts
 */

import * as readline from 'readline';
import { getSupabaseClient } from '../src/lib/supabase';

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || '(not set)';
  const databaseName = process.env.SUPABASE_DATABASE_NAME || '(SUPABASE_DATABASE_NAME not set)';
  const supabase = getSupabaseClient();

  const { count: bankingCount, error: bankingCountError } = await supabase
    .from('bar_bankings').select('id', { count: 'exact', head: true });
  if (bankingCountError) throw new Error(`Failed to count bankings: ${bankingCountError.message}`);
  const { count: exportedCount, error: exportedCountError } = await supabase
    .from('bar_day_ends').select('id', { count: 'exact', head: true }).not('xero_exported_at', 'is', null);
  if (exportedCountError) throw new Error(`Failed to count exported day ends: ${exportedCountError.message}`);
  const { count: confirmedCount, error: confirmedCountError } = await supabase
    .from('bar_day_ends').select('id', { count: 'exact', head: true }).not('confirmed_at', 'is', null);
  if (confirmedCountError) throw new Error(`Failed to count confirmed day ends: ${confirmedCountError.message}`);

  console.log('*** This will reset Bar Reconciliation on the database below: delete every');
  console.log('*** Banking, and set every Day End back to unexported and unconfirmed.');
  console.log(`\nTarget database: ${databaseName}`);
  console.log(`Target database (SUPABASE_URL): ${supabaseUrl}`);
  console.log(`\nCurrently: ${bankingCount} banking(s), ${exportedCount} exported Day End(s), ${confirmedCount} confirmed Day End(s)\n`);

  const answer = await ask('Type "reset" to continue, anything else to abort: ');
  if (answer.trim() !== 'reset') {
    console.log('Aborted — no changes made.');
    process.exit(1);
  }

  console.log('\n1. Deleting bankings...');
  const { data: deleted, error: deleteError } = await supabase
    .from('bar_bankings').delete().not('id', 'is', null).select('id');
  if (deleteError) throw new Error(`Failed to delete bankings: ${deleteError.message}`);
  console.log(`   -> ${deleted?.length ?? 0} banking(s) deleted`);

  console.log('2. Clearing Day End export stamps and confirmations...');
  const { data: reset, error: resetError } = await supabase
    .from('bar_day_ends')
    .update({ xero_exported_at: null, xero_exported_by: null, confirmed_at: null, confirmed_by: null })
    .or('xero_exported_at.not.is.null,confirmed_at.not.is.null')
    .select('id');
  if (resetError) throw new Error(`Failed to reset day ends: ${resetError.message}`);
  console.log(`   -> ${reset?.length ?? 0} Day End(s) reset`);

  console.log('\nDone. Every Day End is back in Needs Confirmation, with no bankings.');
  console.log('Remember to void anything already imported into Xero.');
}

main().catch((err) => {
  console.error('RESET FAILED:', err.message);
  process.exit(1);
});
