// app/api/leagues/manage/games/route.ts
// API endpoint for captains to fetch all league games
// Returns games of type N/S A, N/S B, MSL, JSL, BL sorted by date ascending

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames } from '@/lib/friendlies-sheets';
import { LEAGUE_GAME_TYPES } from '@/lib/types/friendlies';

// GET handler - Returns all league games sorted by date ascending
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can access league management
    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch all league games (N/S A, N/S B, MSL, JSL, BL)
    const games = await getGames(undefined, LEAGUE_GAME_TYPES);

    // Sort by date ascending (upcoming first)
    const sortedGames = games.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateA - dateB;
    });

    return NextResponse.json({ games: sortedGames });
  } catch (error) {
    console.error('Error fetching league games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch league games' },
      { status: 500 }
    );
  }
}
