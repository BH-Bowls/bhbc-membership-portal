// src/lib/friendlies-sheets.ts
// Google Sheets operations for Friendlies system - handles all data access and manipulation
// for games, players, teams, match cards, and statistics

import { google } from 'googleapis';
import {
  Game,
  PlayerEntry,
  GameSheetPlayer,
  PlayerStats,
  DriverBarInfo,
  TeaRotaEntry,
  ClubDetails,
  ClubContact,
  GameStatus,
  GameType,
  PlayerEntryStatus,
} from './types/friendlies';
import { parseNormalizedDate, normalizeToUKDate } from './date-utils';
import { withRetry } from './sheets';
import { getPetrolBands } from './clubs-sheets';

// ============================================================================
// ENVIRONMENT VARIABLE GETTERS
// ============================================================================

/**
 * Get the Friendlies spreadsheet ID from environment variables
 * This spreadsheet contains the Games sheet, Players sheet, and individual game tabs
 * Throws an error if the environment variable is not configured
 * @returns Spreadsheet ID string (e.g., "1a2b3c4d5e6f...")
 */
export function getFriendliesSpreadsheetId(): string {
  // Read the spreadsheet ID from environment variables
  const id = process.env.FRIENDLIES_SPREADSHEET_ID;

  // Verify that the environment variable is configured
  if (!id) {
    throw new Error('FRIENDLIES_SPREADSHEET_ID environment variable is not set');
  }

  return id;
}

/**
 * Get the Members spreadsheet ID from environment variables
 * This spreadsheet contains the Members sheet with user profiles, contact info, and preferences
 * Used to look up player details like full name, email, phone, driving status, and bar duty
 * Throws an error if the environment variable is not configured
 * @returns Spreadsheet ID string (e.g., "1a2b3c4d5e6f...")
 */
export function getMembersSpreadsheetId(): string {
  // Read the spreadsheet ID from environment variables
  const id = process.env.MEMBERS_SPREADSHEET_ID;

  // Verify that the environment variable is configured
  if (!id) {
    throw new Error('MEMBERS_SPREADSHEET_ID environment variable is not set');
  }

  return id;
}

/**
 * Get the Match Day Contacts spreadsheet ID from environment variables
 * This spreadsheet contains club contact details, addresses, and driving information for away games
 * Used to display opponent club contacts, venue details, and petrol costs on match cards
 * Throws an error if the environment variable is not configured
 * @returns Spreadsheet ID string (e.g., "1a2b3c4d5e6f...")
 */
function getMatchDayContactsSpreadsheetId(): string {
  // Read the spreadsheet ID from environment variables
  const id = process.env.MATCH_DAY_CONTACTS_SPREADSHEET_ID;

  // Verify that the environment variable is configured
  if (!id) {
    throw new Error('MATCH_DAY_CONTACTS_SPREADSHEET_ID environment variable is not set');
  }

  return id;
}

/**
 * Get the Google service account email from environment variables
 * This email is used to authenticate the Google Sheets API client
 * The service account must have edit access to all Friendlies spreadsheets
 * Throws an error if the environment variable is not configured
 * @returns Service account email (e.g., "service-account@project.iam.gserviceaccount.com")
 */
function getServiceAccountEmail(): string {
  // Read the service account email from environment variables
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  // Verify that the environment variable is configured
  if (!email) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL environment variable is not set');
  }

  return email;
}

/**
 * Get the Google service account private key from environment variables
 * This private key is used to authenticate the Google Sheets API client
 * The key is stored with escaped newlines (\n) which need to be converted to actual newlines
 * Throws an error if the environment variable is not configured
 * @returns Private key string with actual newline characters
 */
function getPrivateKey(): string {
  // Read the private key from environment variables
  const key = process.env.GOOGLE_PRIVATE_KEY;

  // Verify that the environment variable is configured
  if (!key) {
    throw new Error('GOOGLE_PRIVATE_KEY environment variable is not set');
  }

  // Replace escaped newlines (\n) with actual newline characters
  // Environment variables store multiline keys with \n as literal characters
  return key.replace(/\\n/g, '\n');
}

// ============================================================================
// GOOGLE SHEETS CLIENT
// ============================================================================

/**
 * Create and return an authenticated Google Sheets API client
 * Uses service account credentials to access spreadsheets
 * The service account must have been granted edit access to all required spreadsheets
 * @returns Google Sheets API v4 client ready to make API calls
 */
let _sheetsClient: ReturnType<typeof google.sheets> | null = null;

export function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;
  // Create Google Auth instance with service account credentials
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: getServiceAccountEmail(),  // Service account email
      private_key: getPrivateKey(),            // Private key with actual newlines
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],  // Request full spreadsheet access
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Wrap all values.* methods with exponential-backoff retry so transient
  // quota errors (HTTP 429) are automatically retried across every call site.
  const values = sheets.spreadsheets.values as any;
  for (const method of ['get', 'batchGet', 'update', 'batchUpdate', 'append', 'clear']) {
    if (typeof values[method] !== 'function') continue;
    const original = values[method].bind(values);
    values[method] = (...args: any[]) => withRetry(() => original(...args));
  }

  _sheetsClient = sheets;
  return sheets;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert a zero-based column index to a spreadsheet column letter
 * Used to build cell ranges like "A1", "AB5", "ZZ100" for Google Sheets API calls
 * Examples: 0 → "A", 1 → "B", 25 → "Z", 26 → "AA", 27 → "AB"
 * @param index Zero-based column index (0 = column A, 1 = column B, etc.)
 * @returns Column letter (e.g., "A", "B", "AA", "ZZ")
 */
export function getColumnLetter(index: number): string {
  let letter = '';

  // Convert index to base-26 letter representation
  while (index >= 0) {
    // Get the letter for this position (A=65 in ASCII)
    letter = String.fromCharCode((index % 26) + 65) + letter;

    // Move to the next position (like dividing by 26 in base conversion)
    index = Math.floor(index / 26) - 1;
  }

  return letter;
}

// ============================================================================
// FLEXIBLE COLUMN MAPPING
// ============================================================================

interface ColumnMapCache {
  [spreadsheetId: string]: {
    [sheetName: string]: { [key: string]: number };
  };
}

let columnMapCache: ColumnMapCache = {};

// ── Club details cache ────────────────────────────────────────────────────────
// Club details rarely change; cache per club name for 5 minutes.
const _clubDetailsCache = new Map<string, { data: ClubDetails | null; ts: number }>();
const CLUB_DETAILS_CACHE_TTL_MS = 5 * 60_000;

/**
 * Get column mapping from header row
 * Maps column names to their index positions (0-based)
 * Example: { "full_name": 2, "user_name": 0, "email": 3 }
 * Caches result to avoid repeated API calls for the same sheet
 */
export async function getColumnMap(
  spreadsheetId: string,
  sheetName: string
): Promise<{ [key: string]: number }> {
  // Check cache first to avoid unnecessary API calls
  // Cache structure: columnMapCache[spreadsheetId][sheetName] = map

  // Check if we have any cached data for this spreadsheet
  if (columnMapCache[spreadsheetId]) {
    // Check if we have the mapping for this specific sheet
    if (columnMapCache[spreadsheetId][sheetName]) {
      // Return cached mapping (avoids API call)
      return columnMapCache[spreadsheetId][sheetName];
    }
  }

  // Cache miss - need to fetch from Google Sheets
  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Fetch the first row (header row) from the sheet
  // Range format: "'SheetName'!1:1" means row 1 only (quotes needed for names with spaces)
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!1:1`,
  });

  // Extract header row from API response
  // Default to empty array if response doesn't contain data
  let headers = [];
  if (response.data.values && response.data.values[0]) {
    headers = response.data.values[0];
  }

  // Build mapping object: normalized column name → column index
  const map: { [key: string]: number } = {};

  // Loop through each header cell and create normalized mapping
  for (let index = 0; index < headers.length; index++) {
    const header = headers[index];

    // Normalize header name to match our code conventions
    // 1. Convert to string (in case of number headers)
    // 2. Convert to lowercase
    // 3. Trim whitespace
    // 4. Replace spaces with underscores
    // 5. Replace forward slashes with underscores (e.g., "Ladies/Men" → "ladies_men")
    const normalized = String(header)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/\//g, '_');

    // Map normalized name to column index (0-based)
    // Example: "Full Name" → "full_name" → index 2
    map[normalized] = index;
  }

  // Save to cache for future calls
  // First ensure spreadsheet entry exists in cache
  if (!columnMapCache[spreadsheetId]) {
    columnMapCache[spreadsheetId] = {};
  }

  // Store mapping in cache
  columnMapCache[spreadsheetId][sheetName] = map;

  // Return the mapping
  return map;
}

/**
 * Clear the column mapping cache
 * Call this function if you manually change column headers in any spreadsheet
 * Without clearing the cache, the system will continue using the old column positions
 * which will cause data to be read from or written to the wrong columns
 * Normally not needed - cache automatically handles changes during runtime
 */
export function clearColumnMapCache() {
  // Reset the cache to an empty object
  // Next call to getColumnMap will fetch fresh headers from Google Sheets
  columnMapCache = {};
}

/**
 * Clear column map cache for a specific sheet
 * Used when column mapping appears stale or invalid
 */
export function clearColumnMapCacheForSheet(spreadsheetId: string, sheetName: string) {
  if (columnMapCache[spreadsheetId] && columnMapCache[spreadsheetId][sheetName]) {
    delete columnMapCache[spreadsheetId][sheetName];
  }
}

// ============================================================================
// GAMES SHEET OPERATIONS
// ============================================================================

/**
 * Get all games from Games sheet, optionally filtered by status
 * Returns array of Game objects with all game details
 * Status codes: O=Open, X=Selecting, S=Selected, P=Played, C=Cancelled, A=Abandoned
 */
export async function getGames(statusFilter?: GameStatus, typeFilter?: GameType[]): Promise<Game[]> {
  // Get Friendlies spreadsheet ID from environment
  const spreadsheetId = getFriendliesSpreadsheetId();

  // Get column mappings for Games sheet (cached)
  const colMap = await getColumnMap(spreadsheetId, 'Games');

  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Fetch all data rows from Games sheet (skip header row 1)
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Games!A2:ZZ',
  });

  // Extract rows from response (empty array if no data)
  const rows = response.data.values || [];

  // Helper function to get a string value from a row by field name
  // Returns null if column doesn't exist or cell is empty
  const get = (row: any[], field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || null) : null;
  };

  // Helper function to get an integer value from a row by field name
  // Returns 0 if column doesn't exist or cell is empty
  const getInt = (row: any[], field: string): number => {
    const val = get(row, field);
    return val ? parseInt(val) : 0;
  };

  // Build array of Game objects from sheet rows
  const games: Game[] = [];

  // Loop through all data rows
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Calculate row number in sheet (row 1 is header, data starts at row 2)
    const rowNumber = i + 2;

    // Extract basic game information
    // Normalize date to DD/MM/YYYY format immediately when reading from sheet
    const date = normalizeToUKDate(get(row, 'date') || '');
    const tabDate = get(row, 'tab_date') || '';
    const time = get(row, 'time') || '';
    const clubName = get(row, 'club_name') || '';

    // Extract home/away status (default to Home if not specified)
    // Try multiple possible column names: "Home/Away" -> "home_away", "H/A" -> "h_a"
    const homeAwayValue = get(row, 'home_away') || get(row, 'h_a') || 'H';
    const homeAway = (homeAwayValue.trim().toUpperCase() === 'A' ? 'A' : 'H') as 'H' | 'A';

    // Extract game format and type details
    const format = get(row, 'format') || '';           // e.g., "Triples", "Rinks"
    const ladiesMen = get(row, 'ladies_men') || '';    // "Ladies", "Men", or "Mixed"
    const dress = get(row, 'dress') || '';             // Dress code requirements
    const league = get(row, 'league') || '';           // League/competition name

    // Extract game identifiers and status
    const tabName = get(row, 'tab_name') || '';        // Unique identifier (used as sheet tab name)
    const status = (get(row, 'status') || '') as GameStatus; // Game lifecycle status
    const include = get(row, 'include') || undefined;  // Whether to include in stats/reports

    // Extract capacity limit and player counts
    const maxPlayers = getInt(row, 'max_capacity');  // Maximum allowed players (capacity limit)
    const entered = getInt(row, 'entered');          // Total players who entered
    const selected = getInt(row, 'selected');        // Players selected to play
    const reserves = getInt(row, 'reserves');        // Reserve players

    // Extract scores (only populated for Played games)
    const bhbcScoreText = get(row, 'bhbc_score');

    // Parse BHBC score to integer, or null if not played
    let bhbcScore = null;
    if (bhbcScoreText) {
      bhbcScore = parseInt(bhbcScoreText);
    }

    // Extract and parse opponent score
    const opponentScoreText = get(row, 'opponent_score');
    let opponentScore = null;
    if (opponentScoreText) {
      opponentScore = parseInt(opponentScoreText);
    }

    // Extract additional metadata for cancelled/abandoned games
    const reason = get(row, 'reason') || '';   // Cancellation/abandonment reason
    const who = get(row, 'who') || '';         // Who initiated cancellation

    // Extract audit trail information
    const lastModifiedBy = get(row, 'last_modified_by') || '';     // Who last changed this game
    const lastModifiedDate = get(row, 'last_modified_date') || ''; // When it was last changed

    // Extract paired flag (Y if paired with another game on same date)
    const paired = get(row, 'paired') || '';

    // Extract game type (defaults to 'Friendly' for backward compatibility)
    const gameType = (get(row, 'type') || 'Friendly') as GameType;

    // Extract club suffix (appended to club name in UI, e.g. 'A' → 'Henfield A')
    const clubSuffix = get(row, 'club_suffix') || '';

    // Extract optional special instructions message (column renamed from "Message" to "Special Instructions")
    const specialInstructions = get(row, 'special_instructions') || get(row, 'message') || '';

    // Extract optional pickup information (for away game car sharing)
    // Supports both column names "Pickup Info" and "Pickup Information"
    const pickupInfo = get(row, 'pickup_info') || get(row, 'pickup_information') || '';

    // Extract captain of the day's userName (stored in Games sheet after migration)
    const captain = get(row, 'captain') || '';

    // Extract selection lock fields
    const lockedBy = get(row, 'locked_by') || '';
    const lockedAt = get(row, 'locked_at') || '';

    // Build complete Game object
    const game: Game = {
      rowNumber,
      date,
      tabDate,
      time,
      clubName,
      homeAway,
      format,
      ladiesMen,
      dress,
      league,
      tabName,
      status,
      include,
      maxPlayers,
      entered,
      selected,
      reserves,
      bhbcScore,
      opponentScore,
      reason,
      who,
      lastModifiedBy,
      lastModifiedDate,
      paired,
      gameType,
      clubSuffix,
      specialInstructions,
      pickupInfo,
      captain,
      lockedBy,
      lockedAt,
    };

    // Add game to array
    games.push(game);
  }

  // Apply status filter if provided
  let result = games;
  if (statusFilter !== undefined) {
    result = result.filter(g => g.status === statusFilter);
  }

  // Apply type filter if provided
  if (typeFilter && typeFilter.length > 0) {
    result = result.filter(g => typeFilter.includes(g.gameType));
  }

  return result;
}

/**
 * Build display name for a club by appending suffix if present
 * e.g. displayClubName('Henfield', 'A') → 'Henfield A'
 *      displayClubName('Lindfield', '') → 'Lindfield'
 */
export function displayClubName(clubName: string, clubSuffix: string): string {
  return [clubName, clubSuffix].filter(Boolean).join(' ');
}

/**
 * Update game status and related fields in Games sheet
 * Called during status transitions in the game lifecycle
 * Status flow: blank → O (Open) → X (Selecting) → S (Selected) → P (Played)
 * Alternative endings: C (Cancelled) or A (Abandoned)
 * Uses batch update to update multiple cells atomically
 */
export async function updateGameStatus(
  tabName: string,
  newStatus: GameStatus,
  additionalData?: {
    bhbcScore?: number;       // Our score (required for Played/Abandoned)
    opponentScore?: number;   // Opponent score (required for Played/Abandoned)
    reason?: string;          // Cancellation/abandonment reason
    who?: string;             // Who initiated cancellation
    modifiedBy?: string;      // Username of who made this change
    rowNumber?: number;       // Row number to identify game (for unopened games with empty tabName)
  }
): Promise<void> {
  // Get Friendlies spreadsheet ID from environment
  const spreadsheetId = getFriendliesSpreadsheetId();

  // Get column mappings for Games sheet (cached)
  const colMap = await getColumnMap(spreadsheetId, 'Games');

  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Fetch all games to find the row for this specific game
  const games = await getGames();

  // Search for the game we're updating.
  // rowNumber is the authoritative identifier when provided — it comes directly from the
  // game object found in the API route and cannot collide with another game's tabName
  // (e.g. when opening a new game whose effectiveTabName matches an existing published game).
  let game = null;

  if (additionalData?.rowNumber) {
    game = games.find(g => g.rowNumber === additionalData.rowNumber) || null;
    if (!game && tabName && tabName.trim() !== '') {
      game = games.find(g => g.tabName === tabName) || null;
    }
  } else if (tabName && tabName.trim() !== '') {
    game = games.find(g => g.tabName === tabName) || null;
  }

  // Throw error if game not found in Games sheet
  if (!game) {
    throw new Error(`Game not found - tabName: ${tabName}, rowNumber: ${additionalData?.rowNumber}`);
  }

  // Build array of cell updates to apply in a single batch operation
  // Start with the status update (always required)
  const updates: any[] = [
    {
      range: `Games!${getColumnLetter(colMap['status'])}${game.rowNumber}`,
      values: [[newStatus]],
    },
  ];

  // Populate Tab Name when opening or closing game for first time
  // This ensures the Tab Name column in spreadsheet matches the calculated tabName
  // Always write it to ensure spreadsheet is populated even if parser calculated it as fallback
  if ((newStatus === 'O' || newStatus === 'X') && colMap['tab_name'] !== undefined) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['tab_name'])}${game.rowNumber}`,
      values: [[tabName]],
    });
  }

  // Add BHBC score if provided (used when transitioning to Played or Abandoned)
  if (additionalData && additionalData.bhbcScore !== undefined) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['bhbc_score'])}${game.rowNumber}`,
      values: [[additionalData.bhbcScore]],
    });
  }

  // Add opponent score if provided (used when transitioning to Played or Abandoned)
  if (additionalData && additionalData.opponentScore !== undefined) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['opponent_score'])}${game.rowNumber}`,
      values: [[additionalData.opponentScore]],
    });
  }

  // Add cancellation/abandonment reason if provided
  // Required when transitioning to Cancelled or Abandoned status
  if (additionalData && additionalData.reason) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['reason'])}${game.rowNumber}`,
      values: [[additionalData.reason]],
    });
  }

  // Add who initiated the cancellation if provided
  // Required when transitioning to Cancelled status
  if (additionalData && additionalData.who) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['who'])}${game.rowNumber}`,
      values: [[additionalData.who]],
    });
  }

  // Add audit trail information if provided
  // Records who made the change and when it was made
  if (additionalData && additionalData.modifiedBy) {
    updates.push(
      {
        range: `Games!${getColumnLetter(colMap['last_modified_by'])}${game.rowNumber}`,
        values: [[additionalData.modifiedBy]],
      },
      {
        range: `Games!${getColumnLetter(colMap['last_modified_date'])}${game.rowNumber}`,
        values: [[new Date().toISOString()]],
      }
    );
  }

  // Execute all updates in a single batch operation for atomicity
  // This ensures all fields update together or none update at all
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getFriendliesSpreadsheetId(),
    requestBody: {
      data: updates,
      valueInputOption: 'USER_ENTERED',
    },
  });

  // Append audit log entry (failures are swallowed inside appendManageLog)
  await appendManageLog({
    username: additionalData?.modifiedBy ?? '',
    action: `status:${newStatus}`,
    tabName: game.tabName || tabName,
    rowNumber: game.rowNumber,
    oldStatus: game.status,
    newStatus,
  });
}

