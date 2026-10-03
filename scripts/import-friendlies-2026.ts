/**
 * import-friendlies-2026.ts
 *
 * One-off import of the 2026 friendlies rosters from the Friendlies spreadsheet into
 * the fixture-group tables (supabase/migrations/0072_fixture_groups.sql, spec
 * specs/FIXTURE_GROUPS_SPEC.md §9):
 *
 *   Players sheet (one column per game, one code per player)  ┐
 *   per-game tabs (selected/team/position/driving/token/…)    ├─> fixture_groups,
 *   ManageLog tab                                             ┘   fixture_entries,
 *                                                                 fixture_selections,
 *                                                                 friendlies_manage_log
 *
 * Grouping: every active-season fixture that has a Players column or a game tab gets a
 * group. Fixtures carrying the old paired flag ('Y'/'C') on the same date share one
 * group (a linked occasion); a reserve game ("<tab>-2", is_reserve) joins its
 * original's group with reserve_of set.
 *
 * Per player, per group (a linked pair's two columns/tabs merge into ONE entry):
 *   - entry_source  'manager' for M, otherwise 'self' (buddy entries can't be told
 *                   apart historically; the code is the only record)
 *   - withdrawn     any code ending in W, or game-tab status W
 *   - selection     game-tab selected Y/O (with team/position/driving/car). R/blank =
 *                   reserve (no selection). T (reserve team, deprecated) is reported
 *                   and imported as a reserve.
 *   - confirmed     game-tab status Y; token + acknowledged-cancellation kept
 * Anything ambiguous (tab vs column disagree, unknown username, picked in two games of
 * one group) goes in the report rather than being guessed.
 *
 * Dry run by default — prints the plan and the report, writes nothing. --apply wipes
 * the active season's occasion groups (and imported log rows) first, so it's re-runnable
 * for a Dev refresh, then imports and runs the stats check.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/import-friendlies-2026.ts           # dry run
 *   npx dotenv -e .env.local -- npx tsx scripts/import-friendlies-2026.ts --apply --as=<username>   # write
 *
 * Order after a full Dev refresh: migrate-members -> ... -> migrate-fixtures -> this.
 */

import { getGoogleSheetsClient } from '../src/lib/sheets';
import { getSupabaseClient } from '../src/lib/supabase';
import { getAllPlayerStats } from '../src/lib/fixture-groups-supabase';

const APPLY = process.argv.includes('--apply');
// fixture_groups.created_by is required — the username recorded as creating the imported groups
const AS_USER = (process.argv.find(a => a.startsWith('--as=')) || '').slice('--as='.length);

// ── helpers ──────────────────────────────────────────────────────────────────

