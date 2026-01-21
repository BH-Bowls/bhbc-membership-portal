// src/lib/internal-games-sheets.ts
// Google Sheets operations for Internal Games system
// Uses shared library for common operations

import { InternalGamesConfig, getSpreadsheetId } from './game-management/config';
import { getAllGames, getGameByTabDate, getPlayersForGame, addPlayerToGame, updatePlayer } from './game-management/sheet-operations';
import { parseInternalGameRow, parseInternalGamePlayerRow, INTERNAL_GAME_PLAYER_FIELD_MAP } from './game-management/internal-games/parsers';
import type { InternalGame, InternalGamePlayer, GameStatus } from './game-management/types';
import { getGoogleSheetsClient, getColumnLetter } from './sheets';

// Helper to get Members spreadsheet ID
function getMembersSpreadsheetId(): string {
  const id = process.env.MEMBERS_SPREADSHEET_ID;
  if (!id) {
    throw new Error('MEMBERS_SPREADSHEET_ID environment variable is not set');
  }
  return id;
}

// ============================================================================
// COLUMN MAPPING
// ============================================================================

interface ColumnMapCache {
  [spreadsheetId: string]: {
    [sheetName: string]: { [key: string]: number };
  };
}

let columnMapCache: ColumnMapCache = {};

/**
 * Get column mapping from header row
 * Maps column names to their index positions (0-based)
 */
async function getColumnMap(
  spreadsheetId: string,
  sheetName: string
): Promise<{ [key: string]: number }> {
  // Check cache first
  if (columnMapCache[spreadsheetId]?.[sheetName]) {
    return columnMapCache[spreadsheetId][sheetName];
  }

  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  });

  const headers = response.data.values?.[0] || [];
  const map: { [key: string]: number } = {};

  for (let i = 0; i < headers.length; i++) {
    const normalized = String(headers[i]).toLowerCase().trim().replace(/\s+/g, '_');
    map[normalized] = i;
  }

  // Cache the result
  if (!columnMapCache[spreadsheetId]) {
    columnMapCache[spreadsheetId] = {};
  }
  columnMapCache[spreadsheetId][sheetName] = map;

  return map;
}

/**
 * Get all internal games from InternalGames sheet
 * @returns Array of internal games
 */
export async function getInternalGames(): Promise<InternalGame[]> {
  return getAllGames(InternalGamesConfig, parseInternalGameRow);
}

/**
 * Get a single internal game by tabDate
 * @param tabDate Game identifier (e.g., "13 Jan 25")
 * @returns Internal game or null if not found
 */
export async function getInternalGameByTabDate(tabDate: string): Promise<InternalGame | null> {
  return getGameByTabDate(InternalGamesConfig, tabDate, parseInternalGameRow);
}

/**
 * Get all players for a specific internal game
 * @param tabName Game sheet tab name
 * @returns Array of players
 */
export async function getInternalGamePlayers(tabName: string): Promise<InternalGamePlayer[]> {
  return getPlayersForGame(InternalGamesConfig, tabName, parseInternalGamePlayerRow);
}

/**
 * Add a player to an internal game (offline addition)
 * @param tabName Game sheet tab name
 * @param userName Username to add
 * @returns Success status
 */
export async function addPlayerToInternalGame(
  tabName: string,
  userName: string
): Promise<{ success: boolean; error?: string }> {
  return addPlayerToGame(InternalGamesConfig, tabName, userName);
}

/**
 * Update player selection in an internal game
 * @param tabName Game sheet tab name
 * @param rowNumber Row number of player
 * @param updates Player field updates
 * @returns Success status
 */
export async function updateInternalGamePlayer(
  tabName: string,
  rowNumber: number,
  updates: Partial<InternalGamePlayer>
): Promise<{ success: boolean; error?: string }> {
  return updatePlayer(InternalGamesConfig, tabName, rowNumber, updates, INTERNAL_GAME_PLAYER_FIELD_MAP);
}

