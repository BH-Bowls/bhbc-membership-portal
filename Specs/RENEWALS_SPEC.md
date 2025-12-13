# BHBC Members Portal - Renewals System Specification

## Overview

Build a membership renewal system for the 2026 season that allows members to:
- Renew their membership
- Update volunteering preferences
- Enter club competitions
- Subscribe to 200 Club
- Calculate and view total fees
- Receive email confirmation

**Deadline:** December 31, 2025 (for 2026 season renewals)
**Total Members:** 205

---

## Tech Stack Context

- **Framework:** Next.js 16 with App Router
- **Authentication:** NextAuth with session-based auth
- **Database:** Google Sheets (via Google Sheets API v4)
- **Backend:** Next.js API routes
- **Frontend:** React with TypeScript, Tailwind CSS
- **Email:** Gmail API (via service account)

**Existing Patterns to Follow:**
- `app/profile/page.tsx` - Form structure and state management
- `src/lib/profile-sheets.ts` - Google Sheets CRUD operations
- `src/lib/auth-sheets.ts` - Authentication and email sending
- `app/api/profile/route.ts` - API endpoint patterns

---

## Database Schema: Renewals2026 Sheet

**Sheet Name:** `Renewals2026`
**Location:** Same spreadsheet as Users sheet

### Column Structure (snake_case headers):

```
Column | Field Name                    | Type    | Description
-------|-------------------------------|---------|------------------------------------------
A      | user_name                     | string  | Primary key (links to Users sheet)
B      | renewing_membership           | string  | "Yes" or "No"
C      | playing_fees                  | number  | Calculated based on age_demographic
D      | social_fees                   | number  | Calculated if social member
E      | comps_fee                     | number  | £2 per competition entered
F      | fee_200_club                  | number  | £6 per 200 Club entry
G      | total_payment                 | number  | Sum of all fees
H      | banking                       | number  | Amount received (admin only)
I      | date_received                 | date    | Payment received date (admin only)
J      | number_200_club_entries       | number  | Count of 200 Club entries
K      | pref_200_club                 | string  | Preferred 200 Club numbers
L      | cleaning_dates_to_avoid       | string  | Dates unavailable for cleaning
M      | tea_dates_to_avoid            | string  | Dates unavailable for tea duty
N      | mens_championship             | boolean | Competition entry (Y/N)
O      | ladies_maynard                | boolean | Competition entry (Y/N)
P      | mens_two_wood                 | boolean | Competition entry (Y/N)
Q      | ladies_two_wood               | boolean | Competition entry (Y/N)
R      | married_pairs                 | boolean | Competition entry (Y/N)
S      | drawn_pairs                   | boolean | Competition entry (Y/N)
T      | australian_pairs              | boolean | Competition entry (Y/N)
U      | drawn_triples                 | boolean | Competition entry (Y/N)
V      | handicap                      | boolean | Competition entry (Y/N)
W      | oldlands                      | boolean | Competition entry (Y/N)
X      | veterans                      | boolean | Competition entry (Y/N)
Y      | drawn_pairs_sub               | boolean | Substitute for Drawn Pairs
Z      | australian_pairs_sub          | boolean | Substitute for Australian Pairs
AA     | drawn_triples_sub             | boolean | Substitute for Drawn Triples
AB     | league_comp                   | boolean | New league competition
AC     | date_updated                  | date    | Last update timestamp
```

---

## Fee Calculation Logic

### Membership Fees (2026 Season)

```typescript
interface FeeStructure {
  U18: { playing: 0, social: 0 };           // Free for under 18
  '18-24': { playing: 50, social: 25 };     // Reduced rate (if full-time education)
  '25-59': { playing: 100, social: 50 };    // Full rate
  '60+': { playing: 75, social: 40 };       // Senior rate
  '80+': { playing: 50, social: 25 };       // Senior reduced
}

// Logic:
// - If ageDemographic === 'U18' → Free
// - If ageDemographic === '18-24' AND fullTimeEducation → Reduced
// - If memberType === 'Playing' → playing fee
// - If memberType === 'Social' → social fee
```

