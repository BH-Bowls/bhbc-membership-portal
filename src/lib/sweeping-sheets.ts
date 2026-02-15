// src/lib/sweeping-sheets.ts
// Data access functions for Sweeping Rota feature
// Data is stored in the SweepingRota sheet of the Member List spreadsheet
// Past entries are kept for historical reference

import { getGoogleSheetsClient, getSpreadsheetId } from './sheets';
import { SweepingRotaEntry } from './types/sweeping';
import { normalizeToUKDate } from './date-utils';

const SHEET_NAME = 'SweepingRota';

// Column mapping for SweepingRota sheet
const COLUMNS = {
  date: 0,      // A - Date (stored as actual date, displays as DD/MM/YYYY)
  userName: 1,  // B - UserName
  isBlocked: 2, // C - IsBlocked
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
 * Convert DD/MM/YYYY to a Date object for writing to sheets
 * Returns the date in a format Google Sheets will recognize
 */
function convertToSheetDate(dateStr: string): string {
  // Parse DD/MM/YYYY
  const [day, month, year] = dateStr.split('/').map(Number);
  // Return in YYYY-MM-DD format which Sheets interprets as a date
  return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

/**
 * Get all sweeping rota entries
 * @returns Array of sweeping rota entries
 */
export async function getSweepingRotaList(): Promise<SweepingRotaEntry[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Fetch all data from SweepingRota sheet
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:C`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];

  if (rows.length <= 1) {
    return []; // No data (only header row or empty)
  }

  // Parse rows (skip header row)
  const entries: SweepingRotaEntry[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateValue = row[COLUMNS.date];

    // Skip empty rows
    if (!dateValue) continue;

    // Normalize date to DD/MM/YYYY format immediately when reading from sheet
    const date = normalizeToUKDate(String(dateValue));
    if (!date) continue; // Skip if date couldn't be parsed

    const userName = row[COLUMNS.userName] || '';
    const isBlockedVal = row[COLUMNS.isBlocked];
    const isBlocked = isBlockedVal === 'TRUE' || isBlockedVal === true || isBlockedVal === 'true';

    entries.push({
      date,
      userName,
      isBlocked,
    });
  }

  return entries;
}

/**
 * Get sweeping rota entries within a date range
 * @param startDate DD/MM/YYYY format
 * @param endDate DD/MM/YYYY format
 * @returns Filtered array of entries
 */
export async function getSweepingRotaForDateRange(
  startDate: string,
  endDate: string
): Promise<SweepingRotaEntry[]> {
  const entries = await getSweepingRotaList();

  // Parse dates for comparison
  const parseDate = (dateStr: string): Date => {
    const [day, month, year] = dateStr.split('/').map(Number);
    return new Date(year, month - 1, day);
  };

  const start = parseDate(startDate);
  const end = parseDate(endDate);

  return entries.filter(entry => {
    const entryDate = parseDate(entry.date);
    return entryDate >= start && entryDate <= end;
  });
}

/**
 * Get a single sweeping rota entry by date
 * @param date DD/MM/YYYY format
 * @returns Entry or null if not found
 */
export async function getSweepingRotaEntry(date: string): Promise<SweepingRotaEntry | null> {
  const entries = await getSweepingRotaList();
  return entries.find(entry => entry.date === date) || null;
}

/**
 * Find the row number for a specific date
 * @param date DD/MM/YYYY format
 * @returns Row number (1-based) or null if not found
 */
async function findRowNumberByDate(date: string): Promise<number | null> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:A`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    const rowDate = normalizeToUKDate(String(rows[i][0] || ''));
    if (rowDate === date) {
      return i + 1; // 1-based row number
    }
  }

  return null;
}

/**
 * Add a member to a sweeping rota date
 * @param date DD/MM/YYYY format
 * @param userName Username to assign
 * @returns true if added, false if date already has assignment or is blocked
 */
export async function addSweepingAssignment(
  date: string,
  userName: string
): Promise<{ success: boolean; reason?: string }> {
  // Validate userName is not empty
  if (!userName || userName.trim() === '') {
    return { success: false, reason: 'Username cannot be empty' };
  }

  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Check if entry already exists
  const existingEntry = await getSweepingRotaEntry(date);

  if (existingEntry) {
    if (existingEntry.isBlocked) {
      return { success: false, reason: 'Date is blocked (maintenance day)' };
    }
    if (existingEntry.userName) {
      return { success: false, reason: 'Date already has an assignment' };
    }

    // Entry exists but is available - update it
    const rowNumber = await findRowNumberByDate(date);
    if (rowNumber) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.userName)}${rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[userName]],
        },
      });
      return { success: true };
    }
  }

  // Add new entry - use USER_ENTERED so Sheets recognizes the date
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:C`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[convertToSheetDate(date), userName, 'FALSE']],
    },
  });

  return { success: true };
}

/**
 * Remove a member's sweeping assignment
 * @param date DD/MM/YYYY format
 * @param userName Username to verify (only allows removing own assignment)
 * @returns true if removed
 */
export async function removeSweepingAssignment(
  date: string,
  userName: string,
  isAdmin: boolean = false
): Promise<{ success: boolean; reason?: string }> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const existingEntry = await getSweepingRotaEntry(date);

  if (!existingEntry) {
    return { success: false, reason: 'No entry for this date' };
  }

  if (!existingEntry.userName) {
    return { success: false, reason: 'Date has no assignment' };
  }

  // Only allow removing own assignment (unless admin)
  if (!isAdmin && existingEntry.userName !== userName) {
    return { success: false, reason: 'Can only remove your own assignment' };
  }

  // Find and update the row
  const rowNumber = await findRowNumberByDate(date);
  if (!rowNumber) {
    return { success: false, reason: 'Entry not found' };
  }

  // Clear the userName but keep the row
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.userName)}${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['']],
    },
  });

  return { success: true };
}

/**
 * Block a date (greenkeeper day)
 * @param date DD/MM/YYYY format
 * @returns true if blocked
 */
export async function blockSweepingDate(
  date: string
): Promise<{ success: boolean; reason?: string }> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const existingEntry = await getSweepingRotaEntry(date);

  if (existingEntry) {
    if (existingEntry.userName) {
      return { success: false, reason: 'Cannot block a date with an existing assignment' };
    }

    if (existingEntry.isBlocked) {
      return { success: false, reason: 'Date is already blocked' };
    }

    // Update existing entry to blocked
    const rowNumber = await findRowNumberByDate(date);
    if (rowNumber) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.isBlocked)}${rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['TRUE']],
        },
      });
      return { success: true };
    }
  }

  // Add new blocked entry - use USER_ENTERED so Sheets recognizes the date
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:C`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[convertToSheetDate(date), '', 'TRUE']],
    },
  });

  return { success: true };
}

