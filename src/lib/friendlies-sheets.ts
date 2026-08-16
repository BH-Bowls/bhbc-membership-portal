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
import { getPetrolBands, getClubByName, getContactsForClub } from './clubs-supabase';
import { getAllUsers } from './members-supabase';
import { getFixtureByTabName, updateFixture } from './fixtures-supabase';

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
  // Writes to the Games sheet also drop the Games read cache on this instance
  // (friendlies uses its own client, so the sheets.ts registry never sees them).
  const values = sheets.spreadsheets.values as any;
  const writeMethods = new Set(['update', 'batchUpdate', 'append', 'clear']);
  for (const method of ['get', 'batchGet', 'update', 'batchUpdate', 'append', 'clear']) {
    if (typeof values[method] !== 'function') continue;
    const original = values[method].bind(values);
    if (writeMethods.has(method)) {
      values[method] = async (...args: any[]) => {
        const result = await withRetry(() => original(...args));
        if (writeTargetsGames(method, args)) invalidateGamesCache();
        return result;
      };
    } else {
      values[method] = (...args: any[]) => withRetry(() => original(...args));
    }
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

// ── Games sheet read cache ───────────────────────────────────────────────────
// The Games master sheet (Games!A2:ZZ) is read by getGames — several times per
// friendlies page load. It changes often
// (entries, scores, selection, locks), but only DISPLAY reads use this cache; every
// write-gating read (enter, add-players, lock, selection-save) passes forceFresh so
// it always sees current state. Short TTL (90s), and a Games write invalidates it on
// this instance immediately (see the write wrapper in getSheetsClient).
let _gamesRowsCache: { rows: any[][]; at: number } | null = null;
const GAMES_ROWS_TTL_MS = 90 * 1000; // 90 seconds

interface GamesInvalidation { invalidatedAt: number; hitsServed: number; windowMs: number; }
const _gamesCacheStats = {
  windowHits: 0,
  windowLoadedAt: null as number | null,
  totalHits: 0,
  totalLoads: 0,
  totalInvalidations: 0,
  startedAt: Date.now(),
  recent: [] as GamesInvalidation[],
};
const GAMES_CACHE_STATS_MAX = 50;

/** Snapshot of the Games cache for the admin diagnostics view. */
export function getGamesCacheStats() {
  const now = Date.now();
  const loadedAt = _gamesCacheStats.windowLoadedAt;
  return {
    cached: _gamesRowsCache !== null,
    count: _gamesRowsCache ? _gamesRowsCache.rows.length : 0, // games held (A2:ZZ, no header)
    loadedAt,
    ageMs: loadedAt !== null ? now - loadedAt : null,
    ttlMs: GAMES_ROWS_TTL_MS,
    currentWindowHits: _gamesCacheStats.windowHits,
    totalHits: _gamesCacheStats.totalHits,
    totalLoads: _gamesCacheStats.totalLoads,
    totalInvalidations: _gamesCacheStats.totalInvalidations,
    startedAt: _gamesCacheStats.startedAt,
    recentInvalidations: _gamesCacheStats.recent.slice(),
  };
}

function invalidateGamesCache(): void {
  if (_gamesRowsCache !== null && _gamesCacheStats.windowLoadedAt !== null) {
    const now = Date.now();
    _gamesCacheStats.recent.unshift({
      invalidatedAt: now,
      hitsServed: _gamesCacheStats.windowHits,
      windowMs: now - _gamesCacheStats.windowLoadedAt,
    });
    if (_gamesCacheStats.recent.length > GAMES_CACHE_STATS_MAX) {
      _gamesCacheStats.recent.length = GAMES_CACHE_STATS_MAX;
    }
    _gamesCacheStats.totalInvalidations += 1;
    console.log(`[games-cache] invalidated after serving ${_gamesCacheStats.windowHits} reads over ${Math.round((now - _gamesCacheStats.windowLoadedAt) / 1000)}s`);
  }
  _gamesRowsCache = null;
  _gamesCacheStats.windowHits = 0;
  _gamesCacheStats.windowLoadedAt = null;
}

// True when a values write targets the Games master sheet (range starts "Games!").
// Per-game tabs (e.g. "'Rottingdean 03 Jul 26'!A1") don't match, so they don't bust it.
function writeTargetsGames(method: string, args: any[]): boolean {
  const arg = args && args.length > 0 ? args[0] : null;
  if (!arg) return false;
  const hitsGames = (range: any) => typeof range === 'string' && range.indexOf('Games!') === 0;
  if (method === 'batchUpdate') {
    const data = arg.requestBody && arg.requestBody.data ? arg.requestBody.data : null;
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        if (hitsGames(data[i].range)) return true;
      }
    }
    return false;
  }
  return hitsGames(arg.range);
}

// Raw rows of Games!A2:ZZ, shared by every reader. forceFresh bypasses the cache
// (write-gating callers) but still repopulates it so the instance's display catches up.
async function getGamesRawRows(forceFresh = false): Promise<any[][]> {
  if (!forceFresh && _gamesRowsCache && (Date.now() - _gamesRowsCache.at) < GAMES_ROWS_TTL_MS) {
    _gamesCacheStats.windowHits += 1;
    _gamesCacheStats.totalHits += 1;
    return _gamesRowsCache.rows;
  }
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Games!A2:ZZ',
  });
  const rows = response.data.values || [];
  const loadedAt = Date.now();
  _gamesRowsCache = { rows, at: loadedAt };
  _gamesCacheStats.windowLoadedAt = loadedAt;
  _gamesCacheStats.windowHits = 0;
  _gamesCacheStats.totalLoads += 1;
  console.log(`[games-cache] loaded ${rows.length} rows from the sheet`);
  return rows;
}

