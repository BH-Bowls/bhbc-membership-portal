// src/lib/rowland-sheets.ts
// Data layer for the Rowland Cup system
//
// Sheet layout (ROWLAND_SPREADSHEET_ID):
//   RowlandControl          — one row per competition (metadata & play-by dates)
//   Rowland_edward-a        — one row per match in Edward A
//   Rowland_edward-b        — one row per match in Edward B
//   Rowland_gladys-a        — one row per match in Gladys A
//   Rowland_gladys-b        — one row per match in Gladys B
//
// Players are stored pipe-separated in home_players / away_players cells.

import {
  getRowlandSpreadsheetId,
  getGoogleSheetsClient,
  getColumnMap,
  getColumnLetter,
} from './sheets';

import type {
  RowlandComp,
  RowlandCompId,
  RowlandMatch,
  RowlandMatchStatus,
  RowlandCompStatus,
  RowlandRound,
  RowlandTeamRef,
} from '@/types/rowland';

import {
  ROWLAND_SHEET_NAMES,
  ROWLAND_ROUND_ORDER,
} from '@/types/rowland';

// ============================================================================
// HELPERS
// ============================================================================

function sid(): string {
  return getRowlandSpreadsheetId();
}

function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const serial = Number(raw);
  if (!isNaN(serial) && serial > 1000 && !raw.includes('/')) {
    const epoch = new Date(1899, 11, 30);
    const date = new Date(epoch.getTime() + serial * 86400000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  return raw;
}

function parsePlayers(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw.split('|').map((s) => s.trim()).filter(Boolean);
}

function encodePlayers(players: string[]): string {
  return players.filter(Boolean).join('|');
}

function parseTeamRef(
  clubId: string | null,
  clubName: string | null,
  teamLetter: string | null
): RowlandTeamRef | null {
  if (!clubId) return null;
  return {
    clubId,
    clubName: clubName || clubId,
    teamLetter: teamLetter || '',
  };
}

function parseCompRow(row: any[], colMap: Record<string, number>): RowlandComp {
  const get = (field: string): string | null => {
    const idx = colMap[field];
    if (idx === undefined) return null;
    const v = row[idx];
    return v !== undefined && v !== '' ? String(v) : null;
  };
  return {
    compId: (get('comp_id') || '') as RowlandCompId,
    compName: get('comp_name') || '',
    season: get('season') || '',
    status: (get('status') || 'Not Started') as RowlandCompStatus,
    numTeams: parseInt(get('num_teams') || '0', 10) || 0,
    prelimPlayBy: normalizeDate(get('prelim_play_by')),
    r1PlayBy: normalizeDate(get('r1_play_by')),
    r2PlayBy: normalizeDate(get('r2_play_by')),
    qfPlayBy: normalizeDate(get('qf_play_by')),
    sfPlayBy: normalizeDate(get('sf_play_by')),
    fPlayBy: normalizeDate(get('f_play_by')),
  };
}

function parseMatchRow(row: any[], colMap: Record<string, number>): RowlandMatch {
  const get = (field: string): string | null => {
    const idx = colMap[field];
    if (idx === undefined) return null;
    const v = row[idx];
    return v !== undefined && v !== '' ? String(v) : null;
  };
  const getInt = (field: string): number | null => {
    const v = get(field);
    if (!v) return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  };
  return {
    matchId: get('match_id') || '',
    round: (get('round') || 'R1') as RowlandRound,
    position: getInt('position') ?? 1,
    homeTeam: parseTeamRef(get('home_club_id'), get('home_club_name'), get('home_team_letter')),
    awayTeam: parseTeamRef(get('away_club_id'), get('away_club_name'), get('away_team_letter')),
    homePlayers: parsePlayers(get('home_players')),
    awayPlayers: parsePlayers(get('away_players')),
    homeScore: getInt('home_score'),
    awayScore: getInt('away_score'),
    winnerSide: (getInt('winner_side') as 1 | 2 | null) ?? null,
    status: (get('status') || 'Pending') as RowlandMatchStatus,
    playByDate: normalizeDate(get('play_by_date')),
    playedDate: normalizeDate(get('played_date')),
    notes: get('notes') || '',
    scoreSheetUrl: get('score_sheet_url') || null,
  };
}

// ============================================================================
// CONTROL SHEET — READ
// ============================================================================

export async function getAllRowlandComps(): Promise<RowlandComp[]> {
  const colMap = await getColumnMap('RowlandControl', sid());
  const sheets = getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'RowlandControl!A:Z',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  if (rows.length < 2) return [];

  return rows.slice(1)
    .filter((row) => row[colMap['comp_id']] ?? '')
    .map((row) => parseCompRow(row, colMap));
}

export async function getRowlandComp(compId: RowlandCompId): Promise<RowlandComp | null> {
  const comps = await getAllRowlandComps();
  return comps.find((c) => c.compId === compId) ?? null;
}

// ============================================================================
// CONTROL SHEET — WRITE
// ============================================================================

export async function updateRowlandComp(
  compId: RowlandCompId,
  updates: Partial<Pick<RowlandComp, 'status' | 'numTeams' | 'season' | 'prelimPlayBy' | 'r1PlayBy' | 'r2PlayBy' | 'qfPlayBy' | 'sfPlayBy' | 'fPlayBy'>>
): Promise<void> {
  const colMap = await getColumnMap('RowlandControl', sid());
  const sheets = getGoogleSheetsClient();

  const fullResp = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'RowlandControl!A:Z',
  });
  const allRows = fullResp.data.values ?? [];
  const compIdColIdx = colMap['comp_id'];
  const dataRowIdx = allRows.findIndex((r, i) => i > 0 && String(r[compIdColIdx] ?? '') === compId);
  if (dataRowIdx < 0) throw new Error(`Comp ${compId} not found in RowlandControl`);
  const actualSheetRow = dataRowIdx + 1; // 1-based sheet row

  const fieldMap: Record<string, string | number | null> = {};
  if (updates.status !== undefined) fieldMap['status'] = updates.status;
  if (updates.numTeams !== undefined) fieldMap['num_teams'] = updates.numTeams;
  if (updates.season !== undefined) fieldMap['season'] = updates.season;
  if (updates.prelimPlayBy !== undefined) fieldMap['prelim_play_by'] = updates.prelimPlayBy;
  if (updates.r1PlayBy !== undefined) fieldMap['r1_play_by'] = updates.r1PlayBy;
  if (updates.r2PlayBy !== undefined) fieldMap['r2_play_by'] = updates.r2PlayBy;
  if (updates.qfPlayBy !== undefined) fieldMap['qf_play_by'] = updates.qfPlayBy;
  if (updates.sfPlayBy !== undefined) fieldMap['sf_play_by'] = updates.sfPlayBy;
  if (updates.fPlayBy !== undefined) fieldMap['f_play_by'] = updates.fPlayBy;

  const data = Object.entries(fieldMap)
    .filter(([col]) => colMap[col] !== undefined)
    .map(([col, value]) => ({
      range: `RowlandControl!${getColumnLetter(colMap[col])}${actualSheetRow}`,
      values: [[value ?? '']],
    }));

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sid(),
    requestBody: { data, valueInputOption: 'USER_ENTERED' },
  });
}