### 200 Club Fees
```typescript
const CLUB_200_FEE_PER_ENTRY = 6; // £6 per entry
total200ClubFee = number_200_club_entries * 6;
```

### Competition Fees
```typescript
const COMPETITION_FEE = 2; // £2 per competition

// Count competitions where value is true (Y in sheet):
const competitions = [
  'mens_championship', 'ladies_maynard', 'mens_two_wood',
  'ladies_two_wood', 'married_pairs', 'drawn_pairs',
  'australian_pairs', 'drawn_triples', 'handicap',
  'oldlands', 'veterans'
];

totalCompsFee = competitions.filter(comp => renewalData[comp] === true).length * 2;

// Note: Substitutions and league_comp are FREE (no fee)
```

### Total Payment
```typescript
total_payment = playing_fees + social_fees + comps_fee + fee_200_club;
```

---

## Business Rules

### Competition Eligibility

**Rule:** Members must have made themselves available for 8+ friendly matches in the previous season to enter competitions.

```typescript
// From Users sheet: friendlies_last_year column
if (user.friendliesLastYear < 8) {
  // Disable competition checkboxes
  // Show message: "You need 8+ friendlies to enter competitions"
}
```

**Special Competitions:**
- **Oldlands:** Only for members who have NOT won a BHBC singles competition
- **Veterans:** Must be 60+ on March 1st

**Finals Date:** September 6-7, 2026 (members must be available)

### New Member Restrictions

New members (first full season) cannot enter competitions unless:
- Exception granted by Tournament Committee
- For experienced bowlers only

### Substitutes

Members NOT entering Pairs/Triples can register as substitutes:
- No entry fee unless called upon to play
- £2 charged if they actually play

---

## File Structure

```
app/
├── renewals/
│   └── page.tsx              ← NEW: Renewals form page
├── api/
│   └── renewals/
│       └── route.ts          ← NEW: GET/PUT endpoints
src/
├── lib/
│   └── renewals-sheets.ts    ← NEW: Google Sheets operations
```

---

## Implementation Details

### 1. Backend: src/lib/renewals-sheets.ts

```typescript
// Required functions:

/**
 * Get renewal data for a user
 * - Fetch from Renewals2026 sheet
 * - If no row exists, create blank row with user_name
 * - Return renewal data
 */
export async function getRenewalByUsername(userName: string): Promise<Renewal | null>

/**
 * Update renewal data
 * - Update multiple columns in single batch operation
 * - Set date_updated to current timestamp
 * - Calculate and update total_payment
 * - Return updated renewal
 */
export async function updateRenewal(
  userName: string, 
  updates: Partial<Renewal>
): Promise<{ success: boolean; error?: string }>

/**
 * Calculate fees based on renewal data
 * - Takes user profile (age_demographic, member_type)
 * - Takes renewal selections
 * - Returns breakdown: { membershipFee, compsFee, club200Fee, total }
 */
export function calculateFees(
  profile: { ageDemographic: string; memberType: string; fullTimeEducation?: boolean },
  renewal: Partial<Renewal>
): FeeBreakdown

/**
 * Send renewal confirmation email
 * - Uses Gmail API
 * - Template: "Renewals Template Response" (draft in Gmail)
 * - Includes: name, fees breakdown, bank details
 */
export async function sendRenewalConfirmation(
  userName: string,
  renewal: Renewal,
  fees: FeeBreakdown
): Promise<{ success: boolean; error?: string }>
```

**Column Mapping:**
- Use flexible `getColumnMap()` from sheets.ts
- Convert camelCase ↔ snake_case like in profile-sheets.ts
- Manual mapping for edge cases (if needed)

---

### 2. API Routes: app/api/renewals/route.ts

