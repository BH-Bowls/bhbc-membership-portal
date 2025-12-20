// POST /api/friendlies/manage/update-stats - Update Players sheet from game selections
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, updatePlayerEntry } from '@/lib/friendlies-sheets';
import { UpdateStatsRequest, UpdateStatsResponse } from '@/lib/types/friendlies';

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

    const body: UpdateStatsRequest = await request.json();
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

    // Get all players from game sheet
    const players = await getGameSheet(game.tabName);

    let statsUpdated = 0;

    // Update Players sheet based on selection status
    for (const player of players) {
      let newStatus = '';

      switch (player.selected) {
        case 'Y':
          newStatus = 'P'; // Playing
          break;
        case 'R':
          newStatus = 'R'; // Reserve
          break;
        case 'T':
          newStatus = 'T'; // Reserve Team
          break;
        case 'A':
          newStatus = 'A'; // Available (not used in current spec but keeping for compatibility)
          break;
        default:
          newStatus = 'E'; // Still entered but not selected
      }

      // Append 'W' if withdrawn
      if (player.status === 'W') {
        newStatus = newStatus + 'W';
      }

      await updatePlayerEntry(player.name, game.tabName, newStatus as any);
      statsUpdated++;
    }

    const response: UpdateStatsResponse = {
      success: true,
      stats_updated: statsUpdated,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error updating stats to Players sheet:', error);
    return NextResponse.json(
      { error: 'Failed to update stats' },
      { status: 500 }
    );
  }
}