/**
 * Get all games from Games sheet, optionally filtered by status
 * Returns array of Game objects with all game details
 * Status codes: O=Open, X=Selecting, S=Selected, P=Played, C=Cancelled, A=Abandoned
 * forceFresh bypasses the 90s Games cache — used by write-gating callers (enter,
 * add-players, lock, selection-save) that must act on current game state.
 */
export async function getGames(statusFilter?: GameStatus, typeFilter?: GameType[], forceFresh = false): Promise<Game[]> {
  // Get Friendlies spreadsheet ID from environment
  const spreadsheetId = getFriendliesSpreadsheetId();

  // Get column mappings for Games sheet (cached)
  const colMap = await getColumnMap(spreadsheetId, 'Games');

  // Fetch all data rows from Games sheet (cached unless forceFresh)
  const rows = await getGamesRawRows(forceFresh);

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

    // Extract needs-players flag (Y = flagged by captain)
    const needsPlayersRaw = get(row, 'needs_players');
    const needsPlayers = needsPlayersRaw?.trim().toUpperCase() === 'Y';

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
      needsPlayers,
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
 * Writes the given outcome status ('C' or 'A') to every player's entry in the
 * Players sheet for the specified game column.  Called on cancel/abandon so that
 * stale P/R/T values don't inflate percent_played the next time update-stats runs.
 */
export async function markGamePlayerEntriesAs(tabName: string, outcomeStatus: 'C' | 'A'): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!A:ZZ',
  });

  const rows = response.data.values || [];
  const headers = rows[0] || [];
  const gameColIndex = headers.findIndex((h: any) => h === tabName);

  // Column may not exist if the game was cancelled before entries were opened
  if (gameColIndex === -1) return;

  const gameColLetter = getColumnLetter(gameColIndex);
  const updates: { range: string; values: string[][] }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cell = (rows[i][gameColIndex] || '').toString();
    if (cell && cell !== 'C' && cell !== 'A') {
      updates.push({
        range: `Players!${gameColLetter}${i + 1}`,
        values: [[outcomeStatus]],
      });
    }
  }

  if (updates.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: updates,
    },
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
  const [gameSheetColMap, playersColMap, driverBarLookup] = await Promise.all([
    getColumnMap(spreadsheetId, tabName),
    getColumnMap(spreadsheetId, 'Players'),
    buildDriverBarLookup(),
  ]);

  // Fetch game sheet and Players sheet in parallel
  const [gameSheetResponse, playersResponse] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A:ZZ`,
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Players!A:ZZ',
    }),
  ]);

  const gameSheetRows = gameSheetResponse.data.values || [];
  const playersRows = playersResponse.data.values || [];
  const playersHeaders = playersRows[0] || [];

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
      const driverBar = getDriverBarInfoFromCache(userName, driverBarLookup);

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

  // If Players sheet has a name-type column, look up full name from Postgres members
  if (nameColumn !== undefined) {
    const allUsers = await getAllUsers();
    const member = allUsers.find((u) => u.userName === userName);
    if (member?.fullName) {
      return member.fullName;
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

  // If Players sheet uses full_name, fetch Postgres members ONCE for all lookups
  let membersLookup: Map<string, string> | null = null;
  if (!usesUserName) {
    const allUsers = await getAllUsers();
    membersLookup = new Map();
    for (const u of allUsers) {
      if (u.userName && u.fullName) membersLookup.set(u.userName.toLowerCase(), u.fullName);
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
 * Get the count of players actively in a game, excluding anyone withdrawn
 * (status ending in 'W' — e.g. PW, RW, TW, EW). Used to keep the Games sheet
 * 'entered' count accurate after a withdrawal on a Closed/Selected/Played
 * game, where the player stays on the sheet with a withdrawn status rather
 * than being removed outright.
 * Reads only the Players sheet (no Members lookup) — cheap enough to call
 * after every entry/withdrawal change.
 * @param tabName The game's tab name
 */
export async function getActiveEnteredCount(tabName: string): Promise<number> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!A:ZZ',
  });

  const rows = response.data.values || [];
  const headers = rows[0] || [];
  const gameColumnIndex = headers.findIndex((h: string) => h === tabName);
  if (gameColumnIndex === -1) return 0;

  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const status = rows[i][gameColumnIndex];
    if (status && String(status).trim() !== '' && !String(status).endsWith('W')) {
      count++;
    }
  }
  return count;
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

  // Build a lookup map of userName -> fullName from Postgres members
  const allUsers = await getAllUsers();
  const fullNameLookup: { [userName: string]: string } = {};
  for (const u of allUsers) {
    if (u.userName) fullNameLookup[u.userName] = u.fullName || u.userName;
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
  // Sourced from the same Postgres member data every other feature reads (not the
  // Players sheet) — allows adding any club member to a game, not just those who have
  // previously entered.
  const allUsers = await getAllUsers();

  const players = allUsers
    .filter((u) => {
      if (!u.userName || !u.userName.trim()) return false;
      // Filter by playing members if requested (Playing Lady/Playing Man, or legacy "Full")
      if (playingMembersOnly && u.memberType) {
        const isPlaying = u.memberType.startsWith('P') || u.memberType === 'Full';
        if (!isPlaying) return false; // Skip social members for friendlies/internal games
      }
      return true;
    })
    .map((u) => ({
      userName: u.userName.trim(),
      fullName: (u.fullName || u.userName).trim(),
      memberType: u.memberType || '',
    }));

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
export async function createGameSheet(tabName: string, playerFilter?: string[], skipStats: boolean = false): Promise<{ enteredCount: number }> {
  // Initialize Google Sheets API client
  const sheets = getSheetsClient();

  // Note: this used to re-verify the game exists via getGames() (Sheets) here, but the
  // canonical fixture record now lives in Postgres (fixtures-supabase.ts) for callers
  // that have already been cut over — the caller (e.g. manage/status's 'open' action)
  // is responsible for that check before calling this. This function only creates
  // Sheets-side player/roster structures, keyed purely by tabName.

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

  // The entered count is the TOTAL active roster of this game — every player with a
  // non-empty, non-withdrawn status in this game's column (E, M, Y, R, T, …), not
  // just the unselected E/M ones (a picked or reserve player still entered). The
  // enteredPlayers list, used below to decide which rows still need adding to the
  // sheet, stays limited to E/M (newly entered, not yet on the sheet).
  let totalEnteredCount = 0;

  // Loop through all player rows (skip header at index 0)
  for (let i = 1; i < rows.length; i++) {
    const status = (rows[i][gameColumnIndex] || '').toString();
    const userName = rows[i][userNameColumnIndex];
    if (!userName) continue;

    // Respect the player filter (used for paired-game allocation)
    if (playerFilterSet && !playerFilterSet.has(userName.toLowerCase())) {
      continue;
    }

    // Count anyone with a status that isn't blank or withdrawn (a 'W' suffix)
    const upper = status.toUpperCase();
    if (status !== '' && !upper.endsWith('W')) {
      totalEnteredCount++;
    }

    // Only E/M players still need adding to the game sheet
    if (status === 'E' || status === 'M') {
      enteredPlayers.push(userName);
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

    // Fetch driver/bar lookup — only when computing stats.
    // At open we skip stats (they're snapshotted at close), so this read is avoided.
    let driverBarLookup: Map<string, { driver: boolean; bar: boolean }> = new Map();
    if (!skipStats) {
      driverBarLookup = await buildDriverBarLookup();
    }

    // Sort players alphabetically for easier captain selection
    const sortedPlayers = enteredPlayers.sort();

    // Build batch updates for each player with their stats
    const batchUpdates: { range: string; values: (string | number)[][] }[] = [];
    let currentRow = 2; // Start at row 2 (row 1 is header)

    for (const userName of sortedPlayers) {
      try {
        // Add player name
        const nameCol = getColumnLetter(nameColIndex);
        batchUpdates.push({
          range: `'${tabName}'!${nameCol}${currentRow}`,
          values: [[userName]],
        });

        // Add stats if columns exist (skipped for open games — filled at close)
        if (!skipStats) {
          const stats = getPlayerStatsFromCache(userName, rows, playersColMap, headers, tabName);
          const driverBar = getDriverBarInfoFromCache(userName, driverBarLookup);

          if (nameDownColIndex !== undefined) {
            batchUpdates.push({ range: `'${tabName}'!${getColumnLetter(nameDownColIndex)}${currentRow}`, values: [[stats.nameDown]] });
          }
          if (pickedColIndex !== undefined) {
            batchUpdates.push({ range: `'${tabName}'!${getColumnLetter(pickedColIndex)}${currentRow}`, values: [[stats.picked]] });
          }
          if (percentPlayedColIndex !== undefined) {
            const percentPlayedDecimal = stats.percentPlayed > 1 ? stats.percentPlayed / 100 : stats.percentPlayed;
            batchUpdates.push({ range: `'${tabName}'!${getColumnLetter(percentPlayedColIndex)}${currentRow}`, values: [[percentPlayedDecimal]] });
          }
          if (driverBarColIndex !== undefined) {
            batchUpdates.push({ range: `'${tabName}'!${getColumnLetter(driverBarColIndex)}${currentRow}`, values: [[driverBar.code]] });
          }
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

  // Update the entered count in Games sheet to the TOTAL who entered this game
  // (not just the newly-added rows — at allocation the players are already on the sheet).
  // Best-effort: callers whose fixture now lives in Postgres (not a Games sheet row —
  // e.g. manage/status) get a "Game not found" here, which is expected, not a real
  // failure — they persist enteredCount themselves via the returned value instead.
  try {
    await updateGameCounts(tabName, { entered: totalEnteredCount });
  } catch (e) {
    console.error(`[createGameSheet] Failed to write entered count to Games sheet (expected if this fixture isn't a Sheets row):`, e);
  }

  // Return the total entered count for this game
  return { enteredCount: totalEnteredCount };
}

