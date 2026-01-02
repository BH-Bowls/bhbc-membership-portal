// src/lib/banking-match.ts
// Banking reconciliation matching logic

import type { Payment, RenewalForBanking } from './banking-sheets';

// ============================================================================
// Constants
// ============================================================================

/**
 * Tolerance for amount matching in pounds (0.01 = 1 penny)
 * Accounts for floating point rounding errors
 */
const AMOUNT_MATCH_TOLERANCE = 0.01;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract search term from payment reference
 * Strips common keywords like "SUBS", "MEMBERSHIP", "RENEWAL"
 * Handles both space-separated and concatenated formats
 *
 * Examples:
 * - "SUBS DASEY" → "DASEY"
 * - "GardnerSUBS" → "Gardner"
 * - "DOREEN MARSH SUBS" → "DOREEN MARSH"
 * - "Dasey LJ & C" → "Dasey LJ & C" (no keywords to remove)
 */
export function extractSearchTerm(reference: string): string {
  const keywords = ['SUBS', 'MEMBERSHIP', 'RENEWAL'];

  let cleaned = reference.trim();

  // Remove keywords (case-insensitive, with or without surrounding spaces)
  // This handles: "SUBS DASEY", "DASEY SUBS", "GardnerSUBS", "SUBSGardner"
  for (const keyword of keywords) {
    // Match keyword with optional surrounding whitespace
    const regex = new RegExp(`\\s*${keyword}\\s*`, 'gi');
    cleaned = cleaned.replace(regex, ' ');
  }

  // Clean up multiple spaces and trim
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * Extract significant words from a string for matching
 * Filters out short words (initials), symbols, and returns words >= 3 characters
 */
function extractSignificantWords(text: string): string[] {
  // Split by whitespace and non-letter characters
  const words = text.toLowerCase().split(/[^a-z]+/);

  // Keep only words with 3+ characters (filters out initials like "LJ", "JM")
  return words.filter(word => word.length >= 3);
}

/**
 * Check if two strings share common significant words
 * Used for fuzzy matching of complex payment references
 */
function hasCommonWords(searchTerm: string, targetField: string): boolean {
  const searchWords = extractSignificantWords(searchTerm);
  const targetWords = extractSignificantWords(targetField);

  // Check if any search word matches any target word
  for (const searchWord of searchWords) {
    for (const targetWord of targetWords) {
      if (searchWord === targetWord || searchWord.includes(targetWord) || targetWord.includes(searchWord)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find renewals matching a search term
 * Searches member names (fullKnownAs, lastName, userName, buddyUserName)
 * Only returns renewals with outstanding balances (unpaid or partially paid)
 *
 * Uses word-based matching to handle complex references like:
 * - "Dasey LJ & C DASEY" → matches "Dasey"
 * - "DOREEN MARSH SUBS" → matches "Marsh" or "Doreen Marsh"
 *
 * @param searchTerm The name or username to search for (case-insensitive)
 * @param renewals Array of all renewal records
 * @returns Array of renewals matching the search term with outstanding > 0
 */
export function findMatchingRenewals(
  searchTerm: string,
  renewals: RenewalForBanking[]
): RenewalForBanking[] {
  // Build array of matching renewals
  const matches: RenewalForBanking[] = [];

  // Loop through all renewals
  for (const renewal of renewals) {
    // Skip renewals that are fully paid (no outstanding balance)
    if (renewal.outstanding <= 0) {
      continue;
    }

    // Check if search term matches any name field
    // Search fields: full name, last name, username
    let isMatch = false;

    // Check full name (e.g., "Celia Dasey")
    if (renewal.fullName && hasCommonWords(searchTerm, renewal.fullName)) {
      isMatch = true;
    }

    // Check last name
    if (!isMatch && renewal.lastName && hasCommonWords(searchTerm, renewal.lastName)) {
      isMatch = true;
    }

    // Check username (e.g., "john_smith")
    if (!isMatch && renewal.userName && hasCommonWords(searchTerm, renewal.userName)) {
      isMatch = true;
    }

    // Add to matches if any field matched
    if (isMatch) {
      matches.push(renewal);
    }
  }

  return matches;
}

/**
 * Check if selected totals match (within tolerance for rounding errors)
 */
export function checkAmountsMatch(
  renewalsTotal: number,
  paymentsTotal: number
): boolean {
  return (
    Math.abs(renewalsTotal - paymentsTotal) < AMOUNT_MATCH_TOLERANCE &&
    renewalsTotal > 0 &&
    paymentsTotal > 0
  );
}

// ============================================================================
// In-Memory State Helpers
// ============================================================================

export interface RenewalWithState extends RenewalForBanking {
  isSelected: boolean;
  isMatched: boolean;
  selected_banking: number;
  selected_donations: number;
  selected_difference: number;
  matched_banking: number;
  matched_donations: number;
  matched_difference: number;
  matched_payment_ids: string[]; // Track which specific payment IDs were used for this renewal
}

export interface PaymentWithState extends Payment {
  isSelected: boolean;
  isMatched: boolean;
  selected_amount: number;
  matched_amount: number;
  matched_user_names: string[]; // Track which specific user names were matched with this payment
}

/**
 * Initialize renewal with state
 */
export function initializeRenewalState(renewal: RenewalForBanking): RenewalWithState {
  return {
    ...renewal,
    isSelected: false,
    isMatched: false,
    selected_banking: 0,
    selected_donations: 0,
    selected_difference: 0,
    matched_banking: 0,
    matched_donations: 0,
    matched_difference: 0,
    matched_payment_ids: [],
  };
}

/**
 * Initialize payment with state
 */
export function initializePaymentState(payment: Payment): PaymentWithState {
  return {
    ...payment,
    isSelected: false,
    isMatched: false,
    selected_amount: 0,
    matched_amount: 0,
    matched_user_names: [],
  };
}

/**
 * Calculate totals for renewals
 */
export function calculateRenewalTotals(renewals: RenewalWithState[]) {
  const totalOutstanding = renewals.reduce((sum, r) => sum + r.outstanding, 0);
  const totalMatched = renewals
    .filter(r => r.isMatched)
    .reduce((sum, r) => sum + r.matched_banking, 0);
  const totalSelected = renewals
    .filter(r => r.isSelected)
    .reduce((sum, r) => sum + r.selected_banking, 0);

  return { totalOutstanding, totalMatched, totalSelected };
}

/**
 * Calculate totals for payments
 */
export function calculatePaymentTotals(payments: PaymentWithState[]) {
  const totalBanking = payments.reduce((sum, p) => sum + p.amount, 0);
  const totalMatched = payments
    .filter(p => p.isMatched)
    .reduce((sum, p) => sum + p.matched_amount, 0);
  const totalSelected = payments
    .filter(p => p.isSelected)
    .reduce((sum, p) => sum + p.selected_amount, 0);

  return { totalBanking, totalMatched, totalSelected };
}

/**
 * Auto-match selected items if totals equal
 * Moves selected_* to matched_* fields and stores payment-renewal relationships
 *
 * **MUTATES INPUT ARRAYS**: Directly modifies renewal and payment objects in place
 * for performance reasons (banking UI with potentially hundreds of records).
 *
 * @param renewals Array of renewals (will be mutated)
 * @param payments Array of payments (will be mutated)
 * @returns true if match was successful, false if totals don't match
 */
export function autoMatchIfEqual(
  renewals: RenewalWithState[],
  payments: PaymentWithState[]
): boolean {
  const renewalTotals = calculateRenewalTotals(renewals);
  const paymentTotals = calculatePaymentTotals(payments);

  if (
    !checkAmountsMatch(renewalTotals.totalSelected, paymentTotals.totalSelected)
  ) {
    return false;
  }

  // Get currently selected items
  const selectedRenewals = renewals.filter(r => r.isSelected);
  const selectedPayments = payments.filter(p => p.isSelected);

  // Get payment IDs and user names for cross-referencing
  const selectedPaymentIds = selectedPayments.map(p => p.payment_id);
  const selectedUserNames = selectedRenewals.map(r => r.userName);

  // Move selected → matched for renewals and store payment IDs
  selectedRenewals.forEach(renewal => {
    renewal.matched_banking = renewal.selected_banking;
    renewal.matched_donations = renewal.selected_donations;
    renewal.matched_difference = renewal.selected_difference;
    renewal.matched_payment_ids = [...selectedPaymentIds]; // Store which payments were used
    renewal.selected_banking = 0;
    renewal.selected_donations = 0;
    renewal.selected_difference = 0;
    renewal.isSelected = false;
    renewal.isMatched = true;
  });

  // Move selected → matched for payments and store user names
  selectedPayments.forEach(payment => {
    payment.matched_amount = payment.selected_amount;
    payment.matched_user_names = [...selectedUserNames]; // Store which renewals were matched
    payment.selected_amount = 0;
    payment.isSelected = false;
    payment.isMatched = true;
  });

  return true;
}

/**
 * Unselect all selected items
 *
 * **MUTATES INPUT ARRAYS**: Directly modifies renewal and payment objects in place
 * to clear their selection state.
 *
 * @param renewals Array of renewals (will be mutated)
 * @param payments Array of payments (will be mutated)
 */
export function unselectAll(
  renewals: RenewalWithState[],
  payments: PaymentWithState[]
): void {
  renewals
    .filter(r => r.isSelected)
    .forEach(r => {
      r.isSelected = false;
      r.selected_banking = 0;
      r.selected_donations = 0;
      r.selected_difference = 0;
    });

  payments
    .filter(p => p.isSelected)
    .forEach(p => {
      p.isSelected = false;
      p.selected_amount = 0;
    });
}

/**
 * Global auto-match: Loop through payments, try to match each
 *
 * **MUTATES INPUT ARRAYS**: Directly modifies renewal and payment objects in place
 * as it attempts to auto-match payments to renewals based on names in payment references.
 *
 * Algorithm:
 * 1. For each unmatched payment, extract search term from reference
 * 2. Find renewals matching the search term (including buddies if they also match)
 * 3. If total amounts match, auto-match them together
 * 4. If no match, unselect and try next payment
 *
 * Performance optimizations:
 * - Pre-filters unmatched renewals to avoid checking matched ones repeatedly
 * - Uses Map for O(1) buddy lookups instead of O(n) find()
 * - Calculates totals directly from selected items instead of filtering all items
 *
 * @param renewals Array of renewals (will be mutated)
 * @param payments Array of payments (will be mutated)
 */
export function runGlobalAutoMatch(
  renewals: RenewalWithState[],
  payments: PaymentWithState[]
): void {
  const unmatchedPayments = payments.filter(p => !p.isMatched);

  // Optimization: Pre-filter unmatched renewals with outstanding > 0
  // This avoids checking matched renewals or fully paid renewals repeatedly
  const getUnmatchedRenewals = () =>
    renewals.filter(r => r.outstanding > 0 && !r.isMatched);

  // Optimization: Create username index for O(1) buddy lookups
  // This is much faster than using find() for each buddy lookup
  const createUsernameIndex = (renewalsList: RenewalWithState[]) => {
    const index = new Map<string, RenewalWithState>();
    renewalsList.forEach(r => index.set(r.userName, r));
    return index;
  };

  for (const payment of unmatchedPayments) {
    // Select payment
    payment.isSelected = true;
    payment.selected_amount = payment.amount;

    // Extract search term
    const searchTerm = extractSearchTerm(payment.reference);

    // Get current unmatched renewals (refresh each iteration as matches change state)
    const unmatchedRenewals = getUnmatchedRenewals();
    const usernameIndex = createUsernameIndex(unmatchedRenewals);

    // Find matching renewals using word-based matching
    // This handles complex references like "Dasey LJ & C DASEY", "GardnerSUBS", etc.
    const matches: RenewalWithState[] = [];
    for (const renewal of unmatchedRenewals) {
      // Check if search term matches any field for this renewal
      let isMatch = false;

      // Check full name
      if (renewal.fullName && hasCommonWords(searchTerm, renewal.fullName)) {
        isMatch = true;
      }

      // Check last name
      if (!isMatch && renewal.lastName && hasCommonWords(searchTerm, renewal.lastName)) {
        isMatch = true;
      }

      // Check username
      if (!isMatch && renewal.userName && hasCommonWords(searchTerm, renewal.userName)) {
        isMatch = true;
      }

      // Add to matches if any field matched
      if (isMatch) {
        matches.push(renewal);
      }
    }

    // Also include buddies of matched renewals (for family/couple payments)
    // Include ALL buddies of matched renewals, regardless of whether buddy's name matches search term
    // This handles cases like "SUBS DASEY" where the payment reference only mentions one family member
    // but should include all family members (e.g., daniel_appleton who is buddy of celia_dasey)
    const matchesWithBuddies = new Set(matches);

    // Direction 1: Check if matched renewals have buddies
    // Example: liam_dasey has buddyUserName="celia_dasey" → add celia_dasey
    for (const renewal of matches) {
      // Check if this renewal has a buddy
      if (renewal.buddyUserName) {
        // Optimization: O(1) buddy lookup using Map instead of O(n) find()
        const buddy = usernameIndex.get(renewal.buddyUserName);

        // Check if buddy exists in the unmatched renewals
        if (buddy) {
          // Add buddy to matches even if their name doesn't match search term
          // The mutual buddy relationship is sufficient for family payments
          matchesWithBuddies.add(buddy);
        }
      }
    }

    // Direction 2: Check reverse - find renewals that list matched renewals as THEIR buddy
    // Example: daniel_appleton has buddyUserName="celia_dasey" → add daniel_appleton
    for (const renewal of unmatchedRenewals) {
      // Check if this renewal has a buddy
      if (renewal.buddyUserName) {
        // Check if this renewal's buddy is one of our matched renewals
        for (const match of matches) {
          if (renewal.buddyUserName === match.userName) {
            // This renewal's buddy is in our matches - add this renewal
            matchesWithBuddies.add(renewal);
            break;
          }
        }
      }
    }

    // Select all matches including buddies
    // Convert Set to Array and loop through
    for (const renewal of Array.from(matchesWithBuddies)) {
      renewal.isSelected = true;
      renewal.selected_banking = renewal.outstanding;
    }

    // Check if totals match
    const matched = autoMatchIfEqual(renewals, payments);

    if (!matched) {
      // No match - unselect all and try next payment
      unselectAll(renewals, payments);
    }
  }
}

/**
 * Calculate new outstanding balance after a payment
 *
 * Formula: newOutstanding = currentOutstanding - banking + donations + difference
 *
 * Where:
 * - currentOutstanding: Amount currently owed
 * - banking: Amount paid via bank transfer/card/cash (reduces outstanding)
 * - donations: Amount added to donations column (increases outstanding as it reduces payment to club)
 * - difference: Adjustment amount (positive increases outstanding, negative decreases)
 *
 * Note: This formula treats donations as reducing the payment to the club, not as extra money given.
 * Verify this matches your business requirements.
 *
 * @param currentOutstanding Current outstanding balance
 * @param banking Amount being paid via banking methods
 * @param donations Amount being allocated to donations
 * @param difference Adjustment amount (can be positive or negative)
 * @returns New outstanding balance after payment
 */
export function calculateNewOutstanding(
  currentOutstanding: number,
  banking: number,
  donations: number,
  difference: number
): number {
  return currentOutstanding - banking + donations + difference;
}
