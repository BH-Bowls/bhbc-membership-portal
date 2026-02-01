// app/api/friendlies/add-players/route.ts
// API endpoint for players to manually add other players to a game
// Optimized to add players to both Players sheet AND game sheet in one call

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, batchUpdatePlayerEntries, addPlayersToGameSheetDirect, updateGameCounts } from '@/lib/friendlies-sheets';
import { canEnterGame } from '@/lib/game-management/capacity';

// POST handler - Adds players with M (manually added) status
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { gameId, playerUserNames } = body;

    // Validate input
    if (!gameId || !Array.isArray(playerUserNames) || playerUserNames.length === 0) {
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

    // Check capacity limits (captains/admins bypass capacity)
    const isCaptainOrAdmin = session.user.role && ['Captain', 'Admin'].includes(session.user.role);

    // Only allow adding to open games, or Selecting/Selected games for captains/admins
    if (game.status !== 'O') {
      if (!isCaptainOrAdmin || !['X', 'S'].includes(game.status)) {
        return NextResponse.json({ error: 'Game is not open for entry' }, { status: 400 });
      }
    }

    if (!isCaptainOrAdmin && game.maxPlayers && game.maxPlayers > 0) {
      const capacityCheck = canEnterGame(game, false);
      if (!capacityCheck.canEnter) {
        // Check if adding these players would exceed capacity significantly
        const availableSpots = game.maxPlayers - game.entered;
        if (playerUserNames.length > availableSpots && availableSpots > 0) {
          return NextResponse.json({
            error: `Only ${availableSpots} spot${availableSpots === 1 ? '' : 's'} available`
          }, { status: 400 });
        }
      }
    }

    // Add all players with M (manually added) status to Players sheet
    const entries = playerUserNames.map(userName => ({ userName, status: 'M' as const }));
    const batchResults = await batchUpdatePlayerEntries(game.tabName, entries);
    const results = batchResults.map(r => ({
      userName: r.userName,
      added: r.success,
      error: r.error,
    }));

    // Check if any failed
    const failed = results.filter(r => !r.added);
    if (failed.length > 0 && failed.length === results.length) {
      // All failed
      return NextResponse.json({
        success: false,
        error: 'Failed to add players',
        results
      }, { status: 500 });
    }

    // For games in Selecting/Selected status, also add players to game sheet directly
    // This eliminates the need for a separate get-stats call
    if (['X', 'S'].includes(game.status)) {
      try {
        const successfulPlayers = results.filter(r => r.added).map(r => r.userName);
        await addPlayersToGameSheetDirect(game.tabName, successfulPlayers);
      } catch (gameSheetError) {
        console.error('[Friendlies API] Error adding to game sheet:', gameSheetError);
        // Don't fail - players were added to Players sheet
      }
    }

    // Update the entered count (just increment by successful additions)
    const addedCount = results.filter(r => r.added).length;
    if (addedCount > 0) {
      try {
        await updateGameCounts(game.tabName, { entered: game.entered + addedCount });
      } catch (countError) {
        console.error('[Friendlies API] Error updating entered count:', countError);
      }
    }

    return NextResponse.json({ success: true, results, addedToGameSheet: ['X', 'S'].includes(game.status) });
  } catch (error) {
    console.error('[Friendlies API] Error adding players:', error);
    return NextResponse.json(
      { error: 'Failed to add players' },
      { status: 500 }
    );
  }
}
