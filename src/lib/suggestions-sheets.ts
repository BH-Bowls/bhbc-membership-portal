// src/lib/suggestions-sheets.ts
// Google Sheets operations for Member Suggestions

import {
  getColumnMap,
  getColumnLetter,
  getGoogleSheetsClient,
  getSpreadsheetId,
  getUserByUsername,
} from './sheets';
import { createRowFieldGetter, createRowNumberGetter, wrapError } from './banking-sheets';
import type {
  MemberSuggestion,
  SuggestionCategory,
  Priority,
  FundingSource,
  Decision,
  FinalOutcome,
  CommitteeAcceptance,
} from '@/types/suggestions';

// ============================================================================
// CONSTANTS
// ============================================================================

const SUGGESTIONS_SHEET_RANGE = 'MemberSuggestions!A2:AZ'; // Flexible range
const HEADER_ROW_OFFSET = 2; // Row 1 is header, data starts at row 2

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse a Google Sheets row into a MemberSuggestion object
 * Note: createdByFullName and coordinatorFullName are NOT stored in the sheet
 * They will be looked up dynamically from the Members sheet
 */
function parseSuggestionRow(
  row: any[],
  rowNumber: number,
  colMap: Record<string, number>
): MemberSuggestion {
  const get = createRowFieldGetter(row, colMap);
  const getNumber = createRowNumberGetter(get);

  return {
    // Public fields
    suggestionId: get('suggestion_id') || '',
    title: get('title') || '',
    category: (get('category') as SuggestionCategory) || 'Other',
    description: get('description') || '',
    reasonForImprovement: get('reason_for_improvement') || '',
    createdByUsername: get('created_by_username') || '',
    createdByFullName: '', // Will be populated by enrichSuggestionsWithNames
    createdAt: get('created_at') || '',

    // Admin fields
    committeeOnly: get('committee_only') || '',
    dateReceived: get('date_received') || null,
    committeeAcceptance: (get('committee_acceptance') || '') as CommitteeAcceptance,
    committeeAcceptanceReason: get('committee_acceptance_reason') || null,
    priority: (get('priority') || null) as Priority | null,
    coordinatorUsername: get('coordinator_username') || null,
    coordinatorFullName: null, // Will be populated by enrichSuggestionsWithNames
    estimatedCost: getNumber('estimated_cost') || null,
    fundingSource: (get('funding_source') || null) as FundingSource | null,
    costQuotesDetails: get('cost_quotes_details') || null,
    decision: (get('decision') || null) as Decision | null,
    decisionReason: get('decision_reason') || null,
    targetCompletionDate: get('target_completion_date') || null,
    progressNotes: get('progress_notes') || null,
    reviewDate: get('review_date') || null,
    finalOutcome: (get('final_outcome') || null) as FinalOutcome | null,
    dateCompleted: get('date_completed') || null,

    // Metadata
    updatedAt: get('updated_at') || null,
    updatedByUsername: get('updated_by_username') || null,

    // Internal
    _rowNumber: rowNumber,
  };
}

/**
 * Enrich suggestions with current full names from Members sheet
 * This ensures names are always up-to-date even if members change their knownAs
 */
async function enrichSuggestionsWithNames(suggestions: MemberSuggestion[]): Promise<MemberSuggestion[]> {
  try {
    // Get all members
    const members = await getAllMembersForCoordinator();

    // Create username -> fullName map
    const nameMap = new Map<string, string>();
    for (const member of members) {
      nameMap.set(member.userName, member.fullName);
    }

    // Enrich each suggestion
    return suggestions.map(suggestion => ({
      ...suggestion,
      createdByFullName: nameMap.get(suggestion.createdByUsername) || suggestion.createdByUsername || 'Unknown',
      coordinatorFullName: suggestion.coordinatorUsername
        ? (nameMap.get(suggestion.coordinatorUsername) || suggestion.coordinatorUsername)
        : null,
    }));
  } catch (error) {
    console.error('[enrichSuggestionsWithNames] Error enriching suggestions:', error);
    // Return suggestions as-is if enrichment fails
    return suggestions;
  }
}

/**
 * Generate next suggestion ID (YYYY-NNN format, resets yearly)
 */
