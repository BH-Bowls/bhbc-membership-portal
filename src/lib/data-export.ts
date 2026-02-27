// src/lib/data-export.ts
// Core report engine for the Data Export / Report Builder feature
// Handles fetching sheet schemas, executing reports with JOIN/filter logic,
// writing output to ReportOutput tab, and CRUD for saved report definitions.

import { getGoogleSheetsClient, getSpreadsheetId } from './sheets';
import { getFriendliesSpreadsheetId } from './friendlies-sheets';
import { getMatchDayContactsSpreadsheetId } from './clubs-sheets';
import {
  SheetDescriptor,
  SchemaColumn,
  SheetSchema,
  ReportDefinition,
  ReportFilter,
  DefinitionSummary,
  RunReportResponse,
} from './types/data-export';

// ============================================================================
// SHEET REGISTRY
// ============================================================================

export const SHEET_REGISTRY: SheetDescriptor[] = [
  { key: 'Members',         label: 'Members',          sheetName: 'Members',         spreadsheetKey: 'MEMBERS_SPREADSHEET_ID',              joinKey: 'user_name' },
  { key: 'Renewals',        label: 'Renewals',         sheetName: 'Renewals',        spreadsheetKey: 'MEMBERS_SPREADSHEET_ID',              joinKey: 'user_name' },
  { key: 'RenewalPayments', label: 'Renewal Payments', sheetName: 'RenewalPayments', spreadsheetKey: 'MEMBERS_SPREADSHEET_ID',              joinKey: 'user_name' },
  { key: 'CleaningRota',    label: 'Cleaning Rota',    sheetName: 'CleaningRota',    spreadsheetKey: 'MEMBERS_SPREADSHEET_ID',              joinKey: 'user_name' },
  { key: 'SweepingRota',    label: 'Sweeping Rota',    sheetName: 'SweepingRota',    spreadsheetKey: 'MEMBERS_SPREADSHEET_ID',              joinKey: 'user_name' },
  { key: 'Players',         label: 'Players',          sheetName: 'Players',         spreadsheetKey: 'FRIENDLIES_SPREADSHEET_ID',           joinKey: 'user_name' },
  { key: 'Games',           label: 'Games',            sheetName: 'Games',           spreadsheetKey: 'FRIENDLIES_SPREADSHEET_ID',           joinKey: 'club_name' },
  { key: 'Clubs',           label: 'Clubs',            sheetName: 'clubs',           spreadsheetKey: 'MATCH_DAY_CONTACTS_SPREADSHEET_ID',   joinKey: 'club_name' },
  { key: 'Contacts',        label: 'Contacts',         sheetName: 'Contacts',        spreadsheetKey: 'MATCH_DAY_CONTACTS_SPREADSHEET_ID',   joinKey: 'club_name' },
];

// ============================================================================
// SPREADSHEET ID RESOLVER
// ============================================================================

export function getSpreadsheetIdForKey(key: string): string {
  switch (key) {
    case 'MEMBERS_SPREADSHEET_ID':
      return getSpreadsheetId();
    case 'FRIENDLIES_SPREADSHEET_ID':
      return getFriendliesSpreadsheetId();
    case 'MATCH_DAY_CONTACTS_SPREADSHEET_ID':
      return getMatchDayContactsSpreadsheetId();
    default:
      throw new Error(`Unknown spreadsheet key: ${key}`);
  }
}

// ============================================================================
// SCHEMA FETCHING
// ============================================================================

/**
 * Fetch column headers for a single sheet and return normalized + original names
 */
async function fetchSheetSchema(descriptor: SheetDescriptor): Promise<SheetSchema> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetIdForKey(descriptor.spreadsheetKey);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${descriptor.sheetName}'!1:1`,
  });

  const headers = response.data.values?.[0] || [];
  const columns: SchemaColumn[] = [];

  for (const header of headers) {
    const original = String(header).trim();
    if (!original) continue;

    const normalized = original
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/\//g, '_');

    columns.push({ name: normalized, originalHeader: original });
  }

  return {
    key: descriptor.key,
    label: descriptor.label,
    joinKey: descriptor.joinKey,
    columns,
  };
}

/**
 * Fetch schemas for all sheets in the registry
 */