```typescript
// GET /api/renewals
// Returns current user's renewal data + profile data for calculations
export async function GET(request: Request) {
  // 1. Get session (getServerSession)
  // 2. Get user profile from Users sheet (for age_demographic, friendlies_last_year)
  // 3. Get renewal data from Renewals2026 sheet
  // 4. Calculate current fees
  // 5. Return: { profile, renewal, fees, eligibility }
}

// PUT /api/renewals
// Updates renewal data and sends confirmation email
export async function PUT(request: Request) {
  // 1. Get session
  // 2. Parse request body (renewal data)
  // 3. Validate data
  // 4. Calculate fees
  // 5. Update Renewals2026 sheet
  // 6. Send confirmation email
  // 7. Return: { success, renewal, fees }
}
```

---

### 3. Frontend: app/renewals/page.tsx

**Layout Structure:**

```
┌─────────────────────────────────────────────────┐
│ Membership Renewals                             │
├─────────────────────────────────────────────────┤
│ [✓] I will be renewing my membership            │
│                                                  │
│ Age Demographic: [60+      ▼]                   │
│ [✓] Full-time education (if 18-24)              │
│ Member Type: [Playing  ▼]                       │
│                                                  │
│ Membership Fee: £75.00                          │
├─────────────────────────────────────────────────┤
│ 200 Club                                        │
│ Number of entries: [2]                          │
│ Preferred numbers: [7, 23]                      │
│ 200 Club Fee: £12.00                            │
├─────────────────────────────────────────────────┤
│ Volunteering                                    │
│ Tea Duty dates to avoid: [textarea]             │
│ Cleaning dates to avoid: [textarea]             │
│ Driving: ○ Yes ○ No [extra info textarea]      │
│ Green Maintenance: ○ Yes ○ No [textarea]       │
│ Bar Duty: ○ Yes ○ No [textarea]                │
│ Other Skills: [textarea]                        │
├─────────────────────────────────────────────────┤
│ Club Competitions                               │
│ Friendlies last year: 12 ✓ Eligible            │
│ [✓] Men's Championship                          │
│ [✓] Drawn Pairs                                 │
│ [ ] Handicap                                    │
│ ... (all competitions)                          │
│ Competition Fee: £4.00                          │
│                                                  │
│ Substitutions (no fee):                         │
│ [ ] Drawn Pairs Sub                             │
│ [ ] Australian Pairs Sub                        │
│ [ ] Drawn Triples Sub                           │
│                                                  │
│ [ ] League Competition (new)                    │
├─────────────────────────────────────────────────┤
│ Total Fee Payable: £91.00                       │
│                                                  │
│ [Cancel] [Save Renewal]                         │
└─────────────────────────────────────────────────┘

After submission:
┌─────────────────────────────────────────────────┐
│ Thank you! Your renewal has been submitted.     │
│                                                  │
│ Membership Fee:    £75.00                       │
│ 200 Club:          £12.00                       │
│ Competitions:      £4.00                        │
│ ────────────────────────                        │
│ Total Payable:     £91.00                       │
│                                                  │
│ Payment Details:                                │
│ Bank: HSBC                                      │
│ Sort Code: 40-15-16                             │
│ Account: 81554948                               │
│ Reference: [Name] SUBS                          │
│                                                  │
│ A confirmation email has been sent.             │
└─────────────────────────────────────────────────┘
```

**State Management:**

```typescript
const [profile, setProfile] = useState<UserProfile | null>(null);
const [renewal, setRenewal] = useState<Renewal>({
  renewingMembership: true,
  number200ClubEntries: 0,
  // ... all fields
});
const [fees, setFees] = useState<FeeBreakdown>({
  membershipFee: 0,
  club200Fee: 0,
  compsFee: 0,
  total: 0,
});
const [isSubmitted, setIsSubmitted] = useState(false);
const [isLoading, setIsLoading] = useState(true);
const [isSaving, setIsSaving] = useState(false);
```

**Real-time Fee Calculation:**

