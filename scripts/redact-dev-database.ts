/**
 * redact-dev-database.ts
 *
 * Scrambles auth-sensitive data (member/leaver emails, all password hashes, reset
 * tokens, application emails) on whichever database SUPABASE_URL points at. Built for
 * the "copy live to dev" step of the go-live runbook: a Postgres-to-Postgres restore
 * brings real data across, and this is the pass that makes it safe to develop/test
 * against afterward — same redaction scope and exact values as migrate-members.ts's
 * default (redacted) mode, just applied to rows already in the database instead of
 * rows being freshly inserted from a Sheets read.
 *
 * Scope — matches the existing migrate-*.ts scripts' redaction, plus one deliberate
 * addition:
 *   - users.password_hash        -> one shared, known test-password hash for every row
 *   - users.is_temp_password     -> false for every row
 *   - users.reset_token / reset_token_expires -> cleared
 *   - member_profiles.email_address -> cycled across the 9 owned aliases (covers both
 *     active members and leavers — both live in the same users/member_profiles rows)
 *   - applications.email         -> cycled across the same 9 owned aliases
 *   - club_contact_profiles.email -> cycled across the same 9 owned aliases, matching
 *     migrate-clubs.ts's own (updated) default-redacted behaviour — added so Season
 *     Planning's outreach-email testing never risks sending a real email to a real
 *     external club contact.
 *
 * Deliberately NOT touched: addresses/phone numbers, club_contact_profiles.mobile_number,
 * availability visitor names/emails, renewals/payment data, comments. None of that is
 * treated as sensitive enough to redact anywhere else in this codebase, so this script
 * doesn't invent a wider policy for it either.
 *
 * SAFETY: this mutates whichever database SUPABASE_URL points at, in place,
 * irreversibly (short of restoring a prior backup). Requires typed confirmation
 * before doing anything, and prints both SUPABASE_DATABASE_NAME (a plain human label
 * — set to the actual project name in .env.local/.env.prod.local, e.g. "BH-Bowls
 * Dev"/"BH-Bowls Production") and the raw SUPABASE_URL, so you can actually check
 * it's dev before confirming — there is deliberately no --force/--yes flag to skip
 * that.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/redact-dev-database.ts
 */

import bcrypt from 'bcryptjs';
import * as readline from 'readline';
import { getSupabaseClient } from '../src/lib/supabase';

const REDACT_ALIASES = Array.from({ length: 9 }, (_, i) => `liamBH${i + 1}@dasey.org.uk`);
const TEST_PASSWORD = 'Westhill19!';

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
  console.log('*** This will overwrite EVERY password hash and cycle EVERY member/leaver/');
  console.log('*** application/club-contact email address on the database below. This');
  console.log('*** cannot be undone except by restoring a prior backup.');
  console.log(`\nTarget database: ${databaseName}`);
  console.log(`Target database (SUPABASE_URL): ${supabaseUrl}\n`);

  const answer = await ask('Type "redact" to continue, anything else to abort: ');
  if (answer.trim() !== 'redact') {
    console.log('Aborted — no changes made.');
    process.exit(1);
  }

  const supabase = getSupabaseClient();

  console.log('\n1. Overwriting password hashes and clearing reset tokens...');
  const testPasswordHash = await bcrypt.hash(TEST_PASSWORD, 12);
  const { error: usersError } = await supabase
    .from('users')
    .update({
      password_hash: testPasswordHash,
      is_temp_password: false,
      reset_token: null,
      reset_token_expires: null,
    })
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (usersError) throw new Error(`Failed to redact users: ${usersError.message}`);
  console.log(`   -> every users row updated (shared test password: ${TEST_PASSWORD})`);

  console.log('2. Cycling member_profiles email addresses...');
  const { data: profiles, error: profilesFetchError } = await supabase
    .from('member_profiles')
    .select('user_id')
    .order('user_id');
  if (profilesFetchError) throw new Error(`Failed to read member_profiles: ${profilesFetchError.message}`);
  const profileRows = profiles ?? [];
  for (let i = 0; i < profileRows.length; i++) {
    const { error } = await supabase
      .from('member_profiles')
      .update({ email_address: REDACT_ALIASES[i % REDACT_ALIASES.length] })
      .eq('user_id', profileRows[i].user_id);
    if (error) throw new Error(`Failed to redact member_profiles for user_id ${profileRows[i].user_id}: ${error.message}`);
  }
  console.log(`   -> ${profileRows.length} member_profiles rows updated`);

  console.log('3. Cycling application email addresses...');
  const { data: applications, error: applicationsFetchError } = await supabase
    .from('applications')
    .select('id')
    .order('id');
  if (applicationsFetchError) throw new Error(`Failed to read applications: ${applicationsFetchError.message}`);
  const applicationRows = applications ?? [];
  // Continues the same index sequence rather than restarting it — matches
  // migrate-applications.ts's own reasoning: purely cosmetic (avoids every
  // application colliding with alias #1), harmless either way since every alias is
  // one you own regardless of which row lands on which.
  for (let i = 0; i < applicationRows.length; i++) {
    const { error } = await supabase
      .from('applications')
      .update({ email: REDACT_ALIASES[(profileRows.length + i) % REDACT_ALIASES.length] })
      .eq('id', applicationRows[i].id);
    if (error) throw new Error(`Failed to redact application ${applicationRows[i].id}: ${error.message}`);
  }
  console.log(`   -> ${applicationRows.length} applications rows updated`);

  console.log('4. Cycling club contact email addresses...');
  const { data: clubContacts, error: clubContactsFetchError } = await supabase
    .from('club_contact_profiles')
    .select('id')
    .order('id');
  if (clubContactsFetchError) throw new Error(`Failed to read club_contact_profiles: ${clubContactsFetchError.message}`);
  const clubContactRows = clubContacts ?? [];
  // Same "continue the index sequence" reasoning as applications above.
  for (let i = 0; i < clubContactRows.length; i++) {
    const { error } = await supabase
      .from('club_contact_profiles')
      .update({ email: REDACT_ALIASES[(profileRows.length + applicationRows.length + i) % REDACT_ALIASES.length] })
      .eq('id', clubContactRows[i].id);
    if (error) throw new Error(`Failed to redact club_contact_profiles ${clubContactRows[i].id}: ${error.message}`);
  }
  console.log(`   -> ${clubContactRows.length} club_contact_profiles rows updated`);

  console.log('\nDone. Every account now logs in with the shared test password above;');
  console.log('every member/leaver/application/club-contact email now points at an alias you own.');
}

main().catch((err) => {
  console.error('REDACTION FAILED:', err.message);
  process.exit(1);
});
