// src/lib/leagues-supabase.ts
// Postgres-backed replacement for leagues-sheets.ts. Same function names/signatures
// throughout, so every consumer route needs only an import swap.
//
// Five tables (supabase/migrations/0038_leagues.sql): leagues, league_teams,
// league_squad, league_matches, league_settings (the single site-wide message,
// distinct from each league's own `message` column).
//
// league_id/team_id/match_id keep their existing text business keys, not uuids.
// league_squad rows get a real uuid `id` — LeagueSquadMember.rowNumber is typed as
// string now (was a Sheets row number) and holds that uuid.
//
// assignSquadMemberToTeam/updateSquadMemberPosition (and the PATCH
// /api/leagues/[leagueId]/squad/[rowNumber] route they backed) were NOT ported —
// confirmed zero callers anywhere in the app, fully superseded by the bulk
// setTeamPlayers save the manage page actually uses.

import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';
import type {
  League,
  LeagueTeam,
  LeagueSquadMember,
  LeagueMatch,
  LeagueMatchPlayer,
  LeagueType,
  LeagueStatus,
  LeagueMatchStatus,
  SquadPosition,
  DateLabel,
} from '@/types/leagues';

// ============================================================================
// ROW MAPPERS
// ============================================================================

function mapLeagueRow(row: any): League {
  return {
    leagueId: row.league_id,
    name: row.name,
    type: row.type as LeagueType,
    season: row.season,
    status: row.status as LeagueStatus,
    squadSize: row.squad_size,
    playersPerMatch: row.players_per_match,
    dateLabel: row.date_label as DateLabel,
    legs: row.legs as 1 | 2,
    message: row.message ?? '',
  };
}

function mapTeamRow(row: any): LeagueTeam {
  return {
    teamId: row.team_id,
    leagueId: row.league_id,
    teamName: row.team_name,
  };
}

function mapMatchRow(row: any): LeagueMatch {
  return {
    matchId: row.match_id,
    leagueId: row.league_id,
    matchday: row.matchday,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time,
    playByDate: row.play_by_date,
    homeScore: row.home_score,
    awayScore: row.away_score,
    homeAdj: row.home_adj,
    awayAdj: row.away_adj,
    homePoints: row.home_points,
    awayPoints: row.away_points,
    status: row.status as LeagueMatchStatus,
  };
}

type MemberInfo = { fullName: string; mobile: string | null; landline: string | null; email: string | null };

async function buildMemberMap(): Promise<Map<string, MemberInfo>> {
  const users = await getAllUsers();
  return new Map(users.map((u) => [u.userName, {
    fullName: u.fullName || `${u.firstName} ${u.lastName}`.trim(),
    mobile: u.mobile ?? null,
    landline: u.landline ?? null,
    email: u.emailAddress ?? null,
  }]));
}

function mapSquadRow(row: any, memberMap: Map<string, MemberInfo>): LeagueSquadMember {
  const info = memberMap.get(row.username);
  return {
    rowNumber: row.id,
    leagueId: row.league_id,
    teamId: row.team_id ?? '',
    username: row.username,
    fullName: info?.fullName ?? row.username,
    position: (row.position || '') as SquadPosition,
    enteredDate: row.entered_date || '',
    mobile: info?.mobile ?? null,
    landline: info?.landline ?? null,
    email: info?.email ?? null,
  };
}

// ============================================================================
// LEAGUE CONTROL — READ
// ============================================================================

export async function getAllLeagues(): Promise<League[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('leagues').select('*');
  if (error) throw new Error(`Failed to fetch leagues: ${error.message}`);
  return (data ?? []).map(mapLeagueRow);
}

export async function getLeague(leagueId: string): Promise<League | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('leagues').select('*').eq('league_id', leagueId).maybeSingle();
  if (error) throw new Error(`Failed to fetch league ${leagueId}: ${error.message}`);
  return data ? mapLeagueRow(data) : null;
}

// ============================================================================
// LEAGUE CONTROL — WRITE
// ============================================================================

export async function createLeague(data: Omit<League, 'leagueId'> & { leagueId?: string }): Promise<string> {
  const leagueId = data.leagueId || `league-${Date.now()}`;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('leagues').insert({
    league_id: leagueId,
    name: data.name,
    type: data.type,
    season: data.season,
    status: data.status,
    squad_size: data.squadSize,
    players_per_match: data.playersPerMatch,
    date_label: data.dateLabel,
    legs: data.legs,
    message: data.message ?? '',
  });
  if (error) throw new Error(`Failed to create league: ${error.message}`);
  return leagueId;
}

