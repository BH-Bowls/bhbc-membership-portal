// Google Sheets operations for Friendlies system
import { google } from 'googleapis';
import {
  Game,
  PlayerEntry,
  GameSheetPlayer,
  PlayerStats,
  DriverBarInfo,
  TeaRota,
  ClubDetails,
  ClubContact,
  GameStatus,
  PlayerEntryStatus,
} from './types/friendlies';

// ============================================================================
// ENVIRONMENT VARIABLE GETTERS
// ============================================================================

function getFriendliesSpreadsheetId(): string {
  const id = process.env.FRIENDLIES_SPREADSHEET_ID;
  if (!id) {
    throw new Error('FRIENDLIES_SPREADSHEET_ID environment variable is not set');
  }
  return id;
}

function getMembersSpreadsheetId(): string {
  const id = process.env.MEMBERS_SPREADSHEET_ID;
  if (!id) {
    throw new Error('MEMBERS_SPREADSHEET_ID environment variable is not set');
  }
  return id;
}

function getMatchDayContactsSpreadsheetId(): string {
  const id = process.env.MATCH_DAY_CONTACTS_SPREADSHEET_ID;
  if (!id) {
    throw new Error('MATCH_DAY_CONTACTS_SPREADSHEET_ID environment variable is not set');
  }
  return id;
}

function getServiceAccountEmail(): string {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL environment variable is not set');
  }
  return email;
}

function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!key) {
    throw new Error('GOOGLE_PRIVATE_KEY environment variable is not set');
  }
  return key.replace(/\\n/g, '\n');
}

// ============================================================================
// GOOGLE SHEETS CLIENT
// ============================================================================

