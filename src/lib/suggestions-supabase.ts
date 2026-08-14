// src/lib/suggestions-supabase.ts
// Postgres-backed replacement for suggestions-sheets.ts. Same function
// names/signatures throughout, so every consumer route needs only an import swap.
//
// One table (supabase/migrations/0037_suggestions.sql). committeeOnly/
// committeeAcceptance are real booleans in Postgres but the MemberSuggestion type
// contract (src/types/suggestions.ts) expects the old 'Y'/'' sheet sentinels —
// mapRow preserves that so nothing downstream needs to change.

import { getSupabaseClient } from './supabase';
import { getUserByUsername, getAllUsers } from './members-supabase';
import type {
  MemberSuggestion,
  SuggestionCategory,
  Priority,
  FundingSource,
  Decision,
  FinalOutcome,
} from '@/types/suggestions';

function mapRow(row: any): MemberSuggestion {
  return {
    suggestionId: row.suggestion_id,
    title: row.title,
    category: row.category as SuggestionCategory,
    description: row.description,
    reasonForImprovement: row.reason_for_improvement,
    createdByUsername: row.created_by_username,
    createdByFullName: '', // populated by enrichSuggestionsWithNames
    createdAt: row.created_at,

    committeeOnly: row.committee_only ? 'Y' : '',
    dateReceived: row.date_received,
    committeeAcceptance: row.committee_acceptance ? 'Y' : '',
    committeeAcceptanceReason: row.committee_acceptance_reason,
    priority: row.priority as Priority | null,
    coordinatorUsername: row.coordinator_username,
    coordinatorFullName: null, // populated by enrichSuggestionsWithNames
    estimatedCost: row.estimated_cost !== null ? Number(row.estimated_cost) : null,
    fundingSource: row.funding_source as FundingSource | null,
    costQuotesDetails: row.cost_quotes_details,
    decision: row.decision as Decision | null,
    decisionReason: row.decision_reason,
    targetCompletionDate: row.target_completion_date,
    progressNotes: row.progress_notes,
    reviewDate: row.review_date,
    finalOutcome: row.final_outcome as FinalOutcome | null,
    dateCompleted: row.date_completed,

    updatedAt: row.updated_at,
    updatedByUsername: row.updated_by_username,
  };
}

/** Enrich suggestions with current full names from Members, looked up dynamically
 *  so names stay current even if a member changes their knownAs. */
async function enrichSuggestionsWithNames(suggestions: MemberSuggestion[]): Promise<MemberSuggestion[]> {
  try {
    const members = await getAllMembersForCoordinator();
    const nameMap = new Map<string, string>();
    for (const member of members) {
      nameMap.set(member.userName, member.fullName);
    }
    return suggestions.map(suggestion => ({
      ...suggestion,
      createdByFullName: nameMap.get(suggestion.createdByUsername) || suggestion.createdByUsername || 'Unknown',
      coordinatorFullName: suggestion.coordinatorUsername
        ? (nameMap.get(suggestion.coordinatorUsername) || suggestion.coordinatorUsername)
        : null,
    }));
  } catch (error) {
    console.error('[enrichSuggestionsWithNames] Error enriching suggestions:', error);
    return suggestions;
  }
}

/** Generate next suggestion ID (YYYY-NNN format, resets yearly). */
async function generateNextSuggestionId(): Promise<string> {
  const supabase = getSupabaseClient();
  const currentYear = new Date().getFullYear();
  const { data, error } = await supabase
    .from('suggestions')
    .select('suggestion_id')
    .like('suggestion_id', `${currentYear}-%`);
  if (error) throw new Error(`Failed to generate suggestion ID: ${error.message}`);

  let maxNumber = 0;
  for (const row of data ?? []) {
    const numStr = (row.suggestion_id as string).substring(5);
    const num = parseInt(numStr, 10);
    if (!isNaN(num) && num > maxNumber) maxNumber = num;
  }
  return `${currentYear}-${String(maxNumber + 1).padStart(3, '0')}`;
}

