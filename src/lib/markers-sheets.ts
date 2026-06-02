// src/lib/markers-sheets.ts
// Data access functions for the Markers list
// Data is stored in the Markers sheet of the Member List spreadsheet

import { getGoogleSheetsClient, getSpreadsheetId, getAllUsers } from './sheets';

const SHEET_NAME = 'Markers';

const COLUMNS = {
  name: 0,   // A - Username
  worker: 1, // B - Worker flag ("Y" if daytime worker, blank otherwise)
};

export interface MarkerEntry {
  rowNumber: number;
  name: string;
  isWorker: boolean;
  fullName: string | null;
  userName: string | null;
  mobile: string | null;
  landline: string | null;
  emailAddress: string | null;
}

/**
 * Get all marker entries, enriched with contact details from the Members sheet.
 */
export async function getMarkers(): Promise<MarkerEntry[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const [response, allUsers] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A:B`,
      valueRenderOption: 'FORMATTED_VALUE',
    }),
    getAllUsers(),
  ]);

  const rows = response.data.values || [];
  if (rows.length <= 1) return [];

  const byUsername = new Map(allUsers.map(u => [u.userName?.toLowerCase(), u]));

  const entries: MarkerEntry[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = (row[COLUMNS.name] || '').trim();
    if (!name) continue;

    const isWorker = (row[COLUMNS.worker] || '').trim().toUpperCase() === 'Y';
    const user = byUsername.get(name.toLowerCase()) ?? null;

    entries.push({
      rowNumber: i + 1,
      name,
      isWorker,
      fullName: user?.fullName ?? null,
      userName: user?.userName ?? name,
      mobile: user?.mobile ?? null,
      landline: user?.landline ?? null,
      emailAddress: user?.emailAddress ?? null,
    });
  }

  return entries;
}

/**
 * Add a new marker entry.
 */
export async function addMarker(username: string, isWorker: boolean): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:B`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[username, isWorker ? 'Y' : '']],
    },
  });
}

/**
 * Delete a marker entry by its 1-based row number.
 */
export async function deleteMarker(rowNumber: number): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(s => s.properties?.title === SHEET_NAME);
  if (!sheet?.properties?.sheetId) {
    throw new Error(`Sheet "${SHEET_NAME}" not found`);
  }
  const sheetId = sheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      }],
    },
  });
}
