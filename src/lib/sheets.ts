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

export function getCompetitionsSpreadsheetId(): string {
  const id = process.env.COMPETITIONS_SPREADSHEET_ID;
  if (!id) {
    throw new Error('COMPETITIONS_SPREADSHEET_ID environment variable is not set. Check your .env.local file.');
  }
  return id;
}

export function getRowlandSpreadsheetId(): string {
  const id = process.env.ROWLAND_SPREADSHEET_ID;
  if (!id) {
    throw new Error('ROWLAND_SPREADSHEET_ID environment variable is not set. Check your .env.local file.');
  }
  return id;
}

export function getLeaguesSpreadsheetId(): string {
  const id = process.env.LEAGUES_SPREADSHEET_ID;
  if (!id) {
    throw new Error('LEAGUES_SPREADSHEET_ID environment variable is not set. Check your .env.local file.');
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
// RETRY HELPER
// ============================================================================

/**
 * Retry wrapper for Google Sheets API calls that may hit quota limits.
 * Retries up to maxAttempts times with exponential backoff on 429 / quota errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
  baseDelayMs = 1000,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.response?.status ?? err?.status ?? err?.code;
      const msg = String(err?.message ?? '');
      const isQuotaError =
        status === 429 ||
        (status === 403 && msg.includes('Quota')) ||
        msg.includes('Quota exceeded') ||
        msg.includes('RESOURCE_EXHAUSTED');

      if (!isQuotaError || attempt === maxAttempts) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 1 s, 2 s, 4 s …
      console.warn(`[sheets] Quota hit, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})…`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  /* istanbul ignore next */
  throw new Error('withRetry: unreachable');
}

// ============================================================================
// READ-CACHE INVALIDATION REGISTRY
// ============================================================================
// Hot sheets (Members above all) are read on nearly every request but change
// rarely, so they are cached in memory to cut Google Sheets read-quota usage.
// Any write that targets a cached sheet must drop that cache. Every writer goes
// through the shared client wrapped by applyRetryToValues, so we invalidate
// centrally there — individual writers never have to remember to bust the cache.

const cacheInvalidators: Map<string, Array<() => void>> = new Map();

/** Register a callback to run whenever a values write targets `sheetName`. */
export function registerSheetCacheInvalidator(sheetName: string, fn: () => void): void {
  const list = cacheInvalidators.get(sheetName);
  if (list) {
    list.push(fn);
  } else {
    cacheInvalidators.set(sheetName, [fn]);
  }
}

function fireCacheInvalidators(sheetName: string): void {
  const list = cacheInvalidators.get(sheetName);
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    list[i]();
  }
}

/** Extract the sheet name(s) a values write targets, from its request args. */
function writtenSheetNames(method: string, args: any[]): string[] {
  const arg = args && args.length > 0 ? args[0] : null;
  if (!arg) return [];
  const names: string[] = [];
  const addFromRange = (range: any) => {
    if (typeof range !== 'string' || range.length === 0) return;
    // Ranges look like "Sheet!A1:B2", "'Sheet Name'!A1", or a bare "Sheet"
    let name = range;
    const bang = range.indexOf('!');
    if (bang !== -1) name = range.slice(0, bang);
    if (name.length >= 2 && name.charAt(0) === "'" && name.charAt(name.length - 1) === "'") {
      name = name.slice(1, name.length - 1);
    }
    names.push(name);
  };
  if (method === 'batchUpdate') {
    const body = arg.requestBody;
    const data = body && body.data ? body.data : null;
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) addFromRange(data[i].range);
    }
  } else {
    addFromRange(arg.range);
  }
  return names;
}

// ============================================================================
// GOOGLE SHEETS CLIENT
// ============================================================================

/**
 * Apply exponential-backoff retry to all spreadsheets.values.* methods on the
 * given sheets client.  Called once per client instance so every existing call
 * site in the codebase gets quota-error retry for free.
 */
function applyRetryToValues(sheets: ReturnType<typeof google.sheets>): void {
  const values = sheets.spreadsheets.values as any;
  const writeMethods = new Set(['update', 'batchUpdate', 'append', 'clear']);
  for (const method of ['get', 'batchGet', 'update', 'batchUpdate', 'append', 'clear']) {
    if (typeof values[method] !== 'function') continue;
    const original = values[method].bind(values);
    if (writeMethods.has(method)) {
      // Writes: retry, then drop the cache for any sheet they touched.
      values[method] = async (...args: any[]) => {
        const result = await withRetry(() => original(...args));
        const names = writtenSheetNames(method, args);
        for (let i = 0; i < names.length; i++) fireCacheInvalidators(names[i]);
        return result;
      };
    } else {
      values[method] = (...args: any[]) => withRetry(() => original(...args));
    }
  }
}