export async function getAllSuggestions(): Promise<MemberSuggestion[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('suggestions').select('*');
  if (error) throw new Error(`Failed to fetch suggestions: ${error.message}`);
  return enrichSuggestionsWithNames((data ?? []).map(mapRow));
}

export async function getSuggestionById(suggestionId: string): Promise<MemberSuggestion | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('suggestions').select('*').eq('suggestion_id', suggestionId).maybeSingle();
  if (error) throw new Error(`Failed to fetch suggestion ${suggestionId}: ${error.message}`);
  if (!data) return null;
  const [enriched] = await enrichSuggestionsWithNames([mapRow(data)]);
  return enriched;
}

export async function createSuggestion(data: {
  title: string;
  category: SuggestionCategory;
  description: string;
  reasonForImprovement: string;
  createdByUsername: string;
  committeeOnly?: string;
}): Promise<{ success: boolean; suggestionId?: string; error?: string }> {
  try {
    const user = await getUserByUsername(data.createdByUsername);
    if (!user) return { success: false, error: 'User not found' };

    const suggestionId = await generateNextSuggestionId();
    const now = new Date().toISOString();

    const supabase = getSupabaseClient();
    const { error } = await supabase.from('suggestions').insert({
      suggestion_id: suggestionId,
      title: data.title,
      category: data.category,
      description: data.description,
      reason_for_improvement: data.reasonForImprovement,
      created_by_username: data.createdByUsername,
      committee_only: data.committeeOnly === 'Y',
      created_at: now,
      updated_at: now,
      updated_by_username: data.createdByUsername,
    });
    if (error) throw new Error(error.message);

    return { success: true, suggestionId };
  } catch (error) {
    console.error('[createSuggestion] Error creating suggestion:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create suggestion' };
  }
}

const FIELD_TO_COLUMN: Record<string, string> = {
  committeeOnly: 'committee_only',
  title: 'title',
  category: 'category',
  description: 'description',
  reasonForImprovement: 'reason_for_improvement',
  dateReceived: 'date_received',
  committeeAcceptance: 'committee_acceptance',
  committeeAcceptanceReason: 'committee_acceptance_reason',
  priority: 'priority',
  coordinatorUsername: 'coordinator_username',
  estimatedCost: 'estimated_cost',
  fundingSource: 'funding_source',
  costQuotesDetails: 'cost_quotes_details',
  decision: 'decision',
  decisionReason: 'decision_reason',
  targetCompletionDate: 'target_completion_date',
  progressNotes: 'progress_notes',
  reviewDate: 'review_date',
  finalOutcome: 'final_outcome',
  dateCompleted: 'date_completed',
};

const BOOLEAN_FIELDS = new Set(['committeeOnly', 'committeeAcceptance']);

export async function updateSuggestion(
  suggestionId: string,
  updates: Partial<MemberSuggestion>,
  updatedByUsername: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const columnUpdates: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(updates)) {
      const column = FIELD_TO_COLUMN[field];
      if (!column) continue;
      columnUpdates[column] = BOOLEAN_FIELDS.has(field) ? value === 'Y' : (value ?? null);
    }
    columnUpdates.updated_at = new Date().toISOString();
    columnUpdates.updated_by_username = updatedByUsername;

    const supabase = getSupabaseClient();
    const { error, count } = await supabase
      .from('suggestions')
      .update(columnUpdates, { count: 'exact' })
      .eq('suggestion_id', suggestionId);
    if (error) throw new Error(error.message);
    if (!count) return { success: false, error: 'Suggestion not found' };

    return { success: true };
  } catch (error) {
    console.error(`[updateSuggestion] Error updating suggestion ${suggestionId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update suggestion' };
  }
}

/** Get all members for the coordinator dropdown — any member, not just committee. */
export async function getAllMembersForCoordinator(): Promise<Array<{ userName: string; fullName: string }>> {
  const allUsers = await getAllUsers();
  const members = allUsers
    .filter((u) => u.userName && u.fullName)
    .map((u) => ({ userName: u.userName, fullName: u.fullName }));
  return members.sort((a, b) => a.fullName.localeCompare(b.fullName));
}
