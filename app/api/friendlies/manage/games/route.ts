// app/api/friendlies/manage/games/route.ts
// API endpoint to fetch all games for captain management page
// Returns games sorted by date (most recent first) with full game details

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames } from '@/lib/friendlies-sheets';

// GET handler - Returns all games sorted by date for captain management
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can access management view
    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch all games from Games sheet
    const games = await getGames();

    // Sort games by date (most recent first for easier management)
    const sortedGames = games.sort((a, b) => {
      // Convert date strings to timestamps for comparison
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();

      // Sort descending (newest first)
      return dateB - dateA;
    });

    // Return sorted games array
    return NextResponse.json({ games: sortedGames });
  } catch (error) {
    // Log error and return 500 response
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
