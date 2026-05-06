// app/api/friendlies/remove-player/route.ts
// API endpoint to remove a player from a game
// Captains/Admins can remove any player (any status); players can remove themselves from Open games only

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, updatePlayerEntry, getEnteredPlayers, updateGameCounts, removePlayerFromGameSheet } from '@/lib/friendlies-sheets';
import { hasRole } from '@/lib/role-utils';

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
    const { gameId, playerUserName } = body;

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

    // Clear the player's entry in the Players column
    await updatePlayerEntry(playerUserName, game.tabName, '');

    // Remove the player's row from the individual game sheet
    await removePlayerFromGameSheet(game.tabName, playerUserName);

    // Update the entered count in Games sheet
    try {
      const enteredPlayers = await getEnteredPlayers(game.tabName);
      await updateGameCounts(game.tabName, { entered: enteredPlayers.length });
    } catch (countError) {
      // Don't fail the request, player was removed successfully
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to remove player' },
      { status: 500 }
    );
  }
}