// ============================================================================
// MANAGE LOG
// ============================================================================

/**
 * Append a row to the ManageLog sheet for audit trail.
 * Creates the sheet if it doesn't exist. Failures are swallowed so they
 * never block the actual operation being logged.
 */
export async function appendManageLog(entry: {
  username: string;
  action: string;
  tabName: string;
  rowNumber?: number;
  oldStatus?: string;
  newStatus?: string;
}): Promise<void> {
  try {
    const spreadsheetId = getFriendliesSpreadsheetId();
    const sheets = getSheetsClient();

    // Ensure the ManageLog sheet exists
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
    const exists = meta.data.sheets?.some(s => s.properties?.title === 'ManageLog');
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title: 'ManageLog' },
            },
          }],
        },
      });
      // Write header row
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'ManageLog!A1:G1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['timestamp', 'username', 'action', 'tab_name', 'row_number', 'old_status', 'new_status']],
        },
      });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'ManageLog!A:G',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          new Date().toISOString(),
          entry.username,
          entry.action,
          entry.tabName,
          entry.rowNumber ?? '',
          entry.oldStatus ?? '',
          entry.newStatus ?? '',
        ]],
      },
    });
  } catch {
    // Never let logging failure propagate
  }
}

// ============================================================================
// SELECTION LOCK
// ============================================================================

/**
 * Acquire the selection lock for a game.
 * If the game is already locked by someone else, returns the existing lock info
 * without overwriting (caller must use force=true to override).
 * Returns the resulting lock state.
 */
export async function acquireGameLock(
  tabName: string,
  username: string,
  rowNumber?: number,
  force = false,
): Promise<{ acquired: boolean; lockedBy: string; lockedAt: string }> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Games');
  const sheets = getSheetsClient();

  if (colMap['locked_by'] === undefined || colMap['locked_at'] === undefined) {
    // Column not set up yet — treat as unlocked, skip write
    return { acquired: true, lockedBy: username, lockedAt: new Date().toISOString() };
  }

  const games = await getGames();
  const game = rowNumber
    ? (games.find(g => g.rowNumber === rowNumber) ?? games.find(g => g.tabName === tabName))
    : games.find(g => g.tabName === tabName);

  if (!game) throw new Error(`Game not found: ${tabName}`);

  // If already locked by someone else and not forcing, return existing lock
  if (game.lockedBy && game.lockedBy !== username && !force) {
    return { acquired: false, lockedBy: game.lockedBy, lockedAt: game.lockedAt };
  }

  const now = new Date().toISOString();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `Games!${getColumnLetter(colMap['locked_by'])}${game.rowNumber}`, values: [[username]] },
        { range: `Games!${getColumnLetter(colMap['locked_at'])}${game.rowNumber}`, values: [[now]] },
      ],
    },
  });

  return { acquired: true, lockedBy: username, lockedAt: now };
}

/**
 * Release the selection lock for a game.
 * Only clears the lock if it is currently held by the requesting user.
 * Silently succeeds if the lock is already clear or held by someone else.
 */
export async function releaseGameLock(
  tabName: string,
  username: string,
  rowNumber?: number,
): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Games');
  const sheets = getSheetsClient();

  if (colMap['locked_by'] === undefined || colMap['locked_at'] === undefined) return;

  const games = await getGames();
  const game = rowNumber
    ? (games.find(g => g.rowNumber === rowNumber) ?? games.find(g => g.tabName === tabName))
    : games.find(g => g.tabName === tabName);

  if (!game) return;
  if (game.lockedBy && game.lockedBy !== username) return; // someone else owns it

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `Games!${getColumnLetter(colMap['locked_by'])}${game.rowNumber}`, values: [['']] },
        { range: `Games!${getColumnLetter(colMap['locked_at'])}${game.rowNumber}`, values: [['']] },
      ],
    },
  });
}

/**
 * Update the special instructions message for a game in the Games sheet.
 * The 'message' column must exist in the Games sheet.
 */
export async function updateGameMessage(tabName: string, message: string, rowNumber?: number, modifiedBy?: string): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Games');
  const sheets = getSheetsClient();

  const games = await getGames();
  let game = tabName ? games.find(g => g.tabName === tabName) : undefined;
  if (!game && rowNumber) {
    game = games.find(g => g.rowNumber === rowNumber);
  }
  if (!game) {
    throw new Error(`Game not found: ${tabName || `row ${rowNumber}`}`);
  }

  // Accept either "Special Instructions" (new name) or "Message" (old name) as the column header
  const msgColKey = colMap['special_instructions'] !== undefined ? 'special_instructions' : 'message';
  if (colMap[msgColKey] === undefined) {
    throw new Error('No "Special Instructions" or "Message" column found in Games sheet');
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Games!${getColumnLetter(colMap[msgColKey])}${game.rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[message]] },
  });

}

/**
 * Update the pickup information for a game in the Games sheet.
 * The 'Pickup Info' column must exist in the Games sheet.
 */
export async function updateGamePickupInfo(tabName: string, pickupInfo: string, rowNumber?: number, modifiedBy?: string): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Games');
  const sheets = getSheetsClient();

  const games = await getGames();
  let game = tabName ? games.find(g => g.tabName === tabName) : undefined;
  if (!game && rowNumber) {
    game = games.find(g => g.rowNumber === rowNumber);
  }
  if (!game) {
    throw new Error(`Game not found: ${tabName || `row ${rowNumber}`}`);
  }

  // Accept either "Pickup Info" or "Pickup Information" as the column header
  const pickupColKey = colMap['pickup_info'] !== undefined ? 'pickup_info' : 'pickup_information';
  if (colMap[pickupColKey] === undefined) {
    throw new Error('No "Pickup Info" or "Pickup Information" column found in Games sheet');
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Games!${getColumnLetter(colMap[pickupColKey])}${game.rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[pickupInfo]] },
  });

}

/**
 * Update player count columns in the Games sheet for a specific game
 * The Games sheet tracks three counts: entered (players who entered), selected (players picked to play), reserves (backup players)
 * Called after players enter/withdraw or after captain makes team selections
 * Uses batch update to efficiently update multiple columns in a single API call
 * @param tabName The game's tab name to update
 * @param counts Object with optional entered, selected, and/or reserves counts
 */
export async function updateGameCounts(
  tabName: string,
  counts: {
    entered?: number;      // Number of players who entered this game
    selected?: number;     // Number of players picked to play (status 'Y')
    reserves?: number;     // Number of reserve players (status 'R' or 'T')
  }
): Promise<void> {
  // Get spreadsheet ID and column mapping for Games sheet
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Games');
  const sheets = getSheetsClient();

  // Fetch all games to find the row number for this game
  const games = await getGames();

  // Loop through all games to find the one we need to update
  let game = null;
  for (const g of games) {
    if (g.tabName === tabName) {
      game = g;
      break;
    }
  }

  // Throw error if game not found
  if (!game) throw new Error(`Game not found: ${tabName}`);

  // Build array of cell updates (only update counts that were provided)
  const updates: any[] = [];

  // Add entered count update if provided
  if (counts.entered !== undefined) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['entered'])}${game.rowNumber}`,
      values: [[counts.entered]],
    });
  }

  // Add selected count update if provided
  if (counts.selected !== undefined) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['selected'])}${game.rowNumber}`,
      values: [[counts.selected]],
    });
  }

  // Add reserves count update if provided
  if (counts.reserves !== undefined) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['reserves'])}${game.rowNumber}`,
      values: [[counts.reserves]],
    });
  }

  // Only make API call if there are updates to perform
  if (updates.length > 0) {
    // Use batch update to update multiple cells in a single API call
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getFriendliesSpreadsheetId(),
      requestBody: {
        data: updates,                    // Array of cell updates
        valueInputOption: 'USER_ENTERED', // Parse values as if user typed them
      },
    });
  }
}

/**
 * Update the captain of the day for a game in the Games sheet
 * Captain is stored as the player's userName in a "Captain" column on the Games sheet
 * Pass an empty string to clear the captain designation
 * @param tabName The game's tab name (used to find the row in Games sheet)
 * @param captainUserName The userName of the captain, or '' to clear
 */
export async function updateCaptain(tabName: string, captainUserName: string): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Games');

  // If the Games sheet doesn't have a Captain column yet, do nothing
  if (colMap['captain'] === undefined) {
    console.warn('[updateCaptain] No Captain column found in Games sheet — skipping');
    return;
  }

  const games = await getGames();
  const game = games.find(g => g.tabName === tabName);
  if (!game) throw new Error(`Game not found: ${tabName}`);

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Games!${getColumnLetter(colMap['captain'])}${game.rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[captainUserName]] },
  });
}

/**
 * Add players directly to a game sheet tab with their stats
 * Optimized version that fetches all data once and does a single batch write
 * Used by add-players API to add players in one operation
 * @param tabName The game sheet tab name
 * @param playerUserNames Array of userNames to add
 * @returns Number of players added
 */
export async function addPlayersToGameSheetDirect(
  tabName: string,
  playerUserNames: string[]
): Promise<number> {
  if (playerUserNames.length === 0) return 0;

  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  // Fetch all needed data in parallel for efficiency
  const [gameSheetColMap, playersColMap, membersColMap] = await Promise.all([
    getColumnMap(spreadsheetId, tabName),
    getColumnMap(spreadsheetId, 'Players'),
    getColumnMap(getMembersSpreadsheetId(), 'Members'),
  ]);

  // Fetch game sheet, Players sheet, and Members sheet in parallel
  const [gameSheetResponse, playersResponse, membersResponse] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A:ZZ`,
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Players!A:ZZ',
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: getMembersSpreadsheetId(),
      range: 'Members!A:ZZ',
    }),
  ]);

  const gameSheetRows = gameSheetResponse.data.values || [];
  const playersRows = playersResponse.data.values || [];
  const playersHeaders = playersRows[0] || [];
  const membersRows = membersResponse.data.values || [];

  // Build set of existing players in game sheet (lowercase for comparison)
  const existingPlayers = new Set<string>();
  const nameColIndex = gameSheetColMap['name'] ?? gameSheetColMap['user_name'] ?? 0;
  for (let i = 1; i < gameSheetRows.length; i++) {
    const name = gameSheetRows[i][nameColIndex];
    if (name) existingPlayers.add(name.toString().toLowerCase());
  }

  // Filter to only new players
  const newPlayers = playerUserNames.filter(
    userName => !existingPlayers.has(userName.toLowerCase())
  );

  if (newPlayers.length === 0) return 0;

  // Get column indices for game sheet
  const nameDownColIndex = gameSheetColMap['name_down'];
  const pickedColIndex = gameSheetColMap['picked'];
  const percentPlayedColIndex = gameSheetColMap['percent_played'];
  const driverBarColIndex = gameSheetColMap['driver_bar'];
  const selectedColIndex = gameSheetColMap['selected'];

  // Calculate starting row for new players
  let nextRow = gameSheetRows.length + 1;
  if (nextRow < 2) nextRow = 2; // Minimum row 2 (after header)

  // Build batch updates
  const batchData: { range: string; values: (string | number)[][] }[] = [];

  for (const userName of newPlayers) {
    try {
      // Get stats from cached data
      const stats = getPlayerStatsFromCache(userName, playersRows, playersColMap, playersHeaders, tabName);
      const driverBar = getDriverBarInfoFromCache(userName, membersRows, membersColMap);

      // Add player name
      batchData.push({
        range: `'${tabName}'!${getColumnLetter(nameColIndex)}${nextRow}`,
        values: [[userName]],
      });

      // Add stats in one range if columns are contiguous
      // Write percentPlayed as decimal (0-1) for percentage-formatted cells
      // Normalize: if value > 1, it's already a percentage (64 -> 0.64)
      const percentPlayedDecimal = stats.percentPlayed > 1
        ? stats.percentPlayed / 100
        : stats.percentPlayed;
      if (nameDownColIndex !== undefined && driverBarColIndex !== undefined) {
        batchData.push({
          range: `'${tabName}'!${getColumnLetter(nameDownColIndex)}${nextRow}:${getColumnLetter(driverBarColIndex)}${nextRow}`,
          values: [[stats.nameDown, stats.picked, percentPlayedDecimal, driverBar.code]],
        });
      }

      // Set position to 'R' (Reserve) — same default as addPlayerToGameSheet
      if (selectedColIndex !== undefined) {
        batchData.push({
          range: `'${tabName}'!${getColumnLetter(selectedColIndex)}${nextRow}`,
          values: [['R']],
        });
      }

      nextRow++;
    } catch (error) {
      console.error(`[addPlayersToGameSheetDirect] Error adding ${userName}:`, error);
      // Continue with other players
    }
  }

  // Execute batch update
  if (batchData.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: batchData,
      },
    });
  }

  return newPlayers.length;
}

/**
 * Batch update game counts for multiple games in a single API call
 * More efficient than calling updateGameCounts multiple times
 * @param updates Array of game count updates with rowNumber pre-calculated
 */
export async function batchUpdateGameCounts(
  updates: {
    rowNumber: number;
    counts: {
      entered?: number;
      selected?: number;
      reserves?: number;
    };
  }[]
): Promise<void> {
  if (updates.length === 0) return;

  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Games');
  const sheets = getSheetsClient();

  // Build array of cell updates for all games
  const batchData: { range: string; values: number[][] }[] = [];

  for (const update of updates) {
    if (update.counts.entered !== undefined) {
      batchData.push({
        range: `Games!${getColumnLetter(colMap['entered'])}${update.rowNumber}`,
        values: [[update.counts.entered]],
      });
    }
    if (update.counts.selected !== undefined) {
      batchData.push({
        range: `Games!${getColumnLetter(colMap['selected'])}${update.rowNumber}`,
        values: [[update.counts.selected]],
      });
    }
    if (update.counts.reserves !== undefined) {
      batchData.push({
        range: `Games!${getColumnLetter(colMap['reserves'])}${update.rowNumber}`,
        values: [[update.counts.reserves]],
      });
    }
  }

  if (batchData.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: batchData,
        valueInputOption: 'USER_ENTERED',
      },
    });
  }
}

// ============================================================================
// PLAYERS SHEET OPERATIONS
// ============================================================================

/**
 * Create a new column in the Players sheet for a game
 * Called when a game is opened (status changes to 'O')
 * The new column header is the game's tabName (e.g., "West Hoathly 25-Sep")
 * Players will use this column to mark their entry status (E, P, R, etc.) as the game progresses
 * Copies formatting, data validation, and column width from the previous column
 * @param tabName The game's tab name (becomes the column header)
 */
