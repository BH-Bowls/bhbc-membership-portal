// app/api/friendlies/remove-player/route.ts
// API endpoint to remove a player from a game
// Captains/Admins can remove any player (any status); players can remove themselves from Open games only

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAppUrl } from '@/lib/app-url';
import { getEntry, deleteEntry, markEntryWithdrawn, appendManageLog } from '@/lib/fixture-groups-supabase';
import { getFixtures } from '@/lib/fixtures-supabase';
import { hasRole } from '@/lib/role-utils';
import { getUserByUsername } from '@/lib/members-supabase';
import { sendWithdrawnByAdminNoticeEmail, sendRemovedNoticeEmail, sendLinkedWithdrawalNoticeEmail } from '@/lib/email/friendlies';
import { clearDiaryCache } from '@/lib/home-cache';

// POST handler - Removes a player from a game's group (or withdraws them after close)
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    // sendEmail (default true) is set by the captain's "Send player email" checkbox.
    const { gameId, playerUserName, forceRemove = false, sendEmail = true } = body;

    // Validate input
    if (!gameId || !playerUserName) {
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }

    const currentUser = session.user.userName;
    const isCaptainOrAdmin = hasRole(session.user.role, 'Captain', 'Admin');

    // Non-captains can only remove themselves
    if (!isCaptainOrAdmin && playerUserName !== currentUser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch all fixtures to verify game exists
    const allGames = await getFixtures();
    const game = allGames.find(g => g.tabName === gameId);

    if (!game || !game.groupId) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    const groupId = game.groupId;

    // Non-captains can only remove from Open games
    if (!isCaptainOrAdmin && game.status !== 'O') {
      return NextResponse.json({ error: 'Game is not open for entry' }, { status: 400 });
    }

    // Captains/Admins can remove from Open, Selecting, or Selected games
    if (isCaptainOrAdmin && !['O', 'X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Can only remove players from Open, Selecting, or Selected games' },
        { status: 400 }
      );
    }

    const appUrl = await getAppUrl();

    if (['X', 'S'].includes(game.status) && !forceRemove) {
      // Selecting/Published game — mark as withdrawn (by the captain) rather than
      // delete, so the captain can still see who dropped out.
      const entry = await getEntry(groupId, playerUserName);
      if (entry) {
        await markEntryWithdrawn(groupId, playerUserName, currentUser);
        await appendManageLog({ username: currentUser, action: 'withdraw-by-captain', tabName: game.tabName, fixtureId: game.id, groupId, details: { player: playerUserName } });
      }

      // Send withdrawal notice to the player (fire-and-forget), unless suppressed.
      if (sendEmail) {
        try {
          const user = await getUserByUsername(playerUserName);
          if (user?.emailAddress) {
            const fullName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : playerUserName);
            await sendWithdrawnByAdminNoticeEmail(user.emailAddress, playerUserName, fullName, game, appUrl);
          }
        } catch (emailError) {
          console.error('[remove-player] Error sending withdrawal notice email:', emailError);
        }
      }

      clearDiaryCache(playerUserName);
      return NextResponse.json({ success: true, withdrawn: true });
    }

    // Open, or a forced full removal — delete the entry entirely (as if they never
    // entered). The removal is recorded in the manage log.
    const removed = await deleteEntry(groupId, playerUserName);
    if (removed) {
      await appendManageLog({
        username: currentUser,
        action: playerUserName === currentUser ? 'withdraw-open' : 'remove',
        tabName: game.tabName,
        fixtureId: game.id,
        groupId,
        details: { player: playerUserName, forced: !!forceRemove },
      });
    }

    // Send removal notice to the player (fire-and-forget). For a linked occasion still
    // open for entry, send the linked removal email naming both games.
    const emailPartner = game.status === 'O'
      ? allGames.find(g => g.groupId === groupId && g.id !== game.id && !g.reserveOf)
      : undefined;
    if (sendEmail) {
      try {
        const user = await getUserByUsername(playerUserName);
        if (user?.emailAddress) {
          const fullName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : playerUserName);
          if (emailPartner) {
            await sendLinkedWithdrawalNoticeEmail(user.emailAddress, playerUserName, fullName, game, emailPartner, appUrl);
          } else {
            await sendRemovedNoticeEmail(user.emailAddress, playerUserName, fullName, game, appUrl);
          }
        }
      } catch (emailError) {
        console.error('[remove-player] Error sending removal notice email:', emailError);
      }
    }

    clearDiaryCache(playerUserName);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing player:', error);
    return NextResponse.json(
      { error: 'Failed to remove player' },
      { status: 500 }
    );
  }
}
