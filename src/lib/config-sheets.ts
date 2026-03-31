// src/lib/config-sheets.ts
// Read and write key-value config from the Portal Config spreadsheet

import { getGoogleSheetsClient } from './sheets';

function getConfigSpreadsheetId(): string {
  const id = process.env.PORTAL_CONFIG_SPREADSHEET_ID;
  if (!id) throw new Error('PORTAL_CONFIG_SPREADSHEET_ID is not set');
  return id;
}

/** Fetch all key-value pairs from the Labels sheet as a plain Record. */
export async function getLabelConfig(): Promise<Record<string, string>> {
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getConfigSpreadsheetId(),
    range: 'Labels!A:B',
  });
  const rows = response.data.values ?? [];
  const config: Record<string, string> = {};
  for (const row of rows) {
    if (row[0] && row[1] !== undefined) {
      config[String(row[0]).trim()] = String(row[1]);
    }
  }
  return config;
}

/** Update specific keys in the Labels sheet. Only updates rows whose key already exists. */
export async function updateLabelConfig(updates: Record<string, string>): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getConfigSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Labels!A:A',
  });
  const rows = response.data.values ?? [];

  const data: { range: string; values: string[][] }[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const rowIndex = rows.findIndex((r) => r[0] && String(r[0]).trim() === key);
    if (rowIndex >= 0) {
      data.push({ range: `Labels!B${rowIndex + 1}`, values: [[value]] });
    }
  }

  if (data.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data },
    });
  }
}
