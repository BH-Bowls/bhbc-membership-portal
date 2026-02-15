// lib/game-management/friendlies/parsers.ts
// Friendlies-specific parsing functions
// Converts Google Sheets rows into FriendlyGame and FriendlyPlayer objects

import type { FriendlyGame, FriendlyPlayer } from '../types';
import type { GameStatus, SelectionStatus, Position, ConfirmationStatus, HomeAway } from '../types';
import { normalizeToUKDate } from '../../date-utils';

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
 * Parse a row from the Games sheet into a FriendlyGame object
 * @param row Raw row data from Google Sheets
 * @param rowNumber Row number in sheet (for updates)
 * @param colMap Column name to index mapping
 * @returns Parsed FriendlyGame object
 */
export function parseFriendlyGameRow(
  row: any[],
  rowNumber: number,
  colMap: Record<string, number>
): FriendlyGame {
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

  // Get date, normalize to DD/MM/YYYY, and calculate tabDate
  const date = normalizeToUKDate(get('date'));
  const tabDate = formatTabDate(date);

  // Get tab name from sheet (populated by system when game opens/closes)
  // If empty, calculate it as fallback
  const clubName = get('club_name');
  let tabName = get('tab_name');
  if (!tabName) {
    tabName = `${clubName} ${tabDate}`;
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

    // Format fields (required for friendlies)
    format: get('format') || 'Rinks',
    ladiesMen: get('ladies_men') || 'Men',
    dress: get('dress') || 'Whites',

    // Friendlies-specific fields
    clubName: get('club_name'),
    homeAway: (get('home_away') || 'H') as HomeAway,

    // Internal tracking
    _rowNumber: rowNumber,

    // Paired game flag
    paired: get('paired'),
  };
}

/**
 * Parse a row from a game sheet into a FriendlyPlayer object
 * @param row Raw row data from Google Sheets
 * @param rowNumber Row number in sheet (for updates)
 * @param colMap Column name to index mapping
 * @returns Parsed FriendlyPlayer object
 */
export function parseFriendlyPlayerRow(
  row: any[],
  rowNumber: number,
  colMap: Record<string, number>
): FriendlyPlayer {
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

  // Helper to get decimal value from column
  const getFloat = (field: string): number => {
    const val = get(field);
    if (!val) return 0;
    const parsed = parseFloat(val);
    return isNaN(parsed) ? 0 : parsed;
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

    // Competitive player fields
    selected: (get('selected') || '') as SelectionStatus,
    team: getTeam('team'),
    position: (get('position') || '') as Position,
    driverBar: get('driver_bar'),

    // Friendlies-specific stats
    nameDown: getInt('name_down'),
    picked: getInt('picked'),
    percentPlayed: getFloat('percent_played'),

    // Captain and driving (friendlies only)
    captain: get('captain'),
    driving: get('driving'),
    carNumber: get('car_number'),

    // Game history (optional)
    last8Games: [], // Will be populated separately if needed
  };
}

/**
 * Field map for updating friendly players
 * Maps high-level field names to Google Sheets column names
 */
export const FRIENDLY_PLAYER_FIELD_MAP: Record<string, string> = {
  selected: 'selected',
  team: 'team',
  position: 'position',
  driving: 'driving',
  carNumber: 'car_number',
  captain: 'captain',
  status: 'status',
};
