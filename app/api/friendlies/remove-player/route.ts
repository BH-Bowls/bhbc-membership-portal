// app/api/friendlies/remove-player/route.ts
// API endpoint to remove a player from a game
// Captains/Admins can remove any player (any status); players can remove themselves from Open games only

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, updatePlayerEntry, updateGameCounts, removePlayerFromGameSheet, getGameSheet, updateGameSheet, getActiveEnteredCount } from '@/lib/friendlies-sheets';
import { hasRole } from '@/lib/role-utils';
import { getUserByUsername } from '@/lib/sheets';
import { sendWithdrawnByAdminNoticeEmail, sendRemovedNoticeEmail } from '@/lib/email/friendlies';

// POST handler - Removes a player from a game (Players column + game sheet row)
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { gameId, playerUserName, forceRemove = false } = body;

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

    // Fetch all games to verify game exists
    const allGames = await getGames();
    const game = allGames.find(g => g.tabName === gameId);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

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

    const appUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;

    if (game.status === 'S' && !forceRemove) {
      // Published game — mark as withdrawn rather than delete.
      // Player stays on the game sheet so the captain can see who dropped out.
      const players = await getGameSheet(game.tabName);
      const playerInGame = players.find(p => p.name === playerUserName);

      if (playerInGame) {
        await updateGameSheet(game.tabName, [{ rowNumber: playerInGame.rowNumber, status: 'W' }]);
        const withdrawnStatus =
          playerInGame.selected === 'Y' ? 'PW' :
          playerInGame.selected === 'R' ? 'RW' :
          playerInGame.selected === 'T' ? 'TW' : 'EW';
        await updatePlayerEntry(playerUserName, game.tabName, withdrawnStatus as any);
      } else {
        // Not in game sheet — just clear the Players column
        await updatePlayerEntry(playerUserName, game.tabName, '');
      }

      // Recalculate entered count, excluding the player who was just withdrawn
      try {
        const activeCount = await getActiveEnteredCount(game.tabName);
        await updateGameCounts(game.tabName, { entered: activeCount });
      } catch (countError) {
        console.error('[remove-player] Error updating entered count:', countError);
      }

      // Send withdrawal notice to the player (fire-and-forget)
      try {
        const user = await getUserByUsername(playerUserName);
        if (user?.emailAddress) {
          const fullName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : playerUserName);
          await sendWithdrawnByAdminNoticeEmail(user.emailAddress, playerUserName, fullName, game, appUrl);
        }
      } catch (emailError) {
        console.error('[remove-player] Error sending withdrawal notice email:', emailError);
      }

      return NextResponse.json({ success: true, withdrawn: true });
    }

    // Open / Selecting, or a forced full removal from a Selected game — remove the player completely
    await updatePlayerEntry(playerUserName, game.tabName, '');
    await removePlayerFromGameSheet(game.tabName, playerUserName);

    try {
      const activeCount = await getActiveEnteredCount(game.tabName);
      await updateGameCounts(game.tabName, { entered: activeCount });
    } catch {
      // Don't fail — player was removed successfully
    }

    // Send removal notice to the player (fire-and-forget)
    try {
      const user = await getUserByUsername(playerUserName);
      if (user?.emailAddress) {
        const fullName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : playerUserName);
        await sendRemovedNoticeEmail(user.emailAddress, playerUserName, fullName, game, appUrl);
      }
    } catch (emailError) {
      console.error('[remove-player] Error sending removal notice email:', emailError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to remove player' },
      { status: 500 }
    );
  }
}
