// scripts/migrate-contacts-to-club-contacts.ts
// Reads the "Contacts" sheet from the Match Day Contacts spreadsheet and writes a
// consolidated "Club Contacts" sheet where:
//   - Dummy seed rows (Club Name = "Other Roles") are dropped.
//   - Role names are mapped: ERowland/GRowland A/B Organiser/Skip → …A/B Contact.
//   - Rows for the same person at the same club are merged into one row with
//     comma-separated roles.
//
// Run with:
//   npx dotenv -e .env.local -- npx tsx scripts/migrate-contacts-to-club-contacts.ts
//
// The original "Contacts" sheet is NOT modified. Run this once, then verify
// "Club Contacts" looks correct before switching the app to read from it.

import 'dotenv/config';
import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.MATCH_DAY_CONTACTS_SPREADSHEET_ID!;
const SOURCE_SHEET   = 'Contacts';
const TARGET_SHEET   = 'Club Contacts';

// ── Role mapping ──────────────────────────────────────────────────────────────

const ROLE_MAP: Record<string, string> = {
  'ERowland A Organiser': 'ERowland A Contact',
  'ERowland B Organiser': 'ERowland B Contact',
  'GRowland A Organiser': 'GRowland A Contact',
  'GRowland B Organiser': 'GRowland B Contact',
  'ERowland A Skip':      'ERowland A Contact',
  'ERowland B Skip':      'ERowland B Contact',
  'GRowland A Skip':      'GRowland A Contact',
  'GRowland B Skip':      'GRowland B Contact',
};

function mapRole(role: string): string {
  return ROLE_MAP[role.trim()] ?? role.trim();
}

// ── Google Sheets client ──────────────────────────────────────────────────────

function getSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:  (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!SPREADSHEET_ID) throw new Error('MATCH_DAY_CONTACTS_SPREADSHEET_ID not set');

  const sheets = getSheets();

  // ── 1. Read source sheet ──────────────────────────────────────────────────

  console.log(`Reading "${SOURCE_SHEET}"…`);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SOURCE_SHEET}!A:ZZ`,
  });

  const rows = response.data.values ?? [];
  if (rows.length === 0) throw new Error(`"${SOURCE_SHEET}" is empty`);

  const headers = rows[0].map((h: string) => h.trim());
  console.log(`  Headers: ${headers.join(', ')}`);
  console.log(`  Data rows: ${rows.length - 1}`);

  const col = (field: string) => headers.findIndex((h: string) =>
    h.toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_') === field
  );

  const iClubName    = col('club_name');
  const iRole        = col('role');
  const iFirstName   = col('first_name');
  const iLastName    = col('last_name');
  const iName        = col('name');
  const iPhone       = col('phone_number');
  const iMobile      = col('mobile_number');
  const iNotes       = col('notes');
  const iEmail       = col('email');

  // ── 2. Parse and group contacts ───────────────────────────────────────────

  // Multi-key matching: each contact generates several possible identity keys
  // (by email, mobile, name). When any key matches an existing group the rows
  // are merged — so "Captain with email but no mobile" and "Match Secretary
  // with mobile but no email" collapse into one record provided the name matches.

  type ContactGroup = {
    clubName: string; roles: Set<string>; firstName: string; lastName: string;
    name: string; phone: string; mobile: string; notes: string; email: string;
  };

  // Maps every identity key to the canonical group object it belongs to.
  const keyToGroup = new Map<string, ContactGroup>();

  // Ordered list of groups (for output row order).
  const groups: ContactGroup[] = [];

  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const get = (idx: number) => (idx >= 0 ? (row[idx] ?? '').toString().trim() : '');

    const clubName = get(iClubName);

    // Skip dummy seed rows
    if (!clubName || clubName.toLowerCase() === 'other roles') {
      skipped++;
      continue;
    }

    const rawRole   = get(iRole);
    const role      = mapRole(rawRole);
    const firstName = get(iFirstName);
    const lastName  = get(iLastName);
    const name      = get(iName);
    const phone     = get(iPhone);
    const mobile    = get(iMobile);
    const notes     = get(iNotes);
    const email     = get(iEmail);

    const clubKey   = clubName.toLowerCase();
    const fullName  = (firstName && lastName)
      ? `${firstName.toLowerCase()} ${lastName.toLowerCase()}`
      : name.toLowerCase();

    // Build all identity keys for this row (every non-empty identifier).
    const rowKeys: string[] = [];
    if (email)    rowKeys.push(`${clubKey}|email:${email.toLowerCase()}`);
    if (mobile)   rowKeys.push(`${clubKey}|mob:${mobile.replace(/\s+/g, '')}`);
    if (fullName) rowKeys.push(`${clubKey}|name:${fullName}`);
    if (rowKeys.length === 0) rowKeys.push(`${clubKey}|row:${i}`);

    // Find an existing group that shares at least one identity key.
    let existing: ContactGroup | undefined;
    for (const k of rowKeys) {
      if (keyToGroup.has(k)) { existing = keyToGroup.get(k)!; break; }
    }

    if (existing) {
      // Merge into the existing group.
      if (role) existing.roles.add(role);
      if (!existing.email  && email)  existing.email  = email;
      if (!existing.mobile && mobile) existing.mobile = mobile;
      if (!existing.phone  && phone)  existing.phone  = phone;
      if (!existing.notes  && notes)  existing.notes  = notes;
      // Register any new keys so future rows can also find this group.
      for (const k of rowKeys) { if (!keyToGroup.has(k)) keyToGroup.set(k, existing); }
    } else {
      const group: ContactGroup = {
        clubName, roles: new Set(role ? [role] : []),
        firstName, lastName, name, phone, mobile, notes, email,
      };
      for (const k of rowKeys) keyToGroup.set(k, group);
      groups.push(group);
    }
  }

  console.log(`  Skipped (dummy rows): ${skipped}`);
  console.log(`  Unique contacts after merge: ${groups.length}`);

  // ── 3. Prepare output rows ────────────────────────────────────────────────

  const outputRows: string[][] = [headers]; // first row = same headers

  for (const contact of groups) {
    const roleString = Array.from(contact.roles).join(',');
    const row = new Array(headers.length).fill('');

    const set = (idx: number, val: string) => { if (idx >= 0) row[idx] = val; };

    set(iClubName,  contact.clubName);
    set(iRole,      roleString);
    set(iFirstName, contact.firstName);
    set(iLastName,  contact.lastName);
    set(iName,      contact.name || `${contact.firstName} ${contact.lastName}`.trim());
    set(iPhone,     contact.phone);
    set(iMobile,    contact.mobile);
    set(iNotes,     contact.notes);
    set(iEmail,     contact.email);

    outputRows.push(row);
  }

  console.log(`  Output rows (incl. header): ${outputRows.length}`);

  // ── 4. Create or clear the target sheet ──────────────────────────────────

  console.log(`\nPreparing "${TARGET_SHEET}" sheet…`);
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = meta.data.sheets?.find(s => s.properties?.title === TARGET_SHEET);

  if (existing) {
    console.log(`  Exists — clearing existing data.`);
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${TARGET_SHEET}'!A:ZZ`,
    });
  } else {
    console.log(`  Does not exist — creating.`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: TARGET_SHEET } } }],
      },
    });
  }

  // ── 5. Write output ───────────────────────────────────────────────────────

  console.log(`Writing ${outputRows.length - 1} contact rows to "${TARGET_SHEET}"…`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TARGET_SHEET}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: outputRows },
  });

  console.log('\nDone.');
  const realSourceRows = rows.length - 1 - skipped;
  console.log(`  "${TARGET_SHEET}" now has ${outputRows.length - 1} contacts (merged from ${realSourceRows} real source rows — ${realSourceRows - (outputRows.length - 1)} duplicates collapsed).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