export async function createGameColumn(tabName: string): Promise<void> {
  // Log for debugging
  console.log('[createGameColumn] Creating column for tabName:', tabName);

  // Validate tabName
  if (!tabName || tabName.trim() === '') {
    throw new Error('tabName is required and cannot be empty');
  }

  // Get authenticated Google Sheets client
  const sheets = getSheetsClient();
  const spreadsheetId = getFriendliesSpreadsheetId();

  // Fetch the header row from Players sheet to find where to add the new column
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!1:1',  // Row 1 contains all column headers
  });

  // Get the current headers array (or empty array if no headers exist)
  const headers = response.data.values?.[0] || [];

  // If the column already exists (re-opening a previously opened game), skip creation
  if (headers.some((h: string) => h === tabName)) {
    console.log('[createGameColumn] Column already exists for tabName:', tabName, '— skipping');
    return;
  }

  // Calculate the next available column index and letter
  // If there are 10 headers (A-J), next column is K (index 10)
  const nextColumnIndex = headers.length;
  const nextColumn = getColumnLetter(nextColumnIndex);
  const previousColumnIndex = nextColumnIndex - 1;

  // Get Players sheet metadata to find its sheetId and column widths for batchUpdate
  const spreadsheetMetadata = await sheets.spreadsheets.get({
    spreadsheetId,
    // Request grid data and column metadata to get column widths
    fields: 'sheets(properties,data.columnMetadata)',
  });

  // Find the Players sheet in the metadata
  const playersSheet = spreadsheetMetadata.data.sheets?.find(
    sheet => sheet.properties?.title === 'Players'
  );

  if (!playersSheet || !playersSheet.properties?.sheetId) {
    throw new Error('Players sheet not found');
  }

  const playersSheetId = playersSheet.properties.sheetId;

  // Get current sheet dimensions
  const gridProperties = playersSheet.properties.gridProperties;
  const currentColumnCount = gridProperties?.columnCount || 0;

  // Build batch update requests
  const requests: any[] = [];

  // If the new column exceeds current grid size, insert a new column first
  if (nextColumnIndex >= currentColumnCount) {
    console.log(`[createGameColumn] Inserting new column at index ${nextColumnIndex}, current columns: ${currentColumnCount}`);
    requests.push({
      insertDimension: {
        range: {
          sheetId: playersSheetId,
          dimension: 'COLUMNS',
          startIndex: nextColumnIndex,
          endIndex: nextColumnIndex + 1,
        },
        inheritFromBefore: true,  // Inherit formatting from previous column
      },
    });
  }

  // If there's a previous column, copy its formatting, data validation, and width
  if (previousColumnIndex >= 0) {
    // Request 1: Copy formatting and data validation from previous column to new column
    requests.push({
      copyPaste: {
        source: {
          sheetId: playersSheetId,
          startRowIndex: 0,
          endRowIndex: Math.min(999, gridProperties?.rowCount || 1000),  // Don't exceed sheet row limit
          startColumnIndex: previousColumnIndex,
          endColumnIndex: previousColumnIndex + 1,
        },
        destination: {
          sheetId: playersSheetId,
          startRowIndex: 0,
          endRowIndex: Math.min(999, gridProperties?.rowCount || 1000),
          startColumnIndex: nextColumnIndex,
          endColumnIndex: nextColumnIndex + 1,
        },
        pasteType: 'PASTE_FORMAT',  // Copy formatting only (includes data validation)
      },
    });

    // Request 2: Copy column width from previous column
    const columnMetadata = playersSheet.data?.[0]?.columnMetadata;
    const previousColumnWidth = columnMetadata?.[previousColumnIndex]?.pixelSize;
    if (previousColumnWidth) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId: playersSheetId,
            dimension: 'COLUMNS',
            startIndex: nextColumnIndex,
            endIndex: nextColumnIndex + 1,
          },
          properties: {
            pixelSize: previousColumnWidth,
          },
          fields: 'pixelSize',
        },
      });
    }
  }

  // Execute batch update if we have requests
  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  // Write the game's tabName as the new column header
  console.log('[createGameColumn] Writing header to', `Players!${nextColumn}1`, 'with value:', tabName);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Players!${nextColumn}1`,  // e.g., "Players!K1" for the 11th column
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[tabName]],  // Single cell value (e.g., "West Hoathly 25-Sep")
    },
  });
}

/**
 * Get the lookup value for a user in the Players sheet
 * The Players sheet might use 'user_name' (username) or 'full_name' (display name) as the identifier
 * This function determines which value to use when looking up or updating a player's row
 * Returns full_name if Players sheet uses full_name column, otherwise returns userName
 */
async function getPlayerLookupValue(userName: string, spreadsheetId: string, colMap: { [key: string]: number }): Promise<string> {
  // SCENARIO 1: Players sheet uses user_name column
  // This is the simplest case - we can use the userName directly
  if (colMap['user_name'] !== undefined) {
    return userName;
  }

  // SCENARIO 2: Players sheet uses full_name or name column
  // We need to look up the user's full name from the Members sheet

  // Check if Players sheet has a full_name column
  let nameColumn = colMap['full_name'];

  // If not, try the 'name' column as alternative
  if (nameColumn === undefined) {
    nameColumn = colMap['name'];
  }

  // If Players sheet has a name-type column, look up full name from Members sheet
  if (nameColumn !== undefined) {
    // Initialize Google Sheets API client
    const sheets = getSheetsClient();

    // Get Members spreadsheet ID and column mappings
    const membersSpreadsheetId = getMembersSpreadsheetId();
    const membersColMap = await getColumnMap(membersSpreadsheetId, 'Members');

    // Fetch all rows from Members sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: membersSpreadsheetId,
      range: 'Members!A:ZZ',
    });

    // Extract rows from response
    const rows = response.data.values || [];

    // Find which column in Members sheet contains user_name
    let userNameCol = membersColMap['user_name'];

    // Default to first column if user_name column not found
    if (userNameCol === undefined) {
      userNameCol = 0;
    }

    // Find which column in Members sheet contains full_name
    let fullNameCol = membersColMap['full_name'];

    // Try 'name' column if full_name not found
    if (fullNameCol === undefined) {
      fullNameCol = membersColMap['name'];
    }

    // Default to second column if neither found
    if (fullNameCol === undefined) {
      fullNameCol = 1;
    }

    // Search Members sheet for this user's row
    let memberRow = null;

    // Loop through all data rows (skip header at index 0)
    for (let i = 1; i < rows.length; i++) {
      // Check if this row's user_name matches the userName we're looking for
      if (rows[i][userNameCol] === userName) {
        memberRow = rows[i];
        break;
      }
    }

    // If we found the member and they have a full name, return it
    if (memberRow && memberRow[fullNameCol]) {
      return memberRow[fullNameCol];
    }
  }

  // FALLBACK: If we couldn't determine the full name, use userName
  // This ensures we always return something valid
  return userName;
}

/**
 * Get player entries for a specific user from Players sheet
 * The Players sheet has fixed columns (name, stats) followed by game columns
 * Each game column contains the player's status for that game (E, P, R, T, etc.)
 * Returns array of PlayerEntry objects showing which games the user has entered/played
 * Status codes: E=Entered, P=Picked, R=Reserve, T=Reserve Team, W suffix=Withdrawn
 */
export async function getPlayerEntries(userName: string): Promise<PlayerEntry[]> {
  // Get Friendlies spreadsheet ID from environment
  const spreadsheetId = getFriendliesSpreadsheetId();

  // Get column mappings for Players sheet (cached)
  const colMap = await getColumnMap(spreadsheetId, 'Players');

  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Get the appropriate lookup value to find this user's row
  // Returns userName or full_name depending on how Players sheet is configured
  const lookupValue = await getPlayerLookupValue(userName, spreadsheetId, colMap);

  // Fetch all data from Players sheet including all game columns
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!A:ZZ',
  });

  // Extract rows and headers from response
  const rows = response.data.values || [];
  const headers = rows[0] || [];

  // Find which column contains the user identifier (varies by sheet configuration)
  // Try user_name first, then full_name, then name, finally default to first column
  let userNameCol = colMap['user_name'];

  if (userNameCol === undefined) {
    // Try full_name if user_name doesn't exist
    userNameCol = colMap['full_name'];
  }

  if (userNameCol === undefined) {
    // Try name if full_name doesn't exist
    userNameCol = colMap['name'];
  }

  if (userNameCol === undefined) {
    // Default to first column as last resort
    userNameCol = 0;
  }

  // Search for this user's row in the Players sheet
  let userRowIndex = -1;

  // Loop through all data rows (skip header at index 0)
  for (let i = 1; i < rows.length; i++) {
    // Check if this row matches the user we're looking for
    if (rows[i][userNameCol] === lookupValue) {
      userRowIndex = i;
      break;
    }
  }

  // Return empty array if user not found in Players sheet
  if (userRowIndex === -1) {
    return [];
  }

  // Get the user's data row
  const userRow = rows[userRowIndex];

  // Build set of fixed column indices to skip (these contain stats, not game entries)
  // Fixed columns: name, name_down, picked, %_played_vs_name_down, withdrawn, cancelled
  // Game columns: everything else (column header = game tab_name)
  const fixedColumnNames = ['name', 'name_down', 'picked', '%_played_vs_name_down', 'withdrawn', 'cancelled'];
  const fixedColumns = new Set<number>();

  // Loop through each fixed column name and add its index to the set
  for (const columnName of fixedColumnNames) {
    const colIndex = colMap[columnName];

    // Only add if this column exists in the sheet
    if (colIndex !== undefined) {
      fixedColumns.add(colIndex);
    }
  }

  // Loop through all columns and collect game entries
  // Game columns have tab_name as header and status code (E, P, R, etc.) as cell value
  const entries: PlayerEntry[] = [];

  for (let i = 0; i < headers.length; i++) {
    const headerName = headers[i];
    const cellValue = userRow[i];

    // Skip fixed columns (stats) - we only want game columns
    const isFixedColumn = fixedColumns.has(i);
    if (isFixedColumn) {
      continue;
    }

    // Skip if header is empty (no game assigned to this column yet)
    if (!headerName) {
      continue;
    }

    // Skip if cell value is empty (user hasn't entered this game)
    if (!cellValue) {
      continue;
    }

    // This is a game column with an entry - add to results
    // Header contains the game's tab_name, cell contains the entry status
    entries.push({
      tabName: headerName,              // Game identifier (e.g., "20240315_ClubName")
      status: cellValue as PlayerEntryStatus, // Status code (E, P, R, T, PW, RW, etc.)
    });
  }

  // Return array of all games this user has entered or played
  return entries;
}

/**
 * Update a player's entry status for a specific game in the Players sheet
 * Each game has its own column in the Players sheet where player status is tracked
 * Status codes: E=Entered, P=Picked, R=Reserve, T=Reserve Team, PW=Picked+Withdrawn, etc.
 * Pass empty string '' to remove player's entry (used when withdrawing from Open games)
 * @param userName The player's username
 * @param tabName The game's tab name (column header to update)
 * @param status The new status code or empty string to clear
 */
export async function updatePlayerEntry(
  userName: string,
  tabName: string,
  status: PlayerEntryStatus | ''
): Promise<void> {
  // Get spreadsheet ID and column mapping
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Players');
  const sheets = getSheetsClient();

  // Get the value to search for (might be userName or full name depending on sheet structure)
  const lookupValue = await getPlayerLookupValue(userName, spreadsheetId, colMap);

  // Fetch header row to find which column corresponds to this game
  const headersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!1:1',  // Row 1 contains all game column headers
  });

  // Find the column index for this game's tabName
  const headers = headersResponse.data.values?.[0] || [];
  const gameColumnIndex = headers.findIndex(h => h === tabName);

  // Throw error if game column doesn't exist (game not opened yet)
  if (gameColumnIndex === -1) {
    throw new Error(`Game column not found: ${tabName}`);
  }

  // Determine which column contains player identifiers (user_name or full_name)
  // Try user_name first, then full_name, then name, default to column A
  let userNameCol = colMap['user_name'] ?? colMap['full_name'] ?? colMap['name'] ?? 0;

  // Convert column index to letter (e.g., 0 → "A", 1 → "B")
  const userNameColLetter = getColumnLetter(userNameCol);

  // Fetch the entire identifier column to find this user's row
  const playersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Players!${userNameColLetter}:${userNameColLetter}`,  // e.g., "Players!A:A"
  });

  // Search for the user's row (skip header at index 0)
  const players = playersResponse.data.values || [];
  let userRowIndex = players.findIndex((row, index) => index > 0 && row[0] === lookupValue);

  // If user not found, add them as a new row
  if (userRowIndex === -1) {
    // Calculate next row number (after all existing rows)
    const nextRowNumber = players.length + 1;

    // Add the user's identifier to the Players sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Players!${userNameColLetter}${nextRowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[lookupValue]],
      },
    });

    // Update userRowIndex to point to the newly created row
    userRowIndex = nextRowNumber - 1; // Convert to 0-based index
  }

  // Convert game column index to letter for cell reference
  const columnLetter = getColumnLetter(gameColumnIndex);

  // Calculate actual row number (findIndex returns 0-based, but sheet rows are 1-based)
  const rowNumber = userRowIndex + 1;

  // Update the cell at the intersection of user's row and game's column
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Players!${columnLetter}${rowNumber}`,  // e.g., "Players!K15" (column K, row 15)
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[status]],  // Single cell value (e.g., "E", "P", "PW", or "")
    },
  });
}

/**
 * Batch update multiple player entries for a single game
 * Updates all players in a single Google Sheets API call
 * @param tabName The game's tab name (column header to update)
 * @param entries Array of {userName, status} to update
 * @returns Array of results indicating success/failure for each player
 */
export async function batchUpdatePlayerEntries(
  tabName: string,
  entries: { userName: string; status: PlayerEntryStatus | '' }[]
): Promise<{ userName: string; success: boolean; error?: string }[]> {
  if (entries.length === 0) return [];

  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Players');
  const sheets = getSheetsClient();

  // Fetch entire Players sheet in one call (more efficient than multiple calls)
  const playersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!A:ZZ',
  });

  const playersRows = playersResponse.data.values || [];
  const headers = playersRows[0] || [];

  // Find game column
  const gameColumnIndex = headers.findIndex((h: string) => h === tabName);
  if (gameColumnIndex === -1) {
    throw new Error(`Game column not found: ${tabName}`);
  }

  // Determine which column contains player identifiers
  const userNameColIndex = colMap['user_name'] ?? colMap['full_name'] ?? colMap['name'] ?? 0;
  const usesUserName = colMap['user_name'] !== undefined;

  // If Players sheet uses full_name, fetch Members sheet ONCE for all lookups
  let membersLookup: Map<string, string> | null = null;
  if (!usesUserName) {
    const membersSpreadsheetId = getMembersSpreadsheetId();
    const membersColMap = await getColumnMap(membersSpreadsheetId, 'Members');
    const membersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: membersSpreadsheetId,
      range: 'Members!A:ZZ',
    });
    const membersRows = membersResponse.data.values || [];
    const memberUserNameCol = membersColMap['user_name'] ?? 0;
    const memberFullNameCol = membersColMap['full_name'] ?? membersColMap['name'] ?? 1;

    membersLookup = new Map();
    for (let i = 1; i < membersRows.length; i++) {
      const row = membersRows[i];
      const userName = row[memberUserNameCol];
      const fullName = row[memberFullNameCol];
      if (userName && fullName) {
        membersLookup.set(userName.toLowerCase(), fullName);
      }
    }
  }

  // Helper to get lookup value (userName or fullName)
  const getLookupValue = (userName: string): string => {
    if (usesUserName) return userName;
    return membersLookup?.get(userName.toLowerCase()) || userName;
  };

  // Build a map of existing players (lowercase lookup value -> row index)
  const existingPlayersMap = new Map<string, number>();
  for (let i = 1; i < playersRows.length; i++) {
    const lookupValue = playersRows[i][userNameColIndex];
    if (lookupValue) {
      existingPlayersMap.set(lookupValue.toString().toLowerCase(), i + 1); // 1-based row
    }
  }

  const gameColumnLetter = getColumnLetter(gameColumnIndex);
  const userNameColLetter = getColumnLetter(userNameColIndex);

  // Process all entries and build batch updates
  const results: { userName: string; success: boolean; error?: string }[] = [];
  const batchData: { range: string; values: (string | number)[][] }[] = [];
  let nextNewRow = playersRows.length + 1;

  for (const entry of entries) {
    try {
      const lookupValue = getLookupValue(entry.userName);
      const existingRow = existingPlayersMap.get(lookupValue.toLowerCase());

      if (existingRow) {
        // User exists - add status update to batch
        batchData.push({
          range: `Players!${gameColumnLetter}${existingRow}`,
          values: [[entry.status]],
        });
      } else {
        // New user - add both name and status to batch
        batchData.push({
          range: `Players!${userNameColLetter}${nextNewRow}`,
          values: [[lookupValue]],
        });
        batchData.push({
          range: `Players!${gameColumnLetter}${nextNewRow}`,
          values: [[entry.status]],
        });
        // Track for next iteration
        existingPlayersMap.set(lookupValue.toLowerCase(), nextNewRow);
        nextNewRow++;
      }
      results.push({ userName: entry.userName, success: true });
    } catch (err) {
      results.push({
        userName: entry.userName,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // Execute single batch update for all changes
  if (batchData.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: batchData,
      },
    });
  }

  return results;
}

/**
 * Get all players who have entered a specific game
 * Returns list of players with their userName, fullName, and status (E or M)
 * @param tabName The game's tab name
 * @returns Array of entered players with their status
 */
export async function getEnteredPlayers(
  tabName: string
): Promise<Array<{ userName: string; fullName: string; status: string }>> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  // Fetch all Players sheet data in one call — row 0 is the header row
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!A:ZZ',
  });

  const rows = response.data.values || [];
  const headers = rows[0] || [];
  const gameColumnIndex = headers.findIndex((h: string) => h === tabName);

  if (gameColumnIndex === -1) {
    throw new Error(`Game column not found: ${tabName}`);
  }
  const enteredPlayers: Array<{ userName: string; fullName: string; status: string }> = [];

  // Get column map to find userName column in Players sheet
  const colMap = await getColumnMap(spreadsheetId, 'Players');
  const userNameColIndex = colMap['user_name'] ?? 0;

  // Build a lookup map of userName -> fullName from Members sheet
  const membersSpreadsheetId = getMembersSpreadsheetId();
  const membersColMap = await getColumnMap(membersSpreadsheetId, 'Members');

  const membersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: membersSpreadsheetId,
    range: 'Members!A:ZZ',
  });

  const membersRows = membersResponse.data.values || [];
  const memberUserNameCol = membersColMap['user_name'] ?? 0;
  let memberFullNameCol = membersColMap['full_name'];
  if (memberFullNameCol === undefined) {
    memberFullNameCol = membersColMap['name'] ?? 1;
  }

  // Build lookup map
  const fullNameLookup: { [userName: string]: string } = {};
  for (let i = 1; i < membersRows.length; i++) {
    const memberRow = membersRows[i];
    const memberUserName = memberRow[memberUserNameCol];
    const memberFullName = memberRow[memberFullNameCol];
    if (memberUserName) {
      fullNameLookup[memberUserName] = memberFullName || memberUserName;
    }
  }

  // Skip header row, iterate through players
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const entryStatus = row[gameColumnIndex];

    // Include any player with a non-empty status in this game's column
    if (entryStatus && entryStatus.trim() !== '') {
      const userName = row[userNameColIndex] || '';
      if (!userName) continue;
      const fullName = fullNameLookup[userName] || userName;
      enteredPlayers.push({ userName, fullName, status: entryStatus });
    }
  }

  return enteredPlayers;
}

/**
 * Get a specific player's entry status for a game
 * @param userName Player's username
 * @param tabName Game's tab name
 * @returns Status code ('E', 'M', 'P', 'R', etc.) or empty string if not entered
 */
export async function getPlayerEntryStatus(
  userName: string,
  tabName: string
): Promise<string> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();
  const colMap = await getColumnMap(spreadsheetId, 'Players');

  // Get lookup value
  const lookupValue = await getPlayerLookupValue(userName, spreadsheetId, colMap);

  // Fetch header row to find game column
  const headersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!1:1',
  });

  const headers = headersResponse.data.values?.[0] || [];
  const gameColumnIndex = headers.findIndex(h => h === tabName);

  if (gameColumnIndex === -1) {
    throw new Error(`Game column not found: ${tabName}`);
  }

  // Find user's row
  const userNameColIndex = colMap['user_name'] ?? colMap['full_name'] ?? colMap['name'] ?? 0;
  const userNameColLetter = getColumnLetter(userNameColIndex);

  const playersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Players!${userNameColLetter}:${userNameColLetter}`,
  });

  const players = playersResponse.data.values || [];
  const userRowIndex = players.findIndex((row, index) => index > 0 && row[0] === lookupValue);

  if (userRowIndex === -1) {
    return ''; // User not found
  }

  // Get the status from the game column
  const rowNumber = userRowIndex + 1;
  const columnLetter = getColumnLetter(gameColumnIndex);

  const statusResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Players!${columnLetter}${rowNumber}`,
  });

  return statusResponse.data.values?.[0]?.[0] || '';
}

/**
 * Get player statistics from Players sheet
 * Returns stats including nameDown, picked count, percent played, withdrawals, and last 6 games
 * The last6Games array shows the player's status codes for their 6 most recent games
 * Status codes in last6Games: P=Picked, R=Reserve, T=Reserve Team, E=Entered, with W suffix if withdrawn
 */
export async function getPlayerStats(userName: string): Promise<PlayerStats> {
  // Get Friendlies spreadsheet ID from environment
  const spreadsheetId = getFriendliesSpreadsheetId();

  // Get column mappings for Players sheet (cached)
  const colMap = await getColumnMap(spreadsheetId, 'Players');

  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Fetch all data from Players sheet including stat columns and game columns
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!A:ZZ',
  });

  // Extract rows and headers from response
  const rows = response.data.values || [];
  const headers = rows[0] || [];

  // Find which column contains user_name
  let userNameCol = colMap['user_name'];

  // Default to first column if user_name doesn't exist
  if (userNameCol === undefined) {
    userNameCol = 0;
  }

  // Search for this user's row in the Players sheet
  let userRowIndex = -1;

  // Loop through all data rows (skip header at index 0)
  for (let i = 1; i < rows.length; i++) {
    // Check if this row matches the userName we're looking for
    if (rows[i][userNameCol] === userName) {
      userRowIndex = i;
      break;
    }
  }

  // Throw error if user not found (different from getPlayerEntries which returns empty array)
  if (userRowIndex === -1) {
    throw new Error(`User not found: ${userName}`);
  }

  // Get the user's data row
  const userRow = rows[userRowIndex];

  // Helper function to get a string value from a stat column
  // Returns null if column doesn't exist or cell is empty
  const get = (field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (userRow[index] || null) : null;
  };

  // Helper function to get an integer value from a stat column
  // Returns 0 if column doesn't exist or cell is empty
  const getInt = (field: string): number => {
    const val = get(field);
    return val ? parseInt(val) : 0;
  };

  // Helper function to get a float value from a stat column
  // Returns 0 if column doesn't exist or cell is empty
  const getFloat = (field: string): number => {
    const val = get(field);
    return val ? parseFloat(val) : 0;
  };

  // Helper function to get percent_played normalized to decimal (0-1 range)
  // Handles multiple formats: "64%", "64", "0.64", or 1 (for 100%)
  const getPercentPlayed = (): number => {
    const val = get('percent_played');
    if (!val) return 0;

    // Remove % sign if present and parse as float
    const numStr = String(val).replace('%', '').trim();
    const num = parseFloat(numStr);

    if (isNaN(num)) return 0;

    // Normalize to decimal: values > 1 are percentages (64 -> 0.64), values <= 1 are already decimal
    return num > 1 ? num / 100 : num;
  };

  // Extract stats from the fixed stat columns
  const stats: PlayerStats = {
    nameDown: getInt('name_down'),          // Closed games where player was selected (P/R/T)
    picked: getInt('picked'),               // Times player was picked to play (P)
    percentPlayed: getPercentPlayed(),      // Percentage of closed selected games actually played
    futureEntered: getInt('future_entered'), // Open games entered but selection not yet done
    withdrawn: getInt('withdrawn'),         // Number of withdrawals
    cancelled: getInt('cancelled'),         // Number of cancelled games
    last6Games: [],                         // Will be populated below
  };

  // Build set of all stat column indices (fixed columns that are NOT game columns)
  // All columns in colMap are stat columns (name_down, picked, etc.)
  // Game columns are NOT in colMap (they have dynamic headers like "20240315_ClubName")
  const fixedColumns = new Set<number>();

  // Loop through all stat column indices and add to set
  for (const columnIndex of Object.values(colMap)) {
    fixedColumns.add(columnIndex);
  }

  // Collect last 6 games by iterating BACKWARD through columns (right to left)
  // Why backward? Because new games are added to the right, so rightmost = most recent
  const last6Games: string[] = [];

  // Start from rightmost column and work backward
  for (let i = headers.length - 1; i >= 0; i--) {
    // Stop collecting once we have 6 games
    if (last6Games.length >= 6) {
      break;
    }

    // Check if this is a stat column (skip stat columns, we only want game columns)
    const isStatColumn = fixedColumns.has(i);
    if (isStatColumn) {
      continue;
    }

    // Check if this column has a header (game tab_name)
    const hasHeader = headers[i];
    if (!hasHeader) {
      continue;
    }

    // Check if user has a value in this game column (their status)
    const hasValue = userRow[i];
    if (!hasValue) {
      continue;
    }

    // This is a game column with an entry - add the status to our list
    // Status codes: P, R, T, E, PW, RW, etc.
    last6Games.push(userRow[i]);
  }

  // We collected games right-to-left (newest first), so reverse to get chronological order
  // Result: oldest of the 6 games first, newest last
  last6Games.reverse();

  // Add the last 6 games to stats object
  stats.last6Games = last6Games;

  // Return complete stats object
  return stats;
}

/**
 * Get all players from the Players sheet for team selection dropdown
 * Returns list of usernames and full names sorted alphabetically by full name
 * Used by captains when adding offline players to a game
 */
export async function getAllPlayers(playingMembersOnly: boolean = true): Promise<{ userName: string; fullName: string; memberType: string }[]> {
  // Get all members from Members sheet (not Players sheet)
  // This allows adding any club member to a game, not just those who have previously entered
  const sheets = getSheetsClient();
  const membersSpreadsheetId = getMembersSpreadsheetId();
  const membersColMap = await getColumnMap(membersSpreadsheetId, 'Members');

  const membersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: membersSpreadsheetId,
    range: 'Members!A:ZZ',
  });

  const membersRows = membersResponse.data.values || [];

  // Return empty array if only header row or no rows at all
  if (membersRows.length <= 1) {
    return [];
  }

  const memberUserNameCol = membersColMap['user_name'] ?? 0;
  let memberFullNameCol = membersColMap['full_name'];
  if (memberFullNameCol === undefined) {
    memberFullNameCol = membersColMap['name'] ?? 1;
  }
  const memberTypeCol = membersColMap['member_type'];

  // Build array of members
  const players: { userName: string; fullName: string; memberType: string }[] = [];

  for (let i = 1; i < membersRows.length; i++) {
    const memberRow = membersRows[i];
    const userName = memberRow[memberUserNameCol];
    const fullName = memberRow[memberFullNameCol];
    const memberType = memberTypeCol !== undefined ? memberRow[memberTypeCol] : '';

    // Only include members with a valid username
    if (userName && userName.trim() !== '') {
      // Filter by playing members if requested (PL=Playing Lady, PM=Playing Man)
      if (playingMembersOnly && memberType) {
        const isPlaying = memberType.startsWith('P') || memberType === 'Full';
        if (!isPlaying) {
          continue; // Skip social members for friendlies/internal games
        }
      }

      players.push({
        userName: userName.trim(),
        fullName: (fullName || userName).trim(),
        memberType: memberType || '',
      });
    }
  }

  // Sort players alphabetically by full name for easier dropdown selection
  players.sort((a, b) => a.fullName.localeCompare(b.fullName));

  return players;
}

// ============================================================================
// GAME SHEET OPERATIONS
// ============================================================================

/**
 * Create a new game sheet by duplicating the template and adding entered players
 * This is called when a game transitions from Open (O) to Selecting (X) status
 * The template sheet contains pre-formatted columns for team selection (Selected, Team, Position, etc.)
 * Returns the count of players added to the sheet
 *
 * @param tabName - The game tab name (e.g., "Felbridge 25 Sep 25")
 * @param playerFilter - Optional list of userNames to include. If provided, only these players
 *   are added to the game sheet (used for paired game allocation). If omitted, all E/M players are included.
 */
export async function createGameSheet(tabName: string, playerFilter?: string[]): Promise<{ enteredCount: number }> {
  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Fetch all games to verify this game exists
  const games = await getGames();

  // Search for the game we're creating a sheet for
  let game = null;
  for (const g of games) {
    if (g.tabName === tabName) {
      game = g;
      break;
    }
  }

  // Throw error if game doesn't exist in Games sheet
  if (!game) {
    throw new Error(`Game not found: ${tabName}`);
  }

  // Get spreadsheet metadata including all sheet tabs
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: getFriendliesSpreadsheetId(),
  });

  // Search for the Template Game Sheet sheet to duplicate
  // This template contains pre-formatted columns for team selection
  let templateSheet = null;
  if (spreadsheet.data.sheets) {
    for (const sheet of spreadsheet.data.sheets) {
      if (sheet.properties && sheet.properties.title === 'Template Game Sheet') {
        templateSheet = sheet;
        break;
      }
    }
  }

  // Throw error if template sheet not found
  if (!templateSheet || !templateSheet.properties || !templateSheet.properties.sheetId) {
    throw new Error('Template sheet not found');
  }

  // Check if a game sheet with this name already exists
  // (Prevents duplicates if function is called multiple times)
  let gameSheetExists = false;
  if (spreadsheet.data.sheets) {
    for (const sheet of spreadsheet.data.sheets) {
      if (sheet.properties && sheet.properties.title === tabName) {
        gameSheetExists = true;
        break;
      }
    }
  }

  // Only create the sheet if it doesn't already exist
  if (!gameSheetExists) {
    // Find the Games sheet index so we can insert new game sheet right after it
    // This keeps game sheets organized (Games sheet, then individual game sheets)
    let gamesSheetIndex = -1;
    if (spreadsheet.data.sheets) {
      for (let i = 0; i < spreadsheet.data.sheets.length; i++) {
        const sheet = spreadsheet.data.sheets[i];
        if (sheet.properties && sheet.properties.title === 'Games') {
          gamesSheetIndex = i;
          break;
        }
      }
    }

    // Calculate where to insert the new sheet
    let insertIndex;
    if (gamesSheetIndex !== undefined && gamesSheetIndex !== -1) {
      // Insert right after Games sheet
      insertIndex = gamesSheetIndex + 1;
    } else {
      // If Games sheet not found, let Google Sheets decide position
      insertIndex = undefined;
    }

    // Duplicate the template sheet to create new game sheet
    // This copies all formatting, formulas, and column structure
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: getFriendliesSpreadsheetId(),
      requestBody: {
        requests: [
          {
            duplicateSheet: {
              sourceSheetId: templateSheet.properties.sheetId, // Template sheet ID
              insertSheetIndex: insertIndex,                   // Where to insert
              newSheetName: tabName,                          // New sheet name (game tab_name)
            },
          },
        ],
      },
    });
  }

  // Fetch all players from Players sheet to find who entered this game
  const playersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: getFriendliesSpreadsheetId(),
    range: 'Players!A:ZZ',
  });

  // Extract rows and headers from Players sheet
  const rows = playersResponse.data.values || [];
  const headers = rows[0] || [];

  // Get column mappings for Players sheet
  const playersColMap = await getColumnMap(getFriendliesSpreadsheetId(), 'Players');

  // Find which column contains the user name (identifier)
  // Players sheet uses user_name as the primary identifier for referential integrity
  let userNameColumnIndex = playersColMap['user_name'];
  if (userNameColumnIndex === undefined) {
    userNameColumnIndex = playersColMap['name'];
  }
  if (userNameColumnIndex === undefined) {
    userNameColumnIndex = 0; // Fallback to first column
  }

  // Find which column in Players sheet corresponds to this game
  // Game columns have the tab_name as their header
  let gameColumnIndex = -1;
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] === tabName) {
      gameColumnIndex = i;
      break;
    }
  }

  // Throw error if game column not found in Players sheet
  if (gameColumnIndex === -1) {
    throw new Error(`Game column not found: ${tabName}`);
  }

  // Build list of players who entered this game
  // Store userName for referential integrity (UI will look up full names for display)
  // Include players with status 'E' (self-entered) or 'M' (manually added)
  // If playerFilter is provided, only include players in that list (used for paired game allocation)
  const playerFilterSet = playerFilter ? new Set(playerFilter.map(p => p.toLowerCase())) : null;
  const enteredPlayers: string[] = [];

  // Loop through all player rows (skip header at index 0)
  for (let i = 1; i < rows.length; i++) {
    const status = rows[i][gameColumnIndex];
    // Check if this player's status for this game is 'E' or 'M'
    if (status === 'E' || status === 'M') {
      // Get the player's userName from the Players sheet
      const userName = rows[i][userNameColumnIndex];

      // Only add if userName exists (skip empty rows)
      if (userName) {
        // If filtering, only include players in the filter list
        if (playerFilterSet && !playerFilterSet.has(userName.toLowerCase())) {
          continue;
        }
        enteredPlayers.push(userName);
      }
    }
  }

  // If the sheet already existed, exclude players who are already in it (avoid duplicates)
  // This handles the re-open scenario: game set back to Upcoming then opened again
  if (gameSheetExists && enteredPlayers.length > 0) {
    try {
      const existingSheetResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: getFriendliesSpreadsheetId(),
        range: `'${tabName}'!A2:A`,
      });
      const existingRows = existingSheetResponse.data.values || [];
      const existingUserNames = new Set(existingRows.map((r: any[]) => (r[0] || '').toLowerCase()));
      // Keep only players NOT already in the sheet
      const newPlayers = enteredPlayers.filter(u => !existingUserNames.has(u.toLowerCase()));
      enteredPlayers.length = 0;
      enteredPlayers.push(...newPlayers);
    } catch {
      // If we can't read the sheet, proceed with all entered players (may create duplicates but better than failing)
    }
  }

  // Add entered players to the game sheet with their stats (if any entered)
  if (enteredPlayers.length > 0) {
    // Get column map for the newly created game sheet
    const gameSheetColMap = await getColumnMap(getFriendliesSpreadsheetId(), tabName);

    // Get column indices for the game sheet
    const nameColIndex = gameSheetColMap['name'] ?? gameSheetColMap['user_name'] ?? 0;
    const nameDownColIndex = gameSheetColMap['name_down'];
    const pickedColIndex = gameSheetColMap['picked'];
    const percentPlayedColIndex = gameSheetColMap['percent_played'];
    const driverBarColIndex = gameSheetColMap['driver_bar'];
    const selectedColIndex = gameSheetColMap['selected'];

    // Fetch Members sheet for driver/bar lookups
    const membersSpreadsheetId = getMembersSpreadsheetId();
    const membersColMap = await getColumnMap(membersSpreadsheetId, 'Members');
    const membersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: membersSpreadsheetId,
      range: 'Members!A:ZZ',
    });
    const membersRows = membersResponse.data.values || [];

    // Sort players alphabetically for easier captain selection
    const sortedPlayers = enteredPlayers.sort();

    // Build batch updates for each player with their stats
    const batchUpdates: { range: string; values: (string | number)[][] }[] = [];
    let currentRow = 2; // Start at row 2 (row 1 is header)

    for (const userName of sortedPlayers) {
      try {
        // Get player stats from Players sheet
        const stats = getPlayerStatsFromCache(userName, rows, playersColMap, headers, tabName);
        const driverBar = getDriverBarInfoFromCache(userName, membersRows, membersColMap);

        // Add player name
        const nameCol = getColumnLetter(nameColIndex);
        batchUpdates.push({
          range: `'${tabName}'!${nameCol}${currentRow}`,
          values: [[userName]],
        });

        // Add stats if columns exist
        if (nameDownColIndex !== undefined) {
          const col = getColumnLetter(nameDownColIndex);
          batchUpdates.push({
            range: `'${tabName}'!${col}${currentRow}`,
            values: [[stats.nameDown]],
          });
        }

        if (pickedColIndex !== undefined) {
          const col = getColumnLetter(pickedColIndex);
          batchUpdates.push({
            range: `'${tabName}'!${col}${currentRow}`,
            values: [[stats.picked]],
          });
        }

        if (percentPlayedColIndex !== undefined) {
          const col = getColumnLetter(percentPlayedColIndex);
          // Write percentPlayed as decimal (0-1) for percentage-formatted cells
          // Normalize: if value > 1, it's already a percentage (64 -> 0.64)
          const percentPlayedDecimal = stats.percentPlayed > 1
            ? stats.percentPlayed / 100
            : stats.percentPlayed;
          batchUpdates.push({
            range: `'${tabName}'!${col}${currentRow}`,
            values: [[percentPlayedDecimal]],
          });
        }

        if (driverBarColIndex !== undefined) {
          const col = getColumnLetter(driverBarColIndex);
          batchUpdates.push({
            range: `'${tabName}'!${col}${currentRow}`,
            values: [[driverBar.code]],
          });
        }

        // Set all players to Reserve ('R') by default when game is opened
        // Captain then promotes players to Playing ('Y') or Reserve Team ('T')
        if (selectedColIndex !== undefined) {
          const col = getColumnLetter(selectedColIndex);
          batchUpdates.push({
            range: `'${tabName}'!${col}${currentRow}`,
            values: [['R']],
          });
        }

        currentRow++;
      } catch (statsError) {
        console.error(`[createGameSheet] Error getting stats for ${userName}:`, statsError);
        // Still add the player name even if stats fail
        const nameCol = getColumnLetter(nameColIndex);
        batchUpdates.push({
          range: `'${tabName}'!${nameCol}${currentRow}`,
          values: [[userName]],
        });
        currentRow++;
      }
    }

    // Execute batch update to add all players with stats
    if (batchUpdates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: getFriendliesSpreadsheetId(),
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: batchUpdates,
        },
      });
    }
  }

  // Update the entered count in Games sheet to reflect how many players entered
  await updateGameCounts(tabName, { entered: enteredPlayers.length });

  // Return count of players added to game sheet
  return { enteredCount: enteredPlayers.length };
}

/**
 * Add a single player to an existing game sheet.
 * Called when a player enters an open game (Selected='R') or when a captain
 * adds a player via the Add Players button (Selected='R').
 * Skips silently if the game sheet does not exist or the player is already in it.
 */
export async function addPlayerToGameSheet(tabName: string, userName: string, selected: string = 'R', carNumber?: string): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  // Confirm the game sheet exists
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetExists = spreadsheet.data.sheets?.some(
    s => s.properties?.title === tabName
  );
  if (!sheetExists) return; // Sheet not created yet — skip

  // Get column map for the game sheet
  const gameSheetColMap = await getColumnMap(spreadsheetId, tabName);
  const nameColIndex = gameSheetColMap['name'] ?? gameSheetColMap['user_name'] ?? 0;
  const nameDownColIndex = gameSheetColMap['name_down'];
  const pickedColIndex = gameSheetColMap['picked'];
  const percentPlayedColIndex = gameSheetColMap['percent_played'];
  const driverBarColIndex = gameSheetColMap['driver_bar'];
  const selectedColIndex = gameSheetColMap['selected'];

  // Read existing player names to check for duplicates and find next empty row
  const existingResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:A`,
  });
  const existingRows = existingResponse.data.values || [];

  // Check if player is already in the sheet
  const alreadyIn = existingRows.some((r: any[]) => (r[0] || '').toLowerCase() === userName.toLowerCase());
  if (alreadyIn) return;

  // Next empty row = header (1) + existing players + 1
  const nextRow = 2 + existingRows.length;

  // Read Players and Members sheets for stats
  const playersColMap = await getColumnMap(spreadsheetId, 'Players');
  const playersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!A:ZZ',
  });
  const playersRows = playersResponse.data.values || [];
  const playersHeaders = playersRows[0] || [];

  const membersSpreadsheetId = getMembersSpreadsheetId();
  const membersColMap = await getColumnMap(membersSpreadsheetId, 'Members');
  const membersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: membersSpreadsheetId,
    range: 'Members!A:ZZ',
  });
  const membersRows = membersResponse.data.values || [];

  const stats = getPlayerStatsFromCache(userName, playersRows, playersColMap, playersHeaders, tabName);
  const driverBar = getDriverBarInfoFromCache(userName, membersRows, membersColMap);

  const batchUpdates: { range: string; values: (string | number)[][] }[] = [];

  // Player name
  batchUpdates.push({
    range: `'${tabName}'!${getColumnLetter(nameColIndex)}${nextRow}`,
    values: [[userName]],
  });

  if (nameDownColIndex !== undefined) {
    batchUpdates.push({
      range: `'${tabName}'!${getColumnLetter(nameDownColIndex)}${nextRow}`,
      values: [[stats.nameDown]],
    });
  }

  if (pickedColIndex !== undefined) {
    batchUpdates.push({
      range: `'${tabName}'!${getColumnLetter(pickedColIndex)}${nextRow}`,
      values: [[stats.picked]],
    });
  }

  if (percentPlayedColIndex !== undefined) {
    const pct = stats.percentPlayed > 1 ? stats.percentPlayed / 100 : stats.percentPlayed;
    batchUpdates.push({
      range: `'${tabName}'!${getColumnLetter(percentPlayedColIndex)}${nextRow}`,
      values: [[pct]],
    });
  }

  if (driverBarColIndex !== undefined) {
    batchUpdates.push({
      range: `'${tabName}'!${getColumnLetter(driverBarColIndex)}${nextRow}`,
      values: [[driverBar.code]],
    });
  }

  if (selectedColIndex !== undefined) {
    batchUpdates.push({
      range: `'${tabName}'!${getColumnLetter(selectedColIndex)}${nextRow}`,
      values: [[selected]],
    });
  }

  // Set car number if provided (e.g. 'O' for own transport)
  const carNumberColIndex = gameSheetColMap['car_number'];
  if (carNumber !== undefined && carNumberColIndex !== undefined) {
    batchUpdates.push({
      range: `'${tabName}'!${getColumnLetter(carNumberColIndex)}${nextRow}`,
      values: [[carNumber]],
    });
  }

  if (batchUpdates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: batchUpdates },
    });
  }
}