/**
 * Unblock a date
 * @param date DD/MM/YYYY format
 */
export async function unblockSweepingDate(
  date: string
): Promise<{ success: boolean; reason?: string }> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const existingEntry = await getSweepingRotaEntry(date);

  if (!existingEntry) {
    return { success: false, reason: 'No entry for this date' };
  }

  if (!existingEntry.isBlocked) {
    return { success: false, reason: 'Date is not blocked' };
  }

  const rowNumber = await findRowNumberByDate(date);
  if (!rowNumber) {
    return { success: false, reason: 'Entry not found' };
  }

  // Set isBlocked to FALSE
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.isBlocked)}${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['FALSE']],
    },
  });

  return { success: true };
}

/**
 * Batch add multiple sweeping assignments (optimized for bulk operations)
 * @param dates Array of DD/MM/YYYY dates
 * @param userName Username to assign
 */
export async function batchAddSweepingAssignments(
  dates: string[],
  userName: string
): Promise<{ added: string[]; skipped: { date: string; reason: string }[] }> {
  // Validate userName
  if (!userName || userName.trim() === '') {
    return {
      added: [],
      skipped: dates.map(date => ({ date, reason: 'Username cannot be empty' })),
    };
  }

  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Fetch all existing data once
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:C`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];

  // Build a map of existing entries with their row numbers
  const existingEntries = new Map<string, { rowNumber: number; userName: string; isBlocked: boolean }>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateValue = row[COLUMNS.date];
    if (!dateValue) continue;

    const date = normalizeToUKDate(String(dateValue));
    if (!date) continue;

    const entryUserName = row[COLUMNS.userName] || '';
    const isBlockedVal = row[COLUMNS.isBlocked];
    const isBlocked = isBlockedVal === 'TRUE' || isBlockedVal === true || isBlockedVal === 'true';

    existingEntries.set(date, {
      rowNumber: i + 1, // 1-based row number
      userName: entryUserName,
      isBlocked,
    });
  }

  const added: string[] = [];
  const skipped: { date: string; reason: string }[] = [];
  const toUpdate: { range: string; values: string[][] }[] = [];
  const toAppend: string[][] = [];

  // Categorize dates
  for (const date of dates) {
    const existing = existingEntries.get(date);

    if (existing) {
      if (existing.isBlocked) {
        skipped.push({ date, reason: 'Date is blocked (maintenance day)' });
      } else if (existing.userName) {
        skipped.push({ date, reason: 'Date already has an assignment' });
      } else {
        // Entry exists but is available - queue update
        toUpdate.push({
          range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.userName)}${existing.rowNumber}`,
          values: [[userName]],
        });
        added.push(date);
      }
    } else {
      // New entry - queue append
      toAppend.push([convertToSheetDate(date), userName, 'FALSE']);
      added.push(date);
    }
  }

  // Execute batch updates if any
  if (toUpdate.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: toUpdate,
      },
    });
  }

  // Execute batch append if any
  if (toAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A:C`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: toAppend,
      },
    });
  }

  return { added, skipped };
}

/**
 * Batch block multiple dates (optimized for bulk operations)
 * @param dates Array of DD/MM/YYYY dates
 */
export async function batchBlockSweepingDates(
  dates: string[]
): Promise<{ blocked: string[]; skipped: { date: string; reason: string }[] }> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Fetch all existing data once
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:C`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];

  // Build a map of existing entries with their row numbers
  const existingEntries = new Map<string, { rowNumber: number; userName: string; isBlocked: boolean }>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateValue = row[COLUMNS.date];
    if (!dateValue) continue;

    const date = normalizeToUKDate(String(dateValue));
    if (!date) continue;

    const userName = row[COLUMNS.userName] || '';
    const isBlockedVal = row[COLUMNS.isBlocked];
    const isBlocked = isBlockedVal === 'TRUE' || isBlockedVal === true || isBlockedVal === 'true';

    existingEntries.set(date, {
      rowNumber: i + 1,
      userName,
      isBlocked,
    });
  }

  const blocked: string[] = [];
  const skipped: { date: string; reason: string }[] = [];
  const toUpdate: { range: string; values: string[][] }[] = [];
  const toAppend: string[][] = [];

  // Categorize dates
  for (const date of dates) {
    const existing = existingEntries.get(date);

    if (existing) {
      if (existing.userName) {
        skipped.push({ date, reason: 'Cannot block a date with an existing assignment' });
      } else if (existing.isBlocked) {
        skipped.push({ date, reason: 'Date is already blocked' });
      } else {
        // Entry exists but is available - queue update
        toUpdate.push({
          range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.isBlocked)}${existing.rowNumber}`,
          values: [['TRUE']],
        });
        blocked.push(date);
      }
    } else {
      // New entry - queue append
      toAppend.push([convertToSheetDate(date), '', 'TRUE']);
      blocked.push(date);
    }
  }

  // Execute batch updates if any
  if (toUpdate.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: toUpdate,
      },
    });
  }

  // Execute batch append if any
  if (toAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A:C`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: toAppend,
      },
    });
  }

  return { blocked, skipped };
}

