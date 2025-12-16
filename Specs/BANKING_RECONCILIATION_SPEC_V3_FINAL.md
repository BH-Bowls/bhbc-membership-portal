# BHBC Members Portal - Banking Reconciliation System Specification V3 - FINAL

## Overview

The Banking Reconciliation System allows the Treasurer (Chris) to match member payments against renewals using a separate **Renewal Payments** sheet for audit trail and flexibility.

**Key Features:**

- **Renewal Payments Sheet:** Stores all payment entries separately
- **Outstanding-based matching:** Match against remaining balance, not total fee
- **Manual entry:** Add individual payments with auto-matching
- **CSV import:** Bulk bank statement imports with type selection
- **Auto-matching:** Two modes - Global match on load + Incremental match on selection
- **Manual matching:** Adjust individual renewal amounts with donations/difference
- **Split payments:** One payment covering multiple family members
- **Multiple payments:** One member can have multiple payment entries (installments)
- **Part Payments:** Track remaining balance via `outstanding` field
- **Delete/Amend payments:** Edit payment entries before matching
- **Full-width UI:** Uses entire screen width for better visibility

**Goal:** Streamline payment reconciliation while maintaining complete audit trail.

---

## Access Control

**Who can access:** Admin (role = 'A') **OR** Treasurer (role = 'T')

```typescript
const canAccessBanking = session?.user?.role === 'A' || session?.user?.role === 'T';
```

**NOT** Admin AND Treasurer - it's Admin OR Treasurer.

---

## Database Schema

### NEW SHEET: Renewal Payments

**Create a new sheet:** "Renewal Payments"

**Purpose:** Store ALL payment entries (manual and imported) with matching status.

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `payment_id` | string | Sequential ID with P prefix | P001, P002, P003 |
| `date` | date | Payment date from bank statement | 2024-12-13 |
| `type` | string | Payment type from bank | TRF, CDM, CHQ, CSH |
| `reference` | string | Reference from bank statement | SUBS DASEY, J SMITH |
| `amount` | number | Payment amount | 220.00 |
| `status` | string | Matching status | Unmatched, Matched, Deleted |
| `matched_users` | string | Comma-separated user_names matched to | liam_dasey,celia_dasey |

**Status values:**

- `Unmatched` - Payment not yet matched to any renewal
- `Matched` - Payment fully matched to renewal(s)
- `Deleted` - Payment marked as deleted (soft delete, hidden from UI)

**Note:** No "Part Matched" status for payments. Part payment tracking happens in Renewals sheet via `outstanding` field.

**Payment ID generation:**

```typescript
// Sequential: P001, P002, P003...
// Format: P + zero-padded number
function generatePaymentId(): string {
  const lastId = getLastPaymentId(); // e.g., "P005"
  const num = parseInt(lastId.substring(1)) + 1;
  return `P${String(num).padStart(3, '0')}`;
}
```

**Example data:**

| payment_id | date | type | reference | amount | status | matched_users |
|------------|------|------|-----------|--------|--------|---------------|
| P001 | 2024-12-13 | TRF | SUBS DASEY | 220.00 | Matched | liam_dasey,celia_dasey |
| P002 | 2024-12-13 | CSH | J SMITH | 110.00 | Matched | john_smith |
| P003 | 2024-12-13 | TRF | BAR PURCHASE | 50.00 | Deleted | |
| P004 | 2024-12-14 | TRF | ANONYMOUS | 50.00 | Unmatched | |
| P005 | 2024-12-15 | CSH | SUBS DASEY | 18.00 | Matched | liam_dasey |

---

### UPDATE: Renewals Sheet

**Add this column:**

| Column | Type | Description | Example |
|--------|------|-------------|---------|
| `payment_ids` | string | Comma-separated payment IDs | "P001" or "P005,P012" |

**Existing columns (already in schema):**

- `total_fee_due` - Original renewal amount (never changes)
- `outstanding` - Remaining fee due. Starts equal to total_fee_due, reduced by payments
- `banking` - Total amount received (accumulated)
- `donations` - Amount allocated to donations (accumulated)
- `difference` - Any explained difference (accumulated)
- `card_machine` - Amount paid by card machine (accumulated)
- `bank_transfer` - Amount paid by bank transfer (accumulated)
- `cheque` - Amount paid by cheque (accumulated)
- `cash` - Amount paid by cash (accumulated)
- `date_received` - Date payment received (most recent)
- `payment_notes` - User-editable notes (defaults to payment reference)

**Key points:**

- `outstanding` field already exists in schema
- Payment status is calculated (outstanding = 0 means Paid), not stored
- Load renewals where `outstanding > 0` for left column
- Overpayments will still have outstanding = 0

---

## In-Memory Fields (UI State Only)

Each renewal transaction holds six additional fields in memory (NOT in database):

| Field | Description | Example |
|-------|-------------|---------|
| `selected_banking` | Banking amount when selected (checkbox) | 118.00 |
| `selected_donations` | Donation amount when selected | 0 |
| `selected_difference` | Difference amount when selected | 0 |
| `matched_banking` | Banking amount when matched (red tick) | 118.00 |
| `matched_donations` | Donation amount when matched | 0 |
| `matched_difference` | Difference amount when matched | 0 |

Each payment transaction holds two additional fields in memory:

| Field | Description | Example |
|-------|-------------|---------|
| `selected_amount` | Amount when selected (checkbox) | 220.00 |
| `matched_amount` | Amount when matched (red tick) | 220.00 |

**Workflow:**

