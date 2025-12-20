# Friendlies System - Technical Specification

## 1. Overview

The Friendlies system manages friendly match entries, team selection, and player confirmations throughout the bowls season. This specification covers the integration with the Next.js membership portal using Google Sheets as the database.

### 1.1 User Roles
- **Player**: Can enter games, view their entries, confirm participation
- **Captain**: Can manage game status, select teams, update stats (Role='Captain')
- **Admin**: Full access to all game management (Role='Admin')

### 1.2 Game Lifecycle

```
[Blank] → [O - Open] → [X - Selecting] → [S - Selected] → [P - Played]
                                                         ↘ [C - Cancelled]
                                                         ↘ [A - Abandoned]
```

---

## 2. Data Structures

### 2.1 Games Sheet

**Current Columns to Preserve:**
- A: Date (YYYY-MM-DD)
- B: Tab Date (e.g., "27-Apr") - Game sheet identifier
- C: Time (HH:MM)
- D: Club Name
- E: H/A (Home/Away)
- F: Format (e.g., "4 Triples", "3 Rinks")
- G: Ladies/Men (Mixed/Ladies/Men)
- H: Dress (W/G - Whites/Greys)
- I: League (Friendly/League name)
- J: Tab Name (Full sheet name, e.g., "Balcombe 27-Apr")
- K: Status (Blank/O/X/S/P/C/A)
- M: Entered (count)
- N: Selected (count)
- O: Reserves (count)

**New Columns to Add:**
- P: BHBC Score (integer)
- Q: Opponent Score (integer)
- R: Reason (text - for Cancelled/Abandoned)
- S: Who (text - who cancelled: "Burgess Hill"/"Opponent")
- T: Last Modified By (user_name)
- U: Last Modified Date (timestamp)

### 2.2 Players Sheet

**Structure:**
- Column A: Name (member name)
- Columns B-F: Season stats (Name Down, Picked, % played, Withdrawn, Cancelled)
- Columns G+: Individual game columns (named by Tab Date)

**Game Column Values:**
- `E` - Entered
- `P` - Playing (selected in regular team)
- `R` - Reserve (substitute, may not play)
- `T` - Reserve Team (playing on spare rink)
- `A` - Playing for Away team
- Add `W` suffix for withdrawn: `EW`, `PW`, `RW`, `TW`, `AW`

### 2.3 Individual Game Sheets

Created when game status changes from O to X.

**Columns:**
- A: Name (text)
- B: Total - Name Down (from Players sheet column B)
- C: Total Picked (from Players sheet column C)
- D: % played vs Name down (from Players sheet column D)
- E: Driver/Bar (from Members sheet: D=Driver, B=Bar, DB=Both)
- F: Selected (Y/R/T/blank) - Captain sets this
- G: Team (1-6+) - Captain sets this
- H: Position (S/1/2/3) - Captain sets this
- I: Driving (Y/blank) - Captain sets for away games
- J: Car Number (1-5/O/blank) - Captain sets for away games
- K: Status (Y/W/blank) - Player confirms (Y) or withdraws (W)
- L: Captain (Y/blank) - Radio button selection for one player

**Row 1:** Column headers (standard format)
**Row 2+:** Player entries (sorted by Selected, Team, Position after captain updates)

### 2.4 Members Sheet

**Relevant Columns:**
- user_name (unique identifier)
- full_known_as (display name)
- driving_away_matches (Yes/No)
- bar_duty (Yes/No)
- role (Player/Captain/Admin/Treasurer)

### 2.5 Tea Rota Sheet

Located in the Membership List spreadsheet.

**Columns:**
- Date (e.g., "Sun, 27 April")
- Time (e.g., "14:00")
- Club Name (e.g., "Balcombe")
- Ladies/Men (e.g., "Mixed")
- Format (e.g., "4 Triples")
- Lead (full name, e.g., "Anne Barnes")
- Second (full name, e.g., "Tracy McBride")
- Third (full name, may be empty)
- Short Lead (abbreviated name, e.g., "A Barnes")
- Short Second (abbreviated name, e.g., "T McBride")
- Short Third (abbreviated name, may be empty)

