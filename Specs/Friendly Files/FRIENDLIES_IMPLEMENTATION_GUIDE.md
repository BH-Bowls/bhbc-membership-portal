# Friendlies System - Implementation Guide

This guide provides detailed implementation instructions for integrating the Friendlies feature into the existing Next.js membership portal.

## Table of Contents
1. [File Structure](#file-structure)
2. [Database Schema Extensions](#database-schema-extensions)
3. [Google Sheets Integration](#google-sheets-integration)
4. [API Routes Implementation](#api-routes-implementation)
5. [UI Components](#ui-components)
6. [Integration with Existing Auth](#integration-with-existing-auth)
7. [Code Examples](#code-examples)

---

## 1. File Structure

Add the following files to your existing Next.js project:

```
/app
  /friendlies
    /page.tsx                          # Player: View available games
    /game
      /[tabDate]
        /page.tsx                      # Player: View game details
    /manage
      /page.tsx                        # Captain: Manage games list
      /game
        /[tabDate]
          /page.tsx                    # Captain: Team selection
    /match-card
      /[tabDate]
        /page.tsx                      # Print match card

/app/api
  /friendlies
    /games
      /route.ts                        # GET: List games
    /enter
      /route.ts                        # POST: Enter games
    /game
      /[tabDate]
        /route.ts                      # GET: Game details for player
    /confirm
      /route.ts                        # POST: Confirm participation
    /withdraw
      /route.ts                        # POST: Withdraw from game
    /manage
      /games
        /route.ts                      # GET: List games for captain
      /status
        /route.ts                      # POST: Change game status
      /game
        /[tabDate]
          /route.ts                    # GET: Game for selection
      /get-stats
        /route.ts                      # POST: Get player stats
      /add-player
        /route.ts                      # POST: Add offline player
      /update-selection
        /route.ts                      # POST: Update team selection
      /update-stats
        /route.ts                      # POST: Update player stats
    /match-card
      /[tabDate]
        /route.ts                      # GET: Match card data

/lib
  /sheets
    /friendlies.ts                     # Google Sheets operations
  /email
    /friendlies.ts                     # Email notifications
  /types
    /friendlies.ts                     # TypeScript types

/components
  /friendlies
    /GameCard.tsx                      # Game card component
    /GameList.tsx                      # List of games
    /TeamSelectionTable.tsx            # Captain team selection UI
    /StatusChangeModal.tsx             # Change game status modal
    /MatchCard.tsx                     # Match card template
    /PlayerStatsDisplay.tsx            # Player stats display
```

---

## 2. Database Schema Extensions

### 2.1 Update Google Sheets Structure

#### Friendlies Spreadsheet

**Games Sheet - Add Columns:**
```
Column P: BHBC Score (Number)
Column Q: Opponent Score (Number)
Column R: Reason (Text)
Column S: Who (Text)
Column T: Last Modified By (Text)
Column U: Last Modified Date (Timestamp)
```

**Individual Game Sheets - Modify:**
- Remove row 2 totals (will display in UI instead)
- Add Column L: Captain (Y/blank)
- Keep columns A-K as specified in technical spec

### 2.2 Members Sheet

Ensure these columns exist:
- `role` (Player/Captain/Admin/Treasurer)
- `driving_away_matches` (Yes/No)
- `bar_duty` (Yes/No)

---

## 3. Google Sheets Integration

### 3.1 Create Friendlies Sheets Client

Create `/lib/sheets/friendlies.ts`:

```typescript
import { google } from 'googleapis';
import { getAuthClient } from './auth';

const FRIENDLIES_SPREADSHEET_ID = process.env.FRIENDLIES_SPREADSHEET_ID!;
const MEMBERS_SPREADSHEET_ID = process.env.MEMBERS_SPREADSHEET_ID!;

// Initialize Google Sheets API
async function getSheetsClient() {
  const auth = await getAuthClient();
  return google.sheets({ version: 'v4', auth });
}

// Get Games sheet data
export async function getGames(statusFilter?: string) {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
    range: 'Games!A2:U', // Include all columns up to Last Modified Date
  });

  const rows = response.data.values || [];
  const games = rows.map((row, index) => ({
    rowNumber: index + 2,
    date: row[0],
    tabDate: row[1],
    time: row[2],
    clubName: row[3],
    homeAway: row[4],
    format: row[5],
    ladiesMen: row[6],
    dress: row[7],
    league: row[8],
    tabName: row[9],
    status: row[10] || '',
    include: row[11],
    entered: parseInt(row[12]) || 0,
    selected: parseInt(row[13]) || 0,
    reserves: parseInt(row[14]) || 0,
    bhbcScore: row[15] ? parseInt(row[15]) : null,
    opponentScore: row[16] ? parseInt(row[16]) : null,
    reason: row[17] || '',
    who: row[18] || '',
    lastModifiedBy: row[19] || '',
    lastModifiedDate: row[20] || '',
  }));

  if (statusFilter) {
    return games.filter(game => game.status === statusFilter);
  }

  return games;
}

// Update game status
export async function updateGameStatus(
  tabDate: string,
  newStatus: string,
  additionalData?: {
    bhbcScore?: number;
    opponentScore?: number;
    reason?: string;
    who?: string;
    modifiedBy?: string;
  }
) {
  const sheets = await getSheetsClient();
  
  // Find the row for this game
  const games = await getGames();
  const game = games.find(g => g.tabDate === tabDate);
  if (!game) throw new Error(`Game not found: ${tabDate}`);

  // Build update data
  const updates = [
    {
      range: `Games!K${game.rowNumber}`,
      values: [[newStatus]],
    },
  ];

  if (additionalData?.bhbcScore !== undefined) {
    updates.push({
      range: `Games!P${game.rowNumber}`,
      values: [[additionalData.bhbcScore]],
    });
  }

  if (additionalData?.opponentScore !== undefined) {
    updates.push({
      range: `Games!Q${game.rowNumber}`,
      values: [[additionalData.opponentScore]],
    });
  }

  if (additionalData?.reason) {
    updates.push({
      range: `Games!R${game.rowNumber}`,
      values: [[additionalData.reason]],
    });
  }

  if (additionalData?.who) {
    updates.push({
      range: `Games!S${game.rowNumber}`,
      values: [[additionalData.who]],
    });
  }

  if (additionalData?.modifiedBy) {
    updates.push(
      {
        range: `Games!T${game.rowNumber}`,
        values: [[additionalData.modifiedBy]],
      },
      {
        range: `Games!U${game.rowNumber}`,
        values: [[new Date().toISOString()]],
      }
    );
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
    requestBody: {
      data: updates,
      valueInputOption: 'USER_ENTERED',
    },
  });
}

// Create game column in Players sheet
export async function createGameColumn(tabDate: string) {
  const sheets = await getSheetsClient();
  
  // Get current headers to find the next empty column
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
    range: 'Players!1:1',
  });

  const headers = response.data.values?.[0] || [];
  const nextColumn = String.fromCharCode(65 + headers.length); // Convert to column letter

  // Add header
  await sheets.spreadsheets.values.update({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
    range: `Players!${nextColumn}1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[tabDate]],
    },
  });
}

// Get player entries for a specific user
export async function getPlayerEntries(userName: string) {
  const sheets = await getSheetsClient();
  
  // Get all data from Players sheet
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
    range: 'Players!A:ZZ', // Get all columns
  });

  const rows = response.data.values || [];
  const headers = rows[0];
  
  // Find the row for this user
  const userRowIndex = rows.findIndex((row, index) => 
    index > 0 && row[0] === userName
  );

  if (userRowIndex === -1) {
    throw new Error(`User not found: ${userName}`);
  }

  const userRow = rows[userRowIndex];
  
  // Map game columns (starting from column G, index 6)
  const entries: { tabDate: string; status: string }[] = [];
  for (let i = 6; i < headers.length; i++) {
    if (userRow[i]) {
      entries.push({
        tabDate: headers[i],
        status: userRow[i],
      });
    }
  }

  return entries;
}

