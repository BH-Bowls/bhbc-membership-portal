# Friendlies System - Implementation Status

## ✅ COMPLETED

### 1. Core TypeScript Types (`src/lib/types/friendlies.ts`)
- ✅ All game, player, and data structure types defined
- ✅ API request/response types
- ✅ Match card data types
- ✅ Status enum types

### 2. Database Layer (`src/lib/friendlies-sheets.ts`)
- ✅ Google Sheets client setup with environment variable getters
- ✅ Games sheet operations (getGames, updateGameStatus, updateGameCounts)
- ✅ Players sheet operations (createGameColumn, getPlayerEntries, updatePlayerEntry, getPlayerStats)
- ✅ Game sheet operations (createGameSheet, getGameSheet, updateGameSheet, updateGameSheetStats, addPlayerToGameSheet)
- ✅ Members sheet operations (getDriverBarInfo, getTeaRota)
- ✅ Match Day Contacts operations (getClubDetails, getClubContacts)

### 3. Email System (`src/lib/email/friendlies.ts`)
- ✅ getCaptainEmails function
- ✅ sendWithdrawalEmail with HTML template
- ✅ Future enhancement placeholder for status change notifications

### 4. Player API Routes
- ✅ `GET /api/friendlies/games` - List games with user's entry status
- ✅ `POST /api/friendlies/enter` - Enter multiple games
- ✅ `GET /api/friendlies/game/[tabDate]` - View game details (teams, reserves)
- ✅ `POST /api/friendlies/confirm` - Confirm participation
- ✅ `POST /api/friendlies/withdraw` - Withdraw from game (with captain notification)

## 🚧 IN PROGRESS / TODO

### 5. Captain API Routes (NEEDS IMPLEMENTATION)

Create these files:

#### `/app/api/friendlies/manage/games/route.ts`
```typescript
// GET /api/friendlies/manage/games
// Returns all games for captain management view
// Should include captain/admin role check
```

#### `/app/api/friendlies/manage/status/route.ts`
```typescript
// POST /api/friendlies/manage/status
// Handle all status transitions:
// - open (Blank → O): Create Players column
// - close (O → X): Create game sheet from template
// - publish (X → S): Make selection visible to players
// - played (S → P): Record scores
// - cancel (Any → C): Cancel with reason/who
// - abandon (S → A): Abandon with partial scores and reason
```

#### `/app/api/friendlies/manage/game/[tabDate]/route.ts`
```typescript
// GET /api/friendlies/manage/game/[tabDate]
// Return all players with selection data for captain view
// Include stats, driver/bar info, last 6 games
```

#### `/app/api/friendlies/manage/get-stats/route.ts`
```typescript
// POST /api/friendlies/manage/get-stats
// Update game sheet with latest stats from Players sheet
// Add driver/bar info
// Add last 6 games as notes
```

#### `/app/api/friendlies/manage/add-player/route.ts`
```typescript
// POST /api/friendlies/manage/add-player
// Add offline player to game sheet
// Works for status X (Selecting) or S (Selected)
// Add to Players sheet and get stats
```

#### `/app/api/friendlies/manage/update-selection/route.ts`
```typescript
// POST /api/friendlies/manage/update-selection
// Update team selections for all players
// Sort by: Selected (Y/R/T/blank), Team, Position
// Validate only one captain
// Return sorted player list
```

#### `/app/api/friendlies/manage/update-stats/route.ts`
```typescript
// POST /api/friendlies/manage/update-stats
// Update Players sheet based on game sheet selections:
// - Y → P (Playing)
// - R → R (Reserve)
// - T → T (Reserve Team)
// Recalculate season stats
```

### 6. Match Card API Route (NEEDS IMPLEMENTATION)

#### `/app/api/friendlies/match-card/[tabDate]/route.ts`
```typescript
// GET /api/friendlies/match-card/[tabDate]?type=main|reserves
// Return match card data including:
// - Game details
// - Teams with players
// - Reserves and reserve teams
// - Captain of day
// - For HOME games: Tea rota from Members spreadsheet
// - For AWAY games:
//   - Club details (address, petrol cost, general info)
//   - Google Maps directions URL (using GPS coordinates)
//   - Club contacts (Captain, Secretary)
// - All phone numbers and emails should be returned for clickable links
```

### 7. UI Pages (NEEDS IMPLEMENTATION)

