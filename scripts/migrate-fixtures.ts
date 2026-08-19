/**
 * migrate-fixtures.ts
 *
 * Reads the live "Games" tab (2026) plus the "Games 2025" and "Games 2024" archive
 * tabs from the Friendlies spreadsheet and writes them into the new Postgres
 * seasons/fixtures tables (fixtures renamed from games in 0023). Re-runnable
 * "refresh Dev" script, same pattern as migrate-members.ts/migrate-clubs.ts.
 *
 * Depends on users already being populated (captain_username/locked_by/
 * last_modified_by/tea_*_username all resolve against real usernames) — run after
 * migrate-members.ts. migrate-members.ts wipes fixtures as part of its own users
 * refresh (fixtures rows reference users via FK), so this script MUST be re-run
 * after every migrate-members.ts run or those columns stay null until it is.
 *
 * Scope: core fixture rows only (Step 4a). Player rosters (game_players / Step 4b)
 * and the live in-season workflow (selection, tea-rota swap, ICS, bulk email) are
 * NOT touched here and NOT cut over — the live 2026 season keeps running entirely
 * on Sheets for the rest of the season. This import gives Season Planning something
 * to build against for 2027, plus a one-time Postgres snapshot of 2026 (re-run this
 * script again later to refresh it — it won't pick up Sheets edits automatically).
 *
 * club_name vs description: a fixture only ever gets club_name set when the raw
 * "Club Name" cell case-insensitively matches a real club_profiles row (Friendly/
 * league fixtures against a directory club). Everything else — ad-hoc games
 * (Rowland internal rounds, representative sides, one-off non-directory opponents
 * like "Sussex County BA Under 25's"), league placeholders ("No Game", "Reserve"),
 * and purely social/internal events (BBQ, Quiz, Coffee Morning) — gets
 * club_name = null, description = the raw text. This is a rough first pass, not a
 * hand-curated classification of every event — expected to be corrected later
 * directly in the fixtures management UI.
 *
 * "Games 2025"/"Games 2024" are drastically thinner sources than the live sheet
 * (Date/Time/Type/Club Name/H-A/Format/Ladies-Men/Dress only — no tab_name, score,
 * status, captain, or tea-rota data in either archive). Their fixture rows import
 * with those fields left null — they're genuinely bare fixture lists, not full
 * match records. Their Date column also has no year in it ("Mon, 27 April") — the
 * year comes from which tab the row was read from.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-fixtures.ts
 */

import { getFriendliesSpreadsheetId, getSheetsClient } from '../src/lib/friendlies-sheets';
import { getSupabaseClient } from '../src/lib/supabase';

