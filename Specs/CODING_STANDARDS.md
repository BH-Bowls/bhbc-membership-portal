# BHBC Membership Portal - Coding Standards

**Target Audience**: Developers with Google Apps Script background

**Principle**: Write code that is explicit, well-commented, and avoids heavily optimised Javascript, Behaviour change, complex syntax, deep abstractions and advanced patterns. Prioritize readability and maintenance over brevity.

---

## 1. File Headers (MANDATORY)

Every file must start with a header comment containing:
1. Full file path relative to project root
2. Brief description of what the file does

```typescript
// app/api/friendlies/games/route.ts
// API endpoint to fetch all available games with optional status filtering

// src/lib/friendlies-sheets.ts
// Google Sheets operations for Friendlies system - handles all data access

// components/UserSelector.tsx
// Dropdown component for admins to select which user to manage
```

---

## 2. Comprehensive Comments (MANDATORY)

**Every code chunk must have a comment explaining what it does and why.**

### What Must Be Commented:

#### Every Function/Method
```typescript
// Get all games from the Games sheet with optional status filtering
export async function getGames(statusFilter?: GameStatus): Promise<Game[]> {
```

#### Every Loop
```typescript
// Loop through all data rows (skip header at index 0)
for (let i = 1; i < rows.length; i++) {

// Iterate backward through game columns to get last 8 games
for (let i = headers.length - 1; i >= 0 && last8Games.length < 8; i--) {
```

#### Every If Statement (Complex Logic)
```typescript
// Check if we have a cached column mapping for this sheet
if (columnMapCache[spreadsheetId]) {
  if (columnMapCache[spreadsheetId][sheetName]) {

// Only process games with Open or Selecting status
if (['O', 'X'].includes(game.status)) {

// Skip the current game when collecting history
if (currentGameTabName && header === currentGameTabName) continue;
```

#### Every API Call / External Operation
```typescript
// Fetch all rows from the Games sheet
const response = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: 'Games!A2:ZZ',
});

// Update the game status in column L
await sheets.spreadsheets.values.update({
  spreadsheetId,
  range: `Games!${statusCol}${game.rowNumber}`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [[newStatus]] },
});

// Verify user is logged in
const session = await getServerSession(authOptions);
```

#### Every Data Transformation
```typescript
// Extract game date from row
const date = get(row, 'date') || '';

// Convert percentage string "64%" to decimal 0.64
const numStr = percentPlayedVal.replace('%', '').trim();
const num = parseFloat(numStr);
percentPlayed = num > 1 ? num / 100 : num;

// Build list of fixed column indices that shouldn't be cleared
const fixedColumns = new Set<number>();
for (const name of fixedColumnNames) {
  const colIndex = colMap[name];
  if (colIndex !== undefined) {
    fixedColumns.add(colIndex);
  }
}
```

#### Every State Update (React Components)
```typescript
// Fetch game data and player list on page load
useEffect(() => {
  fetchGameData();
  fetchAvailablePlayers();
}, [tabDate]);

// Show loading indicator while fetching stats
setGettingStats(true);
```

#### Every Error Handler
```typescript
// Log error but don't fail the entire operation
try {
  const stats = getPlayerStatsFromCache(name, playersRows, playersColMap, playersHeaders, tabName);
  last8Games = stats.last8Games;
} catch (error) {
  // Player not found in Players sheet - skip game history
}
```

### Comment Content Guidelines