// Update player entry status
export async function updatePlayerEntry(
  userName: string,
  tabDate: string,
  status: string
) {
  const sheets = await getSheetsClient();
  
  // Get headers to find the column for this game
  const headersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
    range: 'Players!1:1',
  });

  const headers = headersResponse.data.values?.[0] || [];
  const gameColumnIndex = headers.findIndex(h => h === tabDate);
  
  if (gameColumnIndex === -1) {
    throw new Error(`Game column not found: ${tabDate}`);
  }

  // Get all player names to find the row
  const playersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
    range: 'Players!A:A',
  });

  const players = playersResponse.data.values || [];
  const userRowIndex = players.findIndex((row, index) => 
    index > 0 && row[0] === userName
  );

  if (userRowIndex === -1) {
    throw new Error(`User not found: ${userName}`);
  }

  // Convert column index to letter
  const columnLetter = String.fromCharCode(65 + gameColumnIndex);
  const rowNumber = userRowIndex + 1;

  // Update the cell
  await sheets.spreadsheets.values.update({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
    range: `Players!${columnLetter}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[status]],
    },
  });
}

// Create individual game sheet
export async function createGameSheet(tabDate: string, tabName: string) {
  const sheets = await getSheetsClient();
  
  // Get the game details
  const games = await getGames();
  const game = games.find(g => g.tabDate === tabDate);
  if (!game) throw new Error(`Game not found: ${tabDate}`);

  // Copy the Template sheet
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
  });

  const templateSheet = spreadsheet.data.sheets?.find(
    sheet => sheet.properties?.title === 'Template Match Picker'
  );

  if (!templateSheet?.properties?.sheetId) {
    throw new Error('Template sheet not found');
  }

  // Duplicate the template
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          duplicateSheet: {
            sourceSheetId: templateSheet.properties.sheetId,
            newSheetName: tabName,
          },
        },
      ],
    },
  });

  // Get all players who entered (status = 'E' in Players sheet)
  const playersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
    range: 'Players!A:ZZ',
  });

  const rows = playersResponse.data.values || [];
  const headers = rows[0];
  const gameColumnIndex = headers.findIndex(h => h === tabDate);

  if (gameColumnIndex === -1) {
    throw new Error(`Game column not found: ${tabDate}`);
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
      spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
      range: `'${tabName}'!A2:A${1 + playerValues.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: playerValues,
      },
    });
  }

  // Update Games sheet entered count
  await sheets.spreadsheets.values.update({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
    range: `Games!M${game.rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[enteredPlayers.length]],
    },
  });

  return { enteredCount: enteredPlayers.length };
}

// Get game sheet data for captain selection
export async function getGameSheet(tabName: string) {
  const sheets = await getSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
    range: `'${tabName}'!A2:L`, // All player data columns
  });

  const rows = response.data.values || [];
  
  const players = rows.map((row, index) => ({
    rowNumber: index + 2,
    name: row[0] || '',
    nameDown: row[1] ? parseInt(row[1]) : 0,
    picked: row[2] ? parseInt(row[2]) : 0,
    percentPlayed: row[3] ? parseFloat(row[3]) : 0,
    driverBar: row[4] || '',
    selected: row[5] || '',
    team: row[6] ? parseInt(row[6]) : null,
    position: row[7] || '',
    driving: row[8] || '',
    carNumber: row[9] || '',
    status: row[10] || '',
    captain: row[11] || '',
  }));

  return players;
}

// Update game sheet with selection
export async function updateGameSheet(
  tabName: string,
  players: Array<{
    rowNumber: number;
    selected?: string;
    team?: number | null;
    position?: string;
    driving?: string;
    carNumber?: string;
    captain?: string;
  }>
) {
  const sheets = await getSheetsClient();
  
  const updates: any[] = [];

  for (const player of players) {
    if (player.selected !== undefined) {
      updates.push({
        range: `'${tabName}'!F${player.rowNumber}`,
        values: [[player.selected]],
      });
    }
    if (player.team !== undefined) {
      updates.push({
        range: `'${tabName}'!G${player.rowNumber}`,
        values: [[player.team || '']],
      });
    }
    if (player.position !== undefined) {
      updates.push({
        range: `'${tabName}'!H${player.rowNumber}`,
        values: [[player.position]],
      });
    }
    if (player.driving !== undefined) {
      updates.push({
        range: `'${tabName}'!I${player.rowNumber}`,
        values: [[player.driving]],
      });
    }
    if (player.carNumber !== undefined) {
      updates.push({
        range: `'${tabName}'!J${player.rowNumber}`,
        values: [[player.carNumber]],
      });
    }
    if (player.captain !== undefined) {
      updates.push({
        range: `'${tabName}'!L${player.rowNumber}`,
        values: [[player.captain]],
      });
    }
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
      requestBody: {
        data: updates,
        valueInputOption: 'USER_ENTERED',
      },
    });
  }
}

// Get player stats from Players sheet
export async function getPlayerStats(userName: string) {
  const sheets = await getSheetsClient();
  
  // Get player row
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: FRIENDLIES_SPREADSHEET_ID,
    range: 'Players!A:ZZ',
  });

  const rows = response.data.values || [];
  const headers = rows[0];
  
  const userRowIndex = rows.findIndex((row, index) => 
    index > 0 && row[0] === userName
  );

  if (userRowIndex === -1) {
    throw new Error(`User not found: ${userName}`);
  }

  const userRow = rows[userRowIndex];

  // Get stats from columns B-F
  const stats = {
    nameDown: userRow[1] ? parseInt(userRow[1]) : 0,
    picked: userRow[2] ? parseInt(userRow[2]) : 0,
    percentPlayed: userRow[3] ? parseFloat(userRow[3]) : 0,
    withdrawn: userRow[4] ? parseInt(userRow[4]) : 0,
    cancelled: userRow[5] ? parseInt(userRow[5]) : 0,
  };

  // Get last 6 games (columns G onwards, working backwards)
  const last6Games: string[] = [];
  for (let i = headers.length - 1; i >= 6 && last6Games.length < 6; i--) {
    if (userRow[i]) {
      last6Games.push(userRow[i]);
    }
  }

  return {
    ...stats,
    last6Games: last6Games.reverse(),
  };
}

// Get driver/bar info from Members sheet
export async function getDriverBarInfo(userName: string) {
  const sheets = await getSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: MEMBERS_SPREADSHEET_ID,
    range: 'Members!A:AZ', // Adjust based on your sheet structure
  });

  const rows = response.data.values || [];
  const headers = rows[0];
  
  const userRowIndex = rows.findIndex((row, index) => 
    index > 0 && row[headers.indexOf('user_name')] === userName
  );

  if (userRowIndex === -1) {
    return { driver: false, bar: false };
  }

  const userRow = rows[userRowIndex];
  
  const driver = userRow[headers.indexOf('driving_away_matches')]?.toLowerCase() === 'yes';
  const bar = userRow[headers.indexOf('bar_duty')]?.toLowerCase() === 'yes';

  let code = '';
  if (driver && bar) code = 'DB';
  else if (driver) code = 'D';
  else if (bar) code = 'B';

  return { driver, bar, code };
}

// Get tea rota for a specific game
export async function getTeaRota(date: string, time: string, clubName: string) {
  const sheets = await getSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: MEMBERS_SPREADSHEET_ID,
    range: 'Tea Rota!A:K',
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return null;

  const headers = rows[0];
  
  // Find matching row by date, time, and club name
  const matchingRow = rows.find((row, index) => {
    if (index === 0) return false; // Skip header
    
    const rowDate = row[0];
    const rowTime = row[1];
    const rowClub = row[2];
    
    // Match date (flexible matching - compare just the date part)
    const dateMatch = rowDate && rowDate.includes(date.split(',')[1]?.trim());
    const timeMatch = rowTime === time;
    const clubMatch = rowClub === clubName;
    
    return dateMatch && timeMatch && clubMatch;
  });

  if (!matchingRow) return null;

  return {
    date: matchingRow[0],
    time: matchingRow[1],
    clubName: matchingRow[2],
    ladiesMen: matchingRow[3],
    format: matchingRow[4],
    lead: matchingRow[5] || '',
    second: matchingRow[6] || '',
    third: matchingRow[7] || '',
    shortLead: matchingRow[8] || '',
    shortSecond: matchingRow[9] || '',
    shortThird: matchingRow[10] || '',
  };
}

// Get club details for away games
export async function getClubDetails(clubName: string) {
  const sheets = await getSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: MATCH_DAY_CONTACTS_SPREADSHEET_ID,
    range: 'clubs!A:R',
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return null;

  // Find matching row by club name
  const matchingRow = rows.find((row, index) => {
    if (index === 0) return false; // Skip header
    return row[0] === clubName;
  });

  if (!matchingRow) return null;

  // Map driving band to cost
  const drivingBandMap: { [key: string]: number } = {
    'A': 2.00,
    'B': 3.00,
    'C': 4.00,
    'D': 5.00,
  };

  const drivingBand = matchingRow[6] || '';
  const petrolCost = drivingBandMap[drivingBand] || 0;

  return {
    clubName: matchingRow[0],
    clubNumber: matchingRow[1] || '',
    clubMobile: matchingRow[2] || '',
    clubEmail: matchingRow[3] || '',
    clubEmailNote: matchingRow[4] || '',
    generalInfo: matchingRow[5] || '',
    drivingBand: drivingBand,
    petrolCost: petrolCost,
    address1: matchingRow[7] || '',
    address2: matchingRow[8] || '',
    address3: matchingRow[9] || '',
    address4: matchingRow[10] || '',
    postCode: matchingRow[11] || '',
    googleAddress: matchingRow[12] || '',
    bowlsEnglandUrl: matchingRow[13] || '',
    website: matchingRow[14] || '',
    bhWebsite: matchingRow[15] || '',
    latitude: matchingRow[16] || '',
    longitude: matchingRow[17] || '',
  };
}

// Get club contacts for away games
export async function getClubContacts(clubName: string) {
  const sheets = await getSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: MATCH_DAY_CONTACTS_SPREADSHEET_ID,
    range: 'Contacts!A:I',
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return [];

  // Find all contacts for this club
  const clubContacts = rows
    .filter((row, index) => {
      if (index === 0) return false; // Skip header
      return row[0] === clubName;
    })
    .map(row => ({
      clubName: row[0],
      role: row[1] || '',
      firstName: row[2] || '',
      lastName: row[3] || '',
      name: row[4] || '',
      phoneNumber: row[5] || '',
      mobileNumber: row[6] || '',
      notes: row[7] || '',
      email: row[8] || '',
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

// ... Additional functions as needed ...
```

---

## 4. API Routes Implementation

### 4.1 Example: GET /api/friendlies/games

Create `/app/api/friendlies/games/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getGames, getPlayerEntries } from '@/lib/sheets/friendlies';
import { getSession } from '@/lib/auth'; // Your existing auth function

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const userName = session.user.user_name;

    // Get all games (filtered by status if provided)
    const games = await getGames(status);

    // Get user's entries
    const userEntries = await getPlayerEntries(userName);

    // Map user entries to games
    const gamesWithUserStatus = games.map(game => {
      const entry = userEntries.find(e => e.tabDate === game.tabDate);
      return {
        ...game,
        userEntered: !!entry,
        userStatus: entry?.status || null,
      };
    });

    return NextResponse.json({ games: gamesWithUserStatus });
  } catch (error) {
    console.error('Error fetching games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
```

### 4.2 Example: POST /api/friendlies/enter

Create `/app/api/friendlies/enter/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { updatePlayerEntry, getGames } from '@/lib/sheets/friendlies';
import { getSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { game_ids } = await request.json();
    const userName = session.user.user_name;

    if (!Array.isArray(game_ids) || game_ids.length === 0) {
      return NextResponse.json(
        { error: 'Invalid game_ids' },
        { status: 400 }
      );
    }

    // Get all games to verify status
    const allGames = await getGames();
    
    const results = [];

    for (const tabDate of game_ids) {
      try {
        // Verify game exists and is open
        const game = allGames.find(g => g.tabDate === tabDate);
        if (!game) {
          results.push({ game_id: tabDate, entered: false, error: 'Game not found' });
          continue;
        }

        if (game.status !== 'O') {
          results.push({ game_id: tabDate, entered: false, error: 'Game not open for entry' });
          continue;
        }

        // Update player entry to 'E'
        await updatePlayerEntry(userName, tabDate, 'E');
        results.push({ game_id: tabDate, entered: true });
      } catch (error) {
        console.error(`Error entering game ${tabDate}:`, error);
        results.push({ game_id: tabDate, entered: false, error: 'Update failed' });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('Error entering games:', error);
    return NextResponse.json(
      { error: 'Failed to enter games' },
      { status: 500 }
    );
  }
}
```

### 4.3 Example: POST /api/friendlies/manage/add-player

Create `/app/api/friendlies/manage/add-player/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import {
  getGames,
  getGameSheet,
  updatePlayerEntry,
  getPlayerStats,
  getDriverBarInfo,
} from '@/lib/sheets/friendlies';
import { getSession } from '@/lib/auth';
import { google } from 'googleapis';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { tab_date, user_name } = await request.json();

    // Get current game
    const games = await getGames();
    const game = games.find(g => g.tabDate === tab_date);
    
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Verify game status is X (Selecting) or S (Selected)
    if (!['X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Can only add players to games with Selecting or Selected status' },
        { status: 400 }
      );
    }

    // Verify user exists in Members sheet
    const driverBarInfo = await getDriverBarInfo(user_name);
    if (!driverBarInfo) {
      return NextResponse.json(
        { error: 'User not found in Members sheet' },
        { status: 404 }
      );
    }

    // Get current players to find insert position
    const currentPlayers = await getGameSheet(game.tabName);
    const lastRowNumber = currentPlayers.length > 0 
      ? currentPlayers[currentPlayers.length - 1].rowNumber 
      : 1;

    // Insert new row
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.FRIENDLIES_SPREADSHEET_ID!,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: {
                sheetId: await getSheetId(game.tabName),
                dimension: 'ROWS',
                startIndex: lastRowNumber,
                endIndex: lastRowNumber + 1,
              },
            },
          },
        ],
      },
    });

    // Add player name
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.FRIENDLIES_SPREADSHEET_ID!,
      range: `'${game.tabName}'!A${lastRowNumber + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[user_name]],
      },
    });

    // Update Players sheet
    await updatePlayerEntry(user_name, tab_date, 'E');

    // Get stats for the new player
    const stats = await getPlayerStats(user_name);
    const driverBar = await getDriverBarInfo(user_name);

    // Update stats in game sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.FRIENDLIES_SPREADSHEET_ID!,
      range: `'${game.tabName}'!B${lastRowNumber + 1}:E${lastRowNumber + 1}`,
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

    return NextResponse.json({
      success: true,
      message: 'Player added successfully',
    });
  } catch (error) {
    console.error('Error adding offline player:', error);
    return NextResponse.json(
      { error: 'Failed to add player' },
      { status: 500 }
    );
  }
}

