// src/lib/applications-sheets.ts
// Data layer for the membership Applications sheet (lives in the Members spreadsheet).
// Provides read/update helpers for the application management workflow:
// list applications, read a single row, update specific fields, and count
// applications that need admin action (used by the Diary panel and hub badge).

import {
  getGoogleSheetsClient,
  getSpreadsheetId,
  getColumnMap,
  getColumnLetter,
} from './sheets';
import { parseUKDate } from './date-utils';
import { createMember } from './members-admin';

// Sheet tab name and the range used to read all application rows.
const APPLICATIONS_SHEET = 'Applications';
const APPLICATIONS_RANGE = 'Applications!A2:ZZ';
// Row 1 is the header row, so data row index 0 maps to sheet row 2.
const HEADER_ROW_OFFSET = 2;
// Number of days the objection period runs after a name is listed on the board.
const OBJECTION_PERIOD_DAYS = 14;

/**
 * Application — represents one row from the Applications sheet.
 * The personal-detail fields come from the public /apply form; the remaining
 * fields are added and managed by the admin workflow.
 */
export interface Application {
  rowNumber: number; // 1-indexed sheet row (used as the stable id in API routes)
  firstName: string;
  lastName: string;
  knownAs: string;
  gender: string; // 'M' or 'F'
  emailAddress: string;
  landline: string;
  mobile: string;
  address1: string;
  address2: string;
  address3: string;
  postCode: string;
  ageDemographic: string;
  dob: string;
  ftEducation: string;
  memberType: string; // 'Playing' or 'Social' (as submitted on the form)
  previousExperience: string;
  disabilities: string;
  proposerName: string;
  seconderName: string;
  comments: string;
  createdAt: string;
  // Workflow columns (added by this feature):
  status: string;
  listedDate: string;
  feeDue: number | null;
  feePaid: number | null;
  paymentMethod: string;
  paymentDate: string;
  decisionNotes: string;
  approvedAt: string;
  convertedAt: string;
  convertedUsername: string;
}

/**
 * Read a cell value from a row by column name, returning a trimmed string.
 * Returns an empty string when the column is missing or the cell is blank.
 *
 * @param row Raw row array from Google Sheets
 * @param colMap Column-name to index map from getColumnMap
 * @param field Normalized column name (e.g. 'first_name')
 * @returns The cell value as a string, or '' when absent
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
 * Parse a money cell into a number, or null when the cell is blank.
 * Strips any leading £ sign and commas before parsing.
 *
 * @param row Raw row array from Google Sheets
 * @param colMap Column-name to index map
 * @param field Normalized column name (e.g. 'fee_due')
 * @returns The numeric value, or null when blank/invalid
 */
function getMoneyCell(row: any[], colMap: { [key: string]: number }, field: string): number | null {
  const raw = getCell(row, colMap, field);
  if (!raw) {
    return null;
  }
  const cleaned = raw.replace(/[£,\s]/g, '');
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) {
    return null;
  }
  return parsed;
}

/**
 * Convert a raw Applications sheet row into a typed Application object.
 *
 * @param row Raw row array from Google Sheets
 * @param rowNumber The 1-indexed sheet row number for this row
 * @param colMap Column-name to index map
 * @returns A fully populated Application object
 */
