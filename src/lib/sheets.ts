// src/lib/sheets.ts
// Google Sheets client for database operations
// Uses flexible column mapping by header names (not hardcoded positions)

import { google } from 'googleapis';

// ============================================================================
// ENVIRONMENT VARIABLE GETTERS (Lazy Loading)
// ============================================================================

export function getSpreadsheetId(): string {
  const id = process.env.MEMBERS_SPREADSHEET_ID;
  if (!id) {
    throw new Error('MEMBERS_SPREADSHEET_ID environment variable is not set. Check your .env.local file.');
  }
  return id;
}

function getServiceAccountEmail(): string {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL environment variable is not set. Check your .env.local file.');
  }
  return email;
}

function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!key) {
    throw new Error('GOOGLE_PRIVATE_KEY environment variable is not set. Check your .env.local file.');
  }
  return key.replace(/\\n/g, '\n');
}

// ============================================================================
// GOOGLE SHEETS CLIENT
// ============================================================================

export function getGoogleSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: getServiceAccountEmail(),
      private_key: getPrivateKey(),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface User {
  // Profile Data
  title: string | null;
  firstName: string;
  lastName: string;
  knownAs: string | null;
  fullKnownAs: string; // Preferred first name for emails (Known As OR First Name)
  fullName: string; // Full display name from sheet (e.g., "Celia Dasey")
  emailAddress: string | null;
  landline: string | null;
  mobile: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  postCode: string | null;
  lockerNo: string | null;
  birthdate: string | null;
  ageDemographic: string;
  memberType: string; // PL=Playing Lady, SL=Social Lady, PM=Playing Man, SM=Social Man
  honorary: string | null; // "Y" or "N" or null - indicates if member is Honorary
  yearStarted: number | null;
  renewStatus: string | null;
  friendlies2023: number;
  friendlies2024: number;
  friendliesLastYear: number | string; // Can be number or "X" for manual override
  comments: string | null;
  socialEmails: boolean;
  handbookEntry: boolean;
  drivingAwayMatches: string | null;
  drivingAdditionalInfo: string | null;
  greenMaintenance: string | null;
  greenAdditionalInfo: string | null;
  barDuty: string | null;
  barAdditionalInfo: string | null;
  otherSkills: string | null;
  profileUpdatedDate: string | null;

  // Renewal Email Fields
  include: string | null; // "Y" or "N" - controls whether member receives renewal emails
  renewalEmailSentStatus: string | null; // Email send status: "Success. Email sent DD/MM/YYYY" or "Error: [message]"

  // Auth Data
  buddyUserName: string | null;
  userName: string;
  passwordHash: string;
  isTempPassword: boolean;
  role: string;
  lastLoginDate: string | null;
  lastLoginFailedDate: string | null;
  lastPasswordResetDate: string | null;
  resetToken: string | null;
  resetTokenExpires: string | null;
  createdAt: string;
  updatedAt: string;

  _rowNumber?: number;
}

// ============================================================================
// FLEXIBLE COLUMN MAPPING
// ============================================================================

let columnMapCache: Map<string, { [key: string]: number }> = new Map();

/**
 * Get mapping of column names to indices for a Google Sheet
 *
 * This is a critical function used by all sheet operations.
 * Instead of hardcoding column positions (error-prone), we read the header row
 * and create a flexible mapping: column_name → column_index
 *
 * Example: If header row is ["User Name", "Email Address", "Phone"],
 * returns: { "user_name": 0, "email_address": 1, "phone": 2 }
 *
 * Caching: Results are cached in memory to avoid repeated API calls
 * Call clearColumnMapCache() after schema changes
 *
 * @param sheetName Name of the sheet tab (default: 'Members')
 * @returns Object mapping normalized column names to zero-based indices
 */
