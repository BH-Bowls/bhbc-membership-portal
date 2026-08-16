// src/lib/leavers-sheets.ts
// Data layer for the Leavers sheet (lives in the Members spreadsheet).
// The Leavers sheet has the same columns as Members plus three extra columns
// (Left Date, Left Reason, Left Notes). These helpers archive an active member
// to Leavers, reinstate a leaver back into Members, and list all leavers.
//
// Column positions are always resolved via getColumnMap so the code does not
// depend on the physical order of columns in either sheet.

import {
  getGoogleSheetsClient,
  getSpreadsheetId,
  getColumnMap,
} from './sheets';

// Sheet tab names and the ranges used to read all data rows.
const MEMBERS_SHEET = 'Members';
const LEAVERS_SHEET = 'Leavers';
const MEMBERS_RANGE = 'Members!A2:ZZ';
const LEAVERS_RANGE = 'Leavers!A2:ZZ';
// Row 1 is the header row, so data row index 0 maps to sheet row 2.
const HEADER_ROW_OFFSET = 2;

// The three extra columns that exist on Leavers but not on Members.
const LEFT_DATE_COLUMN = 'left_date';
const LEFT_REASON_COLUMN = 'left_reason';
const LEFT_NOTES_COLUMN = 'left_notes';

// Columns in the Members sheet that are produced by a sheet formula (typically an
// ARRAYFORMULA) and must never be written by the app — writing a value would
// overwrite the formula and break it (#REF!). Reinstate skips these when writing a
// leaver back to Members; their ARRAYFORMULA fills them automatically.
// IMPORTANT: keep this list in sync with the Members sheet. Add the normalized
// header name (lowercase, spaces -> underscores) of EVERY computed column —
// including the calculated age and Gmail Labels columns — before using Reinstate.
const MEMBERS_COMPUTED_COLUMNS = new Set<string>([
  'full_known_as',
  'full_name',
  'age',
  'gmail_labels',
]);

/**
 * Leaver — a lightweight view of one row from the Leavers sheet for list display.
 * The full row is preserved in the sheet; this type only surfaces the fields the
 * leavers page needs to show plus the archive metadata.
 */
export interface Leaver {
  userName: string;
  firstName: string;
  lastName: string;
  knownAs: string;
  memberType: string;
  yearStarted: string;
  emailAddress: string;
  leftDate: string;
  leftReason: string;
  leftNotes: string;
}

/**
 * Read a cell from a row by column name, returning a trimmed string.
 *
 * @param row Raw row array from Google Sheets
 * @param colMap Column-name to index map
 * @param field Normalized column name
 * @returns The cell value, or '' when absent
 */
function getCell(row: any[], colMap: { [key: string]: number }, field: string): string {
  const index = colMap[field];
  if (index === undefined) {
    return '';
  }
  const value = row[index];
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

/**
 * Find the numeric (internal) sheetId for a named tab. The deleteDimension
 * batch request needs this id rather than the sheet's title.
 *
 * @param sheetName The tab title to look up
 * @returns The numeric sheetId
 * @throws Error if the named sheet does not exist
 */
async function getSheetIdByName(sheetName: string): Promise<number> {
  const sheets = getGoogleSheetsClient();

  // Fetch only the sheet properties (titles + ids), not any cell data
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
    fields: 'sheets.properties',
  });

  const sheetsList = meta.data.sheets;
  if (sheetsList) {
    for (let i = 0; i < sheetsList.length; i++) {
      const props = sheetsList[i].properties;
      if (props && props.title === sheetName) {
        if (props.sheetId !== undefined && props.sheetId !== null) {
          return props.sheetId;
        }
      }
    }
  }

  throw new Error(`Sheet not found: ${sheetName}`);
}

/**
 * Delete a single row from a sheet by its 1-indexed row number (physical delete).
 *
 * @param sheetName The tab to delete from
 * @param rowNumber The 1-indexed sheet row to remove
 */
async function deleteSheetRow(sheetName: string, rowNumber: number): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const sheetId = await getSheetIdByName(sheetName);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              // Google Sheets dimension indices are 0-based; sheet row 2 = index 1
              startIndex: rowNumber - 1,
              endIndex: rowNumber, // exclusive end
            },
          },
        },
      ],
    },
  });
}

/**
 * Find a raw row in a sheet by matching the user_name column (case-insensitive).
 *
 * @param range The A2-based read range for the sheet
 * @param colMap Column-name to index map for the sheet
 * @returns The raw row array and its 1-indexed sheet row number, or null if not found
 */