// ============================================================================
// MATCH SHEETS — READ
// ============================================================================

export async function getRowlandMatches(compId: RowlandCompId): Promise<RowlandMatch[]> {
  const sheetName = ROWLAND_SHEET_NAMES[compId];
  const colMap = await getColumnMap(sheetName, sid());
  const sheets = getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: `${sheetName}!A:ZZ`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  if (rows.length < 2) return [];

  return rows.slice(1)
    .filter((row) => row[colMap['match_id']] ?? '')
    .map((row) => parseMatchRow(row, colMap));
}

/** Get all matches for a specific club (home or away) in a competition. */
export async function getRowlandMatchesForClub(
  compId: RowlandCompId,
  clubId: string,
  teamLetter?: string
): Promise<RowlandMatch[]> {
  const matches = await getRowlandMatches(compId);
  return matches.filter((m) => {
    const homeMatch = m.homeTeam?.clubId === clubId &&
      (teamLetter === undefined || m.homeTeam?.teamLetter === teamLetter);
    const awayMatch = m.awayTeam?.clubId === clubId &&
      (teamLetter === undefined || m.awayTeam?.teamLetter === teamLetter);
    return homeMatch || awayMatch;
  });
}

// ============================================================================
// MATCH SHEETS — WRITE
// ============================================================================

