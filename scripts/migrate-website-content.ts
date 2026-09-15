/**
 * migrate-website-content.ts
 *
 * One-off cutover: reads every tab of the bhbc-website's "Website Content"
 * Google Sheet and writes it into the new `website` Postgres schema
 * (supabase/migrations/0054_website_schema.sql). Same "refresh Dev, rerun for
 * the real Prod cutover" pattern as migrate-announcements.ts.
 *
 * honours_internal is the one table whose column names differ from the sheet
 * headers — the sheet used legacy/historical competition names transcribed
 * from physical honours boards, while the website's display labels (and now
 * this table) use the current names. See specs/HONOURS_DELTA_SPEC.md and
 * CLAUDE.md in the bhbc-website repo.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-website-content.ts
 *
 * Requires WEBSITE_CONTENT_SHEET_ID in .env.local — copy the value from the
 * bhbc-website repo's own .env.local (same spreadsheet, same shared service
 * account, same convention already used in reverse for FRIENDLIES_SPREADSHEET_ID).
 */

import { getGoogleSheetsClient } from '../src/lib/sheets';
import { getSupabaseClient } from '../src/lib/supabase';

function getWebsiteContentSpreadsheetId(): string {
  const id = process.env.WEBSITE_CONTENT_SHEET_ID;
  if (!id) throw new Error('WEBSITE_CONTENT_SHEET_ID environment variable is not set.');
  return id;
}

// A placeholder that can never collide with a real row, so `.delete().neq(col, placeholder)`
// deletes every row — Supabase requires a filter on delete, this is the standard workaround.
const NEVER_MATCHES_UUID = '00000000-0000-0000-0000-000000000000';
const NEVER_MATCHES_YEAR = -1;

/** Read every row of a tab, keyed by its header row — mirrors bhbc-website's lib/sheets.ts. */
async function readSheetRows(tabName: string): Promise<Record<string, string>[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getWebsiteContentSpreadsheetId();

  let response;
  try {
    response = await sheets.spreadsheets.values.get({ spreadsheetId, range: tabName });
  } catch (err: any) {
    // Tab doesn't exist yet (e.g. RowlandInterest before any submissions) — treat as empty
    // rather than failing the whole migration run.
    const msg = String(err?.message ?? '');
    if (msg.includes('Unable to parse range') || err?.code === 400) {
      console.warn(`  !! tab "${tabName}" not found in spreadsheet — treating as empty`);
      return [];
    }
    throw err;
  }
  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];

  const headers = rows[0] as string[];
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = (row[i] as string) ?? '';
    });
    return obj;
  });
}

/** Convert a UK-format DD/MM/YYYY sheet date into an ISO YYYY-MM-DD string for a Postgres `date` column. */
function ukDateToIso(value: string): string | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

async function migrateCommittee(): Promise<void> {
  console.log('Committee...');
  const supabase = getSupabaseClient().schema('website');
  const rows = await readSheetRows('Committee');

  const { error: wipeErr } = await supabase.from('committee').delete().neq('id', NEVER_MATCHES_UUID);
  if (wipeErr) throw new Error(`committee wipe failed: ${wipeErr.message}`);

  const toInsert = rows
    .filter((r) => r['name'])
    .map((r) => ({
      name: r['name'],
      role: r['role'] ?? '',
      email: r['email'] || null,
      display_order: parseInt(r['display_order'] ?? '0', 10) || 0,
      active: r['active'] === 'Y',
    }));

  if (toInsert.length > 0) {
    const { error } = await supabase.from('committee').insert(toInsert);
    if (error) throw new Error(`committee insert failed: ${error.message}`);
  }
  console.log(`  -> ${toInsert.length} rows`);
}

async function migrateCoaches(): Promise<void> {
  console.log('Coaches...');
  const supabase = getSupabaseClient().schema('website');
  const rows = await readSheetRows('Coaches');

  const { error: wipeErr } = await supabase.from('coaches').delete().neq('id', NEVER_MATCHES_UUID);
  if (wipeErr) throw new Error(`coaches wipe failed: ${wipeErr.message}`);

  const toInsert = rows
    .filter((r) => r['name'])
    .map((r) => ({
      name: r['name'],
      qualification: r['qualification'] ?? '',
      bio: r['bio'] || null,
      active: r['active'] === 'Y',
    }));

  if (toInsert.length > 0) {
    const { error } = await supabase.from('coaches').insert(toInsert);
    if (error) throw new Error(`coaches insert failed: ${error.message}`);
  }
  console.log(`  -> ${toInsert.length} rows`);
}

