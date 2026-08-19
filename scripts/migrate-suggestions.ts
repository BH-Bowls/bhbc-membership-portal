/**
 * migrate-suggestions.ts
 *
 * Reads the live MemberSuggestions + MemberSuggestionsAttachments sheets (Members
 * spreadsheet) and writes them into the new Postgres suggestions/suggestion_attachments
 * tables (supabase/migrations/0037_suggestions.sql). Same "refresh Dev, rerun for the
 * real Prod cutover" pattern as migrate-renewals.ts.
 *
 * committee_only/committee_acceptance were free-text 'Y'/'' sentinels in the sheet —
 * migrated as real booleans (anything other than exactly 'Y' is false).
 *
 * date_received/target_completion_date/review_date/date_completed are always written
 * via a native <input type="date"> (ISO yyyy-mm-dd) by the live app, but parsed
 * defensively via parseUKDate anyway in case a row was ever hand-edited directly in
 * the sheet in a different format — same toISODateOrNull pattern as migrate-renewals.ts.
 *
 * Username validation: created_by_username/coordinator_username/updated_by_username
 * (suggestions) and added_by_username (attachments) all have FKs into `users`.
 * Leavers live in the same Postgres `users` table as active members (is_active=false,
 * not a separate table), so validated against ALL usernames — same lesson as
 * migrate-renewals.ts's leavers bug. A suggestion with an unresolvable
 * created_by_username is skipped entirely (it's NOT NULL); coordinator_username/
 * updated_by_username are nulled instead since they're optional. An attachment whose
 * suggestion was skipped, or whose added_by_username doesn't resolve, is skipped too.
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-suggestions.ts
 */

import { getGoogleSheetsClient, getSpreadsheetId, getColumnMap } from '../src/lib/sheets';
import { getSupabaseClient } from '../src/lib/supabase';
import { parseUKDate } from '../src/lib/date-utils';

const SUGGESTIONS_SHEET = 'MemberSuggestions';
const ATTACHMENTS_SHEET = 'MemberSuggestionsAttachments';

