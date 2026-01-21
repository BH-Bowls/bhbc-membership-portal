// app/api/internal-games/games/route.ts
// API endpoint to fetch all internal games with user's entry status

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getInternalGames } from '@/lib/internal-games-sheets';
import { InternalGamesConfig, getSpreadsheetId } from '@/lib/game-management/config';
import { getGoogleSheetsClient } from '@/lib/sheets';

// GET handler - Returns list of internal games with user's entry status
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all internal games
    const games = await getInternalGames();

    // Get current user's username
    const userName = session.user.userName;

    // Fetch Players sheet to check user's entry status for each game
    const sheets = getGoogleSheetsClient();
    const spreadsheetId = getSpreadsheetId(InternalGamesConfig);

    const playersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${InternalGamesConfig.membersSheetName}!A:ZZ`,
    });

    const rows = playersResponse.data.values || [];
    const headers = rows[0] || [];

    // Build column map
    const colMap: { [key: string]: number } = {};
    headers.forEach((header: string, index: number) => {
      const normalized = String(header).toLowerCase().trim().replace(/\s+/g, '_');
      colMap[normalized] = index;
    });

    // Find user's row
    const userNameColIndex = colMap['user_name'] ?? 0;
    let userRow: string[] | null = null;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][userNameColIndex] === userName) {
        userRow = rows[i];
        break;
      }
    }

    // Add userEntered status to each game
    const gamesWithUserStatus = games.map(game => {
      let userEntered = false;
      let userStatus: string | null = null;

      if (userRow) {
        // Find the column for this game
        const gameColIndex = headers.findIndex((h: string) => h === game.tabName);
        if (gameColIndex !== -1) {
          const status = userRow[gameColIndex];
          if (status) {
            userEntered = true;
            userStatus = status;
          }
        }
      }

      return {
        ...game,
        userEntered,
        userStatus,
      };
    });

    return NextResponse.json({ games: gamesWithUserStatus });
  } catch (error) {
    console.error('[Internal Games API] Error fetching games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