export async function updateLeague(
  leagueId: string,
  updates: Partial<Pick<League, 'name' | 'type' | 'season' | 'status' | 'squadSize' | 'playersPerMatch' | 'dateLabel' | 'legs' | 'message'>>
): Promise<void> {
  const columnUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) columnUpdates.name = updates.name;
  if (updates.type !== undefined) columnUpdates.type = updates.type;
  if (updates.season !== undefined) columnUpdates.season = updates.season;
  if (updates.status !== undefined) columnUpdates.status = updates.status;
  if (updates.squadSize !== undefined) columnUpdates.squad_size = updates.squadSize;
  if (updates.playersPerMatch !== undefined) columnUpdates.players_per_match = updates.playersPerMatch;
  if (updates.dateLabel !== undefined) columnUpdates.date_label = updates.dateLabel;
  if (updates.legs !== undefined) columnUpdates.legs = updates.legs;
  if (updates.message !== undefined) columnUpdates.message = updates.message;
  if (Object.keys(columnUpdates).length === 0) return;

  const supabase = getSupabaseClient();
  const { error, count } = await supabase.from('leagues').update(columnUpdates, { count: 'exact' }).eq('league_id', leagueId);
  if (error) throw new Error(`Failed to update league ${leagueId}: ${error.message}`);
  if (!count) throw new Error(`League ${leagueId} not found`);
}

// ============================================================================
// TEAMS — READ
// ============================================================================

export async function getAllTeams(): Promise<LeagueTeam[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('league_teams').select('*');
  if (error) throw new Error(`Failed to fetch teams: ${error.message}`);
  return (data ?? []).map(mapTeamRow);
}

export async function getLeagueTeams(leagueId: string): Promise<LeagueTeam[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('league_teams').select('*').eq('league_id', leagueId);
  if (error) throw new Error(`Failed to fetch teams for league ${leagueId}: ${error.message}`);
  return (data ?? []).map(mapTeamRow);
}

// ============================================================================
// TEAMS — WRITE
// ============================================================================

export async function createTeam(leagueId: string, teamName: string): Promise<string> {
  const teamId = `team-${Date.now()}`;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('league_teams').insert({ team_id: teamId, league_id: leagueId, team_name: teamName });
  if (error) throw new Error(`Failed to create team: ${error.message}`);
  return teamId;
}

export async function renameTeam(teamId: string, newName: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error, count } = await supabase.from('league_teams').update({ team_name: newName }, { count: 'exact' }).eq('team_id', teamId);
  if (error) throw new Error(`Failed to rename team: ${error.message}`);
  if (!count) throw new Error(`Team ${teamId} not found`);
}

export async function deleteTeam(teamId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('league_teams').delete().eq('team_id', teamId);
  if (error) throw new Error(`Failed to delete team ${teamId}: ${error.message}`);
}

// ============================================================================
// SQUAD — READ
// ============================================================================

export async function getLeagueSquad(leagueId: string): Promise<LeagueSquadMember[]> {
  const supabase = getSupabaseClient();
  const [{ data, error }, memberMap] = await Promise.all([
    supabase.from('league_squad').select('*').eq('league_id', leagueId),
    buildMemberMap(),
  ]);
  if (error) throw new Error(`Failed to fetch squad for league ${leagueId}: ${error.message}`);
  return (data ?? []).map((row) => mapSquadRow(row, memberMap));
}

export async function getTeamSquad(teamId: string): Promise<LeagueSquadMember[]> {
  const supabase = getSupabaseClient();
  const [{ data, error }, memberMap] = await Promise.all([
    supabase.from('league_squad').select('*').eq('team_id', teamId),
    buildMemberMap(),
  ]);
  if (error) throw new Error(`Failed to fetch squad for team ${teamId}: ${error.message}`);
  return (data ?? []).map((row) => mapSquadRow(row, memberMap));
}

/** Check if a username is already in the squad for a given league. */
export async function isInLeagueSquad(leagueId: string, username: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('league_squad').select('id').eq('league_id', leagueId).eq('username', username).maybeSingle();
  if (error) throw new Error(`Failed to check squad membership: ${error.message}`);
  return !!data;
}

