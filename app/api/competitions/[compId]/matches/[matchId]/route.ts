// app/api/competitions/[compId]/matches/[matchId]/route.ts
// PATCH /api/competitions/[compId]/matches/[matchId]
// Update a match result: score, walkover, player substitution, planned date, or marker.
//
// Permissions:
//   - Captain / Admin (committee): full update — score, walkover, substitution, play-by date, marker
//   - Member who is a player in the match: playedDate and/or marker only (Pending status only)
//   - Any other authenticated member: rejected

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompetitionMatches, updateMatch, propagateWinnerToNextRound, getMemberInfoMap, getNextRoundMatch, resetMatch } from '@/lib/competitions-sheets';
import { clearDiaryCache } from '@/lib/home-cache';
import { hasRole } from '@/lib/role-utils';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ compId: string; matchId: string }> }
) {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { compId, matchId } = await params;

    // Determine whether the user is a committee member (Captain or Admin)
    const committee = hasRole(session.user.role, 'Captain', 'Admin');
    const currentUsername = session.user.userName;

    // Load all matches for this competition so we can find the target
    const matches = await getCompetitionMatches(compId);

    // Find the specific match by its unique ID
    let match = null;
    for (let i = 0; i < matches.length; i++) {
      if (matches[i].matchId === matchId) {
        match = matches[i];
        break;
      }
    }

    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    }

    const body = await request.json();

    // ── Already-completed match: only "correct" or "reset" actions are allowed ──
    // Everything else is rejected (a normal save can't touch a finished match).
    if (match.status !== 'Pending') {
      const action = body.action;

      // RESET (blank) — Admin only. Clears the result and removes the side it fed
      // into the next round. Guarded: refuse if that next match has already been
      // played (the admin must reset the later round first — deepest-first unwind).
      if (action === 'reset') {
        if (!hasRole(session.user.role, 'Admin')) {
          return NextResponse.json({ error: 'Only an Admin can blank a match' }, { status: 403 });
        }
        const nextMatch = await getNextRoundMatch(compId, match, matches);
        if (nextMatch && (nextMatch.status === 'Complete' || nextMatch.status === 'Walkover')) {
          return NextResponse.json(
            { error: 'The next-round match has already been played. Reset that round first.' },
            { status: 409 }
          );
        }
        await resetMatch(compId, match);
        clearDiaryCache(currentUsername);
        return NextResponse.json({ success: true });
      }

      // CORRECT — committee. Amend the score/winner of a finished match. A pure score
      // fix that keeps the same winner is always allowed. A fix that changes who
      // advances is only allowed while the next-round match is still unplayed.
      if (action === 'correct') {
        if (!committee) {
          return NextResponse.json({ error: 'Only committee can correct a result' }, { status: 403 });
        }

        const { score1, score2, winnerSide, status: newStatus, playedDate, marker } = body;

        // Resolve the corrected winner from the new score / walkover
        let newWinnerSide: 1 | 2;
        if (newStatus === 'Complete') {
          if (score1 == null || score2 == null) {
            return NextResponse.json({ error: 'score1 and score2 are required' }, { status: 400 });
          }
          if (score1 < 0 || score2 < 0) {
            return NextResponse.json({ error: 'Scores cannot be negative' }, { status: 400 });
          }
          if (score1 === score2) {
            return NextResponse.json({ error: 'Scores cannot be equal — there must be a winner' }, { status: 400 });
          }
          newWinnerSide = score1 > score2 ? 1 : 2;
        } else if (newStatus === 'Walkover') {
          if (winnerSide !== 1 && winnerSide !== 2) {
            return NextResponse.json({ error: 'winnerSide (1 or 2) is required for walkover' }, { status: 400 });
          }
          newWinnerSide = winnerSide;
        } else {
          return NextResponse.json({ error: 'A correction must supply a Complete or Walkover result' }, { status: 400 });
        }

        // Guardrail: if the winner changes, the next-round match must not be played yet
        const winnerChanges = newWinnerSide !== match.winnerSide;
        if (winnerChanges) {
          const nextMatch = await getNextRoundMatch(compId, match, matches);
          if (nextMatch && (nextMatch.status === 'Complete' || nextMatch.status === 'Walkover')) {
            return NextResponse.json(
              { error: 'This correction changes who goes through, but the next-round match has already been played. Reset that round first.' },
              { status: 409 }
            );
          }
        }

        // Write the corrected result
        const correctToday = new Date().toISOString().split('T')[0];
        if (newStatus === 'Complete') {
          await updateMatch(compId, matchId, {
            score1,
            score2,
            winnerSide: newWinnerSide,
            status: 'Complete',
            playedDate: playedDate || match.playedDate || correctToday,
            ...(marker !== undefined && { marker }),
          });
        } else {
          await updateMatch(compId, matchId, {
            score1: null,
            score2: null,
            winnerSide: newWinnerSide,
            status: 'Walkover',
            playedDate: playedDate || match.playedDate || correctToday,
            ...(marker !== undefined && { marker }),
          });
        }

        // Re-advance only when the winner actually changed (uses the original match's
        // sides + the new winner to overwrite the next-round slot)
        if (winnerChanges) {
          try {
            await propagateWinnerToNextRound(compId, match, newWinnerSide);
          } catch (err) {
            console.error('[correct propagate] Error:', err);
          }
        }

        clearDiaryCache(currentUsername);
        return NextResponse.json({ success: true });
      }

      // No recognised action on a finished match — reject as before.
      return NextResponse.json(
        { error: 'Match is already completed' },
        { status: 400 }
      );
    }

    // ── Member-level permission tier ──────────────────────────────────────────
    // Non-committee members may only record the planned date for their own match.
    // Any attempt to submit scores, walkovers, or substitutions is rejected.
    if (!committee) {
      // Build the list of all players in this match from both sides
      const side2Players = match.side2Usernames || [];
      const allInMatch: string[] = [];
      for (let i = 0; i < match.side1Usernames.length; i++) {
        allInMatch.push(match.side1Usernames[i].toLowerCase());
      }
      for (let i = 0; i < side2Players.length; i++) {
        allInMatch.push(side2Players[i].toLowerCase());
      }

      // Reject users who are not participants in this match
      let isParticipant = false;
      for (let i = 0; i < allInMatch.length; i++) {
        if (allInMatch[i] === currentUsername.toLowerCase()) {
          isParticipant = true;
          break;
        }
      }
      if (!isParticipant) {
        return NextResponse.json(
          { error: 'You are not a participant in this match' },
          { status: 403 }
        );
      }

      // Members may only send playedDate and/or marker — reject any other fields
      const bodyKeys = Object.keys(body);
      for (let i = 0; i < bodyKeys.length; i++) {
        // Check each submitted key against the whitelist of allowed member fields
        if (bodyKeys[i] !== 'playedDate' && bodyKeys[i] !== 'marker') {
          return NextResponse.json(
            { error: 'Members may only update the planned date and marker for their match' },
            { status: 403 }
          );
        }
      }

      // At least one of playedDate or marker must be supplied
      if (body.playedDate === undefined && body.marker === undefined) {
        return NextResponse.json(
          { error: 'playedDate or marker is required' },
          { status: 400 }
        );
      }

      // Build the updates object to write to the sheet
      const memberUpdates: { playedDate?: string; marker?: string } = {};

      // Validate and accept playedDate if provided
      if (body.playedDate !== undefined) {
        const playedDate = body.playedDate;
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        // Reject dates that are not in YYYY-MM-DD format
        if (!dateRegex.test(playedDate)) {
          return NextResponse.json(
            { error: 'playedDate must be a valid date in YYYY-MM-DD format' },
            { status: 400 }
          );
        }

        // Confirm the calendar date itself is valid (rejects e.g. 2025-13-01)
        const dateObj = new Date(playedDate);
        if (isNaN(dateObj.getTime())) {
          return NextResponse.json(
            { error: 'playedDate must be a valid date in YYYY-MM-DD format' },
            { status: 400 }
          );
        }

        memberUpdates.playedDate = playedDate;
      }

      // Validate and accept marker if provided
      if (body.marker !== undefined) {
        const marker = body.marker;

        // Marker must be a string
        if (typeof marker !== 'string') {
          return NextResponse.json({ error: 'marker must be a string' }, { status: 400 });
        }

        // Non-empty marker must correspond to a real member username
        if (marker !== '') {
          // Load the member map to validate the submitted username exists
          const memberInfoMap = await getMemberInfoMap();
          const markerInfo = memberInfoMap.get(marker.toLowerCase());
          if (!markerInfo) {
            return NextResponse.json(
              { error: 'Marker must be a valid member username' },
              { status: 400 }
            );
          }
        }

        // Empty string is valid — it clears the marker field
        memberUpdates.marker = marker;
      }

      // Write only the allowed fields — do not change status or any other field
      await updateMatch(compId, matchId, memberUpdates);

      // Invalidate the diary cache so the home page reflects the updated played date or marker
      clearDiaryCache(currentUsername);

      return NextResponse.json({ success: true });
    }

    // ── Committee path (Captain / Admin — full access) ────────────────────────
    // Extract all allowed committee fields from the request body
    const { score1, score2, winnerSide, status, playedDate, side1Usernames, side2Usernames, playByDate, marker } = body;

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

    // When status is provided, write the full score/walkover result including marker if supplied.
    // When status is absent (date-only or marker-only save), write only the changed fields.
    if (status === 'Complete') {
      // Record the match result with both scores and the winner
      await updateMatch(compId, matchId, {
        score1,
        score2,
        winnerSide: resolvedWinnerSide,
        status: 'Complete',
        playedDate: playedDate || today,
        ...(marker !== undefined && { marker }),
      });
    } else if (status === 'Walkover') {
      // Record a walkover result — no scores, just the winner side
      await updateMatch(compId, matchId, {
        winnerSide: resolvedWinnerSide,
        status: 'Walkover',
        playedDate: playedDate || today,
        ...(marker !== undefined && { marker }),
      });
    } else {
      // No status change — write only the individual fields that were supplied.
      // This covers: playedDate-only (date arrangement), marker-only, substitution, and play-by-date updates.
      const partialUpdates: Parameters<typeof updateMatch>[2] = {};

      // Only add each field if it was explicitly sent in the request body
      if (side1Usernames !== undefined) partialUpdates.side1Usernames = side1Usernames;
      if (side2Usernames !== undefined) partialUpdates.side2Usernames = side2Usernames;
      if (playByDate !== undefined) partialUpdates.playByDate = playByDate;
      if (playedDate !== undefined) partialUpdates.playedDate = playedDate;
      if (marker !== undefined) partialUpdates.marker = marker;

      // Only call updateMatch if there is actually something to write
      if (Object.keys(partialUpdates).length > 0) {
        await updateMatch(compId, matchId, partialUpdates);
      }
    }

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