/** Update players, teams and/or result for a match. */
export async function updateRowlandMatch(
  compId: RowlandCompId,
  matchId: string,
  updates: {
    homeTeam?: RowlandTeamRef | null;
    awayTeam?: RowlandTeamRef | null;
    homePlayers?: string[];
    awayPlayers?: string[];
    homeScore?: number | null;
    awayScore?: number | null;
    winnerSide?: 1 | 2 | null;
    status?: RowlandMatchStatus;
    playedDate?: string | null;
    notes?: string;
    scoreSheetUrl?: string | null;
  }
): Promise<void> {
  const sheetName = ROWLAND_SHEET_NAMES[compId];
  const colMap = await getColumnMap(sheetName, sid());
  const sheets = getGoogleSheetsClient();

  // Find the row
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: `${sheetName}!A:ZZ`,
  });
  const rows = response.data.values ?? [];
  const matchIdCol = colMap['match_id'];
  const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[matchIdCol] ?? '') === matchId);
  if (rowIdx < 0) throw new Error(`Match ${matchId} not found in ${sheetName}`);
  const sheetRow = rowIdx + 1;

  const fieldMap: Record<string, string | number> = {};
  if (updates.homeTeam !== undefined) {
    fieldMap['home_club_id']     = updates.homeTeam?.clubId     ?? '';
    fieldMap['home_club_name']   = updates.homeTeam?.clubName   ?? '';
    fieldMap['home_team_letter'] = updates.homeTeam?.teamLetter ?? '';
  }
  if (updates.awayTeam !== undefined) {
    fieldMap['away_club_id']     = updates.awayTeam?.clubId     ?? '';
    fieldMap['away_club_name']   = updates.awayTeam?.clubName   ?? '';
    fieldMap['away_team_letter'] = updates.awayTeam?.teamLetter ?? '';
  }
  if (updates.homePlayers !== undefined) fieldMap['home_players'] = encodePlayers(updates.homePlayers);
  if (updates.awayPlayers !== undefined) fieldMap['away_players'] = encodePlayers(updates.awayPlayers);
  if (updates.homeScore !== undefined) fieldMap['home_score'] = updates.homeScore ?? '';
  if (updates.awayScore !== undefined) fieldMap['away_score'] = updates.awayScore ?? '';
  if (updates.winnerSide !== undefined) fieldMap['winner_side'] = updates.winnerSide ?? '';
  if (updates.status !== undefined) fieldMap['status'] = updates.status;
  if (updates.playedDate !== undefined) fieldMap['played_date'] = updates.playedDate ?? '';
  if (updates.notes !== undefined) fieldMap['notes'] = updates.notes;
  if (updates.scoreSheetUrl !== undefined) fieldMap['score_sheet_url'] = updates.scoreSheetUrl ?? '';

  const data = Object.entries(fieldMap)
    .filter(([col]) => colMap[col] !== undefined)
    .map(([col, value]) => ({
      range: `${sheetName}!${getColumnLetter(colMap[col])}${sheetRow}`,
      values: [[value]],
    }));

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sid(),
    requestBody: { data, valueInputOption: 'USER_ENTERED' },
  });
}

// ============================================================================
// BRACKET SETUP
// ============================================================================

/**
 * Create the initial R1 bracket for a competition.
 * teams: ordered array of RowlandTeamRef (seeded order). Odd team count gets a bye.
 * Clears any existing matches for this comp before writing.
 */
