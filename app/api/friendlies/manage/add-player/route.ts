// POST /api/friendlies/manage/add-player - Add offline player to game
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, addPlayerToGameSheet } from '@/lib/friendlies-sheets';
import { AddPlayerRequest } from '@/lib/types/friendlies';

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

    const body: AddPlayerRequest = await request.json();
    const { tab_date, user_name } = body;

    if (!tab_date || !user_name) {
      return NextResponse.json(
        { error: 'Missing tab_date or user_name' },
        { status: 400 }
      );
    }

    // Get game details
    const games = await getGames();
    const game = games.find(g => g.tabDate === tab_date);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Verify game status is X (Selecting) or S (Selected)
    if (!['X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Can only add players to games with Selecting or Selected status' },
        { status: 400 }
      );
    }

    // Add player to game sheet (also updates Players sheet)
    await addPlayerToGameSheet(game.tabName, user_name);

    return NextResponse.json({
      success: true,
      message: `Player ${user_name} added to game`,
    });
  } catch (error) {
    console.error('Error adding player:', error);
    return NextResponse.json(
      { error: 'Failed to add player' },
      { status: 500 }
    );
  }
}