/** Return all league IDs that a given username is entered in (one query). */
export async function getEnteredLeagueIds(username: string): Promise<string[]> {
  if (!username) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('league_squad').select('league_id').eq('username', username);
  if (error) throw new Error(`Failed to fetch entered leagues: ${error.message}`);
  return (data ?? []).map((row) => row.league_id as string);
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
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('league_squad').insert({
    league_id: data.leagueId,
    team_id: null,
    username: data.username,
    position: data.position,
    entered_date: data.enteredDate,
  });
  if (error) throw new Error(`Failed to enter league: ${error.message}`);
}

export async function withdrawFromLeague(leagueId: string, username: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('league_squad').delete().eq('league_id', leagueId).eq('username', username);
  if (error) throw new Error(`Failed to withdraw from league: ${error.message}`);
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
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('league_squad').select('id, username, team_id').eq('league_id', leagueId);
  if (error) throw new Error(`Failed to fetch squad for league ${leagueId}: ${error.message}`);

  const newByUsername = new Map(players.map((p) => [p.username, p.position]));
  const updates: { id: string; team_id: string | null; position: string }[] = [];

  for (const row of data ?? []) {
    const username = row.username as string;
    const newPos = newByUsername.get(username);

    if (row.team_id === teamId) {
      // Was in this team — clear or update
      updates.push({ id: row.id, team_id: newByUsername.has(username) ? teamId : null, position: newPos ?? '' });
    } else if (newByUsername.has(username)) {
      // Was in another team (or unassigned) — assign here
      updates.push({ id: row.id, team_id: teamId, position: newPos ?? '' });
    }
  }

  if (updates.length > 0) {
    await Promise.all(updates.map((u) =>
      supabase.from('league_squad').update({ team_id: u.team_id, position: u.position }).eq('id', u.id)
    ));
  }
}

// ============================================================================
// MATCHES — READ
// ============================================================================

export async function getLeagueMatches(leagueId: string): Promise<LeagueMatch[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('league_matches').select('*').eq('league_id', leagueId);
  if (error) throw new Error(`Failed to fetch matches for league ${leagueId}: ${error.message}`);
  return (data ?? []).map(mapMatchRow);
}

// ============================================================================
// MATCHES — WRITE
// ============================================================================

/** Bulk-append a list of matches. Typically called after generating round-robin fixtures. */
export async function createLeagueMatches(
  matches: Omit<LeagueMatch, 'homeScore' | 'awayScore' | 'status'>[],
): Promise<void> {
  if (matches.length === 0) return;
  const supabase = getSupabaseClient();
  const rows = matches.map((m) => ({
    match_id: m.matchId,
    league_id: m.leagueId,
    matchday: m.matchday,
    home_team_id: m.homeTeamId,
    away_team_id: m.awayTeamId,
    scheduled_date: m.scheduledDate,
    scheduled_time: m.scheduledTime,
    play_by_date: m.playByDate,
    home_adj: m.homeAdj,
    away_adj: m.awayAdj,
    home_points: m.homePoints,
    away_points: m.awayPoints,
    status: 'Scheduled',
  }));
  const { error } = await supabase.from('league_matches').insert(rows);
  if (error) throw new Error(`Failed to create league matches: ${error.message}`);
}

/** Clear all matches for a league (used before regenerating fixtures). */
export async function clearLeagueMatches(leagueId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('league_matches').delete().eq('league_id', leagueId);
  if (error) throw new Error(`Failed to clear matches for league ${leagueId}: ${error.message}`);
}

