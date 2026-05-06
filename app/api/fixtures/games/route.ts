// app/api/fixtures/games/route.ts
// Public fixtures endpoint — returns all game types, sorted by date ascending
// Available to any authenticated user

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames } from '@/lib/friendlies-sheets';
import { hasRole } from '@/lib/role-utils';

export async function GET(request: NextRequest) {
  try {
    // Check session to determine if user is Admin (Test games are Admin-only)
    const session = await getServerSession(authOptions);
    const isAdmin = hasRole(session?.user?.role, 'Admin');

    // Return all game types (no type filter), then exclude Test games for non-admins
    const allGames = await getGames();
    const games = isAdmin ? allGames : allGames.filter(g => g.gameType !== 'Test');

    // Sort by date ascending (upcoming first)
    const sortedGames = games.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateA - dateB;
    });

    return NextResponse.json({ games: sortedGames });
  } catch (error) {
    console.error('Error fetching fixtures:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fixtures' },
      { status: 500 }
    );
  }
}