/**
 * Get all playing members from the Members sheet for player selection
 * This fetches from the main Members spreadsheet to get fullName and memberType
 * @param playingMembersOnly Only include playing members (PL, PM, Full)
 * @returns Array of members with userName and fullName
 */
export async function getInternalGameMembers(playingMembersOnly: boolean = true): Promise<Array<{ userName: string; fullName: string; memberType?: string }>> {
  const sheets = getGoogleSheetsClient();
  const membersSpreadsheetId = getMembersSpreadsheetId();
  const membersColMap = await getColumnMap(membersSpreadsheetId, 'Members');

  const membersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: membersSpreadsheetId,
    range: 'Members!A:ZZ',
  });

  const membersRows = membersResponse.data.values || [];

  // Return empty array if only header row or no rows at all
  if (membersRows.length <= 1) {
    return [];
  }

  const memberUserNameCol = membersColMap['user_name'] ?? 0;
  let memberFullNameCol = membersColMap['full_name'];
  if (memberFullNameCol === undefined) {
    memberFullNameCol = membersColMap['name'] ?? 1;
  }
  const memberTypeCol = membersColMap['member_type'];

  // Build array of members
  const players: Array<{ userName: string; fullName: string; memberType?: string }> = [];

  for (let i = 1; i < membersRows.length; i++) {
    const memberRow = membersRows[i];
    const userName = memberRow[memberUserNameCol];
    const fullName = memberRow[memberFullNameCol];
    const memberType = memberTypeCol !== undefined ? memberRow[memberTypeCol] : undefined;

    // Only include members with a valid username
    if (userName && userName.trim() !== '') {
      // Filter by playing members if requested (PL=Playing Lady, PM=Playing Man)
      if (playingMembersOnly && memberType) {
        const isPlaying = memberType.startsWith('P') || memberType === 'Full';
        if (!isPlaying) {
          continue; // Skip social members for internal games
        }
      }

      players.push({
        userName: userName.trim(),
        fullName: (fullName || userName).trim(),
        memberType,
      });
    }
  }

  // Sort players alphabetically by full name for easier dropdown selection
  players.sort((a, b) => a.fullName.localeCompare(b.fullName));

  return players;
}

/**
 * Get all players who have entered a specific internal game
 * Returns list of players with their userName, fullName, and status (E or M)
 * @param gameId The game identifier (tabName)
 * @returns Array of entered players with their status
 */
export async function getEnteredPlayers(
  gameId: string
): Promise<Array<{ userName: string; fullName: string; status: 'E' | 'M' }>> {
  const spreadsheetId = getSpreadsheetId(InternalGamesConfig);
  const sheets = getGoogleSheetsClient();
  const playersSheetName = InternalGamesConfig.membersSheetName; // "Players" in Internal Games

  // Fetch header row to find game column
  const headersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${playersSheetName}!1:1`,
  });

  const headers = headersResponse.data.values?.[0] || [];
  const gameColumnIndex = headers.findIndex(h => h === gameId);

  if (gameColumnIndex === -1) {
    throw new Error(`Game column not found: ${gameId}`);
  }

  // Fetch all Players sheet data
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${playersSheetName}!A:ZZ`,
  });

  const rows = response.data.values || [];

  // Get column map for Players sheet to find userName column
  const colMap = await getColumnMap(spreadsheetId, playersSheetName);
  const userNameColIndex = colMap['user_name'] ?? 0;

  // Build a lookup map of userName -> fullName from Members sheet
  const membersSpreadsheetId = getMembersSpreadsheetId();
  const membersColMap = await getColumnMap(membersSpreadsheetId, 'Members');

  const membersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: membersSpreadsheetId,
    range: 'Members!A:ZZ',
  });

  const membersRows = membersResponse.data.values || [];
  const memberUserNameCol = membersColMap['user_name'] ?? 0;
  let memberFullNameCol = membersColMap['full_name'];
  if (memberFullNameCol === undefined) {
    memberFullNameCol = membersColMap['name'] ?? 1;
  }

  // Build lookup map
  const fullNameLookup: { [userName: string]: string } = {};
  for (let i = 1; i < membersRows.length; i++) {
    const memberRow = membersRows[i];
    const memberUserName = memberRow[memberUserNameCol];
    const memberFullName = memberRow[memberFullNameCol];
    if (memberUserName) {
      fullNameLookup[memberUserName] = memberFullName || memberUserName;
    }
  }

  const enteredPlayers: Array<{ userName: string; fullName: string; status: 'E' | 'M' }> = [];

  // Skip header row, iterate through players
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const entryStatus = row[gameColumnIndex];

    // Only include players with E or M status
    if (entryStatus === 'E' || entryStatus === 'M') {
      const userName = row[userNameColIndex] || '';
      // Look up full name from Members sheet
      const fullName = fullNameLookup[userName] || userName;

      enteredPlayers.push({
        userName,
        fullName,
        status: entryStatus as 'E' | 'M',
      });
    }
  }

  return enteredPlayers;
}

