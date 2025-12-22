// GET /api/friendlies/games - List all games with user's entry status
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getPlayerEntries } from '@/lib/friendlies-sheets';
import { GameStatus } from '@/lib/types/friendlies';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') as GameStatus | null;

    // Get all games (filtered by status if provided)
    const games = await getGames(statusFilter || undefined);

    // Get user's entries
    const userName = session.user.userName;
    const userEntries = await getPlayerEntries(userName);

    console.log(`User ${userName} has ${userEntries.length} entries:`, userEntries.map(e => `${e.tabName}:${e.status}`).join(', '));

    // Map user entries to games
    const gamesWithUserStatus = games.map(game => {
      const entry = userEntries.find(e => e.tabName === game.tabName);
      return {
        ...game,
        userEntered: !!entry,
        userStatus: entry?.status || null,
      };
    });

    const enteredCount = gamesWithUserStatus.filter(g => g.userEntered).length;
    console.log(`Returning ${games.length} games, ${enteredCount} with user entries for ${userName}`);

    return NextResponse.json({ games: gamesWithUserStatus });
  } catch (error) {
    console.error('Error fetching games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