export function getSheetsClient() {
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
// UTILITY FUNCTIONS
// ============================================================================

export function getColumnLetter(index: number): string {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
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

/**
 * Get column mapping from header row
 * Caches result to avoid repeated API calls
 */
async function getColumnMap(
  spreadsheetId: string,
  sheetName: string
): Promise<{ [key: string]: number }> {
  // Check cache
  if (columnMapCache[spreadsheetId]?.[sheetName]) {
    return columnMapCache[spreadsheetId][sheetName];
  }

  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`, // Header row
  });

  const headers = response.data.values?.[0] || [];
  const map: { [key: string]: number } = {};

  headers.forEach((header, index) => {
    // Normalize header: lowercase, replace spaces with underscores
    const normalized = String(header)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/\//g, '_'); // Handle "Ladies/Men" -> "ladies_men"
    map[normalized] = index;
  });

  // Cache the result
  if (!columnMapCache[spreadsheetId]) {
    columnMapCache[spreadsheetId] = {};
  }
  columnMapCache[spreadsheetId][sheetName] = map;

  return map;
}

/**
 * Clear column map cache (call after schema changes)
 */
export function clearColumnMapCache() {
  columnMapCache = {};
}

// ============================================================================
// GAMES SHEET OPERATIONS
// ============================================================================

/**
 * Get all games from Games sheet, optionally filtered by status
 */
export async function getGames(statusFilter?: GameStatus): Promise<Game[]> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Games');
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Games!A2:ZZ', // Get all columns
  });

  const rows = response.data.values || [];

  const get = (row: any[], field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || null) : null;
  };

  const getInt = (row: any[], field: string): number => {
    const val = get(row, field);
    return val ? parseInt(val) : 0;
  };

  const games = rows.map((row, index) => ({
    rowNumber: index + 2,
    date: get(row, 'date') || '',
    tabDate: get(row, 'tab_date') || '',
    time: get(row, 'time') || '',
    clubName: get(row, 'club_name') || '',
    homeAway: (get(row, 'home_away') || 'H') as 'H' | 'A',
    format: get(row, 'format') || '',
    ladiesMen: get(row, 'ladies_men') || '',
    dress: get(row, 'dress') || '',
    league: get(row, 'league') || '',
    tabName: get(row, 'tab_name') || '',
    status: (get(row, 'status') || '') as GameStatus,
    include: get(row, 'include') || undefined,
    entered: getInt(row, 'entered'),
    selected: getInt(row, 'selected'),
    reserves: getInt(row, 'reserves'),
    bhbcScore: get(row, 'bhbc_score') ? parseInt(get(row, 'bhbc_score')!) : null,
    opponentScore: get(row, 'opponent_score') ? parseInt(get(row, 'opponent_score')!) : null,
    reason: get(row, 'reason') || '',
    who: get(row, 'who') || '',
    lastModifiedBy: get(row, 'last_modified_by') || '',
    lastModifiedDate: get(row, 'last_modified_date') || '',
  }));

  if (statusFilter !== undefined) {
    return games.filter(game => game.status === statusFilter);
  }

  return games;
}

/**
 * Update game status and related fields
 */
export async function updateGameStatus(
  tabDate: string,
  newStatus: GameStatus,
  additionalData?: {
    bhbcScore?: number;
    opponentScore?: number;
    reason?: string;
    who?: string;
    modifiedBy?: string;
  }
): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Games');
  const sheets = getSheetsClient();

  // Find the row for this game
  const games = await getGames();
  const game = games.find(g => g.tabDate === tabDate);
  if (!game) throw new Error(`Game not found: ${tabDate}`);

  // Build update data
  const updates: any[] = [
    {
      range: `Games!${getColumnLetter(colMap['status'])}${game.rowNumber}`,
      values: [[newStatus]],
    },
  ];

  if (additionalData?.bhbcScore !== undefined) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['bhbc_score'])}${game.rowNumber}`,
      values: [[additionalData.bhbcScore]],
    });
  }

  if (additionalData?.opponentScore !== undefined) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['opponent_score'])}${game.rowNumber}`,
      values: [[additionalData.opponentScore]],
    });
  }

  if (additionalData?.reason) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['reason'])}${game.rowNumber}`,
      values: [[additionalData.reason]],
    });
  }

  if (additionalData?.who) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['who'])}${game.rowNumber}`,
      values: [[additionalData.who]],
    });
  }

  if (additionalData?.modifiedBy) {
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

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getFriendliesSpreadsheetId(),
    requestBody: {
      data: updates,
      valueInputOption: 'USER_ENTERED',
    },
  });
}

/**
 * Update game counts (entered, selected, reserves)
 */
export async function updateGameCounts(
  tabDate: string,
  counts: {
    entered?: number;
    selected?: number;
    reserves?: number;
  }
): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Games');
  const sheets = getSheetsClient();
  const games = await getGames();
  const game = games.find(g => g.tabDate === tabDate);
  if (!game) throw new Error(`Game not found: ${tabDate}`);

  const updates: any[] = [];

  if (counts.entered !== undefined) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['entered'])}${game.rowNumber}`,
      values: [[counts.entered]],
    });
  }

  if (counts.selected !== undefined) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['selected'])}${game.rowNumber}`,
      values: [[counts.selected]],
    });
  }

  if (counts.reserves !== undefined) {
    updates.push({
      range: `Games!${getColumnLetter(colMap['reserves'])}${game.rowNumber}`,
      values: [[counts.reserves]],
    });
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getFriendliesSpreadsheetId(),
      requestBody: {
        data: updates,
        valueInputOption: 'USER_ENTERED',
      },
    });
  }
}

// ============================================================================
// PLAYERS SHEET OPERATIONS
// ============================================================================

/**
 * Create a new game column in Players sheet
 */
export async function createGameColumn(tabName: string): Promise<void> {
  const sheets = getSheetsClient();

  // Get current headers to find the next empty column
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getFriendliesSpreadsheetId(),
    range: 'Players!1:1',
  });

  const headers = response.data.values?.[0] || [];
  const nextColumn = getColumnLetter(headers.length);

  // Add header
  await sheets.spreadsheets.values.update({
    spreadsheetId: getFriendliesSpreadsheetId(),
    range: `Players!${nextColumn}1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[tabName]],
    },
  });
}

/**
 * Get the lookup value for a user in the Players sheet
 * Returns full_name if Players sheet uses full_name column, otherwise userName
 */
