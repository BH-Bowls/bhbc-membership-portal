// src/lib/leagues-sheets.ts
// Data layer for the Club Leagues system
//
// Sheet layout (LEAGUES_SPREADSHEET_ID):
//   LeagueControl  — one row per league (leagueId, name, type, season, status, squadSize, playersPerMatch)
//   LeagueTeams    — one row per team (teamId, leagueId, teamName)
//   LeagueSquad    — one row per squad member (leagueId, teamId, username, position, enteredDate)
//   LeagueMatches  — one row per match (matchId, leagueId, matchday, homeTeamId, awayTeamId, ...)
//   LeagueSettings — Key | Value (message etc.)

import {
  getLeaguesSpreadsheetId,
  getGoogleSheetsClient,
  getColumnMap,
  getColumnLetter,
  getAllUsers,
} from './sheets';

import type {
  League,
  LeagueTeam,
  LeagueSquadMember,
  LeagueMatch,
  LeagueType,
  LeagueStatus,
  LeagueMatchStatus,
  SquadPosition,
} from '@/types/leagues';

// ============================================================================
// HELPERS
// ============================================================================

function sid(): string {
  return getLeaguesSpreadsheetId();
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

function makeGetter(row: any[], colMap: Record<string, number>) {
  return (field: string): string | null => {
    const idx = colMap[field];
    if (idx === undefined) return null;
    const v = row[idx];
    return v !== undefined && v !== '' ? String(v) : null;
  };
}

function parseLeagueRow(row: any[], colMap: Record<string, number>): League {
  const get = makeGetter(row, colMap);
  return {
    leagueId: get('league_id') || '',
    name: get('name') || '',
    type: (get('type') || 'triples') as LeagueType,
    season: get('season') || '',
    status: (get('status') || 'Not Started') as LeagueStatus,
    squadSize: parseInt(get('squad_size') || '6', 10) || 6,
    playersPerMatch: parseInt(get('players_per_match') || '3', 10) || 3,
  };
}

function parseTeamRow(row: any[], colMap: Record<string, number>): LeagueTeam {
  const get = makeGetter(row, colMap);
  return {
    teamId: get('team_id') || '',
    leagueId: get('league_id') || '',
    teamName: get('team_name') || '',
  };
}

function parseSquadRow(
  row: any[],
  colMap: Record<string, number>,
  rowNumber: number,
  memberMap: Map<string, { fullName: string; mobile: string | null; email: string | null }>
): LeagueSquadMember {
  const get = makeGetter(row, colMap);
  const username = get('username') || '';
  const info = memberMap.get(username);
  return {
    rowNumber,
    leagueId: get('league_id') || '',
    teamId: get('team_id') || '',
    username,
    fullName: info?.fullName ?? username,
    position: (get('position') || '') as SquadPosition,
    enteredDate: get('entered_date') || '',
    mobile: info?.mobile ?? null,
    email: info?.email ?? null,
  };
}

function parseMatchRow(row: any[], colMap: Record<string, number>): LeagueMatch {
  const get = makeGetter(row, colMap);
  const getInt = (field: string): number | null => {
    const v = get(field);
    if (!v) return null;
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  };
  return {
    matchId: get('match_id') || '',
    leagueId: get('league_id') || '',
    matchday: getInt('matchday') ?? 1,
    homeTeamId: get('home_team_id') || '',
    awayTeamId: get('away_team_id') || '',
    scheduledDate: normalizeDate(get('scheduled_date')),
    scheduledTime: get('scheduled_time'),
    playByDate: normalizeDate(get('play_by_date')),
    homeScore: getInt('home_score'),
    awayScore: getInt('away_score'),
    homeAdj: getInt('home_adj'),
    awayAdj: getInt('away_adj'),
    homePoints: getInt('home_points'),
    awayPoints: getInt('away_points'),
    status: (get('status') || 'Scheduled') as LeagueMatchStatus,
  };
}

// ============================================================================
// LEAGUE CONTROL — READ
// ============================================================================

export async function getAllLeagues(): Promise<League[]> {
  const colMap = await getColumnMap('LeagueControl', sid());
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'LeagueControl!A:Z',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = res.data.values ?? [];
  if (rows.length < 2) return [];

  return rows.slice(1)
    .filter((row) => row[colMap['league_id']] ?? '')
    .map((row) => parseLeagueRow(row, colMap));
}

export async function getLeague(leagueId: string): Promise<League | null> {
  const leagues = await getAllLeagues();
  return leagues.find((l) => l.leagueId === leagueId) ?? null;
}

// ============================================================================
// LEAGUE CONTROL — WRITE
// ============================================================================

export async function createLeague(data: Omit<League, 'leagueId'> & { leagueId?: string }): Promise<string> {
  const colMap = await getColumnMap('LeagueControl', sid());
  const sheets = getGoogleSheetsClient();

  const leagueId = data.leagueId || `league-${Date.now()}`;
  const maxCol = Math.max(...Object.values(colMap)) + 1;
  const row: string[] = Array(maxCol).fill('');

  const set = (field: string, value: string) => {
    if (colMap[field] !== undefined) row[colMap[field]] = value;
  };
  set('league_id', leagueId);
  set('name', data.name);
  set('type', data.type);
  set('season', data.season);
  set('status', data.status);
  set('squad_size', String(data.squadSize));
  set('players_per_match', String(data.playersPerMatch));

  await sheets.spreadsheets.values.append({
    spreadsheetId: sid(),
    range: 'LeagueControl!A:Z',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  return leagueId;
}

export async function updateLeague(
  leagueId: string,
  updates: Partial<Pick<League, 'name' | 'type' | 'season' | 'status' | 'squadSize' | 'playersPerMatch'>>
): Promise<void> {
  const colMap = await getColumnMap('LeagueControl', sid());
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'LeagueControl!A:Z',
  });
  const rows = res.data.values ?? [];
  const idCol = colMap['league_id'];
  const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[idCol] ?? '') === leagueId);
  if (rowIdx < 0) throw new Error(`League ${leagueId} not found`);
  const sheetRow = rowIdx + 1;

  const fieldMap: Record<string, string> = {};
  if (updates.name !== undefined) fieldMap['name'] = updates.name;
  if (updates.type !== undefined) fieldMap['type'] = updates.type;
  if (updates.season !== undefined) fieldMap['season'] = updates.season;
  if (updates.status !== undefined) fieldMap['status'] = updates.status;
  if (updates.squadSize !== undefined) fieldMap['squad_size'] = String(updates.squadSize);
  if (updates.playersPerMatch !== undefined) fieldMap['players_per_match'] = String(updates.playersPerMatch);

  const data = Object.entries(fieldMap)
    .filter(([col]) => colMap[col] !== undefined)
    .map(([col, value]) => ({
      range: `LeagueControl!${getColumnLetter(colMap[col])}${sheetRow}`,
      values: [[value]],
    }));

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sid(),
    requestBody: { data, valueInputOption: 'USER_ENTERED' },
  });
}