/**
 * Add a single player to an existing game sheet.
 * Called when a player enters an open game (Selected='R') or when a captain
 * adds a player via the Add Players button (Selected='R').
 * Skips silently if the game sheet does not exist or the player is already in it.
 */
export async function addPlayerToGameSheet(tabName: string, userName: string, selected: string = 'R', carNumber?: string, computeStats: boolean = true): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  // Confirm the game sheet exists and capture its id + current grid row count
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetDef = spreadsheet.data.sheets?.find(s => s.properties?.title === tabName);
  if (!sheetDef) return; // Sheet not created yet — skip
  const sheetId = sheetDef.properties?.sheetId;
  const currentRowCount = sheetDef.properties?.gridProperties?.rowCount ?? 0;

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

  const batchUpdates: { range: string; values: (string | number)[][] }[] = [];

  // Player name
  batchUpdates.push({
    range: `'${tabName}'!${getColumnLetter(nameColIndex)}${nextRow}`,
    values: [[userName]],
  });

  // Selection status
  if (selectedColIndex !== undefined) {
    batchUpdates.push({
      range: `'${tabName}'!${getColumnLetter(selectedColIndex)}${nextRow}`,
      values: [[selected]],
    });
  }

  // Stats are only meaningful at close, so for open-game entries we skip the
  // (expensive) Players + Members reads and leave the stat cells blank — they are
  // snapshotted for everyone when the game is closed.
  if (computeStats) {
    const playersColMap = await getColumnMap(spreadsheetId, 'Players');
    const playersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Players!A:ZZ',
    });
    const playersRows = playersResponse.data.values || [];
    const playersHeaders = playersRows[0] || [];

    const driverBarLookup = await buildDriverBarLookup();

    const stats = getPlayerStatsFromCache(userName, playersRows, playersColMap, playersHeaders, tabName);
    const driverBar = getDriverBarInfoFromCache(userName, driverBarLookup);

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
  }

  // Set car number if provided (e.g. 'O' for own transport)
  const carNumberColIndex = gameSheetColMap['car_number'];
  if (carNumber !== undefined && carNumberColIndex !== undefined) {
    batchUpdates.push({
      range: `'${tabName}'!${getColumnLetter(carNumberColIndex)}${nextRow}`,
      values: [[carNumber]],
    });
  }

  // Grow the grid first if the new row would fall outside it (e.g. a game whose
  // sheet was shrunk when it was emptied during allocation).
  if (nextRow > currentRowCount && sheetId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { rowCount: nextRow } },
            fields: 'gridProperties.rowCount',
          },
        }],
      },
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
 * Move one or more Reserve players from one paired game to the other in a single
 * batched pass. Only players currently at Reserve status (selected = 'R') are
 * moved, so a picked team is never disturbed; names that are not reserves are
 * skipped. All reads/writes are batched to stay within the Sheets read quota.
 *
 * @param fromTab The game the reserves are currently in
 * @param toTab The paired game to move them to
 * @param userNames The reserve players' usernames
 * @returns Success flag, the number actually moved, and an error on failure
 */
