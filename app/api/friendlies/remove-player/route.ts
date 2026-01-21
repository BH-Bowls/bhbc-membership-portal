// app/api/friendlies/remove-player/route.ts
// API endpoint to remove a manually added player (M status only)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, updatePlayerEntry, getPlayerEntryStatus, getEnteredPlayers, updateGameCounts } from '@/lib/friendlies-sheets';

// POST handler - Removes player with M status
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

    // Fetch all games to verify game exists and is open
    const allGames = await getGames();
    const game = allGames.find(g => g.tabName === gameId);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Only allow removing from open games
    if (game.status !== 'O') {
      return NextResponse.json({ error: 'Game is not open for entry' }, { status: 400 });
    }

    // Check if player has M status (manually added)
    const playerStatus = await getPlayerEntryStatus(playerUserName, game.tabName);

    if (playerStatus !== 'M') {
      return NextResponse.json({
        error: 'Can only remove manually added players'
      }, { status: 403 });
    }

    // Remove the player by clearing their entry
    await updatePlayerEntry(playerUserName, game.tabName, '');

    // Update the entered count in Games sheet
    try {
      const enteredPlayers = await getEnteredPlayers(game.tabName);
      await updateGameCounts(game.tabName, { entered: enteredPlayers.length });
    } catch (countError) {
      console.error('[Friendlies API] Error updating entered count:', countError);
      // Don't fail the request, player was removed successfully
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Friendlies API] Error removing player:', error);
    return NextResponse.json(
      { error: 'Failed to remove player' },
      { status: 500 }
    );
  }
}