// ============================================================================
// TEAMS — READ
// ============================================================================

export async function getAllTeams(): Promise<LeagueTeam[]> {
  const colMap = await getColumnMap('LeagueTeams', sid());
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'LeagueTeams!A:Z',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = res.data.values ?? [];
  if (rows.length < 2) return [];

  return rows.slice(1)
    .filter((row) => row[colMap['team_id']] ?? '')
    .map((row) => parseTeamRow(row, colMap));
}

export async function getLeagueTeams(leagueId: string): Promise<LeagueTeam[]> {
  const all = await getAllTeams();
  return all.filter((t) => t.leagueId === leagueId);
}

// ============================================================================
// TEAMS — WRITE
// ============================================================================

export async function createTeam(leagueId: string, teamName: string): Promise<string> {
  const colMap = await getColumnMap('LeagueTeams', sid());
  const sheets = getGoogleSheetsClient();

  const teamId = `team-${Date.now()}`;
  const maxCol = Math.max(...Object.values(colMap)) + 1;
  const row: string[] = Array(maxCol).fill('');

  const set = (field: string, value: string) => {
    if (colMap[field] !== undefined) row[colMap[field]] = value;
  };
  set('team_id', teamId);
  set('league_id', leagueId);
  set('team_name', teamName);

  await sheets.spreadsheets.values.append({
    spreadsheetId: sid(),
    range: 'LeagueTeams!A:Z',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  return teamId;
}

export async function deleteTeam(teamId: string): Promise<void> {
  const colMap = await getColumnMap('LeagueTeams', sid());
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'LeagueTeams!A:Z',
  });
  const rows = res.data.values ?? [];
  const idCol = colMap['team_id'];
  const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[idCol] ?? '') === teamId);
  if (rowIdx < 0) return;

  // Get the sheet's sheetId for row deletion
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sid() });
  const sheet = meta.data.sheets?.find(
    (s) => s.properties?.title === 'LeagueTeams'
  );
  if (!sheet?.properties?.sheetId) throw new Error('LeagueTeams sheet not found');

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sid(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.properties.sheetId,
            dimension: 'ROWS',
            startIndex: rowIdx,
            endIndex: rowIdx + 1,
          },
        },
      }],
    },
  });
}