export async function moveReservePlayers(
  fromTab: string,
  toTab: string,
  userNames: string[]
): Promise<{ success: boolean; moved: number; error?: string }> {
  try {
    if (userNames.length === 0) {
      return { success: true, moved: 0 };
    }

    // Load fixtures to validate the pairing and read current counts
    const [fromGame, toGame] = await Promise.all([
      getFixtureByTabName(fromTab),
      getFixtureByTabName(toTab),
    ]);
    if (!fromGame || !toGame) {
      return { success: false, moved: 0, error: 'Game not found' };
    }
    const linked = (p: string | undefined) => p === 'Y' || p === 'C';
    if (!linked(fromGame.paired) || !linked(toGame.paired) || fromGame.date !== toGame.date) {
      return { success: false, moved: 0, error: 'Games are not a paired pair' };
    }

    // Verify which requested players are actually reserves in the source game
    const fromPlayers = await getGameSheet(fromTab);
    const reserveNames = new Set<string>();
    for (const p of fromPlayers) {
      if (p.selected === 'R' && p.status !== 'W') {
        reserveNames.add(p.name.toLowerCase());
      }
    }
    const toMove: string[] = [];
    for (const u of userNames) {
      if (reserveNames.has(u.toLowerCase())) {
        toMove.push(u);
      }
    }
    if (toMove.length === 0) {
      return { success: true, moved: 0 };
    }

    // Reuse each moved player's stats from the source-sheet read we already did,
    // so the destination add doesn't re-read the (large) Players and Members sheets.
    const moveSet = new Set(toMove.map(u => u.toLowerCase()));
    const statsByName = new Map<string, { nameDown: number; picked: number; percentPlayed: number; driverBar: string }>();
    for (const p of fromPlayers) {
      if (moveSet.has(p.name.toLowerCase())) {
        statsByName.set(p.name.toLowerCase(), {
          nameDown: p.nameDown,
          picked: p.picked,
          percentPlayed: p.percentPlayed,
          driverBar: p.driverBar,
        });
      }
    }

    // Remove from the source game sheet, add to the destination as reserves
    await batchRemovePlayersFromGameSheet(fromTab, toMove);
    await addPlayersToGameSheet(toTab, toMove, 'R', statsByName);

    // Switch their status columns in the Players sheet (clear source, set dest = R)
    await batchUpdatePlayerEntries(fromTab, toMove.map(u => ({ userName: u, status: '' as const })));
    await batchUpdatePlayerEntries(toTab, toMove.map(u => ({ userName: u, status: 'R' as const })));

    // Adjust both fixtures' counts by the number moved.
    const n = toMove.length;
    await Promise.all([
      updateFixture(fromGame.id, {
        entered: Math.max(0, (fromGame.entered || 0) - n),
        reserves: Math.max(0, (fromGame.reserves || 0) - n),
      }),
      updateFixture(toGame.id, {
        entered: (toGame.entered || 0) + n,
        reserves: (toGame.reserves || 0) + n,
      }),
    ]);

    return { success: true, moved: n };
  } catch (error) {
    console.error(`[moveReservePlayers] Failed to move reserves from ${fromTab} to ${toTab}:`, error);
    return {
      success: false,
      moved: 0,
      error: error instanceof Error ? error.message : 'Failed to move reserves',
    };
  }
}

/**
 * Add several players to a game sheet in one pass (batch version of
 * addPlayerToGameSheet). Writes every new row in a single batchUpdate; players
 * already in the sheet are skipped.
 *
 * If `statsByName` is supplied (lowercased username -> stats), those stats are
 * used directly and the Players/Members sheets are NOT read — used by the reserve
 * move, where the source sheet already gave us each player's stats. Otherwise the
 * Players and Members sheets are read once to compute stats.
 *
 * @param tabName The game's tab name
 * @param userNames The usernames to add
 * @param selected Selection status for the new rows (default 'R' = Reserve)
 * @param statsByName Optional precomputed stats to avoid the Players/Members reads
 */
