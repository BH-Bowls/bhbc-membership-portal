// lib/game-management/social-events/parsers.ts
// Social Events-specific parsing functions
// Converts Google Sheets rows into SocialEvent and SocialEventAttendee objects

import type { SocialEvent, SocialEventAttendee } from '../types';
import type { GameStatus, AttendanceStatus, ConfirmationStatus } from '../types';
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
 * Parse a row from the SocialEvents sheet into a SocialEvent object
 * @param row Raw row data from Google Sheets
 * @param rowNumber Row number in sheet (for updates)
 * @param colMap Column name to index mapping
 * @returns Parsed SocialEvent object
 */
export function parseSocialEventRow(
  row: any[],
  rowNumber: number,
  colMap: Record<string, number>
): SocialEvent {
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

  // Get tab name from sheet (populated by system when event opens/closes)
  // If empty, calculate it as fallback
  const eventName = get('event_name');
  let tabName = get('tab_name');
  if (!tabName) {
    tabName = `${eventName} ${tabDate}`;
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
    selected: getInt('attending'), // For social events, "selected" means "attending"
    reserves: getInt('waitlist'),  // For social events, "reserves" means "waitlist"

    // Social events don't have format/ladiesMen/dress - not competitive
    format: undefined,
    ladiesMen: undefined,
    dress: undefined,

    // Social events-specific fields
    eventName: get('event_name'),
    location: get('location') || undefined,
    description: get('description') || undefined,
    detailsUrl: get('details_url') || undefined,

    // Internal tracking
    _rowNumber: rowNumber,
  };
}

/**
 * Parse a row from a social event sheet into a SocialEventAttendee object
 * @param row Raw row data from Google Sheets
 * @param rowNumber Row number in sheet (for updates)
 * @param colMap Column name to index mapping
 * @returns Parsed SocialEventAttendee object
 */
export function parseSocialEventAttendeeRow(
  row: any[],
  rowNumber: number,
  colMap: Record<string, number>
): SocialEventAttendee {
  // Helper to get string value from column
  const get = (field: string): string => {
    const index = colMap[field];
    if (index === undefined) return '';
    return row[index] || '';
  };

  return {
    // Base player fields
    rowNumber,
    name: get('user_name'),
    status: (get('status') || '') as ConfirmationStatus, // Usually blank for social events

    // Social events-specific attendance tracking
    attendance: (get('attendance') || '') as AttendanceStatus, // Y/N/M/W
  };
}

/**
 * Field map for updating social event attendees
 * Maps high-level field names to Google Sheets column names
 */
export const SOCIAL_EVENT_ATTENDEE_FIELD_MAP: Record<string, string> = {
  attendance: 'attendance',
  status: 'status',
};
