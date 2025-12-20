# Friendlies System - Changes Log

## Corrections Made - December 19, 2025

### 1. Header Cell Format (Column L)
**Original:** Game details were to be displayed in cell L1/M1 with format:
```
{Club Name} {Tab Date}
{Time} - {H/A}
{Format} - {Ladies/Men}
```

**Corrected:** Column L has standard header format of "Captain" only. No game details in header cells.

**Impact:**
- Simplified game sheet header row
- Game details displayed in UI instead
- Column L row 1 contains just "Captain" like other column headers

---

### 2. Abandon Game Status - Capture Scores
**Original:** Abandon Game (S → A) captured only:
- Reason (why game was abandoned)

**Corrected:** Abandon Game (S → A) now captures:
- BHBC Score (partial score when game started)
- Opponent Score (partial score)
- Reason (why game couldn't be completed)

**Rationale:** If a game is abandoned, it means it started but couldn't finish (e.g., weather stopped play mid-game). Need to record partial scores that were achieved.

**Impact:**
- Games sheet columns P, Q, R are updated for abandoned games
- Status change modal requires score inputs for abandon action
- Differentiates abandoned games (started) from cancelled games (never started)

**API Changes:**
```typescript
// Status change request for abandon
{
  "action": "abandon",
  "bhbc_score": 45,
  "opponent_score": 38,
  "reason": "Heavy rain stopped play after 2 hours"
}
```

---

### 3. Add Offline Player - Support Status S
**Original:** Add Offline Player only worked when game status = X (Selecting)

**Corrected:** Add Offline Player now works for:
- Status X (Selecting) - original use case
- Status S (Selected) - emergency use case

**Rationale:** When a player withdraws after selection is published (status S) and there are no reserves available, the captain needs to add a replacement player quickly. This is uncommon but necessary.

**Impact:**
- API endpoint verification changed from `status === 'X'` to `['X', 'S'].includes(status)`
- Allows emergency team changes after publishing
- Still requires captain/admin authorization

**Use Case Example:**
1. Captain publishes selection (status → S)
2. Player withdraws at 9am on match day
3. No reserves were selected
4. Captain adds replacement player who agreed to play
5. Captain updates selection to assign them to the withdrawn player's position

**API Changes:**
```typescript
// Add offline player endpoint now accepts both statuses
export async function POST(request: NextRequest) {
  // Verify game status is X (Selecting) or S (Selected)
  if (!['X', 'S'].includes(game.status)) {
    return NextResponse.json(
      { error: 'Can only add players to games with Selecting or Selected status' },
      { status: 400 }
    );
  }
  // ... rest of logic
}
```

---

## 4. Tea Rota Integration

**Added:** Tea Rota sheet structure and integration with match cards

**Tea Rota Sheet Location:** Membership List spreadsheet

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
The system matches tea rota entries to games by:
1. Date (flexible matching on date portion)
2. Time (exact match)
3. Club Name (exact match)

**Display:**
- Tea rota displays on match cards for **home games only** (H/A = "H")
- Shows Lead, Second, Third names
- Can use either full names or short names depending on space

**Implementation:**
```typescript
// Get tea rota for a specific game
export async function getTeaRota(date: string, time: string, clubName: string) {
  // Matches from Tea Rota sheet in Members spreadsheet
  // Returns: { lead, second, third, shortLead, shortSecond, shortThird }
}

// In match card API
if (game.homeAway === 'H') {
  teaRota = await getTeaRota(game.date, game.time, game.clubName);
}
```

**Impact:**
- Match cards now display tea duty assignments automatically
- No manual lookup needed
- Integrated seamlessly with existing match card generation

---

## 5. Match Day Contacts Integration

**Added:** Match Day Contacts spreadsheet integration for away game details

**Spreadsheet Location:** Separate "Match Day Contacts" spreadsheet

**Contains 2 Sheets:**

### clubs Sheet
**Columns (18 total):**
- Club Name, Club Number, Club Mobile, Club email Address, Club email Note
- General Information, Driving Band
- Address 1, Address 2, Address 3, Address 4, Post Code
- Google Address, Bowls England URL, Website, BH Website
- Latitude, Longitude

**Driving Band Codes:**
- A = £2.00
- B = £3.00  
- C = £4.00
- D = £5.00

### Contacts Sheet
**Columns (9 total):**
- Club Name, Role, First Name, Last Name, Name
- Phone Number, Mobile Number, Notes, Email

**Matching Logic:**
The system matches club information to games by:
1. Club Name (exact match)

**Contact Priority:**
1. Captain (shown first)
2. Secretary (shown second)
3. Other roles (shown in order found)

**Display:**
- Club details and contacts display on match cards for **away games only** (H/A = "A")
- Shows venue address, general information, petrol cost
- Shows primary contacts with phone/email
- **Includes Google Maps directions link** from Burgess Hill Bowls Club to destination
  - Uses GPS coordinates (latitude/longitude) for accuracy
  - Format: `https://www.google.com/maps/dir/?api=1&origin=Burgess+Hill+Bowls+Club&origin_place_id=ChIJcfipELGNdUgRmS1st4mG9X0&destination={lat}%2C{lng}`
- Home games (H/A = "H") do not show club details

**Implementation:**
```typescript
// Get club details
export async function getClubDetails(clubName: string) {
  // Matches from clubs sheet in Match Day Contacts spreadsheet
  // Maps driving band to petrol cost
  // Returns: { address, petrolCost, drivingBand, generalInfo, ... }
}

// Get club contacts
export async function getClubContacts(clubName: string) {
  // Matches from Contacts sheet in Match Day Contacts spreadsheet
  // Sorts by role priority (Captain, Secretary, others)
  // Returns: [{ name, role, phone, mobile, email, notes }]
}

// In match card API
if (game.homeAway === 'A') {
  clubDetails = await getClubDetails(game.clubName);
  clubContacts = await getClubContacts(game.clubName);
  
  // Generate directions URL
  if (clubDetails && clubDetails.latitude && clubDetails.longitude) {
    directionsUrl = `https://www.google.com/maps/dir/?api=1` +
      `&origin=Burgess+Hill+Bowls+Club` +
      `&origin_place_id=ChIJcfipELGNdUgRmS1st4mG9X0` +
      `&destination=${clubDetails.latitude}%2C${clubDetails.longitude}`;
  }
}
```

**Match Card Display Example:**
```
Venue:
  Balcombe Recreation Ground
  Haywards Heath Road
  Balcombe, West Sussex
  RH17 6PA
  [Get Directions from BHBC] ← hyperlink