/**
 * Remove a player's row from a game sheet.
 * Called when a player removes their own entry from an open game, or when
 * a captain deletes a player via the Add Players panel.
 * Clears the entire row so the sheet stays tidy (no gaps in captain's view).
 */
export async function removePlayerFromGameSheet(tabName: string, userName: string): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  // Confirm the game sheet exists
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetDef = spreadsheet.data.sheets?.find(s => s.properties?.title === tabName);
  if (!sheetDef) return; // Sheet doesn't exist — nothing to remove

  // Read the name column (column A from row 2) to find the player's row
  const colMap = await getColumnMap(spreadsheetId, tabName);
  const nameColIndex = colMap['name'] ?? colMap['user_name'] ?? 0;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:ZZ`,
  });
  const rows = response.data.values || [];

  // Find the player's row (1-indexed: row 2 = rows[0])
  let playerRowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][nameColIndex] || '').toLowerCase() === userName.toLowerCase()) {
      playerRowIndex = i + 2; // +2 because data starts at row 2
      break;
    }
  }

  if (playerRowIndex === -1) return; // Player not in sheet — nothing to do

  const sheetId = sheetDef.properties?.sheetId;
  if (sheetId === undefined) return;

  // Delete the row entirely (shifts rows up, no gap)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: playerRowIndex - 1, // 0-indexed
            endIndex: playerRowIndex,       // exclusive
          },
        },
      }],
    },
  });
}

/**
 * Get all players from a game sheet for captain team selection
 * Returns detailed player information including stats, selection status, team assignments, and game history
 * Used by the team selection page to display all entered players and their details
 */
export async function getGameSheet(tabName: string): Promise<GameSheetPlayer[]> {
  // Get Friendlies spreadsheet ID from environment
  const spreadsheetId = getFriendliesSpreadsheetId();

  // Get column mappings for this specific game sheet (cached)
  const colMap = await getColumnMap(spreadsheetId, tabName);

  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Fetch all player data from the game sheet (skip header row 1)
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:ZZ`,
  });

  // Extract rows from response (empty array if no data)
  const rows = response.data.values || [];

  // Fetch Players sheet once for game history lookups (performance optimization)
  // We read it once and cache it, rather than reading it for each player
  const playersColMap = await getColumnMap(spreadsheetId, 'Players');

  const playersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!A:ZZ',
  });

  // Extract Players sheet data for game history lookups
  const playersRows = playersResponse.data.values || [];
  const playersHeaders = playersRows[0] || [];

  // Fetch Members sheet to look up full names for display
  const membersSpreadsheetId = getMembersSpreadsheetId();
  const membersColMap = await getColumnMap(membersSpreadsheetId, 'Members');
  const membersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: membersSpreadsheetId,
    range: 'Members!A:ZZ',
  });
  const membersRows = membersResponse.data.values || [];

  // Build lookup maps: userName -> fullName and userName -> lastName
  const fullNameLookup: Record<string, string> = {};
  const lastNameLookup: Record<string, string> = {};
  const memberUserNameCol = membersColMap['user_name'];
  const memberFullNameCol = membersColMap['full_name'] ?? membersColMap['full_known_as'] ?? membersColMap['name'];
  const memberLastNameCol = membersColMap['last_name'] ?? membersColMap['surname'];

  if (memberUserNameCol !== undefined && memberFullNameCol !== undefined) {
    for (let j = 1; j < membersRows.length; j++) {
      const memberRow = membersRows[j];
      const memberUserName = memberRow[memberUserNameCol];
      const memberFullName = memberRow[memberFullNameCol];
      if (memberUserName) {
        fullNameLookup[memberUserName.toLowerCase()] = memberFullName || memberUserName;
        if (memberLastNameCol !== undefined) {
          lastNameLookup[memberUserName.toLowerCase()] = memberRow[memberLastNameCol] || '';
        }
      }
    }
  }

  // Helper function to get a string value from a row by field name
  // Returns null if column doesn't exist or cell is empty
  const get = (row: any[], field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || null) : null;
  };

  // Helper function to get an integer value from a row by field name
  // Returns 0 if column doesn't exist or cell is empty
  const getInt = (row: any[], field: string): number => {
    const val = get(row, field);
    return val ? parseInt(val) : 0;
  };

  // Helper function to get a float value from a row by field name
  // Returns 0 if column doesn't exist or cell is empty
  const getFloat = (row: any[], field: string): number => {
    const val = get(row, field);
    return val ? parseFloat(val) : 0;
  };

  // Build array of GameSheetPlayer objects from sheet rows
  const players: GameSheetPlayer[] = [];

  // Loop through all player rows
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Calculate row number in sheet (row 1 is header, data starts at row 2)
    const rowNumber = i + 2;

    // Extract player basic information
    // Try 'user_name' first (if column renamed), then 'name' as fallback
    const name = get(row, 'user_name') || get(row, 'name') || '';  // Player userName (for referential integrity)

    // Skip blank rows (no username) — they can appear as trailing rows in the sheet
    // and must not be included as players or written back to during selection saves.
    if (!name) continue;

    // Look up full name and surname from Members sheet for UI display / sorting
    const fullName = name ? (fullNameLookup[name.toLowerCase()] || name) : '';
    const lastName = name ? (lastNameLookup[name.toLowerCase()] || '') : '';
    const nameDown = getInt(row, 'name_down');        // Times player put name down
    const picked = getInt(row, 'picked');             // Times player was picked
    const percentPlayed = getFloat(row, 'percent_played'); // % of games played vs name down
    const driverBar = get(row, 'driver_bar') || '';   // D/B indicator from stats

    // Extract selection status
    // Y = Selected to play, R = Reserve, T = Reserve Team, '' = Not selected
    const selected = (get(row, 'selected') || '') as '' | 'Y' | 'R' | 'T';

    // Extract team assignment
    const teamText = get(row, 'team');

    // Parse team number to integer, or null if not assigned
    let team = null;
    if (teamText) {
      team = parseInt(teamText);
    }

    // Extract position assignment
    // S = Skip, 1 = Lead, 2 = Two, 3 = Three, '' = Not assigned
    const position = (get(row, 'position') || '') as '' | 'S' | '1' | '2' | '3';

    // Extract driving information
    const driving = get(row, 'driving') || '';        // Y = Driver, '' = Neither
    const carNumber = get(row, 'car_number') || '';   // Car number for drivers

    // Extract status and captain designation
    const status = (get(row, 'status') || '') as '' | 'Y' | 'W'; // Y = Confirmed, W = Withdrawn
    const captain = get(row, 'captain') || '';        // Y = Captain of the day, '' = Not captain

    // Get last 6 games history and futureEntered for this player from Players sheet
    // GameSheetPlayer uses last8Games property name for compatibility, but holds 6 games
    let last8Games: string[] = [];
    let futureEntered = 0;

    try {
      // Use cached Players sheet data to get stats (avoids re-reading sheet for each player)
      // The tabName parameter excludes the current game from history
      const stats = getPlayerStatsFromCache(name, playersRows, playersColMap, playersHeaders, tabName);
      last8Games = stats.last6Games;  // Use last6Games from PlayerStats type
      futureEntered = stats.futureEntered;
    } catch (error) {
      // Player not found in Players sheet (might be offline player added manually)
      // Skip game history for this player
    }

    // Build complete GameSheetPlayer object
    const player: GameSheetPlayer = {
      rowNumber,
      name,        // userName for referential integrity
      fullName,    // Full name for UI display
      lastName,    // Surname for sorting
      nameDown,
      picked,
      percentPlayed,
      futureEntered,
      driverBar,
      selected,
      team,
      position,
      driving,
      carNumber,
      status,
      captain,
      last8Games,  // Property name in GameSheetPlayer is last8Games
    };

    // Add player to array
    players.push(player);
  }

  // Return array of all players in this game sheet
  return players;
}

