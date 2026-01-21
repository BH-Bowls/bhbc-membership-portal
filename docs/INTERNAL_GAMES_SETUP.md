# Internal Games System Setup

## Google Sheets Structure

You need to create a new Google Spreadsheet for the Internal Games system.

### Environment Variable

Add to your `.env.local`:
```
INTERNAL_GAMES_SPREADSHEET_ID=your_spreadsheet_id_here
```

---

## Sheet 1: InternalGames

This sheet contains the list of all internal games.

### Required Columns:

| Column Name | Description | Example Values |
|------------|-------------|----------------|
| `Date` | Full date (DD/MM/YYYY) | "13/01/2025", "20/01/2025" |
| `Time` | Game time | "14:00", "10:00" |
| `Game Name` | Name of the internal game | "Club Championship Round 1", "Presidents Cup Semi-Final" |
| `Tab Name` | Sheet tab identifier (populated automatically) | "Club Championship Round 1 13 Jan 25" |
| `Location` | Optional location details | "Rinks 1-4", "Main Green", "" |
| `Format` | Game format | "Triples", "Pairs", "Rinks", "Singles" |
| `Ladies Men` | Ladies/Men/Mixed | "Men", "Ladies", "Mixed" |
| `Dress` | Dress code | "Whites", "Greys", "Club Colours" |
| `Status` | Game status | "" (not opened), "O" (open), "X" (closed), "S" (selected), "P" (played), "C" (cancelled), "A" (archived) |
| `Max Capacity` | Maximum players allowed | 16, 18, 20, 24, or blank for unlimited |
| `Entered` | Number of players entered | Calculated automatically |
| `Selected` | Number of players selected | Calculated automatically |
| `Reserves` | Number of reserves | Calculated automatically |

### Auto-Populated Fields:
- **`Tab Name`**: Leave empty when creating games. System populates as "Game Name DD MMM YY" (e.g., "Club Championship Round 1 13 Jan 25") when game opens/closes. Used as the sheet tab name.

### Notes:
- **No opponent club** (internal games only)
- **No home/away** (all at club)
- **No stats tracking** (unlike friendlies)
- **No captain selection** (unlike friendlies)
- **No driving** (all local)

---

## Sheet 2: Players (Entry Matrix)

This sheet tracks which players have entered which games. Start with **just the header row**:

### Required Columns:

| Column Name | Description |
|------------|-------------|
| `User Name` | Member's username (added automatically when they enter) |

**Dynamic columns**: One column per game will be added automatically when games are opened.

### Notes:
- Start with EMPTY sheet (just `User Name` header)
- When a player enters a game, their username is added if not present
- When an offline player is added manually, their username is added if not present
- Member details (Full Name, Member Type) are looked up from the main MEMBERS_SPREADSHEET_ID

---

## Individual Game Sheets

When a game is closed for entry (status changes to 'X'), a new sheet tab is created automatically with the game's `Tab Name`.

### Example Tab Name:
`Club Championship 13 Jan 25`

### Required Columns (created automatically):

| Column Name | Description | Values |
|------------|-------------|---------|
| `User Name` | Player's username | From members list |
| `Selected` | Selection status | "" (not selected), "Y" (playing), "R" (reserve), "T" (reserve team) |
| `Team` | Team number | 1, 2, 3, 4, or blank |
| `Position` | Position in team | "S" (skip), "1" (lead), "2" (second), "3" (third), or blank |
| `Status` | Confirmation status | "" (no response), "Y" (confirmed), "W" (withdrawn) |

### Not Included (compared to Friendlies):
- ❌ No `Name Down` (stats)
- ❌ No `Picked` (stats)
- ❌ No `Percent Played` (stats)
- ❌ No `Driver Bar` (no driving)
- ❌ No `Driving` (no driving)
- ❌ No `Car Number` (no driving)
- ❌ No `Captain` (no captain selection)

---

## Workflow

### 1. Create Game
Add a new row to the `InternalGames` sheet with game details.

### 2. Open for Entry
Set `Status` to "O" to allow players to enter.

### 3. Close for Entry
Set `Status` to "X" - this creates the individual game sheet with all entered players.

### 4. Select Teams
Captain/Admin uses the manage interface to:
- Assign players to teams (team number 1-4)
- Assign positions (Skip, Lead, Second, Third)
- Mark reserves

### 5. Publish Teams
Set `Status` to "S" - teams are now published and visible to players.

### 6. After Game
Set `Status` to "P" for played, or "C" for cancelled.

---

## Key Differences from Friendlies

| Feature | Friendlies | Internal Games |
|---------|-----------|----------------|
| Opponent Club | ✅ Yes | ❌ No |
| Home/Away | ✅ Yes | ❌ No |
| Stats Tracking | ✅ Yes | ❌ No |
| Captain Selection | ✅ Yes | ❌ No |
| Team Selection | ✅ Yes | ✅ Yes |
| Position Assignment | ✅ Yes | ✅ Yes |
| Driving | ✅ Yes (away games) | ❌ No |
| Bar Duty | ✅ Yes | ❌ No |
| Capacity Limits | ✅ Yes | ✅ Yes |

---

## Sample Data

### Games Sheet (when first created):

| Date | Time | Game Name | Tab Name | Location | Format | Ladies Men | Dress | Status | Max Capacity | Entered | Selected | Reserves |
|------|------|-----------|----------|----------|--------|------------|-------|--------|--------------|---------|----------|----------|
| 13/01/2025 | 14:00 | Club Championship Round 1 | | Rinks 1-4 | Triples | Men | Whites | | 18 | 0 | 0 | 0 |
| 20/01/2025 | 10:00 | Presidents Cup Semi-Final | | Main Green | Pairs | Mixed | Greys | | 16 | 0 | 0 | 0 |

### After opening games (Status → "O"):

| Date | Time | Game Name | Tab Name | Location | Format | Ladies Men | Dress | Status | Max Capacity | Entered | Selected | Reserves |
|------|------|-----------|----------|----------|--------|------------|-------|--------|--------------|---------|----------|----------|
| 13/01/2025 | 14:00 | Club Championship Round 1 | Club Championship Round 1 13 Jan 25 | Rinks 1-4 | Triples | Men | Whites | O | 18 | 0 | 0 | 0 |
| 20/01/2025 | 10:00 | Presidents Cup Semi-Final | Presidents Cup Semi-Final 20 Jan 25 | Main Green | Pairs | Mixed | Greys | O | 16 | 0 | 0 | 0 |

**Note**: System auto-populates `Tab Name` when game status changes to ensure it matches the sheet tab name.

---

## Testing

1. **Create the spreadsheet** with the structure above
2. **Add the environment variable** to `.env.local`
3. **Grant service account access** to the spreadsheet (Editor permissions)
4. **Add sample games** to test the system
5. **Navigate to** `/internal-games` to see the games list
6. **Test entry workflow** once implemented
