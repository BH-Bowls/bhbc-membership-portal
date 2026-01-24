// app/api/internal-games/entered-players/route.ts
// API endpoint to get list of players who have entered an internal game

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getEnteredPlayers } from '@/lib/internal-games-sheets';

// GET handler - Returns list of entered players with their status
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get gameId from query params
    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get('gameId');

    if (!gameId) {
      return NextResponse.json({ error: 'gameId is required' }, { status: 400 });
    }

    // Fetch entered players
    const players = await getEnteredPlayers(gameId);

    return NextResponse.json({ success: true, players });
  } catch (error) {
    console.error('[Internal Games API] Error fetching entered players:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entered players' },
      { status: 500 }
    );
  }
}
