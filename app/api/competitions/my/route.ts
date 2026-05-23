// app/api/competitions/my/route.ts
// GET — return the current user's full journey across all competitions they have entered.
//
// For each competition the user is in, returns every match they have played or
// are due to play (byes, wins, losses, pending), together with handicap data
// for themselves and their opponents so the client can show starting scores.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getAllCompetitions,
  getCompetitionMatches,
  getMemberInfoMap,
  COMP_SHEET_CONFIG,
} from '@/lib/competitions-sheets';
import { ROUND_ORDER } from '@/types/competitions';
import type { CompMatch, Competition, CompRound } from '@/types/competitions';

export type MyCompEntryStatus = 'active' | 'awaiting' | 'knocked-out' | 'winner';
export type CompPosition = 'Skip' | 'Lead' | 'No. 2' | null;

// One step in the user's journey through a competition (one match / bye).
export interface JourneyStep {
  round: CompRound;
  matchId: string;
  matchStatus: 'Pending' | 'Bye' | 'Won' | 'Lost' | 'WalkoverWon' | 'WalkoverLost';
  partners: { username: string; fullName: string; position: CompPosition }[];
  opponents: { username: string; fullName: string; position: CompPosition; handicap: number | null }[] | null;
  myScore: number | null;
  oppScore: number | null;
  playedDate: string | null;
  playByDate: string | null;
  // Handicap context
  myHandicap: number | null;
  myStartScore: number | null;   // score the user starts on (0 if opponent has lesser hcp)
  oppStartScore: number | null;  // score the opponent starts on (0 if user has lesser hcp)
  // Username of the member acting as marker for this match (empty string if not set; singles only)
  marker: string;
}

export interface ContactInfo {
  username: string;
  fullName: string;
  position: CompPosition;
  mobile?: string | null;
  email?: string | null;
}