export async function addPlayersToGameSheet(
  tabName: string,
  userNames: string[],
  selected: string = 'R',
  statsByName?: Map<string, { nameDown: number; picked: number; percentPlayed: number; driverBar: string }>
): Promise<void> {
  if (userNames.length === 0) return;

  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  // Confirm the game sheet exists and capture its id + current grid row count
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetDef = spreadsheet.data.sheets?.find(s => s.properties?.title === tabName);
  if (!sheetDef) return;
  const sheetId = sheetDef.properties?.sheetId;
  const currentRowCount = sheetDef.properties?.gridProperties?.rowCount ?? 0;

  const gameSheetColMap = await getColumnMap(spreadsheetId, tabName);
  const nameColIndex = gameSheetColMap['name'] ?? gameSheetColMap['user_name'] ?? 0;
  const nameDownColIndex = gameSheetColMap['name_down'];
  const pickedColIndex = gameSheetColMap['picked'];
  const percentPlayedColIndex = gameSheetColMap['percent_played'];
  const driverBarColIndex = gameSheetColMap['driver_bar'];
  const selectedColIndex = gameSheetColMap['selected'];

  // Read existing names once to skip duplicates and find the next empty row
  const existingResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:A`,
  });
  const existingRows = existingResponse.data.values || [];
  const existing = new Set(existingRows.map((r: any[]) => (r[0] || '').toLowerCase()));
  let nextRow = 2 + existingRows.length;

  // Read Players sheet and driver/bar lookup once for stat lookups — only when stats
  // were not supplied by the caller (the move flow passes them in).
  let playersRows: any[] = [];
  let playersHeaders: any[] = [];
  let playersColMap: { [key: string]: number } = {};
  let driverBarLookup: Map<string, { driver: boolean; bar: boolean }> = new Map();
  if (!statsByName) {
    playersColMap = await getColumnMap(spreadsheetId, 'Players');
    const playersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Players!A:ZZ',
    });
    playersRows = playersResponse.data.values || [];
    playersHeaders = playersRows[0] || [];

    driverBarLookup = await buildDriverBarLookup();
  }

  const batchUpdates: { range: string; values: (string | number)[][] }[] = [];

  for (const userName of userNames) {
    // Skip anyone already on the sheet
    if (existing.has(userName.toLowerCase())) continue;

    // Source the player's stats from the supplied map, or compute from the sheets
    let nameDown = 0;
    let picked = 0;
    let percentPlayed = 0;
    let driverBarCode = '';
    if (statsByName) {
      const s = statsByName.get(userName.toLowerCase());
      if (s) {
        nameDown = s.nameDown;
        picked = s.picked;
        percentPlayed = s.percentPlayed;
        driverBarCode = s.driverBar;
      }
    } else {
      const stats = getPlayerStatsFromCache(userName, playersRows, playersColMap, playersHeaders, tabName);
      const driverBar = getDriverBarInfoFromCache(userName, driverBarLookup);
      nameDown = stats.nameDown;
      picked = stats.picked;
      percentPlayed = stats.percentPlayed;
      driverBarCode = driverBar.code;
    }

    batchUpdates.push({
      range: `'${tabName}'!${getColumnLetter(nameColIndex)}${nextRow}`,
      values: [[userName]],
    });
    if (nameDownColIndex !== undefined) {
      batchUpdates.push({ range: `'${tabName}'!${getColumnLetter(nameDownColIndex)}${nextRow}`, values: [[nameDown]] });
    }
    if (pickedColIndex !== undefined) {
      batchUpdates.push({ range: `'${tabName}'!${getColumnLetter(pickedColIndex)}${nextRow}`, values: [[picked]] });
    }
    if (percentPlayedColIndex !== undefined) {
      const pct = percentPlayed > 1 ? percentPlayed / 100 : percentPlayed;
      batchUpdates.push({ range: `'${tabName}'!${getColumnLetter(percentPlayedColIndex)}${nextRow}`, values: [[pct]] });
    }
    if (driverBarColIndex !== undefined) {
      batchUpdates.push({ range: `'${tabName}'!${getColumnLetter(driverBarColIndex)}${nextRow}`, values: [[driverBarCode]] });
    }
    if (selectedColIndex !== undefined) {
      batchUpdates.push({ range: `'${tabName}'!${getColumnLetter(selectedColIndex)}${nextRow}`, values: [[selected]] });
    }

    existing.add(userName.toLowerCase());
    nextRow++;
  }

  // The grid may be too small to hold the new rows — e.g. a game that was emptied
  // during allocation had its sheet shrunk to a couple of rows. Grow it first so
  // the writes below don't fall outside the grid ("exceeds grid limits").
  const lastRow = nextRow - 1;
  if (lastRow > currentRowCount && sheetId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { rowCount: lastRow } },
            fields: 'gridProperties.rowCount',
          },
        }],
      },
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
 * Remove several players from a game sheet in a single pass.
 * Reads the sheet once and deletes all matching rows in one batchUpdate, instead
 * of one metadata read + one data read per player. Used by the allocation save to
 * avoid exceeding the Google Sheets read-requests-per-minute quota.
 *
 * @param tabName The game's tab name
 * @param userNames The usernames to remove from the sheet
 */
export async function batchRemovePlayersFromGameSheet(tabName: string, userNames: string[]): Promise<void> {
  if (userNames.length === 0) return;

  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  // Confirm the game sheet exists and get its numeric id (one metadata read)
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetDef = spreadsheet.data.sheets?.find(s => s.properties?.title === tabName);
  if (!sheetDef) return; // Sheet doesn't exist — nothing to remove
  const sheetId = sheetDef.properties?.sheetId;
  if (sheetId === undefined) return;

  const colMap = await getColumnMap(spreadsheetId, tabName);
  const nameColIndex = colMap['name'] ?? colMap['user_name'] ?? 0;

  // Read the sheet once
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:ZZ`,
  });
  const rows = response.data.values || [];

  // Collect the 1-indexed sheet row numbers for every player to remove
  const targets = new Set(userNames.map(u => u.toLowerCase()));
  const rowNumbers: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const name = (rows[i][nameColIndex] || '').toLowerCase();
    if (targets.has(name)) {
      rowNumbers.push(i + 2); // data starts at row 2
    }
  }
  if (rowNumbers.length === 0) return;

  // Delete from the bottom up so earlier deletions don't shift later row indices
  rowNumbers.sort((a, b) => b - a);

  // Google Sheets refuses to delete EVERY non-frozen row in a single request, and
  // these game sheets have a frozen header — so the data rows are the only
  // non-frozen rows. If we're removing all of them (e.g. when every player was
  // allocated to the other game), keep the topmost row by clearing its contents
  // instead of deleting it, so at least one non-frozen row survives.
  let deleteList = rowNumbers;
  if (rowNumbers.length >= rows.length) {
    const keepRow = rowNumbers[rowNumbers.length - 1]; // smallest = topmost data row
    deleteList = rowNumbers.filter(r => r !== keepRow);
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${tabName}'!${keepRow}:${keepRow}`,
    });
  }

  if (deleteList.length > 0) {
    const requests = deleteList.map(rowNum => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: rowNum - 1, // 0-indexed
          endIndex: rowNum,       // exclusive
        },
      },
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }
}