export async function setupRowlandBracket(
  compId: RowlandCompId,
  teams: RowlandTeamRef[]
): Promise<void> {
  const sheetName = ROWLAND_SHEET_NAMES[compId];
  const colMap = await getColumnMap(sheetName, sid());
  const sheets = getGoogleSheetsClient();

  // Build R1 match rows
  // Pair up teams: (1 vs last), (2 vs second-last) seeding, or simple sequential pairing
  // For now use sequential: match 1 = teams[0] vs teams[1], match 2 = teams[2] vs teams[3], etc.
  const rows: string[][] = [];
  const numMatches = Math.ceil(teams.length / 2);

  for (let i = 0; i < numMatches; i++) {
    const home = teams[i * 2] ?? null;
    const away = teams[i * 2 + 1] ?? null; // null = bye

    const matchId = `${compId}-R1-${i + 1}`;
    const row = buildMatchRow(colMap, {
      matchId,
      round: 'R1',
      position: i + 1,
      homeTeam: home,
      awayTeam: away,
      status: away === null ? 'Bye' : 'Pending',
    });
    rows.push(row);
  }

  // Also pre-create placeholder rows for subsequent rounds
  const bracket = computeRowlandBracket(teams.length);
  for (const { round, matchCount } of bracket.rounds) {
    if (round === 'R1' || round === 'Prelim') continue;
    for (let i = 0; i < matchCount; i++) {
      const matchId = `${compId}-${round}-${i + 1}`;
      const row = buildMatchRow(colMap, {
        matchId,
        round,
        position: i + 1,
        homeTeam: null,
        awayTeam: null,
        status: 'Pending',
      });
      rows.push(row);
    }
  }

  // Clear existing data (keep header row) and write new rows
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sid(),
    range: `${sheetName}!A2:ZZ`,
  });

  if (rows.length === 0) return;

  // Build full header + data. We need column count from colMap.
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid(),
    range: `${sheetName}!A2`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
}

/**
 * Create an empty bracket with numTeams slots, all TBD.
 * All preliminary slots are created as 'Pending' — byes are mixed in during the
 * draw (the committee toggles individual match slots as byes via the setup page).
 * All team fields are blank — assigned via the setup page after creation.
 */