export async function getColumnMap(sheetName: string = 'Members'): Promise<{ [key: string]: number }> {
  // Check if we have already cached the column map for this sheet
  // This avoids unnecessary API calls on repeated access
  if (columnMapCache.has(sheetName)) {
    // Get the cached map (we know it exists from the check above)
    const cachedMap = columnMapCache.get(sheetName);
    if (cachedMap) {
      return cachedMap;
    }
  }

  try {
    // Get authenticated Google Sheets client
    const sheets = getGoogleSheetsClient();

    // Fetch only the header row (row 1) from the sheet
    // This is much faster than fetching all data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: `${sheetName}!1:1`, // Row 1 contains column headers
    });

    // Extract header row from response
    // If sheet is empty or has no data, use empty array
    const values = response.data.values;
    let headers: any[] = [];
    if (values && values[0]) {
      headers = values[0];
    }

    // Build mapping object: column_name → column_index
    const map: { [key: string]: number } = {};

    // Loop through each header cell
    for (let index = 0; index < headers.length; index++) {
      const header = headers[index];

      // Normalize header to consistent format:
      // - Convert to lowercase for case-insensitive matching
      // - Trim whitespace
      // - Replace spaces with underscores
      // Example: "User Name" becomes "user_name"
      const normalized = String(header).toLowerCase().trim().replace(/\s+/g, '_');

      // Store the mapping: normalized_name → column_index
      map[normalized] = index;
    }

    // Cache this sheet's column map for future use
    // Avoids making the same API call repeatedly
    columnMapCache.set(sheetName, map);

    return map;
  } catch (error) {
    // Log error for debugging
    console.error('Error getting column map:', error);

    // Throw user-friendly error message
    throw new Error('Failed to read sheet headers');
  }
}

/**
 * Clear column map cache (call after schema changes)
 */
export function clearColumnMapCache() {
  columnMapCache.clear();
}

/**
 * Get column letter from index (A, B, C, ... Z, AA, AB, ...)
 */
export function getColumnLetter(index: number): string {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

// ============================================================================
// USERS SHEET OPERATIONS
// ============================================================================

/**
 * Get all users from the Members Google Sheet
 *
 * This is the primary data retrieval function used throughout the system.
 * Fetches all member records and parses them into User objects.
 *
 * Process:
 * 1. Get column mapping for flexible field positions
 * 2. Fetch all data rows from sheet (skip header row)
 * 3. Parse each row into a User object
 *
 * @returns Array of all users in the system
 * @throws Error if unable to fetch data from Google Sheets
 */
export async function getAllUsers(): Promise<User[]> {
  try {
    // Get the column mapping for the Members sheet
    // This tells us which column index corresponds to each field
    const colMap = await getColumnMap('Members');

    // Get authenticated Google Sheets client
    const sheets = getGoogleSheetsClient();

    // Fetch all user data from the Members sheet
    // Range A2:BZ means:
    // - Start at row 2 (skip header row 1)
    // - Include columns A through BZ (covers all user fields including new ones)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Members!A2:BZ',
      valueRenderOption: 'FORMATTED_VALUE', // Get values as displayed in sheet (formulas evaluated)
    });

    // Extract rows from response
    // If sheet has no data, use empty array
    const values = response.data.values;
    let rows: any[] = [];
    if (values) {
      rows = values;
    }

    // Parse each row into a User object
    const users: User[] = [];

    // Loop through each data row
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];

      // Calculate actual row number in sheet
      // index 0 corresponds to sheet row 2 (since row 1 is header)
      const rowNumber = index + 2;

      // Parse this row into a User object
      const user = parseUserRow(row, rowNumber, colMap);

      // Add to users array
      users.push(user);
    }

    return users;
  } catch (error) {
    // Log error for debugging
    console.error('Error getting users:', error);

    // Throw user-friendly error message
    throw new Error('Failed to fetch users from Google Sheets');
  }
}

/**
 * Get user by username (exact match, case-insensitive)
 * Supports alternative format with underscores (e.g., john_smith -> john.smith)
 */
export async function getUserByUsername(userName: string): Promise<User | null> {
  const users = await getAllUsers();
  const normalized = userName.toLowerCase();
  const normalizedWithDot = normalized.replace(/_/g, '.');

  return users.find(u =>
    u.userName.toLowerCase() === normalized ||
    u.userName.toLowerCase() === normalizedWithDot
  ) || null;
}

/**
 * Get users by email address
 */
export async function getUsersByEmail(email: string): Promise<User[]> {
  const users = await getAllUsers();
  const normalized = email.toLowerCase();
  
  return users.filter(u => 
    u.emailAddress && u.emailAddress.toLowerCase() === normalized
  );
}

/**
 * Update user's last login date
 */