async function migrateAnnouncements(): Promise<void> {
  console.log('Announcements...');
  const supabase = getSupabaseClient().schema('website');
  const rows = await readSheetRows('Announcements');

  const { error: wipeErr } = await supabase.from('announcements').delete().neq('id', NEVER_MATCHES_UUID);
  if (wipeErr) throw new Error(`announcements wipe failed: ${wipeErr.message}`);

  const allowedTypes = new Set(['open-day', 'visiting-side', 'event', 'notice']);
  let skipped = 0;
  const toInsert = [];
  for (const r of rows) {
    if (!r['title']) continue;
    const startDate = ukDateToIso(r['start_date'] ?? '');
    const endDate = ukDateToIso(r['end_date'] ?? '');
    if (!startDate || !endDate) {
      console.warn(`  !! announcements: "${r['title']}" has an unparseable start/end date — skipped`);
      skipped++;
      continue;
    }
    toInsert.push({
      title: r['title'],
      body: r['body'] ?? '',
      type: allowedTypes.has(r['type']) ? r['type'] : 'notice',
      cta_label: r['cta_label'] || null,
      cta_url: r['cta_url'] || null,
      start_date: startDate,
      end_date: endDate,
      active: r['active'] === 'Y',
    });
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('announcements').insert(toInsert);
    if (error) throw new Error(`announcements insert failed: ${error.message}`);
  }
  console.log(`  -> ${toInsert.length} rows${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
}

async function migrateRowlandInterest(): Promise<void> {
  console.log('RowlandInterest...');
  const supabase = getSupabaseClient().schema('website');
  const rows = await readSheetRows('RowlandInterest');

  const { error: wipeErr } = await supabase.from('rowland_interest').delete().neq('id', NEVER_MATCHES_UUID);
  if (wipeErr) throw new Error(`rowland_interest wipe failed: ${wipeErr.message}`);

  const toInsert = rows
    .filter((r) => r['club_name'] || r['email'])
    .map((r) => ({
      submitted_at: r['submitted_at'] || new Date().toISOString(),
      club_name: r['club_name'] ?? '',
      contact_name: r['contact_name'] ?? '',
      email: r['email'] ?? '',
      phone: r['phone'] || null,
      division: r['division'] || null,
      notes: r['notes'] || null,
    }));

  if (toInsert.length > 0) {
    const { error } = await supabase.from('rowland_interest').insert(toInsert);
    if (error) throw new Error(`rowland_interest insert failed: ${error.message}`);
  }
  console.log(`  -> ${toInsert.length} rows`);
}

// Legacy sheet column -> new website.honours_internal column.
// Columns not listed here keep their name unchanged (see CLAUDE.md / HONOURS_DELTA_SPEC.md
// for why some competitions were renamed and others weren't).
const HONOURS_INTERNAL_COLUMN_MAP: Record<string, string> = {
  captain: 'mens_captain',
  mens_champion: 'mens_championship',
  mens_maynard: 'mixed_handicap',
  pairs: 'drawn_pairs',
  triples: 'drawn_triples',
  victor_veterans: 'veterans_cup',
  centenary: 'centenary_cup',
};

async function migrateHonoursInternal(): Promise<void> {
  console.log('HonoursInternal...');
  const supabase = getSupabaseClient().schema('website');
  const rows = await readSheetRows('HonoursInternal');

  const { error: wipeErr } = await supabase.from('honours_internal').delete().neq('year', NEVER_MATCHES_YEAR);
  if (wipeErr) throw new Error(`honours_internal wipe failed: ${wipeErr.message}`);

  const toInsert = [];
  for (const r of rows) {
    const year = parseInt(r['year'] ?? '0', 10);
    if (!Number.isFinite(year) || year <= 0) continue;

    const row: Record<string, string | number | null> = { year };
    for (const [sheetCol, value] of Object.entries(r)) {
      if (sheetCol === 'year') continue;
      const dbCol = HONOURS_INTERNAL_COLUMN_MAP[sheetCol] ?? sheetCol;
      row[dbCol] = value || null;
    }
    toInsert.push(row);
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('honours_internal').insert(toInsert);
    if (error) throw new Error(`honours_internal insert failed: ${error.message}`);
  }
  console.log(`  -> ${toInsert.length} rows`);
}

async function migrateHonoursExternal(): Promise<void> {
  console.log('HonoursExternal...');
  const supabase = getSupabaseClient().schema('website');
  const rows = await readSheetRows('HonoursExternal');

  const { error: wipeErr } = await supabase.from('honours_external').delete().neq('id', NEVER_MATCHES_UUID);
  if (wipeErr) throw new Error(`honours_external wipe failed: ${wipeErr.message}`);

  const toInsert = rows
    .map((r) => ({
      year: parseInt(r['year'] ?? '0', 10),
      competition: r['Competition'] ?? r['competition'] ?? '',
      detail: r['Detail'] ?? r['detail'] ?? null,
    }))
    .filter((r) => r.year > 0);

  if (toInsert.length > 0) {
    const { error } = await supabase.from('honours_external').insert(toInsert);
    if (error) throw new Error(`honours_external insert failed: ${error.message}`);
  }
  console.log(`  -> ${toInsert.length} rows`);
}

async function main() {
  console.log(`Migrating Website Content sheet -> website schema (spreadsheet ${getWebsiteContentSpreadsheetId()})\n`);
  await migrateCommittee();
  await migrateCoaches();
  await migrateAnnouncements();
  await migrateRowlandInterest();
  await migrateHonoursInternal();
  await migrateHonoursExternal();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