General Information:
  Park in main car park

Petrol Cost: £3.00 per person (Band B)

Contact:
  Captain: John Smith
  Mobile: 07700 900123 ← clickable tel: link
  Email: john.smith@email.com ← clickable mailto: link
```

**Display Requirements:**
- All phone numbers must be clickable with `tel:` links
- All email addresses must be clickable with `mailto:` links
- Remove spaces from phone numbers in href (e.g., `tel:07700900123`)
- Keep formatted display with spaces (e.g., display as "07700 900123")

**Impact:**
- Away game match cards now include complete venue information
- Automatic petrol cost calculation from driving band
- Direct contact information for opposing club
- **One-click directions from BHBC to away venues** using GPS coordinates
- **All phone numbers are clickable** with tel: links (opens phone app)
- **All email addresses are clickable** with mailto: links (opens email app)
- No manual lookup needed for addresses or contacts
- Integrated seamlessly with existing match card generation

---

## 6. Clickable Contact Links

**Added:** All phone numbers and email addresses are now clickable links

**Link Formatting:**

### Phone Numbers (tel: links)
```html
<!-- Display format (with spaces) -->
07700 900123

<!-- Link format (spaces removed) -->
<a href="tel:07700900123">07700 900123</a>

<!-- Implementation -->
<a href={`tel:${phoneNumber.replace(/\s/g, '')}`}>
  {phoneNumber}
</a>
```

### Email Addresses (mailto: links)
```html
<!-- Display format -->
john.smith@email.com

<!-- Link format -->
<a href="mailto:john.smith@email.com">john.smith@email.com</a>

<!-- Implementation -->
<a href={`mailto:${email}`}>
  {email}