async function getPlayerLookupValue(userName: string, spreadsheetId: string, colMap: { [key: string]: number }): Promise<string> {
  console.log(`Players sheet column map:`, Object.keys(colMap));

  // If Players sheet has user_name column, use userName directly
  if (colMap['user_name'] !== undefined) {
    console.log(`Players sheet has user_name column at index ${colMap['user_name']}, using userName: ${userName}`);
    return userName;
  }

  // If Players sheet has full_name, name, or similar column, get full_name from Members sheet
  const nameColumn = colMap['full_name'] ?? colMap['name'];
  if (nameColumn !== undefined) {
    console.log(`Players sheet has name column at index ${nameColumn}, looking up full name for ${userName} in Members sheet`);
    const sheets = getSheetsClient();
    const membersSpreadsheetId = getMembersSpreadsheetId();
    const membersColMap = await getColumnMap(membersSpreadsheetId, 'Members');

    console.log(`Members sheet columns:`, Object.keys(membersColMap));

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: membersSpreadsheetId,
      range: 'Members!A:ZZ',
    });

    const rows = response.data.values || [];
    const userNameCol = membersColMap['user_name'] ?? 0;
    const fullNameCol = membersColMap['full_name'] ?? membersColMap['name'] ?? 1;

    console.log(`Searching for userName "${userName}" in Members column ${userNameCol}, will get full_name from column ${fullNameCol}`);
    console.log(`Found ${rows.length} rows in Members sheet`);

    const memberRow = rows.find((row, index) => index > 0 && row[userNameCol] === userName);
    if (memberRow && memberRow[fullNameCol]) {
      console.log(`Found member: ${memberRow[fullNameCol]}`);
      return memberRow[fullNameCol];
    } else {
      console.log(`Member not found for userName: ${userName}, memberRow:`, memberRow);
    }
  } else {
    console.log(`Players sheet has no user_name, full_name, or name column, using userName: ${userName}`);
  }

  // Fall back to userName
  console.log(`Falling back to userName: ${userName}`);
  return userName;
}

/**
 * Get player entries for a specific user
 */
export async function getPlayerEntries(userName: string): Promise<PlayerEntry[]> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Players');
  const sheets = getSheetsClient();

  // Get the appropriate lookup value (userName or full_name)
  const lookupValue = await getPlayerLookupValue(userName, spreadsheetId, colMap);

  // Get all data from Players sheet
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!A:ZZ',
  });

  const rows = response.data.values || [];
  const headers = rows[0] || [];

  // Determine which column to search in
  let userNameCol = colMap['user_name'] ?? colMap['full_name'] ?? colMap['name'] ?? 0;

  const userRowIndex = rows.findIndex((row, index) => index > 0 && row[userNameCol] === lookupValue);

  if (userRowIndex === -1) {
    console.log(`User not found in Players sheet. Looking for "${lookupValue}" in column ${userNameCol}`);
    console.log(`First few values in that column:`, rows.slice(1, 6).map(r => r[userNameCol]));
    return [];
  }

  console.log(`Found user at row ${userRowIndex}, lookupValue: "${lookupValue}"`);
  const userRow = rows[userRowIndex];
  console.log(`User row has ${userRow.length} columns`);

  // Fixed columns in Players sheet (not game columns)
  const fixedColumnNames = ['name', 'name_down', 'picked', '%_played_vs_name_down', 'withdrawn', 'cancelled'];
  const fixedColumns = new Set(
    fixedColumnNames
      .map(name => colMap[name])
      .filter(idx => idx !== undefined)
  );
  console.log(`Fixed columns (indices):`, Array.from(fixedColumns).sort((a, b) => a - b));
  console.log(`Total headers: ${headers.length}`);

  const entries: PlayerEntry[] = [];
  let gameColumnsChecked = 0;
  for (let i = 0; i < headers.length; i++) {
    // Skip fixed columns, only process game columns
    if (!fixedColumns.has(i) && headers[i]) {
      gameColumnsChecked++;
      if (userRow[i]) {
        console.log(`Found entry at column ${i} (${headers[i]}): ${userRow[i]}`);
        entries.push({
          tabName: headers[i],
          status: userRow[i] as PlayerEntryStatus,
        });
      }
    }
  }

  console.log(`Checked ${gameColumnsChecked} game columns, found ${entries.length} entries for ${lookupValue}`);
  if (entries.length > 0) {
    console.log(`First few entries:`, entries.slice(0, 3));
  }

  return entries;
}

/**
 * Update player entry status for a specific game
 */
