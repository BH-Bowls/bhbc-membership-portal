// app/api/friendlies/manage/update-stats/route.ts
// API endpoint to sync player selection status from game sheet back to Players sheet
// Updates the game column with selection status (P, R, T, D) and recalculates stats
// Stats updated: name_down, picked, percent_played, withdrawn, cancelled

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, getFriendliesSpreadsheetId, getColumnMap, getColumnLetter, getSheetsClient } from '@/lib/friendlies-sheets';
import { UpdateStatsRequest, UpdateStatsResponse } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';

// POST handler - Syncs selection status from game sheet to Players sheet and recalculates stats
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can update player stats/status
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body to get game identifier
    const body: UpdateStatsRequest = await request.json();
    const { tab_name } = body;

    // Fetch all games from Games sheet
    const games = await getGames();

    // Search for the game matching the provided tab_name
    const game = games.find(g => g.tabName === tab_name);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Validate that game is in a status that requires stats updates
    if (!['X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Can only update stats for Selecting or Selected games' },
        { status: 400 }
      );
    }

    // Build a set of cancelled/abandoned tabNames so their entries are never counted
    // as nameDown/picked during stats recalculation (handles any stale P/R/T values
    // that existed before the cancel/abandon action wrote 'C'/'A' to the Players sheet)
    const cancelledTabNames = new Set(
      games
        .filter(g => g.status === 'C' || g.status === 'A')
        .map(g => g.tabName)
        .filter((t): t is string => !!t)
    );

    // Fetch all players from the game sheet
    const gamePlayers = await getGameSheet(game.tabName);

    // Get spreadsheet info
    const spreadsheetId = getFriendliesSpreadsheetId();
    const sheets = getSheetsClient();
    const colMap = await getColumnMap(spreadsheetId, 'Players');

    // Fetch entire Players sheet for batch processing
    const playersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Players!A:ZZ',
    });

    const playersRows = playersResponse.data.values || [];
    const headers = playersRows[0] || [];

    // Find key column indices
    const userNameColIndex = colMap['user_name'] ?? colMap['name'] ?? 0;
    const nameDownColIndex = colMap['name_down'];
    const pickedColIndex = colMap['picked'];
    const percentPlayedColIndex = colMap['percent_played'] ?? colMap['%_played_vs_name_down'];
    const futureEnteredColIndex = colMap['future_entered'];
    const withdrawnColIndex = colMap['withdrawn'];
    const cancelledColIndex = colMap['cancelled'];

    // Find the game column index in headers
    const gameColumnIndex = headers.findIndex((h: string) => h === tab_name);

    if (gameColumnIndex === -1) {
      return NextResponse.json({ error: `Game column not found: ${tab_name}` }, { status: 404 });
    }

    // Build a map of userName -> row index (1-based for sheets)
    const userRowMap: Record<string, number> = {};
    for (let i = 1; i < playersRows.length; i++) {
      const userName = playersRows[i][userNameColIndex];
      if (userName) {
        userRowMap[userName.toLowerCase()] = i + 1; // +1 for 1-based row number
      }
    }

    // Prepare batch updates
    const batchUpdates: { range: string; values: (string | number)[][] }[] = [];

    // First, update game column status for each player in the game sheet
    for (const player of gamePlayers) {
      const playerNameLower = player.name.toLowerCase();
      const rowNumber = userRowMap[playerNameLower];

      if (!rowNumber) {
        console.warn(`[update-stats] Player not found in Players sheet: ${player.name}`);
        continue;
      }

      // Determine the status code from selection
      // D = Down (entered but not selected), P = Picked, R = Reserve, T = Reserve Team
      let newStatus = '';
      switch (player.selected) {
        case 'Y':
          newStatus = 'P';
          break;
        case 'R':
          newStatus = 'R';
          break;
        case 'T':
          newStatus = 'T';
          break;
        default:
          // Not selected - use 'D' (Down) instead of 'E' to show stats were updated
          newStatus = 'D';
      }

      // Append W if player has withdrawn — but preserve the existing Players sheet
      // value (PW/RW/TW/EW) if it was already set correctly by the withdraw route,
      // so we don't overwrite e.g. RW with DW just because selected is now blank.
      if (player.status === 'W') {
        const existingStatus = ((playersRows[rowNumber - 1] || [])[gameColumnIndex] || '').toString().toUpperCase();
        if (existingStatus.endsWith('W')) {
          newStatus = existingStatus;
        } else {
          newStatus = newStatus + 'W';
        }
      }

      // Add update for game column
      const gameColLetter = getColumnLetter(gameColumnIndex);
      batchUpdates.push({
        range: `Players!${gameColLetter}${rowNumber}`,
        values: [[newStatus]],
      });
    }

    // Execute game column updates first
    if (batchUpdates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: batchUpdates,
        },
      });
    }

    // Now refetch Players sheet to recalculate stats for ALL players
    const updatedPlayersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Players!A:ZZ',
    });

    const updatedPlayersRows = updatedPlayersResponse.data.values || [];
    const updatedHeaders = updatedPlayersRows[0] || [];

    // Find all game columns (columns after the fixed stat columns)
    // Fixed columns are typically: user_name, name_down, picked, percent_played, withdrawn, cancelled
    // Game columns come after these
    const fixedColNames = ['user_name', 'name', 'full_name', 'name_down', 'picked', 'percent_played', '%_played_vs_name_down', 'future_entered', 'withdrawn', 'cancelled'];
    const gameColIndices: number[] = [];

    for (let i = 0; i < updatedHeaders.length; i++) {
      const header = updatedHeaders[i];
      if (!header) continue;

      // Normalize header the same way as getColumnMap: lowercase, trim, replace spaces with underscores
      const normalized = String(header).toLowerCase().trim().replace(/\s+/g, '_').replace(/\//g, '_');

      if (!fixedColNames.includes(normalized)) {
        // This is a game column
        gameColIndices.push(i);
      }
    }

    // Prepare stats updates for all players
    const statsUpdates: { range: string; values: (string | number)[][] }[] = [];

    for (let rowIdx = 1; rowIdx < updatedPlayersRows.length; rowIdx++) {
      const row = updatedPlayersRows[rowIdx];
      const userName = row[userNameColIndex];

      if (!userName) continue;

      // Count stats across all game columns
      let nameDown = 0;       // Closed games where player was selected (P/R/T)
      let picked = 0;         // Games actually played (P)
      let futureEntered = 0;  // Open games where player has entered (E/M)
      let withdrawn = 0;
      let cancelled = 0;

      for (const colIdx of gameColIndices) {
        const header = updatedHeaders[colIdx];
        const status = (row[colIdx] || '').toString().toUpperCase();

        if (!status) continue;

        // For cancelled/abandoned games, treat any entry as cancelled regardless of the
        // stored value — prevents stale P/R/T entries from inflating percent_played
        if (cancelledTabNames.has(header)) {
          cancelled++;
          continue;
        }

        // Name Down: only closed-game selected statuses — P, R, T
        // Withdrawn variants (PW, RW, TW) are excluded — player withdrew so should not count
        // D (entered but not selected) and E/M (open games) are also excluded
        if (['P', 'R', 'T'].includes(status)) {
          nameDown++;
        }

        // Count picked: P (and PW) count as picked to play
        if (['P', 'PW'].includes(status)) {
          picked++;
        }

        // Future Entered: open games player has entered but selection not yet done
        // W suffix cannot exist on E/M — withdrawal only happens after selection
        if (['E', 'M'].includes(status)) {
          futureEntered++;
        }

        // Count withdrawn: any status with W suffix
        if (status.endsWith('W')) {
          withdrawn++;
        }

        // Count cancelled: C status (for games not in cancelledTabNames)
        if (status === 'C') {
          cancelled++;
        }
      }

      // Calculate percent played as decimal for percentage-formatted column
      // e.g., 0.50 for 50%, 1.0 for 100%, 0 for 0%
      // Round to whole percentage (no decimal places when displayed)
      const percentPlayed = nameDown > 0 ? Math.round((picked / nameDown) * 100) / 100 : 0;

      const rowNumber = rowIdx + 1; // 1-based row number

      // Add stats updates
      if (nameDownColIndex !== undefined) {
        statsUpdates.push({
          range: `Players!${getColumnLetter(nameDownColIndex)}${rowNumber}`,
          values: [[nameDown]],
        });
      }

      if (pickedColIndex !== undefined) {
        statsUpdates.push({
          range: `Players!${getColumnLetter(pickedColIndex)}${rowNumber}`,
          values: [[picked]],
        });
      }

      if (percentPlayedColIndex !== undefined) {
        statsUpdates.push({
          range: `Players!${getColumnLetter(percentPlayedColIndex)}${rowNumber}`,
          values: [[percentPlayed]],
        });
      }

      if (futureEnteredColIndex !== undefined) {
        statsUpdates.push({
          range: `Players!${getColumnLetter(futureEnteredColIndex)}${rowNumber}`,
          values: [[futureEntered]],
        });
      }

      if (withdrawnColIndex !== undefined) {
        statsUpdates.push({
          range: `Players!${getColumnLetter(withdrawnColIndex)}${rowNumber}`,
          values: [[withdrawn]],
        });
      }

      if (cancelledColIndex !== undefined) {
        statsUpdates.push({
          range: `Players!${getColumnLetter(cancelledColIndex)}${rowNumber}`,
          values: [[cancelled]],
        });
      }
    }

    // Execute stats updates
    if (statsUpdates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: statsUpdates,
        },
      });
    }

    // Build success response
    const response: UpdateStatsResponse = {
      success: true,
      stats_updated: gamePlayers.length,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error updating stats:', error);
    return NextResponse.json(
      { error: 'Failed to update stats' },
      { status: 500 }
    );
  }
}
