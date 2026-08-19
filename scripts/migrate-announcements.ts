/**
 * migrate-announcements.ts
 *
 * Reads the live HomeAnnouncements sheet (Portal Config spreadsheet) and writes
 * it into the new Postgres announcements table (supabase/migrations/0035_announcements.sql).
 * Same "refresh Dev, rerun for the real Prod cutover" pattern as migrate-renewals.ts.
 *
 * created_by/updated_by have FKs into `users` — validated against ALL usernames
 * (active + leavers, same table) since an old announcement could have been created
 * by someone who has since left. A row whose created_by doesn't match any current
 * username is skipped (the FK would reject it); updated_by is nulled instead of
 * skipping the whole row, since it's optional.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-announcements.ts
 */

import { getGoogleSheetsClient, getColumnMap } from '../src/lib/sheets';
import { getSupabaseClient } from '../src/lib/supabase';

const SHEET_NAME = 'HomeAnnouncements';

function getConfigSpreadsheetId(): string {
  const id = process.env.PORTAL_CONFIG_SPREADSHEET_ID;
  if (!id) throw new Error('PORTAL_CONFIG_SPREADSHEET_ID environment variable is not set.');
  return id;
}

interface RawAnnouncementRow {
  id: string;
  message: string;
  expiresAt: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

async function fetchAnnouncements(): Promise<RawAnnouncementRow[]> {
  const spreadsheetId = getConfigSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const colMap = await getColumnMap(SHEET_NAME, spreadsheetId);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:G`,
  });

  const rows = response.data.values ?? [];
  const get = (row: any[], field: string): string => {
    const idx = colMap[field];
    return idx !== undefined ? (row[idx] || '').toString().trim() : '';
  };

  const entries: RawAnnouncementRow[] = [];
  for (const row of rows) {
    const id = get(row, 'id');
    if (!id) continue;
    entries.push({
      id,
      message: get(row, 'message'),
      expiresAt: get(row, 'expires_at'),
      createdBy: get(row, 'created_by'),
      createdAt: get(row, 'created_at'),
      updatedBy: get(row, 'updated_by'),
      updatedAt: get(row, 'updated_at'),
    });
  }
  return entries;
}

async function main() {
  console.log('1. Reading live HomeAnnouncements sheet + all usernames (active + leavers)...');
  const supabase = getSupabaseClient();
  const [announcements, allUsersResult] = await Promise.all([
    fetchAnnouncements(),
    supabase.from('users').select('username'),
  ]);
  if (allUsersResult.error) throw new Error(`Failed to fetch usernames: ${allUsersResult.error.message}`);
  console.log(`   -> ${announcements.length} announcement rows`);

  const usernames = new Set((allUsersResult.data ?? []).map((u) => (u.username as string).toLowerCase()));

  console.log('2. Wiping existing announcements...');
  const { error: wipeErr } = await supabase.from('announcements').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (wipeErr) throw new Error(`Failed to wipe announcements: ${wipeErr.message}`);

  console.log('3. Inserting announcements...');
  let skipped = 0;
  const toInsert = [];
  for (const a of announcements) {
    if (!a.createdBy || !usernames.has(a.createdBy.toLowerCase())) {
      console.warn(`   !! announcements: created_by "${a.createdBy}" doesn't match any current username — row ${a.id} skipped`);
      skipped++;
      continue;
    }
    const updatedBy = a.updatedBy && usernames.has(a.updatedBy.toLowerCase()) ? a.updatedBy : null;
    toInsert.push({
      id: a.id,
      message: a.message,
      expires_at: a.expiresAt || new Date().toISOString(),
      created_by: a.createdBy,
      created_at: a.createdAt || new Date().toISOString(),
      updated_by: updatedBy,
      updated_at: updatedBy ? (a.updatedAt || null) : null,
    });
  }
  if (toInsert.length > 0) {
    const { error } = await supabase.from('announcements').insert(toInsert);
    if (error) throw new Error(`announcements insert failed: ${error.message}`);
  }
  console.log(`   -> ${toInsert.length} announcements rows inserted${skipped > 0 ? ` (${skipped} skipped — unmatched username)` : ''}`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
