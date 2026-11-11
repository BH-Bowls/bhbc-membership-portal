// src/lib/rowland-supabase.ts
// Postgres-backed data layer for Rowland Cup match/bracket management — replaces
// rowland-sheets.ts (kept read-only, for scripts/migrate-rowland.ts only — see its
// header). See supabase/migrations/0048_rowland.sql for schema, and 0097 for years.
//
// Teams are identified by club_name directly (no club_id — see
// specs/Phase_0_1_Migration_Plan.md's Rowland redesign section).
//
// Rowland *contacts*/tokens (the team-entry feature) are a separate, deliberately
// deferred piece — not part of this data layer.

import { getSupabaseClient, withJwtRetry } from './supabase';
import {
  computeRowlandBracket,
  ROWLAND_ROUND_ORDER,
} from '@/types/rowland';
import type {
  RowlandComp,
  RowlandCompId,
  RowlandMatch,
  RowlandRound,
  RowlandTeamRef,
} from '@/types/rowland';

// ============================================================================
// MAPPING
// ============================================================================

function teamRef(clubName: string | null, teamLetter: string | null): RowlandTeamRef | null {
  if (!clubName) return null;
  return { clubName, teamLetter: teamLetter || '' };
}

function mapCompRow(row: any): RowlandComp {
  return {
    compId: row.comp_id,
    compName: row.comp_name,
    year: row.year,
    status: row.status,
    numTeams: row.num_teams ?? 0,
    prelimPlayBy: row.prelim_play_by,
    r1PlayBy: row.r1_play_by,
    r2PlayBy: row.r2_play_by,
    qfPlayBy: row.qf_play_by,
    sfPlayBy: row.sf_play_by,
    fPlayBy: row.f_play_by,
  };
}

function mapMatchRow(row: any): RowlandMatch {
  return {
    matchId: row.match_id,
    round: row.round,
    position: row.position,
    homeTeam: teamRef(row.home_club_name, row.home_team_letter),
    awayTeam: teamRef(row.away_club_name, row.away_team_letter),
    homePlayers: row.home_players || [],
    awayPlayers: row.away_players || [],
    homeScore: row.home_score,
    awayScore: row.away_score,
    winnerSide: row.winner_side,
    status: row.status,
    playByDate: row.play_by_date,
    playedDate: row.played_date,
    notes: row.notes || '',
    scoreSheetUrl: row.score_sheet_url,
  };
}

function sortMatches(matches: RowlandMatch[]): RowlandMatch[] {
  return matches.sort((a, b) => {
    const ra = ROWLAND_ROUND_ORDER.indexOf(a.round);
    const rb = ROWLAND_ROUND_ORDER.indexOf(b.round);
    return ra !== rb ? ra - rb : a.position - b.position;
  });
}

// ============================================================================
// CONTROL — READ / WRITE
// ============================================================================

// Every year's Rowland Cup lives side by side in the same tables, the same way fixtures
// do (supabase/migrations/0097_competition_years.sql): rowland_comps has one row per
// competition per year and rowland_matches carries the year too. The CURRENT year is the
// latest year with competitions — the only one that can be changed. Functions with an
// optional year use the current year when it's left out.

