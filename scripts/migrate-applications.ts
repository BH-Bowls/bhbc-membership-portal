/**
 * migrate-applications.ts
 *
 * Reads the live Applications sheet and writes it into the new Postgres applications
 * table. Independent of migrate-members.ts/migrate-leavers.ts (different source, not
 * auth data) but should run after them, since converted_user_id needs the users table
 * already populated to resolve convertedUsername -> a real user id.
 *
 * Status mapping: live data only has Submitted/Listed/Approved/Paid/Converted/Rejected —
 * the new schema adds Declined/Didn't Proceed (see specs/Phase_0_1_Migration_Plan.md,
 * Step 2). Per the plan's explicit decision, existing 'Rejected' rows become 'Declined'
 * on migration — 'Didn't Proceed' has no historical equivalent, it's new-terminology
 * only for applications processed going forward.
 *
 * Redaction (applied unless --no-redact is passed): same as the other migrate-*.ts
 * scripts — email cycled across the same 9 owned aliases, continuing the index sequence
 * rather than restarting it (so redacted applications don't collide 1:1 with redacted
 * members in a confusing way, though collisions are harmless either way since they're
 * all aliases you own).
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-members.ts       (run first)
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-leavers.ts       (then this)
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-applications.ts  (then this)
 */

import { getAllApplications, type Application } from '../src/lib/applications-sheets';
import { getSupabaseClient } from '../src/lib/supabase';
import { parseSheetTimestamp } from './lib/parse-sheet-timestamp';

const REDACT_ALIASES = Array.from({ length: 9 }, (_, i) => `liamBH${i + 1}@dasey.org.uk`);
const noRedact = process.argv.includes('--no-redact');

const STATUS_MAP: Record<string, string> = {
  Rejected: 'Declined',
};

function mapStatus(liveStatus: string): string {
  return STATUS_MAP[liveStatus] ?? liveStatus;
}

async function main() {
  console.log('1. Reading live Applications data from Google Sheets...');
  const applications = await getAllApplications();
  console.log(`   -> ${applications.length} applications`);

  const supabase = getSupabaseClient();

  console.log('2. Fetching users for converted_user_id resolution...');
  const { data: users, error: usersError } = await supabase.from('users').select('id, username');
  if (usersError) throw new Error(usersError.message);
  const userIdByUsername = new Map((users ?? []).map((u) => [u.username, u.id]));

  console.log('3. Wiping existing applications...');
  await supabase.from('applications').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  console.log('4. Building applications rows...');
  let unresolvedConversions = 0;
  const rowsToInsert = applications.map((a: Application, i: number) => {
    let convertedUserId: string | null = null;
    if (a.convertedUsername) {
      convertedUserId = userIdByUsername.get(a.convertedUsername) ?? null;
      if (!convertedUserId) {
        console.warn(`   !! ${a.firstName} ${a.lastName}: converted_username "${a.convertedUsername}" doesn't match any user — left null, needs review`);
        unresolvedConversions++;
      }
    }

    return {
      status: mapStatus(a.status || 'Submitted'),
      first_name: a.firstName,
      last_name: a.lastName,
      known_as: a.knownAs || null,
      gender: a.gender || null,
      email: noRedact ? (a.emailAddress || null) : REDACT_ALIASES[i % REDACT_ALIASES.length],
      landline: a.landline || null,
      mobile: a.mobile || null,
      address_1: a.address1 || null,
      address_2: a.address2 || null,
      address_3: a.address3 || null,
      post_code: a.postCode || null,
      age_demographic: a.ageDemographic || null,
      dob: a.dob || null,
      ft_education: a.ftEducation || null,
      requested_member_type: a.memberType || null,
      previous_experience: a.previousExperience || null,
      disabilities: a.disabilities || null,
      proposer_name: a.proposerName || null,
      seconder_name: a.seconderName || null,
      decision_notes: a.decisionNotes || null,
      submitted_at: parseSheetTimestamp(a.createdAt) ?? new Date().toISOString(),
      listed_date: parseSheetTimestamp(a.listedDate),
      fee_due: a.feeDue,
      fee_paid: a.feePaid,
      payment_method: a.paymentMethod || null,
      payment_date: parseSheetTimestamp(a.paymentDate),
      approved_at: parseSheetTimestamp(a.approvedAt),
      converted_at: parseSheetTimestamp(a.convertedAt),
      converted_user_id: convertedUserId,
      // reviewed_by/reviewed_at: no source in the live sheet at all, left null —
      // new capture going forward, see 0015's migration notes.
    };
  });

  const { error: insertError } = await supabase.from('applications').insert(rowsToInsert);
  if (insertError) throw new Error(`applications insert failed: ${insertError.message}`);
  console.log(`   -> ${rowsToInsert.length} applications inserted${unresolvedConversions > 0 ? ` (${unresolvedConversions} unresolved converted_username references)` : ''}`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('APPLICATIONS MIGRATION FAILED:', err.message);
  process.exit(1);
});
