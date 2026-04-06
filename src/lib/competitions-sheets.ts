// src/lib/competitions-sheets.ts
// Data layer for the Competitions system
//
// Sheet layout:
//   CompetitionsControl  — one row per competition (metadata & play-by dates)
//   CompMensChampionship, CompLadiesMaynard, … — one sheet per competition,
//   one row per match.
//
// Usernames are stored pipe-separated in Side1 / Side2 cells.
// Names are looked up from the Members sheet at API / display time.

import { google } from 'googleapis';
import {
  getSpreadsheetId,
  getCompetitionsSpreadsheetId,
  getGoogleSheetsClient,
  getColumnMap,
  getColumnLetter,
  getAllUsers,
} from './sheets';
import type { Competition, CompMatch, CompType, CompStatus, CompRound, CompMemberInfo } from '@/types/competitions';
import { ROUND_ORDER } from '@/types/competitions';

// ============================================================================
// COMP → SHEET CONFIG MAP
// ============================================================================

/**
 * Static mapping from compId to sheet name and Renewals column name.
 * The renewalColumn is the *normalised* column name used by getColumnMap()
 * on the Renewals sheet (spaces → underscores, lowercased).
 */
export const COMP_SHEET_CONFIG: Record<string, {
  sheetName: string;
  renewalColumn?: string; // Omit for comps where all playing members are eligible (e.g. centenary)
  subRenewalColumn?: string; // For pairs/triples substitute column
}> = {
  'mens-championship': {
    sheetName: 'CompMensChampionship',
    renewalColumn: 'comp_mens_championship',
  },
  'ladies-maynard': {
    sheetName: 'CompLadiesMaynard',
    renewalColumn: 'comp_ladies_maynard',
  },
  'mens-two-wood': {
    sheetName: 'CompMensTwoWood',
    renewalColumn: 'comp_mens_two_wood',
  },
  'ladies-two-wood': {
    sheetName: 'CompLadiesTwoWood',
    renewalColumn: 'comp_ladies_two_wood',
  },
  'handicap': {
    sheetName: 'CompHandicap',
    renewalColumn: 'comp_handicap',
  },
  'oldlands': {
    sheetName: 'CompOldlands',
    renewalColumn: 'comp_oldlands',
  },
  'veterans': {
    sheetName: 'CompVeterans',
    renewalColumn: 'comp_veterans',
  },
  'married-pairs': {
    sheetName: 'CompMarriedPairs',
    renewalColumn: 'comp_married_pairs',
  },
  'drawn-pairs': {
    sheetName: 'CompDrawnPairs',
    renewalColumn: 'comp_drawn_pairs',
    subRenewalColumn: 'sub_drawn_pairs',
  },
  'australian-pairs': {
    sheetName: 'CompAustralianPairs',
    renewalColumn: 'comp_australian_pairs',
    subRenewalColumn: 'sub_australian_pairs',
  },
  'drawn-triples': {
    sheetName: 'CompDrawnTriples',
    renewalColumn: 'comp_drawn_triples',
    subRenewalColumn: 'sub_drawn_triples',
  },
  'centenary': {
    sheetName: 'CompCentenary',
    // No renewalColumn — all playing members are eligible; draw is from a hat
  },
};

// ============================================================================
// PARSE HELPERS
// ============================================================================

/**
 * Normalise a date value from Google Sheets to YYYY-MM-DD.
 *
 * Google Sheets date cells come back as the locale-formatted string when using
 * FORMATTED_VALUE (e.g. "6/9/2026" or "06/09/2026" in UK locale = 6 Sep 2026).
 * HTML <input type="date"> requires YYYY-MM-DD.
 *
 * Handles:
 *   D/M/YYYY or DD/MM/YYYY  →  YYYY-MM-DD   (UK/European locale)
 *   YYYY-MM-DD              →  unchanged     (already ISO)
 *   Google Sheets serial    →  YYYY-MM-DD   (numeric date stored as number)
 */