/**
 * Update player selection data in a game sheet (individual game tab)
 * Used by captains to set team selections, positions, driving assignments, and status
 * Each player update can include any combination of fields - only provided fields are updated
 * Uses batch update for efficiency when updating multiple players
 * @param tabName The game's tab name (sheet to update)
 * @param players Array of player updates with rowNumber and any fields to update
 */
export async function updateGameSheet(
  tabName: string,
  players: Array<{
    rowNumber: number;    // Row number in game sheet (required)
    selected?: string;    // Selection status: Y=Playing, R=Reserve, T=Reserve Team
    team?: number | null; // Team number (1-4 typically)
    position?: string;    // Position: S=Skip, 1=Lead, 2=Two, 3=Three
    driving?: string;     // Driving assignment: D=Driver, B=Bar
    carNumber?: string;   // Car number for drivers
    status?: string;      // Player status: W=Withdrawn
  }>
): Promise<void> {
  // Get spreadsheet ID and column mapping for this game's sheet
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, tabName);
  const sheets = getSheetsClient();

  // Build array of all cell updates (only fields that were provided)
  const updates: any[] = [];

  // Loop through each player update
  for (const player of players) {
    // Add selected status update if provided
    if (player.selected !== undefined) {
      updates.push({
        range: `'${tabName}'!${getColumnLetter(colMap['selected'])}${player.rowNumber}`,
        values: [[player.selected]],
      });
    }

    // Add team number update if provided (convert null to empty string)
    if (player.team !== undefined) {
      updates.push({
        range: `'${tabName}'!${getColumnLetter(colMap['team'])}${player.rowNumber}`,
        values: [[player.team || '']],
      });
    }

    // Add position update if provided
    if (player.position !== undefined) {
      updates.push({
        range: `'${tabName}'!${getColumnLetter(colMap['position'])}${player.rowNumber}`,
        values: [[player.position]],
      });
    }

    // Add driving assignment update if provided
    if (player.driving !== undefined) {
      updates.push({
        range: `'${tabName}'!${getColumnLetter(colMap['driving'])}${player.rowNumber}`,
        values: [[player.driving]],
      });
    }

    // Add car number update if provided
    if (player.carNumber !== undefined) {
      updates.push({
        range: `'${tabName}'!${getColumnLetter(colMap['car_number'])}${player.rowNumber}`,
        values: [[player.carNumber]],
      });
    }

    // Add player status update if provided (e.g., withdrawn)
    if (player.status !== undefined) {
      updates.push({
        range: `'${tabName}'!${getColumnLetter(colMap['status'])}${player.rowNumber}`,
        values: [[player.status]],
      });
    }

  }

  // Only make API call if there are updates to perform
  if (updates.length > 0) {
    // Use batch update to update all cells in a single API call
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getFriendliesSpreadsheetId(),
      requestBody: {
        data: updates,                    // Array of cell updates
        valueInputOption: 'USER_ENTERED', // Parse values as if user typed them
      },
    });
  }
}

