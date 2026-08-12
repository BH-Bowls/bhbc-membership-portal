/**
 * migrate-rotas.ts
 *
 * Reads live CleaningRota + SweepingRota sheets (Member List spreadsheet) and writes
 * them into the new Postgres cleaning_rota/sweeping_rota tables. Same "refresh Dev,
 * rerun for the real Prod cutover" pattern as migrate-clubs.ts/migrate-fixtures.ts.
 *
 * cleaning_rota.date is a real Postgres date, even though the sheet's own dates
 * ("Sat, 05 September") have no year — every row is assumed to belong to the current
 * calendar year (decided 2026-08; the rota is rebuilt each season, not kept as
 * multi-year history — see supabase/migrations/0027_cleaning_sweeping_rota.sql).
 * sweeping_rota.date is normalized to a real DD/MM/YYYY-derived Postgres date.
 *
 * No markers migration here — is_marker/is_worker/worker_additional_info are
 * member_profiles columns, already populated by migrate-members.ts.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-rotas.ts
 */

import { getGoogleSheetsClient, getSpreadsheetId } from '../src/lib/sheets';
import { getAllUsers } from '../src/lib/members-supabase';
import { normalizeToUKDate } from '../src/lib/date-utils';
import { getSupabaseClient } from '../src/lib/supabase';

const CLEANING_SHEET = 'CleaningRota';
const SWEEPING_SHEET = 'SweepingRota';

interface RawCleaningRow {
  date: string;
  lead: string;
  second: string;
  third: string;
  fourth: string;
}

interface RawSweepingRow {
  date: string;   // DD/MM/YYYY
  userName: string;
  isBlocked: boolean;
}

function toISODate(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "Sat, 05 September" + assumed year -> "2026-09-05". Null if unparseable. */
function cleaningDateToISO(display: string, year: number): string | null {
  const match = display.match(/(\d{1,2})\s+([A-Za-z]+)/);
  if (!match) return null;
  const day = match[1].padStart(2, '0');
  const monthIndex = MONTH_NAMES.indexOf(match[2].toLowerCase());
  if (monthIndex === -1) return null;
  const month = String(monthIndex + 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function fetchCleaningRota(): Promise<RawCleaningRow[]> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${CLEANING_SHEET}!A:E`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const entries: RawCleaningRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const date = (row[0] || '').toString().trim();
    if (!date) continue;
    entries.push({
      date,
      lead: (row[1] || '').toString().trim(),
      second: (row[2] || '').toString().trim(),
      third: (row[3] || '').toString().trim(),
      fourth: (row[4] || '').toString().trim(),
    });
  }
  return entries;
}

async function fetchSweepingRota(): Promise<RawSweepingRow[]> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SWEEPING_SHEET}!A:C`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const entries: RawSweepingRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateValue = row[0];
    if (!dateValue) continue;
    const date = normalizeToUKDate(String(dateValue));
    if (!date) continue;
    const userName = (row[1] || '').toString().trim();
    const isBlockedVal = row[2];
    const isBlocked = isBlockedVal === 'TRUE' || isBlockedVal === true || isBlockedVal === 'true';
    entries.push({ date, userName, isBlocked });
  }
  return entries;
}

async function main() {
  console.log('1. Reading live CleaningRota + SweepingRota sheets + current usernames...');
  const [cleaning, sweeping, allUsers] = await Promise.all([
    fetchCleaningRota(),
    fetchSweepingRota(),
    getAllUsers(),
  ]);
  console.log(`   -> ${cleaning.length} cleaning rota rows, ${sweeping.length} sweeping rota rows`);

  // cleaning_rota's position columns and sweeping_rota.username FK to users(username) —
  // a name in the sheet that doesn't match any current username (departed member, typo)
  // would otherwise fail the whole insert. Null it out instead, with a warning.
  const usernames = new Set(allUsers.map((u) => u.userName.toLowerCase()));
  const resolveUsername = (name: string, context: string): string | null => {
    if (!name) return null;
    if (usernames.has(name.toLowerCase())) return name;
    console.warn(`   !! ${context}: "${name}" doesn't match any current username — nulled, needs review`);
    return null;
  };

  const supabase = getSupabaseClient();

  console.log('2. Wiping existing cleaning_rota/sweeping_rota...');
  const { error: wipeCleaningError } = await supabase
    .from('cleaning_rota')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (wipeCleaningError) throw new Error(`Failed to wipe cleaning_rota: ${wipeCleaningError.message}`);

  const { error: wipeSweepingError } = await supabase
    .from('sweeping_rota')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (wipeSweepingError) throw new Error(`Failed to wipe sweeping_rota: ${wipeSweepingError.message}`);

  console.log('3. Inserting cleaning_rota rows (assuming current season/year)...');
  const currentYear = new Date().getFullYear();
  const cleaningToInsert: { date: string; lead_username: string | null; second_username: string | null; third_username: string | null; fourth_username: string | null }[] = [];
  let cleaningDateSkipped = 0;
  for (const c of cleaning) {
    const iso = cleaningDateToISO(c.date, currentYear);
    if (!iso) {
      console.warn(`   !! cleaning_rota: couldn't parse date "${c.date}" — row skipped`);
      cleaningDateSkipped++;
      continue;
    }
    cleaningToInsert.push({
      date: iso,
      lead_username: resolveUsername(c.lead, `cleaning_rota ${c.date} lead`),
      second_username: resolveUsername(c.second, `cleaning_rota ${c.date} second`),
      third_username: resolveUsername(c.third, `cleaning_rota ${c.date} third`),
      fourth_username: resolveUsername(c.fourth, `cleaning_rota ${c.date} fourth`),
    });
  }
  if (cleaningToInsert.length > 0) {
    const { error } = await supabase.from('cleaning_rota').insert(cleaningToInsert);
    if (error) throw new Error(`cleaning_rota insert failed: ${error.message}`);
  }
  console.log(`   -> ${cleaningToInsert.length} cleaning_rota rows inserted${cleaningDateSkipped > 0 ? ` (${cleaningDateSkipped} skipped — unparseable date)` : ''}`);

  console.log('4. Inserting sweeping_rota rows...');
  if (sweeping.length > 0) {
    const { error } = await supabase.from('sweeping_rota').insert(
      sweeping.map((s) => ({
        date: toISODate(s.date),
        username: resolveUsername(s.userName, `sweeping_rota ${s.date}`),
        is_blocked: s.isBlocked,
      }))
    );
    if (error) throw new Error(`sweeping_rota insert failed: ${error.message}`);
  }
  console.log(`   -> ${sweeping.length} sweeping_rota rows inserted`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