function normalizeDate(raw: string | null): string | null {
  if (!raw || !raw.trim()) return null;

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // DD/MM/YYYY or D/M/YYYY (UK locale)
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Google Sheets date serial (integer). Epoch = 30 Dec 1899.
  const serial = Number(raw);
  if (!isNaN(serial) && serial > 1000 && String(raw).indexOf('/') === -1) {
    const epoch = new Date(1899, 11, 30);
    const date = new Date(epoch.getTime() + serial * 86400000);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Unrecognised format — treat as missing rather than returning garbage
  return null;
}

function parseSide(raw: string | null | undefined): string[] | null {
  if (!raw || !raw.trim()) return null;
  return raw.split('|').map((s) => s.trim()).filter(Boolean);
}

function encodeSide(usernames: string[] | null): string {
  if (!usernames || usernames.length === 0) return '';
  return usernames.join('|');
}

function parseCompetitionRow(
  row: any[],
  colMap: { [key: string]: number }
): Competition {
  const get = (field: string): string | null => {
    const idx = colMap[field];
    if (idx === undefined) return null;
    const v = row[idx];
    return v !== undefined && v !== '' ? String(v) : null;
  };

  const getBool = (field: string): boolean => {
    const v = get(field);
    return v === 'Y' || v === 'Yes' || v === 'TRUE' || v === 'true';
  };

  return {
    compId: get('comp_id') || '',
    displayName: get('display_name') || '',
    compType: (get('comp_type') || 'singles') as CompType,
    status: (get('status') || 'Not Started') as CompStatus,
    year: parseInt(get('year') || '0', 10),
    finalsDate: normalizeDate(get('finals_date')),
    prelimPlayBy: normalizeDate(get('prelim_play_by')),
    r1PlayBy: normalizeDate(get('r1_play_by')),
    r2PlayBy: normalizeDate(get('r2_play_by')),
    qfPlayBy: normalizeDate(get('qf_play_by')),
    sfPlayBy: normalizeDate(get('sf_play_by')),
    triplesFixedDay: getBool('triples_fixed_day'),
    triplesFixedDate: normalizeDate(get('triples_fixed_date')),
    drawSideCount: get('draw_side_count') ? parseInt(get('draw_side_count')!, 10) : null,
    compStartDate: normalizeDate(get('comp_start')),
    compDescription: get('comp_description'),
  };
}

function parseMatchRow(
  row: any[],
  colMap: { [key: string]: number }
): CompMatch {
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
    round: (get('round') || 'R1') as CompRound,
    position: parseInt(get('position') || '1', 10),
    side1Usernames: parseSide(get('side1')) || [],
    side2Usernames: parseSide(get('side2')),
    score1: getInt('score1'),
    score2: getInt('score2'),
    winnerSide: (getInt('winner_side') as 1 | 2 | null) ?? null,
    status: (get('status') || 'Pending') as CompMatch['status'],
    playByDate: normalizeDate(get('play_by_date')),
    playedDate: normalizeDate(get('played_date')),
  };
}

// ============================================================================
// COMPETITIONS CONTROL SHEET — READ
// ============================================================================

/**
 * Get all competitions from CompetitionsControl sheet.
 */
export async function getAllCompetitions(): Promise<Competition[]> {
  const colMap = await getColumnMap('CompetitionsControl', getCompetitionsSpreadsheetId());
  const sheets = getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getCompetitionsSpreadsheetId(),
    range: 'CompetitionsControl!A2:Z',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];
  return rows
    .filter((row) => row[colMap['comp_id']] && row[colMap['comp_id']] !== '')
    .map((row) => parseCompetitionRow(row, colMap));
}

/**
 * Get a single competition by compId.
 */
export async function getCompetitionById(compId: string): Promise<Competition | null> {
  const all = await getAllCompetitions();
  return all.find((c) => c.compId === compId) ?? null;
}

// ============================================================================
// COMPETITIONS CONTROL SHEET — WRITE
// ============================================================================

/**
 * Update a competition's metadata in the Control sheet.
 * Finds the row with the matching compId and overwrites it.
 */
