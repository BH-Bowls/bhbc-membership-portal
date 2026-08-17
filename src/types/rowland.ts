// src/types/rowland.ts
// Type definitions for the Rowland Cup system

export type RowlandCompId = 'edward-a' | 'edward-b' | 'gladys-a' | 'gladys-b';
export type RowlandRound = 'Prelim' | 'R1' | 'R2' | 'QF' | 'SF' | 'F';
export type RowlandMatchStatus = 'Pending' | 'Played' | 'Walkover' | 'Bye';
export type RowlandCompStatus = 'Not Started' | 'Draw Done' | 'In Progress' | 'Complete';

export const ROWLAND_COMP_NAMES: Record<RowlandCompId, string> = {
  'edward-a': 'Edward A',
  'edward-b': 'Edward B',
  'gladys-a': 'Gladys A',
  'gladys-b': 'Gladys B',
};

export const ROWLAND_ROUND_LABELS: Record<RowlandRound, string> = {
  Prelim: 'Preliminary',
  R1: 'Round 1',
  R2: 'Round 2',
  QF: 'Quarter Final',
  SF: 'Semi Final',
  F: 'Final',
};

export const ROWLAND_ROUND_ORDER: RowlandRound[] = ['Prelim', 'R1', 'R2', 'QF', 'SF', 'F'];

/** Maps compId to the Google Sheet tab name */
export const ROWLAND_SHEET_NAMES: Record<RowlandCompId, string> = {
  'edward-a': 'Rowland_edward-a',
  'edward-b': 'Rowland_edward-b',
  'gladys-a': 'Rowland_gladys-a',
  'gladys-b': 'Rowland_gladys-b',
};

/** BHBC's own entry in club_profiles.club_name — used to identify "our" matches. */
export const BHBC_CLUB_NAME = 'Burgess Hill';

/**
 * A club team entry in a Rowland competition. club_name is the sole identifier
 * (matches how clubs are identified everywhere else post club-login-removal — see
 * specs/Phase_0_1_Migration_Plan.md's Rowland redesign section).
 * teamLetter is 'A' or 'B' for clubs entering two teams, or '' for single entry.
 * The display name is typically "Club Name" or "Club Name A" / "Club Name B".
 */
export interface RowlandTeamRef {
  clubName: string;
  teamLetter: string;
}

export function rowlandTeamDisplayName(team: RowlandTeamRef): string {
  return team.teamLetter ? `${team.clubName} ${team.teamLetter}` : team.clubName;
}

/**
 * A single match in a Rowland Cup bracket.
 * position is 1-indexed within the round.
 * homeTeam is the "lead" team (hosts, offers dates).
 * awayTeam is null for a bye.
 * Players are free-text names (not usernames) — entered by the club or BHBC.
 * winnerSide: 1 = home won, 2 = away won.
 */
export interface RowlandMatch {
  matchId: string;
  round: RowlandRound;
  position: number;

  homeTeam: RowlandTeamRef | null; // null = TBD (not yet drawn)
  awayTeam: RowlandTeamRef | null; // null = TBD or bye

  homePlayers: string[]; // up to 4 player names
  awayPlayers: string[]; // up to 4 player names

  homeScore: number | null;
  awayScore: number | null;
  winnerSide: 1 | 2 | null;

  status: RowlandMatchStatus;
  playByDate: string | null; // YYYY-MM-DD
  playedDate: string | null; // YYYY-MM-DD
  notes: string;
  scoreSheetUrl: string | null; // Google Drive URL of uploaded score sheet image
}

/**
 * Rowland Cup competition metadata (from RowlandControl sheet).
 */
export interface RowlandComp {
  compId: RowlandCompId;
  compName: string;
  season: string;    // e.g. "2025-26"
  status: RowlandCompStatus;
  numTeams: number;  // number of entered teams (determines bracket size)

  // Play-by dates per round
  prelimPlayBy: string | null;
  r1PlayBy: string | null;
  r2PlayBy: string | null;
  qfPlayBy: string | null;
  sfPlayBy: string | null;
  fPlayBy: string | null;
}

// ============================================================================
// BRACKET MATH
// ============================================================================
// Pure, no I/O — shared by both rowland-sheets.ts (kept for migration tooling) and
// rowland-supabase.ts (the live data layer) rather than duplicated between them.

export interface BracketRound { round: RowlandRound; matchCount: number; }

export interface RowlandBracketInfo {
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
