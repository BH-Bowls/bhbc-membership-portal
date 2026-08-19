/**
 * migrate-competitions.ts
 *
 * Reads the live CompetitionsControl + 12 per-competition match sheets + the
 * CompetitionsSettings sheet (Competitions spreadsheet) and writes them into the new
 * Postgres competitions/competition_matches/competition_settings tables. Same
 * "refresh Dev, rerun for the real Prod cutover" pattern as the other migrate-*.ts scripts.
 *
 * The compId -> sheet name mapping only exists here now — competitions-supabase.ts's
 * COMP_SHEET_CONFIG dropped it (competition_matches is one unified table, not 12), so
 * this script keeps its own local copy since it's the only thing left that still needs it.
 *
 * marker_username has a real FK into users(username) — resolved against ALL usernames
 * (active + leavers, both live in the same `users` table with is_active flagging them),
 * same lesson as migrate-renewals.ts: filtering to active-only would wrongly null out a
 * marker who has since left the club. side1/side2 usernames have no DB-level FK (plain
 * text[], not checked) so they're carried through as-is even if unresolvable — matches
 * the Sheets version's own leniency there.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-competitions.ts
 */

import { getGoogleSheetsClient, getCompetitionsSpreadsheetId, getColumnMap } from '../src/lib/sheets';
import { getSupabaseClient } from '../src/lib/supabase';

const COMP_TO_SHEET: Record<string, string> = {
  'mens-championship': 'CompMensChampionship',
  'ladies-maynard': 'CompLadiesMaynard',
  'mens-two-wood': 'CompMensTwoWood',
  'ladies-two-wood': 'CompLadiesTwoWood',
  'handicap': 'CompHandicap',
  'oldlands': 'CompOldlands',
  'veterans': 'CompVeterans',
  'married-pairs': 'CompMarriedPairs',
  'drawn-pairs': 'CompDrawnPairs',
  'australian-pairs': 'CompAustralianPairs',
  'drawn-triples': 'CompDrawnTriples',
  'centenary': 'CompCentenary',
};

const SETTINGS_SHEET = 'CompetitionsSettings';

function getBool(val: string): boolean {
  return val === 'Y' || val === 'Yes' || val === 'TRUE' || val === 'true';
}

/** Same tolerant parsing as the old competitions-sheets.ts's private normalizeDate:
 * UK D/M/YYYY, already-ISO, or a raw Google Sheets date serial (epoch 30 Dec 1899). */
function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const serial = Number(raw);
  if (!isNaN(serial) && serial > 1000 && raw.indexOf('/') === -1) {
    const epoch = new Date(1899, 11, 30);
    const date = new Date(epoch.getTime() + serial * 86400000);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  console.warn(`   !! Could not parse date "${raw}" — left null`);
  return null;
}

function parseSide(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw.split('|').map((s) => s.trim()).filter(Boolean);
}

interface RawMatch {
  compId: string;
  matchId: string;
  round: string;
  position: number;
  side1: string[];
  side2: string[] | null;
  score1: number | null;
  score2: number | null;
  winnerSide: number | null;
  status: string;
  playByDate: string | null;
  playedDate: string | null;
  marker: string;
}

async function fetchControl(): Promise<any[]> {
  const spreadsheetId = getCompetitionsSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const colMap = await getColumnMap('CompetitionsControl', spreadsheetId);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'CompetitionsControl!A2:Z',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const get = (row: any[], field: string): string => {
    const idx = colMap[field];
    return idx !== undefined ? (row[idx] || '').toString().trim() : '';
  };

  return rows
    .filter((row) => get(row, 'comp_id'))
    .map((row) => ({
      compId: get(row, 'comp_id'),
      displayName: get(row, 'display_name'),
      compType: get(row, 'comp_type') || 'singles',
      status: get(row, 'status') || 'Not Started',
      year: parseInt(get(row, 'year') || '0', 10),
      finalsDate: normalizeDate(get(row, 'finals_date')),
      prelimPlayBy: normalizeDate(get(row, 'prelim_play_by')),
      r1PlayBy: normalizeDate(get(row, 'r1_play_by')),
      r2PlayBy: normalizeDate(get(row, 'r2_play_by')),
      qfPlayBy: normalizeDate(get(row, 'qf_play_by')),
      sfPlayBy: normalizeDate(get(row, 'sf_play_by')),
      prelimFixed: getBool(get(row, 'prelim_fixed')),
      r1Fixed: getBool(get(row, 'r1_fixed')),
      r2Fixed: getBool(get(row, 'r2_fixed')),
      qfFixed: getBool(get(row, 'qf_fixed')),
      sfFixed: getBool(get(row, 'sf_fixed')),
      finalsFixed: getBool(get(row, 'finals_fixed')),
      drawSideCount: get(row, 'draw_side_count') ? parseInt(get(row, 'draw_side_count'), 10) : null,
      compStartDate: normalizeDate(get(row, 'comp_start')),
      compDescription: get(row, 'comp_description') || null,
      extraDescription: get(row, 'extra_description') || null,
      markersNotes: get(row, 'markers_notes') || null,
    }));
}

