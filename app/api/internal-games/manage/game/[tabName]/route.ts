// app/api/internal-games/manage/game/[tabName]/route.ts
// API endpoint to get game details and entered players for team selection

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getInternalGames, getInternalGamePlayers } from '@/lib/internal-games-sheets';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tabName: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { tabName } = await params;
    const decodedTabName = decodeURIComponent(tabName);

    // Find the game
    const allGames = await getInternalGames();
    const game = allGames.find(g => g.tabName === decodedTabName);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Get players from the game sheet
    let players: any[] = [];
    try {
      players = await getInternalGamePlayers(decodedTabName);
    } catch (err) {
      // Game sheet might not exist yet if game is still open
      console.log('[Internal Games API] Game sheet not found, returning empty players');
    }

    return NextResponse.json({
      game: {
        tabName: game.tabName,
        tabDate: game.tabDate,
        date: game.date,
        time: game.time,
        gameName: game.gameName,
        format: game.format,
        ladiesMen: game.ladiesMen,
        status: game.status,
        entered: game.entered,
        selected: game.selected,
        location: game.location,
      },
      players,
    });
  } catch (error) {
    console.error('[Internal Games API] Error fetching game:', error);
    return NextResponse.json({ error: 'Failed to fetch game' }, { status: 500 });
  }
}
