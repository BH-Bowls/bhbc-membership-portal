// src/lib/sheets.ts
// Google Sheets client for database operations
// Uses flexible column mapping by header names (not hardcoded positions)

import { google } from 'googleapis';

// ============================================================================
// ENVIRONMENT VARIABLE GETTERS (Lazy Loading)
// ============================================================================

function getSpreadsheetId(): string {
  const id = process.env.SPREADSHEET_ID;
  if (!id) {
    throw new Error('SPREADSHEET_ID environment variable is not set. Check your .env.local file.');
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

function getGoogleSheetsClient() {
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
  fullKnownAs: string | null;
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
  memberType: string;
  yearStarted: number | null;
  renewStatus: string | null;
  friendlies2023: number;
  friendlies2024: number;
  friendliesLastYear: number;
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
 * Get column mapping from header row
 * Caches result to avoid repeated API calls
 */
export async function getColumnMap(sheetName: string = 'Users'): Promise<{ [key: string]: number }> {
  // Check if we have this sheet cached
  if (columnMapCache.has(sheetName)) {
    return columnMapCache.get(sheetName)!;
  }

  try {
    const sheets = getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: `${sheetName}!1:1`, // Header row
    });

    const headers = response.data.values?.[0] || [];
    const map: { [key: string]: number } = {};

    headers.forEach((header, index) => {
      // Normalize header: lowercase, replace spaces with underscores
      const normalized = String(header).toLowerCase().trim().replace(/\s+/g, '_');
      map[normalized] = index;
    });

    // Cache this sheet's column map
    columnMapCache.set(sheetName, map);
    return map;
  } catch (error) {
    console.error('Error getting column map:', error);
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
 * Get all users from Users sheet
 */
export async function getAllUsers(): Promise<User[]> {
  try {
    const colMap = await getColumnMap('Users');
    const sheets = getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Users!A2:BZ', // Start from row 2 (skip header), extended to include reset token columns
    });

    const rows = response.data.values || [];
    return rows.map((row, index) => parseUserRow(row, index + 2, colMap));
  } catch (error) {
    console.error('Error getting users:', error);
    throw new Error('Failed to fetch users from Google Sheets');
  }
}

/**
 * Get user by username (exact match, case-insensitive)
 * Supports alternative format with periods (e.g., john.smith -> john_smith)
 */
export async function getUserByUsername(userName: string): Promise<User | null> {
  const users = await getAllUsers();
  const normalized = userName.toLowerCase();
  const normalizedWithUnderscore = normalized.replace(/\./g, '_');

  return users.find(u =>
    u.userName.toLowerCase() === normalized ||
    u.userName.toLowerCase() === normalizedWithUnderscore
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

    const colMap = await getColumnMap('Users');
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
      range: `Users!${colLetter}${user._rowNumber}`,
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

    const colMap = await getColumnMap('Users');
    const sheets = getGoogleSheetsClient();
    
    const passwordCol = getColumnLetter(colMap['password_hash']);
    const tempCol = getColumnLetter(colMap['is_temp_password']);
    const resetCol = getColumnLetter(colMap['last_password_reset_date']);

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      requestBody: {
        data: [
          {
            range: `Users!${passwordCol}${user._rowNumber}`,
            values: [[newPasswordHash]]
          },
          {
            range: `Users!${tempCol}${user._rowNumber}`,
            values: [[isTempPassword ? 'Y' : 'N']]
          },
          {
            range: `Users!${resetCol}${user._rowNumber}`,
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
 * Parse a row from Users sheet into User object
 * Uses column map for flexible positioning
 */
function parseUserRow(row: any[], rowNumber: number, colMap: { [key: string]: number }): User {
  const get = (field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || null) : null;
  };
  
  const getBool = (field: string): boolean => {
    const val = get(field);
    return val === 'Y' || val === 'Yes' || val === 'yes' || val === 'TRUE' || val === 'true';
  };
  
  const getInt = (field: string): number => {
    const val = get(field);
    return val ? parseInt(val) : 0;
  };

  return {
    // Profile Data
    title: get('title'),
    firstName: get('first_name') || '',
    lastName: get('last_name') || '',
    knownAs: get('known_as'),
    fullKnownAs: get('full_known_as'),
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
    yearStarted: getInt('year_started') || null,
    renewStatus: get('renew_status'),
    friendlies2023: getInt('friendlies_2023'),
    friendlies2024: getInt('friendlies_2024'),
    friendliesLastYear: getInt('friendlies_last_year'),
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
      range: 'LoginAttempts!A:H',
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
          now
        ]]
      }
    });
  } catch (error) {
    console.error('Error logging login attempt:', error);
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
    const normalizedWithUnderscore = normalized.replace(/\./g, '_');

    const user = users.find(
      (u) =>
        u.userName.toLowerCase() === normalized ||
        u.userName.toLowerCase() === normalizedWithUnderscore ||
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

    // Set expiry to 1 hour from now
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const colMap = await getColumnMap('Users');
    const sheets = getGoogleSheetsClient();

    const tokenCol = getColumnLetter(colMap['reset_token']);
    const expiresCol = getColumnLetter(colMap['reset_token_expires']);

    // Store token and expiry
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      requestBody: {
        data: [
          {
            range: `Users!${tokenCol}${user._rowNumber}`,
            values: [[token]],
          },
          {
            range: `Users!${expiresCol}${user._rowNumber}`,
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

    const colMap = await getColumnMap('Users');
    const sheets = getGoogleSheetsClient();

    const tokenCol = getColumnLetter(colMap['reset_token']);
    const expiresCol = getColumnLetter(colMap['reset_token_expires']);

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      requestBody: {
        data: [
          {
            range: `Users!${tokenCol}${user._rowNumber}`,
            values: [['']],
          },
          {
            range: `Users!${expiresCol}${user._rowNumber}`,
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
    const colMap = await getColumnMap('Users');
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
