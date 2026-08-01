/**
 * migrate-leavers.ts
 *
 * Reads the live Leavers sheet and adds those rows to users/member_profiles as
 * is_active=false, left_at/leaver_reason/leaver_notes set — the Leavers-replacement
 * design in specs/Phase_0_1_Migration_Plan.md, Step 2. Companion to migrate-members.ts;
 * run that one first (it wipes and reseeds the same tables from scratch).
 *
 * Unlike Members, there's no typed User-shaped interface for the full Leavers row — the
 * exposed Leaver/LeaverDetail interfaces in leavers-sheets.ts only cover a subset (built
 * for display, not migration). Reads the raw sheet via getColumnMap('Leavers') instead,
 * matching field names against what member_profiles needs — the two sheets share nearly
 * all column names (confirmed 2026-08-01: 58 of 59 Members columns also exist on
 * Leavers, plus left_date/left_reason/left_notes; label_green_maint's absence from one
 * Members column-map read but presence on Leavers looks like live data drift between the
 * two sheets, not a real structural difference — treated as optional/nullable here).
 *
 * Redaction (applied unless --no-redact is passed): same as migrate-members.ts — emails
 * cycled across the same 9 owned aliases (continuing the index sequence, not restarting),
 * password_hash overwritten with the same shared test hash.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-members.ts   (run first)
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-leavers.ts   (then this)
 */

import bcrypt from 'bcryptjs';
import { getColumnMap, getGoogleSheetsClient, getSpreadsheetId } from '../src/lib/sheets';
import { parseRoles } from '../src/lib/role-utils';
import { getSupabaseClient } from '../src/lib/supabase';

const REDACT_ALIASES = Array.from({ length: 9 }, (_, i) => `liamBH${i + 1}@dasey.org.uk`);
const TEST_PASSWORD = 'DevTestPassword123!';
const noRedact = process.argv.includes('--no-redact');

/** Same DD/MM/YYYY [HH:MM:SS] parser as migrate-members.ts — see that file for why. */
function parseSheetTimestamp(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ukMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (ukMatch) {
    const [, day, month, year, hour, minute, second] = ukMatch;
    const date = new Date(
      parseInt(year), parseInt(month) - 1, parseInt(day),
      hour ? parseInt(hour) : 0, minute ? parseInt(minute) : 0, second ? parseInt(second) : 0
    );
    return isNaN(date.getTime()) ? null : date.toISOString();
  }
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) return parsed.toISOString();
  console.warn(`   !! Could not parse timestamp "${trimmed}" — leaving null`);
  return null;
}

interface RawLeaverRow {
  [field: string]: string | null;
}

async function fetchLeaverRows(): Promise<RawLeaverRow[]> {
  const colMap = await getColumnMap('Leavers');
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: 'Leavers!A2:ZZ',
  });
  const rows = response.data.values ?? [];

  const fields = [
    'user_name', 'first_name', 'last_name', 'known_as', 'email_address', 'landline', 'mobile',
    'address_1', 'address_2', 'address_3', 'post_code', 'locker_no', 'birthdate', 'member_type',
    'honorary', 'year_started', 'handicap', 'buddy_user_name', 'role',
    'password_hash', 'is_temp_password', 'reset_token', 'reset_token_expires',
    'last_login_date', 'last_login_failed_date', 'last_password_reset_date',
    'title', 'comments', 'social_emails', 'handbook_entry',
    'driving_away_matches', 'driving_additional_info', 'green_maintenance', 'green_additional_info',
    'bar_duty', 'bar_additional_info', 'other_skills', 'gmc', 'profile_updated_date',
    'renew_status', 'include', 'renewal_email_sent_status', 'member_email_sent_status',
    'label_0', 'label_3', 'darts', 'label_bar_duty', 'county_ladies', 'label_green_maint',
    'label_9', 'label_10',
    'left_date', 'left_reason', 'left_notes',
  ];

  return rows.map((row) => {
    const parsed: RawLeaverRow = {};
    for (const field of fields) {
      const index = colMap[field];
      parsed[field] = index === undefined ? null : (row[index] ? String(row[index]) : null);
    }
    return parsed;
  }).filter((r) => r.user_name);
}

