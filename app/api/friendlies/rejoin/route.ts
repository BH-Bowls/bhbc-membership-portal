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
import { getGameSheet, updateGameSheet, updatePlayerEntry, getActiveEnteredCount } from '@/lib/friendlies-sheets';
import { getFixtures, updateFixture } from '@/lib/fixtures-supabase';
import { clearDiaryCache, clearSheetDataCacheByPrefix } from '@/lib/home-cache';
import { sendRejoinEmail, sendRejoinNoticeEmail } from '@/lib/email/friendlies';
import type { WithdrawRequest } from '@/lib/types/friendlies';
import { getUserByUsername } from '@/lib/members-supabase';
import { hasRole } from '@/lib/role-utils';

// POST handler - Re-joins a player who had withdrawn from a Selecting/Selected game.
// Self-service: a member re-joins themselves (from the game page) — captains notified.
// Captain "Restore": pass `playerUserName` (Captain/Admin only) to restore another
// player; captains are not re-notified and the player email is gated by `sendPlayerEmail`.
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: WithdrawRequest & { playerUserName?: string; sendPlayerEmail?: boolean } = await request.json();
    const tab_name = decodeURIComponent(body.tab_name);

    // A captain-supplied playerUserName means "Restore this player"; otherwise the
    // caller is re-joining themselves.
    const explicitTarget = typeof body.playerUserName === 'string' && body.playerUserName.trim()
      ? body.playerUserName.trim()
      : null;
    const isCaptainAction = explicitTarget !== null;
    const target = explicitTarget ?? session.user.userName;
    const sendPlayerEmail = body.sendPlayerEmail !== false; // default true

    // Only Captains/Admins may restore someone other than themselves.
    if (isCaptainAction && target !== session.user.userName && !hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Only captains can restore another player' }, { status: 403 });
    }

    // Find the game
    const games = await getFixtures();
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

    // Re-join / restore applies while the game is Selecting or Selected (the states
    // in which a player can be withdrawn).
    if (!['X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'You can only re-join a game that is still selecting or selected' },
        { status: 400 }
      );
    }

    // Find the target in the game sheet
    const players = await getGameSheet(game.tabName);
    let userPlayer = null;
    for (const p of players) {
      if (p.name === target) {
        userPlayer = p;
        break;
      }
    }
    if (!userPlayer) {
      return NextResponse.json({ error: 'Player is not in this game' }, { status: 404 });
    }

    // Must currently be withdrawn to re-join
    if (userPlayer.status !== 'W') {
      return NextResponse.json({ error: 'Player has not withdrawn from this game' }, { status: 400 });
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
    await updatePlayerEntry(target, game.tabName, restoredStatus as any);

    // Recalculate entered count now that this player is active again
    try {
      const activeCount = await getActiveEnteredCount(game.tabName);
      await updateFixture(game.id, { entered: activeCount });
    } catch (countError) {
      console.error('[rejoin] Error updating entered count:', countError);
    }

    const appUrl = await getAppUrl();

    // Notify the captains ONLY for a self re-join (a captain doing a Restore is already
    // acting, so we don't re-notify them).
    if (!isCaptainAction) {
      try {
        await sendRejoinEmail(
          target,
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
    }

    // Send a re-join confirmation to the player (fire-and-forget), unless suppressed
    // by the captain's "Send player email" checkbox.
    if (sendPlayerEmail) {
      try {
        const user = await getUserByUsername(target);
        if (user?.emailAddress) {
          const fullName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : target);
          await sendRejoinNoticeEmail(user.emailAddress, target, fullName, game, appUrl);
        }
      } catch (emailError) {
        console.error('Error sending re-join notice email:', emailError);
      }
    }

    // Invalidate the diary cache so the home page reflects the re-join
    clearDiaryCache(target);
    // Bust the shared Players-sheet cache too — see enter/route.ts for why.
    clearSheetDataCacheByPrefix('friendlies-players:');

    return NextResponse.json({
      success: true,
      message: isCaptainAction ? 'Player restored' : 'Re-joined and captains notified',
    });
  } catch (error) {
    console.error('POST /api/friendlies/rejoin error:', error);
    return NextResponse.json(
      { error: 'Failed to re-join game' },
      { status: 500 }
    );
  }
}
