/**
 * migrate-two-hundred-club.ts
 *
 * Reads the live "200 Club" / "200 Club Settings" / "200 Club Winners" sheets
 * (Members spreadsheet) and writes them into the new Postgres
 * two_hundred_club_entries/two_hundred_club_settings/two_hundred_club_winners
 * tables (supabase/migrations/0034_two_hundred_club.sql). Same
 * "refresh Dev, rerun for the real Prod cutover" pattern as migrate-renewals.ts.
 *
 * Prizes: the old Settings sheet stored them as a single " / "-delimited string
 * (e.g. "45 / 25 / 15 / 10") — split here into a real numeric[] `amounts` array.
 *
 * Username validation: two_hundred_club_entries.username has an FK into `users`.
 * Leavers live in the same Postgres `users` table as active members
 * (is_active=false, not a separate table), so validated against ALL usernames —
 * same lesson as migrate-renewals.ts's leavers bug.
 *
 * Winners has no username FK (member is a display-name snapshot taken at draw
 * time, same as the old sheet), so no validation needed there.
 *
 * Entries/Settings are keyed uniquely by (season, number) / season respectively —
 * normal app usage (assignNumber/saveSettings) always updates in place rather than
 * appending duplicates, but this script dedupes defensively (last row wins) in
 * case legacy sheet data accumulated any before that logic existed.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-two-hundred-club.ts
 */

import { getGoogleSheetsClient, getSpreadsheetId, getColumnMap } from '../src/lib/sheets';
import { getSupabaseClient } from '../src/lib/supabase';

const ENTRIES_SHEET = '200 Club';
const SETTINGS_SHEET = '200 Club Settings';
const WINNERS_SHEET = '200 Club Winners';
const MAX_PRIZES = 10;

