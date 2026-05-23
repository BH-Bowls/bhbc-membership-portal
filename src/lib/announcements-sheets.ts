// src/lib/announcements-sheets.ts
// Data layer for the HomeAnnouncements tab in the Portal Config spreadsheet.
// Handles reading all announcements, creating new ones, updating, and deleting.

import crypto from 'crypto';
import { getGoogleSheetsClient, getColumnMap, getColumnLetter } from './sheets';
import type { Announcement } from '@/types/diary';

// ─── Environment Variable Getter ─────────────────────────────────────────────

// Returns the Portal Config spreadsheet ID, throwing a helpful error if missing
function getConfigSpreadsheetId(): string {
  const id = process.env.PORTAL_CONFIG_SPREADSHEET_ID;
  if (!id) {
    throw new Error('PORTAL_CONFIG_SPREADSHEET_ID environment variable is not set. Check your .env.local file.');
  }
  return id;
}

// Sheet name within the Config spreadsheet
const SHEET_NAME = 'HomeAnnouncements';

// ─── Row Parser ───────────────────────────────────────────────────────────────

// Convert a raw sheet row plus column map into a typed Announcement object
function parseRow(row: string[], colMap: Record<string, number>): Announcement | null {
  // Helper to safely get a string value from the row by column name
  function get(field: string): string {
    const idx = colMap[field];
    if (idx === undefined) {
      return '';
    }
    const val = row[idx];
    if (val === undefined || val === null) {
      return '';
    }
    return String(val).trim();
  }

  // Require an ID — rows without one are considered blank/invalid
  const id = get('id');
  if (!id) {
    return null;
  }

  const expiresAt = get('expires_at');

  // Compute isExpired: true when expiresAt is in the past relative to now
  let isExpired = false;
  if (expiresAt) {
    isExpired = expiresAt < new Date().toISOString();
  } else {
    // No expiry date stored — treat as already expired to avoid showing stale rows
    isExpired = true;
  }

  return {
    id,
    message: get('message'),
    expiresAt,
    createdBy: get('created_by'),
    createdAt: get('created_at'),
    updatedBy: get('updated_by'),
    updatedAt: get('updated_at'),
    isExpired,
  };
}

// ─── Read Functions ───────────────────────────────────────────────────────────

// Read all rows from HomeAnnouncements, sorted by createdAt descending (newest first).
// Returns both active and expired rows — callers filter as needed.
// Returns [] if the sheet tab does not exist yet (400 "Unable to parse range").
export async function getAllAnnouncements(): Promise<Announcement[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getConfigSpreadsheetId();

  // Fetch the column map so we can access columns by name regardless of order.
  // If the tab doesn't exist, getColumnMap throws a 400 — catch it and return empty.
  let colMap: Record<string, number>;
  try {
    colMap = await getColumnMap(SHEET_NAME, spreadsheetId);
  } catch (_err) {
    return [];
  }

  // Fetch all data rows (row 1 is the header, data starts at row 2)
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:G`,
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) {
    return [];
  }

  // Parse each row and filter out any blank/invalid rows
  const announcements: Announcement[] = [];
  for (let i = 0; i < rows.length; i++) {
    const parsed = parseRow(rows[i] as string[], colMap);
    if (parsed) {
      announcements.push(parsed);
    }
  }

  // Sort descending by createdAt so newest appear first in the admin UI
  announcements.sort((a, b) => {
    if (a.createdAt > b.createdAt) {
      return -1;
    }
    if (a.createdAt < b.createdAt) {
      return 1;
    }
    return 0;
  });

  return announcements;
}

// Returns only active (non-expired) announcements, ordered newest first
export async function getActiveAnnouncements(): Promise<Announcement[]> {
  const all = await getAllAnnouncements();

  // Filter to rows where isExpired is false
  const active: Announcement[] = [];
  for (let i = 0; i < all.length; i++) {
    if (!all[i].isExpired) {
      active.push(all[i]);
    }
  }
  return active;
}

// ─── Write Functions ──────────────────────────────────────────────────────────

// Append a new announcement row to the sheet.
// ID is a UUID generated here — no read-before-write needed.
export async function createAnnouncement(
  message: string,
  expiresAt: string,
  createdBy: string
): Promise<Announcement> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getConfigSpreadsheetId();

  // Generate a UUID v4 for the new announcement's ID
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  // Build the new row in the order that matches the sheet columns (A–G):
  // ID | Message | Expires At | Created By | Created At | Updated By | Updated At
  const newRow = [id, message, expiresAt, createdBy, createdAt, '', ''];

  // Append the row to the sheet — Google Sheets will find the first empty row after row 2
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:G`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [newRow],
    },
  });

  return {
    id,
    message,
    expiresAt,
    createdBy,
    createdAt,
    updatedBy: '',
    updatedAt: '',
    isExpired: false,
  };
}

