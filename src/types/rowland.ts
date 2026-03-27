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

/**
 * A club team entry in a Rowland competition.
 * teamLetter is 'A' or 'B' for clubs entering two teams, or '' for single entry.
 * The display name is typically "Club Name" or "Club Name A" / "Club Name B".
 */
export interface RowlandTeamRef {
  clubId: string;
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