/**
 * Update player statistics columns in a game sheet
 * Populates name_down, picked, percent_played, and driver_bar columns for all players in the game
 * Reads data from Players sheet (for stats) and Members sheet (for driver/bar status)
 * Also adds cell notes with last 6 games history to help captains make selection decisions
 * Uses batch update for efficiency when updating multiple cells
 * Called by captains before making team selections to see current player stats
 * Also adds any players from the Players sheet who have entered but aren't in the game sheet yet
 * @param tabName The game's tab name (sheet to update)
 * @returns Number of players in the game sheet after update
 */
export async function updateGameSheetStats(tabName: string): Promise<number> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  let colMap = await getColumnMap(spreadsheetId, tabName);
  const sheets = getSheetsClient();

  // Get all players currently in game sheet
  let players = await getGameSheet(tabName);
  const existingPlayerNames = new Set(players.map(p => p.name.toLowerCase()));

  // Read Players sheet once for all lookups
  const playersColMap = await getColumnMap(spreadsheetId, 'Players');
  const playersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!A:ZZ',
  });
  const playersRows = playersResponse.data.values || [];
  const playersHeaders = playersRows[0] || [];

  // Find game column in Players sheet to check who has entered
  const gameColumnIndex = playersHeaders.findIndex((h: string) => h === tabName);
  const userNameColIndex = playersColMap['user_name'] ?? 0;

  // Find players who have entered but aren't in the game sheet yet
  // Only add players with 'M' (manually added) status - these are newly added players
  // Don't add E (self-entered) as they should have been added when game was closed
  // Don't add D, P, R, T as they've already been processed
  const playersToAdd: string[] = [];
  if (gameColumnIndex !== -1) {
    for (let i = 1; i < playersRows.length; i++) {
      const row = playersRows[i];
      const status = (row[gameColumnIndex] || '').toString().toUpperCase();
      const userName = row[userNameColIndex];

      // Only add players with 'M' status who aren't already in game sheet
      // 'M' means manually added by captain and not yet in game sheet
      if (userName && status === 'M') {
        if (!existingPlayerNames.has(userName.toLowerCase())) {
          playersToAdd.push(userName);
        }
      }
    }
  }

  // Track newly added player names (lowercase) to only update stats for these players
  const newlyAddedPlayers = new Set(playersToAdd.map(name => name.toLowerCase()));

  // Fetch Members sheet ONCE for all driver/bar lookups (used by both add and update sections)
  const membersSpreadsheetId = getMembersSpreadsheetId();
  const membersColMap = await getColumnMap(membersSpreadsheetId, 'Members');
  const membersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: membersSpreadsheetId,
    range: 'Members!A:ZZ',
  });
  const membersRows = membersResponse.data.values || [];

  // Add missing players to the game sheet
  if (playersToAdd.length > 0) {
    // Get column letters for adding players (name column may be 'user_name' or 'name')
    const nameColIndex = colMap['user_name'] ?? colMap['name'];
    const nameDownColIndex = colMap['name_down'];
    const driverBarColIndex = colMap['driver_bar'];

    if (nameColIndex !== undefined && nameDownColIndex !== undefined && driverBarColIndex !== undefined) {
      const nameCol = getColumnLetter(nameColIndex);
      const nameDownCol = getColumnLetter(nameDownColIndex);
      const driverBarCol = getColumnLetter(driverBarColIndex);

      // Calculate next available row
      let nextRow = players.length > 0
        ? players[players.length - 1].rowNumber + 1
        : 2;

      const addUpdates: { range: string; values: (string | number)[][] }[] = [];

      for (const userName of playersToAdd) {
        // Get stats from cached Players sheet data
        const stats = getPlayerStatsFromCache(userName, playersRows, playersColMap, playersHeaders, tabName);
        // Get driver/bar info from cached Members data
        const driverBar = getDriverBarInfoFromCache(userName, membersRows, membersColMap);

        // Add player name
        addUpdates.push({
          range: `'${tabName}'!${nameCol}${nextRow}`,
          values: [[userName]],
        });

        // Add stats (name_down through driver_bar)
        // Write percentPlayed as decimal (0-1) for percentage-formatted cells
        // Normalize: if value > 1, it's already a percentage (64 -> 0.64)
        const percentPlayedDecimal = stats.percentPlayed > 1
          ? stats.percentPlayed / 100
          : stats.percentPlayed;
        addUpdates.push({
          range: `'${tabName}'!${nameDownCol}${nextRow}:${driverBarCol}${nextRow}`,
          values: [[stats.nameDown, stats.picked, percentPlayedDecimal, driverBar.code]],
        });

        nextRow++;
      }

      // Execute batch update to add new players
      if (addUpdates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: addUpdates,
          },
        });
      }

      // Refresh players list and column map after adding
      players = await getGameSheet(tabName);
      clearColumnMapCacheForSheet(spreadsheetId, tabName);
      colMap = await getColumnMap(spreadsheetId, tabName);
    }
  }

  const updates: any[] = [];
  const noteUpdates: any[] = [];

  for (let i = 0; i < players.length; i++) {
    const player = players[i];

    try {
      // Get stats for this player from cached Players sheet
      const stats = getPlayerStatsFromCache(player.name, playersRows, playersColMap, playersHeaders, tabName);
      const driverBar = getDriverBarInfoFromCache(player.name, membersRows, membersColMap);

      // Check if required columns exist in the game sheet
      const nameDownIdx = colMap['name_down'];
      const pickedIdx = colMap['picked'];
      const percentPlayedIdx = colMap['percent_played'];
      const driverBarIdx = colMap['driver_bar'];

      if (nameDownIdx === undefined) {
        console.warn(`Column 'name_down' not found in ${tabName}`);
      }
      if (pickedIdx === undefined) {
        console.warn(`Column 'picked' not found in ${tabName}`);
      }
      if (percentPlayedIdx === undefined) {
        console.warn(`Column 'percent_played' not found in ${tabName}`);
      }
      if (driverBarIdx === undefined) {
        console.warn(`Column 'driver_bar' not found in ${tabName}`);
      }

      // Add individual updates for each column that exists
      if (nameDownIdx !== undefined) {
        const nameDownCol = getColumnLetter(nameDownIdx);
        updates.push({
          range: `'${tabName}'!${nameDownCol}${player.rowNumber}`,
          values: [[stats.nameDown]],
        });
      }

      if (pickedIdx !== undefined) {
        const pickedCol = getColumnLetter(pickedIdx);
        updates.push({
          range: `'${tabName}'!${pickedCol}${player.rowNumber}`,
          values: [[stats.picked]],
        });
      }

      if (percentPlayedIdx !== undefined) {
        const percentPlayedCol = getColumnLetter(percentPlayedIdx);
        // Write percentPlayed as decimal (0-1) for percentage-formatted cells
        // Normalize: if value > 1, it's already a percentage (64 -> 0.64)
        const percentPlayedDecimal = stats.percentPlayed > 1
          ? stats.percentPlayed / 100
          : stats.percentPlayed;
        updates.push({
          range: `'${tabName}'!${percentPlayedCol}${player.rowNumber}`,
          values: [[percentPlayedDecimal]],
        });
      }

      if (driverBarIdx !== undefined) {
        const driverBarCol = getColumnLetter(driverBarIdx);
        updates.push({
          range: `'${tabName}'!${driverBarCol}${player.rowNumber}`,
          values: [[driverBar.code]],
        });
      }

      // Add note with last 6 games to the Name cell
      if (stats.last6Games.length > 0) {
        const nameIdx = colMap['name'];
        if (nameIdx !== undefined) {
          const noteText = stats.last6Games.join('\n');
          noteUpdates.push({
            player: player.name,
            rowNumber: player.rowNumber,
            colIndex: nameIdx,
            note: noteText
          });
        }
      }
    } catch (error) {
      console.error(`updateGameSheetStats: Error processing ${player.name}:`, error);
      // Continue with other players even if one fails
    }
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updates,
        valueInputOption: 'USER_ENTERED',
      },
    });
  }

  // Apply notes with game history
  if (noteUpdates.length > 0) {

    // Find the sheet ID for this tab
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    let sheetId = 0;
    if (spreadsheet.data.sheets) {
      for (const sheet of spreadsheet.data.sheets) {
        if (sheet.properties && sheet.properties.title === tabName) {
          sheetId = sheet.properties.sheetId || 0;
          break;
        }
      }
    }

    const requests = noteUpdates.map(noteUpdate => ({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: noteUpdate.rowNumber - 1,
          endRowIndex: noteUpdate.rowNumber,
          startColumnIndex: noteUpdate.colIndex,
          endColumnIndex: noteUpdate.colIndex + 1,
        },
        rows: [{
          values: [{
            note: noteUpdate.note,
          }],
        }],
        fields: 'note',
      },
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  return newlyAddedPlayers.size;
}

// Helper function to get player stats from cached Players sheet data
// Avoids re-reading the Players sheet for every player (performance optimization)
// Returns stats including name_down, picked, percent_played, and last 8 games played
function getPlayerStatsFromCache(
  userName: string,
  playersRows: any[][],
  colMap: { [key: string]: number },
  headers: any[],
  currentGameTabName?: string
): PlayerStats {
  // Find user_name column index, default to first column if not found
  let userNameCol = colMap['user_name'];
  if (userNameCol === undefined) {
    userNameCol = 0;
  }

  // Search for this user's row in the Players sheet
  let userRowIndex = -1;

  // Loop through all data rows (skip header at index 0)
  for (let i = 1; i < playersRows.length; i++) {
    const playerUserName = playersRows[i][userNameCol];

    // Try exact match first
    if (playerUserName === userName) {
      userRowIndex = i;
      break;
    }

    // Try case-insensitive and trimmed comparison as fallback
    if (playerUserName && playerUserName.toString().trim().toLowerCase() === userName.trim().toLowerCase()) {
      userRowIndex = i;
      break;
    }
  }

  // Throw error if user not found in Players sheet
  if (userRowIndex === -1) {
    console.error(`User not found in Players sheet: ${userName}`);
    console.error(`  Looking for user_name at column index: ${userNameCol}`);
    console.error(`  First few users in Players sheet:`, playersRows.slice(1, 6).map(row => row[userNameCol]));
    throw new Error(`User not found in Players sheet: ${userName}`);
  }

  // Get the data row for this user
  const userRow = playersRows[userRowIndex];

  // Helper function to get a field value from this user's row
  const get = (field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (userRow[index] || null) : null;
  };

  // Helper function to get an integer field value (returns 0 if missing)
  const getInt = (field: string): number => {
    const val = get(field);
    return val ? parseInt(val) : 0;
  };

  // Helper function to get a float field value (returns 0 if missing)
  const getFloat = (field: string): number => {
    const val = get(field);
    return val ? parseFloat(val) : 0;
  };

  // Extract name_down stat (how many times player has entered games)
  const nameDown = getInt('name_down');

  // Extract picked stat (how many times player was selected to play)
  const picked = getInt('picked');

  // Extract withdrawn stat (how many times player withdrew from games)
  const withdrawn = getInt('withdrawn');

  // Extract cancelled stat (how many games were cancelled)
  const cancelled = getInt('cancelled');

  // Parse percent_played - handle multiple formats: "64%", "64", "0.64", or numeric 1/0.64
  const percentPlayedVal = get('percent_played');
  let percentPlayed = 0;

  // Process the value if it exists
  if (percentPlayedVal !== null && percentPlayedVal !== undefined && percentPlayedVal !== '') {
    // Convert to string first to handle both string and number values from Google Sheets
    const valStr = String(percentPlayedVal).replace('%', '').trim();
    const num = parseFloat(valStr);

    // Check if valid number
    if (!isNaN(num)) {
      // Normalize to decimal (0-1 range):
      // - Values > 1 are percentages (64 -> 0.64, 100 -> 1.0)
      // - Values <= 1 are already decimal (0.64 stays 0.64, 1 stays 1.0)
      percentPlayed = num > 1 ? num / 100 : num;
    }
  }

  // Normalized names of fixed stat columns — used to skip non-game columns in both scan loops.
  // We normalize the raw header the same way getColumnMap does (lowercase, trim, spaces/slashes → _)
  // and check against this set, so we never accidentally read a stat cell as a game result.
  const fixedFieldNamesSet = new Set([
    'user_name', 'name', 'full_name',
    'name_down', 'picked', 'percent_played', '%_played_vs_name_down',
    'future_entered', 'withdrawn', 'cancelled',
  ]);
  const isFixedHeader = (h: any): boolean => {
    if (!h) return true; // blank headers are never game columns
    const normalized = String(h).toLowerCase().trim().replace(/\s+/g, '_').replace(/\//g, '_');
    return fixedFieldNamesSet.has(normalized);
  };

  // futureEntered: count ALL open-game entries (E/M) across every game column.
  // Must be a separate pass — the last6Games loop stops early and would undercount
  // if there are 6+ future E entries before any historical P/R entries are reached.
  let futureEntered = 0;
  for (let i = 0; i < headers.length; i++) {
    if (isFixedHeader(headers[i])) continue;
    if (currentGameTabName && headers[i] === currentGameTabName) continue;
    const v = userRow[i] ? String(userRow[i]).toUpperCase() : '';
    if (v === 'E' || v === 'M') futureEntered++;
  }

  // Collect last 6 games the player participated in.
  // Iterate backward (newest → oldest), skip the current game.
  const last6Games: string[] = [];

  // Valid status codes for last 6 games display.
  // E and M (open-game entries) are intentionally excluded — they're future games
  // with no outcome yet and would push actual history (P/R/D etc.) out of view.
  const validStatuses = [
    'D', 'P', 'R', 'T', 'A', 'C',
    'DW', 'PW', 'RW', 'TW', 'AW'
  ];

  for (let i = headers.length - 1; i >= 0 && last6Games.length < 6; i--) {
    const header = headers[i];
    if (isFixedHeader(header)) continue;
    if (currentGameTabName && header === currentGameTabName) continue;

    const cellValue = userRow[i];
    const normalizedValue = cellValue ? String(cellValue).toUpperCase() : '';
    if (normalizedValue && validStatuses.includes(normalizedValue)) {
      last6Games.push(`${header}    ${normalizedValue}`);
    }
  }

  // Return all stats for this player
  return {
    nameDown,
    picked,
    percentPlayed,
    futureEntered,
    withdrawn,
    cancelled,
    last6Games,
  };
}

// Helper function to get driver/bar info from cached data
function getDriverBarInfoFromCache(
  userName: string,
  membersRows: any[][],
  colMap: { [key: string]: number }
): { code: string; driver: boolean; bar: boolean } {
  // Look up by user_name column in Members sheet (we're passed userName, not fullName)
  const userNameCol = colMap['user_name'];
  if (userNameCol === undefined) {
    console.warn('getDriverBarInfoFromCache: user_name column not found in Members sheet');
    return { code: '-', driver: false, bar: false };
  }

  // Find the row for this user by userName
  let userRowIndex = -1;
  for (let i = 1; i < membersRows.length; i++) {
    const memberUserName = membersRows[i][userNameCol];
    if (!memberUserName) continue;

    // Case-insensitive and trimmed comparison
    if (memberUserName.toString().trim().toLowerCase() === userName.trim().toLowerCase()) {
      userRowIndex = i;
      break;
    }
  }

  if (userRowIndex === -1) {
    // User not in Members sheet - return defaults
    return { code: '-', driver: false, bar: false };
  }

  const userRow = membersRows[userRowIndex];

  const get = (field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (userRow[index] || null) : null;
  };

  const driverValue = get('driving_away_matches');
  const barValue = get('bar_duty');
  const driver = driverValue === 'Yes' || driverValue === 'Y';
  const bar = barValue === 'Yes' || barValue === 'Y';

  let code = '-';
  if (driver && bar) {
    code = 'D/B';
  } else if (driver) {
    code = 'D';
  } else if (bar) {
    code = 'B';
  }

  return { code, driver, bar };
}

// addPlayerToGameSheet is defined earlier in this file (near createGameSheet)

/**
 * Batch add multiple players to a game sheet
 * Adds players to both the individual game sheet (tab) and the Players sheet column
 * More efficient than calling addPlayerToGameSheet multiple times
 * @param tabName The game's tab name
 * @param userNames Array of usernames to add
 * @returns Array of results indicating success/failure for each player
 */
export async function batchAddPlayersToGameSheet(
  tabName: string,
  userNames: string[]
): Promise<{ userName: string; success: boolean; error?: string }[]> {
  if (userNames.length === 0) return [];

  const spreadsheetId = getFriendliesSpreadsheetId();
  let colMap = await getColumnMap(spreadsheetId, tabName);
  const sheets = getSheetsClient();

  // Validate required columns exist (name column may be 'user_name' or 'name')
  const hasNameCol = colMap['user_name'] !== undefined || colMap['name'] !== undefined;
  const requiredCols = ['name_down', 'driver_bar'];
  const missingCols = requiredCols.filter(col => colMap[col] === undefined);
  if (!hasNameCol) {
    missingCols.unshift('user_name/name');
  }

  // If columns are missing, clear cache and retry once (cache might be stale)
  if (missingCols.length > 0) {
    clearColumnMapCacheForSheet(spreadsheetId, tabName);
    colMap = await getColumnMap(spreadsheetId, tabName);

    // Check again after refresh
    const stillMissing = requiredCols.filter(col => colMap[col] === undefined);
    if (stillMissing.length > 0) {
      throw new Error(`Required columns not found in sheet '${tabName}': ${stillMissing.join(', ')}. Available: ${Object.keys(colMap).join(', ')}`);
    }
  }

  // Get current players to find next available row
  const currentPlayers = await getGameSheet(tabName);
  let nextRow = currentPlayers.length > 0
    ? currentPlayers[currentPlayers.length - 1].rowNumber + 1
    : 2;

  // Get column letters for updates (name column may be 'user_name' or 'name')
  const nameCol = getColumnLetter(colMap['user_name'] ?? colMap['name']);
  const nameDownCol = getColumnLetter(colMap['name_down']);
  const driverBarCol = getColumnLetter(colMap['driver_bar']);

  const results: { userName: string; success: boolean; error?: string }[] = [];
  const gameSheetUpdates: { range: string; values: (string | number)[][] }[] = [];
  const playersToAddToPlayersSheet: string[] = [];

  // Process each player
  for (const userName of userNames) {
    try {
      // Check if player already exists in game sheet
      const isDuplicate = currentPlayers.some(
        player => player.name === userName || player.name.toLowerCase() === userName.toLowerCase()
      );

      if (isDuplicate) {
        results.push({ userName, success: false, error: 'Already in game' });
        continue;
      }

      // Get player stats and driver/bar info
      const stats = await getPlayerStats(userName);
      const driverBar = await getDriverBarInfo(userName);
      // Write percentPlayed as decimal (0-1) for percentage-formatted cells
      // Normalize: if value > 1, it's already a percentage (64 -> 0.64)
      const percentPlayedDecimal = stats.percentPlayed > 1
        ? stats.percentPlayed / 100
        : stats.percentPlayed;

      // Add to game sheet batch updates
      gameSheetUpdates.push(
        {
          range: `'${tabName}'!${nameCol}${nextRow}`,
          values: [[userName]],
        },
        {
          range: `'${tabName}'!${nameDownCol}${nextRow}:${driverBarCol}${nextRow}`,
          values: [[stats.nameDown, stats.picked, percentPlayedDecimal, driverBar.code]],
        }
      );

      // Track for Players sheet update
      playersToAddToPlayersSheet.push(userName);
      results.push({ userName, success: true });
      nextRow++;
    } catch (err) {
      results.push({
        userName,
        success: false,
        error: err instanceof Error ? err.message : 'Failed to add player',
      });
    }
  }

  // Execute batch update for game sheet
  if (gameSheetUpdates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: gameSheetUpdates,
      },
    });
  }

  // Update Players sheet for all successfully added players
  if (playersToAddToPlayersSheet.length > 0) {
    await batchUpdatePlayerEntries(tabName,
      playersToAddToPlayersSheet.map(userName => ({ userName, status: 'E' as const }))
    );
  }

  return results;
}