1. User selects renewal → `selected_banking = outstanding`
2. User selects payment → `selected_amount = amount`
3. If totals match → Move values to `matched_*` fields, clear `selected_*`
4. On Submit → Write `matched_*` values to database

---

## UI Layout - Full Screen Width

### Critical Requirement

**The banking reconciliation UI MUST use the full width of the screen.**

Unlike Profile and Renewals pages which use a centered column, the banking page needs maximum horizontal space for the two-column layout.

### Desktop Layout (Full Width)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Banking Reconciliation                    [+ Add]  [🗑️ Delete]  [📥 Import]  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  RENEWALS (Left 50%)                      PAYMENTS (Right 50%)               │
│  ───────────────────────                  ────────────────────               │
│  Name                Outstanding           Date  Type  Amount  Reference     │
│  ☐ John Smith        £110.00               ☐ 12/12  TRF  £110  SUBS SMITH   │
│  ☐ James Smith       £110.00               ☐ 12/12  TRF  £60   SUBS BROWN   │
│  ☒ Jane Brown        £72.00                                                  │
│  ✓ Liam Dasey        £118.00               ✓ 12/12  TRF  £220  SUBS DASEY   │
│  ✓ Celia Dasey       £102.00                                                 │
│                                                                                │
│  ──────────────────────────               ──────────────────────             │
│  Total Outstanding   £512.00               Total Banking        £390         │
│  Total Matched       £220.00               Total Matched        £220         │
│  Total Selected      £72.00                Total Selected       £60          │
│                                                                                │
│                                     [Submit Matched Payments]                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Legend:**

- `☐` Unselected (checkbox unchecked)
- `☒` Selected (checkbox checked, black)
- `✓` Matched (red tick, cannot select again)

**Notes on example:**

- Dasey family auto-matched (£220 = £118 + £102) → Red ticks ✓
- SUBS SMITH could be matched with either John or James Smith
- Jane Brown selected (£72) and SUBS BROWN selected (£60) → don't match → manual matching needed

### CSS Implementation

```css
/* Full width container */
.banking-page {
  max-width: 100%;
  width: 100%;
  padding: 1.5rem;
  margin: 0;
}

/* Two-column grid using full width */
.banking-columns {
  display: grid;
  grid-template-columns: 1fr 1fr; /* Equal 50/50 split */
  gap: 2rem;
  width: 100%;
}

/* Contrast with other pages */
.profile-page,
.renewals-page {
  max-width: 64rem; /* Centered, limited width */
  margin: 0 auto;
}
```

---

## Checkbox States & Behavior

### Three States