```typescript
// Recalculate fees whenever renewal data changes
useEffect(() => {
  if (profile && renewal) {
    const newFees = calculateFeesClient(profile, renewal);
    setFees(newFees);
  }
}, [profile, renewal]);

// Helper function (mirrors backend logic)
function calculateFeesClient(profile: UserProfile, renewal: Renewal): FeeBreakdown {
  // Implement fee calculation logic here
}
```

**Competition Eligibility:**

```typescript
const isEligibleForCompetitions = profile?.friendliesLastYear >= 8;

// Disable competition checkboxes if not eligible
<input
  type="checkbox"
  disabled={!isEligibleForCompetitions}
  checked={renewal.mensChampionship}
  onChange={(e) => handleChange('mensChampionship', e.target.checked)}
/>

{!isEligibleForCompetitions && (
  <p className="text-sm text-red-600 mt-2">
    You need 8+ friendlies to enter competitions. Last year: {profile.friendliesLastYear}
  </p>
)}
```

**Conditional Rendering:**

- Only show competition section if `renewal.renewingMembership === true`
- Only show "renewing" checkbox if `profile.memberType !== 'Cancelled'`
- Show payment details after successful submission

---

## TypeScript Types

```typescript
// src/types/renewals.ts (create new file)

export interface Renewal {
  userName: string;
  renewingMembership: boolean;
  playingFees: number;
  socialFees: number;
  compsFee: number;
  fee200Club: number;
  totalPayment: number;
  banking?: number;
  dateReceived?: string;
  number200ClubEntries: number;
  pref200Club?: string;
  cleaningDatesToAvoid?: string;
  teaDatesToAvoid?: string;
  mensChampionship: boolean;
  ladiesMaynard: boolean;
  mensTwoWood: boolean;
  ladiesTwoWood: boolean;
  marriedPairs: boolean;
  drawnPairs: boolean;
  australianPairs: boolean;
  drawnTriples: boolean;
  handicap: boolean;
  oldlands: boolean;
  veterans: boolean;
  drawnPairsSub: boolean;
  australianPairsSub: boolean;
  drawnTriplesSub: boolean;
  leagueComp: boolean;
  dateUpdated?: string;
}

export interface FeeBreakdown {
  membershipFee: number;
  club200Fee: number;
  compsFee: number;
  total: number;
}

export interface UserProfile {
  userName: string;
  fullKnownAs: string;
  ageDemographic: string;
  memberType: string;
  friendliesLastYear: number;
  emailAddress: string;
  fullTimeEducation?: boolean;
}
```

---

## Email Template

**Gmail Draft Name:** "Renewals Template Response"

**Template Variables:**
- `{{full_known_as}}` - Member name
- `{{membership_fees}}` - Formatted currency
- `{{comps_fee}}` - Formatted currency
- `{{fee_200_club}}` - Formatted currency
- `{{total_payment}}` - Formatted currency

**Email Subject:** "BHBC Membership Renewal Confirmation"

**Email Body Structure:**
```
Dear {{full_known_as}},

Thank you for renewing your membership for the 2026 season.

Your renewal details:
- Membership Fee: {{membership_fees}}
- Competitions: {{comps_fee}}
- 200 Club: {{fee_200_club}}
─────────────────────────
Total Payable: {{total_payment}}

Payment Details:
Bank: HSBC
Sort Code: 40-15-16
Account Number: 81554948
Account Name: Burgess Hill Bowls Club
Reference: {{full_known_as}} SUBS

Please make payment at your earliest convenience. Cash, cheque, and card payments are also accepted at the bar.

If you have any questions, please contact the Treasurer.

Best regards,
Burgess Hill Bowls Club
```

---

## Navigation

**Add to Main Menu:**

```typescript
// In app/layout.tsx or navigation component
<Link href="/renewals">Renew Membership</Link>

// Should be visible to:
// - Logged in users only
// - Not visible if memberType === 'Cancelled'
```

**Add to Home Page:**

```typescript
// In app/page.tsx, add action button:
<Link href="/renewals">
  <button>Renew for 2026 Season</button>
</Link>
```

