// GET /api/friendlies/manage/game/[tabDate] - Get game for team selection
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet } from '@/lib/friendlies-sheets';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tabDate: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is Captain or Admin
    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { tabDate } = await params;
    // Note: Despite the param name, this is actually the tabName (sheet name)
    const tabName = decodeURIComponent(tabDate);

    // Get game details
    const games = await getGames();
    const game = games.find(g => g.tabName === tabName);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Verify game status is X or S (Selecting or Selected)
    if (!['X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Game must be in Selecting or Selected status' },
        { status: 400 }
      );
    }

    // Get all players from game sheet
    const players = await getGameSheet(game.tabName);

    return NextResponse.json({
      game: {
        tabDate: game.tabDate,
        date: game.date,
        time: game.time,
        clubName: game.clubName,
        homeAway: game.homeAway,
        format: game.format,
        ladiesMen: game.ladiesMen,
        dress: game.dress,
        status: game.status,
        tabName: game.tabName,
        entered: game.entered,
        selected: game.selected,
        reserves: game.reserves,
      },
      players,
    });
  } catch (error) {
    console.error('Error fetching game for selection:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game' },
      { status: 500 }
    );
  }
}