// ============================================================================
// MEMBERS SHEET OPERATIONS
// ============================================================================

/**
 * Get driver and bar duty information for a specific member
 * Reads from Members sheet to check if member can drive or does bar duty
 * Returns boolean flags and a code (D=Driver, B=Bar, DB=Both, ''=Neither)
 * Used to display D/B indicators on game sheets and match cards
 */
export async function getDriverBarInfo(userName: string): Promise<DriverBarInfo> {
  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Fetch all data from Members sheet (up to 1000 rows)
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getMembersSpreadsheetId(),
    range: 'Members!1:1000',
  });

  // Extract rows and headers from response
  const rows = response.data.values || [];
  const headers = rows[0] || [];

  // Find column indices by searching through header row
  // We manually search rather than using getColumnMap to avoid caching issues
  let userNameCol = -1;
  let drivingCol = -1;
  let barCol = -1;

  // Loop through all header cells to find the columns we need
  for (let i = 0; i < headers.length; i++) {
    // Normalize header text (lowercase, replace spaces with underscores)
    const normalized = headers[i].toLowerCase().replace(/\s+/g, '_');

    // Check if this is the user_name column
    if (normalized === 'user_name') {
      userNameCol = i;
    }

    // Check if this is the driving_away_matches column
    if (normalized === 'driving_away_matches') {
      drivingCol = i;
    }

    // Check if this is the bar_duty column
    if (normalized === 'bar_duty') {
      barCol = i;
    }
  }

  // Throw error if user_name column not found (critical for lookups)
  if (userNameCol === -1) {
    throw new Error('user_name column not found in Members sheet');
  }

  // Search for this user's row in the Members sheet
  let userRow = null;

  // Loop through all data rows (skip header at index 0)
  for (let i = 1; i < rows.length; i++) {
    // Check if this row's username matches the requested user
    if (rows[i][userNameCol] === userName) {
      userRow = rows[i];
      break;
    }
  }

  // If user not found, return defaults (not a driver, no bar duty)
  if (!userRow) {
    return { driver: false, bar: false, code: '' };
  }

  // Check if user is willing to drive to away matches
  let driver = false;

  // Only check if driving column exists in sheet
  if (drivingCol !== -1) {
    // Get the driving value from user's row
    const drivingValue = userRow[drivingCol];

    if (drivingValue) {
      // Convert to lowercase for case-insensitive comparison
      const lowerValue = drivingValue.toLowerCase();

      // Accept "Yes" or "Y" as positive responses
      driver = lowerValue === 'yes' || lowerValue === 'y';
    }
  }

  // Check if user does bar duty
  let bar = false;

  // Only check if bar duty column exists in sheet
  if (barCol !== -1) {
    // Get the bar duty value from user's row
    const barValue = userRow[barCol];

    if (barValue) {
      // Convert to lowercase for case-insensitive comparison
      const lowerValue = barValue.toLowerCase();

      // Accept "Yes" or "Y" as positive responses
      bar = lowerValue === 'yes' || lowerValue === 'y';
    }
  }

  // Build display code based on driver and bar status
  // Code appears next to player name on game sheets and match cards
  let code = '';

  if (driver && bar) {
    // Both driver and bar duty
    code = 'DB';
  } else if (driver) {
    // Driver only
    code = 'D';
  } else if (bar) {
    // Bar duty only
    code = 'B';
  }
  // If neither, code remains empty string

  // Return driver/bar information object
  return { driver, bar, code };
}

// ============================================================================
// MATCH DAY CONTACTS OPERATIONS
// ============================================================================

/**
 * Get club details for away games from Match Day Contacts spreadsheet
 * Returns comprehensive club information including contact details, address, driving costs, and links
 * Used to display opponent club information on match cards and game details pages
 * Address is stored in 4 separate fields (address_1 through address_4) plus post code
 */
export async function getClubDetails(clubName: string): Promise<ClubDetails | null> {
  const cached = _clubDetailsCache.get(clubName);
  if (cached && Date.now() - cached.ts < CLUB_DETAILS_CACHE_TTL_MS) {
    return cached.data;
  }

  // Get Match Day Contacts spreadsheet ID from environment
  const spreadsheetId = getMatchDayContactsSpreadsheetId();

  // Get column mappings for clubs sheet (cached)
  const colMap = await getColumnMap(spreadsheetId, 'clubs');

  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Fetch all data from clubs sheet
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'clubs!A:ZZ',
  });

  // Extract rows from response
  const rows = response.data.values || [];

  // Return null if no data in clubs sheet
  if (rows.length === 0) return null;

  // Helper function to get a string value from a row by field name
  const get = (row: any[], field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || null) : null;
  };

  // Search for club by name
  let matchingRow = null;

  // Loop through all data rows (skip header at index 0)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    // Check if this row's club name matches the requested club
    if (get(row, 'club_name') === clubName) {
      matchingRow = row;
      break;
    }
  }

  // Return null if club not found in clubs sheet
  if (!matchingRow) {
    _clubDetailsCache.set(clubName, { data: null, ts: Date.now() });
    return null;
  }

  // Get driving band from sheet (A, B, C, or D) — normalise to uppercase for lookup
  const drivingBand = (get(matchingRow, 'driving_band') || '').trim().toUpperCase();

  // Look up petrol cost from the PetrolBands sheet (falls back to hardcoded values if sheet missing)
  const petrolBands = await getPetrolBands();
  const petrolCost = petrolBands[drivingBand] ?? 0;

  // Extract all club details, cache, and return ClubDetails object
  const result: ClubDetails = {
    // Contact information
    clubName: get(matchingRow, 'club_name') || '',         // Official club name
    clubNumber: get(matchingRow, 'club_number') || '',     // Club phone number
    clubMobile: get(matchingRow, 'club_mobile') || '',     // Club mobile number
    clubEmail: get(matchingRow, 'club_email_address') || get(matchingRow, 'club_email') || '',       // Club email address
    clubEmailNote: get(matchingRow, 'club_email_note') || '', // Notes about email usage
    generalInfo: get(matchingRow, 'general_information') || get(matchingRow, 'general_info') || '',   // General notes about club

    // Driving information
    drivingBand: drivingBand,  // Distance band (A-D)
    petrolCost: petrolCost,    // Calculated reimbursement amount
    miles: get(matchingRow, 'miles') || '',
    travelTime: get(matchingRow, 'travel_time') || '',

    // Address (stored in 4 separate fields for multiline addresses)
    address1: get(matchingRow, 'address_1') || '',  // First line (street number/name)
    address2: get(matchingRow, 'address_2') || '',  // Second line (area/district)
    address3: get(matchingRow, 'address_3') || '',  // Third line (town/city)
    address4: get(matchingRow, 'address_4') || '',  // Fourth line (county)
    postCode: get(matchingRow, 'post_code') || '',  // Post code

    // Location and mapping information
    googleAddress: get(matchingRow, 'google_address') || '',  // Address formatted for Google Maps
    latitude: get(matchingRow, 'latitude') || '',     // GPS latitude coordinate
    longitude: get(matchingRow, 'longitude') || '',   // GPS longitude coordinate

    // External links
    bowlsEnglandUrl: get(matchingRow, 'bowls_england_url') || '',  // Bowls England profile URL
    website: get(matchingRow, 'website') || '',        // Club's official website
    bhWebsite: get(matchingRow, 'bh_website') || '',   // BHBC-specific website link
  };

  _clubDetailsCache.set(clubName, { data: result, ts: Date.now() });
  return result;
}

/**
 * Get club contacts for away games from Match Day Contacts spreadsheet
 * Returns contacts sorted by role priority (Captain first, then Secretary, then others)
 * Used to display match day contact information on match cards
 * Multiple contacts per club are supported (e.g., Men's Captain, Ladies' Captain, Secretary)
 */
export async function getClubContacts(clubName: string): Promise<ClubContact[]> {
  // Get Match Day Contacts spreadsheet ID from environment
  const spreadsheetId = getMatchDayContactsSpreadsheetId();

  // Get column mappings for Contacts sheet (cached)
  const colMap = await getColumnMap(spreadsheetId, 'Contacts');

  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Fetch all contacts from Contacts sheet
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Contacts!A:ZZ',
  });

  // Extract rows from response
  const rows = response.data.values || [];

  // Return empty array if no contacts data
  if (rows.length === 0) return [];

  // Helper function to get a string value from a row by field name
  const get = (row: any[], field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || null) : null;
  };

  // STEP 1: Filter contacts for this specific club
  // Build array of all contacts that belong to this club
  const clubContacts: ClubContact[] = [];

  // Loop through all data rows (skip header at index 0)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    // Get club name for this contact
    const rowClubName = get(row, 'club_name');

    // Skip contacts that don't belong to the requested club
    if (rowClubName !== clubName) {
      continue;
    }

    // Extract all contact information from this row
    const contact: ClubContact = {
      clubName: get(row, 'club_name') || '',    // Club this contact belongs to
      role: get(row, 'role') || '',              // Role (Captain, Secretary, etc.)
      firstName: get(row, 'first_name') || '',   // Contact's first name
      lastName: get(row, 'last_name') || '',     // Contact's last name
      name: get(row, 'name') || '',              // Full name (if provided separately)
      phoneNumber: get(row, 'phone_number') || '', // Landline phone number
      mobileNumber: get(row, 'mobile_number') || '', // Mobile phone number
      notes: get(row, 'notes') || '',            // Additional notes about contact
      email: get(row, 'email') || '',            // Email address
    };

    // Add this contact to our club contacts array
    clubContacts.push(contact);
  }

  // STEP 2: Sort contacts by role priority for logical display order
  // Captains should appear first (most important contact), then Secretaries, then others
  // This makes it easier to find the right contact on match day
  const roleOrder: { [key: string]: number } = {
    'Captain': 1,    // Highest priority (appears first)
    'Secretary': 2,  // Second priority
    // All other roles get priority 99 (appear after Captain and Secretary)
  };

  // Sort the contacts array by role priority
  clubContacts.sort((a, b) => {
    // Get priority order for contact A's role
    let aOrder = roleOrder[a.role];

    // If role not in priority map, assign low priority (99)
    if (aOrder === undefined) {
      aOrder = 99;
    }

    // Get priority order for contact B's role
    let bOrder = roleOrder[b.role];

    // If role not in priority map, assign low priority (99)
    if (bOrder === undefined) {
      bOrder = 99;
    }

    // Sort by priority (lower number = higher priority = appears first)
    return aOrder - bOrder;
  });

  // Return sorted contacts array
  return clubContacts;
}

// ============================================================================
// TEA ROTA OPERATIONS
// ============================================================================

/**
 * Get all home games with tea rota assignments
 * Returns games sorted by date (upcoming first)
 * Used for the tea rota list page
 */
export async function getTeaRotaList(options?: { includeCancelled?: boolean }): Promise<TeaRotaEntry[]> {
  // Get Friendlies spreadsheet ID from environment
  const spreadsheetId = getFriendliesSpreadsheetId();

  // Get column mappings for Games sheet (cached)
  const colMap = await getColumnMap(spreadsheetId, 'Games');

  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Fetch all data rows from Games sheet (skip header row 1)
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Games!A2:ZZ',
  });

  // Extract rows from response (empty array if no data)
  const rows = response.data.values || [];

  // Helper function to get a string value from a row by field name
  const get = (row: any[], field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || null) : null;
  };

  // Day names for display date formatting
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Build array of tea rota entries for home games only
  const teaRotaEntries: TeaRotaEntry[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // Row 1 is header, data starts at row 2

    // Get home/away status - only include home games
    // Try multiple possible column names: "Home/Away" -> "home_away", "H/A" -> "h_a"
    const homeAwayValue = get(row, 'home_away') || get(row, 'h_a') || 'H';
    if (homeAwayValue.trim().toUpperCase() !== 'H') continue;

    // Get game status - skip cancelled games unless caller explicitly wants them
    const status = get(row, 'status') || '';
    if (status === 'C' && !options?.includeCancelled) continue;

    // Only include Friendly games (tea rota doesn't apply to league/events)
    // Rows with no type set are treated as friendlies for backward compatibility.
    const gameType = get(row, 'type') || '';
    if (gameType && gameType !== 'Friendly') continue;

    // Extract game data - normalize date to DD/MM/YYYY immediately
    const date = normalizeToUKDate(get(row, 'date') || '');
    const time = get(row, 'time') || '';
    const clubName = get(row, 'club_name') || '';
    const format = get(row, 'format') || '';
    const ladiesMen = get(row, 'ladies_men') || '';
    const tabName = get(row, 'tab_name') || '';

    // Extract tea assignments
    const teaLead = get(row, 'tea_lead') || '';
    const teaFirst = get(row, 'tea_first') || '';
    const teaSecond = get(row, 'tea_second') || '';

    // Format display date (e.g., "Sat 25 Apr") - date is now normalized to DD/MM/YYYY
    let displayDate = date;
    if (date) {
      const dateObj = parseNormalizedDate(date);
      if (!isNaN(dateObj.getTime())) {
        const dayName = dayNames[dateObj.getDay()];
        const day = dateObj.getDate();
        const month = monthNamesShort[dateObj.getMonth()];
        displayDate = `${dayName} ${day} ${month}`;
      }
    }

    teaRotaEntries.push({
      rowNumber,
      tabName,
      date,
      displayDate,
      time,
      clubName,
      format,
      ladiesMen,
      teaLead,
      teaFirst,
      teaSecond,
      status,
    });
  }

  // Sort by date (chronological order - past games first, then future)
  teaRotaEntries.sort((a, b) => {
    const dateA = parseNormalizedDate(a.date);
    const dateB = parseNormalizedDate(b.date);
    return dateA.getTime() - dateB.getTime();
  });

  return teaRotaEntries;
}

/**
 * Update tea rota assignments for a game
 * Used by committee members to edit tea assignments
 * @param rowNumber Row number in Games sheet
 * @param teaLead Username for tea lead
 * @param teaFirst Username for tea first
 * @param teaSecond Username for tea second
 */
