/**
 * create-shared-account.ts
 *
 * Creates a new "shared" login (account_type='shared', no member_profiles row —
 * same shape as the existing 'clubhouse'/'captains' accounts, see
 * scripts/migrate-members.ts's SHARED_USERNAMES) with a single role. Built for the
 * bar till's dedicated 'bar'/'Bar' login, but general enough to reuse for any future
 * shared/kiosk-style account.
 *
 * The password never lives in source control — it's read from the PASSWORD env var
 * at run time, hashed with the same hashPassword() every real member account uses
 * (src/lib/auth-sheets.ts, bcrypt cost 12), and only the resulting hash is written
 * to the database.
 *
 * SAFETY: this mutates whichever database SUPABASE_URL points at. Prints the target
 * and requires typed confirmation before doing anything. Refuses to run if the
 * username already exists (use a password-reset flow to change one, not this).
 *
 * Run with:
 *   USERNAME=bar ROLE=Bar PASSWORD=... npm run create-shared-account-dev
 *   USERNAME=bar ROLE=Bar PASSWORD=... npm run create-shared-account-production
 */

import * as readline from 'readline';
import { getSupabaseClient } from '../src/lib/supabase';
import { hashPassword } from '../src/lib/auth-sheets';

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
  const username = (process.env.USERNAME || '').trim();
  const role = (process.env.ROLE || '').trim();
  const password = process.env.PASSWORD || '';
  const supabaseUrl = process.env.SUPABASE_URL || '(not set)';

  if (!username || !role || !password) {
    console.error('Usage: USERNAME=<username> ROLE=<role> PASSWORD=<password> npm run create-shared-account-dev');
    process.exit(1);
  }

  console.log(`Target database (SUPABASE_URL): ${supabaseUrl}`);
  console.log(`Creating shared account: username="${username}", role="${role}"\n`);

  const answer = await ask('Type "create" to proceed: ');
  if (answer.trim().toLowerCase() !== 'create') {
    console.log('Aborted — no changes made.');
    return;
  }

  const supabase = getSupabaseClient();

  const { data: existing, error: lookupError } = await supabase
    .from('users').select('id').ilike('username', username).maybeSingle();
  if (lookupError) throw new Error(`Lookup failed: ${lookupError.message}`);
  if (existing) {
    console.error(`A user named "${username}" already exists — aborting. Use a password reset to change its password instead.`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({ username, password_hash: passwordHash, account_type: 'shared', is_active: true })
    .select('id')
    .single();
  if (userError) throw new Error(`users insert failed: ${userError.message}`);

  const { error: roleError } = await supabase
    .from('user_roles')
    .insert({ user_id: user.id, role });
  if (roleError) throw new Error(`user_roles insert failed: ${roleError.message}`);

  console.log(`\nDone — "${username}" created with role "${role}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