// ============================================================================
// SQUAD — READ
// ============================================================================

export async function getLeagueSquad(leagueId: string): Promise<LeagueSquadMember[]> {
  const colMap = await getColumnMap('LeagueSquad', sid());
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'LeagueSquad!A:Z',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = res.data.values ?? [];
  if (rows.length < 2) return [];

  // Build member info map
  const users = await getAllUsers();
  const memberMap = new Map<string, { fullName: string; mobile: string | null; email: string | null }>(
    users.map((u) => [u.userName, {
      fullName: u.fullName || `${u.firstName} ${u.lastName}`.trim(),
      mobile: u.mobile ?? null,
      email: u.emailAddress ?? null,
    }])
  );

  return rows.slice(1)
    .map((row, i) => ({ row, sheetRow: i + 2 })) // i+2: 1-based + skip header
    .filter(({ row }) => {
      const idCol = colMap['league_id'];
      return idCol !== undefined && String(row[idCol] ?? '') === leagueId;
    })
    .map(({ row, sheetRow }) => parseSquadRow(row, colMap, sheetRow, memberMap));
}

export async function getTeamSquad(teamId: string): Promise<LeagueSquadMember[]> {
  const colMap = await getColumnMap('LeagueSquad', sid());
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'LeagueSquad!A:Z',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = res.data.values ?? [];
  if (rows.length < 2) return [];

  const users = await getAllUsers();
  const memberMap = new Map<string, { fullName: string; mobile: string | null; email: string | null }>(
    users.map((u) => [u.userName, {
      fullName: u.fullName || `${u.firstName} ${u.lastName}`.trim(),
      mobile: u.mobile ?? null,
      email: u.emailAddress ?? null,
    }])
  );

  return rows.slice(1)
    .map((row, i) => ({ row, sheetRow: i + 2 }))
    .filter(({ row }) => {
      const idCol = colMap['team_id'];
      return idCol !== undefined && String(row[idCol] ?? '') === teamId;
    })
    .map(({ row, sheetRow }) => parseSquadRow(row, colMap, sheetRow, memberMap));
}

/** Check if a username is already in the squad for a given league. */
export async function isInLeagueSquad(leagueId: string, username: string): Promise<boolean> {
  const squad = await getLeagueSquad(leagueId);
  return squad.some((m) => m.username === username);
}

/** Return all league IDs that a given username is entered in (one sheet read). */
export async function getEnteredLeagueIds(username: string): Promise<string[]> {
  if (!username) return [];
  const colMap = await getColumnMap('LeagueSquad', sid());
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'LeagueSquad!A:Z',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = res.data.values ?? [];
  if (rows.length < 2) return [];

  const usernameCol = colMap['username'];
  const leagueIdCol = colMap['league_id'];
  if (usernameCol === undefined || leagueIdCol === undefined) return [];

  return rows.slice(1)
    .filter((row) => String(row[usernameCol] ?? '') === username)
    .map((row) => String(row[leagueIdCol] ?? ''))
    .filter(Boolean);
}

