// src/lib/social-events-sheets.ts
// Google Sheets operations for Social Events system
// Uses shared library for common operations

import { SocialEventsConfig, getSpreadsheetId } from './game-management/config';
import { getAllGames, getGameByTabDate, getPlayersForGame, addPlayerToGame, updatePlayer } from './game-management/sheet-operations';
import { parseSocialEventRow, parseSocialEventAttendeeRow, SOCIAL_EVENT_ATTENDEE_FIELD_MAP } from './game-management/social-events/parsers';
import type { SocialEvent, SocialEventAttendee, GameStatus } from './game-management/types';
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
 * Get all social events from SocialEvents sheet
 * @returns Array of social events
 */
export async function getSocialEvents(): Promise<SocialEvent[]> {
  return getAllGames(SocialEventsConfig, parseSocialEventRow);
}

/**
 * Get a single social event by tabDate
 * @param tabDate Event identifier (e.g., "13 Jan 25")
 * @returns Social event or null if not found
 */
export async function getSocialEventByTabDate(tabDate: string): Promise<SocialEvent | null> {
  return getGameByTabDate(SocialEventsConfig, tabDate, parseSocialEventRow);
}

/**
 * Get all attendees for a specific social event
 * @param tabName Event sheet tab name
 * @returns Array of attendees
 */
export async function getSocialEventAttendees(tabName: string): Promise<SocialEventAttendee[]> {
  return getPlayersForGame(SocialEventsConfig, tabName, parseSocialEventAttendeeRow);
}

/**
 * Add an attendee to a social event (offline addition)
 * @param tabName Event sheet tab name
 * @param userName Username to add
 * @returns Success status
 */
export async function addAttendeeToSocialEvent(
  tabName: string,
  userName: string
): Promise<{ success: boolean; error?: string }> {
  return addPlayerToGame(SocialEventsConfig, tabName, userName);
}

/**
 * Update attendee status in a social event
 * @param tabName Event sheet tab name
 * @param rowNumber Row number of attendee
 * @param updates Attendee field updates
 * @returns Success status
 */
export async function updateSocialEventAttendee(
  tabName: string,
  rowNumber: number,
  updates: Partial<SocialEventAttendee>
): Promise<{ success: boolean; error?: string }> {
  return updatePlayer(SocialEventsConfig, tabName, rowNumber, updates, SOCIAL_EVENT_ATTENDEE_FIELD_MAP);
}

/**
 * Get all members from the Members sheet for attendee selection
 * Social events include all members (playing and social), not just playing members
 * @returns Array of members with userName and fullName
 */
export async function getSocialEventMembers(): Promise<Array<{ userName: string; fullName: string; memberType?: string }>> {
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

  // Build array of members (include all members for social events, not just playing)
  const members: Array<{ userName: string; fullName: string; memberType?: string }> = [];

  for (let i = 1; i < membersRows.length; i++) {
    const memberRow = membersRows[i];
    const userName = memberRow[memberUserNameCol];
    const fullName = memberRow[memberFullNameCol];
    const memberType = memberTypeCol !== undefined ? memberRow[memberTypeCol] : undefined;

    // Only include members with a valid username
    if (userName && userName.trim() !== '') {
      members.push({
        userName: userName.trim(),
        fullName: (fullName || userName).trim(),
        memberType,
      });
    }
  }

  // Sort members alphabetically by full name for easier dropdown selection
  members.sort((a, b) => a.fullName.localeCompare(b.fullName));

  return members;
}

/**
 * Get all attendees who have entered a specific social event
 * Returns list of attendees with their userName, fullName, and status (E or M)
 * @param eventId The event identifier (tabName)
 * @returns Array of entered attendees with their status
 */