---

## Validation Rules

```typescript
// Frontend validation:
const validate = () => {
  const errors: string[] = [];
  
  if (!renewal.renewingMembership) {
    return true; // No validation needed if not renewing
  }
  
  // Age demographic required
  if (!profile?.ageDemographic) {
    errors.push('Age demographic is required');
  }
  
  // 200 Club numbers
  if (renewal.number200ClubEntries > 0 && !renewal.pref200Club) {
    // Optional: could warn but not block
  }
  
  // At least one competition if entering comps
  // (handled by fee calculation - no fee = no issue)
  
  return errors.length === 0;
};
```

---

## Testing Checklist

### Backend Tests
- [ ] getRenewalByUsername creates row if doesn't exist
- [ ] getRenewalByUsername returns existing data
- [ ] updateRenewal saves all fields correctly
- [ ] calculateFees returns correct membership fees for each age group
- [ ] calculateFees calculates 200 Club correctly (£6 × entries)
- [ ] calculateFees calculates competitions correctly (£2 × count)
- [ ] calculateFees returns correct total
- [ ] sendRenewalConfirmation sends email successfully
- [ ] Column mapping works for all renewal fields

### API Tests
- [ ] GET /api/renewals returns profile + renewal + fees
- [ ] GET /api/renewals returns 401 if not authenticated
- [ ] PUT /api/renewals updates renewal successfully
- [ ] PUT /api/renewals sends confirmation email
- [ ] PUT /api/renewals returns updated fees

### Frontend Tests
- [ ] Page loads renewal data on mount
- [ ] Fees update in real-time as form changes
- [ ] Competition section disabled if < 8 friendlies
- [ ] Age demographic affects membership fee correctly
- [ ] 200 Club entries calculate correctly
- [ ] Competition checkboxes update fee
- [ ] Substitutions don't affect fee
- [ ] Save button triggers PUT request
- [ ] Success message shows after save
- [ ] Payment details display after save
- [ ] Email confirmation sent

### Edge Cases
- [ ] New user (no renewal row) - creates blank row
- [ ] User with 0 friendlies - competitions disabled
- [ ] U18 member - free membership
- [ ] 18-24 + full-time education - reduced fee
- [ ] Social member - different fee structure
- [ ] Not renewing - clears all other fields

### Integration Tests
- [ ] Complete renewal flow end-to-end
- [ ] Data persists in Google Sheets correctly
- [ ] Boolean fields stored as Y/N in sheets
- [ ] Date fields formatted correctly
- [ ] Email received with correct details
- [ ] Can edit renewal after initial save
- [ ] Navigation works from home → renewals → profile

---

## Error Handling

```typescript
// Backend errors to handle:
- Google Sheets API failures
- Email sending failures
- User not found
- Invalid renewal data

// Frontend errors to display:
- Failed to load renewal data
- Failed to save renewal
- Network errors
- Validation errors

// User-friendly messages:
"Unable to load your renewal information. Please try again."
"Unable to save your renewal. Please check your connection and try again."
"Email confirmation could not be sent, but your renewal was saved."
```

---

## Performance Considerations

- **Batch Google Sheets Operations:** Update multiple columns in single API call
- **Cache Column Map:** Use `getColumnMap()` once per request
- **Debounce Fee Calculations:** Only recalculate after user stops typing (200ms delay)
- **Optimistic Updates:** Show success immediately, sync in background

---

## Security Considerations

- **Authentication:** All routes require valid session
- **Authorization:** Users can only access their own renewal
- **Input Validation:** Sanitize all user inputs
- **Admin Fields:** `banking` and `dateReceived` should be read-only (admin only)
- **Rate Limiting:** Consider limiting email sends (already has logLoginAttempt pattern)

---

## Future Enhancements (Post-MVP)

- [ ] Admin dashboard to view all renewals
- [ ] Admin can mark payment as received
- [ ] Export renewals to CSV
- [ ] Renewal reminders (email automation)
- [ ] Payment integration (Stripe/PayPal)
- [ ] Buddy system: Renew on behalf of family member
- [ ] PDF receipt generation
- [ ] Historical renewals view