function toISODateOrNull(val: string): string | null {
  if (!val || !val.trim()) return null;
  const parsed = parseUKDate(val);
  if (isNaN(parsed.getTime())) {
    console.warn(`   !! Could not parse date "${val}" — left null`);
    return null;
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toNumberOrNull(val: string): number | null {
  if (!val || !val.trim()) return null;
  const n = parseFloat(val.replace(/[£,\s]/g, ''));
  return isNaN(n) ? null : n;
}

interface RawSuggestionRow {
  suggestionId: string;
  title: string;
  category: string;
  description: string;
  reasonForImprovement: string;
  createdByUsername: string;
  createdAt: string;
  committeeOnly: string;
  dateReceived: string;
  committeeAcceptance: string;
  committeeAcceptanceReason: string;
  priority: string;
  coordinatorUsername: string;
  estimatedCost: string;
  fundingSource: string;
  costQuotesDetails: string;
  decision: string;
  decisionReason: string;
  targetCompletionDate: string;
  progressNotes: string;
  reviewDate: string;
  finalOutcome: string;
  dateCompleted: string;
  updatedAt: string;
  updatedByUsername: string;
}

interface RawAttachmentRow {
  attachmentId: string;
  suggestionId: string;
  type: string;
  driveFileId: string;
  url: string;
  description: string;
  fileName: string;
  mimeType: string;
  fileSize: string;
  displayOrder: string;
  addedAt: string;
  addedByUsername: string;
  isDeleted: string;
}

async function fetchSuggestions(): Promise<RawSuggestionRow[]> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const colMap = await getColumnMap(SUGGESTIONS_SHEET, spreadsheetId);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SUGGESTIONS_SHEET}!A2:AZ`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const get = (row: any[], field: string): string => {
    const idx = colMap[field];
    return idx !== undefined ? (row[idx] || '').toString().trim() : '';
  };

  const entries: RawSuggestionRow[] = [];
  for (const row of rows) {
    const suggestionId = get(row, 'suggestion_id');
    if (!suggestionId) continue;
    entries.push({
      suggestionId,
      title: get(row, 'title'),
      category: get(row, 'category') || 'Other',
      description: get(row, 'description'),
      reasonForImprovement: get(row, 'reason_for_improvement'),
      createdByUsername: get(row, 'created_by_username'),
      createdAt: get(row, 'created_at'),
      committeeOnly: get(row, 'committee_only'),
      dateReceived: get(row, 'date_received'),
      committeeAcceptance: get(row, 'committee_acceptance'),
      committeeAcceptanceReason: get(row, 'committee_acceptance_reason'),
      priority: get(row, 'priority'),
      coordinatorUsername: get(row, 'coordinator_username'),
      estimatedCost: get(row, 'estimated_cost'),
      fundingSource: get(row, 'funding_source'),
      costQuotesDetails: get(row, 'cost_quotes_details'),
      decision: get(row, 'decision'),
      decisionReason: get(row, 'decision_reason'),
      targetCompletionDate: get(row, 'target_completion_date'),
      progressNotes: get(row, 'progress_notes'),
      reviewDate: get(row, 'review_date'),
      finalOutcome: get(row, 'final_outcome'),
      dateCompleted: get(row, 'date_completed'),
      updatedAt: get(row, 'updated_at'),
      updatedByUsername: get(row, 'updated_by_username'),
    });
  }
  return entries;
}

async function fetchAttachments(): Promise<RawAttachmentRow[]> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const colMap = await getColumnMap(ATTACHMENTS_SHEET, spreadsheetId);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${ATTACHMENTS_SHEET}!A2:AZ`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const get = (row: any[], field: string): string => {
    const idx = colMap[field];
    return idx !== undefined ? (row[idx] || '').toString().trim() : '';
  };

  const entries: RawAttachmentRow[] = [];
  for (const row of rows) {
    const attachmentId = get(row, 'attachment_id');
    if (!attachmentId) continue;
    entries.push({
      attachmentId,
      suggestionId: get(row, 'suggestion_id'),
      type: get(row, 'type') || 'link',
      driveFileId: get(row, 'drive_file_id'),
      url: get(row, 'url'),
      description: get(row, 'description'),
      fileName: get(row, 'file_name'),
      mimeType: get(row, 'mime_type'),
      fileSize: get(row, 'file_size'),
      displayOrder: get(row, 'display_order'),
      addedAt: get(row, 'added_at'),
      addedByUsername: get(row, 'added_by_username'),
      isDeleted: get(row, 'is_deleted'),
    });
  }
  return entries;
}