export async function updateCompetition(comp: Competition): Promise<void> {
  const colMap = await getColumnMap('CompetitionsControl', getCompetitionsSpreadsheetId());
  const sheets = getGoogleSheetsClient();

  // Find the row number
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getCompetitionsSpreadsheetId(),
    range: 'CompetitionsControl!A2:A',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const idRows = response.data.values || [];
  const rowIndex = idRows.findIndex((r) => r[0] === comp.compId);
  if (rowIndex === -1) throw new Error(`Competition '${comp.compId}' not found in Control sheet`);
  const rowNumber = rowIndex + 2;

  // Build an ordered value array matching the column map
  function setCol(field: string, value: string) {
    const idx = colMap[field];
    if (idx !== undefined) rowValues[idx] = value;
  }

  const maxCol = Math.max(...Object.values(colMap)) + 1;
  const rowValues: string[] = Array(maxCol).fill('');

  setCol('comp_id', comp.compId);
  setCol('display_name', comp.displayName);
  setCol('comp_type', comp.compType);
  setCol('status', comp.status);
  setCol('year', String(comp.year));
  setCol('finals_date', comp.finalsDate || '');
  setCol('prelim_play_by', comp.prelimPlayBy || '');
  setCol('r1_play_by', comp.r1PlayBy || '');
  setCol('r2_play_by', comp.r2PlayBy || '');
  setCol('qf_play_by', comp.qfPlayBy || '');
  setCol('sf_play_by', comp.sfPlayBy || '');
  setCol('triples_fixed_day', comp.triplesFixedDay ? 'Y' : '');
  setCol('triples_fixed_date', comp.triplesFixedDate || '');
  setCol('draw_side_count', comp.drawSideCount != null ? String(comp.drawSideCount) : '');
  setCol('comp_start', comp.compStartDate || '');
  setCol('comp_description', comp.compDescription || '');

  const endCol = getColumnLetter(maxCol - 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId: getCompetitionsSpreadsheetId(),
    range: `CompetitionsControl!A${rowNumber}:${endCol}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowValues] },
  });
}

/**
 * Update only the draw_side_count of a competition (safe single-cell update).
 */
export async function updateDrawSideCount(
  compId: string,
  drawSideCount: number
): Promise<void> {
  const colMap = await getColumnMap('CompetitionsControl', getCompetitionsSpreadsheetId());
  const colIdx = colMap['draw_side_count'];
  if (colIdx === undefined) {
    throw new Error(`'Draw Side Count' column not found in CompetitionsControl — add the column header`);
  }

  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getCompetitionsSpreadsheetId(),
    range: 'CompetitionsControl!A2:A',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const idRows = response.data.values || [];
  const rowIndex = idRows.findIndex((r) => r[0] === compId);
  if (rowIndex === -1) throw new Error(`Competition '${compId}' not found`);
  const rowNumber = rowIndex + 2;

  const col = getColumnLetter(colIdx);
  await sheets.spreadsheets.values.update({
    spreadsheetId: getCompetitionsSpreadsheetId(),
    range: `CompetitionsControl!${col}${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[drawSideCount]] },
  });
}

/**
 * Update only the status of a competition.
 */
