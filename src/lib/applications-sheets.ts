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
  getAllUsers,
} from './sheets';
import { parseUKDate } from './date-utils';
import { hashPassword } from './auth-sheets';
import { getAllLeavers } from './leavers-sheets';

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

// Character set for generated temporary passwords (no ambiguous characters).
const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 8;

/**
 * Generate a random 8-character alphanumeric temporary password for a new member.
 * (The forgot-password flow uses a separate 4-digit code; new members get a
 * longer alphanumeric password per the membership lifecycle spec.)
 *
 * @returns An 8-character alphanumeric password
 */
function generateMemberTempPassword(): string {
  let password = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    const index = Math.floor(Math.random() * TEMP_PASSWORD_CHARS.length);
    password += TEMP_PASSWORD_CHARS.charAt(index);
  }
  return password;
}

/**
 * Strip a name part down to lowercase alphanumeric characters only.
 * Removes spaces, apostrophes, dots and any other punctuation.
 * Example: "O'Brien" -> "obrien", "A.J." -> "aj".
 *
 * @param part A first or last name
 * @returns The cleaned, lowercased part
 */
function cleanNamePart(part: string): string {
  return part.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Derive the full member type name (e.g. "Playing Man") from the gender and the
 * Playing/Social membership type submitted on the application form.
 *
 * @param gender 'M' or 'F'
 * @param memberType 'Playing' or 'Social'
 * @returns The full member type name, or '' if it cannot be determined
 */
function deriveMemberTypeFullName(gender: string, memberType: string): string {
  if (memberType === 'Playing') {
    return gender === 'M' ? 'Playing Man' : 'Playing Lady';
  }
  if (memberType === 'Social') {
    return gender === 'M' ? 'Social Man' : 'Social Lady';
  }
  return '';
}

/**
 * Derive a unique username for a new member, checking against both the Members
 * and Leavers sheets. The base is "<knownAs-or-firstName>.<lastName>" cleaned to
 * lowercase alphanumerics; if it collides, a numeric suffix (2, 3, …) is added.
 *
 * Both sheets are checked because a leaver keeps their original username, and
 * reinstating them later must not collide with a newer member.
 *
 * @param application The application being converted
 * @returns A username not currently in use in either sheet
 */
async function deriveUniqueUsername(application: Application): Promise<string> {
  // Prefer the "known as" name when present, otherwise the first name
  let baseFirst = application.knownAs;
  if (!baseFirst) {
    baseFirst = application.firstName;
  }

  // Build the base username from cleaned name parts
  const base = `${cleanNamePart(baseFirst)}.${cleanNamePart(application.lastName)}`;

  // Collect every existing username (Members + Leavers), lowercased
  const taken = new Set<string>();

  const members = await getAllUsers();
  for (let i = 0; i < members.length; i++) {
    if (members[i].userName) {
      taken.add(members[i].userName.toLowerCase());
    }
  }

  const leavers = await getAllLeavers();
  for (let i = 0; i < leavers.length; i++) {
    if (leavers[i].userName) {
      taken.add(leavers[i].userName.toLowerCase());
    }
  }

  // Use the base if it is free
  if (!taken.has(base)) {
    return base;
  }

  // Otherwise append an increasing numeric suffix until a free name is found
  let suffix = 2;
  while (taken.has(`${base}${suffix}`)) {
    suffix++;
  }
  return `${base}${suffix}`;
}

// Result of a successful conversion — the new username and the plain-text temp
// password (the only time the password exists in plain text, for the welcome email).
export interface ConversionResult {
  success: boolean;
  userName?: string;
  tempPassword?: string;
  error?: string;
}

/**
 * Convert a paid application into an active member.
 *  1. Derive a unique username (checked against Members + Leavers)
 *  2. Generate an 8-char temp password and bcrypt-hash it
 *  3. Translate gender + Playing/Social into the full member_type name
 *  4. Append the new member row to the Members sheet
 *  5. Mark the application Converted (status, converted_at, converted_username)
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
    // Step 1 — derive a unique username
    const userName = await deriveUniqueUsername(application);

    // Step 2 — generate and hash a temporary password
    const tempPassword = generateMemberTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    // Step 3 — translate the member type to its full-name form
    const memberTypeFullName = deriveMemberTypeFullName(
      application.gender,
      application.memberType
    );

    // Step 4 — append the new member row to the Members sheet
    const membersColMap = await getColumnMap('Members');
    const sheets = getGoogleSheetsClient();
    const nowIso = new Date().toISOString();
    const currentYear = new Date().getFullYear();

    // Map normalized Members column name -> value. Columns not listed are left blank.
    const memberFields: { [key: string]: any } = {
      first_name: application.firstName,
      last_name: application.lastName,
      known_as: application.knownAs,
      email_address: application.emailAddress,
      landline: application.landline,
      mobile: application.mobile,
      address_1: application.address1,
      address_2: application.address2,
      address_3: application.address3,
      post_code: application.postCode,
      age_demographic: application.ageDemographic,
      birthdate: application.dob,
      member_type: memberTypeFullName,
      year_started: currentYear,
      user_name: userName,
      password_hash: passwordHash,
      is_temp_password: 'Y',
      role: 'Member',
      include: 'Y',
      social_emails: 'Y',
      handbook_entry: 'Y',
      created_at: nowIso,
      updated_at: nowIso,
    };

    // Determine how wide the row needs to be (highest mapped column index)
    let maxIndex = 0;
    for (const index of Object.values(membersColMap)) {
      if (index > maxIndex) {
        maxIndex = index;
      }
    }

    // Start with a fully blank row using null (not '') for every column we do not
    // explicitly populate. null leaves the cell genuinely empty, so any computed
    // columns in the Members sheet (full_name, full_known_as, the calculated age,
    // Gmail Labels, etc.) are left for their ARRAYFORMULA to fill. Writing '' would
    // put empty-string content in those cells and break the array formula (#REF!).
    const memberRow: any[] = [];
    for (let i = 0; i <= maxIndex; i++) {
      memberRow[i] = null;
    }
    for (const [columnName, value] of Object.entries(memberFields)) {
      const colIndex = membersColMap[columnName];
      if (colIndex !== undefined) {
        memberRow[colIndex] = value;
      }
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'Members!A:ZZ',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [memberRow],
      },
    });

    // Step 5 — mark the application as converted
    await updateApplicationFields(application.rowNumber, {
      status: 'Converted',
      convertedAt: nowIso,
      convertedUsername: userName,
    });

    return { success: true, userName, tempPassword };
  } catch (error) {
    console.error(`[convertApplicationToMember] Failed for row ${application.rowNumber}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to convert application',
    };
  }
}
