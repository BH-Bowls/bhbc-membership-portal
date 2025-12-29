// app/api/friendlies/manage/update-stats/route.ts
// API endpoint to sync player selection status from game sheet back to Players sheet
// Updates the Players sheet column for this game with selection status codes (P, R, T, E, or with W suffix)
// Called by captains after making selection changes to keep Players sheet in sync

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, updatePlayerEntry } from '@/lib/friendlies-sheets';
import { UpdateStatsRequest, UpdateStatsResponse } from '@/lib/types/friendlies';

// POST handler - Syncs selection status from game sheet to Players sheet
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can update player stats/status
    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body to get game identifier
    const body: UpdateStatsRequest = await request.json();
    const { tab_name } = body;

    // Fetch all games from Games sheet
    const games = await getGames();

    // Search for the game matching the provided tab_name
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

    // Validate that game is in a status that requires stats updates
    // X = Selecting (captain picking team), S = Selected (team published)
    if (!['X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Can only update stats for Selecting or Selected games' },
        { status: 400 }
      );
    }

    // Fetch all players from the game sheet (source of truth for selections)
    const players = await getGameSheet(game.tabName);

    // Track how many player entries were updated
    let statsUpdated = 0;

    // Loop through each player and sync their status to Players sheet
    // Status codes: P=Picked to play, R=Reserve, T=Reserve Team, E=Entered but not selected
    // Withdrawal suffix: PW=Picked+Withdrawn, RW=Reserve+Withdrawn, etc.
    for (const player of players) {
      // Determine the base status code from selection status in game sheet
      let newStatus = '';

      // Map the game sheet selection field to Players sheet status code
      switch (player.selected) {
        case 'Y':
          // Selected to play - status is 'P' (Picked)
          newStatus = 'P';
          break;
        case 'R':
          // Selected as reserve - status is 'R' (Reserve)
          newStatus = 'R';
          break;
        case 'T':
          // Selected as reserve team - status is 'T' (Reserve Team)
          newStatus = 'T';
          break;
        default:
          // Not selected (or blank) - status is 'E' (Entered)
          // Player entered the game but wasn't picked for any role
          newStatus = 'E';
      }

      // Check if player has withdrawn (Status column = 'W' in game sheet)
      // If withdrawn, append 'W' to status code (P→PW, R→RW, E→EW, etc.)
      if (player.status === 'W') {
        newStatus = newStatus + 'W';
      }

      // Update this player's entry in the Players sheet for this game's column
      await updatePlayerEntry(player.name, game.tabName, newStatus as any);

      // Increment counter for response
      statsUpdated++;
    }

    // Build success response with count of updated player entries
    const response: UpdateStatsResponse = {
      success: true,
      stats_updated: statsUpdated, // Number of player entries synced
    };

    // Return success response to client
    return NextResponse.json(response);
  } catch (error) {
    // Log error details for debugging
    console.error('Error updating stats:', error);

    // Return 500 error response to client
    return NextResponse.json(
      { error: 'Failed to update stats' },
      { status: 500 }
    );
  }
}
