// src/types/leagues.ts
// Type definitions for the Club Leagues system

export type LeagueType = 'triples' | 'pairs';
export type LeagueStatus = 'Not Started' | 'Entries Open' | 'In Progress' | 'Complete';
export type LeagueMatchStatus = 'Scheduled' | 'Played' | 'Walkover' | 'Cancelled';
export type TriplePosition = 'Skip' | 'Lead' | 'Two';
export type PairsPosition = 'Skip' | 'Lead';
export type SquadPosition = TriplePosition | PairsPosition | '';

export const LEAGUE_POSITIONS: Record<LeagueType, SquadPosition[]> = {
  triples: ['Skip', 'Lead', 'Two'],
  pairs:   ['Skip', 'Lead'],
};

export interface League {
  leagueId: string;
  name: string;
  type: LeagueType;
  season: string;
  status: LeagueStatus;
  squadSize: number;    // 6 for triples, 4 for pairs
  playersPerMatch: number; // 3 for triples, 2 for pairs
}

export interface LeagueTeam {
  teamId: string;
  leagueId: string;
  teamName: string;
}

export interface LeagueSquadMember {
  rowNumber: number;
  leagueId: string;
  teamId: string;       // blank if unassigned
  username: string;
  fullName: string;     // looked up from Members sheet
  position: SquadPosition;
  enteredDate: string;
}

export interface LeagueMatch {
  matchId: string;
  leagueId: string;
  matchday: number;
  homeTeamId: string;
  awayTeamId: string;
  scheduledDate: string | null;  // YYYY-MM-DD — used for triples
  scheduledTime: string | null;  // HH:MM — used for triples
  playByDate: string | null;     // YYYY-MM-DD — used for pairs
  homeScore: number | null;
  awayScore: number | null;
  status: LeagueMatchStatus;
}

export interface LeagueTableRow {
  teamId: string;
  teamName: string;
  played: number;
  won: number;
  drew: number;
  lost: number;
  shotsFor: number;
  shotsAgainst: number;
  shotDiff: number;
  points: number;
}

/** Calculate the league table from a list of played/walkover matches and teams. */
export function calculateTable(teams: LeagueTeam[], matches: LeagueMatch[]): LeagueTableRow[] {
  const map = new Map<string, LeagueTableRow>();
  for (const t of teams) {
    map.set(t.teamId, {
      teamId: t.teamId, teamName: t.teamName,
      played: 0, won: 0, drew: 0, lost: 0,
      shotsFor: 0, shotsAgainst: 0, shotDiff: 0, points: 0,
    });
  }

  for (const m of matches) {
    if (m.status !== 'Played' && m.status !== 'Walkover') continue;
    if (m.homeScore === null || m.awayScore === null) continue;
    const home = map.get(m.homeTeamId);
    const away = map.get(m.awayTeamId);
    if (!home || !away) continue;

    home.played++; away.played++;
    home.shotsFor  += m.homeScore; home.shotsAgainst += m.awayScore;
    away.shotsFor  += m.awayScore; away.shotsAgainst += m.homeScore;

    if (m.homeScore > m.awayScore) {
      home.won++; home.points += 2; away.lost++;
    } else if (m.awayScore > m.homeScore) {
      away.won++; away.points += 2; home.lost++;
    } else {
      home.drew++; home.points += 1; away.drew++; away.points += 1;
    }
  }

  for (const row of map.values()) {
    row.shotDiff = row.shotsFor - row.shotsAgainst;
  }

  return Array.from(map.values()).sort((a, b) =>
    b.points - a.points || b.shotDiff - a.shotDiff || b.shotsFor - a.shotsFor || a.teamName.localeCompare(b.teamName)
  );
}

/**
 * Generate a double round-robin fixture list (home and away legs) for a given
 * array of team IDs.  The first half uses standard rotation; the second half
 * swaps home and away.
 */
export function generateRoundRobin(teamIds: string[]): { matchday: number; homeTeamId: string; awayTeamId: string }[] {
  const ids = [...teamIds];
  if (ids.length % 2 !== 0) ids.push('__bye__'); // dummy for odd number
  const n = ids.length;
  const rounds = n - 1;
  const firstLeg: { matchday: number; homeTeamId: string; awayTeamId: string }[] = [];

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < n / 2; i++) {
      const home = ids[i];
      const away = ids[n - 1 - i];
      if (home !== '__bye__' && away !== '__bye__') {
        firstLeg.push({ matchday: round + 1, homeTeamId: home, awayTeamId: away });
      }
    }
    // Rotate: fix ids[0], rotate ids[1..n-1]
    const last = ids.pop()!;
    ids.splice(1, 0, last);
  }

  // Second leg: swap home/away, offset matchday by number of first-leg rounds
  const secondLeg = firstLeg.map((f) => ({
    matchday: f.matchday + rounds,
    homeTeamId: f.awayTeamId,
    awayTeamId: f.homeTeamId,
  }));

  return [...firstLeg, ...secondLeg];
}