// ============================================================================
// SQUAD — WRITE
// ============================================================================

export async function enterLeague(data: {
  leagueId: string;
  username: string;
  position: SquadPosition;
  enteredDate: string;
}): Promise<void> {
  const colMap = await getColumnMap('LeagueSquad', sid());
  const sheets = getGoogleSheetsClient();

  const maxCol = Math.max(...Object.values(colMap)) + 1;
  const row: string[] = Array(maxCol).fill('');

  const set = (field: string, value: string) => {
    if (colMap[field] !== undefined) row[colMap[field]] = value;
  };
  set('league_id', data.leagueId);
  set('team_id', '');
  set('username', data.username);
  set('position', data.position);
  set('entered_date', data.enteredDate);

  await sheets.spreadsheets.values.append({
    spreadsheetId: sid(),
    range: 'LeagueSquad!A:Z',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

export async function withdrawFromLeague(leagueId: string, username: string): Promise<void> {
  const colMap = await getColumnMap('LeagueSquad', sid());
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'LeagueSquad!A:Z',
  });
  const rows = res.data.values ?? [];

  const leagueCol = colMap['league_id'];
  const userCol = colMap['username'];
  const rowIdx = rows.findIndex(
    (r, i) => i > 0 &&
      String(r[leagueCol] ?? '') === leagueId &&
      String(r[userCol] ?? '') === username
  );
  if (rowIdx < 0) return;

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sid() });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === 'LeagueSquad');
  if (!sheet?.properties?.sheetId) throw new Error('LeagueSquad sheet not found');

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sid(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.properties.sheetId,
            dimension: 'ROWS',
            startIndex: rowIdx,
            endIndex: rowIdx + 1,
          },
        },
      }],
    },
  });
}

export async function assignSquadMemberToTeam(rowNumber: number, teamId: string): Promise<void> {
  const colMap = await getColumnMap('LeagueSquad', sid());
  const sheets = getGoogleSheetsClient();

  if (colMap['team_id'] === undefined) throw new Error('team_id column not found in LeagueSquad');

  await sheets.spreadsheets.values.update({
    spreadsheetId: sid(),
    range: `LeagueSquad!${getColumnLetter(colMap['team_id'])}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[teamId]] },
  });
}

export async function updateSquadMemberPosition(rowNumber: number, position: SquadPosition): Promise<void> {
  const colMap = await getColumnMap('LeagueSquad', sid());
  const sheets = getGoogleSheetsClient();

  if (colMap['position'] === undefined) throw new Error('position column not found in LeagueSquad');

  await sheets.spreadsheets.values.update({
    spreadsheetId: sid(),
    range: `LeagueSquad!${getColumnLetter(colMap['position'])}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[position]] },
  });
}

/**
 * Bulk-save all players for a team in one round-trip.
 * Clears any existing team assignment for the given team, then writes the
 * new player list (username + position) atomically.
 */
