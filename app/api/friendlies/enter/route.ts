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
        try {
          await updatePlayerEntry(userName, game.tabName, 'E');
          results.push({ game_id: tabDate, entered: true });
        } catch (updateError: any) {
          results.push({
            game_id: tabDate,
            entered: false,
            error: updateError.message || 'Update failed'
          });
        }
      } catch (error) {
        results.push({ game_id: tabDate, entered: false, error: 'Processing failed' });
      }
    }

    // Update entered counts for all successfully entered games by counting entries in Players sheet
    const successfulEntries = results.filter(r => r.entered);
    if (successfulEntries.length > 0) {
      const { updateGameCounts } = await import('@/lib/friendlies-sheets');
      const { getGoogleSheetsClient } = await import('@/lib/sheets');
      const sheets = getGoogleSheetsClient();
      const spreadsheetId = process.env.FRIENDLIES_SPREADSHEET_ID!;

      // Get all Players sheet data once
      const playersResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Players!A:ZZ',
      });

      const rows = playersResponse.data.values || [];
      const headers = rows[0] || [];

      for (const result of successfulEntries) {
        const game = allGames.find(g => g.tabDate === result.game_id);
        if (game) {
          // Find the column for this game
          const gameColIndex = headers.findIndex(h => h === game.tabName);
          if (gameColIndex !== -1) {
            // Count non-empty entries in this column (skip header row)
            const enteredCount = rows.slice(1).filter(row => row[gameColIndex]).length;
            await updateGameCounts(result.game_id, { entered: enteredCount });
          }
        }
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to enter games' },
      { status: 500 }
    );
  }
}
