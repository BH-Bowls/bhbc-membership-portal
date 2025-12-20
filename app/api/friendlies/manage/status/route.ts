// POST /api/friendlies/manage/status - Change game status (Captain/Admin only)
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getGames,
  updateGameStatus,
  createGameColumn,
  createGameSheet,
} from '@/lib/friendlies-sheets';
import { ChangeStatusRequest, ChangeStatusResponse, GameStatus } from '@/lib/types/friendlies';

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

    const body: ChangeStatusRequest = await request.json();
    const { tab_date, action, bhbc_score, opponent_score, reason, who } = body;

    // Get current game
    const games = await getGames();
    const game = games.find(g => g.tabDate === tab_date);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const currentStatus = game.status || '';
    let newStatus: GameStatus = currentStatus;
    let gameSheetCreated = false;

    // Handle different actions
    switch (action) {
      case 'open':
        if (currentStatus !== '') {
          return NextResponse.json(
            { error: 'Can only open games with blank status' },
            { status: 400 }
          );
        }
        newStatus = 'O';
        // Create column in Players sheet
        await createGameColumn(game.tabName);
        break;

      case 'close':
        if (currentStatus !== 'O') {
          return NextResponse.json(
            { error: 'Can only close games with Open status' },
            { status: 400 }
          );
        }
        newStatus = 'X';
        // Create game sheet
        await createGameSheet(tab_date, game.tabName);
        gameSheetCreated = true;
        break;

      case 'publish':
        if (currentStatus !== 'X') {
          return NextResponse.json(
            { error: 'Can only publish games with Selecting status' },
            { status: 400 }
          );
        }
        newStatus = 'S';
        break;

      case 'played':
        if (currentStatus !== 'S') {
          return NextResponse.json(
            { error: 'Can only mark Selected games as played' },
            { status: 400 }
          );
        }
        if (bhbc_score === undefined || opponent_score === undefined) {
          return NextResponse.json(
            { error: 'Scores required for played status' },
            { status: 400 }
          );
        }
        newStatus = 'P';
        break;

      case 'cancel':
        if (!reason || !who) {
          return NextResponse.json(
            { error: 'Reason and who required for cancelled status' },
            { status: 400 }
          );
        }
        newStatus = 'C';
        break;

      case 'abandon':
        if (currentStatus !== 'S') {
          return NextResponse.json(
            { error: 'Can only abandon Selected games' },
            { status: 400 }
          );
        }
        if (!reason || bhbc_score === undefined || opponent_score === undefined) {
          return NextResponse.json(
            { error: 'Reason and partial scores required for abandoned status' },
            { status: 400 }
          );
        }
        newStatus = 'A';
        break;

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Update game status
    await updateGameStatus(tab_date, newStatus, {
      bhbcScore: bhbc_score,
      opponentScore: opponent_score,
      reason,
      who,
      modifiedBy: session.user.userName,
    });

    const response: ChangeStatusResponse = {
      success: true,
      new_status: newStatus,
      game_sheet_created: gameSheetCreated,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error updating game status:', error);
    return NextResponse.json(
      { error: 'Failed to update game status' },
      { status: 500 }
    );
  }
}