async function fetchMatches(compId: string, sheetName: string): Promise<RawMatch[]> {
  const spreadsheetId = getCompetitionsSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  let colMap: Record<string, number>;
  try {
    colMap = await getColumnMap(sheetName, spreadsheetId);
  } catch {
    console.warn(`   !! Sheet "${sheetName}" not found — skipping ${compId}`);
    return [];
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:Z`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const get = (row: any[], field: string): string => {
    const idx = colMap[field];
    return idx !== undefined ? (row[idx] || '').toString().trim() : '';
  };
  const getInt = (row: any[], field: string): number | null => {
    const v = get(row, field);
    if (!v) return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  };

  return rows
    .filter((row) => get(row, 'match_id'))
    .map((row) => ({
      compId,
      matchId: get(row, 'match_id'),
      round: get(row, 'round') || 'R1',
      position: parseInt(get(row, 'position') || '1', 10),
      side1: parseSide(get(row, 'side1')),
      side2: get(row, 'side2') ? parseSide(get(row, 'side2')) : null,
      score1: getInt(row, 'score1'),
      score2: getInt(row, 'score2'),
      winnerSide: getInt(row, 'winner_side'),
      status: get(row, 'status') || 'Pending',
      playByDate: normalizeDate(get(row, 'play_by_date')),
      playedDate: normalizeDate(get(row, 'played_date')),
      marker: get(row, 'marker'),
    }));
}

async function fetchSettings(): Promise<Array<{ key: string; value: string }>> {
  const spreadsheetId = getCompetitionsSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SETTINGS_SHEET}!A:B`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const entries: Array<{ key: string; value: string }> = [];
  for (const row of rows) {
    const key = String(row[0] ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    if (key) entries.push({ key, value: String(row[1] ?? '') });
  }
  return entries;
}

async function main() {
  console.log('1. Reading CompetitionsControl + 12 match sheets + CompetitionsSettings + all usernames...');
  const supabase = getSupabaseClient();

  const [control, settings, allUsersResult] = await Promise.all([
    fetchControl(),
    fetchSettings(),
    supabase.from('users').select('username'),
  ]);
  if (allUsersResult.error) throw new Error(`Failed to fetch usernames: ${allUsersResult.error.message}`);
  const usernames = new Set((allUsersResult.data ?? []).map((u) => (u.username as string).toLowerCase()));

  const allMatches: RawMatch[] = [];
  for (const compId of Object.keys(COMP_TO_SHEET)) {
    const matches = await fetchMatches(compId, COMP_TO_SHEET[compId]);
    allMatches.push(...matches);
  }
  console.log(`   -> ${control.length} competitions, ${allMatches.length} matches, ${settings.length} settings rows`);

  console.log('2. Wiping existing competition_matches/competitions/competition_settings...');
  const { error: wipeMatchesError } = await supabase.from('competition_matches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (wipeMatchesError) throw new Error(`Failed to wipe competition_matches: ${wipeMatchesError.message}`);
  const { error: wipeCompsError } = await supabase.from('competitions').delete().neq('comp_id', '__never_matches__');
  if (wipeCompsError) throw new Error(`Failed to wipe competitions: ${wipeCompsError.message}`);
  const { error: wipeSettingsError } = await supabase.from('competition_settings').delete().neq('key', '__never_matches__');
  if (wipeSettingsError) throw new Error(`Failed to wipe competition_settings: ${wipeSettingsError.message}`);

  console.log('3. Inserting competitions rows...');
  const competitionsToInsert = control.map((c) => ({
    comp_id: c.compId,
    display_name: c.displayName,
    comp_type: c.compType,
    status: c.status,
    year: c.year,
    finals_date: c.finalsDate,
    prelim_play_by: c.prelimPlayBy,
    r1_play_by: c.r1PlayBy,
    r2_play_by: c.r2PlayBy,
    qf_play_by: c.qfPlayBy,
    sf_play_by: c.sfPlayBy,
    prelim_fixed: c.prelimFixed,
    r1_fixed: c.r1Fixed,
    r2_fixed: c.r2Fixed,
    qf_fixed: c.qfFixed,
    sf_fixed: c.sfFixed,
    finals_fixed: c.finalsFixed,
    draw_side_count: c.drawSideCount,
    comp_start_date: c.compStartDate,
    comp_description: c.compDescription,
    extra_description: c.extraDescription,
    markers_notes: c.markersNotes,
  }));
  if (competitionsToInsert.length > 0) {
    const { error } = await supabase.from('competitions').insert(competitionsToInsert);
    if (error) throw new Error(`competitions insert failed: ${error.message}`);
  }
  console.log(`   -> ${competitionsToInsert.length} competitions rows inserted`);

  console.log('4. Inserting competition_matches rows...');
  let markersNulled = 0;
  const matchesToInsert = allMatches.map((m) => {
    let markerUsername: string | null = m.marker || null;
    if (markerUsername && !usernames.has(markerUsername.toLowerCase())) {
      console.warn(`   !! ${m.compId} ${m.matchId}: marker "${markerUsername}" doesn't match any username — nulled`);
      markerUsername = null;
      markersNulled++;
    }
    return {
      comp_id: m.compId,
      match_id: m.matchId,
      round: m.round,
      position: m.position,
      side1_usernames: m.side1,
      side2_usernames: m.side2,
      score1: m.score1,
      score2: m.score2,
      winner_side: m.winnerSide,
      status: m.status,
      play_by_date: m.playByDate,
      played_date: m.playedDate,
      marker_username: markerUsername,
    };
  });
  if (matchesToInsert.length > 0) {
    const { error } = await supabase.from('competition_matches').insert(matchesToInsert);
    if (error) throw new Error(`competition_matches insert failed: ${error.message}`);
  }
  console.log(`   -> ${matchesToInsert.length} competition_matches rows inserted${markersNulled > 0 ? ` (${markersNulled} markers nulled — unmatched username)` : ''}`);

  console.log('5. Inserting competition_settings rows...');
  if (settings.length > 0) {
    const { error } = await supabase.from('competition_settings').insert(settings);
    if (error) throw new Error(`competition_settings insert failed: ${error.message}`);
  }
  console.log(`   -> ${settings.length} competition_settings rows inserted`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