async function findRawRowByUserName(
  range: string,
  colMap: { [key: string]: number },
  userName: string
): Promise<{ row: any[]; rowNumber: number } | null> {
  const sheets = getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range,
  });

  const rows = response.data.values;
  if (!rows) {
    return null;
  }

  const userNameIndex = colMap['user_name'];
  if (userNameIndex === undefined) {
    return null;
  }

  const target = userName.toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowUserName = row[userNameIndex];
    if (rowUserName && String(rowUserName).toLowerCase() === target) {
      return { row, rowNumber: i + HEADER_ROW_OFFSET };
    }
  }

  return null;
}

/**
 * Build a destination row array for an append, mapping values from a source row
 * by shared column name. The array is sized to cover every destination column
 * and filled with empty strings so the append has no undefined holes.
 *
 * @param sourceRow The raw source row
 * @param sourceColMap Column map for the source sheet
 * @param destColMap Column map for the destination sheet
 * @returns A new row array positioned for the destination sheet
 */
function buildMappedRow(
  sourceRow: any[],
  sourceColMap: { [key: string]: number },
  destColMap: { [key: string]: number },
  skipColumns?: Set<string>
): any[] {
  // Determine how wide the destination row needs to be
  let maxIndex = 0;
  for (const index of Object.values(destColMap)) {
    if (index > maxIndex) {
      maxIndex = index;
    }
  }

  // Start with a fully blank row using null (not '') so unmapped cells are
  // genuinely empty. This matters when the destination is the Members sheet:
  // empty cells let ARRAYFORMULA columns spill, whereas '' would break them.
  const destRow: any[] = [];
  for (let i = 0; i <= maxIndex; i++) {
    destRow[i] = null;
  }

  // Copy each destination column from the matching source column by name
  for (const [columnName, destIndex] of Object.entries(destColMap)) {
    // Skip computed/formula columns (e.g. when writing back to Members) so a
    // static value never overwrites an ARRAYFORMULA
    if (skipColumns && skipColumns.has(columnName)) {
      continue;
    }
    const sourceIndex = sourceColMap[columnName];
    if (sourceIndex === undefined) {
      // No matching column in the source (e.g. the left_* columns) — leave empty
      continue;
    }
    const value = sourceRow[sourceIndex];
    if (value === undefined || value === null || value === '') {
      // Leave empty as null so formula columns are not blocked
      continue;
    }
    destRow[destIndex] = value;
  }

  return destRow;
}

/**
 * List all leavers for the leavers management page.
 *
 * @returns Array of Leaver display objects, in sheet order
 */
export async function getAllLeavers(): Promise<Leaver[]> {
  const colMap = await getColumnMap(LEAVERS_SHEET);
  const sheets = getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: LEAVERS_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    return [];
  }

  const leavers: Leaver[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Skip rows with no username (genuinely empty rows)
    const userName = getCell(row, colMap, 'user_name');
    if (!userName) {
      continue;
    }

    leavers.push({
      userName,
      firstName: getCell(row, colMap, 'first_name'),
      lastName: getCell(row, colMap, 'last_name'),
      knownAs: getCell(row, colMap, 'known_as'),
      memberType: getCell(row, colMap, 'member_type'),
      yearStarted: getCell(row, colMap, 'year_started'),
      emailAddress: getCell(row, colMap, 'email_address'),
      leftDate: getCell(row, colMap, LEFT_DATE_COLUMN),
      leftReason: getCell(row, colMap, LEFT_REASON_COLUMN),
      leftNotes: getCell(row, colMap, LEFT_NOTES_COLUMN),
    });
  }

  return leavers;
}

/**
 * Full detail of a single leaver for the read-only view.
 */
export interface LeaverDetail {
  userName: string;
  firstName: string;
  lastName: string;
  knownAs: string;
  emailAddress: string;
  landline: string;
  mobile: string;
  address1: string;
  address2: string;
  address3: string;
  postCode: string;
  ageDemographic: string;
  birthdate: string;
  memberType: string;
  yearStarted: string;
  honorary: string;
  handicap: string;
  role: string;
  leftDate: string;
  leftReason: string;
  leftNotes: string;
}

/**
 * Read a single leaver's full details by username (for the read-only view).
 *
 * @param userName The leaver's username
 * @returns The leaver detail, or null if not found
 */