/** The latest year with Rowland competitions, e.g. 2026. */
export async function getCurrentRowlandYear(): Promise<number> {
  return withJwtRetry(async () => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('rowland_comps')
      .select('year')
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Failed to fetch the Rowland year: ${error.message}`);
    return data ? data.year : new Date().getFullYear();
  });
}

/** Every year with Rowland competitions, oldest first — for the year picker. */
export async function getRowlandYears(): Promise<number[]> {
  return withJwtRetry(async () => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('rowland_comps').select('year');
    if (error) throw new Error(`Failed to fetch Rowland years: ${error.message}`);
    const years: number[] = [];
    for (const row of data || []) {
      if (!years.includes(row.year)) years.push(row.year);
    }
    years.sort((a, b) => a - b);
    return years;
  });
}

/**
 * Sets up next year: a new Not Started row for each of this year's four competitions
 * (no teams, no dates). This year's draws and results are left as they are. The year
 * must already exist in the seasons table.
 */
export async function startNextRowlandYear(): Promise<{ year: number; created: number }> {
  const currentYear = await getCurrentRowlandYear();
  const newYear = currentYear + 1;
  const supabase = getSupabaseClient();

  const { data: season, error: seasonError } = await supabase.from('seasons').select('year').eq('year', newYear).maybeSingle();
  if (seasonError) throw new Error(`Failed to check the ${newYear} season: ${seasonError.message}`);
  if (!season) throw new Error(`There's no ${newYear} season yet. Create it in Season Planning first.`);

  const current = await getAllRowlandComps(currentYear);
  const rows = current.map((c) => ({
    comp_id: c.compId,
    year: newYear,
    comp_name: c.compName,
    status: 'Not Started',
    num_teams: 0,
  }));
  if (rows.length > 0) {
    // One insert statement, so either all four are created or none is
    const { error } = await supabase.from('rowland_comps').insert(rows);
    if (error) throw new Error(`Failed to set up the ${newYear} Rowland Cup: ${error.message}`);
  }
  return { year: newYear, created: rows.length };
}

/** All Rowland competitions for a year (default: the current year). */
export async function getAllRowlandComps(year?: number): Promise<RowlandComp[]> {
  const resolvedYear = year !== undefined ? year : await getCurrentRowlandYear();
  return withJwtRetry(async () => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('rowland_comps').select('*').eq('year', resolvedYear);
    if (error) throw new Error(`Failed to fetch Rowland comps: ${error.message}`);
    return (data || []).map(mapCompRow);
  });
}

/** One Rowland competition for a year (default: the current year). */
export async function getRowlandComp(compId: RowlandCompId, year?: number): Promise<RowlandComp | null> {
  const resolvedYear = year !== undefined ? year : await getCurrentRowlandYear();
  return withJwtRetry(async () => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('rowland_comps')
      .select('*')
      .eq('comp_id', compId)
      .eq('year', resolvedYear)
      .maybeSingle();
    if (error) throw new Error(`Failed to fetch Rowland comp: ${error.message}`);
    return data ? mapCompRow(data) : null;
  });
}

/** Updates the current year's settings for a competition. */
export async function updateRowlandComp(
  compId: RowlandCompId,
  updates: Partial<Pick<RowlandComp, 'status' | 'numTeams' | 'prelimPlayBy' | 'r1PlayBy' | 'r2PlayBy' | 'qfPlayBy' | 'sfPlayBy' | 'fPlayBy'>>
): Promise<void> {
  const supabase = getSupabaseClient();
  const columnUpdates: Record<string, any> = {};
  if (updates.status !== undefined) columnUpdates.status = updates.status;
  if (updates.numTeams !== undefined) columnUpdates.num_teams = updates.numTeams;
  if (updates.prelimPlayBy !== undefined) columnUpdates.prelim_play_by = updates.prelimPlayBy;
  if (updates.r1PlayBy !== undefined) columnUpdates.r1_play_by = updates.r1PlayBy;
  if (updates.r2PlayBy !== undefined) columnUpdates.r2_play_by = updates.r2PlayBy;
  if (updates.qfPlayBy !== undefined) columnUpdates.qf_play_by = updates.qfPlayBy;
  if (updates.sfPlayBy !== undefined) columnUpdates.sf_play_by = updates.sfPlayBy;
  if (updates.fPlayBy !== undefined) columnUpdates.f_play_by = updates.fPlayBy;

  if (Object.keys(columnUpdates).length === 0) return;

  const year = await getCurrentRowlandYear();
  await withJwtRetry(async () => {
    const { error } = await supabase.from('rowland_comps').update(columnUpdates).eq('comp_id', compId).eq('year', year);
    if (error) throw new Error(`Failed to update Rowland comp ${compId}: ${error.message}`);
  });
}

// ============================================================================
// MATCHES — READ / WRITE
// ============================================================================