#### Player Pages

**`/app/friendlies/page.tsx`**
- Game list with filter tabs (All, Open, My Entries, Selected)
- Checkboxes to select multiple games for entry
- "Enter Selected Games" floating action button
- Status badges and game info cards

**`/app/friendlies/game/[tabDate]/page.tsx`**
- Game information header
- Team lists showing all selected players
- User's status and position highlighted
- Confirm/Withdraw buttons (if status = S and not confirmed)
- "View Match Card" button
- Reserve teams display

#### Captain Pages

**`/app/friendlies/manage/page.tsx`**
- Game management list with filters
- Status change buttons
- Entry/selection counts
- Quick actions (Open, Close, Select Team, Mark as Played)

**`/app/friendlies/manage/game/[tabDate]/page.tsx`**
- Game header with details
- Action buttons: Get Stats, Update Selection, Update Stats, Print Match Card
- Team selection table with all fields:
  - Name (with stats popup/tooltip showing last 6 games)
  - Stats (name down, picked, %)
  - Driver/Bar indicators
  - Selected dropdown (blank/Y/R/T)
  - Team number input
  - Position dropdown (S/1/2/3)
  - Driving checkbox (away games only)
  - Car number input (away games only)
  - Captain radio button (only one can be selected)
  - Status indicator (Y/W after publishing)
- Player search/add dialog
- Sortable columns

#### Match Card Page

**`/app/friendlies/match-card/[tabDate]/page.tsx`**
- Print-optimized layout
- Game details header
- Teams display with positions
- Reserves section
- Captain of day
- For HOME games:
  - Tea rota assignments (lead, second, third)
- For AWAY games:
  - Venue address with directions link
  - Petrol cost information
  - Club contacts (with clickable tel: and mailto: links)
  - General information
- Separate reserve team card option

### 8. Reusable Components (NEEDS IMPLEMENTATION)

Create these in `/components/friendlies/`:

- **`GameCard.tsx`** - Display individual game with status badge
- **`GameList.tsx`** - List of game cards with filtering
- **`TeamSelectionTable.tsx`** - Interactive table for captain team selection
- **`StatusChangeModal.tsx`** - Modal for changing game status with dynamic fields
- **`MatchCardPrint.tsx`** - Printable match card template
- **`PlayerStatsDisplay.tsx`** - Show player stats in tooltip/modal
- **`TeamDisplay.tsx`** - Display team with players and positions
- **`ContactLinks.tsx`** - Render clickable phone/email links

### 9. Middleware & Route Protection (NEEDS IMPLEMENTATION)

Update `/middleware.ts`:

```typescript
// Protect /friendlies/manage routes - Captain or Admin only
if (pathname.startsWith('/friendlies/manage')) {
  if (!token || !['Captain', 'Admin'].includes(token.role as string)) {
    return NextResponse.redirect(new URL('/friendlies', req.url));
  }
}

// All /friendlies routes require authentication
if (pathname.startsWith('/friendlies')) {
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
}
```

### 10. Environment Variables (NEEDS SETUP)

Add to `.env.local`:

```env
# Friendlies System Spreadsheets
FRIENDLIES_SPREADSHEET_ID=your_friendlies_spreadsheet_id
MEMBERS_SPREADSHEET_ID=your_members_spreadsheet_id (may already exist)
MATCH_DAY_CONTACTS_SPREADSHEET_ID=your_match_day_contacts_spreadsheet_id

# App URL for email links
NEXT_PUBLIC_APP_URL=https://your-production-url.com
```

### 11. Additional Tasks

- [ ] Create email template for withdrawal notifications at `/src/lib/email/templates/withdrawal.html`
- [ ] Test all API endpoints with Postman or similar
- [ ] Add loading states and error handling to UI components
- [ ] Implement confirmation dialogs for destructive actions
- [ ] Add success/error toast notifications
- [ ] Test printing on different browsers
- [ ] Mobile responsive testing
- [ ] Add TypeScript types to NextAuth session (extend session interface)
- [ ] Create database indexes/caching if performance issues
- [ ] Add activity logging for captain actions
- [ ] Document captain workflows in user guide

## 📋 Implementation Priority

1. **HIGH PRIORITY** (Core functionality):
   - Captain status management API route
   - Player game list UI page
   - Captain team selection UI page
   - Middleware route protection

