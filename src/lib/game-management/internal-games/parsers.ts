// lib/game-management/internal-games/parsers.ts
// Internal Games-specific parsing functions
// Converts Google Sheets rows into InternalGame and InternalGamePlayer objects

import type { InternalGame, InternalGamePlayer } from '../types';
import type { GameStatus, SelectionStatus, Position, ConfirmationStatus } from '../types';

/**
 * Format date from DD/MM/YYYY to DD MMM YY
 * @param dateStr Date string in DD/MM/YYYY format
 * @returns Formatted date like "13 Jan 25"
 */
function formatTabDate(dateStr: string): string {
  if (!dateStr) return '';

  // Parse DD/MM/YYYY
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;

  const day = parts[0];
  const month = parts[1];
  const year = parts[2].slice(-2); // Get last 2 digits of year

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = monthNames[parseInt(month) - 1] || month;

  return `${day} ${monthName} ${year}`;
}

/**
 * Parse a row from the InternalGames sheet into an InternalGame object
 * @param row Raw row data from Google Sheets
 * @param rowNumber Row number in sheet (for updates)
 * @param colMap Column name to index mapping
 * @returns Parsed InternalGame object
 */
export function parseInternalGameRow(
  row: any[],
  rowNumber: number,
  colMap: Record<string, number>
): InternalGame {
  // Helper to get string value from column
  const get = (field: string): string => {
    const index = colMap[field];
    if (index === undefined) return '';
    return row[index] || '';
  };

  // Helper to get integer value from column
  const getInt = (field: string): number => {
    const val = get(field);
    if (!val) return 0;
    const parsed = parseInt(val);
    return isNaN(parsed) ? 0 : parsed;
  };

  // Get date and calculate tabDate
  const date = get('date');
  const tabDate = formatTabDate(date);

  // Get tab name from sheet (populated by system when game opens/closes)
  // If empty, calculate it as fallback
  const gameName = get('game_name');
  let tabName = get('tab_name');
  if (!tabName) {
    tabName = `${gameName} ${tabDate}`;
  }

  return {
    // Base game fields
    tabDate,
    tabName,
    date,
    time: get('time'),
    status: get('status') as GameStatus,
    maxPlayers: getInt('max_capacity'), // 0 means no limit
    entered: getInt('entered'),
    selected: getInt('selected'),
    reserves: getInt('reserves'),

    // Format fields (required for internal games)
    format: get('format') || 'Rinks',
    ladiesMen: get('ladies_men') || 'Men',
    dress: get('dress') || 'Whites',

    // Internal games-specific fields
    gameName: get('game_name'),
    location: get('location') || undefined,
    description: get('description') || undefined,
    detailsUrl: get('details_url') || undefined,

    // Internal tracking
    _rowNumber: rowNumber,
  };
}

/**
 * Parse a row from an internal game sheet into an InternalGamePlayer object
 * @param row Raw row data from Google Sheets
 * @param rowNumber Row number in sheet (for updates)
 * @param colMap Column name to index mapping
 * @returns Parsed InternalGamePlayer object
 */
export function parseInternalGamePlayerRow(
  row: any[],
  rowNumber: number,
  colMap: Record<string, number>
): InternalGamePlayer {
  // Helper to get string value from column
  const get = (field: string): string => {
    const index = colMap[field];
    if (index === undefined) return '';
    return row[index] || '';
  };

  // Helper to get team number (null if empty or invalid)
  const getTeam = (field: string): number | null => {
    const val = get(field);
    if (!val) return null;
    const parsed = parseInt(val);
    return isNaN(parsed) ? null : parsed;
  };

  return {
    // Base player fields
    rowNumber,
    name: get('user_name'),
    status: (get('status') || '') as ConfirmationStatus,

    // Competitive player fields (no stats, no captain, no driving for internal games)
    selected: (get('selected') || '') as SelectionStatus,
    team: getTeam('team'),
    position: (get('position') || '') as Position,
    driverBar: '', // Internal games don't use driver/bar
  };
}

/**
 * Field map for updating internal game players
 * Maps high-level field names to Google Sheets column names
 */
export const INTERNAL_GAME_PLAYER_FIELD_MAP: Record<string, string> = {
  selected: 'selected',
  team: 'team',
  position: 'position',
  status: 'status',
};
