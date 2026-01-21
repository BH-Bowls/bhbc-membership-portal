// app/api/internal-games/game/[tabDate]/route.ts
// API endpoint to fetch a single internal game with players

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getInternalGameByTabDate, getInternalGamePlayers } from '@/lib/internal-games-sheets';

// GET handler - Returns game details with players
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tabDate: string }> }
) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tabDate } = await params;

    // Fetch game details
    const game = await getInternalGameByTabDate(tabDate);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Fetch players for this game
    const players = await getInternalGamePlayers(game.tabName);

    return NextResponse.json({ game, players });
  } catch (error) {
    console.error('[Internal Games API] Error fetching game:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game' },
      { status: 500 }
    );
  }
}
