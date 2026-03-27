// app/api/competitions/[compId]/matches/[matchId]/route.ts
// PATCH /api/competitions/[compId]/matches/[matchId]
// Update a match result: score, walkover, or player substitution.
//
// Permissions:
//   - Any member in the match can submit a score or walkover.
//   - Committee can update any pending match.
//   - Only committee can record a substitution (side1Usernames / side2Usernames change).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompetitionMatches, updateMatch, propagateWinnerToNextRound } from '@/lib/competitions-sheets';
import { hasRole } from '@/lib/role-utils';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ compId: string; matchId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { compId, matchId } = await params;
    const committee = hasRole(session.user.role, 'Captain', 'Admin');
    const currentUsername = session.user.userName;

    // Load the current match to check permissions
    const matches = await getCompetitionMatches(compId);
    const match = matches.find((m) => m.matchId === matchId);

    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    }

    if (match.status !== 'Pending') {
      return NextResponse.json(
        { error: 'Match is already completed' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { score1, score2, winnerSide, status, playedDate, side1Usernames, side2Usernames, playByDate } = body;

    // Substitution is committee-only
    if ((side1Usernames || side2Usernames) && !committee) {
      return NextResponse.json(
        { error: 'Only committee can record substitutions' },
        { status: 403 }
      );
    }

    // For non-committee, check they are actually in the match
    if (!committee) {
      const allInMatch = [
        ...match.side1Usernames,
        ...(match.side2Usernames ?? []),
      ].map((u) => u.toLowerCase());

      if (!allInMatch.includes(currentUsername.toLowerCase())) {
        return NextResponse.json(
          { error: 'You are not a participant in this match' },
          { status: 403 }
        );
      }
    }

    // Validate score entry
    if (status === 'Complete') {
      if (score1 == null || score2 == null) {
        return NextResponse.json({ error: 'score1 and score2 are required' }, { status: 400 });
      }
      if (score1 < 0 || score2 < 0) {
        return NextResponse.json({ error: 'Scores cannot be negative' }, { status: 400 });
      }
      if (score1 === score2) {
        return NextResponse.json({ error: 'Scores cannot be equal — there must be a winner' }, { status: 400 });
      }
    }

    // Validate walkover
    if (status === 'Walkover' && winnerSide !== 1 && winnerSide !== 2) {
      return NextResponse.json({ error: 'winnerSide (1 or 2) is required for walkover' }, { status: 400 });
    }

    const today = new Date().toISOString().split('T')[0];

    // Determine the winner side before writing (needed for propagation)
    let resolvedWinnerSide: 1 | 2 | undefined;
    if (status === 'Complete') resolvedWinnerSide = score1 > score2 ? 1 : 2;
    if (status === 'Walkover') resolvedWinnerSide = winnerSide;

    await updateMatch(compId, matchId, {
      ...(status === 'Complete' && {
        score1,
        score2,
        winnerSide: resolvedWinnerSide,
        status: 'Complete',
        playedDate: playedDate || today,
      }),
      ...(status === 'Walkover' && {
        winnerSide: resolvedWinnerSide,
        status: 'Walkover',
        playedDate: playedDate || today,
      }),
      ...(side1Usernames !== undefined && { side1Usernames }),
      ...(side2Usernames !== undefined && { side2Usernames }),
      ...(playByDate !== undefined && { playByDate }),
    });

    // Propagate winner into the next round's placeholder match
    if (resolvedWinnerSide && (status === 'Complete' || status === 'Walkover')) {
      try {
        await propagateWinnerToNextRound(compId, match, resolvedWinnerSide);
      } catch (err) {
        // Non-fatal: log but don't fail the request (bracket still shows correct scores)
        console.error('[propagateWinner] Error:', err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/competitions/[compId]/matches/[matchId]] Error:', error);
    return NextResponse.json({ error: 'Failed to update match' }, { status: 500 });
  }
}
