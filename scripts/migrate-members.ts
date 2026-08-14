/**
 * migrate-members.ts
 *
 * Reads live Members data from Google Sheets and writes it into the new Postgres
 * users/user_roles/member_profiles tables. This is the real, persisted migration
 * tooling described in specs/Phase_0_1_Migration_Plan.md's Dev/Test Environment
 * Strategy section — it doubles as the "refresh Dev" script and stays in active use
 * permanently after cutover, not a one-off throwaway.
 *
 * SAFETY: this script only ever writes to whichever Supabase project SUPABASE_URL
 * points at. There is currently no Prod Supabase project — every run of this script
 * writes to Dev. When Prod exists, running this against it for the real cutover
 * requires deliberately passing --no-redact (see below) — the default is always
 * redacted, on purpose, so a mistake defaults to safe.
 *
 * Redaction (applied unless --no-redact is passed):
 *   - email_address cycled deterministically across 9 owned aliases
 *     (liamBH1@dasey.org.uk .. liamBH9@dasey.org.uk) so no real member email address
 *     ever exists in the target database.
 *   - password_hash overwritten with a single shared, known test-password hash for
 *     every row, so any seeded account is loggable-into during testing.
 *
 * Out of scope for this pass, deliberately: Leavers (a separate Sheets source,
 * not part of Members — every row here is is_active=true) and Applications
 * (separate source, not auth data). Both are additional migration passes to build
 * later, not part of populating the core Members->users/member_profiles mapping.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-members.ts          (redacted, Dev)
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-members.ts --no-redact  (real cutover, Prod only)
 */

import bcrypt from 'bcryptjs';
import { getAllUsers, getColumnMap, getGoogleSheetsClient, getSpreadsheetId, type User } from '../src/lib/sheets';
import { parseRoles } from '../src/lib/role-utils';

/**
 * Reads the live Markers sheet directly (name + worker flag only — the old
 * markers-sheets.ts's full CRUD module was retired once /markers moved to reading/
 * writing member_profiles.is_marker/is_worker directly, but THIS read still has to
 * come from the sheet: production is still Sheets-only until the real cutover, so
 * the Markers sheet remains the actual source of truth for every Dev refresh until
 * then, not whatever's already sitting in Dev's Postgres.
 */
async function fetchMarkers(): Promise<Map<string, { isWorker: boolean }>> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Markers!A:B',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const byUsername = new Map<string, { isWorker: boolean }>();
  for (let i = 1; i < rows.length; i++) {
    const name = (rows[i][0] || '').toString().trim();
    if (!name) continue;
    const isWorker = (rows[i][1] || '').toString().trim().toUpperCase() === 'Y';
    byUsername.set(name.toLowerCase(), { isWorker });
  }
  return byUsername;
}
import { getSupabaseClient } from '../src/lib/supabase';
import { parseSheetTimestamp } from './lib/parse-sheet-timestamp';

// Confirmed against live data 2026-08-01: the Captain shared login's actual username is
// "captains" (lowercase, full_name "Captains Laptop") — the plan's "Captains" (capitalised)
// was an assumption, corrected here after the migration script surfaced the mismatch.
const SHARED_USERNAMES = ['captains', 'clubhouse'];
const REDACT_ALIASES = Array.from({ length: 9 }, (_, i) => `liamBH${i + 1}@dasey.org.uk`);
const TEST_PASSWORD = 'DevTestPassword123!';

const noRedact = process.argv.includes('--no-redact');

if (!noRedact) {
  console.log(`Redaction ON — emails will be cycled across ${REDACT_ALIASES.length} owned aliases, all passwords set to a shared test password.\n`);
} else {
  console.log('\n*** --no-redact: this will write REAL member emails and password hashes. ***');
  console.log('*** Only ever intended for the real cutover against a Prod database. ***\n');
}

/** Supplementary columns not exposed on the typed User interface — read directly. */
interface SupplementaryFields {
  memberEmailSentStatus: string | null;
  label0: string | null;
  label3: string | null;
  label9: string | null;
  label10: string | null;
  darts: string | null;
  countyLadies: string | null;
  labelBarDuty: string | null;
  labelGreenMaint: string | null;
}

