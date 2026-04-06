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
    const session = await getServerSession(authOptions);

    // Extract query parameters from URL
    const { searchParams } = new URL(request.url);

    // Get optional status filter (e.g., ?status=O for Open games only)
    const statusFilter = searchParams.get('status') as GameStatus | null;

    // Fetch games from Games sheet (optionally filtered by status), only Friendly type
    const games = await getGames(statusFilter ?? undefined, ['Friendly']);

    // For guests (no session) return games without user entry status
    if (!session?.user?.userName) {
      const gamesWithUserStatus = games.map(game => ({
        ...game,
        userEntered: false,
        userStatus: null,
      }));
      return NextResponse.json({ games: gamesWithUserStatus });
    }

    // Fetch all entries for this user from Players sheet
    const userEntries = await getPlayerEntries(session.user.userName);

    // Combine game data with user's entry status
    const gamesWithUserStatus = games.map(game => {
      let entry = null;
      for (const e of userEntries) {
        if (e.tabName === game.tabName) { entry = e; break; }
      }
      return {
        ...game,
        userEntered: !!entry,
        userStatus: entry?.status ?? null,
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