/**
 * Get a specific player's entry status for an internal game
 * @param userName Player's username
 * @param gameId Game identifier (tabDate)
 * @returns Status code ('E', 'M', 'S', 'R', etc.) or empty string if not entered
 */
export async function getPlayerEntryStatus(
  userName: string,
  gameId: string
): Promise<string> {
  const spreadsheetId = getSpreadsheetId(InternalGamesConfig);
  const sheets = getGoogleSheetsClient();
  const membersSheetName = InternalGamesConfig.membersSheetName;

  // Fetch header row to find game column
  const headersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${membersSheetName}!1:1`,
  });

  const headers = headersResponse.data.values?.[0] || [];
  const gameColumnIndex = headers.findIndex(h => h === gameId);

  if (gameColumnIndex === -1) {
    throw new Error(`Game column not found: ${gameId}`);
  }

  // Build column map from headers
  const colMap: { [key: string]: number } = {};
  headers.forEach((header: string, index: number) => {
    const normalized = header.toLowerCase().replace(/\s+/g, '_');
    colMap[normalized] = index;
  });

  // Find user's row
  const userNameColIndex = colMap['user_name'] ?? colMap['full_name'] ?? colMap['name'] ?? 0;
  const userNameColLetter = getColumnLetter(userNameColIndex);

  const membersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${membersSheetName}!${userNameColLetter}:${userNameColLetter}`,
  });

  const members = membersResponse.data.values || [];
  const userRowIndex = members.findIndex((row, index) => index > 0 && row[0] === userName);

  if (userRowIndex === -1) {
    return ''; // User not found
  }

  // Get the status from the game column
  const rowNumber = userRowIndex + 1;
  const columnLetter = getColumnLetter(gameColumnIndex);

  const statusResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${membersSheetName}!${columnLetter}${rowNumber}`,
  });

  const status = statusResponse.data.values?.[0]?.[0] || '';
  return status;
}

/**
 * Update a player's entry status for an internal game
 * @param userName Player's username
 * @param gameId Game identifier (tabDate)
 * @param status New status code ('E', 'M', '', etc.)
 */
export async function updatePlayerEntry(
  userName: string,
  gameId: string,
  status: string
): Promise<void> {
  const spreadsheetId = getSpreadsheetId(InternalGamesConfig);
  const sheets = getGoogleSheetsClient();
  const membersSheetName = InternalGamesConfig.membersSheetName;

  // Fetch header row to find game column
  const headersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${membersSheetName}!1:1`,
  });

  const headers = headersResponse.data.values?.[0] || [];
  const gameColumnIndex = headers.findIndex(h => h === gameId);

  if (gameColumnIndex === -1) {
    throw new Error(`Game column not found: ${gameId}`);
  }

  // Build column map from headers
  const colMap: { [key: string]: number } = {};
  headers.forEach((header: string, index: number) => {
    const normalized = header.toLowerCase().replace(/\s+/g, '_');
    colMap[normalized] = index;
  });

  // Find user's row
  const userNameColIndex = colMap['user_name'] ?? colMap['full_name'] ?? colMap['name'] ?? 0;
  const userNameColLetter = getColumnLetter(userNameColIndex);

  const membersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${membersSheetName}!${userNameColLetter}:${userNameColLetter}`,
  });

  const members = membersResponse.data.values || [];
  let userRowIndex = members.findIndex((row, index) => index > 0 && row[0] === userName);

  // If user not found, add them as a new row
  if (userRowIndex === -1) {
    const nextRowNumber = members.length + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${membersSheetName}!${userNameColLetter}${nextRowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[userName]] },
    });
    userRowIndex = nextRowNumber - 1;
  }

  // Update the status in the game column
  const rowNumber = userRowIndex + 1;
  const columnLetter = getColumnLetter(gameColumnIndex);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${membersSheetName}!${columnLetter}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[status]],
    },
  });
}

// ============================================================================
// GAME STATUS MANAGEMENT
// ============================================================================

/**
 * Update game status in Games sheet
 * @param tabName Game tab name to update
 * @param newStatus New status code
 * @param additionalData Optional additional data to update
 */
export async function updateGameStatus(
  tabName: string,
  newStatus: GameStatus,
  additionalData?: {
    reason?: string;
    who?: string;
    modifiedBy?: string;
    rowNumber?: number;
  }
): Promise<void> {
  const spreadsheetId = getSpreadsheetId(InternalGamesConfig);
  const colMap = await getColumnMap(spreadsheetId, InternalGamesConfig.gamesSheetName);
  const sheets = getGoogleSheetsClient();

  // Fetch all games to find the row
  const games = await getInternalGames();

  // Search for the game
  let game: InternalGame | null = null;

  // First try by tabName
  if (tabName && tabName.trim() !== '') {
    game = games.find(g => g.tabName === tabName) || null;
  }

  // If not found, try by rowNumber
  if (!game && additionalData?.rowNumber) {
    game = games.find(g => g._rowNumber === additionalData.rowNumber) || null;
  }

  if (!game || !game._rowNumber) {
    throw new Error(`Game not found - tabName: ${tabName}, rowNumber: ${additionalData?.rowNumber}`);
  }

  // Build updates array
  const updates: any[] = [
    {
      range: `${InternalGamesConfig.gamesSheetName}!${getColumnLetter(colMap['status'])}${game._rowNumber}`,
      values: [[newStatus]],
    },
  ];

  // Update Tab Name when opening or closing
  if ((newStatus === 'O' || newStatus === 'X') && colMap['tab_name'] !== undefined) {
    updates.push({
      range: `${InternalGamesConfig.gamesSheetName}!${getColumnLetter(colMap['tab_name'])}${game._rowNumber}`,
      values: [[tabName]],
    });
  }

  // Add reason if provided (for cancel/abandon)
  if (additionalData?.reason && colMap['reason'] !== undefined) {
    updates.push({
      range: `${InternalGamesConfig.gamesSheetName}!${getColumnLetter(colMap['reason'])}${game._rowNumber}`,
      values: [[additionalData.reason]],
    });
  }

  // Add who if provided (for cancel)
  if (additionalData?.who && colMap['who'] !== undefined) {
    updates.push({
      range: `${InternalGamesConfig.gamesSheetName}!${getColumnLetter(colMap['who'])}${game._rowNumber}`,
      values: [[additionalData.who]],
    });
  }

  // Add audit trail
  if (additionalData?.modifiedBy) {
    if (colMap['last_modified_by'] !== undefined) {
      updates.push({
        range: `${InternalGamesConfig.gamesSheetName}!${getColumnLetter(colMap['last_modified_by'])}${game._rowNumber}`,
        values: [[additionalData.modifiedBy]],
      });
    }
    if (colMap['last_modified_date'] !== undefined) {
      updates.push({
        range: `${InternalGamesConfig.gamesSheetName}!${getColumnLetter(colMap['last_modified_date'])}${game._rowNumber}`,
        values: [[new Date().toISOString()]],
      });
    }
  }

  // Execute batch update
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      data: updates,
      valueInputOption: 'USER_ENTERED',
    },
  });
}

/**
 * Update game counts in Games sheet
 * @param tabName Game tab name
 * @param counts Counts to update
 */
export async function updateGameCounts(
  tabName: string,
  counts: {
    entered?: number;
    selected?: number;
    reserves?: number;
  }
): Promise<void> {
  const spreadsheetId = getSpreadsheetId(InternalGamesConfig);
  const colMap = await getColumnMap(spreadsheetId, InternalGamesConfig.gamesSheetName);
  const sheets = getGoogleSheetsClient();

  const games = await getInternalGames();
  const game = games.find(g => g.tabName === tabName);

  if (!game || !game._rowNumber) {
    throw new Error(`Game not found: ${tabName}`);
  }

  const updates: any[] = [];

  if (counts.entered !== undefined && colMap['entered'] !== undefined) {
    updates.push({
      range: `${InternalGamesConfig.gamesSheetName}!${getColumnLetter(colMap['entered'])}${game._rowNumber}`,
      values: [[counts.entered]],
    });
  }

  if (counts.selected !== undefined && colMap['selected'] !== undefined) {
    updates.push({
      range: `${InternalGamesConfig.gamesSheetName}!${getColumnLetter(colMap['selected'])}${game._rowNumber}`,
      values: [[counts.selected]],
    });
  }

  if (counts.reserves !== undefined && colMap['reserves'] !== undefined) {
    updates.push({
      range: `${InternalGamesConfig.gamesSheetName}!${getColumnLetter(colMap['reserves'])}${game._rowNumber}`,
      values: [[counts.reserves]],
    });
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updates,
        valueInputOption: 'USER_ENTERED',
      },
    });
  }
}

/**
 * Create a new column in the Players sheet for a game
 * Called when game status changes to 'O' (Open)
 * @param tabName Game tab name (becomes column header)
 */
export async function createGameColumn(tabName: string): Promise<void> {
  if (!tabName || tabName.trim() === '') {
    throw new Error('tabName is required and cannot be empty');
  }

  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId(InternalGamesConfig);
  const membersSheetName = InternalGamesConfig.membersSheetName;

  // Fetch header row to find where to add new column
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${membersSheetName}!1:1`,
  });

  const headers = response.data.values?.[0] || [];

  // Check if column already exists
  if (headers.includes(tabName)) {
    console.log(`[createGameColumn] Column ${tabName} already exists`);
    return;
  }

  // Calculate next column
  const nextColumnIndex = headers.length;
  const nextColumn = getColumnLetter(nextColumnIndex);
  const previousColumnIndex = nextColumnIndex - 1;

  // Get sheet metadata for copying formatting
  const spreadsheetMetadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties,data.columnMetadata)',
  });

  const playersSheet = spreadsheetMetadata.data.sheets?.find(
    s => s.properties?.title === membersSheetName
  );

  if (!playersSheet?.properties?.sheetId) {
    throw new Error(`${membersSheetName} sheet not found`);
  }

  const sheetId = playersSheet.properties.sheetId;

  // Insert new column and copy formatting from previous column
  const requests: any[] = [
    {
      insertDimension: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: nextColumnIndex,
          endIndex: nextColumnIndex + 1,
        },
        inheritFromBefore: true,
      },
    },
  ];

  // Copy formatting from previous column if it exists
  if (previousColumnIndex >= 0) {
    requests.push({
      copyPaste: {
        source: {
          sheetId,
          startRowIndex: 0,
          startColumnIndex: previousColumnIndex,
          endColumnIndex: previousColumnIndex + 1,
        },
        destination: {
          sheetId,
          startRowIndex: 0,
          startColumnIndex: nextColumnIndex,
          endColumnIndex: nextColumnIndex + 1,
        },
        pasteType: 'PASTE_FORMAT',
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  // Set the column header
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${membersSheetName}!${nextColumn}1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[tabName]],
    },
  });
}