function norm(header: unknown): string {
  return String(header ?? '').toLowerCase().trim().replace(/\s+/g, '_').replace(/\//g, '_');
}

function colMapOf(headerRow: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  headerRow.forEach((h, i) => { map[norm(h)] = i; });
  return map;
}

const report: string[] = [];
function note(msg: string) { report.push(msg); }

interface FixtureRow {
  id: string;
  tab_name: string | null;
  date: string | null;
  paired: string | null;
  is_reserve: boolean;
  game_status: string | null;
  club_name: string | null;
  club_suffix: string | null;
  description: string | null;
  season_id: string;
}

interface TabRow {
  selected: string;
  team: number | null;
  position: string;
  driving: string;
  carNumber: string;
  status: string;      // '' | 'Y' | 'W'
  token: string;
  ack: string;
}

interface PlannedEntry {
  username: string;
  source: 'self' | 'manager';
  withdrawn: boolean;
  confirmed: boolean;
  ack: boolean;
  token: string | null;
  carNumber: string | null;
  selection: { fixtureId: string; selection: 'Y' | 'O'; team: number | null; position: string | null; driving: string | null; carNumber: string | null } | null;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const spreadsheetId = process.env.FRIENDLIES_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('FRIENDLIES_SPREADSHEET_ID environment variable is not set');
  const sheets = getGoogleSheetsClient();
  const supabase = getSupabaseClient();

  console.log(APPLY ? '*** APPLY MODE — writing to the database ***' : '--- Dry run (pass --apply to write) ---');

  // 1. Active season + its fixtures
  const { data: season, error: seasonError } = await supabase.from('seasons').select('id, year').eq('is_active', true).single();
  if (seasonError || !season) throw new Error('No active season');
  console.log(`1. Active season ${season.year}`);

  const { data: fixtureData, error: fixError } = await supabase
    .from('fixtures')
    .select('*') // '*' so this still works once 0073 has dropped paired/is_reserve
    .eq('season_id', season.id);
  if (fixError) throw new Error(fixError.message);
  const fixtures = (fixtureData || []) as FixtureRow[];
  const byTab = new Map<string, FixtureRow>();
  for (const f of fixtures) if (f.tab_name) byTab.set(f.tab_name, f);

  // 2. Valid usernames
  const { data: userRows, error: userError } = await supabase.from('users').select('username');
  if (userError) throw new Error(userError.message);
  const validUsers = new Map<string, string>(); // lowercase -> canonical
  for (const u of userRows || []) validUsers.set(u.username.toLowerCase(), u.username);

  // 3. Spreadsheet: tab list, Players sheet, ManageLog
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const tabTitles = new Set((meta.data.sheets || []).map(s => s.properties?.title || ''));

  const playersResp = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Players!A:ZZ' });
  const playersRows = playersResp.data.values || [];
  const playersHeader = playersRows[0] || [];
  const playersMap = colMapOf(playersHeader);
  const userCol = playersMap['user_name'] ?? playersMap['name'] ?? 0;

  // Linking: the database's paired column while it still exists (the cutover run — it
  // has every pairing, including ones made after the Games tab froze in August). Once
  // 0073 has dropped it, fall back to the Games tab's Paired column. A reserve game is
  // "<tab>-2" whose original fixture exists.
  const dbHasPaired = fixtures.length > 0 && Object.prototype.hasOwnProperty.call(fixtures[0], 'paired');
  const pairedByTab = new Map<string, string>();
  if (!dbHasPaired) {
    const gamesResp = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Games!A:ZZ' });
    const gamesRows = gamesResp.data.values || [];
    const gamesMap = colMapOf(gamesRows[0] || []);
    if (gamesMap['tab_name'] !== undefined && gamesMap['paired'] !== undefined) {
      for (let r = 1; r < gamesRows.length; r++) {
        const tab = String(gamesRows[r][gamesMap['tab_name']] || '').trim();
        if (tab) pairedByTab.set(tab, String(gamesRows[r][gamesMap['paired']] || '').trim().toUpperCase());
      }
    }
    console.log(`   Linking taken from the Games tab (${pairedByTab.size} rows)`);
  }
  for (const f of fixtures) {
    if (!dbHasPaired) f.paired = pairedByTab.get(f.tab_name || '') || '';
    f.is_reserve = !!f.tab_name && f.tab_name.endsWith('-2') && byTab.has(f.tab_name.slice(0, -2));
  }

  // Players column codes: tabName -> username(lower) -> code
  const columnCodes = new Map<string, Map<string, string>>();
  playersHeader.forEach((h: unknown, colIdx: number) => {
    const tab = String(h ?? '').trim();
    if (!tab || !byTab.has(tab)) return;
    const codes = new Map<string, string>();
    for (let r = 1; r < playersRows.length; r++) {
      const u = String(playersRows[r][userCol] ?? '').trim();
      const code = String(playersRows[r][colIdx] ?? '').trim().toUpperCase();
      if (u && code) codes.set(u.toLowerCase(), code);
    }
    columnCodes.set(tab, codes);
  });
  console.log(`2. Players sheet: ${playersRows.length - 1} players, ${columnCodes.size} game columns matched to fixtures`);

  // Unmatched Players columns (headers that look like games but have no fixture)
  const fixedCols = new Set(['user_name', 'name', 'full_name', 'name_down', 'picked', 'percent_played', '%_played_vs_name_down', 'future_entered', 'withdrawn', 'cancelled']);
  for (const h of playersHeader) {
    const tab = String(h ?? '').trim();
    if (tab && !fixedCols.has(norm(tab)) && !byTab.has(tab)) note(`Players column "${tab}" has no fixture in season ${season.year} — skipped`);
  }

  // 4. Per-game tabs for every fixture that has one
  const tabData = new Map<string, Map<string, TabRow>>(); // tabName -> username(lower) -> row

  // Read the tabs in batches (one API request per batch) — ~100 separate reads blows
  // the Sheets quota of 60 reads/minute. A pause between batches keeps well under it.
  const tabsToRead: string[] = [];
  for (const f of fixtures) {
    if (f.tab_name && tabTitles.has(f.tab_name)) tabsToRead.push(f.tab_name);
  }
  const tabValues = new Map<string, unknown[][]>();
  const BATCH = 40;
  for (let i = 0; i < tabsToRead.length; i += BATCH) {
    const batch = tabsToRead.slice(i, i + BATCH);
    if (i > 0) await new Promise(resolve => setTimeout(resolve, 2000));
    const resp = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: batch.map(tab => `'${tab.replace(/'/g, "''")}'!A:ZZ`),
    });
    const ranges = resp.data.valueRanges || [];
    for (let j = 0; j < batch.length; j++) {
      const values = ranges[j] && ranges[j].values ? ranges[j].values : [];
      tabValues.set(batch[j], values as unknown[][]);
    }
  }

  for (const f of fixtures) {
    if (!f.tab_name || !tabValues.has(f.tab_name)) continue;
    const rows = tabValues.get(f.tab_name) || [];
    const map = colMapOf(rows[0] || []);
    const get = (row: unknown[], key: string) => (map[key] !== undefined ? String(row[map[key]] ?? '').trim() : '');
    const players = new Map<string, TabRow>();
    for (let r = 1; r < rows.length; r++) {
      const name = get(rows[r], 'user_name') || get(rows[r], 'name');
      if (!name) continue;
      const teamText = get(rows[r], 'team');
      players.set(name.toLowerCase(), {
        selected: get(rows[r], 'selected').toUpperCase(),
        team: teamText ? parseInt(teamText, 10) || null : null,
        position: get(rows[r], 'position'),
        driving: get(rows[r], 'driving').toUpperCase(),
        carNumber: get(rows[r], 'car_number'),
        status: get(rows[r], 'status').toUpperCase(),
        token: get(rows[r], 'token'),
        ack: get(rows[r], 'acknowledged_cancellation').toUpperCase(),
      });
    }
    tabData.set(f.tab_name, players);
  }
  console.log(`3. Read ${tabData.size} per-game tabs`);

  // 5. Build groups: fixtures with a column or a tab
  const involved = fixtures.filter(f => f.tab_name && (columnCodes.has(f.tab_name) || tabData.has(f.tab_name)));
  const groupKeyOf = new Map<string, string>(); // fixture id -> group key
  for (const f of involved) {
    if (f.is_reserve && f.tab_name!.endsWith('-2')) {
      const original = byTab.get(f.tab_name!.slice(0, -2));
      if (original) continue; // assigned after originals
      note(`Reserve game "${f.tab_name}" has no original fixture — imported as its own group`);
    }
    const linked = f.paired === 'Y' || f.paired === 'C';
    const partner = linked
      ? involved.find(o => o.id !== f.id && !o.is_reserve && (o.paired === 'Y' || o.paired === 'C') && o.date === f.date)
      : undefined;
    const key = partner ? `pair:${f.date}` : `fx:${f.id}`;
    groupKeyOf.set(f.id, key);
  }
  for (const f of involved) {
    if (groupKeyOf.has(f.id)) continue;
    const original = byTab.get(f.tab_name!.slice(0, -2))!;
    const originalKey = groupKeyOf.get(original.id) || `fx:${original.id}`;
    groupKeyOf.set(original.id, originalKey);
    groupKeyOf.set(f.id, originalKey);
  }
  const groups = new Map<string, FixtureRow[]>();
  for (const f of fixtures) {
    const key = groupKeyOf.get(f.id);
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(f);
    groups.set(key, list);
  }
  console.log(`4. ${groups.size} groups from ${involved.length} fixtures (${Array.from(groups.values()).filter(g => g.length > 1).length} with more than one game)`);

  // 6. Entries per group
  const planned = new Map<string, PlannedEntry[]>(); // group key -> entries
  let tCount = 0;
  let withdrawnUnpicked = 0;
  for (const [key, groupFixtures] of groups) {
    const byUser = new Map<string, PlannedEntry>();
    for (const f of groupFixtures) {
      const tab = f.tab_name!;
      const codes = columnCodes.get(tab) || new Map<string, string>();
      const rows = tabData.get(tab) || new Map<string, TabRow>();
      const names = new Set<string>([...codes.keys(), ...rows.keys()]);
      for (const lower of names) {
        const username = validUsers.get(lower);
        if (!username) { note(`[${tab}] unknown username "${lower}" — skipped`); continue; }
        const code = codes.get(lower) || '';
        const row = rows.get(lower);
        if (code && !row && tabData.has(tab)) note(`[${tab}] ${username}: in Players column (${code}) but not on the game tab — imported as an entry`);
        if (row && !code && columnCodes.has(tab)) note(`[${tab}] ${username}: on the game tab but no Players column code — imported as an entry`);

        const entry = byUser.get(lower) || {
          username,
          source: 'self' as const,
          withdrawn: false,
          confirmed: false,
          ack: false,
          token: null,
          carNumber: null,
          selection: null,
        };
        if (code === 'M' || code === 'MW') entry.source = 'manager';
        if (code.endsWith('W') || row?.status === 'W') entry.withdrawn = true;
        if (row?.status === 'Y') entry.confirmed = true;
        if (row?.ack === 'Y') entry.ack = true;
        if (row?.token && !entry.token) entry.token = row.token;

        if (row?.selected === 'T') {
          tCount++;
          note(`[${tab}] ${username}: selection T (reserve team) — imported as a reserve`);
        }
        if (row && (row.selected === 'Y' || row.selected === 'O')) {
          if (entry.selection) {
            const other = groupFixtures.find(x => x.id === entry.selection!.fixtureId);
            note(`[${tab}] ${username}: picked in two games of one group (also ${other?.tab_name}) — kept the first`);
          } else {
            entry.selection = {
              fixtureId: f.id,
              selection: row.selected as 'Y' | 'O',
              team: row.team,
              position: ['S', '1', '2', '3'].includes(row.position) ? row.position : null,
              driving: row.driving === 'Y' || row.driving === 'D' ? 'Y' : null, // older tabs may hold 'D'
              carNumber: row.carNumber || null,
            };
          }
        } else if (row?.carNumber && !entry.carNumber) {
          entry.carNumber = row.carNumber;
        }
        // Players-sheet P with no game-tab row picking them: report (tab is the source of truth).
        // PW is the normal "picked, withdrew, captain took them off" case — just counted.
        if (code === 'PW' && !(row && row.selected === 'Y')) {
          withdrawnUnpicked++;
        } else if (code === 'P' && !(row && row.selected === 'Y')) {
          note(`[${tab}] ${username}: Players code ${code} but not Y on the game tab — tab wins`);
        }
        byUser.set(lower, entry);
      }
    }
    planned.set(key, Array.from(byUser.values()));
  }
  const entryCount = Array.from(planned.values()).reduce((n, list) => n + list.length, 0);
  const selectionCount = Array.from(planned.values()).reduce((n, list) => n + list.filter(e => e.selection).length, 0);
  console.log(`5. Planned ${entryCount} entries, ${selectionCount} selections (${tCount} reserve-team 'T' rows reported, ${withdrawnUnpicked} picked-then-withdrew-and-unpicked imported as withdrawn)`);

  // 7. ManageLog
  let logRows: unknown[][] = [];
  if (tabTitles.has('ManageLog')) {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'ManageLog!A:G' });
    logRows = (resp.data.values || []).slice(1);
  }
  console.log(`6. ManageLog: ${logRows.length} rows`);

  if (!APPLY) {
    printReport();
    console.log('\nDry run complete — nothing written. Re-run with --apply to import.');
    return;
  }

  // ── APPLY ──────────────────────────────────────────────────────────────────
  console.log('7. Clearing previous import for this season...');
  {
    const { error: e1 } = await supabase.from('fixtures').update({ group_id: null, reserve_of: null }).eq('season_id', season.id);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await supabase.from('fixture_groups').delete().eq('season_id', season.id).eq('kind', 'occasion');
    if (e2) throw new Error(e2.message);
    const { error: e3 } = await supabase.from('friendlies_manage_log').delete().contains('details', { imported: true });
    if (e3) throw new Error(e3.message);
  }

  console.log('8. Writing groups, entries, selections...');
  const systemUser = AS_USER ? validUsers.get(AS_USER.toLowerCase()) : undefined;
  if (!systemUser) throw new Error('Pass --as=<username> (a real user) to record as the creator of the imported groups');
  for (const [key, groupFixtures] of groups) {
    const main = groupFixtures.filter(f => !f.is_reserve);
    const label = (main.length ? main : groupFixtures)
      .map(f => [f.club_name, f.club_suffix].filter(Boolean).join(' ') || f.description || f.tab_name)
      .join(' + ');
    const { data: g, error: gErr } = await supabase
      .from('fixture_groups')
      .insert({ season_id: season.id, kind: 'occasion', entry_mode: 'self', label, created_by: systemUser })
      .select('id')
      .single();
    if (gErr || !g) throw new Error(`Group "${label}": ${gErr?.message}`);

    const originalId = main[0]?.id ?? null;
    for (const f of groupFixtures) {
      const { error } = await supabase
        .from('fixtures')
        .update({ group_id: g.id, reserve_of: f.is_reserve && originalId && f.id !== originalId ? originalId : null })
        .eq('id', f.id);
      if (error) throw new Error(`Fixture ${f.tab_name}: ${error.message}`);
    }

    const now = new Date().toISOString();
    for (const e of planned.get(key) || []) {
      const insert: Record<string, unknown> = {
        group_id: g.id,
        username: e.username,
        entry_source: e.source,
        entered_by: e.source === 'self' ? e.username : null,
        status: e.withdrawn ? 'withdrawn' : 'entered',
        withdrawn_by: e.withdrawn ? e.username : null,
        withdrawn_at: e.withdrawn ? now : null,
        car_number: e.carNumber,
        confirmed_at: e.confirmed ? now : null,
        cancellation_acknowledged_at: e.ack ? now : null,
      };
      if (e.token) insert.token = e.token;
      const { data: row, error } = await supabase.from('fixture_entries').insert(insert).select('id').single();
      if (error || !row) throw new Error(`Entry ${e.username} in "${label}": ${error?.message}`);
      if (e.selection) {
        const { error: sErr } = await supabase.from('fixture_selections').insert({
          fixture_id: e.selection.fixtureId,
          entry_id: row.id,
          selection: e.selection.selection,
          team: e.selection.team,
          position: e.selection.position,
          driving: e.selection.driving,
          car_number: e.selection.carNumber,
          one_per_entry: true,
        });
        if (sErr) throw new Error(`Selection ${e.username} in "${label}": ${sErr.message}`);
      }
    }
  }

  console.log('9. Writing manage log...');
  const logInserts = logRows
    .filter(r => r[2])
    .map(r => {
      const username = validUsers.get(String(r[1] ?? '').toLowerCase()) || null;
      const tab = String(r[3] ?? '');
      return {
        at: r[0] ? new Date(String(r[0])).toISOString() : new Date().toISOString(),
        username,
        action: String(r[2]),
        tab_name: tab || null,
        fixture_id: byTab.get(tab)?.id ?? null,
        old_status: r[5] ? String(r[5]) : null,
        new_status: r[6] ? String(r[6]) : null,
        details: { imported: true, ...(username ? {} : { sheetUsername: r[1] ?? '' }) },
      };
    });
  for (let i = 0; i < logInserts.length; i += 500) {
    const { error } = await supabase.from('friendlies_manage_log').insert(logInserts.slice(i, i + 500));
    if (error) throw new Error(`Manage log: ${error.message}`);
  }

  // 10. Stats check: live stats vs the Players sheet's own stat columns
  console.log('10. Checking stats against the Players sheet...');
  const live = await getAllPlayerStats(season.id);
  let mismatches = 0;
  for (let r = 1; r < playersRows.length; r++) {
    const u = String(playersRows[r][userCol] ?? '').trim();
    if (!u) continue;
    const read = (k: string) => (playersMap[k] !== undefined ? String(playersRows[r][playersMap[k]] ?? '').trim() : '');
    const sheetNameDown = parseInt(read('name_down') || '0', 10) || 0;
    const sheetPicked = parseInt(read('picked') || '0', 10) || 0;
    const mine = live.get(u.toLowerCase());
    const nameDown = mine?.nameDown ?? 0;
    const picked = mine?.picked ?? 0;
    if (nameDown !== sheetNameDown || picked !== sheetPicked) {
      mismatches++;
      note(`stats ${u}: sheet name_down/picked ${sheetNameDown}/${sheetPicked}, live ${nameDown}/${picked}`);
    }
  }
  console.log(`    ${mismatches} player(s) differ (the sheet only refreshed when a captain ran update-stats, so some drift is expected — see report)`);

  printReport();
  console.log('\nImport complete.');
}

function printReport() {
  console.log(`\n=== Report (${report.length} items) ===`);
  for (const line of report) console.log(` - ${line}`);
}

main().catch(err => {
  // Just the message — Google API errors otherwise dump the whole request/response object
  console.error('Import failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
