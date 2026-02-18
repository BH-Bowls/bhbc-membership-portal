// src/lib/invite-games-sheets.ts
// Google Sheets operations for the Invite Games system

import {
  getColumnMap,
  getColumnLetter,
  getGoogleSheetsClient,
  getSpreadsheetId,
} from './sheets';
import { createRowFieldGetter, wrapError } from './banking-sheets';
import type { InviteGame } from '@/types/invite-games';

// ============================================================================
// CONSTANTS
// ============================================================================

const INVITE_GAMES_SHEET = 'InviteGames';
const INVITE_GAMES_RANGE = `${INVITE_GAMES_SHEET}!A2:AZ`;
const HEADER_ROW_OFFSET = 2;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse a Google Sheets row into an InviteGame object
 */
function parseInviteGameRow(
  row: any[],
  rowNumber: number,
  colMap: Record<string, number>
): InviteGame {
  const get = createRowFieldGetter(row, colMap);

  return {
    inviteGameId: get('invite_game_id') || '',
    title: get('title') || '',
    description: get('description') || '',
    closingDate: get('closing_date') || null,
    gameDate: get('game_date') || null,
    createdByUsername: get('created_by_username') || '',
    createdByFullName: '', // Populated by enrichGamesWithNames
    createdAt: get('created_at') || '',
    updatedAt: get('updated_at') || null,
    updatedByUsername: get('updated_by_username') || null,
    _rowNumber: rowNumber,
  };
}

/**
 * Enrich invite games with current full names from Members sheet
 */
async function enrichGamesWithNames(games: InviteGame[]): Promise<InviteGame[]> {
  if (games.length === 0) return games;

  try {
    const { getAllUsers } = await import('./sheets');
    const users = await getAllUsers();

    const nameMap = new Map<string, string>();
    for (const user of users) {
      if (user.userName) {
        nameMap.set(user.userName, user.fullName || user.userName);
      }
    }

    return games.map((game) => ({
      ...game,
      createdByFullName:
        nameMap.get(game.createdByUsername) || game.createdByUsername || 'Unknown',
    }));
  } catch (error) {
    console.error('[enrichGamesWithNames] Error enriching games:', error);
    return games;
  }
}

/**
 * Generate next invite game ID (IG-YYYY-NNN format, resets yearly)
 */
async function generateNextInviteGameId(): Promise<string> {
  const colMap = await getColumnMap(INVITE_GAMES_SHEET);
  const sheets = getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: INVITE_GAMES_RANGE,
  });

  const rows = response.data.values || [];
  const currentYear = new Date().getFullYear();
  let maxNumber = 0;

  for (const row of rows) {
    const id = row[colMap['invite_game_id']];
    const prefix = `IG-${currentYear}-`;
    if (id && typeof id === 'string' && id.startsWith(prefix)) {
      const num = parseInt(id.substring(prefix.length), 10);
      if (!isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  return `IG-${currentYear}-${String(maxNumber + 1).padStart(3, '0')}`;
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Get all invite games, sorted by game date descending (most recent first)
 */
export async function getAllInviteGames(): Promise<InviteGame[]> {
  try {
    const colMap = await getColumnMap(INVITE_GAMES_SHEET);
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: INVITE_GAMES_RANGE,
    });

    const rows = response.data.values || [];
    const games = rows.map((row, index) =>
      parseInviteGameRow(row, index + HEADER_ROW_OFFSET, colMap)
    );

    const enriched = await enrichGamesWithNames(games);

    // Sort by game date descending, nulls last
    return enriched.sort((a, b) => {
      if (!a.gameDate && !b.gameDate) return 0;
      if (!a.gameDate) return 1;
      if (!b.gameDate) return -1;
      return b.gameDate.localeCompare(a.gameDate);
    });
  } catch (error) {
    console.error('[getAllInviteGames] Error:', error);
    throw wrapError('Failed to fetch invite games', error);
  }
}

/**
 * Get a single invite game by ID
 */
export async function getInviteGameById(inviteGameId: string): Promise<InviteGame | null> {
  try {
    const games = await getAllInviteGames();
    return games.find((g) => g.inviteGameId === inviteGameId) || null;
  } catch (error) {
    console.error(`[getInviteGameById] Error for ${inviteGameId}:`, error);
    throw wrapError(`Failed to fetch invite game ${inviteGameId}`, error);
  }
}

/**
 * Create a new invite game
 */
export async function createInviteGame(data: {
  title: string;
  description: string;
  closingDate: string | null;
  gameDate: string | null;
  createdByUsername: string;
}): Promise<{ success: boolean; inviteGameId?: string; error?: string }> {
  try {
    const colMap = await getColumnMap(INVITE_GAMES_SHEET);
    const sheets = getGoogleSheetsClient();

    const inviteGameId = await generateNextInviteGameId();
    const now = new Date().toISOString();

    const maxCol = Math.max(...Object.values(colMap));
    const newRow: any[] = new Array(maxCol + 1).fill('');

    newRow[colMap['invite_game_id']] = inviteGameId;
    newRow[colMap['title']] = data.title;
    newRow[colMap['description']] = data.description;
    newRow[colMap['closing_date']] = data.closingDate || '';
    newRow[colMap['game_date']] = data.gameDate || '';
    newRow[colMap['created_by_username']] = data.createdByUsername;
    newRow[colMap['created_at']] = now;
    newRow[colMap['updated_at']] = now;
    newRow[colMap['updated_by_username']] = data.createdByUsername;

    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: `${INVITE_GAMES_SHEET}!A:AZ`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });

    return { success: true, inviteGameId };
  } catch (error) {
    console.error('[createInviteGame] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create invite game',
    };
  }
}