export async function updatePlayerEntry(
  userName: string,
  tabName: string,
  status: PlayerEntryStatus | ''
): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Players');
  const sheets = getSheetsClient();

  // Get the appropriate lookup value (userName or full_name)
  const lookupValue = await getPlayerLookupValue(userName, spreadsheetId, colMap);

  // Get headers to find the column for this game
  const headersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!1:1',
  });

  const headers = headersResponse.data.values?.[0] || [];
  const gameColumnIndex = headers.findIndex(h => h === tabName);

  if (gameColumnIndex === -1) {
    throw new Error(`Game column not found: ${tabName}`);
  }

  // Determine which column to search in
  let userNameCol = colMap['user_name'] ?? colMap['full_name'] ?? colMap['name'] ?? 0;

  const userNameColLetter = getColumnLetter(userNameCol);

  const playersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `Players!${userNameColLetter}:${userNameColLetter}`,
  });

  const players = playersResponse.data.values || [];
  const userRowIndex = players.findIndex((row, index) => index > 0 && row[0] === lookupValue);

  if (userRowIndex === -1) {
    throw new Error(`User not found: ${lookupValue} (userName: ${userName}, searched in column ${userNameColLetter})`);
  }

  // Convert column index to letter
  const columnLetter = getColumnLetter(gameColumnIndex);
  const rowNumber = userRowIndex + 1;

  // Update the cell
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Players!${columnLetter}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[status]],
    },
  });
}

/**
 * Get player stats from Players sheet
 */
export async function getPlayerStats(userName: string): Promise<PlayerStats> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Players');
  const sheets = getSheetsClient();

  // Get player row
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!A:ZZ',
  });

  const rows = response.data.values || [];
  const headers = rows[0] || [];

  const userNameCol = colMap['user_name'] !== undefined ? colMap['user_name'] : 0;
  const userRowIndex = rows.findIndex((row, index) => index > 0 && row[userNameCol] === userName);

  if (userRowIndex === -1) {
    throw new Error(`User not found: ${userName}`);
  }

  const userRow = rows[userRowIndex];

  const get = (field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (userRow[index] || null) : null;
  };

  const getInt = (field: string): number => {
    const val = get(field);
    return val ? parseInt(val) : 0;
  };

  const getFloat = (field: string): number => {
    const val = get(field);
    return val ? parseFloat(val) : 0;
  };

  // Get stats from dynamic columns
  const stats: PlayerStats = {
    nameDown: getInt('name_down'),
    picked: getInt('picked'),
    percentPlayed: getFloat('percent_played'),
    withdrawn: getInt('withdrawn'),
    cancelled: getInt('cancelled'),
    last6Games: [],
  };

  // Get last 6 games (any column that's not in the fixed columns, working backwards)
  const fixedColumns = new Set(Object.values(colMap));
  const last6Games: string[] = [];
  for (let i = headers.length - 1; i >= 0 && last6Games.length < 6; i--) {
    if (!fixedColumns.has(i) && headers[i] && userRow[i]) {
      last6Games.push(userRow[i]);
    }
  }

  stats.last6Games = last6Games.reverse();

  return stats;
}

// ============================================================================
// GAME SHEET OPERATIONS
// ============================================================================

/**
 * Create individual game sheet from template
 */
