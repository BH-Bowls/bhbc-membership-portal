// app/api/rowland/[compId]/matches/[matchId]/route.ts
// PATCH — update players, score, status for a match

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getRowlandMatches,
  updateRowlandMatch,
  propagateRowlandWinnerForMatch,
} from '@/lib/rowland-sheets';
import type { RowlandCompId } from '@/types/rowland';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ compId: string; matchId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const BHBC_CLUB_ID = 'burgess.hill';

    const role = session.user.role;
    const roles = role ? role.split(',').map((r: string) => r.trim()) : [];
    const isClub = role === 'Club';
    const isRowlandPlayer = roles.includes('RowlandPlayer');
    // RowlandPlayer acts like a club (restricted to BHBC matches)
    const isCommittee = !isClub && !isRowlandPlayer && role !== 'Member' && role !== '';

    if (!isCommittee && !isClub && !isRowlandPlayer) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { compId, matchId } = await params;
    const body = await req.json();

    // Team assignment is committee-only
    if ((body.homeTeam !== undefined || body.awayTeam !== undefined) && !isCommittee) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // For clubs and RowlandPlayer, verify their club is a participant in the match
    if (isClub || isRowlandPlayer) {
      const clubId = isRowlandPlayer ? BHBC_CLUB_ID : session.user.clubId;
      const matches = await getRowlandMatches(compId as RowlandCompId);
      const match = matches.find((m) => m.matchId === matchId);
      if (!match) {
        return NextResponse.json({ error: 'Match not found' }, { status: 404 });
      }
      if (match.homeTeam?.clubId !== clubId && match.awayTeam?.clubId !== clubId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    await updateRowlandMatch(compId as RowlandCompId, matchId, body);

    // Propagate winner to the next round placeholder when a result is determined
    const shouldPropagate =
      body.status === 'Played' ||
      body.status === 'Walkover' ||
      body.status === 'Bye';

    if (shouldPropagate) {
      try {
        const allMatches = await getRowlandMatches(compId as RowlandCompId);
        const updatedMatch = allMatches.find((m) => m.matchId === matchId);
        if (updatedMatch) {
          await propagateRowlandWinnerForMatch(compId as RowlandCompId, updatedMatch);
        }
      } catch (err) {
        // Non-fatal: log but don't fail the request
        console.error('[rowland/propagate] Error:', err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[rowland/matches/matchId] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update match' }, { status: 500 });
  }
}