/**
 * Sort game-sheet players for display: by selection status (Y, R, T, then blank),
 * then team number, then position, then surname. Sorts in place and returns the
 * same array. Shared by the manage/game and get-stats routes so both present the
 * player list in the same order.
 *
 * @param players The players to sort
 * @returns The same array, sorted
 */
export function sortGameSheetPlayers(players: GameSheetPlayer[]): GameSheetPlayer[] {
  const selectedOrder: Record<string, number> = { 'Y': 1, 'R': 2, '': 3 };
  const positionOrder: Record<string, number> = { 'S': 1, '1': 2, '2': 3, '3': 4, '': 5 };

  players.sort((a, b) => {
    const selA = selectedOrder[a.selected] ?? 4;
    const selB = selectedOrder[b.selected] ?? 4;
    if (selA !== selB) return selA - selB;

    const teamA = a.team ?? 999;
    const teamB = b.team ?? 999;
    if (teamA !== teamB) return teamA - teamB;

    const posA = positionOrder[a.position] ?? 5;
    const posB = positionOrder[b.position] ?? 5;
    if (posA !== posB) return posA - posB;

    const lastNameCompare = (a.lastName || a.fullName).localeCompare(b.lastName || b.fullName);
    if (lastNameCompare !== 0) return lastNameCompare;
    return a.fullName.localeCompare(b.fullName);
  });

  return players;
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

  // Fetch Postgres members to look up full names for display
  const allUsers = await getAllUsers();

  // Build lookup maps: userName -> fullName and userName -> lastName
  const fullNameLookup: Record<string, string> = {};
  const lastNameLookup: Record<string, string> = {};
  for (const u of allUsers) {
    if (u.userName) {
      fullNameLookup[u.userName.toLowerCase()] = u.fullName || u.userName;
      lastNameLookup[u.userName.toLowerCase()] = u.lastName || '';
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
    const acknowledgedCancellation = get(row, 'acknowledged_cancellation') || '';

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
      acknowledgedCancellation,
    };

    // Add player to array
    players.push(player);
  }

  // Return array of all players in this game sheet
  return players;
}

/**
 * Default any blank selections in a game sheet to Reserve ('R').
 * Run at close so every active (non-withdrawn) entrant is at least a Reserve —
 * the captain then promotes to Playing (Y) or Reserve Team (T). Existing Y/R/T
 * selections are left untouched. Returns the number of rows updated.
 */