export async function createGameSheet(tabDate: string, tabName: string): Promise<{ enteredCount: number }> {
  const sheets = getSheetsClient();

  // Get the game details
  const games = await getGames();
  const game = games.find(g => g.tabDate === tabDate);
  if (!game) throw new Error(`Game not found: ${tabDate}`);

  // Get template sheet ID and Games sheet index
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: getFriendliesSpreadsheetId(),
  });

  const templateSheet = spreadsheet.data.sheets?.find(
    sheet => sheet.properties?.title === 'Template Match Picker'
  );

  if (!templateSheet?.properties?.sheetId) {
    throw new Error('Template sheet not found');
  }

  // Find Games sheet index to insert new sheet after it
  const gamesSheetIndex = spreadsheet.data.sheets?.findIndex(
    sheet => sheet.properties?.title === 'Games'
  );

  const insertIndex = gamesSheetIndex !== undefined && gamesSheetIndex !== -1
    ? gamesSheetIndex + 1
    : undefined;

  // Duplicate the template
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getFriendliesSpreadsheetId(),
    requestBody: {
      requests: [
        {
          duplicateSheet: {
            sourceSheetId: templateSheet.properties.sheetId,
            insertSheetIndex: insertIndex,
            newSheetName: tabName,
          },
        },
      ],
    },
  });

  // Get all players who entered (status = 'E' in Players sheet)
  const playersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: getFriendliesSpreadsheetId(),
    range: 'Players!A:ZZ',
  });

  const rows = playersResponse.data.values || [];
  const headers = rows[0] || [];
  const gameColumnIndex = headers.findIndex(h => h === tabName);

  if (gameColumnIndex === -1) {
    throw new Error(`Game column not found: ${tabName}`);
  }

  // Filter players who entered
  const enteredPlayers: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][gameColumnIndex] === 'E') {
      enteredPlayers.push(rows[i][0]); // Player name
    }
  }

  // Add players to game sheet starting at row 2
  if (enteredPlayers.length > 0) {
    const playerValues = enteredPlayers.sort().map(name => [name]);

    await sheets.spreadsheets.values.update({
      spreadsheetId: getFriendliesSpreadsheetId(),
      range: `'${tabName}'!A2:A${1 + playerValues.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: playerValues,
      },
    });
  }

  // Update Games sheet entered count
  await updateGameCounts(tabDate, { entered: enteredPlayers.length });

  return { enteredCount: enteredPlayers.length };
}

/**
 * Get game sheet data for captain selection
 */
export async function getGameSheet(tabName: string): Promise<GameSheetPlayer[]> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, tabName);
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:ZZ`, // Get all columns
  });

  const rows = response.data.values || [];

  const get = (row: any[], field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || null) : null;
  };

  const getInt = (row: any[], field: string): number => {
    const val = get(row, field);
    return val ? parseInt(val) : 0;
  };

  const getFloat = (row: any[], field: string): number => {
    const val = get(row, field);
    return val ? parseFloat(val) : 0;
  };

  const players = rows.map((row, index) => ({
    rowNumber: index + 2,
    name: get(row, 'name') || '',
    nameDown: getInt(row, 'name_down'),
    picked: getInt(row, 'picked'),
    percentPlayed: getFloat(row, 'percent_played'),
    driverBar: get(row, 'driver_bar') || '',
    selected: (get(row, 'selected') || '') as '' | 'Y' | 'R' | 'T',
    team: get(row, 'team') ? parseInt(get(row, 'team')!) : null,
    position: (get(row, 'position') || '') as '' | 'S' | '1' | '2' | '3',
    driving: get(row, 'driving') || '',
    carNumber: get(row, 'car_number') || '',
    status: (get(row, 'status') || '') as '' | 'Y' | 'W',
    captain: get(row, 'captain') || '',
  }));

  return players;
}

/**
 * Update game sheet with selection data
 */
export async function updateGameSheet(
  tabName: string,
  players: Array<{
    rowNumber: number;
    selected?: string;
    team?: number | null;
    position?: string;
    driving?: string;
    carNumber?: string;
    status?: string;
    captain?: string;
  }>
): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, tabName);
  const sheets = getSheetsClient();

  const updates: any[] = [];

  for (const player of players) {
    if (player.selected !== undefined) {
      updates.push({
        range: `'${tabName}'!${getColumnLetter(colMap['selected'])}${player.rowNumber}`,
        values: [[player.selected]],
      });
    }
    if (player.team !== undefined) {
      updates.push({
        range: `'${tabName}'!${getColumnLetter(colMap['team'])}${player.rowNumber}`,
        values: [[player.team || '']],
      });
    }
    if (player.position !== undefined) {
      updates.push({
        range: `'${tabName}'!${getColumnLetter(colMap['position'])}${player.rowNumber}`,
        values: [[player.position]],
      });
    }
    if (player.driving !== undefined) {
      updates.push({
        range: `'${tabName}'!${getColumnLetter(colMap['driving'])}${player.rowNumber}`,
        values: [[player.driving]],
      });
    }
    if (player.carNumber !== undefined) {
      updates.push({
        range: `'${tabName}'!${getColumnLetter(colMap['car_number'])}${player.rowNumber}`,
        values: [[player.carNumber]],
      });
    }
    if (player.status !== undefined) {
      updates.push({
        range: `'${tabName}'!${getColumnLetter(colMap['status'])}${player.rowNumber}`,
        values: [[player.status]],
      });
    }
    if (player.captain !== undefined) {
      updates.push({
        range: `'${tabName}'!${getColumnLetter(colMap['captain'])}${player.rowNumber}`,
        values: [[player.captain]],
      });
    }
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getFriendliesSpreadsheetId(),
      requestBody: {
        data: updates,
        valueInputOption: 'USER_ENTERED',
      },
    });
  }
}

/**
 * Update stats in game sheet for all players
 */
