/**
 * migrate-clubs.ts
 *
 * Reads live Clubs + Club Contacts data from Google Sheets (Match Day Contacts
 * spreadsheet) and writes it into the new Postgres club_profiles/
 * club_contact_profiles tables. Same "refresh Dev, rerun for the real Prod cutover"
 * pattern as migrate-members.ts.
 *
 * Miles/Travel Time (originally sourced from specs/Petrol 2024.xlsx) come along for
 * free here — the live Sheet's "clubs" tab already has both columns fully populated,
 * so there's no separate Excel-import step.
 *
 * Out of scope, deliberately: club login (club_id/password) — being removed
 * entirely per specs/Phase_0_1_Migration_Plan.md, not migrated.
 *
 * Redaction (applied unless --no-redact is passed): contact email cycled across the
 * same 9 owned aliases used by migrate-members.ts/migrate-leavers.ts/
 * migrate-applications.ts. Originally this script left contact emails real
 * unconditionally (external club secretaries, not portal logins, seemed lower
 * sensitivity) — changed once real club-contact emails in Dev turned out to be a
 * real risk for Season Planning's outreach-email testing (a test run could email an
 * actual external secretary). Phone numbers are still left real — no email-sending
 * feature reads them, so there's no equivalent risk.
 *
 * Rowland contacts are NOT migrated — new contacts are being set up for the 2027
 * season, so the old ones shouldn't carry over. A contact whose only role(s) are
 * Rowland-related is skipped entirely; one who also holds a non-Rowland role (e.g.
 * "ERowland A Contact,Mens Captain") is kept with just the Rowland role(s) stripped.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-clubs.ts          (redacted, Dev)
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-clubs.ts --no-redact  (real cutover, Prod only)
 */

import { getClubs, getMatchDayContactsSpreadsheetId } from '../src/lib/clubs-sheets';
import { getGoogleSheetsClient } from '../src/lib/sheets';
import { getSupabaseClient } from '../src/lib/supabase';

const CONTACTS_SHEET = 'Club Contacts';
const REDACT_ALIASES = Array.from({ length: 9 }, (_, i) => `liamBH${i + 1}@dasey.org.uk`);
const noRedact = process.argv.includes('--no-redact');

if (!noRedact) {
  console.log(`Redaction ON — club contact emails will be cycled across ${REDACT_ALIASES.length} owned aliases.\n`);
} else {
  console.log('\n*** --no-redact: this will write REAL club contact emails. ***');
  console.log('*** Only ever intended for the real cutover against a Prod database. ***\n');
}

interface RawContact {
  clubName: string;
  role: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  mobileNumber: string;
  notes: string;
  email: string;
}

async function fetchContacts(): Promise<RawContact[]> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${CONTACTS_SHEET}'!A:ZZ`,
  });

  const rows = response.data.values ?? [];
  if (rows.length <= 1) return [];

  const headers = rows[0].map((h: string) => String(h).toLowerCase().trim().replace(/\s+/g, '_'));
  const col = (field: string) => headers.indexOf(field);
  const iClubName = col('club_name');
  const iRole = col('role');
  const iFirstName = col('first_name');
  const iLastName = col('last_name');
  const iPhone = col('phone_number');
  const iMobile = col('mobile_number');
  const iNotes = col('notes');
  const iEmail = col('email');

  const contacts: RawContact[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const get = (idx: number) => (idx >= 0 ? String(row[idx] ?? '').trim() : '');
    const clubName = get(iClubName);
    if (!clubName) continue;
    contacts.push({
      clubName,
      role: get(iRole),
      firstName: get(iFirstName),
      lastName: get(iLastName),
      phoneNumber: get(iPhone),
      mobileNumber: get(iMobile),
      notes: get(iNotes),
      email: get(iEmail),
    });
  }
  return contacts;
}