**Matching Logic:**
- Match to game by Date, Time, and Club Name
- Used for displaying tea duty assignments on match cards for home games

### 2.6 Match Day Contacts Spreadsheet

Located in a separate "Match Day Contacts" spreadsheet.

#### 2.6.1 Clubs Sheet

**Columns:**
- Club Name (e.g., "Balcombe")
- Club Number (phone)
- Club Mobile
- Club email Address
- Club email Note
- General Information
- Driving Band (A/B/C/D for petrol cost calculation)
- Address 1
- Address 2
- Address 3
- Address 4
- Post Code
- Google Address
- Bowls England URL
- Website
- BH Website
- Latitude
- Longitude

**Driving Band Codes:**
- A = £2.00
- B = £3.00
- C = £4.00
- D = £5.00

**Usage:**
- Match to game by Club Name
- Display club details and driving costs on away game match cards

#### 2.6.2 Contacts Sheet

**Columns:**
- Club Name
- Role (e.g., "Captain", "Secretary")
- First Name
- Last Name
- Name (full name)
- Phone Number
- Mobile Number
- Notes
- Email

**Usage:**
- Match to game by Club Name
- Display key contact details for away games on match cards

---

## 3. Player Workflows

### 3.1 View Available Games

**Endpoint:** `GET /api/friendlies/games`

**Query Parameters:**
- `status` (optional): Filter by status (O, X, S, P, C, A)
- `user_name` (required): Current user

**Logic:**
1. Read Games sheet
2. Filter games based on status parameter
3. For each game, check if user has entered (Players sheet game column not empty)
4. Return game list with user's entry status

**Response:**
```json
{
  "games": [
    {
      "tab_date": "27-Apr",
      "date": "2025-04-27",
      "time": "14:00",
      "club_name": "Balcombe",
      "h_a": "H",
      "format": "4 Triples",
      "status": "O",
      "user_entered": false,
      "user_status": null,
      "entered_count": 35,
      "selected_count": 0
    }
  ]
}
```

### 3.2 Enter Games

**Endpoint:** `POST /api/friendlies/enter`

**Request Body:**
```json
{
  "user_name": "john_smith",
  "game_ids": ["27-Apr", "30-Apr", "03-May"]
}
```

**Logic:**
1. Verify user exists in Members sheet
2. For each game_id (Tab Date):
   - Verify game status is "O"
   - Find game column in Players sheet
   - Update user's row with "E" status
3. Return success/failure for each game

**Response:**
```json
{
  "success": true,
  "results": [
    { "game_id": "27-Apr", "entered": true },
    { "game_id": "30-Apr", "entered": true },
    { "game_id": "03-May", "entered": true }
  ]
}
```

### 3.3 View Selected Game Details

**Endpoint:** `GET /api/friendlies/game/{tab_date}`

**Query Parameters:**
- `user_name` (required): Current user

**Logic:**
1. Verify user has entered this game (Players sheet check)
2. Verify game status is "S", "P", "C", or "A"
3. Read individual game sheet
4. Filter to show only selected players (Selected = Y/R/T)
5. Include game details from Games sheet
6. Include tea rota, contact info, petrol costs for display

**Response:**
```json
{
  "game": {
    "tab_date": "27-Apr",
    "date": "2025-04-27",
    "time": "14:00",
    "club_name": "Balcombe",
    "h_a": "H",
    "format": "4 Triples",
    "status": "S",
    "user_status": "P",
    "user_team": 2,
    "user_position": "S",
    "user_confirmed": false
  },
  "teams": [
    {
      "team": 1,
      "players": [
        { "name": "Sandra Solly", "position": "1", "status": "Y", "is_captain": false },
        { "name": "Hazel Jordan", "position": "2", "status": "Y", "is_captain": false },
        { "name": "Carol Masters", "position": "S", "status": "Y", "is_captain": false }
      ]
    }
  ],
  "reserves": [
    { "name": "Celia Dasey", "team": 1, "position": "1", "status": "Y" }
  ],
  "reserve_teams": [
    {
      "team": 1,
      "players": [
        { "name": "Sally Ingarfield", "position": "1", "status": "Y" }
      ]
    }
  ],
  "captain_of_day": "Jane Mackenzie"
}
```