/** A competition's matches for a year (default: the current year). */
export async function getRowlandMatches(compId: RowlandCompId, year?: number): Promise<RowlandMatch[]> {
  const resolvedYear = year !== undefined ? year : await getCurrentRowlandYear();
  return withJwtRetry(async () => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('rowland_matches')
      .select('*')
      .eq('comp_id', compId)
      .eq('year', resolvedYear);
    if (error) throw new Error(`Failed to fetch Rowland matches: ${error.message}`);
    return sortMatches((data || []).map(mapMatchRow));
  });
}

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
    status?: RowlandMatch['status'];
    playedDate?: string | null;
    notes?: string;
    scoreSheetUrl?: string | null;
  }
): Promise<void> {
  const supabase = getSupabaseClient();
  const columnUpdates: Record<string, any> = {};

  if (updates.homeTeam !== undefined) {
    columnUpdates.home_club_name = updates.homeTeam?.clubName ?? null;
    columnUpdates.home_team_letter = updates.homeTeam?.teamLetter ?? '';
  }
  if (updates.awayTeam !== undefined) {
    columnUpdates.away_club_name = updates.awayTeam?.clubName ?? null;
    columnUpdates.away_team_letter = updates.awayTeam?.teamLetter ?? '';
  }
  if (updates.homePlayers !== undefined) columnUpdates.home_players = updates.homePlayers.filter(Boolean);
  if (updates.awayPlayers !== undefined) columnUpdates.away_players = updates.awayPlayers.filter(Boolean);
  if (updates.homeScore !== undefined) columnUpdates.home_score = updates.homeScore;
  if (updates.awayScore !== undefined) columnUpdates.away_score = updates.awayScore;
  if (updates.winnerSide !== undefined) columnUpdates.winner_side = updates.winnerSide;
  if (updates.status !== undefined) columnUpdates.status = updates.status;
  if (updates.playedDate !== undefined) columnUpdates.played_date = updates.playedDate;
  if (updates.notes !== undefined) columnUpdates.notes = updates.notes;
  if (updates.scoreSheetUrl !== undefined) columnUpdates.score_sheet_url = updates.scoreSheetUrl;

  if (Object.keys(columnUpdates).length === 0) return;

  // Match IDs repeat every year — only the current year's match can be changed
  const year = await getCurrentRowlandYear();
  await withJwtRetry(async () => {
    const { error } = await supabase
      .from('rowland_matches')
      .update(columnUpdates)
      .eq('comp_id', compId)
      .eq('year', year)
      .eq('match_id', matchId);
    if (error) throw new Error(`Failed to update Rowland match ${matchId}: ${error.message}`);
  });
}

// ============================================================================
// BRACKET SETUP
// ============================================================================

function buildMatchRow(
  compId: RowlandCompId,
  data: {
    matchId: string;
    round: RowlandRound;
    position: number;
    homeTeam: RowlandTeamRef | null;
    awayTeam: RowlandTeamRef | null;
    status: RowlandMatch['status'];
  }
) {
  return {
    comp_id: compId,
    match_id: data.matchId,
    round: data.round,
    position: data.position,
    home_club_name: data.homeTeam?.clubName ?? null,
    home_team_letter: data.homeTeam?.teamLetter ?? '',
    away_club_name: data.awayTeam?.clubName ?? null,
    away_team_letter: data.awayTeam?.teamLetter ?? '',
    status: data.status,
  };
}

/**
 * Create the initial R1 bracket for a competition.
 * teams: ordered array of RowlandTeamRef (seeded order). Odd team count gets a bye.
 * Clears any existing matches for this comp before writing.
 */
