// src/lib/banking-match.ts
// Banking reconciliation matching logic

import type { Payment, RenewalForBanking } from './banking-sheets';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract search term from payment reference
 * Strips common prefixes like "SUBS", "MEMBERSHIP", "RENEWAL"
 */
export function extractSearchTerm(reference: string): string {
  const prefixes = ['SUBS', 'MEMBERSHIP', 'RENEWAL'];
  const words = reference.trim().split(/\s+/);

  // If first word is a prefix, remove it
  if (words.length > 1 && prefixes.includes(words[0].toUpperCase())) {
    return words.slice(1).join(' ');
  }

  return reference;
}

/**
 * Find renewals matching a search term
 * Searches: fullKnownAs, lastName, userName, buddyUserName
 */
export function findMatchingRenewals(
  searchTerm: string,
  renewals: RenewalForBanking[]
): RenewalForBanking[] {
  const termLower = searchTerm.toLowerCase();

  return renewals
    .filter(r => r.outstanding > 0) // Only unpaid/part-paid
    .filter(renewal => {
      const fields = [
        renewal.fullKnownAs,
        renewal.lastName,
        renewal.userName,
        renewal.buddyUserName,
      ];

      return fields.some(field => field?.toLowerCase().includes(termLower));
    });
}

/**
 * Check if selected totals match (within 0.01 tolerance)
 */
export function checkAmountsMatch(
  renewalsTotal: number,
  paymentsTotal: number
): boolean {
  return (
    Math.abs(renewalsTotal - paymentsTotal) < 0.01 &&
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
 */
export function runGlobalAutoMatch(
  renewals: RenewalWithState[],
  payments: PaymentWithState[]
): void {
  const unmatchedPayments = payments.filter(p => !p.isMatched);

  for (const payment of unmatchedPayments) {
    // Select payment
    payment.isSelected = true;
    payment.selected_amount = payment.amount;

    // Extract search term
    const searchTerm = extractSearchTerm(payment.reference);

    // Find matching renewals
    const matches = renewals.filter(r => {
      const fields = [
        r.fullKnownAs,
        r.lastName,
        r.userName,
        r.buddyUserName,
      ];
      const termLower = searchTerm.toLowerCase();
      return (
        r.outstanding > 0 &&
        !r.isMatched &&
        fields.some(field => field?.toLowerCase().includes(termLower))
      );
    });

    // Also include buddies of matched renewals (for family/couple payments)
    const matchesWithBuddies = new Set(matches);
    matches.forEach(renewal => {
      if (renewal.buddyUserName) {
        // Find the buddy
        const buddy = renewals.find(
          r =>
            r.userName === renewal.buddyUserName &&
            r.outstanding > 0 &&
            !r.isMatched
        );
        if (buddy) {
          matchesWithBuddies.add(buddy);
        }
      }
    });

    // Select all matches including buddies
    Array.from(matchesWithBuddies).forEach(renewal => {
      renewal.isSelected = true;
      renewal.selected_banking = renewal.outstanding;
    });

    // Check if totals match
    const matched = autoMatchIfEqual(renewals, payments);

    if (!matched) {
      // No match - unselect all and try next payment
      unselectAll(renewals, payments);
    }
  }
}

/**
 * Calculate part payment
 */
export function calculatePartPayment(
  outstanding: number,
  banking: number,
  donations: number,
  difference: number
): number {
  return outstanding - banking + donations + difference;
}