function parseApplicationRow(
  row: any[],
  rowNumber: number,
  colMap: { [key: string]: number }
): Application {
  return {
    rowNumber,
    firstName: getCell(row, colMap, 'first_name'),
    lastName: getCell(row, colMap, 'last_name'),
    knownAs: getCell(row, colMap, 'known_as'),
    gender: getCell(row, colMap, 'gender'),
    emailAddress: getCell(row, colMap, 'email_address'),
    landline: getCell(row, colMap, 'landline'),
    mobile: getCell(row, colMap, 'mobile'),
    address1: getCell(row, colMap, 'address_1'),
    address2: getCell(row, colMap, 'address_2'),
    address3: getCell(row, colMap, 'address_3'),
    postCode: getCell(row, colMap, 'post_code'),
    ageDemographic: getCell(row, colMap, 'age_demographic'),
    dob: getCell(row, colMap, 'dob'),
    ftEducation: getCell(row, colMap, 'ft_education'),
    memberType: getCell(row, colMap, 'member_type'),
    previousExperience: getCell(row, colMap, 'previous_experience'),
    disabilities: getCell(row, colMap, 'disabilities'),
    proposerName: getCell(row, colMap, 'proposer_name'),
    seconderName: getCell(row, colMap, 'seconder_name'),
    comments: getCell(row, colMap, 'comments'),
    createdAt: getCell(row, colMap, 'created_at'),
    status: getCell(row, colMap, 'status'),
    listedDate: getCell(row, colMap, 'listed_date'),
    feeDue: getMoneyCell(row, colMap, 'fee_due'),
    feePaid: getMoneyCell(row, colMap, 'fee_paid'),
    paymentMethod: getCell(row, colMap, 'payment_method'),
    paymentDate: getCell(row, colMap, 'payment_date'),
    decisionNotes: getCell(row, colMap, 'decision_notes'),
    approvedAt: getCell(row, colMap, 'approved_at'),
    convertedAt: getCell(row, colMap, 'converted_at'),
    convertedUsername: getCell(row, colMap, 'converted_username'),
  };
}

/**
 * Read every row from the Applications sheet and return them as typed objects.
 * Rows with no first name and no last name (genuinely empty rows) are skipped.
 *
 * @returns Array of all applications, in sheet order
 */
export async function getAllApplications(): Promise<Application[]> {
  const colMap = await getColumnMap(APPLICATIONS_SHEET);
  const sheets = getGoogleSheetsClient();

  // Fetch all data rows (header row excluded by the A2 start)
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: APPLICATIONS_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    return [];
  }

  const applications: Application[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + HEADER_ROW_OFFSET;
    const application = parseApplicationRow(row, rowNumber, colMap);

    // Skip blank rows that have neither a first nor a last name
    if (!application.firstName && !application.lastName) {
      continue;
    }

    applications.push(application);
  }

  return applications;
}

/**
 * Read a single application by its sheet row number.
 *
 * @param rowNumber The 1-indexed sheet row number
 * @returns The Application, or null when the row is empty/out of range
 */