/**
 * Update an existing invite game
 */
export async function updateInviteGame(
  inviteGameId: string,
  updates: Partial<Pick<InviteGame, 'title' | 'description' | 'closingDate' | 'gameDate'>>,
  updatedByUsername: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const game = await getInviteGameById(inviteGameId);

    if (!game || !game._rowNumber) {
      return { success: false, error: 'Invite game not found' };
    }

    const colMap = await getColumnMap(INVITE_GAMES_SHEET);
    const sheets = getGoogleSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    const rowNumber = game._rowNumber;

    const fieldMap: Record<string, string> = {
      title: 'title',
      description: 'description',
      closingDate: 'closing_date',
      gameDate: 'game_date',
    };

    const updateData: { range: string; values: any[][] }[] = [];

    for (const [jsKey, sheetCol] of Object.entries(fieldMap)) {
      if (jsKey in updates) {
        const value = (updates as any)[jsKey];
        if (colMap[sheetCol] !== undefined) {
          const col = getColumnLetter(colMap[sheetCol]);
          updateData.push({
            range: `${INVITE_GAMES_SHEET}!${col}${rowNumber}`,
            values: [[value ?? '']],
          });
        }
      }
    }

    // Always update metadata
    const now = new Date().toISOString();
    if (colMap['updated_at'] !== undefined) {
      const col = String.fromCharCode(65 + colMap['updated_at']);
      updateData.push({ range: `${INVITE_GAMES_SHEET}!${col}${rowNumber}`, values: [[now]] });
    }
    if (colMap['updated_by_username'] !== undefined) {
      const col = String.fromCharCode(65 + colMap['updated_by_username']);
      updateData.push({
        range: `${INVITE_GAMES_SHEET}!${col}${rowNumber}`,
        values: [[updatedByUsername]],
      });
    }

    if (updateData.length === 0) {
      return { success: true };
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updateData,
        valueInputOption: 'USER_ENTERED',
      },
    });

    return { success: true };
  } catch (error) {
    console.error(`[updateInviteGame] Error for ${inviteGameId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update invite game',
    };
  }
}

/**
 * Delete an invite game row from the sheet
 */
export async function deleteInviteGame(
  inviteGameId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const game = await getInviteGameById(inviteGameId);

    if (!game || !game._rowNumber) {
      return { success: false, error: 'Invite game not found' };
    }

    const sheets = getGoogleSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    const rowNumber = game._rowNumber;

    // Get sheet ID
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = spreadsheet.data.sheets?.find(
      (s) => s.properties?.title === INVITE_GAMES_SHEET
    );

    if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
      return { success: false, error: 'InviteGames sheet not found' };
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: sheet.properties.sheetId,
                dimension: 'ROWS',
                startIndex: rowNumber - 1, // 0-indexed
                endIndex: rowNumber,
              },
            },
          },
        ],
      },
    });

    return { success: true };
  } catch (error) {
    console.error(`[deleteInviteGame] Error for ${inviteGameId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete invite game',
    };
  }
}