| State | Visual | Meaning | Can Click? |
|-------|--------|---------|------------|
| Unselected | ☐ | Not selected for matching | Yes → becomes Selected |
| Selected | ☒ (black check) | Selected by user, not yet matched | Yes → becomes Unselected |
| Matched | ✓ (red tick) | Matched and ready for submit | No (can't select) |

### State Transitions

```
Unselected ☐  ←→  Selected ☒  →  Matched ✓
              (click)         (auto when totals equal)
```

**Important:** Once matched (red tick), item cannot be unselected. User must unmatch by changing amounts or clicking different items.

---

## Feature 1: Add, Amend, or Delete Payment

### Dialog

```
┌────────────────────────────────────┐
│ Add / Amend Payment                │
├────────────────────────────────────┤
│ Date:                              │
│ [13/12/2024]   ← defaults today    │
│                                    │
│ Type:                              │
│ [TRF ▼]                            │
│   • TRF (Bank Transfer)            │
│   • CDM (Card Machine)             │
│   • CHQ (Cheque)                   │
│   • CSH (Cash)                     │
│                                    │
│ Amount:                            │
│ [£______]                          │
│                                    │
│ Reference:                         │
│ [SUBS DASEY_________]              │
│                                    │
│ [Cancel]  [Add]                    │
│           --- or ---               │
│ [Cancel]  [Amend]  [Delete]        │
└────────────────────────────────────┘
```

**When dialog opens:**

- **Add mode:** Empty fields, shows [Add] button
- **Amend mode:** Pre-filled with payment data, shows [Amend] and [Delete] buttons

### Behavior - Add

**On click [Add]:**

1. **Validate inputs**
2. **Generate payment ID** (next sequential: P001, P002, etc.)
3. **Write to Renewal Payments sheet immediately:**

```typescript
{
  payment_id: 'P003',
  date: '2024-12-13',
  type: 'TRF',
  reference: 'SUBS DASEY',
  amount: 220.00,
  status: 'Unmatched',
  matched_users: ''
}
```

4. **Load into UI** (right column)
5. **Attempt auto-match** on this payment (see Auto-Match Logic below)
6. **Update UI** with match results

**Key point:** Payment is saved to sheet IMMEDIATELY, not on submit.

### Behavior - Amend

**Requirements:**

- Can only amend if payment status = 'Unmatched'
- Cannot amend matched payments (show error)

**On click [Amend]:**

1. **Check status** - If 'Matched', show error: "Cannot amend matched payment"
2. **Validate inputs**
3. **Update Renewal Payments sheet immediately**
4. **Update in UI** (right column)
5. **Attempt auto-match** on this payment

### Behavior - Delete

**Requirements:**

- Can only delete if payment status = 'Unmatched'
- Cannot delete matched payments (show error)

**On click [Delete]:**

1. **Check status** - If 'Matched', show error: "Cannot delete matched payment. Unmatch first."
2. **Confirm with user** - "Are you sure you want to delete this payment?"
3. **Update status to 'Deleted' in sheet immediately**
4. **Remove from UI** immediately

**Sheet update:**

```typescript
{
  payment_id: 'P003',
  status: 'Deleted',
  // All other fields unchanged
}
```

**Soft delete benefits:**

- Maintains audit trail
- Can recover if mistake
- Can report on deleted payments later

---

## Feature 2: CSV Import

### Upload Flow

1. **Click [📥 Import CSV]**
2. **File picker opens**
3. **Select CSV file**
4. **Parse CSV**
5. **If multiple payment types in file, show dropdown to select type**
6. **Import only selected type**

### CSV Format

**Bank statement format:**

```csv
Date,Type,Reference,Amount
12/12/2024,TRF,SUBS DASEY,220.00
13/12/2024,TRF,SUBS J SMITH,110.00
13/12/2024,CDM,BAR PURCHASE,45.00
14/12/2024,TRF,ANONYMOUS,50.00
```

### Type Selection

**If CSV contains multiple payment types:**

```
┌────────────────────────────────────┐
│ Import Payments                    │
├────────────────────────────────────┤
│ The CSV contains multiple payment  │
│ types. Select which type to import:│
│                                    │
│ Type:                              │
│ [TRF ▼]                            │
│   • TRF (Bank Transfer)            │
│   • CDM (Card Machine)             │
│                                    │
│ Found: 3 TRF payments              │
│                                    │
│ [Cancel]  [Import]                 │
└────────────────────────────────────┘
```

**If CSV contains only one type:**

- Skip dropdown, import that type automatically

### Import Processing

```typescript
async function handleCSVImport(file: File) {
  // 1. Parse CSV
  const csvData = await parseCSV(file);
  
  // 2. Detect unique payment types
  const types = [...new Set(csvData.map(row => row.Type))];
  
  // 3. If multiple types, show dropdown and wait for selection
  let selectedType = types[0];
  if (types.length > 1) {
    selectedType = await showTypeSelectionDialog(types);
  }
  
  // 4. Filter for selected type only
  const transfers = csvData.filter(row => row.Type === selectedType);
  
  // 5. Generate payment IDs
  let currentId = getNextPaymentId(); // e.g., P010
  
  // 6. Write ALL to Renewal Payments sheet immediately
  for (const row of transfers) {
    const payment = {
      payment_id: currentId,
      date: parseDate(row.Date),
      type: selectedType,
      reference: row.Reference,
      amount: parseFloat(row.Amount),
      status: 'Unmatched',
      matched_users: ''
    };
    
    await addPaymentToSheet(payment);
    currentId = incrementPaymentId(currentId); // P010 → P011
  }
  
  // 7. Reload payments from sheet
  await loadPaymentsFromSheet();
  
  // 8. Run GLOBAL auto-match on all new payments
  for (const payment of newPayments) {
    await attemptGlobalAutoMatch(payment);
    updateUI(); // Visual feedback after each
    await sleep(100); // Brief pause
  }
}
```

**Key point:** All payments written to sheet IMMEDIATELY, before auto-matching.

---

## Feature 3: Auto-Match Logic

### Two Types of Auto-Match

#### 1. Global Auto-Match (On Load/Import)

**When:** Page loads or CSV imported

**How:**

1. Loop through ALL payments in right column (unmatched only)
2. For each payment:
   - Select payment (tick box) → `selected_amount = amount`
   - Extract search term (strip "SUBS" prefix)
   - Search for matching renewals
   - Select all matching renewals → `selected_banking = outstanding` for each
   - Calculate totals
   - If `total_selected_renewals = total_selected_payments` → Auto-match
   - If not equal → Unselect all and continue to next payment

**Example:**

```typescript
async function runGlobalAutoMatch() {
  const unmatchedPayments = payments.filter(p => p.status === 'Unmatched');
  
  for (const payment of unmatchedPayments) {
    // Select payment
    selectPayment(payment); // Sets selected_amount
    
    // Extract search term
    const searchTerm = extractSearchTerm(payment.reference);
    
    // Find matching renewals
    const matches = findMatchingRenewals(searchTerm);
    
    // Select all matches
    matches.forEach(renewal => selectRenewal(renewal)); // Sets selected_banking
    
    // Check if totals match
    if (totalSelectedRenewals === totalSelectedPayments) {
      autoMatch(); // Convert selected → matched
    } else {
      unselectAll(); // Clear selections, try next payment
    }
  }
}
```

#### 2. Incremental Auto-Match (User Selection)

**When:** User manually selects items (clicks checkboxes)

**How:**

- User selects payment → `selected_amount = amount`
- User selects renewal(s) → `selected_banking = outstanding` for each
- **After each selection**, system checks: `total_selected_renewals === total_selected_payments`
- If equal and > 0 → **Immediately auto-match**
- Change checkboxes to red ticks
- Clear `selected_*` values, move to `matched_*` values

**Example:**

```typescript
function handleRenewalCheckbox(renewal) {
  if (renewal.isMatched) return; // Can't select matched items
  
  if (renewal.isSelected) {
    // Unselect
    renewal.selected_banking = 0;
    renewal.isSelected = false;
  } else {
    // Select
    renewal.selected_banking = renewal.outstanding;
    renewal.isSelected = true;
  }
  
  updateTotals();
  
  // Check for auto-match
  if (totalSelectedRenewals === totalSelectedPayments && 
      totalSelectedRenewals > 0) {
    autoMatchSelected();
  }
}
```

### Step 1: Extract Search Term from Payment Reference

**Strip common prefixes:**

```typescript
function extractSearchTerm(reference: string): string {
  const prefixes = ['SUBS', 'MEMBERSHIP', 'RENEWAL'];
  const words = reference.trim().split(/\s+/);
  
  // If first word is a prefix, remove it
  if (words.length > 1 && prefixes.includes(words[0].toUpperCase())) {
    return words.slice(1).join(' ');
  }
  
  return reference;
}

// Examples:
extractSearchTerm('SUBS DASEY')     → 'DASEY'
extractSearchTerm('SUBS J SMITH')   → 'J SMITH'
extractSearchTerm('DASEY')          → 'DASEY'
extractSearchTerm('J SMITH SUBS')   → 'J SMITH SUBS' (prefix must be first)
```

### Step 2: Find Matching Renewals

**Search fields (case-insensitive, substring match):**

```typescript
function findMatchingRenewals(searchTerm: string): Renewal[] {
  const termLower = searchTerm.toLowerCase();
  
  return renewals
    .filter(r => r.outstanding > 0) // Only unpaid/part-paid
    .filter(renewal => {
      const fields = [
        renewal.fullKnownAs,      // "Liam Dasey"
        renewal.lastName,         // "Dasey"
        renewal.userName,         // "liam_dasey"
        renewal.buddyUserName     // "liam_dasey" (for step-children)
      ];
      
      return fields.some(field => 
        field?.toLowerCase().includes(termLower)
      );
    });
}

// Examples:
// Search "DASEY" matches:
// ✓ Liam Dasey (fullKnownAs contains "Dasey")
// ✓ Celia Dasey (fullKnownAs contains "Dasey")
// ✓ Grandson Appleton (buddyUserName = "liam_dasey" contains "dasey")
```

### Step 3: Check Amount Match

**Only auto-match if selected totals EXACTLY match:**

```typescript
function checkAutoMatch(): boolean {
  const renewalsTotal = renewals
    .filter(r => r.isSelected)
    .reduce((sum, r) => sum + r.selected_banking, 0);
  
  const paymentsTotal = payments
    .filter(p => p.isSelected)
    .reduce((sum, p) => sum + p.selected_amount, 0);
  
  // Must be equal AND greater than zero
  return Math.abs(renewalsTotal - paymentsTotal) < 0.01 && renewalsTotal > 0;
}
```

**Examples:**

```
Payment: P001, £220, "SUBS DASEY"
Search: "DASEY"
Matches: Liam (£118) + Celia (£102) = £220
Selected totals: £220 = £220 ✓
Result: ✓ Auto-matched

Payment: P002, £200, "SUBS DASEY"
Search: "DASEY"
Matches: Liam (£118) + Celia (£102) = £220
Selected totals: £220 ≠ £200 ✗
Result: ✗ No auto-match → unselect all
```

### Step 4: Execute Auto-Match

```typescript
function autoMatchSelected() {
  // Get selected items
  const selectedRenewals = renewals.filter(r => r.isSelected);
  const selectedPayments = payments.filter(p => p.isSelected);
  
  // Move selected → matched for renewals
  selectedRenewals.forEach(renewal => {
    renewal.matched_banking = renewal.selected_banking;
    renewal.matched_donations = renewal.selected_donations;
    renewal.matched_difference = renewal.selected_difference;
    renewal.selected_banking = 0;
    renewal.selected_donations = 0;
    renewal.selected_difference = 0;
    renewal.isSelected = false;
    renewal.isMatched = true; // Red tick, can't select again
  });
  
  // Move selected → matched for payments
  selectedPayments.forEach(payment => {
    payment.matched_amount = payment.selected_amount;
    payment.selected_amount = 0;
    payment.isSelected = false;
    payment.isMatched = true; // Red tick, can't select again
  });
  
  // Update totals
  updateTotals();
  
  // Update UI - change checkboxes to red ticks
  updateUI();
}
```

---

## Feature 4: Manual Matching

### Workflow

When selected totals don't match, user needs manual matching:

1. **User has selected:**
   - Payment(s) in right column (checkboxes checked ☒)
   - Renewal(s) in left column (checkboxes checked ☒)
2. **Totals don't match** (e.g., £72 selected renewals vs £60 selected payment)
3. **User clicks on one of the selected renewals** (probably the last one)
4. **Manual match dialog opens for THAT renewal**

### Manual Match Dialog

**Opens when:** User clicks on a selected renewal

**Shows:** The clicked renewal's details with editable fields

```
┌────────────────────────────────────┐
│ Manual Match Renewal               │
├────────────────────────────────────┤
│ Member: Jane Brown                 │
│ Total Fee Due: £72                 │
│                                    │
│ Current values:                    │
│ Banking: £0                        │
│ Donations: £0                      │
│ Difference: £0                     │
│ Outstanding: £72                   │
│                                    │
│ Adjust selected amounts:           │
│                                    │
│ Banking:                           │
│ [£72______] ← selected_banking     │
│                                    │
│ Donations:                         │
│ [£0_______] ← selected_donations   │
│                                    │
│ Difference:                        │
│ [£0_______] ← selected_difference  │
│                                    │
│ Part Payment:                      │
│ Outstanding - Banking + Donations  │
│ + Difference = £0                  │
│                                    │
│ Payment Notes:                     │
│ [SUBS BROWN_______________]        │
│                                    │
│ [Cancel]  [Amend]                  │
└────────────────────────────────────┘
```

### Real-Time Calculation

```typescript
function calculatePartPayment(
  outstanding: number,
  banking: number,
  donations: number,
  difference: number
): number {
  // Part payment = what's left after applying adjustments
  return outstanding - banking + donations + difference;
}

// Example from dialog above:
// outstanding = 72
// banking = 72 (user adjusts this)
// donations = 0
// difference = 0
// Part payment = 72 - 72 + 0 + 0 = 0 ✓ Fully paid

// Example - User changes banking to 60:
// outstanding = 72
// banking = 60
// donations = 0
// difference = 0
// Part payment = 72 - 60 + 0 + 0 = 12 (will remain outstanding)

// Example - User adds difference of 12:
// outstanding = 72
// banking = 60
// donations = 0
// difference = -12
// Part payment = 72 - 60 + 0 + (-12) = 0 ✓ Fully paid (with reduction)
```

### Confirming Manual Match

**On click [Amend]:**

1. **Validate inputs**
2. **Update selected_* values for this renewal:**
   - `selected_banking = <entered banking value>`
   - `selected_donations = <entered donations value>`
   - `selected_difference = <entered difference value>`
3. **Update totals**
4. **Check if totals now match:**
   - If `total_selected_renewals = total_selected_payments` → **Auto-match!**
   - If not → Leave selected for further adjustments

**Example scenario:**

```
Initial state:
- Payment selected: £60
- Jane Brown selected: £72
- Totals don't match

User clicks Jane Brown → Dialog opens
User changes banking to £60
User clicks [Amend]

New state:
- Total selected renewals: £60 (Jane's selected_banking)
- Total selected payments: £60
- Totals match! → Auto-match immediately
- Jane Brown gets red tick ✓
- Payment gets red tick ✓
- Jane's part payment will be £12 (72 - 60 = 12)
```

---

## Feature 5: Submit Matched Payments

### Submit Button

**Appears when:** At least one matched pair exists (red ticks ✓)

**Not dependent on:** Left total = Right total (can submit with unmatched entries remaining)

### Submit Action

**When [Submit Matched Payments] clicked:**

```typescript
async function handleSubmit() {
  const matchedRenewals = renewals.filter(r => r.isMatched);
  const matchedPayments = payments.filter(p => p.isMatched);
  
  // 1. Update Renewal Payments sheet
  for (const payment of matchedPayments) {
    const matchedUserNames = matchedRenewals
      .filter(r => /* somehow determine which renewals matched this payment */)
      .map(r => r.userName)
      .join(',');
    
    await updatePaymentInSheet(payment.payment_id, {
      status: 'Matched',
      matched_users: matchedUserNames
    });
  }
  
  // 2. Update Renewals sheet
  for (const renewal of matchedRenewals) {
    await updateRenewalInSheet(renewal.userName, {
      outstanding: renewal.outstanding - renewal.matched_banking,
      banking: renewal.banking + renewal.matched_banking,
      donations: renewal.donations + renewal.matched_donations,
      difference: renewal.difference + renewal.matched_difference,
      [getPaymentTypeColumn(paymentType)]: renewal[column] + renewal.matched_banking,
      payment_notes: renewal.payment_notes, // From dialog
      payment_ids: renewal.payment_ids + ',' + matchedPaymentIds, // Append
      date_received: new Date() // Most recent payment date
    });
  }
  
  // 3. Clear matched items from UI
  clearMatchedItems();
  
  // 4. Reload unpaid renewals (outstanding > 0)
  await loadUnpaidRenewals();
  
  // 5. Reload unmatched payments
  await loadUnmatchedPayments();
  
  // 6. Show success message
  showMessage('✓ Matched payments submitted successfully');
  
  // 7. Update summary totals
  updateSummary();
}
```

### Renewals Sheet Update Logic

**For each matched renewal:**

```typescript
async function updateRenewalPayment(renewal: Renewal, matchedPaymentIds: string[]) {
  // Determine payment type column
  const paymentType = getPaymentType(matchedPaymentIds[0]); // Get type from first matched payment
  const paymentColumn = getPaymentTypeColumn(paymentType);
  
  // Map: TRF→bank_transfer, CDM→card_machine, CHQ→cheque, CSH→cash
  
  const updates = {
    // Reduce outstanding by matched amount
    outstanding: renewal.outstanding - renewal.matched_banking,
    
    // Accumulate totals
    banking: renewal.banking + renewal.matched_banking,
    donations: renewal.donations + renewal.matched_donations,
    difference: renewal.difference + renewal.matched_difference,
    
    // Update specific payment type column
    [paymentColumn]: renewal[paymentColumn] + renewal.matched_banking,
    
    // Update metadata
    payment_notes: renewal.payment_notes || extractReferences(matchedPaymentIds),
    payment_ids: [renewal.payment_ids, ...matchedPaymentIds]
      .filter(Boolean)
      .join(','),
    date_received: new Date()
  };
  
  await updateRenewalInSheet(renewal.userName, updates);
}
```

### Payment Type Mapping

```typescript
function getPaymentTypeColumn(type: string): string {
  const mapping = {
    'TRF': 'bank_transfer',
    'CDM': 'card_machine',
    'CHQ': 'cheque',
    'CSH': 'cash'
  };
  return mapping[type] || 'bank_transfer';
}
```

### Example - Multiple Payments for One Member

**Scenario:** Liam pays £100 by bank transfer (P001), then £18 cash (P005)

**First payment (P001):**

```typescript
// After submit
{
  outstanding: 118 - 100 = 18,
  banking: 0 + 100 = 100,
  bank_transfer: 0 + 100 = 100,
  payment_ids: "P001",
  payment_notes: "SUBS DASEY"
}
```

**Second payment (P005):**

```typescript
// After submit
{
  outstanding: 18 - 18 = 0, // Fully paid now
  banking: 100 + 18 = 118,
  bank_transfer: 100, // Unchanged
  cash: 0 + 18 = 18, // New
  payment_ids: "P001,P005",
  payment_notes: "SUBS DASEY, Cash payment"
}
```

### After Submit UI State

**Left column:** Shows remaining unpaid/part-paid renewals only

```
Unpaid Renewals
───────────────
☐ John Smith        £110.00  [Outstanding]
☐ Tom Wilson        £95.00   [Outstanding]
                    ────────
Total Outstanding: £205.00 (2 members)
Total Matched: £0
Total Selected: £0
```

**Right column:** Shows unmatched payments only (deleted are hidden)

```
Renewal Payments
────────────────
☐ P004  14/12  TRF  ANONYMOUS     £50.00
                                  ────────
Total Banking: £50.00 (1 payment)
Total Matched: £0
Total Selected: £0
```

Chris can now:

- Add more payments
- Import another CSV
- Match remaining entries
- Submit again (as many times as needed)

---

## Summary Totals

### Calculations

**Left Column (Renewals):**

```typescript
const totalOutstanding = renewals
  .filter(r => r.outstanding > 0)
  .reduce((sum, r) => sum + r.outstanding, 0);

const totalMatchedRenewals = renewals
  .filter(r => r.isMatched)
  .reduce((sum, r) => sum + r.matched_banking, 0);

const totalSelectedRenewals = renewals
  .filter(r => r.isSelected)
  .reduce((sum, r) => sum + r.selected_banking, 0);
```

**Right Column (Payments):**

```typescript
const totalBanking = payments
  .filter(p => p.status === 'Unmatched')
  .reduce((sum, p) => sum + p.amount, 0);

const totalMatchedPayments = payments
  .filter(p => p.isMatched)
  .reduce((sum, p) => sum + p.matched_amount, 0);

const totalSelectedPayments = payments
  .filter(p => p.isSelected)
  .reduce((sum, p) => sum + p.selected_amount, 0);
```

### Display

```
Left Column (Renewals):
Total Outstanding:  £512.00  (sum of all outstanding > 0)
Total Matched:      £220.00  (sum of matched_banking)
Total Selected:     £72.00   (sum of selected_banking)

Right Column (Payments):
Total Banking:      £390.00  (sum of unmatched payment amounts)
Total Matched:      £220.00  (sum of matched_amount)
Total Selected:     £60.00   (sum of selected_amount)
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Add Payment / Import CSV                                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Write to Renewal Payments Sheet IMMEDIATELY             │
│    - Generate payment_id (P001, P002, ...)                 │
│    - status = 'Unmatched'                                   │
│    - matched_users = ''                                     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Load into UI                                             │
│    - Renewals (left): where outstanding > 0                 │
│    - Payments (right): where status = 'Unmatched'           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4A. Global Auto-Match (On Load/Import)                      │
│    - Loop through each payment                              │
│    - Select payment, find matches, select renewals          │
│    - If totals match → auto-match                           │
│    - If not → unselect all, try next payment                │
└─────────────────────────────────────────────────────────────┘
                          OR
┌─────────────────────────────────────────────────────────────┐
│ 4B. Incremental Auto-Match (User Selection)                 │
│    - User selects payment(s) and renewal(s)                 │
│    - After each selection, check if totals match            │
│    - If match → immediately auto-match                      │
└─────────────────────────────────────────────────────────────┘
                          OR
┌─────────────────────────────────────────────────────────────┐
│ 4C. Manual Match (Totals Don't Match)                       │
│    - User clicks selected renewal                           │
│    - Dialog opens with adjustment fields                    │
│    - User adjusts banking/donations/difference              │
│    - Click [Amend]                                          │
│    - If totals now match → auto-match                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Items Matched (Red Ticks)                                │
│    - selected_* → matched_* (in memory)                     │
│    - Checkboxes → Red ticks                                 │
│    - Can't select again                                     │
│    - [Submit] button appears                                │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. Submit                                                   │
│    - Update Renewal Payments: status = 'Matched'           │
│    - Update Renewals: outstanding, banking, payment_ids     │
│    - Clear matched items from UI                            │
│    - Reload unpaid renewals and unmatched payments          │
└─────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### GET /api/banking/renewals

**Returns:** Renewals where outstanding > 0

```typescript
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (session?.user?.role !== 'A' && session?.user?.role !== 'T') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  
  const renewals = await getRenewalsWithOutstanding();
  
  return NextResponse.json({ renewals });
}
```

### GET /api/banking/payments

**Returns:** Payments where status = 'Unmatched'

```typescript
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (session?.user?.role !== 'A' && session?.user?.role !== 'T') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  
  const payments = await getUnmatchedPayments();
  
  return NextResponse.json({ payments });
}
```

### POST /api/banking/payment

**Creates or updates:** Payment entry

```typescript
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (session?.user?.role !== 'A' && session?.user?.role !== 'T') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  
  const { action, payment_id, date, type, reference, amount } = await request.json();
  
  if (action === 'add') {
    const newId = await generateNextPaymentId();
    await addPaymentToSheet({
      payment_id: newId,
      date,
      type,
      reference,
      amount,
      status: 'Unmatched',
      matched_users: ''
    });
    return NextResponse.json({ payment_id: newId });
  }
  
  if (action === 'amend') {
    // Check if matched
    const payment = await getPayment(payment_id);
    if (payment.status === 'Matched') {
      return NextResponse.json(
        { error: 'Cannot amend matched payment' },
        { status: 400 }
      );
    }
    
    await updatePaymentInSheet(payment_id, { date, type, reference, amount });
    return NextResponse.json({ success: true });
  }
  
  if (action === 'delete') {
    // Check if matched
    const payment = await getPayment(payment_id);
    if (payment.status === 'Matched') {
      return NextResponse.json(
        { error: 'Cannot delete matched payment' },
        { status: 400 }
      );
    }
    
    await updatePaymentInSheet(payment_id, { status: 'Deleted' });
    return NextResponse.json({ success: true });
  }
}
```

### POST /api/banking/import

**Imports:** CSV file

```typescript
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (session?.user?.role !== 'A' && session?.user?.role !== 'T') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  
  const formData = await request.formData();
  const file = formData.get('file') as File;
  const selectedType = formData.get('type') as string; // From dropdown
  
  const csvData = await parseCSV(file);
  const transfers = csvData.filter(row => row.Type === selectedType);
  
  const paymentIds = [];
  for (const row of transfers) {
    const payment_id = await generateNextPaymentId();
    
    await addPaymentToSheet({
      payment_id,
      date: parseDate(row.Date),
      type: selectedType,
      reference: row.Reference,
      amount: parseFloat(row.Amount),
      status: 'Unmatched',
      matched_users: ''
    });
    
    paymentIds.push(payment_id);
  }
  
  return NextResponse.json({ paymentIds });
}
```

### POST /api/banking/submit

**Submits:** All matched payments

```typescript
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (session?.user?.role !== 'A' && session?.user?.role !== 'T') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  
  const { matchedRenewals, matchedPayments } = await request.json();
  
  // Update Renewal Payments
  for (const payment of matchedPayments) {
    await updatePaymentInSheet(payment.payment_id, {
      status: 'Matched',
      matched_users: payment.matched_users
    });
  }
  
  // Update Renewals
  for (const renewal of matchedRenewals) {
    await updateRenewalPayment(renewal);
  }
  
  return NextResponse.json({ success: true });
}
```

---

## File Structure

```
src/
├── lib/
│   ├── banking-sheets.ts          ← Banking operations
│   │   ├── getRenewalsWithOutstanding()
│   │   ├── getUnmatchedPayments()
│   │   ├── addPaymentToSheet()
│   │   ├── updatePaymentInSheet()
│   │   ├── updateRenewalPayment()
│   │   └── generateNextPaymentId()
│   └── banking-match.ts           ← Matching logic
│       ├── extractSearchTerm()
│       ├── findMatchingRenewals()
│       ├── runGlobalAutoMatch()
│       ├── checkIncrementalAutoMatch()
│       └── getPaymentTypeColumn()
app/
├── api/
│   └── banking/
│       ├── renewals/
│       │   └── route.ts           ← Get renewals (outstanding > 0)
│       ├── payments/
│       │   └── route.ts           ← Get payments (unmatched)
│       ├── payment/
│       │   └── route.ts           ← Add/Amend/Delete payment
│       ├── import/
│       │   └── route.ts           ← Import CSV
│       └── submit/
│           └── route.ts           ← Submit matches
└── banking/
    └── page.tsx                   ← Banking UI (full width!)
