// app/api/internal-games/enter/route.ts
// API endpoint for players to enter one or more internal games
// Updates Players sheet with 'E' status and recalculates entered counts in Games sheet

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getInternalGames, updatePlayerEntry, batchUpdateGameCounts } from '@/lib/internal-games-sheets';
import { InternalGamesConfig, getSpreadsheetId } from '@/lib/game-management/config';
import { getGoogleSheetsClient } from '@/lib/sheets';
import { canEnterGame } from '@/lib/game-management/capacity';

interface EnterGamesRequest {
  game_ids: string[];
}

interface EnterGameResult {
  game_id: string;
  entered: boolean;
  error?: string;
}

interface EnterGamesResponse {
  success: boolean;
  results: EnterGameResult[];
}

// POST handler - Enters user into one or more games
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: EnterGamesRequest = await request.json();
    const { game_ids } = body;

    // Validate game_ids is a non-empty array
    if (!Array.isArray(game_ids) || game_ids.length === 0) {
      return NextResponse.json(
        { error: 'Invalid game_ids' },
        { status: 400 }
      );
    }

    // Get current user's username
    const userName = session.user.userName;

    // Fetch all games to verify each game exists and is open
    const allGames = await getInternalGames();

    // Initialize results array
    const results: EnterGameResult[] = [];

    // Process each game entry request
    for (const tabName of game_ids) {
      try {
        // Find the game in our games list
        const game = allGames.find(g => g.tabName === tabName);

        // Skip if game doesn't exist
        if (!game) {
          results.push({ game_id: tabName, entered: false, error: 'Game not found' });
          continue;
        }

        // Only allow entry if game status is 'O' (Open)
        if (game.status !== 'O') {
          results.push({ game_id: tabName, entered: false, error: 'Game not open for entry' });
          continue;
        }

        // Check capacity limits (if maxPlayers is set)
        if (game.maxPlayers && game.maxPlayers > 0) {
          const capacityCheck = canEnterGame(game, false); // Internal games don't allow waitlist
          if (!capacityCheck.canEnter) {
            results.push({
              game_id: tabName,
              entered: false,
              error: capacityCheck.reason || 'Cannot enter game'
            });
            continue;
          }
        }

        // Update this user's entry in Players sheet to 'E' (Entered)
        try {
          await updatePlayerEntry(userName, game.tabName, 'E');
          results.push({ game_id: tabName, entered: true });
        } catch (updateError: any) {
          results.push({
            game_id: tabName,
            entered: false,
            error: updateError.message || 'Update failed'
          });
        }
      } catch (error) {
        results.push({ game_id: tabName, entered: false, error: 'Processing failed' });
      }
    }

    // Update entered counts in Games sheet for successfully entered games
    const successfulEntries = results.filter(r => r.entered);

    if (successfulEntries.length > 0) {
      const sheets = getGoogleSheetsClient();
      const spreadsheetId = getSpreadsheetId(InternalGamesConfig);

      // Fetch all Players sheet data once for efficiency
      const playersResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${InternalGamesConfig.membersSheetName}!A:ZZ`,
      });

      const rows = playersResponse.data.values || [];
      const headers = rows[0] || [];

      // Collect all count updates for batch operation
      const countUpdates: { rowNumber: number; counts: { entered: number } }[] = [];

      for (const result of successfulEntries) {
        const game = allGames.find(g => g.tabName === result.game_id);

        if (game && game._rowNumber) {
          // Find game column index
          const gameColIndex = headers.findIndex((h: string) => h === game.tabName);

          if (gameColIndex !== -1) {
            // Count players who have entered this game
            let enteredCount = 0;
            for (let i = 1; i < rows.length; i++) {
              if (rows[i][gameColIndex]) {
                enteredCount++;
              }
            }

            // Add to batch updates
            countUpdates.push({
              rowNumber: game._rowNumber,
              counts: { entered: enteredCount },
            });
          }
        }
      }

      // Batch update all counts in a single API call
      if (countUpdates.length > 0) {
        await batchUpdateGameCounts(countUpdates);
      }
    }

    // Return success response with results for each game
    const response: EnterGamesResponse = { success: true, results };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error entering games:', error);
    return NextResponse.json(
      { error: 'Failed to enter games' },
      { status: 500 }
    );
  }
}