---

## Success Criteria

✅ Members can renew membership for 2026 season
✅ Fees calculate correctly based on age/type/selections
✅ Data saves to Renewals2026 Google Sheet
✅ Confirmation email sent successfully
✅ Payment details displayed clearly
✅ Competition eligibility enforced (8+ friendlies)
✅ Real-time fee calculation as user makes selections
✅ All 205 members can complete renewal by Dec 31, 2025

---

## Questions for Implementation

1. **Full-time education checkbox:** Should this be in Users profile or just in renewals form?
   - Recommendation: Add to profile (persistent), use in renewals calculation

2. **Oldlands competition eligibility:** How to track "has won singles competition"?
   - Recommendation: Add field to Users sheet or manual override by admin

3. **Payment tracking:** Admin-only or show to users?
   - Recommendation: Admin-only (date_received, banking columns)

4. **Multiple renewals:** Can user save draft and come back?
   - Recommendation: Yes, save as draft (date_updated tracks changes)

5. **Deadline enforcement:** Block renewals after certain date?
   - Recommendation: Soft deadline (show warning), allow admin override

---

## References

**Existing Files to Study:**
- `11-server_RenewMembership_gs.txt` - Original serverFnRenewGet/Update logic
- `11_form-RenewMembership_html.txt` - Original HTML form structure
- `11_js-RenewMembership_html.txt` - Original client-side logic
- `app/profile/page.tsx` - Form patterns and state management
- `src/lib/profile-sheets.ts` - Google Sheets CRUD patterns

**Google Sheets:**
- Users sheet: `17BwGOIjVGZL1CxvOHwiP25j1ZQ-xmwYEcWFiS5_1pXI`
- Sheet tabs: Users, Renewals2026, LoginAttempts

---

## Implementation Order

1. **Phase 1: Backend Foundation**
   - Create `src/lib/renewals-sheets.ts`
   - Implement `getRenewalByUsername()`
   - Implement `updateRenewal()`
   - Implement `calculateFees()`
   - Test with example user

2. **Phase 2: API Layer**
   - Create `app/api/renewals/route.ts`
   - Implement GET endpoint
   - Implement PUT endpoint
   - Test with Postman/curl

3. **Phase 3: Frontend UI**
   - Create `app/renewals/page.tsx`
   - Build form sections (membership, 200 club, volunteering)
   - Implement real-time fee calculation
   - Add competition section with eligibility check
   - Test form interactions

4. **Phase 4: Integration**
   - Connect frontend to API
   - Test save functionality
   - Test data persistence in Google Sheets
   - Verify fee calculations

5. **Phase 5: Email Confirmation**
   - Create Gmail draft template
   - Implement `sendRenewalConfirmation()`
   - Test email sending
   - Verify email formatting

6. **Phase 6: Polish & Testing**
   - Add navigation links
   - Improve error messages
   - Add loading states
   - Complete testing checklist
   - User acceptance testing

---

**Estimated Complexity:** Medium-High
**Estimated Time:** 4-6 hours (with Claude Code assistance)
**Dependencies:** Profile system (complete ✅), Auth system (complete ✅)
**Risk Areas:** Fee calculation logic, competition eligibility rules, email delivery

---

## Ready for Claude Code!

This specification is comprehensive enough for Claude Code to build the complete renewals system. Give Claude Code this entire document and ask it to implement the system following the patterns from the profile system.

**Suggested Claude Code Prompt:**

```
Build the membership renewals system according to RENEWALS_SPEC.md. Follow the existing patterns from app/profile/ and src/lib/profile-sheets.ts. Implement in this order:
1. src/lib/renewals-sheets.ts (backend)
2. app/api/renewals/route.ts (API)
3. app/renewals/page.tsx (frontend)
4. Add navigation links
Test each phase before moving to the next.
```