export async function updateCompetitionStatus(
  compId: string,
  status: CompStatus
): Promise<void> {
  const colMap = await getColumnMap('CompetitionsControl', getCompetitionsSpreadsheetId());
  const sheets = getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getCompetitionsSpreadsheetId(),
    range: 'CompetitionsControl!A2:A',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const idRows = response.data.values || [];
  const rowIndex = idRows.findIndex((r) => r[0] === compId);
  if (rowIndex === -1) throw new Error(`Competition '${compId}' not found`);
  const rowNumber = rowIndex + 2;

  const statusCol = getColumnLetter(colMap['status']);
  await sheets.spreadsheets.values.update({
    spreadsheetId: getCompetitionsSpreadsheetId(),
    range: `CompetitionsControl!${statusCol}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status]] },
  });
}

// ============================================================================
// MATCH SHEETS — READ
// ============================================================================

/**
 * Get all matches for a competition from its dedicated sheet.
 */
export async function getCompetitionMatches(compId: string): Promise<CompMatch[]> {
  const cfg = COMP_SHEET_CONFIG[compId];
  if (!cfg) throw new Error(`Unknown competition: ${compId}`);

  const colMap = await getColumnMap(cfg.sheetName, getCompetitionsSpreadsheetId());
  const sheets = getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getCompetitionsSpreadsheetId(),
    range: `${cfg.sheetName}!A2:M`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];
  return rows
    .filter((row) => {
      const idx = colMap['match_id'];
      return idx !== undefined && row[idx] && row[idx] !== '';
    })
    .map((row) => parseMatchRow(row, colMap));
}

// ============================================================================
// BRACKET STRUCTURE HELPERS
// ============================================================================

/**
 * Given the current round and how many matches the NEXT round will have,
 * return the appropriate round label.
 * Special case: after Prelim always comes R1.
 */
function nextRoundLabel(currentRound: CompRound, nextCount: number): CompRound {
  if (currentRound === 'Prelim') return 'R1';
  if (nextCount === 1) return 'F';
  if (nextCount === 2) return 'SF';
  if (nextCount === 4) return 'QF';
  if (nextCount === 8) return 'R2';
  return 'R1';
}

/**
 * Build the complete list of rounds for a bracket, starting from the first
 * round (the one supplied at draw setup time).
 *
 * Examples:
 *   R1 × 8 → [R1(8), QF(4), SF(2), F(1)]
 *   R1 × 4 → [R1(4), SF(2), F(1)]
 *   Prelim × 4 → [Prelim(4), R1(2), F(1)]
 */
function buildBracketStructure(
  firstRound: CompRound,
  firstCount: number
): { round: CompRound; count: number }[] {
  const rounds: { round: CompRound; count: number }[] = [
    { round: firstRound, count: firstCount },
  ];
  let current = firstRound;
  let count = firstCount;
  while (count > 1) {
    count = Math.floor(count / 2);
    const next = nextRoundLabel(current, count);
    rounds.push({ round: next, count });
    current = next;
  }
  return rounds;
}

/**
 * Return the round that follows `currentRound` in a given set of matches.
 * Returns null if currentRound is the last (the Final).
 */
function findNextRound(
  currentRound: CompRound,
  allMatches: CompMatch[]
): CompRound | null {
  const presentRounds = [...new Set(allMatches.map((m) => m.round))];
  // Sort by ROUND_ORDER
  presentRounds.sort(
    (a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b)
  );
  const idx = presentRounds.indexOf(currentRound);
  if (idx === -1 || idx === presentRounds.length - 1) return null;
  return presentRounds[idx + 1];
}

/**
 * Return the play-by date for a given round from the competition config.
 */
function playByDateForRound(comp: Competition, round: CompRound): string {
  switch (round) {
    case 'Prelim': return comp.prelimPlayBy || '';
    case 'R1':     return comp.r1PlayBy || '';
    case 'R2':     return comp.r2PlayBy || '';
    case 'QF':     return comp.qfPlayBy || '';
    case 'SF':     return comp.sfPlayBy || '';
    case 'F':      return comp.finalsDate || '';
    default:       return '';
  }
}

// ============================================================================
// MATCH SHEETS — WRITE (SETUP)
// ============================================================================

/**
 * Save the full bracket for a competition (used during setup/draw entry).
 * Clears existing match data and writes all matches fresh.
 * Also updates the competition status to 'Draw Done'.
 */
export async function saveCompetitionSetup(
  compId: string,
  matches: CompMatch[]
): Promise<void> {
  const cfg = COMP_SHEET_CONFIG[compId];
  if (!cfg) throw new Error(`Unknown competition: ${compId}`);

  // ── Build the full bracket: first-round matches + empty placeholders ───────
  // Detect first round and count from the supplied matches
  const firstRound = matches[0]?.round ?? 'R1';
  const firstCount = matches.length;
  const structure = buildBracketStructure(firstRound, firstCount);

  // Fetch competition so we can fill play-by dates on placeholder matches
  const comp = await getCompetitionById(compId);

  // Generate empty placeholder matches for every round after the first
  const subsequentMatches: CompMatch[] = [];
  for (const { round, count } of structure.slice(1)) {
    const playByDate = comp ? playByDateForRound(comp, round) : '';
    for (let pos = 1; pos <= count; pos++) {
      subsequentMatches.push({
        matchId: `${compId}-${round.toLowerCase()}-${pos}`,
        round,
        position: pos,
        side1Usernames: [],
        side2Usernames: null,
        status: 'Pending',
        playByDate: playByDate || null,
      });
    }
  }

  const allMatches = [...matches, ...subsequentMatches];

  // Auto-propagate bye matches (side2 === null) into the next round immediately.
  // Mark them as 'Bye' status so they don't appear as walkover or pending.
  if (structure.length > 1) {
    const nextRoundName = structure[1].round;
    for (const m of matches) {
      const isByeMatch = (m.side2Usernames === null || m.side2Usernames.length === 0) && m.side1Usernames.length > 0;
    if (isByeMatch) {
        m.status = 'Bye';
        m.winnerSide = 1;

        const nextPosition = Math.ceil(m.position / 2);
        const nextMatchId = `${compId}-${nextRoundName.toLowerCase()}-${nextPosition}`;
        const nextMatch = allMatches.find((x) => x.matchId === nextMatchId);
        if (nextMatch) {
          if (m.position % 2 === 1) {
            nextMatch.side1Usernames = [...m.side1Usernames];
          } else {
            nextMatch.side2Usernames = [...m.side1Usernames];
          }
        }
      }
    }
  }

  const colMap = await getColumnMap(cfg.sheetName, getCompetitionsSpreadsheetId());
  const sheets = getGoogleSheetsClient();

  // Build rows in column-map order
  const maxCol = Math.max(...Object.values(colMap)) + 1;

  const rows = allMatches.map((m) => {
    const row: string[] = Array(maxCol).fill('');
    function set(field: string, value: string) {
      const idx = colMap[field];
      if (idx !== undefined) row[idx] = value;
    }
    set('match_id', m.matchId);
    set('round', m.round);
    set('position', String(m.position));
    set('side1', encodeSide(m.side1Usernames));
    set('side2', encodeSide(m.side2Usernames));
    set('score1', m.score1 != null ? String(m.score1) : '');
    set('score2', m.score2 != null ? String(m.score2) : '');
    set('winner_side', m.winnerSide != null ? String(m.winnerSide) : '');
    set('status', m.status);
    set('play_by_date', m.playByDate || '');
    set('played_date', m.playedDate || '');
    return row;
  });

  // Clear existing data rows (keep header)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: getCompetitionsSpreadsheetId(),
    range: `${cfg.sheetName}!A2:Z`,
  });

  if (rows.length > 0) {
    const endCol = getColumnLetter(maxCol - 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: getCompetitionsSpreadsheetId(),
      range: `${cfg.sheetName}!A2:${endCol}${rows.length + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  }

  // Update status to Draw Done
  await updateCompetitionStatus(compId, 'Draw Done');
}

// ============================================================================
// WINNER PROPAGATION
// ============================================================================

/**
 * After a match result is recorded, write the winner's usernames into the
 * correct slot of the next-round match.
 *
 * Bracket progression rule:
 *   match at position N → next round, position ceil(N/2)
 *   odd position  → side 1 of next match
 *   even position → side 2 of next match
 */
export async function propagateWinnerToNextRound(
  compId: string,
  completedMatch: CompMatch,
  winnerSide: 1 | 2
): Promise<void> {
  const winnerUsernames =
    winnerSide === 1
      ? completedMatch.side1Usernames
      : completedMatch.side2Usernames ?? [];

  if (winnerUsernames.length === 0) return;

  // Load all current matches to detect the next round
  const allMatches = await getCompetitionMatches(compId);
  const nextRound = findNextRound(completedMatch.round, allMatches);
  if (!nextRound) return; // Completed match was the Final — nothing to propagate

  const nextPosition = Math.ceil(completedMatch.position / 2);
  const nextMatchId = `${compId}-${nextRound.toLowerCase()}-${nextPosition}`;
  const targetSide = completedMatch.position % 2 === 1 ? 'side1Usernames' : 'side2Usernames';

  await updateMatch(compId, nextMatchId, { [targetSide]: winnerUsernames });
}

// ============================================================================
// MATCH SHEETS — WRITE (SCORE / WALKOVER / SUBSTITUTION)
// ============================================================================

/**
 * Update a single match result (score, walkover, or substitution).
 * Finds the match by matchId and updates only the relevant columns.
 */
export async function updateMatch(
  compId: string,
  matchId: string,
  updates: {
    score1?: number | null;
    score2?: number | null;
    winnerSide?: 1 | 2 | null;
    status?: CompMatch['status'];
    playedDate?: string | null;
    side1Usernames?: string[];
    side2Usernames?: string[] | null;
    playByDate?: string | null;
  }
): Promise<void> {
  const cfg = COMP_SHEET_CONFIG[compId];
  if (!cfg) throw new Error(`Unknown competition: ${compId}`);

  const colMap = await getColumnMap(cfg.sheetName, getCompetitionsSpreadsheetId());
  const sheets = getGoogleSheetsClient();

  // Find the row with this matchId
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getCompetitionsSpreadsheetId(),
    range: `${cfg.sheetName}!A2:A`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const idRows = response.data.values || [];
  const rowIndex = idRows.findIndex((r) => r[0] === matchId);
  if (rowIndex === -1) throw new Error(`Match '${matchId}' not found in ${cfg.sheetName}`);
  const rowNumber = rowIndex + 2;

  const data: { range: string; values: string[][] }[] = [];

  function addUpdate(field: string, value: string) {
    const idx = colMap[field];
    if (idx === undefined) return;
    const col = getColumnLetter(idx);
    data.push({ range: `${cfg.sheetName}!${col}${rowNumber}`, values: [[value]] });
  }

  if (updates.score1 !== undefined) addUpdate('score1', updates.score1 != null ? String(updates.score1) : '');
  if (updates.score2 !== undefined) addUpdate('score2', updates.score2 != null ? String(updates.score2) : '');
  if (updates.winnerSide !== undefined) addUpdate('winner_side', updates.winnerSide != null ? String(updates.winnerSide) : '');
  if (updates.status !== undefined) addUpdate('status', updates.status);
  if (updates.playedDate !== undefined) addUpdate('played_date', updates.playedDate || '');
  if (updates.playByDate !== undefined) addUpdate('play_by_date', updates.playByDate || '');
  if (updates.side1Usernames !== undefined) addUpdate('side1', encodeSide(updates.side1Usernames));
  if (updates.side2Usernames !== undefined) addUpdate('side2', encodeSide(updates.side2Usernames));

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getCompetitionsSpreadsheetId(),
    requestBody: { data, valueInputOption: 'USER_ENTERED' },
  });

  // If the match is now Complete or Walkover, bump competition status to In Progress
  if (updates.status === 'Complete' || updates.status === 'Walkover') {
    const comp = await getCompetitionById(compId);
    if (comp && comp.status === 'Draw Done') {
      await updateCompetitionStatus(compId, 'In Progress');
    }
  }
}