export async function getAllSheetSchemas(): Promise<SheetSchema[]> {
  const results = await Promise.all(
    SHEET_REGISTRY.map((desc) => fetchSheetSchema(desc))
  );
  return results;
}

// ============================================================================
// DATA FETCHING
// ============================================================================

interface SheetData {
  headers: string[];          // Normalized column names
  originalHeaders: string[];  // Original header text
  rows: string[][];           // Raw row data
  columnMap: { [key: string]: number };
}

/**
 * Fetch all rows from a sheet, returning headers, rows, and column map
 */
export async function fetchSheetData(sheetKey: string): Promise<SheetData> {
  const descriptor = SHEET_REGISTRY.find((d) => d.key === sheetKey);
  if (!descriptor) {
    throw new Error(`Unknown sheet key: ${sheetKey}`);
  }

  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetIdForKey(descriptor.spreadsheetKey);

  // Fetch all data including header row
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${descriptor.sheetName}'!A:ZZ`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const allRows = response.data.values || [];
  if (allRows.length === 0) {
    return { headers: [], originalHeaders: [], rows: [], columnMap: {} };
  }

  const headerRow = allRows[0];
  const dataRows = allRows.slice(1);

  const headers: string[] = [];
  const originalHeaders: string[] = [];
  const columnMap: { [key: string]: number } = {};

  for (let i = 0; i < headerRow.length; i++) {
    const original = String(headerRow[i]).trim();
    if (!original) continue;

    const normalized = original
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/\//g, '_');

    headers.push(normalized);
    originalHeaders.push(original);
    columnMap[normalized] = i;
  }

  return { headers, originalHeaders, rows: dataRows, columnMap };
}

// ============================================================================
// REPORT EXECUTION
// ============================================================================

/**
 * Execute a report definition: fetch data, join, filter, select columns, write output
 */
