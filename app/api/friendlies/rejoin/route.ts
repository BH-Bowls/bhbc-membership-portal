// app/api/friendlies/rejoin/route.ts
// API endpoint for a player who previously withdrew from a Selected game to re-join it.
// The reverse of the withdraw route's Selected-game path: clears the game-sheet
// withdrawal (status 'W' → '' so they are a selected-but-unconfirmed player again),
// restores their Players-sheet status, recounts entries, and notifies the captains
// (who may have lined up a replacement) and the player.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAppUrl } from '@/lib/app-url';
import { getGames, getGameSheet, updateGameSheet, updatePlayerEntry, updateGameCounts, getActiveEnteredCount } from '@/lib/friendlies-sheets';
import { clearDiaryCache } from '@/lib/home-cache';
import { sendRejoinEmail, sendRejoinNoticeEmail } from '@/lib/email/friendlies';
import type { WithdrawRequest } from '@/lib/types/friendlies';
import { getUserByUsername } from '@/lib/sheets';

// POST handler - Re-joins the current user to a Selected game they had withdrawn from
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: WithdrawRequest = await request.json();
    const tab_name = decodeURIComponent(body.tab_name);
    const userName = session.user.userName;

    // Find the game
    const games = await getGames();
    let game = null;
    for (const g of games) {
      if (g.tabName === tab_name) {
        game = g;
        break;
      }
    }
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Re-join only makes sense for a published (Selected) game — the same state in
    // which the game page offers a withdrawal to reverse.
    if (game.status !== 'S') {
      return NextResponse.json(
        { error: 'You can only re-join a game that is still selected' },
        { status: 400 }
      );
    }

    // Find this user in the game sheet
    const players = await getGameSheet(game.tabName);
    let userPlayer = null;
    for (const p of players) {
      if (p.name === userName) {
        userPlayer = p;
        break;
      }
    }
    if (!userPlayer) {
      return NextResponse.json({ error: 'You are not in this game' }, { status: 404 });
    }

    // Must currently be withdrawn to re-join
    if (userPlayer.status !== 'W') {
      return NextResponse.json({ error: 'You have not withdrawn from this game' }, { status: 400 });
    }

    // Restore their selection role. Normally it was preserved on withdrawal (Y/R/T),
    // but a captain's save can blank it — in that case default to Reserve so they
    // return as an available reserve rather than nothing.
    const role = userPlayer.selected || 'R';

    // Clear the withdrawal in the game sheet (status 'W' → '') and write the restored
    // role back into the selected column.
    await updateGameSheet(game.tabName, [
      {
        rowNumber: userPlayer.rowNumber,
        status: '',
        selected: role,
      },
    ]);

    // Players-sheet status mirrors the role (the inverse of the withdraw route's
    // PW/RW/TW mapping): Y→P (playing), T→T (reserve team), otherwise R (reserve).
    let restoredStatus;
    if (role === 'Y') {
      restoredStatus = 'P';
    } else if (role === 'T') {
      restoredStatus = 'T';
    } else {
      restoredStatus = 'R';
    }
    await updatePlayerEntry(userName, game.tabName, restoredStatus as any);

    // Recalculate entered count now that this player is active again
    try {
      const activeCount = await getActiveEnteredCount(game.tabName);
      await updateGameCounts(game.tabName, { entered: activeCount });
    } catch (countError) {
      console.error('[rejoin] Error updating entered count:', countError);
    }

    const appUrl = await getAppUrl();

    // Notify the captains that the player is back in (they may have arranged a
    // replacement after the earlier withdrawal).
    try {
      await sendRejoinEmail(
        userName,
        game,
        {
          selected: userPlayer.selected,
          team: userPlayer.team,
          position: userPlayer.position,
        },
        appUrl
      );
    } catch (emailError) {
      console.error('Error sending re-join captain email:', emailError);
    }

    // Send a re-join confirmation to the player (fire-and-forget)
    try {
      const user = await getUserByUsername(userName);
      if (user?.emailAddress) {
        const fullName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : userName);
        await sendRejoinNoticeEmail(user.emailAddress, userName, fullName, game, appUrl);
      }
    } catch (emailError) {
      console.error('Error sending re-join notice email:', emailError);
    }

    // Invalidate the diary cache so the home page reflects the re-join
    clearDiaryCache(userName);

    return NextResponse.json({
      success: true,
      message: 'Re-joined and captains notified',
    });
  } catch (error) {
    console.error('POST /api/friendlies/rejoin error:', error);
    return NextResponse.json(
      { error: 'Failed to re-join game' },
      { status: 500 }
    );
  }
}