export async function getEnteredPlayers(
  eventId: string
): Promise<Array<{ userName: string; fullName: string; status: 'E' | 'M' }>> {
  const spreadsheetId = getSpreadsheetId(SocialEventsConfig);
  const sheets = getGoogleSheetsClient();
  const attendeesSheetName = SocialEventsConfig.membersSheetName; // "Attendees" in Social Events

  // Fetch header row to find event column
  const headersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${attendeesSheetName}!1:1`,
  });

  const headers = headersResponse.data.values?.[0] || [];
  const eventColumnIndex = headers.findIndex(h => h === eventId);

  if (eventColumnIndex === -1) {
    throw new Error(`Event column not found: ${eventId}`);
  }

  // Fetch all Attendees sheet data
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${attendeesSheetName}!A:ZZ`,
  });

  const rows = response.data.values || [];

  // Get column map for Attendees sheet to find userName column
  const colMap = await getColumnMap(spreadsheetId, attendeesSheetName);
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

  // Skip header row, iterate through attendees
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const entryStatus = row[eventColumnIndex];

    // Only include attendees with E or M status
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
 * Get a specific attendee's entry status for a social event
 * @param userName Attendee's username
 * @param eventId Event identifier (tabDate)
 * @returns Status code ('E', 'M', 'Y', 'N', etc.) or empty string if not entered
 */
export async function getPlayerEntryStatus(
  userName: string,
  eventId: string
): Promise<string> {
  const spreadsheetId = getSpreadsheetId(SocialEventsConfig);
  const sheets = getGoogleSheetsClient();
  const membersSheetName = SocialEventsConfig.membersSheetName;

  // Fetch header row to find event column
  const headersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${membersSheetName}!1:1`,
  });

  const headers = headersResponse.data.values?.[0] || [];
  const eventColumnIndex = headers.findIndex(h => h === eventId);

  if (eventColumnIndex === -1) {
    throw new Error(`Event column not found: ${eventId}`);
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

  // Get the status from the event column
  const rowNumber = userRowIndex + 1;
  const columnLetter = getColumnLetter(eventColumnIndex);

  const statusResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${membersSheetName}!${columnLetter}${rowNumber}`,
  });

  const status = statusResponse.data.values?.[0]?.[0] || '';
  return status;
}

/**
 * Update an attendee's entry status for a social event
 * @param userName Attendee's username
 * @param eventId Event identifier (tabDate)
 * @param status New status code ('E', 'M', '', etc.)
 */