async function getSheetsClient() {
  const auth = await getAuthClient();
  return google.sheets({ version: 'v4', auth });
}

async function getSheetId(sheetName: string) {
  const sheets = await getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: process.env.FRIENDLIES_SPREADSHEET_ID!,
  });
  
  const sheet = spreadsheet.data.sheets?.find(
    s => s.properties?.title === sheetName
  );
  
  return sheet?.properties?.sheetId || 0;
}
```

### 4.4 Example: POST /api/friendlies/manage/status

Create `/app/api/friendlies/manage/status/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import {
  updateGameStatus,
  createGameColumn,
  createGameSheet,
  getGames,
} from '@/lib/sheets/friendlies';
import { getSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { tab_date, action, bhbc_score, opponent_score, reason, who } = await request.json();

    // Get current game
    const games = await getGames();
    const game = games.find(g => g.tabDate === tab_date);
    
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const currentStatus = game.status || '';
    let newStatus = currentStatus;
    let gameSheetCreated = false;

    // Handle different actions
    switch (action) {
      case 'open':
        if (currentStatus !== '') {
          return NextResponse.json(
            { error: 'Can only open games with blank status' },
            { status: 400 }
          );
        }
        newStatus = 'O';
        // Create column in Players sheet
        await createGameColumn(tab_date);
        break;

      case 'close':
        if (currentStatus !== 'O') {
          return NextResponse.json(
            { error: 'Can only close games with Open status' },
            { status: 400 }
          );
        }
        newStatus = 'X';
        // Create game sheet
        await createGameSheet(tab_date, game.tabName);
        gameSheetCreated = true;
        break;

      case 'publish':
        if (currentStatus !== 'X') {
          return NextResponse.json(
            { error: 'Can only publish games with Selecting status' },
            { status: 400 }
          );
        }
        newStatus = 'S';
        break;

      case 'played':
        if (currentStatus !== 'S') {
          return NextResponse.json(
            { error: 'Can only mark Selectedgames as played' },
            { status: 400 }
          );
        }
        if (bhbc_score === undefined || opponent_score === undefined) {
          return NextResponse.json(
            { error: 'Scores required for played status' },
            { status: 400 }
          );
        }
        newStatus = 'P';
        break;

      case 'cancel':
        if (!reason || !who) {
          return NextResponse.json(
            { error: 'Reason and who required for cancelled status' },
            { status: 400 }
          );
        }
        newStatus = 'C';
        break;

      case 'abandon':
        if (currentStatus !== 'S') {
          return NextResponse.json(
            { error: 'Can only abandon Selected games' },
            { status: 400 }
          );
        }
        if (!reason || bhbc_score === undefined || opponent_score === undefined) {
          return NextResponse.json(
            { error: 'Reason and scores required for abandoned status' },
            { status: 400 }
          );
        }
        newStatus = 'A';
        break;

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Update game status
    await updateGameStatus(tab_date, newStatus, {
      bhbcScore: bhbc_score,
      opponentScore: opponent_score,
      reason,
      who,
      modifiedBy: session.user.user_name,
    });

    return NextResponse.json({
      success: true,
      new_status: newStatus,
      game_sheet_created: gameSheetCreated,
    });
  } catch (error) {
    console.error('Error updating game status:', error);
    return NextResponse.json(
      { error: 'Failed to update game status' },
      { status: 500 }
    );
  }
}
```

---

## 5. Match Card API Example

### 5.1 Match Card Endpoint with Tea Rota Integration

Create `/app/api/friendlies/match-card/[tabDate]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import {
  getGames,
  getGameSheet,
  getTeaRota,
  getClubDetails,
  getClubContacts,
} from '@/lib/sheets/friendlies';
import { getSession } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: { tabDate: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tabDate } = params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'main';

    // Get game details
    const games = await getGames();
    const game = games.find(g => g.tabDate === tabDate);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Verify game status
    if (!['S', 'P', 'C', 'A'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Match card not available for this game status' },
        { status: 400 }
      );
    }

    // Get all players from game sheet
    const allPlayers = await getGameSheet(game.tabName);

    // Separate selected players, reserves, and reserve teams
    const selectedPlayers = allPlayers.filter(p => p.selected === 'Y');
    const reserves = allPlayers.filter(p => p.selected === 'R');
    const reserveTeams = allPlayers.filter(p => p.selected === 'T');

    // Find captain of day
    const captain = allPlayers.find(p => p.captain === 'Y');

    // Organize selected players by team
    const teams: any[] = [];
    const teamNumbers = [...new Set(selectedPlayers.map(p => p.team).filter(Boolean))];
    
    for (const teamNum of teamNumbers.sort()) {
      const teamPlayers = selectedPlayers
        .filter(p => p.team === teamNum)
        .sort((a, b) => {
          const posOrder = { 'S': 0, '1': 1, '2': 2, '3': 3 };
          return (posOrder[a.position as keyof typeof posOrder] || 99) - 
                 (posOrder[b.position as keyof typeof posOrder] || 99);
        });
      
      teams.push({
        team: teamNum,
        players: teamPlayers.map(p => ({
          name: p.name,
          position: p.position,
          status: p.status,
          driving: p.driving,
          carNumber: p.carNumber,
        })),
      });
    }

    // Organize reserve teams
    const reserveTeamsList: any[] = [];
    const reserveTeamNumbers = [...new Set(reserveTeams.map(p => p.team).filter(Boolean))];
    
    for (const teamNum of reserveTeamNumbers.sort()) {
      const teamPlayers = reserveTeams
        .filter(p => p.team === teamNum)
        .sort((a, b) => {
          const posOrder = { 'S': 0, '1': 1, '2': 2, '3': 3 };
          return (posOrder[a.position as keyof typeof posOrder] || 99) - 
                 (posOrder[b.position as keyof typeof posOrder] || 99);
        });
      
      reserveTeamsList.push({
        team: teamNum,
        players: teamPlayers.map(p => ({
          name: p.name,
          position: p.position,
          status: p.status,
        })),
      });
    }

    // Get tea rota for home games
    let teaRota = null;
    if (game.homeAway === 'H') {
      teaRota = await getTeaRota(game.date, game.time, game.clubName);
    }

    // Get club details and contacts for away games
    let clubDetails = null;
    let clubContacts: any[] = [];
    if (game.homeAway === 'A') {
      clubDetails = await getClubDetails(game.clubName);
      clubContacts = await getClubContacts(game.clubName);
    }

    // Return based on type requested
    if (type === 'reserves' && reserveTeamsList.length > 0) {
      return NextResponse.json({
        game: {
          tabDate: game.tabDate,
          date: game.date,
          time: game.time,
          clubName: game.clubName,
          homeAway: game.homeAway,
          format: game.format,
          ladiesMen: game.ladiesMen,
        },
        reserveTeams: reserveTeamsList,
        captain: captain?.name || '',
      });
    }

    // Generate Google Maps directions link for away games
    let directionsUrl = null;
    if (clubDetails && clubDetails.latitude && clubDetails.longitude) {
      const originPlaceId = 'ChIJcfipELGNdUgRmS1st4mG9X0'; // Burgess Hill Bowls Club
      directionsUrl = `https://www.google.com/maps/dir/?api=1` +
        `&origin=Burgess+Hill+Bowls+Club` +
        `&origin_place_id=${originPlaceId}` +
        `&destination=${clubDetails.latitude}%2C${clubDetails.longitude}`;
    }

    // Main card
    return NextResponse.json({
      game: {
        tabDate: game.tabDate,
        date: game.date,
        time: game.time,
        clubName: game.clubName,
        homeAway: game.homeAway,
        format: game.format,
        ladiesMen: game.ladiesMen,
      },
      teams,
      reserves: reserves.map(r => ({
        name: r.name,
        team: r.team,
        position: r.position,
        status: r.status,
      })),
      captain: captain?.name || '',
      teaRota: teaRota ? {
        lead: teaRota.lead,
        second: teaRota.second,
        third: teaRota.third,
      } : null,
      clubDetails: clubDetails ? {
        address: [
          clubDetails.address1,
          clubDetails.address2,
          clubDetails.address3,
          clubDetails.address4,
          clubDetails.postCode,
        ].filter(Boolean).join(', '),
        postCode: clubDetails.postCode,
        generalInfo: clubDetails.generalInfo,
        petrolCost: clubDetails.petrolCost,
        drivingBand: clubDetails.drivingBand,
        directionsUrl: directionsUrl,
        clubNumber: clubDetails.clubNumber,
        clubMobile: clubDetails.clubMobile,
        clubEmail: clubDetails.clubEmail,
        website: clubDetails.website,
      } : null,
      clubContacts: clubContacts.length > 0 ? clubContacts.map(c => ({
        name: c.name,
        role: c.role,
        phone: c.phoneNumber,
        mobile: c.mobileNumber,
        email: c.email,
      })) : null,
    });
  } catch (error) {
    console.error('Error generating match card:', error);
    return NextResponse.json(
      { error: 'Failed to generate match card' },
      { status: 500 }
    );
  }
}
```

---

## 6. UI Components

### 6.1 Player: View Available Games

Create `/app/friendlies/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { GameList } from '@/components/friendlies/GameList';
import { Button } from '@/components/ui/button';