2. **MEDIUM PRIORITY** (Important features):
   - Match card API and UI
   - Captain game management list UI
   - All remaining captain API routes
   - Reusable components

3. **LOW PRIORITY** (Nice to have):
   - Email templates styling
   - Advanced filtering
   - Statistics dashboards
   - Performance optimizations

## 🧪 Testing Checklist

Once implementation is complete:

### Player Tests
- [ ] View available games
- [ ] Enter multiple games simultaneously
- [ ] View game details after selection
- [ ] Confirm participation
- [ ] Withdraw from open game
- [ ] Withdraw from selected game (verify email sent)

### Captain Tests
- [ ] Open game (verify Players column created)
- [ ] Close game (verify game sheet created with entered players)
- [ ] Get player stats
- [ ] Add offline player
- [ ] Select teams and positions
- [ ] Designate captain of day (verify only one)
- [ ] Update selection (verify sorting)
- [ ] Update stats (verify Players sheet updated)
- [ ] Publish selection
- [ ] Mark as played with scores
- [ ] Cancel game with reason
- [ ] Abandon game with partial scores

### Match Card Tests
- [ ] Match card displays correctly for home games
- [ ] Tea rota shows on home games only
- [ ] Match card displays correctly for away games
- [ ] Club details show on away games only
- [ ] Google Maps directions link works
- [ ] Phone numbers are clickable (tel: links)
- [ ] Email addresses are clickable (mailto: links)
- [ ] Print layout works on Chrome, Firefox, Safari
- [ ] Reserve teams show on separate card

### Integration Tests
- [ ] End-to-end player workflow
- [ ] End-to-end captain workflow
- [ ] Withdrawal email notification
- [ ] Role-based access control
- [ ] Concurrent access handling

## 📝 Notes

### Key Implementation Details

1. **Status Column Mapping**: There's a mapping issue in the confirm/withdraw routes where I used `captain` field for status. This needs to be corrected - the game sheet has:
   - Column K: Status (Y/W/blank)
   - Column L: Captain (Y/blank)

2. **Google Maps Integration**: The directions URL format is:
   ```
   https://www.google.com/maps/dir/?api=1
     &origin=Burgess+Hill+Bowls+Club
     &origin_place_id=ChIJcfipELGNdUgRmS1st4mG9X0
     &destination={latitude}%2C{longitude}
   ```

3. **Clickable Links**: All phone and email displays must use:
   - Phone: `<a href="tel:07700900123">07700 900123</a>` (spaces removed in href)
   - Email: `<a href="mailto:email@example.com">email@example.com</a>`

4. **Driving Bands**: Map to petrol costs as: A=£2, B=£3, C=£4, D=£5

5. **Tea Rota Matching**: Match by date (flexible), time (exact), and club name (exact)

### Common Patterns

**API Route Authentication**:
```typescript
const session = await getServerSession(authOptions);
if (!session?.user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
const userName = session.user.userName;
```

**Captain/Admin Check**:
```typescript
if (!['Captain', 'Admin'].includes(session.user.role)) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
}
```

**Error Handling**:
```typescript
try {
  // ... operation
  return NextResponse.json({ success: true, data });
} catch (error) {
  console.error('Error:', error);
  return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
}
```

## 🚀 Next Steps

To continue implementation:

1. Create captain API routes (manage/status, manage/game, etc.)
2. Create match card API route with full integration
3. Build player UI pages (games list, game details)
4. Build captain UI pages (manage list, team selection)
5. Create match card UI component with print styles
6. Build reusable components
7. Update middleware for route protection
8. Test end-to-end workflows
9. Deploy and monitor

## 📚 Reference Documents

All specifications are in `/specs/Friendly Files/`:
- FRIENDLIES_TECHNICAL_SPEC.md - Complete technical specification
- FRIENDLIES_IMPLEMENTATION_GUIDE.md - Detailed implementation guide with code examples
- FRIENDLIES_CHANGES_LOG.md - Changes and corrections log
- TEA_ROTA_QUICK_REFERENCE.md - Tea rota integration details
- MATCH_DAY_CONTACTS_QUICK_REFERENCE.md - Club contacts integration
- GOOGLE_MAPS_DIRECTIONS_SUMMARY.md - Directions feature details
- CLICKABLE_LINKS_GUIDE.md - Tel/mailto link implementation guide