async function main() {
  console.log('1. Reading live Clubs + Club Contacts data from Google Sheets...');
  const [clubs, contacts] = await Promise.all([getClubs(), fetchContacts()]);
  console.log(`   -> ${clubs.length} clubs, ${contacts.length} contacts`);

  const supabase = getSupabaseClient();

  console.log('2. Wiping existing club_contact_profiles/club_profiles (dependency order)...');
  const { error: wipeContactsError } = await supabase
    .from('club_contact_profiles')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (wipeContactsError) throw new Error(`Failed to wipe club_contact_profiles: ${wipeContactsError.message}`);

  const { error: wipeClubsError } = await supabase.from('club_profiles').delete().neq('club_name', '');
  if (wipeClubsError) throw new Error(`Failed to wipe club_profiles: ${wipeClubsError.message}`);

  console.log('3. Building club_profiles rows...');
  const clubNames = new Set(clubs.map((c) => c.clubName));
  const clubsToInsert = clubs.map((c) => ({
    club_name: c.clubName,
    club_number: c.clubNumber || null,
    club_mobile: c.clubMobile || null,
    club_email_address: c.clubEmailAddress || null,
    club_email_note: c.clubEmailNote || null,
    general_information: c.generalInformation || null,
    driving_band: c.drivingBand || null,
    address_1: c.address1 || null,
    address_2: c.address2 || null,
    address_3: c.address3 || null,
    address_4: c.address4 || null,
    post_code: c.postCode || null,
    website: c.website || null,
    latitude: c.latitude,
    longitude: c.longitude,
    miles: c.miles || null,
    travel_time: c.travelTime || null,
  }));

  const { error: clubsError } = await supabase.from('club_profiles').insert(clubsToInsert);
  if (clubsError) throw new Error(`club_profiles insert failed: ${clubsError.message}`);
  console.log(`   -> ${clubsToInsert.length} club_profiles inserted`);

  console.log('4. Building club_contact_profiles rows...');
  let orphaned = 0;
  let rowlandOnlySkipped = 0;
  let rowlandRoleStripped = 0;
  const contactsToInsert: {
    club_name: string; role: string | null; first_name: string | null; last_name: string | null;
    phone_number: string | null; mobile_number: string | null; notes: string | null; email: string | null;
  }[] = [];

  for (const c of contacts) {
    if (!clubNames.has(c.clubName)) {
      console.warn(`   !! Contact for unknown club "${c.clubName}" skipped (no matching club_profiles row)`);
      orphaned++;
      continue;
    }

    // Rowland contacts are being replaced for the 2027 season — don't carry the old
    // ones forward. A contact who is ONLY a Rowland contact is skipped outright; one
    // who also holds another role (Captain, Secretary, etc.) is kept with just the
    // Rowland role(s) removed.
    const roleParts = c.role.split(',').map((r) => r.trim()).filter(Boolean);
    const nonRowlandParts = roleParts.filter((r) => !r.toLowerCase().includes('rowland'));
    if (roleParts.length > 0 && nonRowlandParts.length === 0) {
      rowlandOnlySkipped++;
      continue;
    }
    if (nonRowlandParts.length !== roleParts.length) rowlandRoleStripped++;

    const redactedEmail = c.email ? REDACT_ALIASES[contactsToInsert.length % REDACT_ALIASES.length] : null;
    contactsToInsert.push({
      club_name: c.clubName,
      role: nonRowlandParts.join(',') || null,
      first_name: c.firstName || null,
      last_name: c.lastName || null,
      phone_number: c.phoneNumber || null,
      mobile_number: c.mobileNumber || null,
      notes: c.notes || null,
      email: noRedact ? (c.email || null) : redactedEmail,
    });
  }

  const { error: contactsError } = await supabase.from('club_contact_profiles').insert(contactsToInsert);
  if (contactsError) throw new Error(`club_contact_profiles insert failed: ${contactsError.message}`);
  console.log(`   -> ${contactsToInsert.length} club_contact_profiles inserted (${rowlandOnlySkipped} Rowland-only contacts skipped, ${rowlandRoleStripped} had Rowland role(s) stripped but kept)${orphaned > 0 ? `, ${orphaned} orphaned skipped` : ''}`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