export async function updateGameSheetStats(tabName: string): Promise<number> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, tabName);
  const sheets = getSheetsClient();

  // Get all players from game sheet
  const players = await getGameSheet(tabName);

  const updates: any[] = [];

  for (const player of players) {
    // Get stats for this player
    const stats = await getPlayerStats(player.name);
    const driverBar = await getDriverBarInfo(player.name);

    // Update stats columns dynamically
    const nameDownCol = getColumnLetter(colMap['name_down']);
    const driverBarCol = getColumnLetter(colMap['driver_bar']);

    updates.push({
      range: `'${tabName}'!${nameDownCol}${player.rowNumber}:${driverBarCol}${player.rowNumber}`,
      values: [[
        stats.nameDown,
        stats.picked,
        stats.percentPlayed,
        driverBar.code,
      ]],
    });

    // Add note to name cell with last 6 games
    if (stats.last6Games.length > 0) {
      // Notes are added via a separate API call
      // For now, we'll skip this and handle it in a future enhancement
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

  return players.length;
}

/**
 * Add a player to an existing game sheet
 */
export async function addPlayerToGameSheet(
  tabName: string,
  userName: string
): Promise<void> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, tabName);
  const sheets = getSheetsClient();

  // Get current players to find insert position
  const currentPlayers = await getGameSheet(tabName);
  const nextRow = currentPlayers.length > 0
    ? currentPlayers[currentPlayers.length - 1].rowNumber + 1
    : 2;

  // Add player name
  const nameCol = getColumnLetter(colMap['name']);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!${nameCol}${nextRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[userName]],
    },
  });

  // Get stats for the new player
  const stats = await getPlayerStats(userName);
  const driverBar = await getDriverBarInfo(userName);

  // Update stats in game sheet
  const nameDownCol = getColumnLetter(colMap['name_down']);
  const driverBarCol = getColumnLetter(colMap['driver_bar']);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!${nameDownCol}${nextRow}:${driverBarCol}${nextRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        stats.nameDown,
        stats.picked,
        stats.percentPlayed,
        driverBar.code,
      ]],
    },
  });

  // Update Players sheet
  await updatePlayerEntry(userName, tabName, 'E');
}

// ============================================================================
// MEMBERS SHEET OPERATIONS
// ============================================================================

/**
 * Get driver/bar info from Members sheet
 */
export async function getDriverBarInfo(userName: string): Promise<DriverBarInfo> {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getMembersSpreadsheetId(),
    range: 'Members!1:1000', // Get all data
  });

  const rows = response.data.values || [];
  const headers = rows[0] || [];

  // Find column indices
  const userNameCol = headers.findIndex(h =>
    h.toLowerCase().replace(/\s+/g, '_') === 'user_name'
  );
  const drivingCol = headers.findIndex(h =>
    h.toLowerCase().replace(/\s+/g, '_') === 'driving_away_matches'
  );
  const barCol = headers.findIndex(h =>
    h.toLowerCase().replace(/\s+/g, '_') === 'bar_duty'
  );

  if (userNameCol === -1) {
    throw new Error('user_name column not found in Members sheet');
  }

  // Find user row
  const userRow = rows.find((row, index) =>
    index > 0 && row[userNameCol] === userName
  );

  if (!userRow) {
    return { driver: false, bar: false, code: '' };
  }

  const driver = drivingCol !== -1 &&
    (userRow[drivingCol]?.toLowerCase() === 'yes' || userRow[drivingCol]?.toLowerCase() === 'y');
  const bar = barCol !== -1 &&
    (userRow[barCol]?.toLowerCase() === 'yes' || userRow[barCol]?.toLowerCase() === 'y');

  let code = '';
  if (driver && bar) code = 'DB';
  else if (driver) code = 'D';
  else if (bar) code = 'B';

  return { driver, bar, code };
}

/**
 * Get tea rota for a specific game
 */