let _sheetsClient: ReturnType<typeof google.sheets> | null = null;

export function getGoogleSheetsClient() {
  if (_sheetsClient) return _sheetsClient;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: getServiceAccountEmail(),
      private_key: getPrivateKey(),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  applyRetryToValues(sheets);
  _sheetsClient = sheets;
  return sheets;
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
  gmc: string | null; // "GMC" or blank - General Management Committee member
  profileUpdatedDate: string | null;
  handicap: number | null; // Integer 0-10, null if not set (Playing members only)

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
export async function getColumnMap(sheetName: string = 'Members', spreadsheetId?: string): Promise<{ [key: string]: number }> {
  const sid = spreadsheetId ?? getSpreadsheetId();
  const cacheKey = `${sid}:${sheetName}`;
  // Check if we have already cached the column map for this sheet
  // This avoids unnecessary API calls on repeated access
  if (columnMapCache.has(cacheKey)) {
    // Get the cached map (we know it exists from the check above)
    const cachedMap = columnMapCache.get(cacheKey);
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
      spreadsheetId: sid,
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
    columnMapCache.set(cacheKey, map);

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
// ── Members (users) read cache ───────────────────────────────────────────────
// The Members sheet is read on almost every request (getUserByUsername,
// getUsersByEmail, auth, and 30+ call sites) but changes rarely, so cache the
// parsed User[] for a long TTL. Any write to the Members sheet auto-invalidates
// it via the registry above (clearUsersCache), so edits/password changes/new
// members are reflected immediately. This is the single biggest read saving.
const USERS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
let _usersCache: { users: User[]; at: number } | null = null;

// ── Cache diagnostics (surfaced at /admin/cache) ─────────────────────────────
// Tracks how many reads each cached copy serves before it is invalidated, so an
// admin can see the cache working. NOTE: this is per serverless instance — each
// warm instance keeps its own cache + counters, so the numbers reflect only the
// instance that happened to serve the diagnostics request.
interface CacheInvalidationRecord {
  invalidatedAt: number; // epoch ms the copy was dropped
  hitsServed: number;    // cache hits served during the window that just closed
  windowMs: number;      // how long that copy lived before being dropped
}
const _usersCacheStats = {
  windowHits: 0,          // hits served since the current copy loaded
  windowLoadedAt: null as number | null,
  totalHits: 0,           // lifetime cache hits (reads avoided)
  totalLoads: 0,          // lifetime fetches from the Sheets API
  totalInvalidations: 0,  // lifetime invalidations that dropped a live copy
  startedAt: Date.now(),  // when this instance began tracking
  recent: [] as CacheInvalidationRecord[], // most-recent-first, capped
};
const USERS_CACHE_STATS_MAX = 50;

/** Snapshot of the Members cache state for the admin diagnostics view. */
export function getUsersCacheStats() {
  const now = Date.now();
  const loadedAt = _usersCacheStats.windowLoadedAt;
  return {
    cached: _usersCache !== null,
    memberCount: _usersCache ? _usersCache.users.length : 0,
    loadedAt,
    ageMs: loadedAt !== null ? now - loadedAt : null,
    ttlMs: USERS_CACHE_TTL_MS,
    currentWindowHits: _usersCacheStats.windowHits,
    totalHits: _usersCacheStats.totalHits,
    totalLoads: _usersCacheStats.totalLoads,
    totalInvalidations: _usersCacheStats.totalInvalidations,
    startedAt: _usersCacheStats.startedAt,
    recentInvalidations: _usersCacheStats.recent.slice(),
  };
}

/** Drop the cached Members data (auto-called on any Members write). */
export function clearUsersCache(): void {
  // Record the window that just closed — but only when a live copy is being
  // dropped (a write while the cache is already empty is not an interesting event).
  if (_usersCache !== null && _usersCacheStats.windowLoadedAt !== null) {
    const now = Date.now();
    _usersCacheStats.recent.unshift({
      invalidatedAt: now,
      hitsServed: _usersCacheStats.windowHits,
      windowMs: now - _usersCacheStats.windowLoadedAt,
    });
    if (_usersCacheStats.recent.length > USERS_CACHE_STATS_MAX) {
      _usersCacheStats.recent.length = USERS_CACHE_STATS_MAX;
    }
    _usersCacheStats.totalInvalidations += 1;
    console.log(`[users-cache] invalidated after serving ${_usersCacheStats.windowHits} reads over ${Math.round((now - _usersCacheStats.windowLoadedAt) / 1000)}s`);
  }
  _usersCache = null;
  _usersCacheStats.windowHits = 0;
  _usersCacheStats.windowLoadedAt = null;
}
registerSheetCacheInvalidator('Members', clearUsersCache);

export async function getAllUsers(forceFresh = false): Promise<User[]> {
  // Serve from cache when fresh. Return a shallow copy so a caller that sorts the
  // array in place can't reorder the cached copy.
  //
  // CROSS-INSTANCE NOTE: this cache is per serverless instance. A write invalidates
  // only the instance that made it; other warm instances keep their copy until TTL.
  // Fine for display data (eventually consistent), but WRONG for authentication —
  // a password change on one instance must not let a stale login succeed elsewhere.
  // So auth-critical reads (login, reset-token, change-password verify) pass
  // forceFresh=true to bypass the cache and read the sheet directly.
  if (!forceFresh && _usersCache && (Date.now() - _usersCache.at) < USERS_CACHE_TTL_MS) {
    _usersCacheStats.windowHits += 1;
    _usersCacheStats.totalHits += 1;
    return _usersCache.users.slice();
  }
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

      // Skip genuinely empty rows. Open-ended sheet formulas (e.g. an
      // ARRAYFORMULA filling a column down to row 1000) can cause the API to
      // return many trailing blank rows; without this guard each would become a
      // phantom member. Every real member has a name, so a row with neither a
      // first nor a last name is not a real record.
      if (!user.firstName && !user.lastName) {
        continue;
      }

      // Add to users array
      users.push(user);
    }

    // Cache for subsequent reads; invalidated automatically on any Members write
    const loadedAt = Date.now();
    _usersCache = { users, at: loadedAt };
    _usersCacheStats.windowLoadedAt = loadedAt;
    _usersCacheStats.windowHits = 0;
    _usersCacheStats.totalLoads += 1;
    console.log(`[users-cache] loaded ${users.length} members from the sheet`);

    return users.slice();
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
export async function getUserByUsername(userName: string, forceFresh = false): Promise<User | null> {
  const users = await getAllUsers(forceFresh);
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
export async function getUsersByEmail(email: string, forceFresh = false): Promise<User[]> {
  const users = await getAllUsers(forceFresh);
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
 * Update a single member's handicap value in the Members sheet.
 * Prefer batchUpdateMemberHandicaps when updating multiple members at once.
 */
export async function updateMemberHandicap(
  userName: string,
  handicap: number | null
): Promise<void> {
  await batchUpdateMemberHandicaps([{ userName, handicap }]);
}

/**
 * Update handicaps for multiple members in a single Sheets batchUpdate call.
 * Avoids hitting the per-minute write quota when saving many rows at once.
 */
export async function batchUpdateMemberHandicaps(
  updates: { userName: string; handicap: number | null }[]
): Promise<void> {
  if (updates.length === 0) return;

  const [users, colMap] = await Promise.all([
    getAllUsers(),
    getColumnMap('Members'),
  ]);

  const colIndex = colMap['handicap'];
  if (colIndex === undefined) {
    throw new Error('Handicap column not found in Members sheet — add a "Handicap" column header');
  }
  const colLetter = getColumnLetter(colIndex);

  const userMap = new Map(users.map((u) => [u.userName.toLowerCase(), u]));

  const data: { range: string; values: string[][] }[] = [];
  for (const { userName, handicap } of updates) {
    const user = userMap.get(userName.toLowerCase());
    if (!user || !user._rowNumber) continue;
    data.push({
      range: `Members!${colLetter}${user._rowNumber}`,
      values: [[handicap === null ? '' : String(handicap)]],
    });
  }

  if (data.length === 0) return;

  const sheets = getGoogleSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data,
    },
  });
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
    // Full display name computed in code (known-as/first name + last name) rather
    // than read from the sheet's Full Name column. This means the value is correct
    // even for rows the app appends (e.g. a converted member), where the sheet
    // formula has not yet filled the Full Name cell.
    fullName: ((get('known_as') || get('first_name') || '') + ' ' + (get('last_name') || '')).trim(),
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
    gmc: get('gmc'),
    profileUpdatedDate: get('profile_updated_date'),
    handicap: (() => {
      const val = get('handicap');
      if (!val) return null;
      const parsed = parseInt(val, 10);
      return isNaN(parsed) ? null : parsed;
    })(),

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
    // Read fresh: the token was just written and may not be in another instance's cache
    const users = await getAllUsers(true);
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