export async function updatePlayerEntry(
  userName: string,
  eventId: string,
  status: string
): Promise<void> {
  const spreadsheetId = getSpreadsheetId(SocialEventsConfig);
  const sheets = getGoogleSheetsClient();
  const membersSheetName = SocialEventsConfig.membersSheetName;

  // Fetch header row to find event column
  const headersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${membersSheetName}!1:1`,
  });

  const headers = headersResponse.data.values?.[0] || [];
  const eventColumnIndex = headers.findIndex(h => h === eventId);

  if (eventColumnIndex === -1) {
    throw new Error(`Event column not found: ${eventId}`);
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

  // Update the status in the event column
  const rowNumber = userRowIndex + 1;
  const columnLetter = getColumnLetter(eventColumnIndex);

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
// EVENT STATUS MANAGEMENT
// ============================================================================

/**
 * Update event status in Events sheet
 * @param tabName Event tab name to update
 * @param newStatus New status code
 * @param additionalData Optional additional data to update
 */
export async function updateEventStatus(
  tabName: string,
  newStatus: GameStatus,
  additionalData?: {
    reason?: string;
    who?: string;
    modifiedBy?: string;
    rowNumber?: number;
  }
): Promise<void> {
  const spreadsheetId = getSpreadsheetId(SocialEventsConfig);
  const colMap = await getColumnMap(spreadsheetId, SocialEventsConfig.gamesSheetName);
  const sheets = getGoogleSheetsClient();

  // Fetch all events to find the row
  const events = await getSocialEvents();

  // Search for the event
  let event: SocialEvent | null = null;

  // First try by tabName
  if (tabName && tabName.trim() !== '') {
    event = events.find(e => e.tabName === tabName) || null;
  }

  // If not found, try by rowNumber
  if (!event && additionalData?.rowNumber) {
    event = events.find(e => e._rowNumber === additionalData.rowNumber) || null;
  }

  if (!event || !event._rowNumber) {
    throw new Error(`Event not found - tabName: ${tabName}, rowNumber: ${additionalData?.rowNumber}`);
  }

  // Build updates array
  const updates: any[] = [
    {
      range: `${SocialEventsConfig.gamesSheetName}!${getColumnLetter(colMap['status'])}${event._rowNumber}`,
      values: [[newStatus]],
    },
  ];

  // Update Tab Name when opening or closing
  if ((newStatus === 'O' || newStatus === 'X') && colMap['tab_name'] !== undefined) {
    updates.push({
      range: `${SocialEventsConfig.gamesSheetName}!${getColumnLetter(colMap['tab_name'])}${event._rowNumber}`,
      values: [[tabName]],
    });
  }

  // Add reason if provided (for cancel)
  if (additionalData?.reason && colMap['reason'] !== undefined) {
    updates.push({
      range: `${SocialEventsConfig.gamesSheetName}!${getColumnLetter(colMap['reason'])}${event._rowNumber}`,
      values: [[additionalData.reason]],
    });
  }

  // Add who if provided (for cancel)
  if (additionalData?.who && colMap['who'] !== undefined) {
    updates.push({
      range: `${SocialEventsConfig.gamesSheetName}!${getColumnLetter(colMap['who'])}${event._rowNumber}`,
      values: [[additionalData.who]],
    });
  }

  // Add audit trail
  if (additionalData?.modifiedBy) {
    if (colMap['last_modified_by'] !== undefined) {
      updates.push({
        range: `${SocialEventsConfig.gamesSheetName}!${getColumnLetter(colMap['last_modified_by'])}${event._rowNumber}`,
        values: [[additionalData.modifiedBy]],
      });
    }
    if (colMap['last_modified_date'] !== undefined) {
      updates.push({
        range: `${SocialEventsConfig.gamesSheetName}!${getColumnLetter(colMap['last_modified_date'])}${event._rowNumber}`,
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
 * Update event counts in Events sheet
 * @param tabName Event tab name
 * @param counts Counts to update
 */
export async function updateEventCounts(
  tabName: string,
  counts: {
    entered?: number;
    attending?: number;
    waitlist?: number;
  }
): Promise<void> {
  const spreadsheetId = getSpreadsheetId(SocialEventsConfig);
  const colMap = await getColumnMap(spreadsheetId, SocialEventsConfig.gamesSheetName);
  const sheets = getGoogleSheetsClient();

  const events = await getSocialEvents();
  const event = events.find(e => e.tabName === tabName);

  if (!event || !event._rowNumber) {
    throw new Error(`Event not found: ${tabName}`);
  }

  const updates: any[] = [];

  if (counts.entered !== undefined && colMap['entered'] !== undefined) {
    updates.push({
      range: `${SocialEventsConfig.gamesSheetName}!${getColumnLetter(colMap['entered'])}${event._rowNumber}`,
      values: [[counts.entered]],
    });
  }

  if (counts.attending !== undefined && colMap['attending'] !== undefined) {
    updates.push({
      range: `${SocialEventsConfig.gamesSheetName}!${getColumnLetter(colMap['attending'])}${event._rowNumber}`,
      values: [[counts.attending]],
    });
  }

  if (counts.waitlist !== undefined && colMap['waitlist'] !== undefined) {
    updates.push({
      range: `${SocialEventsConfig.gamesSheetName}!${getColumnLetter(colMap['waitlist'])}${event._rowNumber}`,
      values: [[counts.waitlist]],
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
 * Create a new column in the Members sheet for an event
 * Called when event status changes to 'O' (Open)
 * @param tabName Event tab name (becomes column header)
 */
export async function createEventColumn(tabName: string): Promise<void> {
  if (!tabName || tabName.trim() === '') {
    throw new Error('tabName is required and cannot be empty');
  }

  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId(SocialEventsConfig);
  const membersSheetName = SocialEventsConfig.membersSheetName;

  // Fetch header row to find where to add new column
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${membersSheetName}!1:1`,
  });

  const headers = response.data.values?.[0] || [];

  // Check if column already exists
  if (headers.includes(tabName)) {
    console.log(`[createEventColumn] Column ${tabName} already exists`);
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

  const membersSheet = spreadsheetMetadata.data.sheets?.find(
    s => s.properties?.title === membersSheetName
  );

  if (!membersSheet?.properties?.sheetId) {
    throw new Error(`${membersSheetName} sheet not found`);
  }

  const sheetId = membersSheet.properties.sheetId;

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
