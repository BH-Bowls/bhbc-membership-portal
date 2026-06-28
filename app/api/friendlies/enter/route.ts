// app/api/friendlies/enter/route.ts
// API endpoint for players to enter one or more games
// Updates Players sheet with 'E' status and recalculates entered counts in Games sheet

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAppUrl } from '@/lib/app-url';
import { getGames, updatePlayerEntry, batchUpdateGameCounts, addPlayerToGameSheet } from '@/lib/friendlies-sheets';
import { clearDiaryCache } from '@/lib/home-cache';
import { EnterGamesRequest, EnterGamesResponse } from '@/lib/types/friendlies';
import { canEnterGame } from '@/lib/game-management/capacity';
import { getUserByUsername } from '@/lib/sheets';
import { sendEntryConfirmedEmail, sendLinkedEntryConfirmedEmail } from '@/lib/email/friendlies';

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
    const { game_ids, car_numbers } = body;

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

    // Process all game entries in parallel — each game writes to a different
    // column in Players sheet and a different game sheet tab, so no conflicts.
    const results: EnterGamesResponse['results'] = await Promise.all(
      game_ids.map(async (tabName) => {
        try {
          const game = allGames.find(g => g.tabName === tabName);

          if (!game) return { game_id: tabName, entered: false, error: 'Game not found' };
          if (game.status !== 'O') return { game_id: tabName, entered: false, error: 'Game not open for entry' };

          if (game.maxPlayers && game.maxPlayers > 0) {
            const capacityCheck = canEnterGame(game, false); // Friendlies don't allow waitlist
            if (!capacityCheck.canEnter) {
              return { game_id: tabName, entered: false, error: capacityCheck.reason || 'Cannot enter game' };
            }
          }

          try {
            await updatePlayerEntry(userName, game.tabName, 'E');
            const gameCarNumber = car_numbers?.[tabName];
            // Open-game entry — skip stat computation (stats are snapshotted at close)
            await addPlayerToGameSheet(game.tabName, userName, 'R', gameCarNumber, false);
            return { game_id: tabName, entered: true };
          } catch (updateError: any) {
            return { game_id: tabName, entered: false, error: updateError.message || 'Update failed' };
          }
        } catch {
          return { game_id: tabName, entered: false, error: 'Processing failed' };
        }
      })
    );

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
            // Count active entries only — exclude withdrawn (ending in W) and empty cells.
            // A game reopened from X/S status may have PW/RW/EW entries in the Players
            // sheet for players who withdrew before the reopen; they must not inflate the count.
            let enteredCount = 0;
            for (let i = 1; i < rows.length; i++) {
              const status = (rows[i][gameColIndex] || '').toString();
              if (status && !status.endsWith('W')) {
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

    // Send entry confirmation emails (fire-and-forget — failures do not affect the response)
    if (successfulEntries.length > 0) {
      try {
        const user = await getUserByUsername(userName);
        if (user?.emailAddress) {
          const fullName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : userName);
          const appUrl = await getAppUrl();

          // Group entries: paired games on the same date → one combined email; others individual
          const successfulGames = successfulEntries
            .map(r => allGames.find(g => g.tabName === r.game_id))
            .filter((g): g is typeof allGames[0] => !!g);

          const emailed = new Set<string>();
          for (const game of successfulGames) {
            if (emailed.has(game.tabName)) continue;
            if (game.paired === 'Y') {
              const partner = successfulGames.find(g =>
                !emailed.has(g.tabName) &&
                g.tabName !== game.tabName &&
                g.paired === 'Y' &&
                g.date === game.date
              );
              if (partner) {
                await sendLinkedEntryConfirmedEmail(user.emailAddress, userName, fullName, game, partner, appUrl);
                emailed.add(game.tabName);
                emailed.add(partner.tabName);
                continue;
              }
            }
            await sendEntryConfirmedEmail(user.emailAddress, userName, fullName, game, appUrl);
            emailed.add(game.tabName);
          }
        }
      } catch (emailError) {
        console.error('Error sending entry confirmation emails:', emailError);
      }
    }

    // Invalidate the diary cache so the home page reflects the new entry
    clearDiaryCache(userName);

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