**Do Comment:**
- **What** the code does (in business terms)
- **Why** we're doing it (business logic, requirements)
- **Google Sheets specifics** (row numbers, column mappings, ranges)
- **Data transformations** (what format changes we're making)
- **Edge cases** (what happens when data is missing)
- **Business rules** (status transitions, validation rules)

**Don't Over-Explain:**
- Basic JavaScript syntax
- TypeScript types
- Standard React patterns
- Keep comments concise and meaningful

---

## 3. Avoid Modern Syntax - Use Explicit Code

### ❌ AVOID: Optional Chaining (`?.`)

**Bad:**
```typescript
if (columnMapCache[spreadsheetId]?.[sheetName]) {
```

**Good:**
```typescript
// Check if we have a cached column mapping for this spreadsheet
if (columnMapCache[spreadsheetId]) {
  // Check if we have the mapping for this specific sheet
  if (columnMapCache[spreadsheetId][sheetName]) {
```

### ❌ AVOID: Nullish Coalescing (`??`)

**Bad:**
```typescript
const nameColumn = colMap['full_name'] ?? colMap['name'];
const userNameCol = membersColMap['user_name'] ?? 0;
```

**Good:**
```typescript
// Try full_name column first, fall back to name column if not found
let nameColumn = colMap['full_name'];
if (nameColumn === undefined) {
  nameColumn = colMap['name'];
}

// Find user_name column, default to first column (index 0) if not found
let userNameCol = membersColMap['user_name'];
if (userNameCol === undefined) {
  userNameCol = 0;
}
```

### ❌ AVOID: Complex Array Method Chains

**Bad:**
```typescript
const fixedColumns = new Set(
  fixedColumnNames
    .map(name => colMap[name])
    .filter(idx => idx !== undefined)
);
```

**Good:**
```typescript
// Build set of column indices that should not be cleared (fixed columns)
const fixedColumns = new Set<number>();

// Loop through each fixed column name and get its index
for (const name of fixedColumnNames) {
  const colIndex = colMap[name];

  // Only add if column exists in this sheet
  if (colIndex !== undefined) {
    fixedColumns.add(colIndex);
  }
}
```

### ❌ AVOID: `.findIndex()`, `.find()`

**Bad:**
```typescript
const userRowIndex = rows.findIndex((row, index) =>
  index > 0 && row[userNameCol] === lookupValue
);
```

**Good:**
```typescript
// Find the row index for this user in the sheet
let userRowIndex = -1;

// Loop through data rows (skip header at index 0)
for (let i = 1; i < rows.length; i++) {
  // Check if this row matches the user we're looking for
  if (rows[i][userNameCol] === lookupValue) {
    userRowIndex = i;
    break;
  }
}
```

---

## 4. Google Sheets Specific Comments

Always comment Google Sheets operations with context:

```typescript
// Row 1 is header, data starts at row 2
const rowNumber = index + 2;

// Fetch from Members sheet to get buddy relationships
const membersResponse = await sheets.spreadsheets.values.get({
  spreadsheetId: getSpreadsheetId(),
  range: 'Members!A2:AZ',
});
```

---

## 5. Error Handling Comments

Always explain what errors mean and how they're handled:

```typescript
try {
  // Attempt to fetch user profile from Members sheet
  const profile = await getUserProfile(userName);
} catch (error) {
  // User not found in Members sheet - return default profile
  return getDefaultProfile();
}

try {
  // Try to update renewal status
  await updateRenewalPayment(userName, updates);
} catch (error) {
  // Log error but don't crash - user can retry
  console.error('Failed to update renewal:', error);
  throw new Error('Unable to save payment. Please try again.');
}
```

---

## 6. React Component Comments

Comment all React hooks and state updates:

```typescript
// Track loading state while fetching data
const [isLoading, setIsLoading] = useState(false);

// Store list of available games
const [games, setGames] = useState<Game[]>([]);

// Fetch games when component mounts
useEffect(() => {
  loadGames();
}, []);

// Reload games when status filter changes
useEffect(() => {
  if (statusFilter) {
    loadGames();
  }
}, [statusFilter]);

// Handle game selection and navigate to details page
const handleGameClick = (tabDate: string) => {
  // Navigate to game details page
  router.push(`/friendlies/game/${tabDate}`);
};
```

---

## 7. API Route Comments

Comment authentication, validation, and business logic:

```typescript
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Check authorization: Admin OR Treasurer
    if (session?.user?.role !== 'Admin' && session?.user?.role !== 'T') {
      return NextResponse.json(
        { error: 'Forbidden - Admin or Treasurer access required' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { userName, amount } = body;

    // Validate required fields
    if (!userName || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: userName, amount' },
        { status: 400 }
      );
    }

    // Update payment in Google Sheets
    await updateRenewalPayment(userName, { amount });

    return NextResponse.json({ success: true });
  } catch (error) {
    // Log error for debugging
    console.error('Error processing payment:', error);

    // Return generic error to user
    return NextResponse.json(
      { error: 'Failed to process payment' },
      { status: 500 }
    );
  }
}
```

---


## 8. When using Google Sheets, always use Dynamic Columns.

Column names can be in English or snake_case, eg Member Name or member_name. Map to camelCase, eg memberName

---
## 9. Examples - Good vs Bad

### Example 1: Optional Chaining

**❌ Bad:**
```typescript
if (cache?.sheets?.[sheetName]?.data) {
  return cache.sheets[sheetName].data;
}
```

**✅ Good:**
```typescript
// Check if we have cached data for this sheet
if (cache) {
  if (cache.sheets) {
    if (cache.sheets[sheetName]) {
      if (cache.sheets[sheetName].data) {
        // Return cached data
        return cache.sheets[sheetName].data;
      }
    }
  }
}
```
## 10. Use theme.

Use the Site theme.ts in src/components/

---

## 11. Date Handling from Google Sheets

Google Sheets stores dates in DD/MM/YYYY format, which JavaScript's `new Date()` does NOT parse correctly.

### The Problem

```typescript
// ❌ BAD - Will parse incorrectly
const date = "27/09/2025"; // From Google Sheet
new Date(date).toLocaleDateString('en-GB'); // Shows as 2001 or 2000!
```

JavaScript expects dates in formats like:
- ISO format: `"2025-09-27"` (YYYY-MM-DD)
- US format: `"09/27/2025"` (MM/DD/YYYY)
- NOT UK format: `"27/09/2025"` (DD/MM/YYYY) ❌

### The Solution

Always parse DD/MM/YYYY dates explicitly:

```typescript
/**
 * Parse DD/MM/YYYY date string to Date object
 * Google Sheets dates come in DD/MM/YYYY format which JavaScript doesn't parse correctly
 * @param dateStr Date string in DD/MM/YYYY format (e.g., "27/09/2025")
 * @returns Date object or null if invalid
 */
function parseDDMMYYYY(dateStr: string): Date | null {
  if (!dateStr) return null;

  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;

  const day = parseInt(parts[0]);
  const month = parseInt(parts[1]) - 1; // JavaScript months are 0-indexed
  const year = parseInt(parts[2]);

  return new Date(year, month, day);
}

// ✅ GOOD - Parses correctly
const date = "27/09/2025";
parseDDMMYYYY(date)?.toLocaleDateString('en-GB'); // Shows as 27/09/2025 ✓
```

### When to Use This

- Any time you're displaying dates from Google Sheets
- When sorting or comparing dates from Google Sheets
- When passing dates to date libraries (date-fns, etc.)

### Example in Components

```typescript
{/* Date column in table */}
<td className="px-6 py-4 whitespace-nowrap text-sm">
  <div>{parseDDMMYYYY(game.date)?.toLocaleDateString('en-GB') || game.date}</div>
  <div className="text-gray-500">{game.time}</div>
</td>
```

---

## 12. Text Color and Accessibility

Always use sufficient color contrast for text to ensure readability across all devices and screen types.

### Text Color Guidelines

**For Labels, Headers, and Important Text:**
- Use `text-gray-900` (darkest) for maximum readability
- Use `text-gray-800` or `text-gray-700` for slightly softer but still clear text
- ❌ AVOID `text-gray-500` or lighter for table headers, labels, or critical UI elements

**For Secondary/Supporting Text:**
- Use `text-gray-600` or `text-gray-500` for less important information
- Examples: timestamps, helper text, footnotes

**Why This Matters:**
- Different devices (Google Pixel, Samsung, iPhone, iPad) render colors differently
- Some screens have lower contrast ratios
- Lighter text colors (gray-500) may appear faint or unreadable on certain devices
- Accessibility standards (WCAG) require sufficient contrast for readability

### Examples

**❌ Bad - Table Headers:**
```tsx
<th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
  Date/Time
</th>
```

**✅ Good - Table Headers:**
```tsx
<th className="px-6 py-3 text-xs font-medium text-gray-900 uppercase">
  Date/Time
</th>
```

**✅ Good - Secondary Text:**
```tsx
<div className="font-medium text-gray-900">John Smith</div>
<div className="text-sm text-gray-500">Last login: 2 days ago</div>
```

---

## Summary Checklist

Before submitting code, verify:

- [ ] Every file has a header comment with path and description
- [ ] Every function has a comment explaining what it does
- [ ] Every loop has a comment explaining what it's iterating over
- [ ] Every API call has a comment explaining what data it's fetching/updating
- [ ] Every if statement (with complex logic) has a comment explaining the condition
- [ ] No optional chaining (`?.`) - use explicit if checks instead
- [ ] No nullish coalescing (`??`) - use explicit fallbacks instead
- [ ] All variables have descriptive names
- [ ] All Google Sheets operations include context (row numbers, column letters, ranges)
- [ ] All error handling explains what errors mean
- [ ] All React hooks have comments explaining when they run
- [ ] Dates from Google Sheets are parsed using parseDDMMYYYY() helper (not new Date() directly)
- [ ] Table headers and labels use dark text colors (text-gray-900, text-gray-800, text-gray-700)
- [ ] Secondary text appropriately uses lighter colors (text-gray-600, text-gray-500)
