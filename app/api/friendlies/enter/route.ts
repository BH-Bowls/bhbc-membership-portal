// POST /api/friendlies/enter - Enter one or more games
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, updatePlayerEntry } from '@/lib/friendlies-sheets';
import { EnterGamesRequest, EnterGamesResponse } from '@/lib/types/friendlies';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: EnterGamesRequest = await request.json();
    const { game_ids } = body;

    if (!Array.isArray(game_ids) || game_ids.length === 0) {
      return NextResponse.json(
        { error: 'Invalid game_ids' },
        { status: 400 }
      );
    }

    const userName = session.user.userName;

    // Get all games to verify status
    const allGames = await getGames();

    const results: EnterGamesResponse['results'] = [];

    for (const tabDate of game_ids) {
      try {
        // Verify game exists and is open
        const game = allGames.find(g => g.tabDate === tabDate);
        if (!game) {
          results.push({ game_id: tabDate, entered: false, error: 'Game not found' });
          continue;
        }

        if (game.status !== 'O') {
          results.push({ game_id: tabDate, entered: false, error: 'Game not open for entry' });
          continue;
        }

        // Update player entry to 'E'
        await updatePlayerEntry(userName, game.tabName, 'E');
        results.push({ game_id: tabDate, entered: true });
      } catch (error) {
        console.error(`Error entering game ${tabDate}:`, error);
        results.push({ game_id: tabDate, entered: false, error: 'Update failed' });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('Error entering games:', error);
    return NextResponse.json(
      { error: 'Failed to enter games' },
      { status: 500 }
    );
  }
}