export async function executeReport(definition: ReportDefinition): Promise<RunReportResponse> {
  const primaryDescriptor = SHEET_REGISTRY.find((d) => d.key === definition.primarySheet);
  if (!primaryDescriptor) {
    throw new Error(`Unknown primary sheet: ${definition.primarySheet}`);
  }

  // Fetch primary sheet data
  const primaryData = await fetchSheetData(definition.primarySheet);
  if (primaryData.rows.length === 0) {
    return { rowCount: 0, columnCount: 0, headers: [], preview: [] };
  }

  // Fetch joined sheet data
  const joinedData: { [key: string]: SheetData } = {};
  for (const joinKey of definition.joins) {
    const joinDescriptor = SHEET_REGISTRY.find((d) => d.key === joinKey);
    if (!joinDescriptor) {
      throw new Error(`Unknown join sheet: ${joinKey}`);
    }
    // Verify join compatibility
    if (joinDescriptor.joinKey !== primaryDescriptor.joinKey) {
      throw new Error(
        `Cannot join ${joinKey} (${joinDescriptor.joinKey}) with ${definition.primarySheet} (${primaryDescriptor.joinKey}): different join keys`
      );
    }
    joinedData[joinKey] = await fetchSheetData(joinKey);
  }

  // Build join indexes: Map<joinKeyValue, row[]> for each joined sheet
  const joinIndexes: { [sheetKey: string]: Map<string, string[][]> } = {};
  for (const [sheetKey, data] of Object.entries(joinedData)) {
    const descriptor = SHEET_REGISTRY.find((d) => d.key === sheetKey)!;
    const joinColIndex = data.columnMap[descriptor.joinKey];
    const index = new Map<string, string[][]>();

    if (joinColIndex !== undefined) {
      for (const row of data.rows) {
        const keyValue = (row[joinColIndex] || '').toLowerCase().trim();
        if (!keyValue) continue;
        if (!index.has(keyValue)) {
          index.set(keyValue, []);
        }
        index.get(keyValue)!.push(row);
      }
    }

    joinIndexes[sheetKey] = index;
  }

  // Parse selected columns into { sheetKey, columnName } pairs
  const selectedCols = definition.selectedColumns.map((col) => {
    const dotIndex = col.indexOf('.');
    return {
      sheetKey: col.substring(0, dotIndex),
      columnName: col.substring(dotIndex + 1),
      qualified: col,
    };
  });

  // Build output headers using original header names.
  // Only prefix with sheet label when the same original header appears in multiple sheets.
  const resolvedHeaders: { original: string; sheetKey: string }[] = [];
  for (const col of selectedCols) {
    let original = col.columnName;
    if (col.sheetKey === definition.primarySheet) {
      const headerIdx = primaryData.headers.indexOf(col.columnName);
      if (headerIdx !== -1) original = primaryData.originalHeaders[headerIdx];
    } else if (joinedData[col.sheetKey]) {
      const data = joinedData[col.sheetKey];
      const headerIdx = data.headers.indexOf(col.columnName);
      if (headerIdx !== -1) original = data.originalHeaders[headerIdx];
    }
    resolvedHeaders.push({ original, sheetKey: col.sheetKey });
  }

  const outputHeaders = resolvedHeaders.map((h) => h.original);

  // Perform LEFT JOIN: iterate primary rows, expand with joined data
  const primaryJoinColIndex = primaryData.columnMap[primaryDescriptor.joinKey];
  let joinedRows: { [sheetKey: string]: string[] | null }[] = [];

  for (const primaryRow of primaryData.rows) {
    const primaryKeyValue = primaryJoinColIndex !== undefined
      ? (primaryRow[primaryJoinColIndex] || '').toLowerCase().trim()
      : '';

    // For each primary row, find matching rows in all joined sheets
    // and produce the cartesian product across joins
    let expansions: { [sheetKey: string]: string[] | null }[] = [
      { [definition.primarySheet]: primaryRow as string[] },
    ];

    for (const joinSheetKey of definition.joins) {
      const matchedRows = primaryKeyValue
        ? joinIndexes[joinSheetKey]?.get(primaryKeyValue) || []
        : [];

      const newExpansions: { [sheetKey: string]: string[] | null }[] = [];

      if (matchedRows.length === 0) {
        // LEFT JOIN: keep primary row with nulls for this join
        for (const existing of expansions) {
          newExpansions.push({ ...existing, [joinSheetKey]: null });
        }
      } else {
        // Expand: each existing expansion x each matched row
        for (const existing of expansions) {
          for (const matchedRow of matchedRows) {
            newExpansions.push({ ...existing, [joinSheetKey]: matchedRow as string[] });
          }
        }
      }

      expansions = newExpansions;
    }

    joinedRows.push(...expansions);
  }

  // Apply filters (AND across filters, OR within each filter's values)
  const filteredRows = joinedRows.filter((expandedRow) => {
    return definition.filters.every((filter) => {
      const dotIndex = filter.column.indexOf('.');
      const filterSheetKey = filter.column.substring(0, dotIndex);
      const filterColName = filter.column.substring(dotIndex + 1);

      const sheetRow = expandedRow[filterSheetKey];

      // Helper to resolve cell value (returns null if row/column missing)
      function getCellValue(): string | null {
        if (!sheetRow) return null;
        let colIndex: number | undefined;
        if (filterSheetKey === definition.primarySheet) {
          colIndex = primaryData.columnMap[filterColName];
        } else if (joinedData[filterSheetKey]) {
          colIndex = joinedData[filterSheetKey].columnMap[filterColName];
        }
        if (colIndex === undefined) return null;
        return (sheetRow[colIndex] || '').trim();
      }

      if (filter.operator === 'is_blank') {
        // True when there is no joined row at all, or the cell is empty
        if (!sheetRow) return true;
        const v = getCellValue();
        return v === null || v === '';
      }

      if (filter.operator === 'is_not_blank') {
        if (!sheetRow) return false;
        const v = getCellValue();
        return v !== null && v !== '';
      }

      if (!sheetRow) return false; // remaining operators need a row

      const cellValue = getCellValue() ?? '';

      if (filter.operator === 'in') {
        return filter.values.some(
          (v) => v.trim().toLowerCase() === cellValue.toLowerCase()
        );
      }

      if (filter.operator === 'not_in') {
        return !filter.values.some(
          (v) => v.trim().toLowerCase() === cellValue.toLowerCase()
        );
      }

      if (filter.operator === 'contains') {
        return filter.values.some(
          (v) => cellValue.toLowerCase().includes(v.trim().toLowerCase())
        );
      }

      if (filter.operator === 'not_contains') {
        return filter.values.every(
          (v) => !cellValue.toLowerCase().includes(v.trim().toLowerCase())
        );
      }

      return false;
    });
  });

  // Select columns from filtered rows
  const outputRows: string[][] = filteredRows.map((expandedRow) => {
    return selectedCols.map((col) => {
      const sheetRow = expandedRow[col.sheetKey];
      if (!sheetRow) return '';

      let colIndex: number | undefined;
      if (col.sheetKey === definition.primarySheet) {
        colIndex = primaryData.columnMap[col.columnName];
      } else if (joinedData[col.sheetKey]) {
        colIndex = joinedData[col.sheetKey].columnMap[col.columnName];
      }

      if (colIndex === undefined) return '';
      return sheetRow[colIndex] || '';
    });
  });

  // Write to ReportOutput tab
  await writeReportOutput(outputHeaders, outputRows);

  // Return response with preview
  return {
    rowCount: outputRows.length,
    columnCount: outputHeaders.length,
    headers: outputHeaders,
    preview: outputRows.slice(0, 10),
  };
}