```

---

## Testing Checklist

### Setup
- [ ] Create Renewal Payments sheet with correct columns
- [ ] Verify `outstanding` field exists in Renewals sheet
- [ ] Add `payment_ids` column to Renewals sheet
- [ ] Verify Admin and Treasurer access
- [ ] Verify UI uses full screen width (50/50 split)

### Add Payment
- [ ] Dialog opens with defaults
- [ ] Payment saved to sheet immediately
- [ ] Appears in right column
- [ ] Global auto-match attempts
- [ ] Visual feedback with red tick if matched

### Amend Payment
- [ ] Can't amend if status = 'Matched' (error shown)
- [ ] Can amend if status = 'Unmatched'
- [ ] Updates sheet immediately
- [ ] UI updates
- [ ] Auto-match attempts after amend

### Delete Payment
- [ ] Can't delete if status = 'Matched' (error shown)
- [ ] Can delete if status = 'Unmatched'
- [ ] Soft delete (status = 'Deleted')
- [ ] Removed from UI
- [ ] Excluded from future loads

### CSV Import
- [ ] Upload CSV file
- [ ] If multiple types, dropdown appears
- [ ] Filters by selected type only
- [ ] All payments added to sheet immediately
- [ ] Global auto-matching runs sequentially
- [ ] Visual feedback during import

### Global Auto-Match
- [ ] Runs on page load
- [ ] Runs after CSV import
- [ ] Loops through all unmatched payments
- [ ] Reference "SUBS DASEY" → searches "DASEY"
- [ ] Finds both Daseỳs, ticks both if total matches
- [ ] Matches via buddy_user_name
- [ ] No match if amounts differ
- [ ] Unselects all if no match, tries next payment

### Incremental Auto-Match
- [ ] Triggers after each user selection
- [ ] Checks if selected totals match
- [ ] If match and > 0 → immediately auto-matches
- [ ] Changes checkboxes to red ticks
- [ ] Updates totals correctly

### Checkbox States
- [ ] Three states: unselected, selected, matched
- [ ] Selected shows black check
- [ ] Matched shows red tick
- [ ] Can't select matched items
- [ ] Can unselect selected items

### Manual Match Dialog
- [ ] Opens when clicking selected renewal
- [ ] Shows correct renewal details
- [ ] Banking defaults to selected_banking
- [ ] Can adjust donations/difference
- [ ] Part payment calculation shows in real-time
- [ ] [Amend] updates selected_* values
- [ ] If totals now match → auto-matches immediately

### Payment Type Mapping
- [ ] TRF → bank_transfer column
- [ ] CDM → card_machine column
- [ ] CHQ → cheque column
- [ ] CSH → cash column

### Multiple Payments
- [ ] Liam pays £100 + £18 separately
- [ ] Renewals sheet aggregates correctly
- [ ] outstanding reduces properly
- [ ] payment_ids = "P001,P005"
- [ ] Both payment type columns tracked correctly

### Submit
- [ ] Button appears when items matched (red ticks)
- [ ] Updates Renewal Payments status
- [ ] Updates Renewals outstanding, banking, etc.
- [ ] Clears matched items from UI
- [ ] Refreshes renewals (outstanding > 0 only)
- [ ] Refreshes payments (unmatched only)
- [ ] Unmatched entries remain
- [ ] Success message shown

### Summary Totals
- [ ] Total Outstanding correct
- [ ] Total Banking correct
- [ ] Total Matched correct (left = right)
- [ ] Total Selected correct (left = right)
- [ ] Updates after each selection
- [ ] Updates after auto-match
- [ ] Updates after submit

### Full Width UI
- [ ] Uses entire screen width
- [ ] Not constrained to center
- [ ] 50/50 column split
- [ ] Responsive on different screens
- [ ] Different from Profile/Renewals layout

---

## Implementation Order

### Phase 1: Database (30 min)
1. Create Renewal Payments sheet manually
2. Verify `outstanding` field in Renewals sheet
3. Add `payment_ids` column to Renewals sheet
4. Test schema manually

### Phase 2: Backend (3-4 hours)
1. Create `banking-sheets.ts`
   - CRUD operations for Renewal Payments
   - CRUD operations for Renewals (outstanding > 0)
   - Payment ID generation (P001, P002...)
   - Payment type mapping
2. Create `banking-match.ts`
   - Reference extraction (strip SUBS)
   - Find matching renewals
   - Global auto-match logic
   - Incremental auto-match logic
3. Create API routes
   - GET /renewals, /payments
   - POST /payment (add/amend/delete)
   - POST /import (CSV with type selection)
   - POST /submit

### Phase 3: Frontend (4-5 hours)
1. Create `app/banking/page.tsx`
   - Full-width layout (critical!)
   - Two-column 50/50 grid
   - Three checkbox states
   - Summary totals (6 totals)
2. Add/Amend/Delete dialog
   - Combined dialog
   - Mode switching
   - Validation
3. CSV import
   - File upload
   - Type detection
   - Type selection dropdown
   - Parsing
4. Global auto-match
   - Run on load
   - Run after import
   - Sequential processing
   - Visual feedback
5. Incremental auto-match
   - Trigger after selection
   - Immediate matching
   - Visual feedback
6. Manual match dialog
   - Open on click
   - Real-time calculations
   - Amend functionality
7. Submit workflow
   - Update both sheets
   - Clear UI
   - Reload

### Phase 4: Testing (2-3 hours)
1. All workflows
2. Edge cases
3. Multiple payments
4. Part payments
5. Family payments
6. Checkbox states
7. Totals accuracy

**Total: ~10-13 hours**

---

## Success Criteria

✅ **Database**
- Renewal Payments sheet created with 7 columns
- outstanding field exists in Renewals
- payment_ids column added to Renewals
- Payment IDs sequential (P001, P002...)

✅ **Add/Amend/Delete**
- Payments saved immediately
- Can't amend/delete matched payments
- Soft delete works
- UI updates correctly

✅ **CSV Import**
- Type selection dropdown if multiple types
- Imports selected type only
- All payments saved immediately
- Global auto-match runs after import

✅ **Auto-Match**
- Global match runs on load
- Incremental match after each selection
- Strips "SUBS" prefix correctly
- Searches all name fields including buddy_user_name
- Only matches if totals exactly equal
- Changes checkboxes to red ticks

✅ **Checkbox States**
- Three states render correctly
- Can't select matched items
- State transitions work

✅ **Manual Match**
- Dialog opens for clicked renewal
- Adjustments work
- Part payment calculates correctly
- Auto-matches if totals equal after amend

✅ **Submit**
- Updates both sheets correctly
- Aggregates multiple payments
- Payment type mapping works
- Clears matched items
- Reloads correctly

✅ **UI Layout**
- FULL screen width (not centered)
- 50/50 column split
- Summary totals accurate
- Responsive

---

## Final Notes

### Key Differences from V2

1. **Outstanding-based:** Match against remaining balance, not total fee
2. **No proportional split:** Each renewal matched fully against its outstanding
3. **Two auto-match modes:** Global (on load) + Incremental (on selection)
4. **Three checkbox states:** Unselected, selected (black), matched (red tick)
5. **Simplified manual match:** Adjust one renewal at a time
6. **Memory-based workflow:** selected_* and matched_* in memory, not database
7. **Can't edit matched items:** Prevent amend/delete of matched payments
8. **CSV type selection:** Choose which payment type to import

### Critical Implementation Points

🔴 **CRITICAL:** Full-width UI (not centered like other pages)
🔴 **CRITICAL:** Three distinct checkbox states with red tick for matched
🔴 **CRITICAL:** Global auto-match on load/import, incremental on user selection
🔴 **CRITICAL:** Can't amend/delete matched payments (show error)
🔴 **CRITICAL:** Auto-match when totals equal (after any selection or amend)
🔴 **CRITICAL:** Outstanding reduces with each payment, not total_fee_due

---

**Specification V3 FINAL - Ready for Implementation!** 🚀

*Last Updated: December 2024*
*For: BHBC Membership Portal*