export async function markBlankSelectionsAsReserve(tabName: string): Promise<number> {
  const friendliesId = getFriendliesSpreadsheetId();
  const players = await getGameSheet(tabName);
  const colMap = await getColumnMap(friendliesId, tabName);
  const selectedColIndex = colMap['selected'];
  if (selectedColIndex === undefined) return 0;

  const selectedCol = getColumnLetter(selectedColIndex);
  const data: { range: string; values: (string | number)[][] }[] = [];
  for (const p of players) {
    // Blank selection + not withdrawn → default to Reserve
    if ((p.selected ?? '') === '' && p.status !== 'W') {
      data.push({ range: `'${tabName}'!${selectedCol}${p.rowNumber}`, values: [['R']] });
    }
  }

  if (data.length > 0) {
    await getSheetsClient().spreadsheets.values.batchUpdate({
      spreadsheetId: friendliesId,
      requestBody: { data, valueInputOption: 'USER_ENTERED' },
    });
  }
  return data.length;
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

  // Fetch driver/bar lookup ONCE (used by both add and update sections)
  const driverBarLookup = await buildDriverBarLookup();

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
        const driverBar = getDriverBarInfoFromCache(userName, driverBarLookup);

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
      const driverBar = getDriverBarInfoFromCache(player.name, driverBarLookup);

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
/** Build a userName (lowercase) -> driver/bar-availability lookup from Postgres members. */
async function buildDriverBarLookup(): Promise<Map<string, { driver: boolean; bar: boolean }>> {
  const allUsers = await getAllUsers();
  const lookup = new Map<string, { driver: boolean; bar: boolean }>();
  for (const u of allUsers) {
    if (!u.userName) continue;
    const driver = u.drivingAwayMatches === 'Yes' || u.drivingAwayMatches === 'Y';
    const bar = u.barDuty === 'Yes' || u.barDuty === 'Y';
    lookup.set(u.userName.trim().toLowerCase(), { driver, bar });
  }
  return lookup;
}

function getDriverBarInfoFromCache(
  userName: string,
  driverBarLookup: Map<string, { driver: boolean; bar: boolean }>
): { code: string; driver: boolean; bar: boolean } {
  const entry = driverBarLookup.get(userName.trim().toLowerCase());
  if (!entry) {
    // User not found - return defaults
    return { code: '-', driver: false, bar: false };
  }

  const { driver, bar } = entry;

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
  const allUsers = await getAllUsers();
  const member = allUsers.find((u) => u.userName === userName);

  // If user not found, return defaults (not a driver, no bar duty)
  if (!member) {
    return { driver: false, bar: false, code: '' };
  }

  const driver = member.drivingAwayMatches === 'Yes' || member.drivingAwayMatches === 'Y';
  const bar = member.barDuty === 'Yes' || member.barDuty === 'Y';

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

  const club = await getClubByName(clubName);
  if (!club) {
    _clubDetailsCache.set(clubName, { data: null, ts: Date.now() });
    return null;
  }

  // googleAddress/bowlsEnglandUrl/bhWebsite: legacy Sheets columns never represented
  // in the Postgres club_profiles schema — confirmed unused by every consumer of
  // ClubDetails before dropping them here.
  const result: ClubDetails = {
    clubName: club.clubName,
    clubNumber: club.clubNumber,
    clubMobile: club.clubMobile,
    clubEmail: club.clubEmailAddress,
    clubEmailNote: club.clubEmailNote,
    generalInfo: club.generalInformation,
    drivingBand: club.drivingBand,
    petrolCost: club.petrolCost,
    miles: club.miles,
    travelTime: club.travelTime,
    address1: club.address1,
    address2: club.address2,
    address3: club.address3,
    address4: club.address4,
    postCode: club.postCode,
    googleAddress: '',
    latitude: club.latitude !== null ? String(club.latitude) : '',
    longitude: club.longitude !== null ? String(club.longitude) : '',
    bowlsEnglandUrl: '',
    website: club.website,
    bhWebsite: '',
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
  // clubs-supabase.ts's getContactsForClub already sorts by role priority.
  const contacts = await getContactsForClub(clubName);
  return contacts.map((c) => ({
    clubName: c.clubName,
    role: c.role,
    firstName: c.firstName,
    lastName: c.lastName,
    name: c.name,
    phoneNumber: c.phoneNumber,
    mobileNumber: c.mobileNumber,
    notes: c.notes,
    email: c.email,
  }));
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

// ============================================================================
// TOKEN AUTHENTICATION
// ============================================================================

/**
 * Ensures a 64-char hex token exists for the given player on the given game tab.
 * If the Token column does not exist, creates it first (lazy creation).
 * If the player's token cell is blank, generates a token and writes it.
 * If the player already has a token, returns it unchanged.
 */
export async function ensurePlayerToken(
  tabName: string,
  userName: string
): Promise<string> {
  const { randomBytes } = await import('crypto');
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  let colMap = await getColumnMap(spreadsheetId, tabName);

  if (colMap['token'] === undefined) {
    // Read the raw header row to find the true last column (Object.keys(colMap) undercounts
    // when any header cells are blank, which would overwrite an existing column header).
    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!1:1`,
    });
    const headerRow = (headerResp.data.values && headerResp.data.values[0]) || [];
    const newColLetter = getColumnLetter(headerRow.length);

    // The template game sheet has a fixed grid size. Append a column so the new
    // header cell falls within the grid bounds before writing to it.
    const spreadsheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
    let sheetId: number | null = null;
    if (spreadsheetMeta.data.sheets) {
      for (const sheet of spreadsheetMeta.data.sheets) {
        if (sheet.properties && sheet.properties.title === tabName) {
          sheetId = sheet.properties.sheetId !== undefined ? sheet.properties.sheetId : null;
          break;
        }
      }
    }
    if (sheetId === null) {
      throw new Error(`ensurePlayerToken: sheet "${tabName}" not found in spreadsheet`);
    }
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ appendDimension: { sheetId, dimension: 'COLUMNS', length: 1 } }],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!${newColLetter}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Token']] },
    });
    clearColumnMapCacheForSheet(spreadsheetId, tabName);
    colMap = await getColumnMap(spreadsheetId, tabName);
    if (colMap['token'] === undefined) {
      throw new Error(`ensurePlayerToken: Token column was not created in "${tabName}"`);
    }
  }

  const tokenCol = colMap['token'];

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:ZZ`,
  });
  const rows = response.data.values || [];

  let playerRow = -1;
  let existingToken = '';
  const userNameCol = colMap['user_name'] !== undefined ? colMap['user_name'] : colMap['name'];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (userNameCol !== undefined && row[userNameCol] === userName) {
      playerRow = i + 2;
      existingToken = (row[tokenCol] || '');
      break;
    }
  }

  if (playerRow === -1) {
    throw new Error(`ensurePlayerToken: player "${userName}" not found in game tab "${tabName}" (userNameCol=${userNameCol}, rows=${rows.length})`);
  }

  if (existingToken) {
    return existingToken;
  }

  const token = randomBytes(32).toString('hex');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!${getColumnLetter(tokenCol)}${playerRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[token]] },
  });

  return token;
}