type Game = {
  tabDate: string;
  date: string;
  time: string;
  clubName: string;
  homeAway: string;
  format: string;
  status: string;
  userEntered: boolean;
  userStatus: string | null;
  enteredCount: number;
  selectedCount: number;
};

export default function FriendliesPage() {
  const { data: session } = useSession();
  const [games, setGames] = useState<Game[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGames();
  }, [filter]);

  async function fetchGames() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') {
        params.append('status', filter);
      }
      
      const response = await fetch(`/api/friendlies/games?${params}`);
      const data = await response.json();
      setGames(data.games);
    } catch (error) {
      console.error('Error fetching games:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleEnterGames() {
    try {
      const response = await fetch('/api/friendlies/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_ids: Array.from(selectedGames),
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        // Refresh games list
        fetchGames();
        setSelectedGames(new Set());
      }
    } catch (error) {
      console.error('Error entering games:', error);
    }
  }

  const filteredGames = games.filter(game => {
    switch (filter) {
      case 'O':
        return game.status === 'O';
      case 'entered':
        return game.userEntered;
      case 'selected':
        return ['P', 'R', 'T'].includes(game.userStatus || '');
      default:
        return true;
    }
  });

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Friendly Matches</h1>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
        >
          All
        </Button>
        <Button
          variant={filter === 'O' ? 'default' : 'outline'}
          onClick={() => setFilter('O')}
        >
          Open
        </Button>
        <Button
          variant={filter === 'entered' ? 'default' : 'outline'}
          onClick={() => setFilter('entered')}
        >
          My Entries
        </Button>
        <Button
          variant={filter === 'selected' ? 'default' : 'outline'}
          onClick={() => setFilter('selected')}
        >
          Selected
        </Button>
      </div>

      {/* Games list */}
      {loading ? (
        <p>Loading games...</p>
      ) : (
        <>
          <GameList
            games={filteredGames}
            selectedGames={selectedGames}
            onToggleGame={(tabDate) => {
              const newSelected = new Set(selectedGames);
              if (newSelected.has(tabDate)) {
                newSelected.delete(tabDate);
              } else {
                newSelected.add(tabDate);
              }
              setSelectedGames(newSelected);
            }}
          />

          {selectedGames.size > 0 && (
            <div className="fixed bottom-8 right-8">
              <Button onClick={handleEnterGames} size="lg">
                Enter {selectedGames.size} Game{selectedGames.size !== 1 ? 's' : ''}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

### 6.2 Captain: Team Selection

Create `/app/friendlies/manage/game/[tabDate]/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { TeamSelectionTable } from '@/components/friendlies/TeamSelectionTable';
import { Button } from '@/components/ui/button';

type Player = {
  rowNumber: number;
  name: string;
  nameDown: number;
  picked: number;
  percentPlayed: number;
  driverBar: string;
  selected: string;
  team: number | null;
  position: string;
  driving: string;
  carNumber: string;
  status: string;
  captain: string;
  last6Games?: string;
};

export default function TeamSelectionPage() {
  const params = useParams();
  const tabDate = params.tabDate as string;
  
  const [game, setGame] = useState<any>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGameData();
  }, []);

  async function fetchGameData() {
    try {
      const response = await fetch(`/api/friendlies/manage/game/${tabDate}`);
      const data = await response.json();
      setGame(data.game);
      setPlayers(data.players);
    } catch (error) {
      console.error('Error fetching game:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleGetStats() {
    try {
      const response = await fetch('/api/friendlies/manage/get-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_date: tabDate }),
      });

      const data = await response.json();
      if (data.success) {
        fetchGameData(); // Refresh with updated stats
      }
    } catch (error) {
      console.error('Error getting stats:', error);
    }
  }

  async function handleUpdateSelection() {
    try {
      const response = await fetch('/api/friendlies/manage/update-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_date: tabDate,
          selections: players.map(p => ({
            row_number: p.rowNumber,
            selected: p.selected,
            team: p.team,
            position: p.position,
            driving: p.driving,
            car_number: p.carNumber,
            captain: p.captain,
          })),
        }),
      });

      const data = await response.json();
      if (data.success) {
        setPlayers(data.sorted_players);
      }
    } catch (error) {
      console.error('Error updating selection:', error);
    }
  }

  async function handleUpdateStats() {
    try {
      const response = await fetch('/api/friendlies/manage/update-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_date: tabDate }),
      });

      const data = await response.json();
      if (data.success) {
        alert('Stats updated successfully');
      }
    } catch (error) {
      console.error('Error updating stats:', error);
    }
  }

  if (loading) return <p>Loading...</p>;

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">{game.clubName}</h1>
        <p className="text-gray-600">
          {game.date} at {game.time} - {game.homeAway === 'H' ? 'Home' : 'Away'}
        </p>
        <p className="text-gray-600">{game.format}</p>
      </div>

      <div className="flex gap-2 mb-6">
        <Button onClick={handleGetStats}>Get Stats</Button>
        <Button onClick={handleUpdateSelection}>Update Selection</Button>
        <Button onClick={handleUpdateStats}>Update Stats</Button>
        <Button variant="outline" onClick={() => window.open(`/friendlies/match-card/${tabDate}`)}>
          Print Match Card
        </Button>
      </div>

      <TeamSelectionTable
        players={players}
        onUpdatePlayer={(rowNumber, updates) => {
          setPlayers(prev =>
            prev.map(p =>
              p.rowNumber === rowNumber ? { ...p, ...updates } : p
            )
          );
        }}
        isAway={game.homeAway === 'A'}
      />
    </div>
  );
}
```

---

## 7. Integration with Existing Auth

### 6.1 Update Session Type

Add to your existing session type definition:

```typescript
// types/next-auth.d.ts
declare module 'next-auth' {
  interface Session {
    user: {
      user_name: string;
      full_known_as: string;
      role: 'Player' | 'Captain' | 'Admin' | 'Treasurer';
      // ... other existing fields
    };
  }
}
```

### 6.2 Middleware Protection

Update `/middleware.ts`:

```typescript
import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Protect captain routes
    if (pathname.startsWith('/friendlies/manage')) {
      if (!token || !['Captain', 'Admin'].includes(token.role as string)) {
        return NextResponse.redirect(new URL('/friendlies', req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: ['/friendlies/:path*'],
};
```

---

## 8. Environment Variables

Add to `.env.local`:

```env
FRIENDLIES_SPREADSHEET_ID=your_friendlies_spreadsheet_id
MEMBERS_SPREADSHEET_ID=your_members_spreadsheet_id
MATCH_DAY_CONTACTS_SPREADSHEET_ID=your_match_day_contacts_spreadsheet_id
```

Update `lib/sheets/client.ts` with the new constant:

```typescript
export const FRIENDLIES_SPREADSHEET_ID = process.env.FRIENDLIES_SPREADSHEET_ID!;
export const MEMBERS_SPREADSHEET_ID = process.env.MEMBERS_SPREADSHEET_ID!;
export const MATCH_DAY_CONTACTS_SPREADSHEET_ID = process.env.MATCH_DAY_CONTACTS_SPREADSHEET_ID!;
```

---

## 9. Testing Checklist

- [ ] Player can view games filtered by status
- [ ] Player can enter multiple games at once
- [ ] Player can view game details after selection published
- [ ] Player can confirm participation
- [ ] Player can withdraw (email sent)
- [ ] Captain can open game (creates Players column)
- [ ] Captain can close game (creates game sheet with entered players)
- [ ] Captain can get stats (updates game sheet)
- [ ] Captain can add offline player
- [ ] Captain can select teams and positions
- [ ] Captain can designate captain of day (radio button)
- [ ] Captain can update selection (sorts players)
- [ ] Captain can update stats (updates Players sheet)
- [ ] Captain can mark game as played with scores
- [ ] Captain can cancel game with reason
- [ ] Match card displays correctly
- [ ] Reserve teams show on separate card

---

## 10. Next Steps

1. Review and approve this implementation guide
2. Set up development environment with test spreadsheet
3. Begin Phase 1: Core Infrastructure (database functions)
4. Create sample data for testing
5. Implement Phase 2: Player features
6. Test with real users (captains and players)
7. Deploy to production

This guide provides the foundation for implementing the Friendlies system. Each section can be expanded with more detail as development progresses.