export interface MyCompEntry {
  compId: string;
  displayName: string;
  compType: string;
  compStatus: string;
  compDescription: string | null;
  entryStatus: MyCompEntryStatus;
  round: string;
  isChallenger: boolean;
  myPosition: CompPosition;
  offerByDate: string | null;
  myHandicap: number | null;
  journey: JourneyStep[];
  match: {
    matchId: string;
    status: string;
    partners: ContactInfo[];
    opponents: ContactInfo[] | null;
    myScore: number | null;
    oppScore: number | null;
    playByDate: string | null;
    playedDate: string | null;
    won: boolean | null;
  } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function posLabel(idx: number, compType: string): CompPosition {
  if (compType === 'pairs') {
    if (idx === 0) return 'Skip';
    if (idx === 1) return 'Lead';
  }
  if (compType === 'triples') {
    if (idx === 0) return 'Skip';
    if (idx === 1) return 'No. 2';
    if (idx === 2) return 'Lead';
  }
  return null;
}

/** Return the play-by date for a given round from competition config. */
function playByForRound(comp: Competition, round: string): string | null {
  switch (round) {
    case 'Prelim': return comp.prelimPlayBy ?? null;
    case 'R1':     return comp.r1PlayBy ?? null;
    case 'R2':     return comp.r2PlayBy ?? null;
    case 'QF':     return comp.qfPlayBy ?? null;
    case 'SF':     return comp.sfPlayBy ?? null;
    default:       return null;
  }
}

function roundStartDate(comp: Competition, round: string): string | null {
  if (round === 'F') return null;

  const idx = ROUND_ORDER.indexOf(round as typeof ROUND_ORDER[number]);
  if (idx <= 0) return comp.compStartDate ?? null;

  // Walk back through previous rounds to find the most recent play-by date
  // (this is the start date for the current round, no compStartDate needed)
  for (let i = idx - 1; i >= 0; i--) {
    const pb = playByForRound(comp, ROUND_ORDER[i]);
    if (pb) return pb;
  }
  return comp.compStartDate ?? null;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Calculate starting scores given two handicaps.
 * The player with the lesser (lower) handicap starts with the difference.
 * Equal handicaps → both start on 0.
 * Either null → no starting scores.
 */
function calcStartScores(myHcp: number | null, oppHcp: number | null): { myStart: number | null; oppStart: number | null } {
  if (myHcp === null || oppHcp === null) return { myStart: null, oppStart: null };
  const diff = Math.abs(myHcp - oppHcp);
  if (myHcp < oppHcp)  return { myStart: diff, oppStart: 0 };
  if (oppHcp < myHcp)  return { myStart: 0,    oppStart: diff };
  return { myStart: 0, oppStart: 0 };
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = session.user.userName.toLowerCase();

    // Load all competitions and member name/handicap map in parallel
    const [competitions, memberMap] = await Promise.all([
      getAllCompetitions(),
      getMemberInfoMap(),
    ]);

    // Only scan comps that have started and have a sheet config
    const activeComps = competitions.filter(
      (c) => c.status !== 'Not Started' && COMP_SHEET_CONFIG[c.compId]
    );

    // Fetch all match sheets in parallel
    const matchResults = await Promise.all(
      activeComps.map((comp) =>
        getCompetitionMatches(comp.compId)
          .then((matches) => ({ compId: comp.compId, matches }))
          .catch(() => ({ compId: comp.compId, matches: [] as CompMatch[] }))
      )
    );

    const matchesByComp = new Map<string, CompMatch[]>();
    for (const { compId, matches } of matchResults) {
      matchesByComp.set(compId, matches);
    }

    const myInfo = memberMap.get(username);
    const myHandicapValue = myInfo?.handicap ?? null;

    const entries: MyCompEntry[] = [];

    for (const comp of activeComps) {
      // Handicap data is only relevant for the Handicap competition
      const isHandicapComp = comp.compId === 'handicap';
      const myHandicap = isHandicapComp ? myHandicapValue : null;

      const matches = matchesByComp.get(comp.compId) ?? [];

      // All matches where this user appears on either side
      const userMatches = matches.filter((m) => {
        const s1 = m.side1Usernames.map((u) => u.toLowerCase());
        const s2 = (m.side2Usernames ?? []).map((u) => u.toLowerCase());
        return s1.includes(username) || s2.includes(username);
      });

      if (userMatches.length === 0) continue;

      // ── Build full journey (ascending round order) ──────────────────────────
      const journeyMatches = [...userMatches].sort(
        (a, b) => ROUND_ORDER.indexOf(a.round) - ROUND_ORDER.indexOf(b.round)
      );

      const journey: JourneyStep[] = journeyMatches.map((m) => {
        const mySide = m.side1Usernames.map((u) => u.toLowerCase()).includes(username) ? 1 : 2;
        const myUsernames  = mySide === 1 ? m.side1Usernames : (m.side2Usernames ?? []);
        const oppUsernames = mySide === 1 ? (m.side2Usernames ?? []) : m.side1Usernames;

        const partners = myUsernames
          .map((u, idx) => ({ u, idx }))
          .filter(({ u }) => u.toLowerCase() !== username)
          .map(({ u, idx }) => ({
            username: u,
            fullName: memberMap.get(u.toLowerCase())?.fullName ?? u,
            position: posLabel(idx, comp.compType),
          }));

        const opponents =
          m.side2Usernames === null
            ? null
            : oppUsernames.map((u, idx) => ({
                username: u,
                fullName: memberMap.get(u.toLowerCase())?.fullName ?? u,
                position: posLabel(idx, comp.compType),
                handicap: isHandicapComp ? (memberMap.get(u.toLowerCase())?.handicap ?? null) : null,
              }));

        // Use the first opponent's handicap for the starting score calculation
        // (the skip for pairs/triples, the sole player for singles).
        const oppHcpForCalc = opponents?.[0]?.handicap ?? null;
        const { myStart, oppStart } = calcStartScores(myHandicap, oppHcpForCalc);

        let matchStatus: JourneyStep['matchStatus'];
        if (m.status === 'Bye') {
          matchStatus = 'Bye';
        } else if (m.status === 'Pending') {
          matchStatus = 'Pending';
        } else {
          const iWon = m.winnerSide === mySide;
          matchStatus = m.status === 'Walkover'
            ? (iWon ? 'WalkoverWon' : 'WalkoverLost')
            : (iWon ? 'Won' : 'Lost');
        }

        return {
          round: m.round,
          matchId: m.matchId,
          matchStatus,
          partners,
          opponents,
          myScore:    (mySide === 1 ? m.score1 : m.score2) ?? null,
          oppScore:   (mySide === 1 ? m.score2 : m.score1) ?? null,
          playedDate: m.playedDate ?? null,
          playByDate: m.playByDate ?? null,
          myHandicap,
          myStartScore:  myStart,
          oppStartScore: oppStart,
          // Pass the marker username through for display and editing on the my-competitions page
          marker: m.marker || '',
        };
      });

      // ── Determine overall entry status (same logic as before) ───────────────
      const sorted = [...userMatches].sort(
        (a, b) => ROUND_ORDER.indexOf(b.round) - ROUND_ORDER.indexOf(a.round)
      );

      const pendingMatch    = userMatches.find((m) => m.status === 'Pending');
      const latestCompleted = sorted.find(
        (m) => m.status === 'Complete' || m.status === 'Walkover'
      );

      let entryStatus: MyCompEntryStatus;
      let relevantMatch: CompMatch;

      if (pendingMatch) {
        entryStatus    = 'active';
        relevantMatch  = pendingMatch;
      } else if (latestCompleted) {
        const mySide = latestCompleted.side1Usernames
          .map((u) => u.toLowerCase())
          .includes(username) ? 1 : 2;
        const iWon = latestCompleted.winnerSide === mySide;

        if (iWon && latestCompleted.round === 'F') {
          entryStatus = 'winner';
        } else if (iWon) {
          entryStatus = 'awaiting';
        } else {
          entryStatus = 'knocked-out';
        }
        relevantMatch = latestCompleted;
      } else {
        entryStatus   = 'awaiting';
        relevantMatch = sorted[0];
      }

      const mySide = relevantMatch.side1Usernames
        .map((u) => u.toLowerCase())
        .includes(username) ? 1 : 2;

      const myUsernames  = mySide === 1 ? relevantMatch.side1Usernames : (relevantMatch.side2Usernames ?? []);
      const oppUsernames = mySide === 1 ? (relevantMatch.side2Usernames ?? []) : relevantMatch.side1Usernames;

      const myIndex      = myUsernames.findIndex((u) => u.toLowerCase() === username);
      const isChallenger = mySide === 1;
      const myPosition   = posLabel(myIndex, comp.compType);

      const roundStart  = roundStartDate(comp, relevantMatch.round);
      const offerByDate = entryStatus === 'active' && isChallenger && roundStart
        ? addDays(roundStart, 7)
        : null;

      const partners = myUsernames
        .map((u, idx) => ({ u, idx }))
        .filter(({ u }) => u.toLowerCase() !== username)
        .map(({ u, idx }) => {
          const info = memberMap.get(u.toLowerCase());
          return {
            username: u,
            fullName: info?.fullName ?? u,
            position: posLabel(idx, comp.compType),
            mobile: info?.mobile ?? null,
            email: info?.email ?? null,
          };
        });

      const opponents =
        relevantMatch.side2Usernames === null
          ? null
          : oppUsernames.map((u, idx) => {
              const info = memberMap.get(u.toLowerCase());
              return {
                username: u,
                fullName: info?.fullName ?? u,
                position: posLabel(idx, comp.compType),
                mobile: info?.mobile ?? null,
                email: info?.email ?? null,
              };
            });

      entries.push({
        compId:          comp.compId,
        displayName:     comp.displayName,
        compType:        comp.compType,
        compStatus:      comp.status,
        compDescription: comp.compDescription ?? null,
        entryStatus,
        round:           relevantMatch.round,
        isChallenger,
        myPosition,
        offerByDate,
        myHandicap,
        journey,
        match: {
          matchId:    relevantMatch.matchId,
          status:     relevantMatch.status,
          partners,
          opponents,
          myScore:    (mySide === 1 ? relevantMatch.score1 : relevantMatch.score2) ?? null,
          oppScore:   (mySide === 1 ? relevantMatch.score2 : relevantMatch.score1) ?? null,
          playByDate: relevantMatch.playByDate ?? null,
          playedDate: relevantMatch.playedDate ?? null,
          won:
            relevantMatch.status === 'Pending' || relevantMatch.status === 'Bye'
              ? null
              : relevantMatch.winnerSide === mySide,
        },
      });
    }

    // Sort: active first, then awaiting, knocked-out, winner
    const ORDER: MyCompEntryStatus[] = ['active', 'awaiting', 'winner', 'knocked-out'];
    entries.sort((a, b) => ORDER.indexOf(a.entryStatus) - ORDER.indexOf(b.entryStatus));

    // Build the playing members list for the marker dropdown.
    // Only Playing Men and Playing Ladies are eligible to act as markers.
    // We reuse the memberMap already loaded above — no additional API call needed.
    const playingMembers: { username: string; fullName: string }[] = [];
    for (const [, info] of memberMap.entries()) {
      // Include only active playing members (PL = Playing Lady, PM = Playing Man in member type)
      if (info.memberType === 'Playing Man' || info.memberType === 'Playing Lady') {
        playingMembers.push({ username: info.username, fullName: info.fullName });
      }
    }
    // Sort alphabetically by full name for the dropdown
    playingMembers.sort((a, b) => a.fullName.localeCompare(b.fullName));

    return NextResponse.json({ entries, playingMembers });
  } catch (error) {
    console.error('[competitions/my] GET error:', error);
    return NextResponse.json({ error: 'Failed to load your competitions' }, { status: 500 });
  }
}