export async function updateLeagueMatch(
  matchId: string,
  updates: Partial<Pick<LeagueMatch,
    'matchday' | 'homeTeamId' | 'awayTeamId' |
    'scheduledDate' | 'scheduledTime' | 'playByDate' |
    'homeScore' | 'awayScore' | 'homeAdj' | 'awayAdj' | 'homePoints' | 'awayPoints' | 'status'
  >>
): Promise<void> {
  const columnUpdates: Record<string, unknown> = {};
  if (updates.matchday !== undefined) columnUpdates.matchday = updates.matchday;
  if (updates.homeTeamId !== undefined) columnUpdates.home_team_id = updates.homeTeamId;
  if (updates.awayTeamId !== undefined) columnUpdates.away_team_id = updates.awayTeamId;
  if (updates.scheduledDate !== undefined) columnUpdates.scheduled_date = updates.scheduledDate;
  if (updates.scheduledTime !== undefined) columnUpdates.scheduled_time = updates.scheduledTime;
  if (updates.playByDate !== undefined) columnUpdates.play_by_date = updates.playByDate;
  if (updates.homeScore !== undefined) columnUpdates.home_score = updates.homeScore;
  if (updates.awayScore !== undefined) columnUpdates.away_score = updates.awayScore;
  if (updates.homeAdj !== undefined) columnUpdates.home_adj = updates.homeAdj;
  if (updates.awayAdj !== undefined) columnUpdates.away_adj = updates.awayAdj;
  if (updates.homePoints !== undefined) columnUpdates.home_points = updates.homePoints;
  if (updates.awayPoints !== undefined) columnUpdates.away_points = updates.awayPoints;
  if (updates.status !== undefined) columnUpdates.status = updates.status;
  if (Object.keys(columnUpdates).length === 0) return;

  const supabase = getSupabaseClient();
  const { error, count } = await supabase.from('league_matches').update(columnUpdates, { count: 'exact' }).eq('match_id', matchId);
  if (error) throw new Error(`Failed to update match ${matchId}: ${error.message}`);
  if (!count) throw new Error(`Match ${matchId} not found`);
}

export async function deleteLeagueMatch(matchId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('league_matches').delete().eq('match_id', matchId);
  if (error) throw new Error(`Failed to delete match ${matchId}: ${error.message}`);
}

// ============================================================================
// MATCH LINEUP — who's actually named as playing a specific match (separate from
// the team's overall squad). Drives Diary visibility and score-entry permission.
// ============================================================================

export async function getMatchLineup(matchId: string): Promise<LeagueMatchPlayer[]> {
  const supabase = getSupabaseClient();
  const [{ data, error }, memberMap] = await Promise.all([
    supabase.from('league_match_players').select('match_id, username').eq('match_id', matchId),
    buildMemberMap(),
  ]);
  if (error) throw new Error(`Failed to fetch lineup for match ${matchId}: ${error.message}`);
  return (data ?? []).map((row) => ({
    matchId: row.match_id,
    username: row.username,
    fullName: memberMap.get(row.username)?.fullName ?? row.username,
  }));
}

/** All named lineups across every match in a league, one query — for the main
 *  league GET route so the fixtures list doesn't need one request per match. */
export async function getLeagueMatchLineups(leagueId: string): Promise<LeagueMatchPlayer[]> {
  const supabase = getSupabaseClient();
  const [{ data, error }, memberMap] = await Promise.all([
    supabase
      .from('league_match_players')
      .select('match_id, username, league_matches!inner(league_id)')
      .eq('league_matches.league_id', leagueId),
    buildMemberMap(),
  ]);
  if (error) throw new Error(`Failed to fetch match lineups for league ${leagueId}: ${error.message}`);
  return (data ?? []).map((row: any) => ({
    matchId: row.match_id,
    username: row.username,
    fullName: memberMap.get(row.username)?.fullName ?? row.username,
  }));
}

export async function addMatchPlayer(matchId: string, username: string, addedByUsername: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('league_match_players').upsert(
    { match_id: matchId, username, added_by_username: addedByUsername },
    { onConflict: 'match_id,username' }
  );
  if (error) throw new Error(`Failed to add ${username} to match ${matchId}: ${error.message}`);
}

export async function removeMatchPlayer(matchId: string, username: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('league_match_players').delete().eq('match_id', matchId).eq('username', username);
  if (error) throw new Error(`Failed to remove ${username} from match ${matchId}: ${error.message}`);
}

// ============================================================================
// SETTINGS (league_settings: key/value — the single site-wide message)
// ============================================================================

export async function getLeagueMessage(): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('league_settings').select('value').eq('key', 'message').maybeSingle();
  if (error) throw new Error(`Failed to fetch league message: ${error.message}`);
  return data?.value ?? '';
}

export async function setLeagueMessage(message: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('league_settings').upsert({ key: 'message', value: message }, { onConflict: 'key' });
  if (error) throw new Error(`Failed to save league message: ${error.message}`);
}
