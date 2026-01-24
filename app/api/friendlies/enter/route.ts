// app/api/friendlies/enter/route.ts
// API endpoint for players to enter one or more games
// Updates Players sheet with 'E' status and recalculates entered counts in Games sheet

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, updatePlayerEntry, batchUpdateGameCounts } from '@/lib/friendlies-sheets';
import { EnterGamesRequest, EnterGamesResponse } from '@/lib/types/friendlies';
import { canEnterGame } from '@/lib/game-management/capacity';

// POST handler - Enters user into one or more games
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
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
    const allGames = await getGames();

    // Initialize results array to track success/failure for each game
    const results: EnterGamesResponse['results'] = [];

    // Process each game entry request
    for (const tabName of game_ids) {
      try {
        // Find the game in our games list
        let game = null;
        for (const g of allGames) {
          if (g.tabName === tabName) {
            game = g;
            break;
          }
        }

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
          const capacityCheck = canEnterGame(game, false); // Friendlies don't allow waitlist
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
          // Record error if update fails
          results.push({
            game_id: tabName,
            entered: false,
            error: updateError.message || 'Update failed'
          });
        }
      } catch (error) {
        // Catch any unexpected errors for this game
        results.push({ game_id: tabName, entered: false, error: 'Processing failed' });
      }
    }

    // Update entered counts in Games sheet for all successfully entered games
    // This requires counting actual entries in Players sheet to get accurate totals
    const successfulEntries = results.filter(r => r.entered);

    if (successfulEntries.length > 0) {
      const { getGoogleSheetsClient } = await import('@/lib/sheets');

      // Get Sheets client and spreadsheet ID
      const sheets = getGoogleSheetsClient();
      const spreadsheetId = process.env.FRIENDLIES_SPREADSHEET_ID!;

      // Fetch all Players sheet data once for efficiency
      const playersResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Players!A:ZZ',
      });

      // Extract rows and headers from Players sheet
      const rows = playersResponse.data.values || [];
      const headers = rows[0] || [];

      // Collect all count updates for batch operation
      const countUpdates: { rowNumber: number; counts: { entered: number } }[] = [];

      for (const result of successfulEntries) {
        // Find the game object for this entry
        const game = allGames.find(g => g.tabName === result.game_id);

        if (game) {
          // Find which column in Players sheet corresponds to this game
          const gameColIndex = headers.findIndex((h: string) => h === game.tabName);

          if (gameColIndex !== -1) {
            // Count how many players have entered this game
            let enteredCount = 0;
            for (let i = 1; i < rows.length; i++) {
              if (rows[i][gameColIndex]) {
                enteredCount++;
              }
            }

            // Add to batch updates
            countUpdates.push({
              rowNumber: game.rowNumber,
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
    return NextResponse.json({ success: true, results });
  } catch (error) {
    // Log error and return 500 response
    return NextResponse.json(
      { error: 'Failed to enter games' },
      { status: 500 }
    );
  }
}