/**
 * Clear a sweeping entry (remove assignment or unblock)
 * @param date DD/MM/YYYY format
 * @returns true if cleared
 */
export async function clearSweepingEntry(
  date: string
): Promise<{ success: boolean; reason?: string }> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const existingEntry = await getSweepingRotaEntry(date);

  if (!existingEntry) {
    return { success: false, reason: 'No entry for this date' };
  }

  if (!existingEntry.userName && !existingEntry.isBlocked) {
    return { success: false, reason: 'Date is already clear' };
  }

  const rowNumber = await findRowNumberByDate(date);
  if (!rowNumber) {
    return { success: false, reason: 'Entry not found' };
  }

  // Clear both userName and isBlocked
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.userName)}${rowNumber}:${getColumnLetter(COLUMNS.isBlocked)}${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['', 'FALSE']],
    },
  });

  return { success: true };
}

/**
 * Batch clear multiple dates (optimized for bulk operations)
 * @param dates Array of DD/MM/YYYY dates
 */
export async function batchClearSweepingEntries(
  dates: string[]
): Promise<{ cleared: string[]; skipped: { date: string; reason: string }[] }> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Fetch all existing data once
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:C`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];

  // Build a map of existing entries with their row numbers
  const existingEntries = new Map<string, { rowNumber: number; userName: string; isBlocked: boolean }>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const dateValue = row[COLUMNS.date];
    if (!dateValue) continue;

    const date = normalizeToUKDate(String(dateValue));
    if (!date) continue;

    const userName = row[COLUMNS.userName] || '';
    const isBlockedVal = row[COLUMNS.isBlocked];
    const isBlocked = isBlockedVal === 'TRUE' || isBlockedVal === true || isBlockedVal === 'true';

    existingEntries.set(date, {
      rowNumber: i + 1,
      userName,
      isBlocked,
    });
  }

  const cleared: string[] = [];
  const skipped: { date: string; reason: string }[] = [];
  const toUpdate: { range: string; values: string[][] }[] = [];

  // Categorize dates
  for (const date of dates) {
    const existing = existingEntries.get(date);

    if (!existing) {
      skipped.push({ date, reason: 'No entry for this date' });
    } else if (!existing.userName && !existing.isBlocked) {
      skipped.push({ date, reason: 'Date is already clear' });
    } else {
      // Queue update to clear both userName and isBlocked
      toUpdate.push({
        range: `${SHEET_NAME}!${getColumnLetter(COLUMNS.userName)}${existing.rowNumber}:${getColumnLetter(COLUMNS.isBlocked)}${existing.rowNumber}`,
        values: [['', 'FALSE']],
      });
      cleared.push(date);
    }
  }

  // Execute batch updates if any
  if (toUpdate.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: toUpdate,
      },
    });
  }

  return { cleared, skipped };
}