export async function getApplicationByRow(rowNumber: number): Promise<Application | null> {
  // Reject obviously invalid row numbers (row 1 is the header)
  if (!rowNumber || rowNumber < HEADER_ROW_OFFSET) {
    return null;
  }

  const colMap = await getColumnMap(APPLICATIONS_SHEET);
  const sheets = getGoogleSheetsClient();

  // Read just the one row we need
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${APPLICATIONS_SHEET}!A${rowNumber}:ZZ${rowNumber}`,
  });

  const rows = response.data.values;
  if (!rows || !rows[0]) {
    return null;
  }

  const application = parseApplicationRow(rows[0], rowNumber, colMap);

  // Treat a row with no name as "not found"
  if (!application.firstName && !application.lastName) {
    return null;
  }

  return application;
}

/**
 * Map an Application field name to its Applications sheet column name.
 * Only the workflow-managed fields are writable through this helper.
 */
const FIELD_TO_COLUMN: { [key: string]: string } = {
  status: 'status',
  listedDate: 'listed_date',
  feeDue: 'fee_due',
  feePaid: 'fee_paid',
  paymentMethod: 'payment_method',
  paymentDate: 'payment_date',
  decisionNotes: 'decision_notes',
  approvedAt: 'approved_at',
  convertedAt: 'converted_at',
  convertedUsername: 'converted_username',
};

/**
 * Update specific fields on a single application row.
 * Only the workflow columns listed in FIELD_TO_COLUMN can be written; any other
 * keys in the fields object are ignored. Uses a single batch update.
 *
 * @param rowNumber The 1-indexed sheet row number to update
 * @param fields Partial set of Application fields to write
 */
export async function updateApplicationFields(
  rowNumber: number,
  fields: Partial<Application>
): Promise<void> {
  const colMap = await getColumnMap(APPLICATIONS_SHEET);
  const sheets = getGoogleSheetsClient();

  // Build the list of individual cell updates for the batch request
  const data: { range: string; values: any[][] }[] = [];

  for (const [field, value] of Object.entries(fields)) {
    // Only allow writing known workflow columns
    const columnName = FIELD_TO_COLUMN[field];
    if (!columnName) {
      continue;
    }

    const colIndex = colMap[columnName];
    if (colIndex === undefined) {
      continue;
    }

    const colLetter = getColumnLetter(colIndex);

    // Write an empty string for null/undefined so the cell is cleared cleanly
    let cellValue: any = value;
    if (cellValue === null || cellValue === undefined) {
      cellValue = '';
    }

    data.push({
      range: `${APPLICATIONS_SHEET}!${colLetter}${rowNumber}`,
      values: [[cellValue]],
    });
  }

  if (data.length === 0) {
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      data,
      valueInputOption: 'USER_ENTERED',
    },
  });
}

/**
 * Determine whether an application currently needs admin action.
 * An application needs action when it is either:
 *  - 'Submitted' (a listed date still needs to be set), or
 *  - 'Listed' and the 14-day objection period has now passed.
 *
 * @param application The application to test
 * @returns true when the application needs admin action
 */
export function applicationNeedsAction(application: Application): boolean {
  // Newly submitted applications always need a listed date set
  if (application.status === 'Submitted') {
    return true;
  }

  // Listed applications need action once the objection period has elapsed
  if (application.status === 'Listed' && application.listedDate) {
    const listed = parseUKDate(application.listedDate);

    // Compute the objection deadline (listed date + 14 days)
    const deadline = new Date(listed.getTime());
    deadline.setDate(deadline.getDate() + OBJECTION_PERIOD_DAYS);

    // Compare against the start of today so the deadline day itself counts as passed
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (deadline.getTime() <= today.getTime()) {
      return true;
    }
  }

  return false;
}

/**
 * Count the applications that currently need admin action.
 * Used by the Diary panel item and the /admin/members hub badge.
 *
 * @returns The number of applications awaiting admin action
 */
export async function getPendingApplicationsCount(): Promise<number> {
  const applications = await getAllApplications();

  let count = 0;
  for (let i = 0; i < applications.length; i++) {
    if (applicationNeedsAction(applications[i])) {
      count++;
    }
  }

  return count;
}

// ============================================================================
// CONVERSION TO MEMBER
// ============================================================================

// Result of a successful conversion — the new username and the plain-text temp
// password (the only time the password exists in plain text, for the welcome email).
export interface ConversionResult {
  success: boolean;
  userName?: string;
  tempPassword?: string;
  error?: string;
}

/**
 * Convert a paid application into an active member. Creates the member via the
 * shared createMember helper (same path used by manual Create), then marks the
 * application Converted with the assigned username.
 *
 * The welcome email is sent by the caller using the returned plain-text password.
 *
 * @param application The application to convert (must be in 'Paid' status)
 * @returns The assigned username and plain-text temp password, or an error
 */
export async function convertApplicationToMember(
  application: Application
): Promise<ConversionResult> {
  try {
    // Create the member from the application's personal details
    const result = await createMember({
      firstName: application.firstName,
      lastName: application.lastName,
      knownAs: application.knownAs,
      gender: application.gender,
      memberType: application.memberType,
      emailAddress: application.emailAddress,
      landline: application.landline,
      mobile: application.mobile,
      address1: application.address1,
      address2: application.address2,
      address3: application.address3,
      postCode: application.postCode,
      ageDemographic: application.ageDemographic,
      dob: application.dob,
    });

    // Pass through a creation failure unchanged
    if (!result.success || !result.userName) {
      return result;
    }

    // Mark the application as converted, recording the assigned username
    await updateApplicationFields(application.rowNumber, {
      status: 'Converted',
      convertedAt: new Date().toISOString(),
      convertedUsername: result.userName,
    });

    return result;
  } catch (error) {
    console.error(`[convertApplicationToMember] Failed for row ${application.rowNumber}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to convert application',
    };
  }
}