export async function updateTeaRotaAssignment(
  rowNumber: number,
  teaLead: string,
  teaFirst: string,
  teaSecond: string
): Promise<void> {
  // Get Friendlies spreadsheet ID from environment
  const spreadsheetId = getFriendliesSpreadsheetId();

  // Get column mappings for Games sheet (cached)
  const colMap = await getColumnMap(spreadsheetId, 'Games');

  // Get column indices for tea fields
  const teaLeadCol = colMap['tea_lead'];
  const teaFirstCol = colMap['tea_first'];
  const teaSecondCol = colMap['tea_second'];

  if (teaLeadCol === undefined || teaFirstCol === undefined || teaSecondCol === undefined) {
    throw new Error('Tea columns not found in Games sheet. Expected: Tea Lead, Tea First, Tea Second');
  }

  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Build update data for each column
  const updates = [
    {
      range: `Games!${getColumnLetter(teaLeadCol)}${rowNumber}`,
      values: [[teaLead]],
    },
    {
      range: `Games!${getColumnLetter(teaFirstCol)}${rowNumber}`,
      values: [[teaFirst]],
    },
    {
      range: `Games!${getColumnLetter(teaSecondCol)}${rowNumber}`,
      values: [[teaSecond]],
    },
  ];

  // Update all tea columns in a batch
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates,
    },
  });
}

/**
 * Batch update tea rota assignments for multiple rows
 * Updates all modified rows in a single Google Sheets API call
 * @param updates Array of updates containing rowNumber and tea assignments
 */
export async function batchUpdateTeaRotaAssignments(
  updates: {
    rowNumber: number;
    teaLead: string;
    teaFirst: string;
    teaSecond: string;
  }[]
): Promise<void> {
  if (updates.length === 0) return;

  // Get Friendlies spreadsheet ID from environment
  const spreadsheetId = getFriendliesSpreadsheetId();

  // Get column mappings for Games sheet (cached)
  const colMap = await getColumnMap(spreadsheetId, 'Games');

  // Get column indices for tea fields
  const teaLeadCol = colMap['tea_lead'];
  const teaFirstCol = colMap['tea_first'];
  const teaSecondCol = colMap['tea_second'];

  if (teaLeadCol === undefined || teaFirstCol === undefined || teaSecondCol === undefined) {
    throw new Error('Tea columns not found in Games sheet. Expected: Tea Lead, Tea First, Tea Second');
  }

  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Build update data for all rows
  const batchData: { range: string; values: string[][] }[] = [];

  for (const update of updates) {
    batchData.push(
      {
        range: `Games!${getColumnLetter(teaLeadCol)}${update.rowNumber}`,
        values: [[update.teaLead]],
      },
      {
        range: `Games!${getColumnLetter(teaFirstCol)}${update.rowNumber}`,
        values: [[update.teaFirst]],
      },
      {
        range: `Games!${getColumnLetter(teaSecondCol)}${update.rowNumber}`,
        values: [[update.teaSecond]],
      }
    );
  }

  // Update all tea columns for all rows in a single batch
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: batchData,
    },
  });
}

/**
 * Swap tea assignment between two members across any games
 * If target is specified, swaps with that specific assignment
 * Otherwise searches ALL games to find where the new user is assigned
 * @param rowNumber Row number in Games sheet for the game where oldUser is assigned
 * @param position Which position oldUser is in: 'teaLead', 'teaFirst', or 'teaSecond'
 * @param oldUsername Current username in that position (the user initiating the swap)
 * @param newUsername Username to swap with
 * @param targetRowNumber Optional: specific row number for newUser's assignment
 * @param targetPosition Optional: specific position for newUser's assignment
 * @returns The updated tea rota entry for the original row
 */
export async function swapTeaAssignment(
  rowNumber: number,
  position: 'teaLead' | 'teaFirst' | 'teaSecond',
  oldUsername: string,
  newUsername: string,
  targetRowNumber?: number,
  targetPosition?: 'teaLead' | 'teaFirst' | 'teaSecond'
): Promise<TeaRotaEntry> {
  // Get Friendlies spreadsheet ID from environment
  const spreadsheetId = getFriendliesSpreadsheetId();

  // Get column mappings for Games sheet (cached)
  const colMap = await getColumnMap(spreadsheetId, 'Games');

  // Get column indices for all tea fields
  const teaLeadCol = colMap['tea_lead'];
  const teaFirstCol = colMap['tea_first'];
  const teaSecondCol = colMap['tea_second'];
  const homeAwayCol = colMap['home_away'] ?? colMap['h_a'];

  if (teaLeadCol === undefined || teaFirstCol === undefined || teaSecondCol === undefined) {
    throw new Error('Tea columns not found in Games sheet');
  }

  const positionToCol: { [key: string]: number } = {
    teaLead: teaLeadCol,
    teaFirst: teaFirstCol,
    teaSecond: teaSecondCol,
  };

  const colToPosition: { [key: number]: 'teaLead' | 'teaFirst' | 'teaSecond' } = {
    [teaLeadCol]: 'teaLead',
    [teaFirstCol]: 'teaFirst',
    [teaSecondCol]: 'teaSecond',
  };

  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Fetch ALL rows to find where newUsername is assigned
  const allRowsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Games!A2:ZZ',
  });

  const allRows = allRowsResponse.data.values || [];

  // Verify oldUsername is in the specified position at the specified row
  const oldUserRowIndex = rowNumber - 2; // Convert sheet row to array index (row 2 = index 0)
  if (oldUserRowIndex < 0 || oldUserRowIndex >= allRows.length) {
    throw new Error('Invalid row number');
  }

  const oldUserRow = allRows[oldUserRowIndex];
  const oldUserCurrentValue = oldUserRow[positionToCol[position]] || '';
  if (oldUserCurrentValue !== oldUsername) {
    throw new Error(`Cannot swap: you are not assigned to ${position}`);
  }

  // Determine the target assignment (where newUser is assigned)
  let newUserRowNumber: number | null = null;
  let newUserPosition: 'teaLead' | 'teaFirst' | 'teaSecond' | null = null;

  // If target is explicitly specified, use it
  if (targetRowNumber && targetPosition) {
    newUserRowNumber = targetRowNumber;
    newUserPosition = targetPosition;
  } else {
    // Otherwise, search for newUsername in any tea position across ALL home games
    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      const sheetRowNumber = i + 2; // Convert array index to sheet row number

      // Only check home games
      const homeAway = homeAwayCol !== undefined ? row[homeAwayCol] : 'H';
      if (homeAway !== 'H') continue;

      // Check each tea position
      if (row[teaLeadCol] === newUsername) {
        newUserRowNumber = sheetRowNumber;
        newUserPosition = 'teaLead';
        break;
      }
      if (row[teaFirstCol] === newUsername) {
        newUserRowNumber = sheetRowNumber;
        newUserPosition = 'teaFirst';
        break;
      }
      if (row[teaSecondCol] === newUsername) {
        newUserRowNumber = sheetRowNumber;
        newUserPosition = 'teaSecond';
        break;
      }
    }
  }

  // Build the updates for the swap
  const updates: { range: string; values: string[][] }[] = [];

  // Put newUsername in oldUsername's position (at oldUsername's row)
  updates.push({
    range: `Games!${getColumnLetter(positionToCol[position])}${rowNumber}`,
    values: [[newUsername]],
  });

  // If newUsername was assigned somewhere, put oldUsername there (completing the swap)
  if (newUserRowNumber !== null && newUserPosition !== null) {
    updates.push({
      range: `Games!${getColumnLetter(positionToCol[newUserPosition])}${newUserRowNumber}`,
      values: [[oldUsername]],
    });
  }

  // Apply all updates in a batch
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates,
    },
  });

  // Fetch the updated row to return the full entry
  const updatedRowResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Games!A${rowNumber}:ZZ${rowNumber}`,
  });

  const updatedRow = updatedRowResponse.data.values?.[0] || [];

  // Helper function to get a string value from the row
  const get = (field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (updatedRow[index] || null) : null;
  };

  // Normalize date to DD/MM/YYYY and format display date
  const date = normalizeToUKDate(get('date') || '');
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let displayDate = date;
  if (date) {
    const dateObj = parseNormalizedDate(date);
    if (!isNaN(dateObj.getTime())) {
      displayDate = `${dayNames[dateObj.getDay()]} ${dateObj.getDate()} ${monthNamesShort[dateObj.getMonth()]}`;
    }
  }

  return {
    rowNumber,
    tabName: get('tab_name') || '',
    date,
    displayDate,
    time: get('time') || '',
    clubName: get('club_name') || '',
    format: get('format') || '',
    ladiesMen: get('ladies_men') || '',
    teaLead: get('tea_lead') || '',
    teaFirst: get('tea_first') || '',
    teaSecond: get('tea_second') || '',
    status: get('status') || '',
  };
}

/**
 * Get a single tea rota entry by row number
 * Used to fetch details for swap confirmation
 */
export async function getTeaRotaEntry(rowNumber: number): Promise<TeaRotaEntry | null> {
  // Get Friendlies spreadsheet ID from environment
  const spreadsheetId = getFriendliesSpreadsheetId();

  // Get column mappings for Games sheet (cached)
  const colMap = await getColumnMap(spreadsheetId, 'Games');

  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Fetch the specific row
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Games!A${rowNumber}:ZZ${rowNumber}`,
  });

  const row = response.data.values?.[0];
  if (!row) return null;

  // Helper function to get a string value from the row
  const get = (field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || null) : null;
  };

  // Only return if this is a home game
  // Try multiple possible column names: "Home/Away" -> "home_away", "H/A" -> "h_a"
  const homeAway = get('home_away') || get('h_a') || 'H';
  if (homeAway.trim().toUpperCase() !== 'H') return null;

  // Normalize date to DD/MM/YYYY and format display date
  const date = normalizeToUKDate(get('date') || '');
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let displayDate = date;
  if (date) {
    const dateObj = parseNormalizedDate(date);
    if (!isNaN(dateObj.getTime())) {
      displayDate = `${dayNames[dateObj.getDay()]} ${dateObj.getDate()} ${monthNamesShort[dateObj.getMonth()]}`;
    }
  }

  return {
    rowNumber,
    tabName: get('tab_name') || '',
    date,
    displayDate,
    time: get('time') || '',
    clubName: get('club_name') || '',
    format: get('format') || '',
    ladiesMen: get('ladies_men') || '',
    teaLead: get('tea_lead') || '',
    teaFirst: get('tea_first') || '',
    teaSecond: get('tea_second') || '',
    status: get('status') || '',
  };
}

// ============================================================================
// FIXTURE CRUD OPERATIONS
// ============================================================================

/**
 * Create a new fixture row in the Games sheet
 * Appends a new row with the provided fixture data
 * Used by Fixtures Management page for captains/admins
 */
export async function createFixture(data: {
  date: string;
  time?: string;
  type?: GameType;
  clubName: string;
  clubSuffix?: string;
  homeAway?: 'H' | 'A';
  format?: string;
  ladiesMen?: string;
  dress?: string;
  paired?: string;
  maxPlayers?: number;
  message?: string;
  pickupInfo?: string;
  tabDate?: string;
  tabName?: string;
  status?: string;
}): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Games');
  const sheets = getSheetsClient();

  // Build a sparse row array mapping fields to their column positions
  const maxColIndex = Math.max(...Object.values(colMap));
  const row: string[] = new Array(maxColIndex + 1).fill('');

  const set = (field: string, value: string | number | undefined | null) => {
    if (value === undefined || value === null) return;
    const idx = colMap[field];
    if (idx !== undefined) {
      row[idx] = String(value);
    }
  };

  set('date', data.date);
  set('time', data.time ?? '');
  set('type', data.type ?? 'Friendly');
  set('club_name', data.clubName);
  set('club_suffix', data.clubSuffix ?? '');
  if (colMap['home_away'] !== undefined) {
    set('home_away', data.homeAway ?? 'H');
  } else {
    set('h_a', data.homeAway ?? 'H');
  }
  set('format', data.format ?? '');
  set('ladies_men', data.ladiesMen ?? '');
  set('dress', data.dress ?? '');
  set('paired', data.paired ?? '');
  if (data.maxPlayers !== undefined) set('max_capacity', data.maxPlayers);
  // Write to "Special Instructions" column (renamed from "Message"); fall back to old name
  const msgColKeyCreate = colMap['special_instructions'] !== undefined ? 'special_instructions' : 'message';
  set(msgColKeyCreate, data.message ?? '');
  const pickupColKey = colMap['pickup_info'] !== undefined ? 'pickup_info' : 'pickup_information';
  set(pickupColKey, data.pickupInfo ?? '');
  set('tab_date', data.tabDate ?? '');
  set('tab_name', data.tabName ?? '');
  set('status', data.status ?? '');

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Games!A:A',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [row],
    },
  });
}

/**
 * Update specific fields in an existing Games sheet row
 * Uses batch update to efficiently update only the changed columns
 * @param rowNumber Row number in the Games sheet (1-indexed, row 1 is header)
 * @param fields Fields to update (only provided fields are changed)
 */
export async function updateFixture(
  rowNumber: number,
  fields: {
    date?: string;
    time?: string;
    type?: GameType;
    clubName?: string;
    clubSuffix?: string;
    homeAway?: 'H' | 'A';
    format?: string;
    ladiesMen?: string;
    dress?: string;
    paired?: string;
    maxPlayers?: number;
    message?: string;
    pickupInfo?: string;
    tabDate?: string;
    tabName?: string;
    status?: string;
  }
): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Games');
  const sheets = getSheetsClient();

  const updates: { range: string; values: any[][] }[] = [];

  const addUpdate = (field: string, value: string | number | undefined) => {
    if (value === undefined) return;
    const idx = colMap[field];
    if (idx !== undefined) {
      updates.push({
        range: `Games!${getColumnLetter(idx)}${rowNumber}`,
        values: [[value]],
      });
    }
  };

  addUpdate('date', fields.date);
  addUpdate('time', fields.time);
  addUpdate('type', fields.type);
  addUpdate('club_name', fields.clubName);
  addUpdate('club_suffix', fields.clubSuffix);
  if (colMap['home_away'] !== undefined) {
    addUpdate('home_away', fields.homeAway);
  } else {
    addUpdate('h_a', fields.homeAway);
  }
  addUpdate('format', fields.format);
  addUpdate('ladies_men', fields.ladiesMen);
  addUpdate('dress', fields.dress);
  addUpdate('paired', fields.paired);
  addUpdate('max_capacity', fields.maxPlayers);
  // Write to "Special Instructions" column (renamed from "Message"); fall back to old name
  const msgColKeyUpdate = colMap['special_instructions'] !== undefined ? 'special_instructions' : 'message';
  if (fields.message !== undefined) addUpdate(msgColKeyUpdate, fields.message);
  const pickupKey = colMap['pickup_info'] !== undefined ? 'pickup_info' : 'pickup_information';
  if (fields.pickupInfo !== undefined) addUpdate(pickupKey, fields.pickupInfo);
  addUpdate('tab_date', fields.tabDate);
  addUpdate('tab_name', fields.tabName);
  addUpdate('status', fields.status);

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updates,
        valueInputOption: 'USER_ENTERED',
      },
    });
  }
}

/**
 * Physically delete a row from the Games sheet
 * Uses the Sheets API batchUpdate deleteDimension request
 * @param rowNumber Row number in the Games sheet (1-indexed, row 1 is header)
 */
export async function deleteFixtureRow(rowNumber: number): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  // Get spreadsheet metadata to find the numeric sheetId of the 'Games' tab
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });

  const gamesSheet = metadata.data.sheets?.find(
    s => s.properties?.title === 'Games'
  );

  if (!gamesSheet || gamesSheet.properties?.sheetId === undefined) {
    throw new Error('Games sheet not found in spreadsheet');
  }

  const sheetId = gamesSheet.properties.sheetId;

  // Delete the row (0-indexed: rowNumber - 1 to rowNumber)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });

  // Clear the column map cache for Games sheet since row positions have changed
  clearColumnMapCacheForSheet(spreadsheetId, 'Games');
}

// =============================================================================
// Selection Helper cache — stores snapshots in a hidden _SelectionCache tab
// so captains always see stats from the moment they first opened "Edit Selection",
// not stats inflated by games played after that point.
// =============================================================================

const SEL_CACHE_TAB = '_SelectionCache';

export async function getSelectionHelperCache(
  tabName: string
): Promise<{ cachedAt: string; data: unknown } | null> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SEL_CACHE_TAB}!A:C`,
    });
    const rows = response.data.values || [];
    // Collect all matching rows (duplicates can occur from concurrent requests)
    const matches = rows.slice(1).filter(r => r[0] === tabName && r[2]);
    if (matches.length === 0) return null;
    // Return the most recently cached entry
    matches.sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime());
    return { cachedAt: matches[0][1], data: JSON.parse(matches[0][2]) };
  } catch {
    return null;
  }
}

export async function setSelectionHelperCache(
  tabName: string,
  data: unknown
): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();
  const cachedAt = new Date().toISOString();
  const json = JSON.stringify(data);

  // Try to read the existing cache sheet
  let rows: string[][] = [];
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SEL_CACHE_TAB}!A:C`,
    });
    rows = (response.data.values as string[][]) || [];
  } catch {
    // Sheet doesn't exist yet — create it with a header row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SEL_CACHE_TAB, hidden: true } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SEL_CACHE_TAB}!A1:C1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['tab_name', 'cached_at', 'json_data']] },
    });
    rows = [['tab_name', 'cached_at', 'json_data']];
  }

  // Find existing row for this game
  let existingRowNumber = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === tabName) {
      existingRowNumber = i + 1; // 1-based sheet row
      break;
    }
  }

  if (existingRowNumber !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SEL_CACHE_TAB}!A${existingRowNumber}:C${existingRowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[tabName, cachedAt, json]] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SEL_CACHE_TAB}!A:C`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[tabName, cachedAt, json]] },
    });
  }
}