export async function createEmptyBracket(
  compId: RowlandCompId,
  numTeams: number,
): Promise<void> {
  const sheetName = ROWLAND_SHEET_NAMES[compId];
  const colMap = await getColumnMap(sheetName, sid());
  const sheets = getGoogleSheetsClient();

  const bracket = computeRowlandBracket(numTeams);
  const rows: string[][] = [];

  for (const { round, matchCount } of bracket.rounds) {
    if (round === 'Prelim') {
      // Create all P/2 preliminary slots as Pending.
      // byeCount byes will be mixed in at draw time by the committee.
      const totalSlots = matchCount + bracket.byeCount;
      for (let i = 0; i < totalSlots; i++) {
        rows.push(buildMatchRow(colMap, {
          matchId: `${compId}-Prelim-${i + 1}`,
          round: 'Prelim', position: i + 1,
          homeTeam: null, awayTeam: null, status: 'Pending',
        }));
      }
    } else {
      for (let i = 0; i < matchCount; i++) {
        rows.push(buildMatchRow(colMap, {
          matchId: `${compId}-${round}-${i + 1}`,
          round, position: i + 1,
          homeTeam: null, awayTeam: null, status: 'Pending',
        }));
      }
    }
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId: sid(), range: `${sheetName}!A2:ZZ` });
  if (rows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid(),
      range: `${sheetName}!A2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  }
}

/**
 * After a single match is completed (score, walkover, or bye), advance the winner
 * into the next round's placeholder match.
 *
 * Position pairing: prelim/R1/etc positions 1+2 → next position 1, 3+4 → position 2, etc.
 * Odd position fills the home slot; even fills the away slot.
 * Silently skips if no winner can be determined or no next-round placeholder exists.
 */
export async function propagateRowlandWinnerForMatch(
  compId: RowlandCompId,
  match: RowlandMatch,
): Promise<void> {
  const winner = winnerOf(match);
  if (!winner) return;

  const nextPosition = Math.ceil(match.position / 2);
  const side: 'homeTeam' | 'awayTeam' = match.position % 2 === 1 ? 'homeTeam' : 'awayTeam';

  // Scan subsequent rounds in order to find the placeholder match
  const allMatches = await getRowlandMatches(compId);
  const currentRoundIdx = ROWLAND_ROUND_ORDER.indexOf(match.round);
  if (currentRoundIdx < 0) return;

  for (let i = currentRoundIdx + 1; i < ROWLAND_ROUND_ORDER.length; i++) {
    const nextRound = ROWLAND_ROUND_ORDER[i];
    const nextMatchId = `${compId}-${nextRound}-${nextPosition}`;
    const nextMatch = allMatches.find((m) => m.matchId === nextMatchId);
    if (nextMatch) {
      // Don't overwrite if next match already has a result
      if (nextMatch.status === 'Played' || nextMatch.status === 'Walkover') return;
      await updateRowlandMatch(compId, nextMatchId, { [side]: winner });
      return;
    }
  }
}

/**
 * After all matches in a round are played, copy winners into the next round's placeholder rows.
 * Call this when the admin marks the round as complete.
 */
export async function advanceRowlandWinners(
  compId: RowlandCompId,
  completedRound: RowlandRound
): Promise<void> {
  const nextRoundIdx = ROWLAND_ROUND_ORDER.indexOf(completedRound) + 1;
  if (nextRoundIdx >= ROWLAND_ROUND_ORDER.length) return; // Final — nothing to advance

  const nextRound = ROWLAND_ROUND_ORDER[nextRoundIdx];
  const matches = await getRowlandMatches(compId);
  const roundMatches = matches
    .filter((m) => m.round === completedRound)
    .sort((a, b) => a.position - b.position);

  const sheetName = ROWLAND_SHEET_NAMES[compId];
  const colMap = await getColumnMap(sheetName, sid());
  const sheets = getGoogleSheetsClient();

  const allRows = (await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: `${sheetName}!A:ZZ`,
  })).data.values ?? [];

  const matchIdCol = colMap['match_id'];

  const data: { range: string; values: string[][] }[] = [];

  for (let i = 0; i < Math.ceil(roundMatches.length / 2); i++) {
    const match1 = roundMatches[i * 2];
    const match2 = roundMatches[i * 2 + 1]; // undefined if odd

    const nextMatchId = `${compId}-${nextRound}-${i + 1}`;
    const nextRowIdx = allRows.findIndex(
      (r, ri) => ri > 0 && String(r[matchIdCol] ?? '') === nextMatchId
    );
    if (nextRowIdx < 0) continue;
    const nextSheetRow = nextRowIdx + 1;

    // Winner of match1 → home; winner of match2 → away
    const home = winnerOf(match1);
    const away = match2 ? winnerOf(match2) : null;

    const teamFields = [
      { col: 'home_club_id', value: home?.clubId ?? '' },
      { col: 'home_club_name', value: home?.clubName ?? '' },
      { col: 'home_team_letter', value: home?.teamLetter ?? '' },
      { col: 'away_club_id', value: away?.clubId ?? '' },
      { col: 'away_club_name', value: away?.clubName ?? '' },
      { col: 'away_team_letter', value: away?.teamLetter ?? '' },
    ];

    for (const { col, value } of teamFields) {
      if (colMap[col] === undefined) continue;
      data.push({
        range: `${sheetName}!${getColumnLetter(colMap[col])}${nextSheetRow}`,
        values: [[value]],
      });
    }
  }

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sid(),
    requestBody: { data, valueInputOption: 'USER_ENTERED' },
  });
}

// ============================================================================
// BRACKET HELPERS
// ============================================================================

function winnerOf(match: RowlandMatch): RowlandTeamRef | null {
  if (match.status === 'Bye') return match.homeTeam;
  if (match.winnerSide === 1) return match.homeTeam;
  if (match.winnerSide === 2) return match.awayTeam;
  return null;
}

interface BracketRound { round: RowlandRound; matchCount: number; }

interface RowlandBracketInfo {
  hasPrelim: boolean;
  prelimMatches: number;  // real prelim matches (not byes)
  byeCount: number;       // teams with byes directly into R1
  r1Matches: number;
  rounds: BracketRound[]; // full ordered list Prelim?→R1→...→F
}

/**
 * Compute the correct bracket structure for a given number of teams.
 * e.g. 24 → 8 prelim matches + 8 byes + R1(8) + QF(4) + SF(2) + F(1)
 *      16 → R1(8) + QF(4) + SF(2) + F(1)
 *      32 → R1(16) + R2(8) + QF(4) + SF(2) + F(1)
 */
export function computeRowlandBracket(numTeams: number): RowlandBracketInfo {
  let P = 1;
  while (P < numTeams) P *= 2;

  const hasPrelim = numTeams !== P;
  const prelimMatches = hasPrelim ? numTeams - P / 2 : 0;
  const byeCount = hasPrelim ? P - numTeams : 0;

  // R1 entrants = prelim winners + byes (when prelim) or all teams (when no prelim)
  const r1Entrants = hasPrelim ? P / 2 : numTeams;
  const r1Matches = r1Entrants / 2;

  const rounds: BracketRound[] = [];
  if (hasPrelim) rounds.push({ round: 'Prelim', matchCount: prelimMatches });
  rounds.push({ round: 'R1', matchCount: r1Matches });

  let count = r1Matches;
  while (count > 1) {
    count = count / 2;
    const prev = rounds[rounds.length - 1].round;
    const next: RowlandRound =
      prev === 'Prelim' ? 'R1'
      : count === 1 ? 'F'
      : count === 2 ? 'SF'
      : count === 4 ? 'QF'
      : count === 8 ? 'R2'
      : 'R1';
    rounds.push({ round: next, matchCount: count });
  }

  return { hasPrelim, prelimMatches, byeCount, r1Matches, rounds };
}

/**
 * Build a flat row array for the match sheet given the colMap.
 * Returns a sparse array with values at the correct column indices.
 */
function buildMatchRow(
  colMap: Record<string, number>,
  data: {
    matchId: string;
    round: RowlandRound;
    position: number;
    homeTeam: RowlandTeamRef | null;
    awayTeam: RowlandTeamRef | null;
    status: RowlandMatchStatus;
  }
): string[] {
  const maxCol = Math.max(...Object.values(colMap)) + 1;
  const row: string[] = Array(maxCol).fill('');

  const set = (field: string, value: string) => {
    if (colMap[field] !== undefined) row[colMap[field]] = value;
  };

  set('match_id', data.matchId);
  set('round', data.round);
  set('position', String(data.position));
  set('home_club_id', data.homeTeam?.clubId ?? '');
  set('home_club_name', data.homeTeam?.clubName ?? '');
  set('home_team_letter', data.homeTeam?.teamLetter ?? '');
  set('away_club_id', data.awayTeam?.clubId ?? '');
  set('away_club_name', data.awayTeam?.clubName ?? '');
  set('away_team_letter', data.awayTeam?.teamLetter ?? '');
  set('status', data.status);

  return row;
}

// ============================================================================
// ROWLAND SETTINGS (RowlandSettings sheet: Key | Value)
// ============================================================================

const SETTINGS_SHEET = 'RowlandSettings';

export async function getRowlandMessage(): Promise<string> {
  const spreadsheetId = sid();
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SETTINGS_SHEET}!A:B`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = res.data.values ?? [];
  for (const row of rows) {
    if (String(row[0]).trim().toLowerCase() === 'message') {
      return String(row[1] ?? '');
    }
  }
  return '';
}

export async function setRowlandMessage(message: string): Promise<void> {
  const spreadsheetId = sid();
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SETTINGS_SHEET}!A:B`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = res.data.values ?? [];
  let targetRow = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === 'message') {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SETTINGS_SHEET}!A:B`,
      valueInputOption: 'RAW',
      requestBody: { values: [['message', message]] },
    });
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SETTINGS_SHEET}!B${targetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[message]] },
    });
  }
}