// Update message and expiresAt for an existing announcement by its ID.
// Throws if the ID is not found.
export async function updateAnnouncement(
  id: string,
  message: string,
  expiresAt: string,
  updatedBy: string
): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getConfigSpreadsheetId();

  // Fetch the column map to find column positions by name
  const colMap = await getColumnMap(SHEET_NAME, spreadsheetId);

  // Fetch all rows from column A (the ID column) to find the target row number
  const idResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:A`,
  });

  const idRows = idResponse.data.values;
  if (!idRows) {
    throw new Error(`Announcement not found: ${id}`);
  }

  // Search the ID column for a matching row
  let targetRowNumber = -1;
  for (let i = 0; i < idRows.length; i++) {
    if (idRows[i][0] === id) {
      // Sheet row number: data starts at row 2, index i maps to row i + 2
      targetRowNumber = i + 2;
      break;
    }
  }

  if (targetRowNumber === -1) {
    throw new Error(`Announcement not found: ${id}`);
  }

  const updatedAt = new Date().toISOString();

  // Build the batch update: update Message, Expires At, Updated By, Updated At
  const messageCol = getColumnLetter(colMap['message']);
  const expiresAtCol = getColumnLetter(colMap['expires_at']);
  const updatedByCol = getColumnLetter(colMap['updated_by']);
  const updatedAtCol = getColumnLetter(colMap['updated_at']);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `${SHEET_NAME}!${messageCol}${targetRowNumber}`, values: [[message]] },
        { range: `${SHEET_NAME}!${expiresAtCol}${targetRowNumber}`, values: [[expiresAt]] },
        { range: `${SHEET_NAME}!${updatedByCol}${targetRowNumber}`, values: [[updatedBy]] },
        { range: `${SHEET_NAME}!${updatedAtCol}${targetRowNumber}`, values: [[updatedAt]] },
      ],
    },
  });
}

// Delete an announcement row by its ID (physical row deletion).
// Throws if the ID is not found.
export async function deleteAnnouncement(id: string): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getConfigSpreadsheetId();

  // Fetch column A to find the target row number
  const idResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:A`,
  });

  const idRows = idResponse.data.values;
  if (!idRows) {
    throw new Error(`Announcement not found: ${id}`);
  }

  // Find the row with the matching ID
  let targetRowIndex = -1;
  for (let i = 0; i < idRows.length; i++) {
    if (idRows[i][0] === id) {
      // Google Sheets API uses 0-based row index; row 2 = index 1
      targetRowIndex = i + 1;
      break;
    }
  }

  if (targetRowIndex === -1) {
    throw new Error(`Announcement not found: ${id}`);
  }

  // We need the spreadsheet's internal sheet ID (not the spreadsheet ID) to delete a row
  // Fetch the spreadsheet metadata to get the sheet's numeric sheetId
  const spreadsheetMeta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });

  const sheetsList = spreadsheetMeta.data.sheets;
  let sheetId: number | null = null;

  // Loop through sheets to find the one named HomeAnnouncements
  if (sheetsList) {
    for (let i = 0; i < sheetsList.length; i++) {
      const props = sheetsList[i].properties;
      if (props && props.title === SHEET_NAME) {
        sheetId = props.sheetId !== undefined && props.sheetId !== null ? props.sheetId : null;
        break;
      }
    }
  }

  if (sheetId === null) {
    throw new Error(`Sheet not found: ${SHEET_NAME}`);
  }

  // Delete the row using the batchUpdate deleteDimension request
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: targetRowIndex,      // 0-based; row 2 = index 1
              endIndex: targetRowIndex + 1,    // exclusive end
            },
          },
        },
      ],
    },
  });
}