async function main() {
  console.log('1. Reading live Leavers data from Google Sheets...');
  const leavers = await fetchLeaverRows();
  console.log(`   -> ${leavers.length} leavers`);

  console.log('2. Fetching existing usernames (for buddy_user_name validation)...');
  const supabase = getSupabaseClient();
  const { data: existingUsers, error: existingError } = await supabase.from('users').select('username');
  if (existingError) throw new Error(existingError.message);
  const existingCount = existingUsers?.length ?? 0;
  const validUsernames = new Set((existingUsers ?? []).map((u) => u.username));

  console.log('3. Preparing shared test password hash...');
  const testPasswordHash = noRedact ? null : await bcrypt.hash(TEST_PASSWORD, 12);

  console.log('4. Inserting leaver users rows...');
  const usersToInsert = leavers.map((l, i) => ({
    username: l.user_name!,
    password_hash: noRedact ? (l.password_hash || 'unknown') : testPasswordHash!,
    is_temp_password: noRedact ? l.is_temp_password === 'Y' : false,
    account_type: 'member',
    is_active: false, // the whole point of this script
    last_login_at: parseSheetTimestamp(l.last_login_date),
    last_login_failed_at: parseSheetTimestamp(l.last_login_failed_date),
    last_password_reset_at: parseSheetTimestamp(l.last_password_reset_date),
    reset_token: l.reset_token,
    reset_token_expires: parseSheetTimestamp(l.reset_token_expires),
  }));

  const { data: insertedUsers, error: usersError } = await supabase
    .from('users')
    .insert(usersToInsert)
    .select('id, username');
  if (usersError) throw new Error(`users insert failed: ${usersError.message}`);
  console.log(`   -> ${insertedUsers.length} leaver users inserted`);

  const userIdByUsername = new Map(insertedUsers.map((u) => [u.username, u.id]));
  for (const u of insertedUsers) validUsernames.add(u.username);

  console.log('5. Building member_profiles rows...');
  let buddyAnomalies = 0;
  const profilesToInsert = leavers.map((l, i) => {
    let buddyUserName = l.buddy_user_name;
    if (buddyUserName && !validUsernames.has(buddyUserName)) {
      const trimmed = buddyUserName.trim();
      if (trimmed !== buddyUserName && validUsernames.has(trimmed)) {
        // Stray whitespace, not a real mismatch — see migrate-members.ts for the same fix.
        buddyUserName = trimmed;
      } else {
        console.warn(`   !! ${l.user_name}: buddy_user_name "${buddyUserName}" doesn't match any username — nulled, needs review`);
        buddyUserName = null;
        buddyAnomalies++;
      }
    }

    return {
      user_id: userIdByUsername.get(l.user_name!),
      title: l.title,
      first_name: l.first_name,
      last_name: l.last_name,
      known_as: l.known_as,
      email_address: noRedact ? l.email_address : REDACT_ALIASES[(existingCount + i) % REDACT_ALIASES.length],
      landline: l.landline,
      mobile: l.mobile,
      address_1: l.address_1,
      address_2: l.address_2,
      address_3: l.address_3,
      post_code: l.post_code,
      locker_no: l.locker_no,
      birthdate: l.birthdate,
      member_type: l.member_type,
      honorary: l.honorary,
      year_started: l.year_started ? parseInt(l.year_started, 10) : null,
      handicap: l.handicap ? parseInt(l.handicap, 10) : null,
      buddy_user_name: buddyUserName,
      is_marker: false,   // Markers sheet only covers current members
      is_worker: false,
      worker_additional_info: null,
      left_at: parseSheetTimestamp(l.left_date),
      leaver_reason: l.left_reason,
      leaver_notes: l.left_notes,
      comments: l.comments,
      social_emails: l.social_emails === 'Y',
      handbook_entry: l.handbook_entry === 'Y',
      driving_away_matches: l.driving_away_matches,
      driving_additional_info: l.driving_additional_info,
      green_maintenance: l.green_maintenance,
      green_additional_info: l.green_additional_info,
      bar_duty: l.bar_duty,
      bar_additional_info: l.bar_additional_info,
      other_skills: l.other_skills,
      gmc: l.gmc,
      profile_updated_at: parseSheetTimestamp(l.profile_updated_date),
      renew_status: l.renew_status,
      include: l.include,
      renewal_email_sent_status: l.renewal_email_sent_status,
      member_email_sent_status: l.member_email_sent_status,
      label_0: l.label_0,
      label_3: l.label_3,
      darts: l.darts,
      label_bar_duty: l.label_bar_duty,
      county_ladies: l.county_ladies,
      label_green_maint: l.label_green_maint,
      label_9: l.label_9,
      label_10: l.label_10,
    };
  });

  const { error: profilesError } = await supabase.from('member_profiles').insert(profilesToInsert);
  if (profilesError) throw new Error(`member_profiles insert failed: ${profilesError.message}`);
  console.log(`   -> ${profilesToInsert.length} leaver member_profiles inserted${buddyAnomalies > 0 ? ` (${buddyAnomalies} buddy_user_name anomalies nulled)` : ''}`);

  console.log('6. Building user_roles rows...');
  const rolesToInsert: { user_id: string; role: string }[] = [];
  for (const l of leavers) {
    const userId = userIdByUsername.get(l.user_name!);
    if (!userId || !l.role) continue;
    for (const role of parseRoles(l.role)) {
      rolesToInsert.push({ user_id: userId, role });
    }
  }
  if (rolesToInsert.length > 0) {
    const { error: rolesError } = await supabase.from('user_roles').insert(rolesToInsert);
    if (rolesError) throw new Error(`user_roles insert failed: ${rolesError.message}`);
  }
  console.log(`   -> ${rolesToInsert.length} user_roles inserted`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('LEAVER MIGRATION FAILED:', err.message);
  process.exit(1);
});