/**
 * Create a game sheet for team selection
 * Called when game status changes to 'X' (Closed)
 * @param tabName Game tab name (becomes sheet name)
 * @returns Count of entered players
 */
export async function createGameSheet(tabName: string): Promise<{ enteredCount: number }> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId(InternalGamesConfig);
  const membersSheetName = InternalGamesConfig.membersSheetName;

  // Verify game exists
  const games = await getInternalGames();
  const game = games.find(g => g.tabName === tabName);

  if (!game) {
    throw new Error(`Game not found: ${tabName}`);
  }

  // Get spreadsheet metadata
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  // Find template sheet
  let templateSheet = null;
  if (spreadsheet.data.sheets) {
    for (const sheet of spreadsheet.data.sheets) {
      if (sheet.properties?.title === 'Template Game Sheet') {
        templateSheet = sheet;
        break;
      }
    }
  }

  if (!templateSheet?.properties?.sheetId) {
    throw new Error('Template Game Sheet not found');
  }

  // Check if game sheet already exists
  let gameSheetExists = false;
  if (spreadsheet.data.sheets) {
    for (const sheet of spreadsheet.data.sheets) {
      if (sheet.properties?.title === tabName) {
        gameSheetExists = true;
        break;
      }
    }
  }

  // Create sheet if it doesn't exist
  if (!gameSheetExists) {
    // Find Games sheet index for positioning
    let gamesSheetIndex = -1;
    if (spreadsheet.data.sheets) {
      for (let i = 0; i < spreadsheet.data.sheets.length; i++) {
        if (spreadsheet.data.sheets[i].properties?.title === InternalGamesConfig.gamesSheetName) {
          gamesSheetIndex = i;
          break;
        }
      }
    }

    const insertIndex = gamesSheetIndex !== -1 ? gamesSheetIndex + 1 : undefined;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            duplicateSheet: {
              sourceSheetId: templateSheet.properties.sheetId,
              insertSheetIndex: insertIndex,
              newSheetName: tabName,
            },
          },
        ],
      },
    });
  }

  // Fetch players who entered this game
  const playersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${membersSheetName}!A:ZZ`,
  });

  const rows = playersResponse.data.values || [];
  const headers = rows[0] || [];

  // Get column mappings
  const playersColMap = await getColumnMap(spreadsheetId, membersSheetName);

  let userNameColumnIndex = playersColMap['user_name'];
  if (userNameColumnIndex === undefined) {
    userNameColumnIndex = playersColMap['name'] ?? 0;
  }

  // Find game column
  let gameColumnIndex = -1;
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] === tabName) {
      gameColumnIndex = i;
      break;
    }
  }

  if (gameColumnIndex === -1) {
    throw new Error(`Game column not found: ${tabName}`);
  }

  // Build list of entered players
  const enteredPlayers: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const status = rows[i][gameColumnIndex];
    if (status === 'E' || status === 'M') {
      const userName = rows[i][userNameColumnIndex];
      if (userName) {
        enteredPlayers.push(userName);
      }
    }
  }

  // Add players to game sheet
  if (enteredPlayers.length > 0) {
    const playerValues = enteredPlayers.sort().map(name => [name]);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!A2:A${1 + playerValues.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: playerValues,
      },
    });
  }

  // Update entered count in Games sheet
  await updateGameCounts(tabName, { entered: enteredPlayers.length });

  return { enteredCount: enteredPlayers.length };
}