</a>
```

**Applies To:**
- Club phone numbers (Club Number, Club Mobile)
- Club email addresses
- Individual contact phone numbers (Phone Number, Mobile Number)
- Individual contact email addresses

**User Experience:**
- **Mobile devices:** Tap phone number → Opens phone app ready to dial
- **Mobile devices:** Tap email → Opens email app with recipient pre-filled
- **Desktop:** Click phone number → Opens default phone/Skype app
- **Desktop:** Click email → Opens default email client

**Benefits:**
- One-tap calling on mobile
- One-tap email composition
- Reduces manual data entry errors
- Improves accessibility
- Faster communication with away clubs

---

## Summary of Updated Files

### Technical Specification (`FRIENDLIES_TECHNICAL_SPEC.md`)
- Section 2.3: Removed header cell format description
- Section 2.5: Added Tea Rota sheet structure
- Section 2.6: Added Match Day Contacts spreadsheet structure (clubs and Contacts sheets)
- Section 4.1: Updated Abandon Game to capture scores
- Section 4.4: Added note about supporting status S for add player
- Section 4.7: Added Tea Rota and Match Day Contacts matching logic for match cards
- Section 4.7: Added requirement for clickable phone (tel:) and email (mailto:) links

### Implementation Guide (`FRIENDLIES_IMPLEMENTATION_GUIDE.md`)
- Section 3.1: Removed game header update from `createGameSheet` function
- Section 3.1: Added `getTeaRota` function for matching tea rota to games
- Section 3.1: Added `getClubDetails` function for club information
- Section 3.1: Added `getClubContacts` function for club contact persons
- Section 4.3: Added complete example of add-player endpoint
- Section 4.4: Updated status change handler for abandon action
- Section 5.1: Added match card API endpoint with tea rota and club details integration
- Section 5.1: Added Google Maps directions URL generation
- UI examples: All phone and email displays use proper tel: and mailto: links

### Quick Reference Guides
- **Tea Rota Quick Reference** - Complete guide to tea rota integration
- **Match Day Contacts Quick Reference** - Complete guide to club details and contacts
- **Google Maps Directions Summary** - Complete guide to directions integration
- **Clickable Links Guide** - Complete guide to tel: and mailto: link implementation

---

## Testing Impact

### Additional Test Cases Needed

**Abandon Game:**
- [ ] Abandon game with partial scores
- [ ] Verify scores saved to Games sheet columns P, Q
- [ ] Verify reason saved to Games sheet column R
- [ ] Abandon game without scores shows validation error

**Add Offline Player (Status S):**
- [ ] Add player when status = S
- [ ] Verify player can be assigned to withdrawn player's position
- [ ] Verify Players sheet updated to "E"
- [ ] Verify stats retrieved for new player
- [ ] Attempt to add player with other statuses shows error

**Tea Rota:**
- [ ] Tea rota displays correctly on home game match cards
- [ ] Tea rota does not display on away game match cards
- [ ] Tea rota matches game by date, time, and club name
- [ ] Missing tea rota entries handled gracefully (no error)
- [ ] Both full names and short names available for display

**Match Day Contacts - Club Details:**
- [ ] Club details display correctly on away game match cards
- [ ] Club details do not display on home game match cards
- [ ] Address displays correctly formatted
- [ ] Post code displays prominently
- [ ] Google Maps directions link generates correctly
- [ ] Directions link opens from BHBC to destination venue
- [ ] Directions link uses GPS coordinates (latitude/longitude)
- [ ] General information displays when present
- [ ] Missing club details handled gracefully (no error)

**Match Day Contacts - Petrol Costs:**
- [ ] Band A displays £2.00
- [ ] Band B displays £3.00
- [ ] Band C displays £4.00
- [ ] Band D displays £5.00
- [ ] Invalid/missing band handled gracefully

**Match Day Contacts - Contacts:**
- [ ] Captain contact displays first when present
- [ ] Secretary contact displays second when present
- [ ] Multiple contacts display correctly
- [ ] Phone numbers are clickable (tel: links)
- [ ] Mobile numbers are clickable (tel: links)
- [ ] Email addresses are clickable (mailto: links)
- [ ] Tel links have spaces removed in href
- [ ] Tel links display with spaces for readability
- [ ] Mailto links open email client with recipient pre-filled
- [ ] Links work on mobile (open phone/email apps)
- [ ] Links work on desktop (open default apps)
- [ ] Missing contacts handled gracefully
- [ ] Contact notes display when present

**Clickable Links:**
- [ ] All phone numbers have tel: links
- [ ] All email addresses have mailto: links
- [ ] Club phone numbers are clickable
- [ ] Club email addresses are clickable
- [ ] Contact phone numbers are clickable
- [ ] Contact email addresses are clickable
- [ ] Tel links work on mobile devices (open phone app)
- [ ] Tel links work on desktop (open phone/Skype app)
- [ ] Mailto links work on mobile devices (open email app)
- [ ] Mailto links work on desktop (open email client)
- [ ] Spaces removed from tel: href but preserved in display

---

## No Breaking Changes

These corrections are enhancements and clarifications that:
- ✅ Don't change existing data structures
- ✅ Don't require database migrations
- ✅ Add validation rather than remove it
- ✅ Expand functionality rather than restrict it
- ✅ Maintain backward compatibility

---

## Implementation Notes

When implementing these changes:

1. **For Header Cell:** Simply don't write to cell L1/M1 during game sheet creation
2. **For Abandon Scores:** Add score inputs to the abandon status modal UI
3. **For Add Player S Status:** Change validation from `=== 'X'` to `.includes('X', 'S')`

All changes are straightforward and don't require complex refactoring.