interface RawFixture {
  year: number;
  date: string | null; // YYYY-MM-DD
  time: string | null;
  fixtureType: string;
  rawClubName: string;
  clubSuffix: string;
  homeAway: string;
  format: string;
  ladiesMen: string;
  dress: string;
  paired: string; // '' | 'Y' (open-linked) | 'C' (closed-linked/split)
  tabName: string;
  maxCapacity: number | null;
  gameStatus: string;
  bhbcScore: number | null;
  opponentScore: number | null;
  reason: string;
  who: string;
  entered: number | null;
  selected: number | null;
  reserves: number | null;
  captainUsername: string;
  needsPlayers: string;
  lastModifiedBy: string;
  lastModifiedDate: string | null;
  lockedBy: string;
  lockedAt: string | null;
  teaLeadUsername: string;
  teaFirstUsername: string;
  teaSecondUsername: string;
  specialInstructions: string;
  pickupInfo: string;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** Archive date format: "Mon, 27 April" / "Sat, 06 April " — no year, supplied separately. */
function parseArchiveDate(raw: string, year: number): string | null {
  if (!raw) return null;
  const afterComma = raw.includes(',') ? raw.split(',')[1] : raw;
  const match = afterComma.trim().match(/^(\d{1,2})\s+([A-Za-z]+)$/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const month = MONTHS[match[2].toLowerCase()];
  if (month === undefined || isNaN(day)) return null;
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** Live sheet date is already ISO ("2026-01-24") — just validate the shape. */
function parseLiveDate(raw: string): string | null {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function toInt(raw: string): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

async function readSheetRows(spreadsheetId: string, tab: string): Promise<{ headers: string[]; rows: any[][] }> {
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!A:AZ`,
  });
  const values = response.data.values ?? [];
  if (values.length === 0) return { headers: [], rows: [] };
  const headers = values[0].map((h: string) =>
    String(h).toLowerCase().trim().replace(/\s+/g, '_').replace(/\//g, '_')
  );
  return { headers, rows: values.slice(1) };
}

function buildColGetter(headers: string[]) {
  return (row: any[], field: string): string => {
    const idx = headers.indexOf(field);
    return idx >= 0 ? String(row[idx] ?? '').trim() : '';
  };
}

async function fetchLiveFixtures(spreadsheetId: string): Promise<RawFixture[]> {
  const { headers, rows } = await readSheetRows(spreadsheetId, 'Games');
  const get = buildColGetter(headers);
  const out: RawFixture[] = [];
  for (const row of rows) {
    const rawClubName = get(row, 'club_name');
    const rawDate = get(row, 'date');
    if (!rawDate && !rawClubName) continue;
    out.push({
      year: 2026,
      date: parseLiveDate(rawDate),
      time: get(row, 'time') || null,
      fixtureType: get(row, 'type'),
      rawClubName,
      clubSuffix: get(row, 'club_suffix'),
      homeAway: get(row, 'h_a'),
      format: get(row, 'format'),
      ladiesMen: get(row, 'ladies_men'),
      dress: get(row, 'dress'),
      paired: get(row, 'paired'),
      tabName: get(row, 'tab_name'),
      maxCapacity: toInt(get(row, 'max_capacity')),
      gameStatus: get(row, 'status'),
      bhbcScore: toInt(get(row, 'bhbc_score')),
      opponentScore: toInt(get(row, 'opponent_score')),
      reason: get(row, 'reason'),
      who: get(row, 'who'),
      entered: toInt(get(row, 'entered')),
      selected: toInt(get(row, 'selected')),
      reserves: toInt(get(row, 'reserves')),
      captainUsername: get(row, 'captain'),
      needsPlayers: get(row, 'needs_players'),
      lastModifiedBy: get(row, 'last_modified_by'),
      lastModifiedDate: get(row, 'last_modified_date') || null,
      lockedBy: get(row, 'locked_by'),
      lockedAt: get(row, 'locked_at') || null,
      teaLeadUsername: get(row, 'tea_lead'),
      teaFirstUsername: get(row, 'tea_first'),
      teaSecondUsername: get(row, 'tea_second'),
      specialInstructions: get(row, 'special_instructions'),
      pickupInfo: get(row, 'pickup_information'),
    });
  }
  return out;
}

async function fetchArchiveFixtures(spreadsheetId: string, tab: string, year: number): Promise<RawFixture[]> {
  const { headers, rows } = await readSheetRows(spreadsheetId, tab);
  const get = buildColGetter(headers);
  const out: RawFixture[] = [];
  for (const row of rows) {
    const rawDate = get(row, 'date');
    const rawClubName = get(row, 'club_name');
    if (!rawDate && !rawClubName) continue;
    out.push({
      year,
      date: parseArchiveDate(rawDate, year),
      time: get(row, 'time') || null,
      fixtureType: get(row, 'type'),
      rawClubName,
      clubSuffix: '',
      homeAway: get(row, 'h_a'),
      format: get(row, 'format'),
      ladiesMen: get(row, 'ladies_men'),
      dress: get(row, 'dress'),
      paired: '',
      tabName: '',
      maxCapacity: null,
      gameStatus: '',
      bhbcScore: null,
      opponentScore: null,
      reason: '',
      who: '',
      entered: null,
      selected: null,
      reserves: null,
      captainUsername: '',
      needsPlayers: '',
      lastModifiedBy: '',
      lastModifiedDate: null,
      lockedBy: '',
      lockedAt: null,
      teaLeadUsername: '',
      teaFirstUsername: '',
      teaSecondUsername: '',
      specialInstructions: '',
      pickupInfo: '',
    });
  }
  return out;
}

async function main() {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const supabase = getSupabaseClient();

  console.log('1. Reading fixture data from Google Sheets...');
  const [live2026, archive2025, archive2024] = await Promise.all([
    fetchLiveFixtures(spreadsheetId),
    fetchArchiveFixtures(spreadsheetId, 'Games 2025', 2025),
    fetchArchiveFixtures(spreadsheetId, 'Games 2024', 2024),
  ]);
  console.log(`   -> 2026: ${live2026.length}, 2025: ${archive2025.length}, 2024: ${archive2024.length}`);

  console.log('2. Reading club names + usernames for matching...');
  const [{ data: clubs }, { data: users }] = await Promise.all([
    supabase.from('club_profiles').select('club_name'),
    supabase.from('users').select('username'),
  ]);
  const clubByLower = new Map((clubs ?? []).map((c) => [c.club_name.toLowerCase(), c.club_name]));
  const validUsernames = new Set((users ?? []).map((u) => u.username));

  const usernameAnomalies = { count: 0 };
  const resolveUsername = (raw: string, label: string): string | null => {
    if (!raw) return null;
    if (validUsernames.has(raw)) return raw;
    console.warn(`   !! ${label} "${raw}" doesn't match any user — nulled`);
    usernameAnomalies.count++;
    return null;
  };

  console.log('3. Wiping existing fixtures + seasons (dependency order)...');
  const { error: wipeFixturesError } = await supabase
    .from('fixtures')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (wipeFixturesError) throw new Error(`Failed to wipe fixtures: ${wipeFixturesError.message}`);

  const { error: wipeSeasonsError } = await supabase
    .from('seasons')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (wipeSeasonsError) throw new Error(`Failed to wipe seasons: ${wipeSeasonsError.message}`);

  console.log('4. Building seasons rows (start/end derived from actual fixture dates)...');
  const yearGroups: [number, RawFixture[]][] = [[2024, archive2024], [2025, archive2025], [2026, live2026]];
  const seasonRows: { year: number; start_date: string; end_date: string; is_active: boolean }[] = [];
  for (const [year, fixtures] of yearGroups) {
    const dates = fixtures.map((f) => f.date).filter((d): d is string => !!d).sort();
    if (dates.length === 0) {
      console.warn(`   !! No dated fixtures found for ${year} — skipping season row`);
      continue;
    }
    seasonRows.push({
      year,
      start_date: dates[0],
      end_date: dates[dates.length - 1],
      is_active: year === 2026,
    });
  }
  const { data: insertedSeasons, error: seasonsError } = await supabase
    .from('seasons')
    .insert(seasonRows)
    .select('id, year');
  if (seasonsError) throw new Error(`seasons insert failed: ${seasonsError.message}`);
  console.log(`   -> ${insertedSeasons.length} seasons inserted`);
  const seasonIdByYear = new Map(insertedSeasons.map((s) => [s.year, s.id]));

  console.log('5. Building fixtures rows...');
  const allFixtures = [...live2026, ...archive2025, ...archive2024];
  let descriptionCount = 0;
  const fixturesToInsert = allFixtures.map((f) => {
    const clubMatch = f.rawClubName ? clubByLower.get(f.rawClubName.toLowerCase()) : undefined;
    if (f.rawClubName && !clubMatch) descriptionCount++;

    return {
      season_id: seasonIdByYear.get(f.year),
      fixture_type: f.fixtureType,
      club_name: clubMatch ?? null,
      description: clubMatch ? null : (f.rawClubName || null),
      date: f.date,
      time: f.time,
      home_away: f.homeAway === 'H' || f.homeAway === 'A' ? f.homeAway : null,
      format: f.format || null,
      ladies_men: f.ladiesMen || null,
      dress: f.dress || null,
      tab_name: f.tabName || null,
      club_suffix: f.clubSuffix || null,
      game_status: f.gameStatus,
      max_capacity: f.maxCapacity,
      entered: f.entered ?? 0,
      selected: f.selected ?? 0,
      reserves: f.reserves ?? 0,
      bhbc_score: f.bhbcScore,
      opponent_score: f.opponentScore,
      reason: f.reason || null,
      who: f.who || null,
      special_instructions: f.specialInstructions || null,
      pickup_info: f.pickupInfo || null,
      paired: f.paired,
      needs_players: f.needsPlayers || null,
      last_modified_date: f.lastModifiedDate,
      locked_at: f.lockedAt,
      captain_username: resolveUsername(f.captainUsername, 'captain'),
      locked_by: resolveUsername(f.lockedBy, 'locked_by'),
      last_modified_by: resolveUsername(f.lastModifiedBy, 'last_modified_by'),
      tea_lead_username: resolveUsername(f.teaLeadUsername, 'tea_lead'),
      tea_first_username: resolveUsername(f.teaFirstUsername, 'tea_first'),
      tea_second_username: resolveUsername(f.teaSecondUsername, 'tea_second'),
    };
  });

  const { error: fixturesError } = await supabase.from('fixtures').insert(fixturesToInsert);
  if (fixturesError) throw new Error(`fixtures insert failed: ${fixturesError.message}`);
  console.log(
    `   -> ${fixturesToInsert.length} fixtures inserted (${descriptionCount} routed to description instead of club_name, ${usernameAnomalies.count} username anomalies nulled)`
  );

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