async function generateNextSuggestionId(): Promise<string> {
  const colMap = await getColumnMap('MemberSuggestions');
  const sheets = getGoogleSheetsClient();

  // Fetch all suggestions
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: SUGGESTIONS_SHEET_RANGE,
  });

  const rows = response.data.values || [];
  const currentYear = new Date().getFullYear();
  let maxNumber = 0;

  // Find highest number for current year
  for (const row of rows) {
    const ref = row[colMap['suggestion_id']];
    if (ref && typeof ref === 'string' && ref.startsWith(`${currentYear}-`)) {
      const numStr = ref.substring(5); // After "YYYY-"
      const num = parseInt(numStr, 10);
      if (!isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  // Return next reference number with zero padding
  const nextRef = `${currentYear}-${String(maxNumber + 1).padStart(3, '0')}`;
  return nextRef;
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Get all suggestions from the MemberSuggestions sheet
 */
export async function getAllSuggestions(): Promise<MemberSuggestion[]> {
  try {
    const colMap = await getColumnMap('MemberSuggestions');
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: SUGGESTIONS_SHEET_RANGE,
    });

    const rows = response.data.values || [];

    const suggestions = rows.map((row, index) =>
      parseSuggestionRow(row, index + HEADER_ROW_OFFSET, colMap)
    );

    // Enrich with current names from Members sheet
    return await enrichSuggestionsWithNames(suggestions);
  } catch (error) {
    console.error('[getAllSuggestions] Error fetching suggestions:', error);
    throw wrapError('Failed to fetch suggestions', error);
  }
}

/**
 * Get suggestion by ID
 * Names are automatically enriched via getAllSuggestions
 */
export async function getSuggestionById(suggestionId: string): Promise<MemberSuggestion | null> {
  try {
    const suggestions = await getAllSuggestions();
    return suggestions.find((s) => s.suggestionId === suggestionId) || null;
  } catch (error) {
    console.error(`[getSuggestionById] Error fetching suggestion ${suggestionId}:`, error);
    throw wrapError(`Failed to fetch suggestion ${suggestionId}`, error);
  }
}

/**
 * Create new suggestion
 */
export async function createSuggestion(data: {
  title: string;
  category: SuggestionCategory;
  description: string;
  reasonForImprovement: string;
  createdByUsername: string;
  committeeOnly?: string;
}): Promise<{ success: boolean; suggestionId?: string; error?: string }> {
  try {
    const colMap = await getColumnMap('MemberSuggestions');
    const sheets = getGoogleSheetsClient();

    // Verify user exists
    const user = await getUserByUsername(data.createdByUsername);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Generate suggestion ID
    const suggestionId = await generateNextSuggestionId();
    const now = new Date().toISOString();

    // Build row array matching column order
    const maxCol = Math.max(...Object.values(colMap));
    const newRow: any[] = new Array(maxCol + 1).fill('');

    // Set values by column index
    // Note: created_by_full_name is NOT stored - it's looked up dynamically
    newRow[colMap['suggestion_id']] = suggestionId;
    newRow[colMap['title']] = data.title;
    newRow[colMap['category']] = data.category;
    newRow[colMap['description']] = data.description;
    newRow[colMap['reason_for_improvement']] = data.reasonForImprovement;
    newRow[colMap['created_by_username']] = data.createdByUsername;
    newRow[colMap['committee_only']] = data.committeeOnly || '';
    newRow[colMap['created_at']] = now;
    newRow[colMap['updated_at']] = now;
    newRow[colMap['updated_by_username']] = data.createdByUsername;

    // Append row
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'MemberSuggestions!A:AZ',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [newRow],
      },
    });

    return { success: true, suggestionId };
  } catch (error) {
    console.error('[createSuggestion] Error creating suggestion:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create suggestion',
    };
  }
}

/**
 * Update suggestion
 */
export async function updateSuggestion(
  suggestionId: string,
  updates: Partial<MemberSuggestion>,
  updatedByUsername: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const suggestion = await getSuggestionById(suggestionId);

    if (!suggestion || !suggestion._rowNumber) {
      return { success: false, error: 'Suggestion not found' };
    }

    const colMap = await getColumnMap('MemberSuggestions');
    const sheets = getGoogleSheetsClient();

    // Build batch update data
    const updateData: any[] = [];

    // Field mapping (camelCase to snake_case)
    // Note: coordinatorFullName and createdByFullName are NOT stored - they're computed fields
    const fieldToColumnMap: Record<string, string> = {
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

    // Update each field
    for (const [field, value] of Object.entries(updates)) {
      const colName = fieldToColumnMap[field];
      if (colName && colMap[colName] !== undefined) {
        const colLetter = getColumnLetter(colMap[colName]);
        updateData.push({
          range: `MemberSuggestions!${colLetter}${suggestion._rowNumber}`,
          values: [[value ?? '']],
        });
      }
    }

    // Update metadata
    const now = new Date().toISOString();
    updateData.push({
      range: `MemberSuggestions!${getColumnLetter(colMap['updated_at'])}${suggestion._rowNumber}`,
      values: [[now]],
    });
    updateData.push({
      range: `MemberSuggestions!${getColumnLetter(colMap['updated_by_username'])}${suggestion._rowNumber}`,
      values: [[updatedByUsername]],
    });

    // Execute batch update
    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: getSpreadsheetId(),
        requestBody: {
          data: updateData,
          valueInputOption: 'USER_ENTERED',
        },
      });
    }

    return { success: true };
  } catch (error) {
    console.error(`[updateSuggestion] Error updating suggestion ${suggestionId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update suggestion',
    };
  }
}

/**
 * Get all members for coordinator dropdown
 * Coordinators can be ANY member (not just committee)
 */
export async function getAllMembersForCoordinator(): Promise<Array<{ userName: string; fullName: string }>> {
  try {
    const colMap = await getColumnMap('Members');
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Members!A2:AZ',
    });

    const rows = response.data.values || [];
    const members: Array<{ userName: string; fullName: string }> = [];

    for (const row of rows) {
      const userName = row[colMap['user_name']] || '';
      const fullName = row[colMap['full_name']] || '';

      // Include all members with valid userName and fullName
      if (userName && fullName) {
        members.push({ userName, fullName });
      }
    }

    return members.sort((a, b) => a.fullName.localeCompare(b.fullName));
  } catch (error) {
    console.error('[getAllMembersForCoordinator] Error fetching members:', error);
    throw wrapError('Failed to fetch members', error);
  }
}
