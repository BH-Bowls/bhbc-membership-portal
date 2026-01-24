// app/api/internal-games/withdraw/route.ts
// API endpoint for players to withdraw from an internal game

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getInternalGames, updatePlayerEntry, updateGameCounts } from '@/lib/internal-games-sheets';
import { InternalGamesConfig, getSpreadsheetId } from '@/lib/game-management/config';
import { getGoogleSheetsClient } from '@/lib/sheets';

interface WithdrawRequest {
  tab_name: string;
}

// POST handler - Withdraws user from a game
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: WithdrawRequest = await request.json();
    const { tab_name } = body;

    // Get current user's username
    const userName = session.user.userName;

    // Fetch all games
    const games = await getInternalGames();

    // Find the game
    const game = games.find(g => g.tabName === tab_name);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Only allow withdrawal from Open games
    if (game.status !== 'O') {
      return NextResponse.json(
        { error: 'Can only withdraw from Open games' },
        { status: 400 }
      );
    }

    // Remove player's entry from Players sheet
    await updatePlayerEntry(userName, game.tabName, '');

    // Recalculate entered count
    const sheets = getGoogleSheetsClient();
    const spreadsheetId = getSpreadsheetId(InternalGamesConfig);

    const playersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${InternalGamesConfig.membersSheetName}!A:ZZ`,
    });

    const rows = playersResponse.data.values || [];
    const headers = rows[0] || [];

    // Find game column
    let gameColIndex = -1;
    for (let i = 0; i < headers.length; i++) {
      if (headers[i] === game.tabName) {
        gameColIndex = i;
        break;
      }
    }

    // Update entered count
    if (gameColIndex !== -1) {
      let enteredCount = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][gameColIndex]) {
          enteredCount++;
        }
      }
      await updateGameCounts(game.tabName, { entered: enteredCount });
    }

    return NextResponse.json({
      success: true,
      message: 'Entry removed',
    });
  } catch (error) {
    console.error('Error withdrawing from game:', error);
    return NextResponse.json(
      { error: 'Failed to withdraw from game' },
      { status: 500 }
    );
  }
}