/**
 * Validates a token against the per-game tab.
 * Returns player row data if valid, null if invalid or expired (game date in the past).
 */
export async function validateGameToken(
  tabName: string,
  token: string
): Promise<{
  userName: string;
  rowNumber: number;
  playerSelected: string;
  playerConfirmation: string;
  playerTeam: number | null;
  playerPosition: string;
  acknowledgedCancellation: string;
  gameStatus: string;
  gameDate: string;
} | null> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  const colMap = await getColumnMap(spreadsheetId, tabName);
  const tokenCol = colMap['token'];

  if (tokenCol === undefined) {
    return null;
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:ZZ`,
  });
  const rows = response.data.values || [];

  const userNameCol = colMap['user_name'] !== undefined ? colMap['user_name'] : colMap['name'];
  const selectedCol = colMap['selected'];
  const statusCol = colMap['status'];
  const teamCol = colMap['team'];
  const positionCol = colMap['position'];
  const ackCol = colMap['acknowledged_cancellation'];

  let matchedRow: {
    userName: string;
    rowNumber: number;
    playerSelected: string;
    playerConfirmation: string;
    playerTeam: number | null;
    playerPosition: string;
    acknowledgedCancellation: string;
  } | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cellToken = tokenCol !== undefined ? (row[tokenCol] || '') : '';
    if (cellToken === token) {
      const userName = userNameCol !== undefined ? (row[userNameCol] || '') : '';
      const rawTeam = teamCol !== undefined ? row[teamCol] : '';
      matchedRow = {
        userName,
        rowNumber: i + 2,
        playerSelected: selectedCol !== undefined ? (row[selectedCol] || '') : '',
        playerConfirmation: statusCol !== undefined ? (row[statusCol] || '') : '',
        playerTeam: rawTeam ? parseInt(rawTeam) : null,
        playerPosition: positionCol !== undefined ? (row[positionCol] || '') : '',
        acknowledgedCancellation: ackCol !== undefined ? (row[ackCol] || '') : '',
      };
      break;
    }
  }

  if (!matchedRow) {
    return null;
  }

  const game = await getFixtureByTabName(tabName);

  if (!game) {
    return null;
  }

  const gameDate = parseNormalizedDate(game.date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (gameDate < today) {
    return null;
  }

  return {
    ...matchedRow,
    gameStatus: game.status,
    gameDate: game.date,
  };
}

/**
 * Sets acknowledged_cancellation = 'Y' for the given player on the given game tab.
 * Creates the column if it does not yet exist (lazy creation).
 */
export async function acknowledgeGameCancellation(
  tabName: string,
  userName: string
): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  let colMap = await getColumnMap(spreadsheetId, tabName);

  if (colMap['acknowledged_cancellation'] === undefined) {
    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!1:1`,
    });
    const headerRow = (headerResp.data.values && headerResp.data.values[0]) || [];
    const newColLetter = getColumnLetter(headerRow.length);

    const spreadsheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
    let sheetId: number | null = null;
    if (spreadsheetMeta.data.sheets) {
      for (const sheet of spreadsheetMeta.data.sheets) {
        if (sheet.properties && sheet.properties.title === tabName) {
          sheetId = sheet.properties.sheetId !== undefined ? sheet.properties.sheetId : null;
          break;
        }
      }
    }
    if (sheetId === null) {
      throw new Error(`acknowledgeGameCancellation: sheet "${tabName}" not found in spreadsheet`);
    }
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ appendDimension: { sheetId, dimension: 'COLUMNS', length: 1 } }],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!${newColLetter}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Acknowledged Cancellation']] },
    });
    clearColumnMapCacheForSheet(spreadsheetId, tabName);
    colMap = await getColumnMap(spreadsheetId, tabName);
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:ZZ`,
  });
  const rows = response.data.values || [];

  const userNameCol = colMap['user_name'] !== undefined ? colMap['user_name'] : colMap['name'];
  const ackCol = colMap['acknowledged_cancellation'];

  let playerRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (userNameCol !== undefined && row[userNameCol] === userName) {
      playerRow = i + 2;
      break;
    }
  }

  if (playerRow === -1) {
    throw new Error(`Player "${userName}" not found in game tab "${tabName}"`);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!${getColumnLetter(ackCol)}${playerRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['Y']] },
  });
}

/**
 * Returns confirmation and acknowledgement status for all players on a game tab.
 * Returns empty strings for missing columns rather than throwing.
 */
export async function getGameConfirmationStatus(
  tabName: string
): Promise<Record<string, { playerConfirmation: string; acknowledgedCancellation: string }>> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();

  const colMap = await getColumnMap(spreadsheetId, tabName);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:ZZ`,
  });
  const rows = response.data.values || [];

  const userNameCol = colMap['user_name'] !== undefined ? colMap['user_name'] : colMap['name'];
  const statusCol = colMap['status'];
  const ackCol = colMap['acknowledged_cancellation'];

  const result: Record<string, { playerConfirmation: string; acknowledgedCancellation: string }> = {};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const userName = userNameCol !== undefined ? (row[userNameCol] || '') : '';
    if (!userName) continue;
    result[userName] = {
      playerConfirmation: statusCol !== undefined ? (row[statusCol] || '') : '',
      acknowledgedCancellation: ackCol !== undefined ? (row[ackCol] || '') : '',
    };
  }

  return result;
}