export async function setTeamPlayers(
  leagueId: string,
  teamId: string,
  players: { username: string; position: string }[],
): Promise<void> {
  const colMap = await getColumnMap('LeagueSquad', sid());
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'LeagueSquad!A:Z',
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = res.data.values ?? [];
  const teamIdCol  = colMap['team_id'];
  const posCol     = colMap['position'];
  const leagueCol  = colMap['league_id'];
  const usernameCol = colMap['username'];

  if (teamIdCol === undefined || posCol === undefined) throw new Error('Required columns missing');

  const newByUsername = new Map(players.map((p) => [p.username, p.position]));
  const data: { range: string; values: string[][] }[] = [];

  rows.forEach((row, idx) => {
    if (idx === 0) return; // skip header
    const rowLeague  = String(row[leagueCol]   ?? '');
    const rowTeam    = String(row[teamIdCol]    ?? '');
    const rowUser    = String(row[usernameCol]  ?? '');
    if (rowLeague !== leagueId) return;

    const sheetRow = idx + 1; // 1-indexed
    const newPos   = newByUsername.get(rowUser);

    if (rowTeam === teamId) {
      // Was in this team — clear or update
      const newTeam = newByUsername.has(rowUser) ? teamId : '';
      data.push({ range: `LeagueSquad!${getColumnLetter(teamIdCol)}${sheetRow}`,  values: [[newTeam]] });
      data.push({ range: `LeagueSquad!${getColumnLetter(posCol)}${sheetRow}`,     values: [[newPos ?? '']] });
    } else if (newByUsername.has(rowUser)) {
      // Was in another team (or unassigned) — assign here
      data.push({ range: `LeagueSquad!${getColumnLetter(teamIdCol)}${sheetRow}`,  values: [[teamId]] });
      data.push({ range: `LeagueSquad!${getColumnLetter(posCol)}${sheetRow}`,     values: [[newPos ?? '']] });
    }
  });

  if (data.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sid(),
      requestBody: { valueInputOption: 'RAW', data },
    });
  }
}

// ============================================================================
// MATCHES — READ
// ============================================================================

export async function getLeagueMatches(leagueId: string): Promise<LeagueMatch[]> {
  const colMap = await getColumnMap('LeagueMatches', sid());
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'LeagueMatches!A:Z',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = res.data.values ?? [];
  if (rows.length < 2) return [];

  const idCol = colMap['league_id'];
  return rows.slice(1)
    .filter((row) => String(row[idCol] ?? '') === leagueId)
    .map((row) => parseMatchRow(row, colMap));
}

// ============================================================================
// MATCHES — WRITE
// ============================================================================

