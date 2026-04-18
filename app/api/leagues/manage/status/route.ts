// app/api/leagues/manage/status/route.ts
// API endpoint for captains to record results for league games
// Supports actions: played, cancel, abandon

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getGames,
  getColumnMap,
  getSheetsClient,
  getFriendliesSpreadsheetId,
  getColumnLetter,
} from '@/lib/friendlies-sheets';
import { LEAGUE_GAME_TYPES, GameStatus } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can record league results
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { rowNumber, tabName, action, bhbc_score, opponent_score, reason, who } = body;

    // Validate action
    if (!['played', 'cancel', 'abandon'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be played, cancel, or abandon' },
        { status: 400 }
      );
    }

    // Find the game
    const games = await getGames();
    let game = null;

    if (tabName && tabName.trim() !== '') {
      game = games.find(g => g.tabName === tabName) || null;
    }
    if (!game && rowNumber) {
      game = games.find(g => g.rowNumber === rowNumber) || null;
    }

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Validate this is a league game
    if (!LEAGUE_GAME_TYPES.includes(game.gameType)) {
      return NextResponse.json(
        { error: 'Game is not a league game' },
        { status: 400 }
      );
    }

    // Determine new status and validate required fields
    let newStatus: GameStatus;

    switch (action) {
      case 'played':
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

    // Update the Games sheet
    const spreadsheetId = getFriendliesSpreadsheetId();
    const colMap = await getColumnMap(spreadsheetId, 'Games');
    const sheets = getSheetsClient();

    const updates: { range: string; values: any[][] }[] = [
      {
        range: `Games!${getColumnLetter(colMap['status'])}${game.rowNumber}`,
        values: [[newStatus]],
      },
    ];

    if (bhbc_score !== undefined && colMap['bhbc_score'] !== undefined) {
      updates.push({
        range: `Games!${getColumnLetter(colMap['bhbc_score'])}${game.rowNumber}`,
        values: [[bhbc_score]],
      });
    }

    if (opponent_score !== undefined && colMap['opponent_score'] !== undefined) {
      updates.push({
        range: `Games!${getColumnLetter(colMap['opponent_score'])}${game.rowNumber}`,
        values: [[opponent_score]],
      });
    }

    if (reason && colMap['reason'] !== undefined) {
      updates.push({
        range: `Games!${getColumnLetter(colMap['reason'])}${game.rowNumber}`,
        values: [[reason]],
      });
    }

    if (who && colMap['who'] !== undefined) {
      updates.push({
        range: `Games!${getColumnLetter(colMap['who'])}${game.rowNumber}`,
        values: [[who]],
      });
    }

    if (colMap['last_modified_by'] !== undefined) {
      updates.push({
        range: `Games!${getColumnLetter(colMap['last_modified_by'])}${game.rowNumber}`,
        values: [[session.user.userName]],
      });
    }

    if (colMap['last_modified_date'] !== undefined) {
      updates.push({
        range: `Games!${getColumnLetter(colMap['last_modified_date'])}${game.rowNumber}`,
        values: [[new Date().toISOString()]],
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updates,
        valueInputOption: 'USER_ENTERED',
      },
    });

    return NextResponse.json({ success: true, new_status: newStatus });
  } catch (error) {
    console.error('Error updating league game status:', error);
    return NextResponse.json(
      { error: 'Failed to update league game status' },
      { status: 500 }
    );
  }
}
