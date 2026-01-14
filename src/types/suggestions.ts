// src/types/suggestions.ts
// Type definitions for Member Suggestions system

export type SuggestionCategory =
  | 'Facilities'
  | 'Green'
  | 'Grounds'
  | 'Clubhouse'
  | 'Bar'
  | 'Social'
  | 'Finance'
  | 'Other';

export type Priority =
  | 'Low'
  | 'Medium'
  | 'High'
  | 'Safety essential';

export type FundingSource =
  | 'Club Funds'
  | 'Grant'
  | 'Fundraising'
  | 'Sponsor'
  | 'Other';

export type Decision =
  | 'Approved'
  | 'Not Approved'
  | 'Deferred';

export type FinalOutcome =
  | 'Completed'
  | 'Cancelled'
  | 'On Hold';

export type CommitteeAcceptance = 'Yes' | 'No' | '';

export interface MemberSuggestion {
  // Public fields (anyone can submit)
  suggestionId: string;
  title: string;
  category: SuggestionCategory;
  description: string;
  reasonForImprovement: string;
  createdByUsername: string;
  createdByFullName: string; // Computed from Members sheet (not stored)
  createdAt: string;

  // Admin/Committee fields
  dateReceived?: string | null;
  committeeAcceptance?: CommitteeAcceptance;
  committeeAcceptanceReason?: string | null;
  priority?: Priority | null;
  coordinatorUsername?: string | null;
  coordinatorFullName?: string | null; // Computed from Members sheet (not stored)
  estimatedCost?: number | null;
  fundingSource?: FundingSource | null;
  costQuotesDetails?: string | null;
  decision?: Decision | null;
  decisionReason?: string | null;
  targetCompletionDate?: string | null;
  progressNotes?: string | null;
  reviewDate?: string | null;
  finalOutcome?: FinalOutcome | null;
  dateCompleted?: string | null;

  // Metadata
  updatedAt?: string | null;
  updatedByUsername?: string | null;

  // Internal
  _rowNumber?: number;
}

// Status types for filtering/display
export type SuggestionStatus =
  | 'new'        // Not accepted yet (committeeAcceptance !== 'Yes')
  | 'ongoing'    // Accepted and not complete/cancelled/on hold
  | 'review'     // Past review date
  | 'complete'   // finalOutcome === 'Completed'
  | 'cancelled'  // finalOutcome === 'Cancelled'
  | 'on_hold';   // finalOutcome === 'On Hold'

/**
 * Determine the current status of a suggestion based on its fields
 * Used for filtering and displaying suggestions in different tabs
 */
export function getSuggestionStatus(suggestion: MemberSuggestion): SuggestionStatus {
  // Check final outcome first (terminal states)
  if (suggestion.finalOutcome === 'Completed') return 'complete';
  if (suggestion.finalOutcome === 'Cancelled') return 'cancelled';
  if (suggestion.finalOutcome === 'On Hold') return 'on_hold';

  // Check if accepted by committee
  if (suggestion.committeeAcceptance !== 'Yes') return 'new';

  // Check if past review date (needs attention)
  if (suggestion.reviewDate) {
    const reviewDate = new Date(suggestion.reviewDate);
    const now = new Date();
    if (reviewDate < now) return 'review';
  }

  // Otherwise, it's ongoing (accepted and in progress)
  return 'ongoing';
}

/**
 * Get display label for a status
 */
export function getStatusLabel(status: SuggestionStatus): string {
  const labels: Record<SuggestionStatus, string> = {
    new: 'New',
    ongoing: 'Ongoing',
    review: 'Review',
    complete: 'Complete',
    cancelled: 'Cancelled',
    on_hold: 'On Hold',
  };
  return labels[status];
}

/**
 * Get badge color class for a status
 */
export function getStatusColor(status: SuggestionStatus): string {
  const colors: Record<SuggestionStatus, string> = {
    new: 'bg-gray-500',
    ongoing: 'bg-blue-500',
    review: 'bg-yellow-500',
    complete: 'bg-green-500',
    cancelled: 'bg-red-500',
    on_hold: 'bg-orange-500',
  };
  return colors[status];
}