/** Bulk-append a list of matches. Typically called after generating round-robin fixtures. */
export async function createLeagueMatches(
  matches: Omit<LeagueMatch, 'homeScore' | 'awayScore' | 'status'>[],
): Promise<void> {
  if (matches.length === 0) return;
  const colMap = await getColumnMap('LeagueMatches', sid());
  const sheets = getGoogleSheetsClient();

  const maxCol = Math.max(...Object.values(colMap)) + 1;

  const rows = matches.map((m) => {
    const row: string[] = Array(maxCol).fill('');
    const set = (field: string, value: string) => {
      if (colMap[field] !== undefined) row[colMap[field]] = value;
    };
    set('match_id', m.matchId);
    set('league_id', m.leagueId);
    set('matchday', String(m.matchday));
    set('home_team_id', m.homeTeamId);
    set('away_team_id', m.awayTeamId);
    set('scheduled_date', m.scheduledDate ?? '');
    set('scheduled_time', m.scheduledTime ?? '');
    set('play_by_date', m.playByDate ?? '');
    set('home_score', '');
    set('away_score', '');
    set('status', 'Scheduled');
    return row;
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: sid(),
    range: 'LeagueMatches!A:Z',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
}

/** Clear all matches for a league (used before regenerating fixtures). */
export async function clearLeagueMatches(leagueId: string): Promise<void> {
  const colMap = await getColumnMap('LeagueMatches', sid());
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'LeagueMatches!A:Z',
  });
  const rows = res.data.values ?? [];

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sid() });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === 'LeagueMatches');
  if (!sheet?.properties?.sheetId) throw new Error('LeagueMatches sheet not found');

  const idCol = colMap['league_id'];
  // Collect row indices (0-based, including header offset) to delete, in reverse order
  const toDelete: number[] = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][idCol] ?? '') === leagueId) {
      toDelete.push(i);
    }
  }
  if (toDelete.length === 0) return;

  // Delete in reverse so indices don't shift
  const requests = toDelete.map((rowIdx) => ({
    deleteDimension: {
      range: {
        sheetId: sheet.properties!.sheetId,
        dimension: 'ROWS' as const,
        startIndex: rowIdx,
        endIndex: rowIdx + 1,
      },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sid(),
    requestBody: { requests },
  });
}

export async function updateLeagueMatch(
  matchId: string,
  updates: Partial<Pick<LeagueMatch,
    'matchday' | 'homeTeamId' | 'awayTeamId' |
    'scheduledDate' | 'scheduledTime' | 'playByDate' |
    'homeScore' | 'awayScore' | 'homeAdj' | 'awayAdj' | 'homePoints' | 'awayPoints' | 'status'
  >>
): Promise<void> {
  const colMap = await getColumnMap('LeagueMatches', sid());
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'LeagueMatches!A:Z',
  });
  const rows = res.data.values ?? [];
  const idCol = colMap['match_id'];
  const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[idCol] ?? '') === matchId);
  if (rowIdx < 0) throw new Error(`Match ${matchId} not found`);
  const sheetRow = rowIdx + 1;

  const fieldMap: Record<string, string> = {};
  if (updates.matchday !== undefined) fieldMap['matchday'] = String(updates.matchday);
  if (updates.homeTeamId !== undefined) fieldMap['home_team_id'] = updates.homeTeamId;
  if (updates.awayTeamId !== undefined) fieldMap['away_team_id'] = updates.awayTeamId;
  if (updates.scheduledDate !== undefined) fieldMap['scheduled_date'] = updates.scheduledDate ?? '';
  if (updates.scheduledTime !== undefined) fieldMap['scheduled_time'] = updates.scheduledTime ?? '';
  if (updates.playByDate !== undefined) fieldMap['play_by_date'] = updates.playByDate ?? '';
  if (updates.homeScore !== undefined) fieldMap['home_score'] = updates.homeScore !== null ? String(updates.homeScore) : '';
  if (updates.awayScore !== undefined) fieldMap['away_score'] = updates.awayScore !== null ? String(updates.awayScore) : '';
  if (updates.homeAdj !== undefined) fieldMap['home_adj'] = updates.homeAdj !== null ? String(updates.homeAdj) : '';
  if (updates.awayAdj !== undefined) fieldMap['away_adj'] = updates.awayAdj !== null ? String(updates.awayAdj) : '';
  if (updates.homePoints !== undefined) fieldMap['home_points'] = updates.homePoints !== null ? String(updates.homePoints) : '';
  if (updates.awayPoints !== undefined) fieldMap['away_points'] = updates.awayPoints !== null ? String(updates.awayPoints) : '';
  if (updates.status !== undefined) fieldMap['status'] = updates.status;

  const data = Object.entries(fieldMap)
    .filter(([col]) => colMap[col] !== undefined)
    .map(([col, value]) => ({
      range: `LeagueMatches!${getColumnLetter(colMap[col])}${sheetRow}`,
      values: [[value]],
    }));

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sid(),
    requestBody: { data, valueInputOption: 'USER_ENTERED' },
  });
}

export async function deleteLeagueMatch(matchId: string): Promise<void> {
  const colMap = await getColumnMap('LeagueMatches', sid());
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: 'LeagueMatches!A:Z',
  });
  const rows = res.data.values ?? [];
  const idCol = colMap['match_id'];
  const rowIdx = rows.findIndex((r, i) => i > 0 && String(r[idCol] ?? '') === matchId);
  if (rowIdx < 0) return;

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sid() });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === 'LeagueMatches');
  if (!sheet?.properties?.sheetId) throw new Error('LeagueMatches sheet not found');

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sid(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.properties.sheetId,
            dimension: 'ROWS',
            startIndex: rowIdx,
            endIndex: rowIdx + 1,
          },
        },
      }],
    },
  });
}

// ============================================================================
// SETTINGS (LeagueSettings sheet: Key | Value)
// ============================================================================

const SETTINGS_SHEET = 'LeagueSettings';

export async function getLeagueMessage(): Promise<string> {
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
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

export async function setLeagueMessage(message: string): Promise<void> {
  const sheets = getGoogleSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
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
      spreadsheetId: sid(),
      range: `${SETTINGS_SHEET}!A:B`,
      valueInputOption: 'RAW',
      requestBody: { values: [['message', message]] },
    });
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid(),
      range: `${SETTINGS_SHEET}!B${targetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[message]] },
    });
  }
}
