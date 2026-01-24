// app/api/internal-games/remove-player/route.ts
// API endpoint to remove manually added players (M status) from an internal game

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getInternalGames,
  updatePlayerEntry,
  getPlayerEntryStatus,
  getEnteredPlayers,
  updateGameCounts,
} from '@/lib/internal-games-sheets';

// POST handler - Remove a manually added player from an internal game
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const { gameId, playerUserName } = await request.json();

    if (!gameId || !playerUserName) {
      return NextResponse.json(
        { error: 'gameId and playerUserName are required' },
        { status: 400 }
      );
    }

    // Fetch all games and find by tabName
    const allGames = await getInternalGames();
    const game = allGames.find(g => g.tabName === gameId);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Check if game is still open for changes
    if (game.status !== 'O') {
      return NextResponse.json(
        { error: 'Can only remove players from open games' },
        { status: 400 }
      );
    }

    // Check player's current status
    const playerStatus = await getPlayerEntryStatus(playerUserName, game.tabName);

    // Only allow removing manually added players (M status)
    if (playerStatus !== 'M') {
      return NextResponse.json(
        { error: 'Can only remove manually added players' },
        { status: 403 }
      );
    }

    // Remove the player by clearing their entry status
    await updatePlayerEntry(playerUserName, game.tabName, '');

    // Update the entered count in Games sheet
    try {
      const enteredPlayers = await getEnteredPlayers(game.tabName);
      await updateGameCounts(game.tabName, { entered: enteredPlayers.length });
    } catch (countError) {
      console.error('[Internal Games API] Error updating entered count:', countError);
      // Don't fail the request, player was removed successfully
    }

    return NextResponse.json({
      success: true,
      removed_player: playerUserName,
    });
  } catch (error) {
    console.error('[Internal Games API] Error removing player:', error);
    return NextResponse.json(
      { error: 'Failed to remove player' },
      { status: 500 }
    );
  }
}