async function main() {
  console.log('1. Reading live MemberSuggestions + MemberSuggestionsAttachments sheets + all usernames (active + leavers)...');
  const supabase = getSupabaseClient();
  const [suggestions, attachments, allUsersResult] = await Promise.all([
    fetchSuggestions(),
    fetchAttachments(),
    supabase.from('users').select('username'),
  ]);
  if (allUsersResult.error) throw new Error(`Failed to fetch usernames: ${allUsersResult.error.message}`);
  console.log(`   -> ${suggestions.length} suggestion rows, ${attachments.length} attachment rows`);

  const usernames = new Set((allUsersResult.data ?? []).map((u) => (u.username as string).toLowerCase()));

  console.log('2. Wiping existing suggestion_attachments + suggestions (child-to-parent)...');
  const { error: wipeAttachmentsErr } = await supabase.from('suggestion_attachments').delete().neq('attachment_id', '__never_matches__');
  if (wipeAttachmentsErr) throw new Error(`Failed to wipe suggestion_attachments: ${wipeAttachmentsErr.message}`);
  const { error: wipeSuggestionsErr } = await supabase.from('suggestions').delete().neq('suggestion_id', '__never_matches__');
  if (wipeSuggestionsErr) throw new Error(`Failed to wipe suggestions: ${wipeSuggestionsErr.message}`);

  console.log('3. Inserting suggestions...');
  let suggestionsSkipped = 0;
  const validSuggestionIds = new Set<string>();
  const suggestionsToInsert = [];
  for (const s of suggestions) {
    if (!usernames.has(s.createdByUsername.toLowerCase())) {
      console.warn(`   !! suggestions: created_by_username "${s.createdByUsername}" doesn't match any current username — ${s.suggestionId} skipped`);
      suggestionsSkipped++;
      continue;
    }
    const coordinatorUsername = s.coordinatorUsername && usernames.has(s.coordinatorUsername.toLowerCase())
      ? s.coordinatorUsername
      : null;
    const updatedByUsername = s.updatedByUsername && usernames.has(s.updatedByUsername.toLowerCase())
      ? s.updatedByUsername
      : null;

    validSuggestionIds.add(s.suggestionId);
    suggestionsToInsert.push({
      suggestion_id: s.suggestionId,
      title: s.title,
      category: s.category,
      description: s.description,
      reason_for_improvement: s.reasonForImprovement,
      created_by_username: s.createdByUsername,
      created_at: s.createdAt || new Date().toISOString(),
      committee_only: s.committeeOnly === 'Y',
      date_received: toISODateOrNull(s.dateReceived),
      committee_acceptance: s.committeeAcceptance === 'Y',
      committee_acceptance_reason: s.committeeAcceptanceReason || null,
      priority: s.priority || null,
      coordinator_username: coordinatorUsername,
      estimated_cost: toNumberOrNull(s.estimatedCost),
      funding_source: s.fundingSource || null,
      cost_quotes_details: s.costQuotesDetails || null,
      decision: s.decision || null,
      decision_reason: s.decisionReason || null,
      target_completion_date: toISODateOrNull(s.targetCompletionDate),
      progress_notes: s.progressNotes || null,
      review_date: toISODateOrNull(s.reviewDate),
      final_outcome: s.finalOutcome || null,
      date_completed: toISODateOrNull(s.dateCompleted),
      updated_at: s.updatedAt || null,
      updated_by_username: updatedByUsername,
    });
  }
  if (suggestionsToInsert.length > 0) {
    const { error } = await supabase.from('suggestions').insert(suggestionsToInsert);
    if (error) throw new Error(`suggestions insert failed: ${error.message}`);
  }
  console.log(`   -> ${suggestionsToInsert.length} suggestions rows inserted${suggestionsSkipped > 0 ? ` (${suggestionsSkipped} skipped — unmatched created_by_username)` : ''}`);

  console.log('4. Inserting suggestion_attachments...');
  let attachmentsSkipped = 0;
  const attachmentsToInsert = [];
  for (const a of attachments) {
    if (!validSuggestionIds.has(a.suggestionId)) {
      console.warn(`   !! attachments: suggestion "${a.suggestionId}" was skipped/missing — attachment ${a.attachmentId} skipped`);
      attachmentsSkipped++;
      continue;
    }
    if (!usernames.has(a.addedByUsername.toLowerCase())) {
      console.warn(`   !! attachments: added_by_username "${a.addedByUsername}" doesn't match any current username — ${a.attachmentId} skipped`);
      attachmentsSkipped++;
      continue;
    }
    attachmentsToInsert.push({
      attachment_id: a.attachmentId,
      suggestion_id: a.suggestionId,
      type: a.type,
      drive_file_id: a.driveFileId || null,
      url: a.url,
      description: a.description,
      file_name: a.fileName || null,
      mime_type: a.mimeType || null,
      file_size: a.fileSize ? parseInt(a.fileSize, 10) : null,
      display_order: a.displayOrder ? parseInt(a.displayOrder, 10) : 0,
      added_at: a.addedAt || new Date().toISOString(),
      added_by_username: a.addedByUsername,
      is_deleted: a.isDeleted === 'TRUE',
    });
  }
  if (attachmentsToInsert.length > 0) {
    const { error } = await supabase.from('suggestion_attachments').insert(attachmentsToInsert);
    if (error) throw new Error(`suggestion_attachments insert failed: ${error.message}`);
  }
  console.log(`   -> ${attachmentsToInsert.length} suggestion_attachments rows inserted${attachmentsSkipped > 0 ? ` (${attachmentsSkipped} skipped)` : ''}`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