async function fetchSupplementaryFields(): Promise<Map<string, SupplementaryFields>> {
  const colMap = await getColumnMap('Members');
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: 'Members!A2:ZZ',
  });
  const rows = response.data.values ?? [];

  const result = new Map<string, SupplementaryFields>();
  const get = (row: any[], field: string): string | null => {
    const index = colMap[field];
    if (index === undefined) return null;
    const value = row[index];
    return value ? String(value) : null;
  };

  for (const row of rows) {
    const userName = get(row, 'user_name');
    if (!userName) continue;
    result.set(userName, {
      memberEmailSentStatus: get(row, 'member_email_sent_status'),
      label0: get(row, 'label_0'),
      label3: get(row, 'label_3'),
      label9: get(row, 'label_9'),
      label10: get(row, 'label_10'),
      darts: get(row, 'darts'),
      countyLadies: get(row, 'county_ladies'),
      labelBarDuty: get(row, 'label_bar_duty'),
      labelGreenMaint: get(row, 'label_green_maint'),
    });
  }
  return result;
}

async function main() {
  console.log('1. Reading live Members + Markers data from Google Sheets...');
  const [sheetUsers, markerByUsername, supplementary] = await Promise.all([
    getAllUsers(true),
    fetchMarkers(),
    fetchSupplementaryFields(),
  ]);
  console.log(`   -> ${sheetUsers.length} members, ${markerByUsername.size} marker entries`);

  console.log('2. Preparing a shared test password hash...');
  const testPasswordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  const supabase = getSupabaseClient();

  console.log('3. Wiping existing users/member_profiles/user_roles (dependency order)...');
  // Every table with an FK into users blocks the users delete unless cleared first (no
  // silent failure here — found the hard way: real interactive testing populates
  // login_attempts/impersonation_log with real usernames, and migrate-applications.ts
  // populates applications.reviewed_by/converted_user_id, none of which cascade on
  // delete by design (member_profiles.user_id deliberately has no ON DELETE CASCADE —
  // see the plan's reasoning). Clearing applications here too is consistent with the
  // documented refresh order (migrate-members -> migrate-leavers -> migrate-applications
  // -> migrate-fixtures -> migrate-rotas) — it always gets fully repopulated by the
  // next script in the sequence anyway. fixtures (renamed from games, 0023) joined
  // this list once migrate-fixtures.ts started populating captain_username/locked_by/
  // last_modified_by/tea_*_username; cleaning_rota/sweeping_rota joined once
  // migrate-rotas.ts started populating their username FK columns — same reasoning as
  // applications: fully wiped here, so migrate-fixtures.ts/migrate-rotas.ts MUST be
  // re-run after this script or those columns stay permanently null until they are.
  // availability_responses/slots/events/group_members/groups joined once
  // migrate-availability.ts started populating their username FK columns — same
  // reasoning, in child-to-parent order so the availability FKs don't block each
  // other's own delete; migrate-availability.ts MUST be re-run after this script.
  // renewals joined once migrate-renewals.ts started populating its username FK column —
  // same reasoning, migrate-renewals.ts MUST be re-run after this script. renewal_payments
  // doesn't need to be here — matched_users is plain text, no FK into users, so it never
  // blocks the users wipe.
  // competition_matches joined once migrate-competitions.ts started populating its
  // marker_username FK column — same reasoning, migrate-competitions.ts MUST be re-run
  // after this script. competitions itself doesn't need to be here — it has no FK into
  // users at all.
  // two_hundred_club_entries joined once migrate-two-hundred-club.ts started populating
  // its username FK column — same reasoning, migrate-two-hundred-club.ts MUST be re-run
  // after this script. two_hundred_club_settings/winners don't need to be here — neither
  // has an FK into users (winners.member is a plain display-name snapshot).
  // announcements joined once migrate-announcements.ts started populating its
  // created_by/updated_by FK columns — same reasoning, migrate-announcements.ts MUST be
  // re-run after this script.
  // suggestion_attachments/suggestions joined once migrate-suggestions.ts started
  // populating their username FK columns (created_by/coordinator/updated_by on
  // suggestions, added_by on suggestion_attachments) — same reasoning, in
  // child-to-parent order, migrate-suggestions.ts MUST be re-run after this script.
  // Both use their existing text business-key PKs (suggestion_id/attachment_id) here,
  // not a uuid id column — the shared nil-UUID sentinel below still works fine as a
  // "never matches" value against a text column, it only breaks the other way round
  // (a non-uuid-shaped sentinel against an actual uuid column).
  // game_players/handicap_history still aren't cleared since nothing populates them
  // yet; extend this list if that changes.
  const wipeSteps: { table: string; column: string }[] = [
    { table: 'login_attempts', column: 'id' },
    { table: 'impersonation_log', column: 'id' },
    { table: 'password_reset_requests', column: 'id' },
    { table: 'applications', column: 'id' },
    { table: 'fixtures', column: 'id' },
    { table: 'cleaning_rota', column: 'id' },
    { table: 'sweeping_rota', column: 'id' },
    { table: 'availability_responses', column: 'id' },
    { table: 'availability_slots', column: 'id' },
    { table: 'availability_events', column: 'id' },
    { table: 'availability_group_members', column: 'id' },
    { table: 'availability_groups', column: 'id' },
    { table: 'renewals', column: 'id' },
    { table: 'competition_matches', column: 'id' },
    { table: 'two_hundred_club_entries', column: 'id' },
    { table: 'announcements', column: 'id' },
    { table: 'suggestion_attachments', column: 'attachment_id' },
    { table: 'suggestions', column: 'suggestion_id' },
    { table: 'user_roles', column: 'user_id' },
    { table: 'member_profiles', column: 'user_id' },
    { table: 'users', column: 'id' },
  ];
  for (const step of wipeSteps) {
    const { error } = await supabase.from(step.table).delete().neq(step.column, '00000000-0000-0000-0000-000000000000');
    if (error) throw new Error(`Failed to wipe ${step.table}: ${error.message}`);
  }

  console.log('4. Building users rows...');
  const usersToInsert = sheetUsers.map((u: User, i: number) => ({
    username: u.userName,
    password_hash: noRedact ? u.passwordHash : testPasswordHash,
    is_temp_password: noRedact ? u.isTempPassword : false,
    account_type: SHARED_USERNAMES.includes(u.userName) ? 'shared' : 'member',
    is_active: true, // Leavers are a separate sheet, not migrated in this pass
    last_login_at: parseSheetTimestamp(u.lastLoginDate),
    last_login_failed_at: parseSheetTimestamp(u.lastLoginFailedDate),
    last_password_reset_at: parseSheetTimestamp(u.lastPasswordResetDate),
    reset_token: u.resetToken,
    reset_token_expires: parseSheetTimestamp(u.resetTokenExpires),
  }));

  const { data: insertedUsers, error: usersError } = await supabase
    .from('users')
    .insert(usersToInsert)
    .select('id, username');
  if (usersError) throw new Error(`users insert failed: ${usersError.message}`);
  console.log(`   -> ${insertedUsers.length} users inserted`);

  const userIdByUsername = new Map(insertedUsers.map((u) => [u.username, u.id]));
  const validUsernames = new Set(insertedUsers.map((u) => u.username));

  console.log('5. Building member_profiles rows...');
  let buddyAnomalies = 0;
  // Shared accounts (Captains, clubhouse) get a users row and no member_profiles row at
  // all — that absence is the whole point of the split (see the plan's Kiosk/Captain
  // reasoning). Filter them out here rather than insert then delete.
  const memberSheetUsers = sheetUsers.filter((u: User) => !SHARED_USERNAMES.includes(u.userName));
  const profilesToInsert = memberSheetUsers.map((u: User, i: number) => {
    const marker = markerByUsername.get(u.userName.toLowerCase());
    const supp = supplementary.get(u.userName);

    // Real-world data quality: a buddy_user_name that doesn't exactly match a current
    // username (stale reference, leaver, typo) would violate the FK outright. Null it
    // out with a warning rather than crash the whole migration on one bad row — never
    // silently guess a correction, just flag it for you to review.
    let buddyUserName = u.buddyUserName;
    if (buddyUserName && !validUsernames.has(buddyUserName)) {
      const trimmed = buddyUserName.trim();
      if (trimmed !== buddyUserName && validUsernames.has(trimmed)) {
        // Stray leading/trailing whitespace in the sheet cell — not a real mismatch,
        // just a formatting artifact. Normalizing this isn't "guessing a correction",
        // the content itself was already right.
        buddyUserName = trimmed;
      } else {
        console.warn(`   !! ${u.userName}: buddy_user_name "${buddyUserName}" doesn't match any current username — nulled, needs review`);
        buddyUserName = null;
        buddyAnomalies++;
      }
    }
    return {
      user_id: userIdByUsername.get(u.userName),
      title: u.title,
      first_name: u.firstName,
      last_name: u.lastName,
      known_as: u.knownAs,
      email_address: noRedact ? u.emailAddress : REDACT_ALIASES[i % REDACT_ALIASES.length],
      landline: u.landline,
      mobile: u.mobile,
      address_1: u.address1,
      address_2: u.address2,
      address_3: u.address3,
      post_code: u.postCode,
      locker_no: u.lockerNo,
      birthdate: u.birthdate,
      age_demographic: u.ageDemographic || null,
      member_type: u.memberType,
      honorary: u.honorary,
      year_started: u.yearStarted,
      handicap: u.handicap,
      buddy_user_name: buddyUserName,
      is_marker: !!marker,
      is_worker: marker?.isWorker ?? false,
      worker_additional_info: null, // new capture, no source data to port
      left_at: null,
      leaver_reason: null,
      comments: u.comments,
      social_emails: u.socialEmails,
      handbook_entry: u.handbookEntry,
      driving_away_matches: u.drivingAwayMatches,
      driving_additional_info: u.drivingAdditionalInfo,
      green_maintenance: u.greenMaintenance,
      green_additional_info: u.greenAdditionalInfo,
      bar_duty: u.barDuty,
      bar_additional_info: u.barAdditionalInfo,
      other_skills: u.otherSkills,
      gmc: u.gmc,
      profile_updated_at: parseSheetTimestamp(u.profileUpdatedDate),
      renew_status: u.renewStatus,
      include: u.include,
      renewal_email_sent_status: u.renewalEmailSentStatus,
      member_email_sent_status: supp?.memberEmailSentStatus ?? null,
      label_0: supp?.label0 ?? null,
      label_3: supp?.label3 ?? null,
      darts: supp?.darts ?? null,
      label_bar_duty: supp?.labelBarDuty ?? null,
      county_ladies: supp?.countyLadies ?? null,
      label_green_maint: supp?.labelGreenMaint ?? null,
      label_9: supp?.label9 ?? null,
      label_10: supp?.label10 ?? null,
    };
  });

  const { error: profilesError } = await supabase.from('member_profiles').insert(profilesToInsert);
  if (profilesError) throw new Error(`member_profiles insert failed: ${profilesError.message}`);
  console.log(`   -> ${profilesToInsert.length} member_profiles inserted${buddyAnomalies > 0 ? ` (${buddyAnomalies} buddy_user_name anomalies nulled, see warnings above)` : ''}`);

  console.log('6. Building user_roles rows...');
  const rolesToInsert: { user_id: string; role: string }[] = [];
  for (const u of sheetUsers) {
    const userId = userIdByUsername.get(u.userName);
    if (!userId) continue;
    for (const role of parseRoles(u.role)) {
      rolesToInsert.push({ user_id: userId, role });
    }
  }
  const { error: rolesError } = await supabase.from('user_roles').insert(rolesToInsert);
  if (rolesError) throw new Error(`user_roles insert failed: ${rolesError.message}`);
  console.log(`   -> ${rolesToInsert.length} user_roles inserted`);

  console.log('\nDone. No real email addresses or password hashes were written.'.concat(noRedact ? ' (--no-redact was passed — this statement is false; real data was written.)' : ''));
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