// ============================================================================
// RENEWALS — ENTRANT LOOKUP
// ============================================================================

/**
 * Get usernames of members who entered a specific competition,
 * sorted by member type (Playing Men first, then Playing Ladies) then surname.
 *
 * For pairs/triples the substitute list is also returned separately.
 */
export async function getEntrantsFromRenewals(compId: string): Promise<{
  entrants: string[];
  subs: string[];
}> {
  const cfg = COMP_SHEET_CONFIG[compId];
  if (!cfg) throw new Error(`Unknown competition: ${compId}`);

  // No renewal column = open draw from a hat; no pre-set entrants list.
  // Members will appear under "Other members" in the player search.
  if (!cfg.renewalColumn) {
    return { entrants: [], subs: [] };
  }

  const colMap = await getColumnMap('Renewals');
  const sheets = getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: 'Renewals!A2:AZ',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];

  const entrantUsernames: string[] = [];
  const subUsernames: string[] = [];

  const entrantColIdx = colMap[cfg.renewalColumn];
  const subColIdx = cfg.subRenewalColumn ? colMap[cfg.subRenewalColumn] : undefined;
  const userNameColIdx = colMap['user_name'];

  if (entrantColIdx === undefined || userNameColIdx === undefined) {
    throw new Error(`Required columns not found in Renewals sheet for competition ${compId}`);
  }

  for (const row of rows) {
    const username = row[userNameColIdx];
    if (!username) continue;

    const entrantVal = row[entrantColIdx];
    if (entrantVal === 'Y' || entrantVal === 'Yes' || entrantVal === 'TRUE') {
      entrantUsernames.push(String(username));
    }

    if (subColIdx !== undefined) {
      const subVal = row[subColIdx];
      if (subVal === 'Y' || subVal === 'Yes' || subVal === 'TRUE') {
        subUsernames.push(String(username));
      }
    }
  }

  // Sort: Playing Men (PM) first, Playing Ladies (PL) second, then by surname
  const users = await getAllUsers();
  const userMap = new Map(users.map((u) => [u.userName.toLowerCase(), u]));

  function sortScore(username: string): string {
    const u = userMap.get(username.toLowerCase());
    if (!u) return `ZZ_${username}`;
    const typeOrder = u.memberType === 'Playing Man' ? '1' : u.memberType === 'Playing Lady' ? '2' : '3';
    return `${typeOrder}_${u.lastName.toLowerCase()}_${u.firstName.toLowerCase()}`;
  }

  entrantUsernames.sort((a, b) => sortScore(a).localeCompare(sortScore(b)));
  subUsernames.sort((a, b) => sortScore(a).localeCompare(sortScore(b)));

  return { entrants: entrantUsernames, subs: subUsernames };
}

