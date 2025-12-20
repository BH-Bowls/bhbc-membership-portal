// POST /api/friendlies/manage/get-stats - Update game sheet with latest stats
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, updateGameSheetStats } from '@/lib/friendlies-sheets';
import { GetStatsRequest } from '@/lib/types/friendlies';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is Captain or Admin
    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body: GetStatsRequest = await request.json();
    const { tab_date } = body;

    // Get game details
    const games = await getGames();
    const game = games.find(g => g.tabDate === tab_date);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Verify game status is X or S
    if (!['X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Can only update stats for Selecting or Selected games' },
        { status: 400 }
      );
    }

    // Update stats for all players in game sheet
    const playersUpdated = await updateGameSheetStats(game.tabName);

    return NextResponse.json({
      success: true,
      players_updated: playersUpdated,
      message: 'Stats updated successfully',
    });
  } catch (error) {
    console.error('Error updating stats:', error);
    return NextResponse.json(
      { error: 'Failed to update stats' },
      { status: 500 }
    );
  }
}
