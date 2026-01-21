// app/api/friendlies/add-players/route.ts
// API endpoint for players to manually add other players to a game

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, updatePlayerEntry, getEnteredPlayers, updateGameCounts } from '@/lib/friendlies-sheets';
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

    // Only allow adding to open games
    if (game.status !== 'O') {
      return NextResponse.json({ error: 'Game is not open for entry' }, { status: 400 });
    }

    // Check capacity limits (captains/admins bypass capacity)
    const isCaptainOrAdmin = session.user.role && ['Captain', 'Admin'].includes(session.user.role);

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

    // Add each player with M (manually added) status
    const results = [];
    for (const userName of playerUserNames) {
      try {
        await updatePlayerEntry(userName, game.tabName, 'M');
        results.push({ userName, added: true });
      } catch (updateError: any) {
        results.push({
          userName,
          added: false,
          error: updateError.message || 'Update failed'
        });
      }
    }

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

    // Update the entered count in Games sheet
    try {
      const enteredPlayers = await getEnteredPlayers(game.tabName);
      await updateGameCounts(game.tabName, { entered: enteredPlayers.length });
    } catch (countError) {
      console.error('[Friendlies API] Error updating entered count:', countError);
      // Don't fail the request, players were added successfully
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('[Friendlies API] Error adding players:', error);
    return NextResponse.json(
      { error: 'Failed to add players' },
      { status: 500 }
    );
  }
}
