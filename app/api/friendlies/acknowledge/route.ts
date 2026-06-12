// POST /api/friendlies/acknowledge
// Authenticated endpoint — logged-in player acknowledges a game cancellation.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, acknowledgeGameCancellation } from '@/lib/friendlies-sheets';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const tabDate: string = body.tabDate || '';
    if (!tabDate) {
      return NextResponse.json({ error: 'tabDate required' }, { status: 400 });
    }

    const tabName = decodeURIComponent(tabDate);
    const userName = session.user.userName;

    const games = await getGames();
    let game = null;
    for (const g of games) {
      if (g.tabName === tabName) {
        game = g;
        break;
      }
    }
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    if (game.status !== 'C') {
      return NextResponse.json({ error: 'Game is not cancelled' }, { status: 400 });
    }

    // Verify the user is in the player list for this game
    const players = await getGameSheet(tabName);
    let found = false;
    for (const p of players) {
      if (p.name === userName) {
        found = true;
        break;
      }
    }
    if (!found) {
      return NextResponse.json({ error: 'You are not in this game' }, { status: 403 });
    }

    await acknowledgeGameCancellation(tabName, userName);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/friendlies/acknowledge error:', error);
    return NextResponse.json({ error: 'Failed to acknowledge cancellation' }, { status: 500 });
  }
}
