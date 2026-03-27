// app/api/competitions/my/route.ts
// GET — return the current user's status and pending match across all competitions
//
// Loads all competition match sheets in parallel (one read per sheet),
// then filters for matches containing the current user's username.

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
import type { CompMatch, Competition } from '@/types/competitions';

export type MyCompEntryStatus = 'active' | 'awaiting' | 'knocked-out' | 'winner';

export type CompPosition = 'Skip' | 'Lead' | 'No. 2' | null;

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
  match: {
    matchId: string;
    status: string;
    partners: { username: string; fullName: string; position: CompPosition }[];
    opponents: { username: string; fullName: string; position: CompPosition }[] | null;
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

/**
 * Return the date from which the 7-day offer window runs for a given round.
 * - Final: never needs an offer (returns null)
 * - No compStartDate set: no offer needed (returns null — e.g. Triples first round)
 * - First round: compStartDate
 * - Subsequent rounds: play-by date of the nearest previous round that has one
 */
function roundStartDate(comp: Competition, round: string): string | null {
  if (round === 'F') return null;
  if (!comp.compStartDate) return null;

  const idx = ROUND_ORDER.indexOf(round as typeof ROUND_ORDER[number]);
  if (idx <= 0) return comp.compStartDate;

  for (let i = idx - 1; i >= 0; i--) {
    const pb = playByForRound(comp, ROUND_ORDER[i]);
    if (pb) return pb;
  }
  return comp.compStartDate;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = session.user.userName.toLowerCase();

    // Load all competitions and member name map in parallel
    const [competitions, memberMap] = await Promise.all([
      getAllCompetitions(),
      getMemberInfoMap(),
    ]);

    // Only scan comps that have started and have a sheet config
    const activeComps = competitions.filter(
      (c) => c.status !== 'Not Started' && COMP_SHEET_CONFIG[c.compId]
    );

    // Fetch all match sheets in parallel — non-fatal per-comp errors
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

    const entries: MyCompEntry[] = [];

    for (const comp of activeComps) {
      const matches = matchesByComp.get(comp.compId) ?? [];

      // Matches where this user appears on either side
      const userMatches = matches.filter((m) => {
        const s1 = m.side1Usernames.map((u) => u.toLowerCase());
        const s2 = (m.side2Usernames ?? []).map((u) => u.toLowerCase());
        return s1.includes(username) || s2.includes(username);
      });

      if (userMatches.length === 0) continue;

      // Sort matches by round depth, furthest first
      const sorted = [...userMatches].sort(
        (a, b) => ROUND_ORDER.indexOf(b.round) - ROUND_ORDER.indexOf(a.round)
      );

      const pendingMatch = userMatches.find((m) => m.status === 'Pending');
      const latestCompleted = sorted.find(
        (m) => m.status === 'Complete' || m.status === 'Walkover'
      );

      let entryStatus: MyCompEntryStatus;
      let relevantMatch: CompMatch;

      if (pendingMatch) {
        entryStatus = 'active';
        relevantMatch = pendingMatch;
      } else if (latestCompleted) {
        const mySide = latestCompleted.side1Usernames
          .map((u) => u.toLowerCase())
          .includes(username)
          ? 1
          : 2;
        const iWon = latestCompleted.winnerSide === mySide;

        if (iWon && latestCompleted.round === 'F') {
          entryStatus = 'winner';
        } else if (iWon) {
          // Won but next round placeholder not yet set up
          entryStatus = 'awaiting';
        } else {
          entryStatus = 'knocked-out';
        }
        relevantMatch = latestCompleted;
      } else {
        // Only bye matches — advancing but next round pending
        entryStatus = 'awaiting';
        relevantMatch = sorted[0];
      }

      // Which side is the user on?
      const mySide = relevantMatch.side1Usernames
        .map((u) => u.toLowerCase())
        .includes(username)
        ? 1
        : 2;

      const myUsernames =
        mySide === 1 ? relevantMatch.side1Usernames : (relevantMatch.side2Usernames ?? []);
      const oppUsernames =
        mySide === 1 ? (relevantMatch.side2Usernames ?? []) : relevantMatch.side1Usernames;

      const myIndex = myUsernames.findIndex((u) => u.toLowerCase() === username);
      const isChallenger = mySide === 1;
      const myPosition = posLabel(myIndex, comp.compType);

      const roundStart = roundStartDate(comp, relevantMatch.round);
      const offerByDate =
        entryStatus === 'active' && isChallenger && roundStart
          ? addDays(roundStart, 7)
          : null;

      const partners = myUsernames
        .map((u, idx) => ({ u, idx }))
        .filter(({ u }) => u.toLowerCase() !== username)
        .map(({ u, idx }) => ({
          username: u,
          fullName: memberMap.get(u.toLowerCase())?.fullName ?? u,
          position: posLabel(idx, comp.compType),
        }));

      const opponents =
        relevantMatch.side2Usernames === null
          ? null
          : oppUsernames.map((u, idx) => ({
              username: u,
              fullName: memberMap.get(u.toLowerCase())?.fullName ?? u,
              position: posLabel(idx, comp.compType),
            }));

      const myScore = (mySide === 1 ? relevantMatch.score1 : relevantMatch.score2) ?? null;
      const oppScore = (mySide === 1 ? relevantMatch.score2 : relevantMatch.score1) ?? null;

      entries.push({
        compId: comp.compId,
        displayName: comp.displayName,
        compType: comp.compType,
        compStatus: comp.status,
        compDescription: comp.compDescription ?? null,
        entryStatus,
        round: relevantMatch.round,
        isChallenger,
        myPosition,
        offerByDate,
        match: {
          matchId: relevantMatch.matchId,
          status: relevantMatch.status,
          partners,
          opponents,
          myScore,
          oppScore,
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

    return NextResponse.json({ entries });
  } catch (error) {
    console.error('[competitions/my] GET error:', error);
    return NextResponse.json({ error: 'Failed to load your competitions' }, { status: 500 });
  }
}