### 3.4 Confirm Participation

**Endpoint:** `POST /api/friendlies/confirm`

**Request Body:**
```json
{
  "user_name": "john_smith",
  "tab_date": "27-Apr",
  "action": "confirm"
}
```

**Logic:**
1. Verify game status is "S"
2. Verify user is selected in this game (Selected = Y/R/T)
3. Find user's row in game sheet
4. Update Status column (K) to "Y"

**Response:**
```json
{
  "success": true,
  "message": "Participation confirmed"
}
```

### 3.5 Withdraw from Game

**Endpoint:** `POST /api/friendlies/withdraw`

**Request Body:**
```json
{
  "user_name": "john_smith",
  "tab_date": "27-Apr"
}
```

**Logic:**
1. Find user's row in game sheet (or Players sheet if game not yet created)
2. If game status is "O":
   - Remove entry from Players sheet game column
3. If game status is "X", "S", or "P":
   - Update game sheet Status column (K) to "W"
   - Add "W" to Players sheet status (E→EW, P→PW, etc.)
   - Send withdrawal email to all captains
4. Return success

**Email Template:**
```
Subject: Friendly Match Withdrawal - {Club Name} {Tab Date}

{User Full Name} has withdrawn from the {Club Name} game on {Date} at {Time}.

Current status: {P/R/T}
Team: {team}
Position: {position}

Please select a replacement player.

View game: {app_url}/friendlies/manage/{tab_date}
```

---

## 4. Captain Workflows

### 4.1 Manage Game Status

**Endpoint:** `POST /api/friendlies/manage/status`

**Request Body:**
```json
{
  "tab_date": "27-Apr",
  "action": "open",
  "reason": "Weather too bad",
  "who": "Burgess Hill"
}
```

**Actions:**

#### Open Game (Blank → O)
1. Update Games sheet Status to "O"
2. Create game column in Players sheet (column header = Tab Date)

#### Close Game (O → X)
1. Update Games sheet Status to "X"
2. Create individual game sheet:
   - Copy Template sheet
   - Rename to Tab Name
   - Add game details to header (row 1, column M)
3. Copy all players with "E" status from Players sheet to game sheet (starting row 2)
4. Sort by name
5. Update Games sheet Entered count

#### Publish Selection (X → S)
1. Update Games sheet Status to "S"
2. Game sheet now viewable by players

#### Mark as Played (S → P)
1. Update Games sheet Status to "P"
2. Capture BHBC Score, Opponent Score
3. Update Games sheet columns P, Q

#### Cancel Game (Any → C)
1. Update Games sheet Status to "C"
2. Capture Reason and Who
3. Update Games sheet columns R, S
4. Update all Players sheet entries to "C"

