// lib/game-management/sheet-operations.ts
// Generic Google Sheets operations for all game management systems
// Provides CRUD operations that work with any GameSystemConfig

import { getGoogleSheetsClient } from '../sheets';
import { getSpreadsheetId } from './config';
import type { GameSystemConfig, BaseGame, BasePlayer } from './types';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Column map cache to avoid repeated API calls
let columnMapCache: { [key: string]: { [key: string]: number } } = {};

/**
 * Get column mapping for a sheet in a specific spreadsheet
 * @param spreadsheetId Spreadsheet ID
 * @param sheetName Sheet name
 * @returns Column name to index mapping
 */
async function getColumnMap(
  spreadsheetId: string,
  sheetName: string
): Promise<{ [key: string]: number }> {
  const cacheKey = `${spreadsheetId}:${sheetName}`;

  if (columnMapCache[cacheKey]) {
    return columnMapCache[cacheKey];
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

  columnMapCache[cacheKey] = map;
  return map;
}

/**
 * Convert column index to letter (A, B, C, ..., Z, AA, AB, ...)
 * @param colIndex Zero-based column index
 * @returns Column letter
 */
function getColumnLetter(colIndex: number): string {
  let letter = '';
  let index = colIndex;

  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }

  return letter;
}

// ============================================================================
// GAME OPERATIONS
// ============================================================================

/**
 * Get all games/events from the Games/Events sheet
 * @param config System configuration
 * @param parseGameFn Function to parse a row into a game object
 * @returns Array of parsed games
 */
export async function getAllGames<T extends BaseGame>(
  config: GameSystemConfig,
  parseGameFn: (row: any[], rowNumber: number, colMap: Record<string, number>) => T
): Promise<T[]> {
  const spreadsheetId = getSpreadsheetId(config);
  const colMap = await getColumnMap(spreadsheetId, config.gamesSheetName);
  const sheets = getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${config.gamesSheetName}!A2:AZ`,
  });

  const rows = response.data.values || [];

  return rows.map((row, index) =>
    parseGameFn(row, index + 2, colMap) // Row 2 is first data row (after header)
  );
}

/**
 * Get a single game/event by tabDate
 * @param config System configuration
 * @param tabDate Unique identifier for the game
 * @param parseGameFn Function to parse a row into a game object
 * @returns Parsed game or null if not found
 */
export async function getGameByTabDate<T extends BaseGame>(
  config: GameSystemConfig,
  tabDate: string,
  parseGameFn: (row: any[], rowNumber: number, colMap: Record<string, number>) => T
): Promise<T | null> {
  const games = await getAllGames(config, parseGameFn);
  return games.find(game => game.tabDate === tabDate) || null;
}

// ============================================================================
// PLAYER OPERATIONS
// ============================================================================

/**
 * Get all players for a specific game
 * @param config System configuration
 * @param tabName Sheet tab name for the game
 * @param parsePlayerFn Function to parse a row into a player object
 * @returns Array of parsed players
 */
export async function getPlayersForGame<T extends BasePlayer>(
  config: GameSystemConfig,
  tabName: string,
  parsePlayerFn: (row: any[], rowNumber: number, colMap: Record<string, number>) => T
): Promise<T[]> {
  const spreadsheetId = getSpreadsheetId(config);

  try {
    const colMap = await getColumnMap(spreadsheetId, tabName);
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A2:AZ`,
    });

    const rows = response.data.values || [];

    return rows.map((row, index) =>
      parsePlayerFn(row, index + 2, colMap)
    );
  } catch (error) {
    console.error(`[getPlayersForGame] Error fetching players from ${tabName}:`, error);
    throw new Error(`Failed to fetch players from ${tabName}`);
  }
}

/**
 * Add a player to a game (offline player addition)
 * @param config System configuration
 * @param tabName Sheet tab name for the game
 * @param userName Username to add
 * @returns Success status
 */
export async function addPlayerToGame(
  config: GameSystemConfig,
  tabName: string,
  userName: string
): Promise<{ success: boolean; error?: string }> {
  const spreadsheetId = getSpreadsheetId(config);

  try {
    const colMap = await getColumnMap(spreadsheetId, tabName);
    const sheets = getGoogleSheetsClient();

    // Check if player already exists
    const existingPlayers = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!A2:AZ`,
    });

    const rows = existingPlayers.data.values || [];
    const nameColIndex = colMap['user_name'];

    for (const row of rows) {
      if (row[nameColIndex] === userName) {
        return {
          success: false,
          error: 'Player already in this game',
        };
      }
    }

    // Add new player row
    const maxCol = Math.max(...Object.values(colMap));
    const newRow: any[] = new Array(maxCol + 1).fill('');

    // Set username
    newRow[colMap['user_name']] = userName;

    // Append row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tabName}!A:AZ`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [newRow],
      },
    });

    return { success: true };
  } catch (error) {
    console.error(`[addPlayerToGame] Error adding ${userName} to ${tabName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add player',
    };
  }
}

/**
 * Update a player's fields in a game
 * @param config System configuration
 * @param tabName Sheet tab name for the game
 * @param rowNumber Row number of the player
 * @param updates Object containing field updates
 * @param fieldMap Mapping of field names to column names
 * @returns Success status
 */
export async function updatePlayer(
  config: GameSystemConfig,
  tabName: string,
  rowNumber: number,
  updates: Record<string, any>,
  fieldMap: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  const spreadsheetId = getSpreadsheetId(config);

  try {
    const colMap = await getColumnMap(spreadsheetId, tabName);
    const sheets = getGoogleSheetsClient();

    // Build batch update data
    const updateData: any[] = [];

    for (const [fieldName, value] of Object.entries(updates)) {
      const colName = fieldMap[fieldName];
      if (colName && colMap[colName] !== undefined) {
        const colLetter = getColumnLetter(colMap[colName]);
        updateData.push({
          range: `${tabName}!${colLetter}${rowNumber}`,
          values: [[value ?? '']],
        });
      }
    }

    if (updateData.length === 0) {
      return {
        success: false,
        error: 'No valid fields to update',
      };
    }

    // Execute batch update
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updateData,
        valueInputOption: 'USER_ENTERED',
      },
    });

    return { success: true };
  } catch (error) {
    console.error(`[updatePlayer] Error updating row ${rowNumber} in ${tabName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update player',
    };
  }
}

// ============================================================================
// MEMBER OPERATIONS
// ============================================================================

/**
 * Get all members for offline player dropdown
 * @param config System configuration
 * @returns Array of members with userName and fullName
 */
export async function getAllMembers(
  config: GameSystemConfig
): Promise<Array<{ userName: string; fullName: string; memberType?: string }>> {
  const spreadsheetId = getSpreadsheetId(config);

  try {
    const colMap = await getColumnMap(spreadsheetId, config.membersSheetName);
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${config.membersSheetName}!A2:AZ`,
    });

    const rows = response.data.values || [];
    const members: Array<{ userName: string; fullName: string; memberType?: string }> = [];

    for (const row of rows) {
      const userName = row[colMap['user_name']] || '';
      const fullName = row[colMap['full_name']] || '';
      const memberType = colMap['member_type'] !== undefined ? row[colMap['member_type']] : undefined;

      if (userName && fullName) {
        members.push({ userName, fullName, memberType });
      }
    }

    return members.sort((a, b) => a.fullName.localeCompare(b.fullName));
  } catch (error) {
    console.error(`[getAllMembers] Error fetching members:`, error);
    throw new Error('Failed to fetch members');
  }
}