export async function setupRowlandBracket(
  compId: RowlandCompId,
  teams: RowlandTeamRef[]
): Promise<void> {
  const rows: ReturnType<typeof buildMatchRow>[] = [];
  const numMatches = Math.ceil(teams.length / 2);

  for (let i = 0; i < numMatches; i++) {
    const home = teams[i * 2] ?? null;
    const away = teams[i * 2 + 1] ?? null; // null = bye

    rows.push(buildMatchRow(compId, {
      matchId: `${compId}-R1-${i + 1}`,
      round: 'R1',
      position: i + 1,
      homeTeam: home,
      awayTeam: away,
      status: away === null ? 'Bye' : 'Pending',
    }));
  }

  // Pre-create placeholder rows for subsequent rounds
  const bracket = computeRowlandBracket(teams.length);
  for (const { round, matchCount } of bracket.rounds) {
    if (round === 'R1' || round === 'Prelim') continue;
    for (let i = 0; i < matchCount; i++) {
      rows.push(buildMatchRow(compId, {
        matchId: `${compId}-${round}-${i + 1}`,
        round,
        position: i + 1,
        homeTeam: null,
        awayTeam: null,
        status: 'Pending',
      }));
    }
  }

  // Only this year's matches are replaced — earlier years are never touched
  const year = await getCurrentRowlandYear();
  await withJwtRetry(async () => {
    const supabase = getSupabaseClient();
    const { error: deleteError } = await supabase.from('rowland_matches').delete().eq('comp_id', compId).eq('year', year);
    if (deleteError) throw new Error(`Failed to clear existing matches for ${compId}: ${deleteError.message}`);

    if (rows.length === 0) return;
    const { error } = await supabase.from('rowland_matches').insert(rows.map((r) => ({ ...r, year: year })));
    if (error) throw new Error(`Failed to create bracket for ${compId}: ${error.message}`);
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
  const bracket = computeRowlandBracket(numTeams);
  const rows: ReturnType<typeof buildMatchRow>[] = [];

  for (const { round, matchCount } of bracket.rounds) {
    if (round === 'Prelim') {
      // Create all P/2 preliminary slots as Pending.
      // byeCount byes will be mixed in at draw time by the committee.
      const totalSlots = matchCount + bracket.byeCount;
      for (let i = 0; i < totalSlots; i++) {
        rows.push(buildMatchRow(compId, {
          matchId: `${compId}-Prelim-${i + 1}`,
          round: 'Prelim', position: i + 1,
          homeTeam: null, awayTeam: null, status: 'Pending',
        }));
      }
    } else {
      for (let i = 0; i < matchCount; i++) {
        rows.push(buildMatchRow(compId, {
          matchId: `${compId}-${round}-${i + 1}`,
          round, position: i + 1,
          homeTeam: null, awayTeam: null, status: 'Pending',
        }));
      }
    }
  }

  // Only this year's matches are replaced — earlier years are never touched
  const year = await getCurrentRowlandYear();
  await withJwtRetry(async () => {
    const supabase = getSupabaseClient();
    const { error: deleteError } = await supabase.from('rowland_matches').delete().eq('comp_id', compId).eq('year', year);
    if (deleteError) throw new Error(`Failed to clear existing matches for ${compId}: ${deleteError.message}`);

    if (rows.length === 0) return;
    const { error } = await supabase.from('rowland_matches').insert(rows.map((r) => ({ ...r, year: year })));
    if (error) throw new Error(`Failed to create empty bracket for ${compId}: ${error.message}`);
  });
}

function winnerOf(match: RowlandMatch): RowlandTeamRef | null {
  if (match.status === 'Bye') return match.homeTeam;
  if (match.winnerSide === 1) return match.homeTeam;
  if (match.winnerSide === 2) return match.awayTeam;
  return null;
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

  const currentRoundIdx = ROWLAND_ROUND_ORDER.indexOf(match.round);
  if (currentRoundIdx < 0) return;

  const allMatches = await getRowlandMatches(compId);
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

// ============================================================================
// ROWLAND SETTINGS (message shown on the /rowland home page)
// ============================================================================

export async function getRowlandMessage(): Promise<string> {
  return withJwtRetry(async () => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('rowland_settings').select('value').eq('key', 'message').maybeSingle();
    if (error) throw new Error(`Failed to fetch Rowland message: ${error.message}`);
    return data?.value || '';
  });
}

export async function setRowlandMessage(message: string): Promise<void> {
  await withJwtRetry(async () => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('rowland_settings').upsert({ key: 'message', value: message });
    if (error) throw new Error(`Failed to save Rowland message: ${error.message}`);
  });
}