// ============================================================================
// MEMBER INFO ENRICHMENT
// ============================================================================

/**
 * Build a CompMemberInfo lookup map from the Members sheet.
 * Used by API routes to enrich match data before sending to the client.
 */
export async function getMemberInfoMap(): Promise<Map<string, CompMemberInfo>> {
  const users = await getAllUsers();
  const map = new Map<string, CompMemberInfo>();
  for (const u of users) {
    map.set(u.userName.toLowerCase(), {
      username: u.userName,
      fullName: u.fullName || `${u.firstName} ${u.lastName}`.trim(),
      handicap: u.handicap,
      memberType: u.memberType,
    });
  }
  return map;
}

/**
 * Get CompMemberInfo for a single username.
 */
export async function getMemberInfo(username: string): Promise<CompMemberInfo | null> {
  const map = await getMemberInfoMap();
  return map.get(username.toLowerCase()) ?? null;
}

// ============================================================================
// COMPETITIONS SETTINGS (CompetitionsSettings sheet: Key | Value)
// ============================================================================

const SETTINGS_SHEET = 'CompetitionsSettings';

export async function getCompetitionMessage(): Promise<string> {
  const spreadsheetId = getCompetitionsSpreadsheetId();
  const sheets = await getGoogleSheetsClient();

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

export async function setCompetitionMessage(message: string): Promise<void> {
  const spreadsheetId = getCompetitionsSpreadsheetId();
  const sheets = await getGoogleSheetsClient();

  // Find the row with key 'message'
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SETTINGS_SHEET}!A:B`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = res.data.values ?? [];
  let targetRow = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === 'message') {
      targetRow = i + 1; // 1-indexed
      break;
    }
  }

  if (targetRow === -1) {
    // Append a new row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SETTINGS_SHEET}!A:B`,
      valueInputOption: 'RAW',
      requestBody: { values: [['message', message]] },
    });
  } else {
    // Update existing row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SETTINGS_SHEET}!B${targetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[message]] },
    });
  }
}
