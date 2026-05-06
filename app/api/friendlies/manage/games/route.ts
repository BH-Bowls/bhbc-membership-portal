// app/api/friendlies/manage/games/route.ts
// API endpoint to fetch all games for captain management page
// Returns games sorted by date (most recent first) with full game details

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames } from '@/lib/friendlies-sheets';
import { GameType } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';
import { parseNormalizedDate } from '@/lib/date-utils';

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
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Admins also see Test games; Captains see Friendly only
    const isAdmin = hasRole(session.user.role, 'Admin');
    const typeFilter: GameType[] = isAdmin ? ['Friendly', 'Test'] : ['Friendly'];

    // Fetch games from Games sheet filtered by type
    const games = await getGames(undefined, typeFilter);

    // Sort games by date descending (most recent first for easier management)
    // game.date is DD/MM/YYYY — must use parseNormalizedDate, not new Date()
    const sortedGames = games.sort((a, b) => {
      const dateA = parseNormalizedDate(a.date).getTime();
      const dateB = parseNormalizedDate(b.date).getTime();
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