export async function getTeaRota(
  date: string,
  time: string,
  clubName: string
): Promise<TeaRota | null> {
  const spreadsheetId = getMembersSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Tea Rota');
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Tea Rota!A:ZZ',
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return null;

  const get = (row: any[], field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || null) : null;
  };

  // Find matching row by date, time, and club name
  const matchingRow = rows.find((row, index) => {
    if (index === 0) return false; // Skip header

    const rowDate = get(row, 'date');
    const rowTime = get(row, 'time');
    const rowClub = get(row, 'club_name');

    // Flexible date matching - extract day/month from both formats
    const dateParts = date.split('-'); // e.g., "2025-04-27"
    const month = dateParts[1] ? parseInt(dateParts[1]) : 0;
    const day = dateParts[2] ? parseInt(dateParts[2]) : 0;

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[month - 1];

    const dateMatch = rowDate && monthName &&
      (rowDate.includes(`${day} ${monthName}`) || rowDate.includes(`${day} ${monthName.substring(0, 3)}`));
    const timeMatch = rowTime === time;
    const clubMatch = rowClub === clubName;

    return dateMatch && timeMatch && clubMatch;
  });

  if (!matchingRow) return null;

  return {
    date: get(matchingRow, 'date') || '',
    time: get(matchingRow, 'time') || '',
    clubName: get(matchingRow, 'club_name') || '',
    ladiesMen: get(matchingRow, 'ladies_men') || '',
    format: get(matchingRow, 'format') || '',
    lead: get(matchingRow, 'lead') || '',
    second: get(matchingRow, 'second') || '',
    third: get(matchingRow, 'third') || '',
    shortLead: get(matchingRow, 'short_lead') || '',
    shortSecond: get(matchingRow, 'short_second') || '',
    shortThird: get(matchingRow, 'short_third') || '',
  };
}

// ============================================================================
// MATCH DAY CONTACTS OPERATIONS
// ============================================================================

/**
 * Get club details for away games
 */
export async function getClubDetails(clubName: string): Promise<ClubDetails | null> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'clubs');
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'clubs!A:ZZ',
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return null;

  const get = (row: any[], field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || null) : null;
  };

  // Find matching row by club name
  const matchingRow = rows.find((row, index) => {
    if (index === 0) return false; // Skip header
    return get(row, 'club_name') === clubName;
  });

  if (!matchingRow) return null;

  // Map driving band to cost
  const drivingBandMap: { [key: string]: number } = {
    'A': 2.00,
    'B': 3.00,
    'C': 4.00,
    'D': 5.00,
  };

  const drivingBand = get(matchingRow, 'driving_band') || '';
  const petrolCost = drivingBandMap[drivingBand] || 0;

  return {
    clubName: get(matchingRow, 'club_name') || '',
    clubNumber: get(matchingRow, 'club_number') || '',
    clubMobile: get(matchingRow, 'club_mobile') || '',
    clubEmail: get(matchingRow, 'club_email') || '',
    clubEmailNote: get(matchingRow, 'club_email_note') || '',
    generalInfo: get(matchingRow, 'general_info') || '',
    drivingBand: drivingBand,
    petrolCost: petrolCost,
    address1: get(matchingRow, 'address_1') || '',
    address2: get(matchingRow, 'address_2') || '',
    address3: get(matchingRow, 'address_3') || '',
    address4: get(matchingRow, 'address_4') || '',
    postCode: get(matchingRow, 'post_code') || '',
    googleAddress: get(matchingRow, 'google_address') || '',
    bowlsEnglandUrl: get(matchingRow, 'bowls_england_url') || '',
    website: get(matchingRow, 'website') || '',
    bhWebsite: get(matchingRow, 'bh_website') || '',
    latitude: get(matchingRow, 'latitude') || '',
    longitude: get(matchingRow, 'longitude') || '',
  };
}

/**
 * Get club contacts for away games
 */
export async function getClubContacts(clubName: string): Promise<ClubContact[]> {
  const spreadsheetId = getMatchDayContactsSpreadsheetId();
  const colMap = await getColumnMap(spreadsheetId, 'Contacts');
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Contacts!A:ZZ',
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return [];

  const get = (row: any[], field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || null) : null;
  };

  // Find all contacts for this club
  const clubContacts = rows
    .filter((row, index) => {
      if (index === 0) return false; // Skip header
      return get(row, 'club_name') === clubName;
    })
    .map(row => ({
      clubName: get(row, 'club_name') || '',
      role: get(row, 'role') || '',
      firstName: get(row, 'first_name') || '',
      lastName: get(row, 'last_name') || '',
      name: get(row, 'name') || '',
      phoneNumber: get(row, 'phone_number') || '',
      mobileNumber: get(row, 'mobile_number') || '',
      notes: get(row, 'notes') || '',
      email: get(row, 'email') || '',
    }));

  // Sort by role preference (Captain first, then Secretary, then others)
  const roleOrder: { [key: string]: number } = {
    'Captain': 1,
    'Secretary': 2,
  };

  clubContacts.sort((a, b) => {
    const aOrder = roleOrder[a.role] || 99;
    const bOrder = roleOrder[b.role] || 99;
    return aOrder - bOrder;
  });

  return clubContacts;
}