#### Abandon Game (S → A)
1. Update Games sheet Status to "A"
2. Capture BHBC Score, Opponent Score (partial scores when game started but couldn't finish)
3. Capture Reason
4. Update Games sheet columns P, Q, R

**Response:**
```json
{
  "success": true,
  "new_status": "O",
  "game_sheet_created": true
}
```

### 4.2 Get Game for Selection

**Endpoint:** `GET /api/friendlies/manage/game/{tab_date}`

**Logic:**
1. Verify user is Captain or Admin
2. Verify game status is X, S, or P
3. Read game sheet (all columns A-L)
4. Return all players with their current selection status

**Response:**
```json
{
  "game": {
    "tab_date": "27-Apr",
    "tab_name": "Balcombe 27-Apr",
    "date": "2025-04-27",
    "time": "14:00",
    "club_name": "Balcombe",
    "h_a": "H",
    "format": "4 Triples",
    "status": "X"
  },
  "players": [
    {
      "row_number": 2,
      "name": "Sandra Solly",
      "name_down": 8,
      "picked": 5,
      "percent_played": 0.625,
      "driver_bar": "D",
      "selected": "Y",
      "team": 1,
      "position": "1",
      "driving": null,
      "car_number": null,
      "status": null,
      "captain": null,
      "last_6_games": "E,P,PW,P,E,P"
    }
  ]
}
```

### 4.3 Get Stats

**Endpoint:** `POST /api/friendlies/manage/get-stats`

**Request Body:**
```json
{
  "tab_date": "27-Apr"
}
```

**Logic:**
1. Verify user is Captain or Admin
2. Verify game status is X, S, or P
3. For each player in game sheet:
   - Get stats from Players sheet (columns B-F)
   - Get driver/bar from Members sheet
   - Get last 6 game statuses from Players sheet
   - Update game sheet columns B-E
   - Add note to name cell with last 6 games
4. Return updated player data

**Note Format:**
```
Last 6: E,P,PW,P,R,T
(Shows status codes from most recent 6 games)
```

### 4.4 Add Offline Player

**Endpoint:** `POST /api/friendlies/manage/add-player`

**Request Body:**
```json
{
  "tab_date": "27-Apr",
  "user_name": "john_smith"
}
```

**Logic:**
1. Verify user is Captain or Admin
2. Verify game status is X or S
3. Verify user_name exists in Members sheet
4. Add player to game sheet (insert row after last player)
5. Update Players sheet game column to "E"
6. Get stats for new player
7. Return updated game data

**Note:** Adding players when status is S is uncommon but necessary when a player withdraws after selection is published and there are no reserves available.

### 4.5 Update Team Selection

**Endpoint:** `POST /api/friendlies/manage/update-selection`

**Request Body:**
```json
{
  "tab_date": "27-Apr",
  "selections": [
    {
      "row_number": 2,
      "selected": "Y",
      "team": 1,
      "position": "1",
      "driving": null,
      "car_number": null,
      "captain": null
    },
    {
      "row_number": 5,
      "selected": "R",
      "team": 2,
      "position": "S",
      "driving": null,
      "car_number": null,
      "captain": null
    }
  ]
}
```

**Logic:**
1. Verify user is Captain or Admin
2. Verify game status is X or S
3. Validate captain selection (only one player can have captain = "Y")
4. For each selection:
   - Update game sheet columns F-L
5. Sort game sheet by: Selected (Y/R/T/blank), Team, Position
6. Update Games sheet counts (Selected, Reserves)
7. Return sorted player list

**Response:**
```json
{
  "success": true,
  "sorted_players": [ /* array of players in new order */ ]
}
```

### 4.6 Update Stats

**Endpoint:** `POST /api/friendlies/manage/update-stats`

**Request Body:**
```json
{
  "tab_date": "27-Apr"
}
```

**Logic:**
1. Verify user is Captain or Admin
2. Verify game status is X, S, or P
3. For each player in game sheet:
   - Get Selected status (Y/R/T)
   - Update Players sheet game column:
     - Y → P (Playing)
     - R → R (Reserve)
     - T → T (Reserve Team)
     - blank → leave as E (if entered but not selected)
4. Recalculate Players sheet stats (columns B-F):
   - Name Down: count of E/P/R/T statuses
   - Picked: count of P/R/T statuses
   - % played: Picked / Name Down
   - Withdrawn: count of W suffix
   - Cancelled: count of C status
5. Return success

**Response:**
```json
{
  "success": true,
  "stats_updated": 35
}
```

### 4.7 Generate Match Card

**Endpoint:** `GET /api/friendlies/match-card/{tab_date}`

**Query Parameters:**
- `type`: "main" or "reserves"

**Logic:**
1. Verify user is Captain, Admin, or has entered this game
2. Verify game status is S, P, C, or A
3. Gather data:
   - Game details from Games sheet
   - Selected players from game sheet (Selected = Y)
   - Reserve players (Selected = R)
   - Reserve teams (Selected = T)
   - Captain of day
   - **For Home Games (H/A = "H"):**
     - Tea rota (from Tea Rota sheet in Members spreadsheet - match by date, time, club name)
   - **For Away Games (H/A = "A"):**
     - Club details (from Clubs sheet in Match Day Contacts spreadsheet - match by club name)
       - Address, Post Code, General Information
       - Driving Band → Petrol Cost (A=£2, B=£3, C=£4, D=£5)
     - Contact details (from Contacts sheet in Match Day Contacts spreadsheet - match by club name)
       - Find primary contact (typically Captain or Secretary role)
       - Phone, Mobile, Email
4. Return HTML for printing

**Tea Rota Matching:**
- Compare Games sheet: Date, Time, Club Name
- With Tea Rota sheet: Date, Time, Club Name
- Display: Lead, Second, Third (or Short versions for compact display)
- Only display for home games (H/A = "H")

**Club Details Matching:**
- Compare Games sheet: Club Name
- With Clubs sheet: Club Name
- Display: Address, Driving Band/Cost, General Information
- Google Maps directions link from Burgess Hill Bowls Club to destination (using Latitude/Longitude)
  - Format: `https://www.google.com/maps/dir/?api=1&origin=Burgess+Hill+Bowls+Club&origin_place_id=ChIJcfipELGNdUgRmS1st4mG9X0&destination={latitude}%2C{longitude}`
- Only display for away games (H/A = "A")

**Contact Details Matching:**
- Compare Games sheet: Club Name
- With Contacts sheet: Club Name
- Find contact with Role = "Captain" or "Secretary" (preferred)
- Display: Name, Phone, Mobile, Email
- **All phone numbers must be clickable** with `tel:` links
- **All email addresses must be clickable** with `mailto:` links
- Only display for away games (H/A = "A")

**Response:** HTML page optimized for printing

---

## 5. UI Components

### 5.1 Player Views

#### Available Games List
```tsx
// /app/friendlies/page.tsx
- Filter tabs: All | Open | My Entries | Selected
- Game cards showing:
  - Date, Time, Opponent, H/A
  - Format, Status
  - Entry count (if Open)
  - Checkbox to enter (if Open)
  - "View Details" button (if Selected/Played)
- "Enter Selected Games" button at bottom
```

#### Game Details View
```tsx
// /app/friendlies/game/[tabDate]/page.tsx
- Game information header
- Team lists with player names/positions
- User's status highlighted
- Confirm/Withdraw button (if S status and not confirmed)
- "Print Match Card" button
```

### 5.2 Captain Views

#### Game Management List
```tsx
// /app/friendlies/manage/page.tsx
- Filter: All | Open | Selecting | Selected | Played
- Game cards showing:
  - Date, Time, Opponent, H/A
  - Current status
  - Entry/Selection counts
  - "Change Status" button
  - "Select Team" button (if X/S status)
```

#### Status Change Modal
```tsx
// Component in manage page
- Dropdown or radio buttons for new status
- Additional fields based on status:
  - Played: BHBC Score, Opponent Score
  - Cancelled: Reason, Who
  - Abandoned: Reason
- Confirm/Cancel buttons
```

#### Team Selection Page
```tsx
// /app/friendlies/manage/game/[tabDate]/page.tsx
- Game header with details
- "Get Stats" button
- "Add Player" button (search/select from members)
- Table of players with:
  - Name with stats (name_down, picked, %)
  - Driver/Bar indicators
  - Selected dropdown (blank/Y/R/T)
  - Team input (1-6+)
  - Position dropdown (S/1/2/3)
  - Driving checkbox (away only)
  - Car Number input (away only)
  - Captain radio button
  - Status indicator (Y/W after publishing)
- "Update Selection" button (sorts and saves)
- "Update Stats" button
- "Print Match Card" button
```

### 5.3 Match Card HTML

```tsx
// /app/friendlies/match-card/[tabDate]/page.tsx
- Print-optimized CSS
- Main Card:
  - Game details header
  - Selected teams (1-6) with names/positions
  - Reserve list
  - Captain of day
  - Tea rota assignments
  - Away team contact (if away)
  - Petrol cost info (if away)
- Reserve Card (separate page):
  - Reserve teams only
  - Same format as main card
```

---

## 6. Database Operations

### 6.1 Google Sheets API Functions

```typescript
// lib/sheets/friendlies.ts

// Read Games sheet
async function getGames(status?: string): Promise<Game[]>

// Read Players sheet
async function getPlayerEntries(userName: string): Promise<PlayerEntry[]>

// Update Players sheet game column
async function updatePlayerEntry(
  userName: string, 
  tabDate: string, 
  status: string
): Promise<void>

// Create game sheet
async function createGameSheet(tabDate: string): Promise<void>

// Read game sheet
async function getGameSheet(tabDate: string): Promise<GameSheetData>

// Update game sheet
async function updateGameSheet(
  tabDate: string,
  players: GameSheetPlayer[]
): Promise<void>

// Get stats for players
async function getPlayerStats(
  tabDate: string
): Promise<PlayerStats[]>

// Update Games sheet status
async function updateGameStatus(
  tabDate: string,
  status: string,
  additionalData?: {
    bhbcScore?: number,
    opponentScore?: number,
    reason?: string,
    who?: string
  }
): Promise<void>
```

### 6.2 Email Functions

```typescript
// lib/email/friendlies.ts

// Send withdrawal notification to captains
async function sendWithdrawalEmail(
  userName: string,
  userFullName: string,
  tabDate: string,
  gameDetails: GameDetails,
  selectionDetails: SelectionDetails
): Promise<void>

// Get list of captain email addresses
async function getCaptainEmails(): Promise<string[]>
```

---

## 7. Authentication & Authorization

### 7.1 Middleware

```typescript
// middleware.ts additions

// Check if user is Captain or Admin
function isCaptainOrAdmin(role: string): boolean {
  return role === 'Captain' || role === 'Admin';
}

// Protect captain routes
if (pathname.startsWith('/friendlies/manage')) {
  if (!isCaptainOrAdmin(userRole)) {
    return NextResponse.redirect('/friendlies');
  }
}
```

### 7.2 API Route Protection

```typescript
// In each captain API endpoint
const session = await getSession();
if (!session || !isCaptainOrAdmin(session.user.role)) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
}
```

---

## 8. Error Handling

### 8.1 Common Error Cases

1. **Game not found** (invalid tab_date)
2. **User not authorized** (non-captain accessing captain functions)
3. **Invalid status transition** (e.g., trying to open already-open game)
4. **User not entered** (trying to view game details when not entered)
5. **Game sheet doesn't exist** (status is X but sheet creation failed)
6. **Concurrent edit conflict** (two captains editing same game)
7. **Email send failure** (withdrawal notification not sent)

### 8.2 Error Response Format

```json
{
  "success": false,
  "error": "INVALID_STATUS_TRANSITION",
  "message": "Cannot open a game that is already open",
  "details": {
    "current_status": "O",
    "attempted_status": "O"
  }
}
```

---

## 9. Testing Strategy

### 9.1 Unit Tests
- Game status transitions
- Player entry validation
- Stats calculations
- Email template generation

### 9.2 Integration Tests
- Full player workflow (enter → view → confirm)
- Full captain workflow (open → select → publish → played)
- Withdrawal notification
- Concurrent access handling

### 9.3 Manual Testing Checklist
- [ ] Player can enter multiple games
- [ ] Player can view only games they entered
- [ ] Player can confirm participation
- [ ] Player can withdraw (with email sent)
- [ ] Captain can open game (creates column)
- [ ] Captain can close game (creates sheet)
- [ ] Captain can get stats (updates sheet)
- [ ] Captain can add offline player
- [ ] Captain can select teams (with sorting)
- [ ] Captain can designate captain of day (only one)
- [ ] Captain can update stats (updates Players sheet)
- [ ] Captain can mark game as played (with scores)
- [ ] Captain can cancel game
- [ ] Match cards print correctly
- [ ] Reserve teams display separately

---

## 10. Implementation Plan

### Phase 1: Core Infrastructure (Days 1-3)
1. Create database functions for Games sheet operations
2. Create database functions for Players sheet operations
3. Create database functions for game sheet operations
4. Set up authentication/authorization middleware
5. Create email notification system

### Phase 2: Player Features (Days 4-6)
1. Build "View Games" API endpoint and UI
2. Build "Enter Games" API endpoint and UI
3. Build "View Game Details" API endpoint and UI
4. Build "Confirm/Withdraw" API endpoints and UI
5. Test player workflow end-to-end

### Phase 3: Captain Game Management (Days 7-9)
1. Build "Manage Game Status" API endpoint and UI
2. Build status change modal with different fields
3. Build "Open Game" function (creates Players column)
4. Build "Close Game" function (creates game sheet)
5. Test game status transitions

### Phase 4: Captain Team Selection (Days 10-14)
1. Build "Get Game for Selection" API endpoint
2. Build "Get Stats" API endpoint and function
3. Build "Add Offline Player" API endpoint and function
4. Build team selection UI with all fields
5. Build "Update Selection" API endpoint (with sorting)
6. Build "Update Stats" API endpoint
7. Test full selection workflow

### Phase 5: Match Cards (Days 15-16)
1. Build match card data API endpoint
2. Create print-optimized HTML templates
3. Add tea rota, contacts, petrol cost integration
4. Create separate reserve card template
5. Test printing from different browsers

### Phase 6: Testing & Refinement (Days 17-19)
1. Integration testing of all workflows
2. Fix bugs and edge cases
3. Performance optimization
4. User acceptance testing with captains
5. Documentation updates

### Phase 7: Deployment (Day 20)
1. Deploy to production
2. Monitor for errors
3. Provide user training/documentation
4. Address any immediate issues

---

## 11. Technical Considerations

### 11.1 Performance
- Cache frequently accessed data (game list, members list)
- Batch operations when possible (entering multiple games)
- Optimize Google Sheets API calls (use batch gets/updates)

### 11.2 Data Integrity
- Validate status transitions server-side
- Use row numbers for game sheet updates (prevent duplicate entries)
- Lock game sheet during captain editing
- Implement optimistic locking for concurrent edits

### 11.3 User Experience
- Show loading indicators during API calls
- Provide clear error messages
- Auto-refresh game lists after status changes
- Confirm destructive actions (withdraw, cancel)
- Make match cards mobile-responsive for viewing (but optimize for desktop printing)

### 11.4 Future Enhancements
- Email all selected players when status changes to S
- Push notifications for game updates
- Mobile app for quick game entry
- Historical statistics dashboard
- Automated team selection suggestions based on stats

---

## 12. Appendix

### 12.1 Status Code Reference

**Game Status:**
- Blank: Not yet opened
- O: Open for entry
- X: Closed, selecting teams
- S: Selection published
- P: Played
- C: Cancelled
- A: Abandoned

**Player Entry Status (Players Sheet):**
- E: Entered
- P: Playing
- R: Reserve
- T: Reserve Team
- A: Playing for Away
- +W: Withdrawn (EW, PW, RW, TW, AW)
- C: Cancelled

**Selection Status (Game Sheet Column F):**
- Y: Selected to play
- R: Reserve
- T: Reserve Team
- Blank: Not selected

**Confirmation Status (Game Sheet Column K):**
- Y: Confirmed
- W: Withdrawn
- Blank: Not yet confirmed

### 12.2 Example API Call Sequence

**Player Entering Games:**
```
1. GET /api/friendlies/games?user_name=john_smith
2. POST /api/friendlies/enter
   { "user_name": "john_smith", "game_ids": ["27-Apr", "30-Apr"] }
3. GET /api/friendlies/games?user_name=john_smith
   (shows updated entry status)
```

**Captain Selecting Team:**
```
1. GET /api/friendlies/manage/games
2. POST /api/friendlies/manage/status
   { "tab_date": "27-Apr", "action": "close" }
3. GET /api/friendlies/manage/game/27-Apr
4. POST /api/friendlies/manage/get-stats
   { "tab_date": "27-Apr" }
5. POST /api/friendlies/manage/update-selection
   { "tab_date": "27-Apr", "selections": [...] }
6. POST /api/friendlies/manage/update-stats
   { "tab_date": "27-Apr" }
7. POST /api/friendlies/manage/status
   { "tab_date": "27-Apr", "action": "publish" }
```

**Player Confirming Participation:**
```
1. GET /api/friendlies/game/27-Apr?user_name=john_smith
2. POST /api/friendlies/confirm
   { "user_name": "john_smith", "tab_date": "27-Apr", "action": "confirm" }
3. GET /api/friendlies/game/27-Apr?user_name=john_smith
   (shows confirmed status)
```
