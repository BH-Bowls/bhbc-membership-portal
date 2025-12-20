// POST /api/friendlies/confirm - Confirm participation in a selected game
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, updateGameSheet } from '@/lib/friendlies-sheets';
import { ConfirmParticipationRequest } from '@/lib/types/friendlies';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: ConfirmParticipationRequest = await request.json();
    const { tab_date } = body;
    const userName = session.user.userName;

    // Get game details
    const games = await getGames();
    const game = games.find(g => g.tabDate === tab_date);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Verify game status is S (Selected)
    if (game.status !== 'S') {
      return NextResponse.json(
        { error: 'Can only confirm participation for selected games' },
        { status: 400 }
      );
    }

    // Get game sheet
    const players = await getGameSheet(game.tabName);

    // Find user's row
    const userPlayer = players.find(p => p.name === userName);

    if (!userPlayer) {
      return NextResponse.json(
        { error: 'You are not in this game' },
        { status: 404 }
      );
    }

    // Verify user is selected (Y/R/T)
    if (!['Y', 'R', 'T'].includes(userPlayer.selected)) {
      return NextResponse.json(
        { error: 'You have not been selected for this game' },
        { status: 400 }
      );
    }

    // Update status column (K) to "Y"
    await updateGameSheet(game.tabName, [
      {
        rowNumber: userPlayer.rowNumber,
        status: 'Y',
      },
    ]);

    return NextResponse.json({
      success: true,
      message: 'Participation confirmed',
    });
  } catch (error) {
    console.error('Error confirming participation:', error);
    return NextResponse.json(
      { error: 'Failed to confirm participation' },
      { status: 500 }
    );
  }
}