// ============================================================================
// REPORT OUTPUT WRITING
// ============================================================================

/**
 * Clear and write report results to the ReportOutput tab in the Members spreadsheet
 */
async function writeReportOutput(headers: string[], rows: string[][]): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Clear existing content
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'ReportOutput!A:ZZ',
  });

  // Write header + data rows
  if (headers.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'ReportOutput!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [headers, ...rows],
      },
    });
  }
}

// ============================================================================
// REPORT DEFINITIONS CRUD
// ============================================================================

/**
 * List all saved report definitions (summary only)
 */
export async function listDefinitions(): Promise<DefinitionSummary[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'ReportDefinitions!A:E',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) return []; // Header only or empty

  const definitions: DefinitionSummary[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue; // Skip empty rows

    definitions.push({
      id: row[0] || '',
      name: row[1] || '',
      createdAt: row[3] || '',
      updatedAt: row[4] || '',
    });
  }

  return definitions;
}

/**
 * Get a single report definition by ID
 */
export async function getDefinition(id: string): Promise<ReportDefinition | null> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'ReportDefinitions!A:E',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] === id) {
      try {
        const definition: ReportDefinition = JSON.parse(row[2] || '{}');
        definition.id = row[0];
        definition.name = row[1];
        definition.createdAt = row[3];
        definition.updatedAt = row[4];
        return definition;
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Save or update a report definition
 */
export async function saveDefinition(
  name: string,
  definition: ReportDefinition,
  existingId?: string
): Promise<DefinitionSummary> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const now = new Date().toISOString();

  if (existingId) {
    // Update existing definition — find its row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'ReportDefinitions!A:E',
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = response.data.values || [];
    let rowNumber = -1;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === existingId) {
        rowNumber = i + 1; // 1-indexed sheet row
        break;
      }
    }

    if (rowNumber === -1) {
      throw new Error(`Definition ${existingId} not found`);
    }

    const definitionJson = JSON.stringify(definition);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `ReportDefinitions!A${rowNumber}:E${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[existingId, name, definitionJson, rows[rowNumber - 1]?.[3] || now, now]],
      },
    });

    return {
      id: existingId,
      name,
      createdAt: rows[rowNumber - 1]?.[3] || now,
      updatedAt: now,
    };
  } else {
    // Create new definition
    const id = `rpt_${Date.now()}`;
    const definitionJson = JSON.stringify(definition);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'ReportDefinitions!A:E',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[id, name, definitionJson, now, now]],
      },
    });

    return { id, name, createdAt: now, updatedAt: now };
  }
}

/**
 * Delete a report definition by ID
 */
export async function deleteDefinition(id: string): Promise<boolean> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Find the row
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'ReportDefinitions!A:E',
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];
  let rowNumber = -1;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      rowNumber = i + 1; // 1-indexed sheet row
      break;
    }
  }

  if (rowNumber === -1) {
    return false;
  }

  // Get the sheet ID for ReportDefinitions
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  const reportDefSheet = spreadsheet.data.sheets?.find(
    (s) => s.properties?.title === 'ReportDefinitions'
  );

  if (!reportDefSheet?.properties?.sheetId && reportDefSheet?.properties?.sheetId !== 0) {
    throw new Error('ReportDefinitions sheet not found');
  }

  // Delete the row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: reportDefSheet.properties.sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1, // 0-indexed
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });

  return true;
}
