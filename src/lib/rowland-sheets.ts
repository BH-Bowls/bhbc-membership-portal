// src/lib/rowland-sheets.ts
// READ-ONLY. Rowland's match/bracket management has been cut over to Postgres
// (see rowland-supabase.ts, supabase/migrations/0048_rowland.sql) — this file is kept
// only as the source scripts/migrate-rowland.ts reads from for the real cutover, same
// as applications-sheets.ts/leavers-sheets.ts are kept for their own migrate-*.ts
// scripts after their live app callers moved to Postgres. Nothing here is called by
// the live app any more; don't reintroduce a live caller against this file — write to
// Postgres via rowland-supabase.ts instead.
//
// Sheet layout (ROWLAND_SPREADSHEET_ID):
//   RowlandControl          — one row per competition (metadata & play-by dates)
//   Rowland_edward-a        — one row per match in Edward A
//   Rowland_edward-b        — one row per match in Edward B
//   Rowland_gladys-a        — one row per match in Gladys A
//   Rowland_gladys-b        — one row per match in Gladys B
//
// Players are stored pipe-separated in home_players / away_players cells.
//
// SheetTeamRef keeps club_id (unlike the live RowlandTeamRef type, which dropped it
// once club_id itself was dropped from club_profiles) — the migration script uses it
// to sanity-check/fall back for home_club_name/away_club_name, which were hand-entered
// alongside it in these sheets and occasionally blank or inconsistent with the
// canonical club_profiles.club_name spelling.

import {
  getRowlandSpreadsheetId,
  getGoogleSheetsClient,
  getColumnMap,
} from './sheets';

import type {
  RowlandComp,
  RowlandCompId,
  RowlandMatchStatus,
  RowlandCompStatus,
  RowlandRound,
} from '@/types/rowland';

import { ROWLAND_SHEET_NAMES } from '@/types/rowland';

// ============================================================================
// TYPES (sheet-era shape — see file header)
// ============================================================================

export interface SheetTeamRef {
  clubId: string;
  clubName: string;
  teamLetter: string;
}

export interface SheetMatch {
  matchId: string;
  round: RowlandRound;
  position: number;

  homeTeam: SheetTeamRef | null;
  awayTeam: SheetTeamRef | null;

  homePlayers: string[];
  awayPlayers: string[];

  homeScore: number | null;
  awayScore: number | null;
  winnerSide: 1 | 2 | null;

  status: RowlandMatchStatus;
  playByDate: string | null;
  playedDate: string | null;
  notes: string;
  scoreSheetUrl: string | null;
}

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

function parseTeamRef(
  clubId: string | null,
  clubName: string | null,
  teamLetter: string | null
): SheetTeamRef | null {
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

function parseMatchRow(row: any[], colMap: Record<string, number>): SheetMatch {
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

// ============================================================================
// MATCH SHEETS — READ
// ============================================================================

export async function getRowlandMatches(compId: RowlandCompId): Promise<SheetMatch[]> {
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

// ============================================================================
// ROWLAND SETTINGS (RowlandSettings sheet: Key | Value) — READ
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