export async function getLeaverByUserName(userName: string): Promise<LeaverDetail | null> {
  const colMap = await getColumnMap(LEAVERS_SHEET);
  const found = await findRawRowByUserName(LEAVERS_RANGE, colMap, userName);
  if (!found) {
    return null;
  }

  const row = found.row;
  return {
    userName: getCell(row, colMap, 'user_name'),
    firstName: getCell(row, colMap, 'first_name'),
    lastName: getCell(row, colMap, 'last_name'),
    knownAs: getCell(row, colMap, 'known_as'),
    emailAddress: getCell(row, colMap, 'email_address'),
    landline: getCell(row, colMap, 'landline'),
    mobile: getCell(row, colMap, 'mobile'),
    address1: getCell(row, colMap, 'address_1'),
    address2: getCell(row, colMap, 'address_2'),
    address3: getCell(row, colMap, 'address_3'),
    postCode: getCell(row, colMap, 'post_code'),
    ageDemographic: getCell(row, colMap, 'age_demographic'),
    birthdate: getCell(row, colMap, 'birthdate'),
    memberType: getCell(row, colMap, 'member_type'),
    yearStarted: getCell(row, colMap, 'year_started'),
    honorary: getCell(row, colMap, 'honorary'),
    handicap: getCell(row, colMap, 'handicap'),
    role: getCell(row, colMap, 'role'),
    leftDate: getCell(row, colMap, LEFT_DATE_COLUMN),
    leftReason: getCell(row, colMap, LEFT_REASON_COLUMN),
    leftNotes: getCell(row, colMap, LEFT_NOTES_COLUMN),
  };
}

/**
 * Archive an active member: copy their full Members row to the Leavers sheet
 * (adding the left_date / left_reason / left_notes metadata), then physically
 * delete the row from Members.
 *
 * The Leavers row is written first so the member's data is preserved even if the
 * subsequent delete fails.
 *
 * @param userName The member's username
 * @param leftDate Date archived (DD/MM/YYYY)
 * @param leftReason Reason (Lapsed / Resigned / Deceased)
 * @param leftNotes Optional free-text notes
 * @returns Success flag with an error message on failure
 */
export async function archiveMember(
  userName: string,
  leftDate: string,
  leftReason: string,
  leftNotes: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const membersColMap = await getColumnMap(MEMBERS_SHEET);
    const leaversColMap = await getColumnMap(LEAVERS_SHEET);

    // Locate the member's raw row so every column is preserved on archive
    const found = await findRawRowByUserName(MEMBERS_RANGE, membersColMap, userName);
    if (!found) {
      return { success: false, error: 'Member not found' };
    }

    // Map the Members row into Leavers column order
    const leaversRow = buildMappedRow(found.row, membersColMap, leaversColMap);

    // Fill in the three archive-only columns
    if (leaversColMap[LEFT_DATE_COLUMN] !== undefined) {
      leaversRow[leaversColMap[LEFT_DATE_COLUMN]] = leftDate;
    }
    if (leaversColMap[LEFT_REASON_COLUMN] !== undefined) {
      leaversRow[leaversColMap[LEFT_REASON_COLUMN]] = leftReason;
    }
    if (leaversColMap[LEFT_NOTES_COLUMN] !== undefined) {
      leaversRow[leaversColMap[LEFT_NOTES_COLUMN]] = leftNotes;
    }

    const sheets = getGoogleSheetsClient();

    // Append to Leavers first (preserves data before the destructive delete)
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'Leavers!A:ZZ',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [leaversRow],
      },
    });

    // Then remove the row from the Members sheet
    await deleteSheetRow(MEMBERS_SHEET, found.rowNumber);

    return { success: true };
  } catch (error) {
    console.error(`[archiveMember] Failed to archive ${userName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to archive member',
    };
  }
}

/**
 * Reinstate a leaver: copy their row from Leavers back to Members (excluding the
 * left_* columns, which have no Members equivalent), then physically delete the
 * row from Leavers.
 *
 * The Members row is written first so the leaver's data is preserved even if the
 * subsequent delete fails.
 *
 * @param userName The leaver's username
 * @returns Success flag with an error message on failure
 */
export async function reinstateMember(
  userName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const membersColMap = await getColumnMap(MEMBERS_SHEET);
    const leaversColMap = await getColumnMap(LEAVERS_SHEET);

    // Locate the leaver's raw row
    const found = await findRawRowByUserName(LEAVERS_RANGE, leaversColMap, userName);
    if (!found) {
      return { success: false, error: 'Leaver not found' };
    }

    // Map the Leavers row into Members column order. Because the mapping is by
    // shared column name, the left_* columns are naturally excluded (Members has
    // no such columns). Computed columns are skipped so we never overwrite their
    // ARRAYFORMULA with the static value that was frozen into the Leavers sheet.
    const membersRow = buildMappedRow(found.row, leaversColMap, membersColMap, MEMBERS_COMPUTED_COLUMNS);

    const sheets = getGoogleSheetsClient();

    // Append to Members first (preserves data before the destructive delete)
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'Members!A:ZZ',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [membersRow],
      },
    });

    // Then remove the row from the Leavers sheet
    await deleteSheetRow(LEAVERS_SHEET, found.rowNumber);

    return { success: true };
  } catch (error) {
    console.error(`[reinstateMember] Failed to reinstate ${userName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reinstate member',
    };
  }
}