function toNum(v: any): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = parseFloat(String(v).replace(/[£,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

async function readTab(sheetName: string): Promise<{ rows: any[][]; colMap: Record<string, number> } | null> {
  const spreadsheetId = getSpreadsheetId();
  try {
    const colMap = await getColumnMap(sheetName, spreadsheetId);
    const resp = await getGoogleSheetsClient().spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A2:ZZ`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    return { rows: resp.data.values || [], colMap };
  } catch {
    return null;
  }
}

async function main() {
  console.log('1. Reading live 200 Club sheets + all usernames (active + leavers)...');
  const supabase = getSupabaseClient();
  const [entriesTab, settingsTab, winnersTab, allUsersResult] = await Promise.all([
    readTab(ENTRIES_SHEET),
    readTab(SETTINGS_SHEET),
    readTab(WINNERS_SHEET),
    supabase.from('users').select('username'),
  ]);
  if (allUsersResult.error) throw new Error(`Failed to fetch usernames: ${allUsersResult.error.message}`);
  const usernames = new Set((allUsersResult.data ?? []).map((u) => (u.username as string).toLowerCase()));

  console.log('2. Wiping existing two_hundred_club_entries/settings/winners...');
  const nilUuid = '00000000-0000-0000-0000-000000000000';
  const { error: wipeEntriesErr } = await supabase.from('two_hundred_club_entries').delete().neq('id', nilUuid);
  if (wipeEntriesErr) throw new Error(`Failed to wipe two_hundred_club_entries: ${wipeEntriesErr.message}`);
  const { error: wipeSettingsErr } = await supabase.from('two_hundred_club_settings').delete().neq('season', '__never_matches__');
  if (wipeSettingsErr) throw new Error(`Failed to wipe two_hundred_club_settings: ${wipeSettingsErr.message}`);
  const { error: wipeWinnersErr } = await supabase.from('two_hundred_club_winners').delete().neq('id', nilUuid);
  if (wipeWinnersErr) throw new Error(`Failed to wipe two_hundred_club_winners: ${wipeWinnersErr.message}`);

  console.log('3. Inserting two_hundred_club_entries...');
  let entriesSkipped = 0;
  const entriesByKey = new Map<string, { season: string; number: string; username: string }>();
  if (entriesTab) {
    const { rows, colMap } = entriesTab;
    const numberCol = colMap['number'] ?? 0;
    const memberCol = colMap['member'] ?? 1;
    const seasonCol = colMap['season'];
    for (const row of rows) {
      const number = (row[numberCol] ?? '').toString().trim();
      if (!number) continue;
      const season = seasonCol !== undefined ? (row[seasonCol] ?? '').toString().trim() : '';
      const username = (row[memberCol] ?? '').toString().trim();
      // No holder — absent row = unassigned (matches assignNumber's clear-deletes behaviour), skip silently.
      if (!username) continue;
      if (!usernames.has(username.toLowerCase())) {
        console.warn(`   !! entries: "${username}" doesn't match any current username — number ${number}/${season} skipped`);
        entriesSkipped++;
        continue;
      }
      entriesByKey.set(`${season}::${number}`, { season, number, username });
    }
  }
  const entriesToInsert = [...entriesByKey.values()];
  if (entriesToInsert.length > 0) {
    const { error } = await supabase.from('two_hundred_club_entries').insert(entriesToInsert);
    if (error) throw new Error(`two_hundred_club_entries insert failed: ${error.message}`);
  }
  console.log(`   -> ${entriesToInsert.length} entries rows inserted${entriesSkipped > 0 ? ` (${entriesSkipped} skipped — unmatched username)` : ''}`);

  console.log('4. Inserting two_hundred_club_settings...');
  const settingsBySeason = new Map<string, { season: string; draws: number; price: number; numbers: number; amounts: number[] }>();
  if (settingsTab) {
    const { rows, colMap } = settingsTab;
    for (const row of rows) {
      const season = (row[colMap['season'] ?? 0] ?? '').toString().trim();
      if (!season) continue;
      const prizesStr = String(row[colMap['prizes'] ?? -1] ?? '');
      const amounts = prizesStr.split('/').map((s: string) => s.trim()).filter(Boolean).map(toNum).slice(0, MAX_PRIZES);
      settingsBySeason.set(season, {
        season,
        draws: toNum(row[colMap['draws'] ?? -1]) || 6,
        price: toNum(row[colMap['price'] ?? -1]) || 6,
        numbers: toNum(row[colMap['numbers'] ?? -1]) || 200,
        amounts,
      });
    }
  }
  const settingsToInsert = [...settingsBySeason.values()];
  if (settingsToInsert.length > 0) {
    const { error } = await supabase.from('two_hundred_club_settings').insert(settingsToInsert);
    if (error) throw new Error(`two_hundred_club_settings insert failed: ${error.message}`);
  }
  console.log(`   -> ${settingsToInsert.length} settings rows inserted`);

  console.log('5. Inserting two_hundred_club_winners...');
  const winnersToInsert: { season: string; date: string; position: number; number: string; member: string; amount: number }[] = [];
  if (winnersTab) {
    const { rows, colMap } = winnersTab;
    for (const row of rows) {
      const season = (row[colMap['season'] ?? 0] ?? '').toString().trim();
      const number = (row[colMap['number'] ?? -1] ?? '').toString().trim();
      if (!season && !number) continue;
      winnersToInsert.push({
        season,
        date: (row[colMap['date'] ?? -1] ?? '').toString().trim(),
        position: toNum(row[colMap['position'] ?? -1]),
        number,
        member: (row[colMap['member'] ?? -1] ?? '').toString().trim(),
        amount: toNum(row[colMap['amount'] ?? -1]),
      });
    }
  }
  if (winnersToInsert.length > 0) {
    const { error } = await supabase.from('two_hundred_club_winners').insert(winnersToInsert);
    if (error) throw new Error(`two_hundred_club_winners insert failed: ${error.message}`);
  }
  console.log(`   -> ${winnersToInsert.length} winners rows inserted`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