export async function updateLastLogin(userName: string, success: boolean): Promise<void> {
  try {
    const user = await getUserByUsername(userName);
    if (!user || !user._rowNumber) return;

    const colMap = await getColumnMap('Members');
    const colName = success ? 'last_login_date' : 'last_login_failed_date';
    const colIndex = colMap[colName];

    if (colIndex === undefined) {
      console.error(`Column ${colName} not found in sheet`);
      return;
    }

    const colLetter = getColumnLetter(colIndex);
    const sheets = getGoogleSheetsClient();
    const now = new Date().toISOString();

    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `Members!${colLetter}${user._rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[now]]
      }
    });
  } catch (error) {
    console.error('Error updating last login:', error);
  }
}

/**
 * Update email sent status in Members sheet
 * Records success with date or error message
 * @param userName Username of the member
 * @param success Whether email was sent successfully
 * @param errorMessage Error message if failed
 * @param columnName Column to update (defaults to 'member_email_sent_status')
 */
export async function updateEmailSentStatus(
  userName: string,
  success: boolean,
  errorMessage?: string,
  columnName: string = 'member_email_sent_status'
): Promise<void> {
  try {
    const user = await getUserByUsername(userName);
    if (!user || !user._rowNumber) return;

    const colMap = await getColumnMap('Members');
    const colIndex = colMap[columnName];

    if (colIndex === undefined) {
      console.error(`Column ${columnName} not found in sheet`);
      return;
    }

    const colLetter = getColumnLetter(colIndex);
    const sheets = getGoogleSheetsClient();

    // Format: "Success. Email sent DD/MM/YYYY" or "Error: [message]"
    const now = new Date();
    const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
    const statusValue = success
      ? `Success. Email sent ${dateStr}`
      : `Error: ${errorMessage || 'Unknown error'}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `Members!${colLetter}${user._rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[statusValue]]
      }
    });
  } catch (error) {
    console.error('Error updating email sent status:', error);
  }
}

/**
 * Update user password hash
 */
export async function updatePasswordHash(
  userName: string,
  newPasswordHash: string,
  isTempPassword: boolean = false
): Promise<void> {
  try {
    const user = await getUserByUsername(userName);
    if (!user || !user._rowNumber) {
      throw new Error('User not found');
    }

    const colMap = await getColumnMap('Members');
    const sheets = getGoogleSheetsClient();
    
    const passwordCol = getColumnLetter(colMap['password_hash']);
    const tempCol = getColumnLetter(colMap['is_temp_password']);
    const resetCol = getColumnLetter(colMap['last_password_reset_date']);

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      requestBody: {
        data: [
          {
            range: `Members!${passwordCol}${user._rowNumber}`,
            values: [[newPasswordHash]]
          },
          {
            range: `Members!${tempCol}${user._rowNumber}`,
            values: [[isTempPassword ? 'Y' : 'N']]
          },
          {
            range: `Members!${resetCol}${user._rowNumber}`,
            values: [[new Date().toISOString()]]
          }
        ],
        valueInputOption: 'USER_ENTERED'
      }
    });
  } catch (error) {
    console.error('Error updating password:', error);
    throw new Error('Failed to update password');
  }
}

/**
 * Parse a Google Sheets row into a User object
 *
 * This function extracts all user fields from a sheet row using the column map.
 * It handles various data types and formats:
 * - Strings: Returned as-is or null if missing
 * - Booleans: Converted from Y/N, Yes/No, TRUE/FALSE
 * - Numbers: Parsed from strings, handling currency symbols
 *
 * @param row The raw row data from Google Sheets (array of cell values)
 * @param rowNumber The row number in the sheet (for updates/tracking)
 * @param colMap Column name to index mapping from getColumnMap()
 * @returns Fully parsed User object with all fields populated
 */
function parseUserRow(row: any[], rowNumber: number, colMap: { [key: string]: number }): User {
  // Helper function: Get string value from a column
  // Returns null if column doesn't exist or cell is empty
  const get = (field: string): string | null => {
    // Look up the column index for this field name
    const index = colMap[field];

    // Check if field exists in the column map
    if (index === undefined) {
      return null;
    }

    // Get the cell value at this index
    const cellValue = row[index];

    // Return null if cell is empty or undefined
    if (!cellValue) {
      return null;
    }

    return cellValue;
  };

  // Helper function: Get boolean value from a column
  // Google Sheets stores booleans as text (Y/N, Yes/No, TRUE/FALSE)
  const getBool = (field: string): boolean => {
    const val = get(field);

    // Check if value matches any form of "yes" or "true"
    if (val === 'Y' || val === 'Yes' || val === 'yes' || val === 'TRUE' || val === 'true') {
      return true;
    }

    return false;
  };

  // Helper function: Get integer value from a column
  // Handles currency symbols (£, $), commas, and whitespace
  const getInt = (field: string): number => {
    const val = get(field);

    // Return 0 if cell is empty
    if (!val) {
      return 0;
    }

    // Strip currency symbols (£, $), commas, and whitespace before parsing
    // Example: "£1,234" becomes "1234"
    const cleaned = val.replace(/[£$,\s]/g, '');

    // Parse the cleaned string to an integer
    const parsed = parseInt(cleaned);

    // Return 0 if parsing failed (NaN)
    if (isNaN(parsed)) {
      return 0;
    }

    return parsed;
  };

  return {
    // Profile Data
    title: get('title'),
    firstName: get('first_name') || '',
    lastName: get('last_name') || '',
    knownAs: get('known_as'),
    fullKnownAs: get('known_as') || get('first_name') || '', // Preferred first name
    fullName: get('full_name') || '', // Full display name from sheet
    emailAddress: get('email_address'),
    landline: get('landline'),
    mobile: get('mobile'),
    address1: get('address_1'),
    address2: get('address_2'),
    address3: get('address_3'),
    postCode: get('post_code'),
    lockerNo: get('locker_no'),
    birthdate: get('birthdate'),
    ageDemographic: get('age_demographic') || '',
    memberType: get('member_type') || '',
    honorary: get('honorary'),
    yearStarted: getInt('year_started') || null,
    renewStatus: get('renew_status'),
    friendlies2023: getInt('friendlies_2023'),
    friendlies2024: getInt('friendlies_2024'),
    // Handle friendliesLastYear as either number or "X" (manual override)
    friendliesLastYear: (() => {
      const value = get('friendlies_last_year');
      if (value === 'X') return 'X';
      if (!value) return 0;
      return parseInt(value, 10) || 0;
    })(),
    comments: get('comments'),
    socialEmails: getBool('social_emails'),
    handbookEntry: getBool('handbook_entry'),
    drivingAwayMatches: get('driving_away_matches'),
    drivingAdditionalInfo: get('driving_additional_info'),
    greenMaintenance: get('green_maintenance'),
    greenAdditionalInfo: get('green_additional_info'),
    barDuty: get('bar_duty'),
    barAdditionalInfo: get('bar_additional_info'),
    otherSkills: get('other_skills'),
    profileUpdatedDate: get('profile_updated_date'),

    // Renewal Email Fields
    include: get('include'), // "Y" or "N" - controls who receives renewal emails
    renewalEmailSentStatus: get('renewal_email_sent_status'), // Tracks email send status and date

    // Auth Data
    buddyUserName: get('buddy_user_name'),
    userName: get('user_name') || '',
    passwordHash: get('password_hash') || '',
    isTempPassword: getBool('is_temp_password'),
    role: get('role') || 'Member',
    lastLoginDate: get('last_login_date'),
    lastLoginFailedDate: get('last_login_failed_date'),
    lastPasswordResetDate: get('last_password_reset_date'),
    resetToken: get('reset_token'),
    resetTokenExpires: get('reset_token_expires'),
    createdAt: get('created_at') || new Date().toISOString(),
    updatedAt: get('updated_at') || new Date().toISOString(),

    _rowNumber: rowNumber
  };
}

// ============================================================================
// LOGIN ATTEMPTS SHEET OPERATIONS
// ============================================================================

/**
 * Log a login attempt
 */
export async function logLoginAttempt(attempt: {
  identifier: string;
  userName?: string | null;
  success: boolean;
  failureReason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceType?: string | null;
}): Promise<void> {
  try {
    const sheets = getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'LoginAttempts!A:A',
    });

    const nextId = (response.data.values?.length || 1);
    const now = new Date().toISOString();

    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'LoginAttempts!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          nextId,
          attempt.identifier,
          attempt.userName || '',
          attempt.success ? 'Y' : 'N',
          attempt.failureReason || '',
          attempt.ipAddress || '',
          attempt.userAgent || '',
          attempt.deviceType || '',
          now
        ]]
      }
    });
  } catch (error) {
    console.error('Error logging login attempt:', error);
  }
}

/**
 * Log a member email attempt to MemberEmails sheet
 * Tracks email campaign history with full audit trail
 */
export async function logMemberEmail(email: {
  userName: string;
  emailAddress: string | null;
  templateName: string;
  subject: string;
  success: boolean;
  errorMessage?: string | null;
  sentBy: string;
  attachments?: string[];
}): Promise<void> {
  try {
    const sheets = getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'MemberEmails!A:A',
    });

    const nextId = (response.data.values?.length || 1);
    const now = new Date().toISOString();

    // Format attachments as comma-separated list
    const attachmentsList = email.attachments && email.attachments.length > 0
      ? email.attachments.join(', ')
      : '';

    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'MemberEmails!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          nextId,
          email.userName,
          email.emailAddress || '',
          email.templateName,
          email.subject,
          email.success ? 'Y' : 'N',
          email.errorMessage || '',
          email.sentBy,
          attachmentsList,
          now
        ]]
      }
    });
  } catch (error) {
    console.error('Error logging member email:', error);
  }
}

/**
 * Get recent failed login attempts (for rate limiting)
 */
export async function getRecentFailedAttempts(
  identifier: string,
  ipAddress?: string
): Promise<{ byIdentifier: number; byIp: number }> {
  try {
    const sheets = getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'LoginAttempts!A2:H',
    });

    const rows = response.data.values || [];
    const fifteenMinutesAgo = Date.now() - (15 * 60 * 1000);

    let byIdentifier = 0;
    let byIp = 0;

    for (const row of rows) {
      const attemptIdentifier = row[1];
      const success = row[3] === 'Y';
      const attemptIp = row[5];
      const attemptedAt = new Date(row[7]).getTime();

      if (attemptedAt < fifteenMinutesAgo || success) continue;

      if (attemptIdentifier.toLowerCase() === identifier.toLowerCase()) {
        byIdentifier++;
      }

      if (ipAddress && attemptIp === ipAddress) {
        byIp++;
      }
    }

    return { byIdentifier, byIp };
  } catch (error) {
    console.error('Error getting recent attempts:', error);
    return { byIdentifier: 0, byIp: 0 };
  }
}

/**
 * Log an impersonation event to the ImpersonationLog sheet
 * Records all start/stop impersonation actions for security auditing
 */
export async function logImpersonationEvent(event: {
  sessionId: string;
  action: 'START' | 'STOP';
  adminUserName: string;
  adminName: string;
  adminRole: string;
  targetUserName?: string | null;
  targetName?: string | null;
  targetRole?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    const sheets = getGoogleSheetsClient();

    // Get next ID by counting rows
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'ImpersonationLog!A:A',
    });

    const nextId = (response.data.values?.length || 1);
    const now = new Date().toISOString();

    // Append new row
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'ImpersonationLog!A:L',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          nextId,
          event.sessionId,
          event.action,
          event.adminUserName,
          event.adminName,
          event.adminRole,
          event.targetUserName || '',
          event.targetName || '',
          event.targetRole || '',
          event.ipAddress || '',
          event.userAgent || '',
          now
        ]]
      }
    });
  } catch (error) {
    console.error('Error logging impersonation event:', error);
    // Don't throw - logging failure shouldn't break impersonation
  }
}

// ============================================================================
// PASSWORD RESET FUNCTIONS
// ============================================================================

/**
 * Generate and store a password reset token for a user
 * Returns the token if successful, null if user not found
 */
export async function generatePasswordResetToken(
  identifier: string
): Promise<string | null> {
  try {
    // Find user by username or email
    const users = await getAllUsers();
    const normalized = identifier.toLowerCase();
    const normalizedWithDot = normalized.replace(/_/g, '.');

    const user = users.find(
      (u) =>
        u.userName.toLowerCase() === normalized ||
        u.userName.toLowerCase() === normalizedWithDot ||
        (u.emailAddress && u.emailAddress.toLowerCase() === normalized)
    );

    if (!user || !user._rowNumber) {
      // Log request even if user not found (for rate limiting)
      await logPasswordResetRequest(identifier, null);
      return null;
    }

    // Log the request for rate limiting
    await logPasswordResetRequest(identifier, user.userName);

    // Generate secure random token (32 bytes = 64 hex characters)
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');

    // Set expiry to 24 hours from now (extended due to Gmail delivery delays)
    // Gmail may delay automated emails by 4-5 hours
    // 24 hours allows for overnight requests and delayed delivery
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const colMap = await getColumnMap('Members');
    const sheets = getGoogleSheetsClient();

    const tokenCol = getColumnLetter(colMap['reset_token']);
    const expiresCol = getColumnLetter(colMap['reset_token_expires']);

    // Store token and expiry
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      requestBody: {
        data: [
          {
            range: `Members!${tokenCol}${user._rowNumber}`,
            values: [[token]],
          },
          {
            range: `Members!${expiresCol}${user._rowNumber}`,
            values: [[expiresAt]],
          },
        ],
        valueInputOption: 'USER_ENTERED',
      },
    });

    return token;
  } catch (error) {
    console.error('Error generating reset token:', error);
    return null;
  }
}

/**
 * Validate a reset token and return the user if valid
 * Returns null if token is invalid, expired, or not found
 */
export async function validateResetToken(token: string): Promise<User | null> {
  try {
    const users = await getAllUsers();
    const user = users.find((u) => u.resetToken === token);

    if (!user) {
      return null;
    }

    // Check if token has expired
    if (!user.resetTokenExpires) {
      return null;
    }

    const expiresAt = new Date(user.resetTokenExpires).getTime();
    const now = Date.now();

    if (now > expiresAt) {
      return null;
    }

    return user;
  } catch (error) {
    console.error('Error validating reset token:', error);
    return null;
  }
}

/**
 * Clear reset token after successful password reset
 */
export async function clearResetToken(userName: string): Promise<void> {
  try {
    const user = await getUserByUsername(userName);
    if (!user || !user._rowNumber) {
      return;
    }

    const colMap = await getColumnMap('Members');
    const sheets = getGoogleSheetsClient();

    const tokenCol = getColumnLetter(colMap['reset_token']);
    const expiresCol = getColumnLetter(colMap['reset_token_expires']);

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      requestBody: {
        data: [
          {
            range: `Members!${tokenCol}${user._rowNumber}`,
            values: [['']],
          },
          {
            range: `Members!${expiresCol}${user._rowNumber}`,
            values: [['']],
          },
        ],
        valueInputOption: 'USER_ENTERED',
      },
    });
  } catch (error) {
    console.error('Error clearing reset token:', error);
  }
}

/**
 * Log a password reset request
 * Used for rate limiting tracking
 */
export async function logPasswordResetRequest(
  identifier: string,
  userName?: string | null
): Promise<void> {
  try {
    const sheets = getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'PasswordResetRequests!A:A',
    });

    const nextId = (response.data.values?.length || 1);
    const now = new Date().toISOString();

    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'PasswordResetRequests!A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[nextId, identifier, userName || '', now]],
      },
    });
  } catch (error) {
    console.error('Error logging password reset request:', error);
  }
}

/**
 * Count recent password reset requests for rate limiting
 * Returns count of requests in the last hour for the given identifier
 */
export async function countRecentResetRequests(
  identifier: string
): Promise<number> {
  try {
    const sheets = getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'PasswordResetRequests!A2:D',
    });

    const rows = response.data.values || [];
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const normalized = identifier.toLowerCase();

    let count = 0;

    for (const row of rows) {
      const requestIdentifier = row[1];
      const requestedAt = new Date(row[3]).getTime();

      if (requestedAt < oneHourAgo) continue;

      if (requestIdentifier.toLowerCase() === normalized) {
        count++;
      }
    }

    return count;
  } catch (error) {
    console.error('Error counting reset requests:', error);
    return 0;
  }
}

// ============================================================================
// UTILITY & TEST FUNCTIONS
// ============================================================================

/**
 * Test connection to Google Sheets
 */
export async function testConnection(): Promise<boolean> {
  try {
    const sheets = getGoogleSheetsClient();
    const response = await sheets.spreadsheets.get({
      spreadsheetId: getSpreadsheetId(),
    });
    
    console.log('✓ Connected to:', response.data.properties?.title);
    return true;
  } catch (error) {
    console.error('✗ Failed to connect:', error);
    return false;
  }
}

/**
 * Enhanced test function for sheets connection
 */
export async function testSheetsConnection() {
  try {
    console.log('Test 1: Connection');
    const connected = await testConnection();
    if (!connected) throw new Error('Connection failed');
    
    console.log('\nTest 2: Column Mapping');
    const colMap = await getColumnMap('Members');
    const keyColumns = ['user_name', 'email_address', 'password_hash', 'role'];
    const missing = keyColumns.filter(col => colMap[col] === undefined);
    if (missing.length > 0) {
      throw new Error(`Missing columns: ${missing.join(', ')}`);
    }
    console.log('✓ All key columns found');
    
    console.log('\nTest 3: Read Users');
    const users = await getAllUsers();
    console.log(`✓ Found ${users.length} users`);
    
    if (users.length > 0) {
      console.log('\nTest 4: Sample User Data');
      const sample = users[0];
      console.log(`✓ Username: ${sample.userName}`);
      console.log(`✓ Name: ${sample.firstName} ${sample.lastName}`);
      console.log(`✓ Role: ${sample.role}`);
      console.log(`✓ Has password: ${sample.passwordHash ? 'Yes' : 'No'}`);
    }
    
    console.log('\n✅ All tests passed! Sheets integration working with flexible columns.');
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}
