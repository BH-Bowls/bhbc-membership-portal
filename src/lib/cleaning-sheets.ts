// src/lib/cleaning-sheets.ts
// Data access functions for Cleaning Rota feature
// Data is stored in the CleaningRota sheet of the Member List spreadsheet

import { getGoogleSheetsClient, getSpreadsheetId } from './sheets';
import { CleaningRotaEntry, CleaningPosition } from './types/cleaning';

const SHEET_NAME = 'CleaningRota';

// Column mapping for CleaningRota sheet
const COLUMNS = {
  date: 0,      // A - Date
  lead: 1,      // B - Lead
  second: 2,    // C - Second
  third: 3,     // D - Third
  fourth: 4,    // E - Fourth
};

/**
 * Convert column index to letter (0 = A, 1 = B, etc.)
 */
function getColumnLetter(index: number): string {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

/**
 * Get all cleaning rota entries
 * @returns Array of cleaning rota entries
 */
export async function getCleaningRotaList(): Promise<CleaningRotaEntry[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Fetch all data from CleaningRota sheet
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:E`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) {
    return []; // No data (only header row or empty)
  }

  // Parse rows (skip header row)
  const entries: CleaningRotaEntry[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const date = row[COLUMNS.date] || '';

    // Skip empty rows
    if (!date) continue;

    entries.push({
      rowNumber: i + 1, // 1-based row number (accounting for header)
      date: date,
      displayDate: date, // Already formatted in sheet as "Sat, 05 September"
      lead: row[COLUMNS.lead] || '',
      second: row[COLUMNS.second] || '',
      third: row[COLUMNS.third] || '',
      fourth: row[COLUMNS.fourth] || '',
    });
  }

  return entries;
}

/**
 * Get a single cleaning rota entry by row number
 * @param rowNumber Row number in the sheet (1-based)
 * @returns Cleaning rota entry or null if not found
 */
export async function getCleaningRotaEntry(rowNumber: number): Promise<CleaningRotaEntry | null> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A${rowNumber}:E${rowNumber}`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const row = response.data.values?.[0];
  if (!row || !row[COLUMNS.date]) {
    return null;
  }

  return {
    rowNumber,
    date: row[COLUMNS.date] || '',
    displayDate: row[COLUMNS.date] || '',
    lead: row[COLUMNS.lead] || '',
    second: row[COLUMNS.second] || '',
    third: row[COLUMNS.third] || '',
    fourth: row[COLUMNS.fourth] || '',
  };
}

/**
 * Update a single cleaning rota entry
 * @param rowNumber Row number in the sheet
 * @param lead Lead cleaner username
 * @param second Second cleaner username
 * @param third Third cleaner username
 * @param fourth Fourth cleaner username
 */
export async function updateCleaningRotaAssignment(
  rowNumber: number,
  lead: string,
  second: string,
  third: string,
  fourth: string
): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const updates = [
    {
      range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.lead)}${rowNumber}`,
      values: [[lead]],
    },
    {
      range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.second)}${rowNumber}`,
      values: [[second]],
    },
    {
      range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.third)}${rowNumber}`,
      values: [[third]],
    },
    {
      range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.fourth)}${rowNumber}`,
      values: [[fourth]],
    },
  ];

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates,
    },
  });
}

/**
 * Batch update multiple cleaning rota entries
 * @param updates Array of updates with rowNumber and assignments
 */
export async function batchUpdateCleaningRotaAssignments(
  updates: {
    rowNumber: number;
    lead: string;
    second: string;
    third: string;
    fourth: string;
  }[]
): Promise<void> {
  if (updates.length === 0) return;

  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const batchData: { range: string; values: string[][] }[] = [];

  for (const update of updates) {
    batchData.push(
      {
        range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.lead)}${update.rowNumber}`,
        values: [[update.lead]],
      },
      {
        range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.second)}${update.rowNumber}`,
        values: [[update.second]],
      },
      {
        range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.third)}${update.rowNumber}`,
        values: [[update.third]],
      },
      {
        range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.fourth)}${update.rowNumber}`,
        values: [[update.fourth]],
      }
    );
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: batchData,
    },
  });
}

/**
 * Swap cleaning assignment between two members
 * @param rowNumber Row where the initiating user is assigned
 * @param position Position of the initiating user
 * @param oldUsername Username of the initiating user
 * @param newUsername Username to swap with
 * @param targetRowNumber Optional specific row for the target user's assignment
 * @param targetPosition Optional specific position for the target user's assignment
 * @returns Updated cleaning rota entry for the original row
 */
export async function swapCleaningAssignment(
  rowNumber: number,
  position: CleaningPosition,
  oldUsername: string,
  newUsername: string,
  targetRowNumber?: number,
  targetPosition?: CleaningPosition
): Promise<CleaningRotaEntry> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Position to column mapping
  const positionToCol: Record<CleaningPosition, number> = {
    lead: COLUMNS.lead,
    second: COLUMNS.second,
    third: COLUMNS.third,
    fourth: COLUMNS.fourth,
  };

  // Find where the new user is currently assigned (if not specified)
  let newUserRowNumber: number | null = targetRowNumber || null;
  let newUserPosition: CleaningPosition | null = targetPosition || null;

  if (!targetRowNumber || !targetPosition) {
    // Search all entries for the new user's assignment
    const entries = await getCleaningRotaList();
    for (const entry of entries) {
      if (entry.lead === newUsername) {
        newUserRowNumber = entry.rowNumber;
        newUserPosition = 'lead';
        break;
      }
      if (entry.second === newUsername) {
        newUserRowNumber = entry.rowNumber;
        newUserPosition = 'second';
        break;
      }
      if (entry.third === newUsername) {
        newUserRowNumber = entry.rowNumber;
        newUserPosition = 'third';
        break;
      }
      if (entry.fourth === newUsername) {
        newUserRowNumber = entry.rowNumber;
        newUserPosition = 'fourth';
        break;
      }
    }
  }

  // Build batch updates
  const updates: { range: string; values: string[][] }[] = [];

  // Put newUsername in oldUsername's position
  updates.push({
    range: `${SHEET_NAME}!${getColumnLetter(positionToCol[position])}${rowNumber}`,
    values: [[newUsername]],
  });

  // If newUsername was assigned somewhere, put oldUsername there
  if (newUserRowNumber !== null && newUserPosition !== null) {
    updates.push({
      range: `${SHEET_NAME}!${getColumnLetter(positionToCol[newUserPosition])}${newUserRowNumber}`,
      values: [[oldUsername]],
    });
  }

  // Apply updates
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates,
    },
  });

  // Return updated entry
  const updatedEntry = await getCleaningRotaEntry(rowNumber);
  if (!updatedEntry) {
    throw new Error('Failed to get updated entry');
  }
  return updatedEntry;
}
