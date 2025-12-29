// app/api/friendlies/games/route.ts
// API endpoint to fetch all games with optional status filtering and user's entry status
// Used by the main Friendlies page to display available games to players

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getPlayerEntries } from '@/lib/friendlies-sheets';
import { GameStatus } from '@/lib/types/friendlies';

// GET handler - Returns list of games with user's entry status for each
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Extract query parameters from URL
    const { searchParams } = new URL(request.url);

    // Get optional status filter (e.g., ?status=O for Open games only)
    const statusFilter = searchParams.get('status') as GameStatus | null;

    // Determine which games to fetch based on filter
    let gamesToFetch;
    if (statusFilter) {
      // Use provided status filter
      gamesToFetch = statusFilter;
    } else {
      // No filter - get all games
      gamesToFetch = undefined;
    }

    // Fetch games from Games sheet (optionally filtered by status)
    const games = await getGames(gamesToFetch);

    // Get current user's username from session
    const userName = session.user.userName;

    // Fetch all entries for this user from Players sheet
    const userEntries = await getPlayerEntries(userName);

    // Combine game data with user's entry status
    const gamesWithUserStatus = games.map(game => {
      // Search for user's entry for this specific game
      let entry = null;

      // Loop through user's entries to find matching game
      for (const e of userEntries) {
        if (e.tabName === game.tabName) {
          entry = e;
          break;
        }
      }

      // Extract status from entry if found
      let userStatus = null;
      if (entry) {
        userStatus = entry.status;
      }

      // Return game with added user status fields
      return {
        ...game,
        userEntered: !!entry,  // Boolean - has user entered this game?
        userStatus: userStatus, // Status code (E, P, R, etc.) or null
      };
    });

    // Return success response with games array
    return NextResponse.json({ games: gamesWithUserStatus });
  } catch (error) {
    // Log error and return 500 response
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
