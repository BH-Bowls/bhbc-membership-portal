// app/api/friendlies/manage/get-stats/route.ts
// API endpoint to refresh player statistics in a game sheet from the Players sheet
// Updates name_down, picked, percent_played, driver/bar info, and last 8 games for all players

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, updateGameSheetStats, getGameSheet, sortGameSheetPlayers } from '@/lib/friendlies-sheets';
import { GetStatsRequest } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';

// POST handler - Refreshes stats for all players in a game sheet
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can update stats
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body
    const body: GetStatsRequest = await request.json();
    const { tab_name } = body;

    // Fetch all games from Games sheet
    const games = await getGames();

    // Search for the game by tabName
    let game = null;
    for (const g of games) {
      if (g.tabName === tab_name) {
        game = g;
        break;
      }
    }

    // Return 404 if game doesn't exist
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Only allow stat updates for games in Selecting (X) or Selected (S) status
    if (!['X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Can only update stats for Selecting or Selected games' },
        { status: 400 }
      );
    }

    // Update stats for all players in the game sheet from Players sheet
    // This refreshes: name_down, picked, percent_played, driver/bar, last 8 games
    const playersUpdated = await updateGameSheetStats(game.tabName);

    // Read back the refreshed players (sorted for display) so the caller doesn't
    // need a second round-trip to /manage/game just to pick up the new stats.
    const players = sortGameSheetPlayers(await getGameSheet(game.tabName));

    // Return success with the refreshed player list
    return NextResponse.json({
      success: true,
      players_updated: playersUpdated,
      players,
      message: 'Stats updated successfully',
    });
  } catch (error) {
    // Log error and return 500 response
    console.error('Error in get-stats route:', error);
    return NextResponse.json(
      { error: 'Failed to update stats' },
      { status: 500 }
    );
  }
}
