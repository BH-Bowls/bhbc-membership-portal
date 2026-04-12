// src/types/competitions.ts
// Type definitions for the Competitions system

export type CompType = 'singles' | 'pairs' | 'triples';
export type CompRound = 'Prelim' | 'R1' | 'R2' | 'QF' | 'SF' | 'F';
export type MatchStatus = 'Pending' | 'Complete' | 'Walkover' | 'Bye';
export type CompStatus = 'Not Started' | 'Draw Done' | 'In Progress' | 'Complete';

export const COMP_ROUND_LABELS: Record<CompRound, string> = {
  Prelim: 'Preliminary',
  R1: 'Round 1',
  R2: 'Round 2',
  QF: 'Quarter Final',
  SF: 'Semi Final',
  F: 'Final',
};

export const ROUND_ORDER: CompRound[] = ['Prelim', 'R1', 'R2', 'QF', 'SF', 'F'];

/**
 * A single match in a competition bracket.
 * Usernames are stored; names are looked up from the Members sheet.
 * position is 1-indexed within the round.
 * winner_side is 1 or 2 (which team/player won).
 * Bracket progression: winner of (round, position N) feeds into (next_round, ceil(N/2)).
 */
export interface CompMatch {
  matchId: string;
  round: CompRound;
  position: number;

  // Singles: one username per side
  // Pairs: [skip, lead] per side
  // Triples: [skip, no2, lead] per side
  side1Usernames: string[];
  side2Usernames: string[] | null; // null = bye

  score1?: number | null;
  score2?: number | null;
  winnerSide?: 1 | 2 | null;
  status: MatchStatus;

  playByDate?: string | null;
  playedDate?: string | null;
  scoreSheetUrl?: string | null;
}

/**
 * Competition configuration (from Control sheet)
 */
export interface Competition {
  compId: string;
  displayName: string;
  compType: CompType;
  status: CompStatus;
  year: number;
  finalsDate?: string | null;

  // Play-by dates per round
  prelimPlayBy?: string | null;
  r1PlayBy?: string | null;
  r2PlayBy?: string | null;
  qfPlayBy?: string | null;
  sfPlayBy?: string | null;

  // Triples day (fixed date for first games)
  triplesFixedDay?: boolean;
  triplesFixedDate?: string | null;

  // Side count recorded when the bracket was last created/rebuilt
  drawSideCount?: number | null;

  // When the competition starts (first round start date).
  // Challenger must offer 3 dates within 7 days. Subsequent round starts are
  // derived from the previous round's play-by date.
  // Leave blank for Triples (first round is a fixed day) or Finals-only comps.
  compStartDate?: string | null;

  // Short description shown to members, e.g. "Singles, play to 21 points"
  compDescription?: string | null;
}

/**
 * Member info enriched for display (username + looked-up name + handicap)
 */
export interface CompMemberInfo {
  username: string;
  fullName: string;
  handicap?: number | null;
  memberType?: string;
  mobile?: string | null;
  email?: string | null;
}
