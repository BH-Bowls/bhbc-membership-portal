// src/lib/attachments-sheets.ts
// Google Sheets operations for Member Suggestion Attachments

import {
  getColumnMap,
  getColumnLetter,
  getGoogleSheetsClient,
  getSpreadsheetId,
} from './sheets';
import { createRowFieldGetter, createRowNumberGetter, wrapError } from './banking-sheets';
import { checkDriveFileExists, isDriveFileId } from './drive';
import type { SuggestionAttachment, AttachmentType } from '@/types/attachments';

// ============================================================================
// CONSTANTS
// ============================================================================

const ATTACHMENTS_SHEET_RANGE = 'MemberSuggestionsAttachments!A2:AZ';
const HEADER_ROW_OFFSET = 2;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse a Google Sheets row into a SuggestionAttachment object
 */
function parseAttachmentRow(
  row: any[],
  rowNumber: number,
  colMap: Record<string, number>
): SuggestionAttachment {
  const get = createRowFieldGetter(row, colMap);
  const getNumber = createRowNumberGetter(get);

  return {
    attachmentId: get('attachment_id') || '',
    suggestionId: get('suggestion_id') || '',
    type: (get('type') as AttachmentType) || 'link',
    driveFileId: get('drive_file_id') || null,
    url: get('url') || '',
    description: get('description') || '',
    fileName: get('file_name') || null,
    mimeType: get('mime_type') || null,
    fileSize: getNumber('file_size') || null,
    displayOrder: getNumber('display_order') || 0,
    addedAt: get('added_at') || '',
    addedByUsername: get('added_by_username') || '',
    isDeleted: get('is_deleted') === 'TRUE',
    _rowNumber: rowNumber,
  };
}

/**
 * Generate next attachment ID (ATT-NNNNNN format)
 */
async function generateNextAttachmentId(): Promise<string> {
  const colMap = await getColumnMap('MemberSuggestionsAttachments');
  const sheets = getGoogleSheetsClient();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: ATTACHMENTS_SHEET_RANGE,
    });

    const rows = response.data.values || [];
    let maxNumber = 0;

    for (const row of rows) {
      const id = row[colMap['attachment_id']];
      if (id && typeof id === 'string' && id.startsWith('ATT-')) {
        const numStr = id.substring(4);
        const num = parseInt(numStr, 10);
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
    }

    return `ATT-${String(maxNumber + 1).padStart(6, '0')}`;
  } catch (error) {
    console.error('[generateNextAttachmentId] Error:', error);
    throw wrapError('Failed to generate attachment ID', error);
  }
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Get all attachments for a suggestion
 */
export async function getAttachmentsBySuggestionId(
  suggestionId: string
): Promise<SuggestionAttachment[]> {
  try {
    const colMap = await getColumnMap('MemberSuggestionsAttachments');
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: ATTACHMENTS_SHEET_RANGE,
    });

    const rows = response.data.values || [];
    const attachments: SuggestionAttachment[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const attachment = parseAttachmentRow(row, i + HEADER_ROW_OFFSET, colMap);

      if (attachment.suggestionId === suggestionId) {
        attachments.push(attachment);
      }
    }

    // Sort by display order
    return attachments.sort((a, b) => a.displayOrder - b.displayOrder);
  } catch (error) {
    console.error(`[getAttachmentsBySuggestionId] Error for ${suggestionId}:`, error);
    throw wrapError(`Failed to fetch attachments for ${suggestionId}`, error);
  }
}

/**
 * Create a new attachment
 */
export async function createAttachment(data: {
  suggestionId: string;
  type: AttachmentType;
  driveFileId?: string | null;
  url: string;
  description: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  addedByUsername: string;
}): Promise<{ success: boolean; attachmentId?: string; error?: string }> {
  try {
    const colMap = await getColumnMap('MemberSuggestionsAttachments');
    const sheets = getGoogleSheetsClient();

    // Get existing attachments to determine display order
    const existingAttachments = await getAttachmentsBySuggestionId(data.suggestionId);
    const displayOrder = existingAttachments.length + 1;

    // Generate attachment ID
    const attachmentId = await generateNextAttachmentId();
    const now = new Date().toISOString();

    // Build row array
    const maxCol = Math.max(...Object.values(colMap));
    const newRow: any[] = new Array(maxCol + 1).fill('');

    newRow[colMap['attachment_id']] = attachmentId;
    newRow[colMap['suggestion_id']] = data.suggestionId;
    newRow[colMap['type']] = data.type;
    newRow[colMap['drive_file_id']] = data.driveFileId || '';
    newRow[colMap['url']] = data.url;
    newRow[colMap['description']] = data.description;
    newRow[colMap['file_name']] = data.fileName || '';
    newRow[colMap['mime_type']] = data.mimeType || '';
    newRow[colMap['file_size']] = data.fileSize || '';
    newRow[colMap['display_order']] = displayOrder;
    newRow[colMap['added_at']] = now;
    newRow[colMap['added_by_username']] = data.addedByUsername;
    newRow[colMap['is_deleted']] = 'FALSE';

    // Append row
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'MemberSuggestionsAttachments!A:AZ',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [newRow],
      },
    });

    return { success: true, attachmentId };
  } catch (error) {
    console.error('[createAttachment] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create attachment',
    };
  }
}

/**
 * Delete an attachment (mark as deleted)
 */
export async function deleteAttachment(
  attachmentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const colMap = await getColumnMap('MemberSuggestionsAttachments');
    const sheets = getGoogleSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    // Get all attachments to find the row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: ATTACHMENTS_SHEET_RANGE,
    });

    const rows = response.data.values || [];
    let targetRow: number | null = null;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = row[colMap['attachment_id']];
      if (id === attachmentId) {
        targetRow = i + HEADER_ROW_OFFSET;
        break;
      }
    }

    if (!targetRow) {
      return { success: false, error: 'Attachment not found' };
    }

    // Get the numeric sheet ID for the deleteDimension request
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const attachmentsSheet = spreadsheet.data.sheets?.find(
      (s) => s.properties?.title === 'MemberSuggestionsAttachments'
    );

    if (!attachmentsSheet?.properties?.sheetId && attachmentsSheet?.properties?.sheetId !== 0) {
      return { success: false, error: 'Attachments sheet not found' };
    }

    // Delete the row from the sheet
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: attachmentsSheet.properties.sheetId,
                dimension: 'ROWS',
                startIndex: targetRow - 1, // 0-indexed
                endIndex: targetRow,
              },
            },
          },
        ],
      },
    });

    return { success: true };
  } catch (error) {
    console.error(`[deleteAttachment] Error deleting ${attachmentId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete attachment',
    };
  }
}

/**
 * Check all attachments for a suggestion and mark deleted Cloudinary files
 * Returns list of attachments with updated isDeleted status
 */
export async function validateAttachments(
  suggestionId: string
): Promise<SuggestionAttachment[]> {
  try {
    const attachments = await getAttachmentsBySuggestionId(suggestionId);
    const colMap = await getColumnMap('MemberSuggestionsAttachments');
    const sheets = getGoogleSheetsClient();

    const updates: any[] = [];

    for (const attachment of attachments) {
      // Only validate Drive files — Cloudinary legacy files are assumed present until migrated
      if (attachment.isDeleted || !attachment.driveFileId) continue;
      if (!isDriveFileId(attachment.driveFileId)) continue;

      const exists = await checkDriveFileExists(attachment.driveFileId);

      if (!exists && attachment._rowNumber) {
        // Mark as deleted
        attachment.isDeleted = true;
        const colLetter = getColumnLetter(colMap['is_deleted']);
        updates.push({
          range: `MemberSuggestionsAttachments!${colLetter}${attachment._rowNumber}`,
          values: [['TRUE']],
        });
      }
    }

    // Execute batch update if needed
    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: getSpreadsheetId(),
        requestBody: {
          data: updates,
          valueInputOption: 'USER_ENTERED',
        },
      });
    }

    return attachments;
  } catch (error) {
    console.error(`[validateAttachments] Error for ${suggestionId}:`, error);
    // Return attachments as-is on error
    return await getAttachmentsBySuggestionId(suggestionId);
  }
}

/**
 * Get attachment by ID
 */
export async function getAttachmentById(
  attachmentId: string
): Promise<SuggestionAttachment | null> {
  try {
    const colMap = await getColumnMap('MemberSuggestionsAttachments');
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: ATTACHMENTS_SHEET_RANGE,
    });

    const rows = response.data.values || [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = row[colMap['attachment_id']];
      if (id === attachmentId) {
        return parseAttachmentRow(row, i + HEADER_ROW_OFFSET, colMap);
      }
    }

    return null;
  } catch (error) {
    console.error(`[getAttachmentById] Error fetching ${attachmentId}:`, error);
    throw wrapError(`Failed to fetch attachment ${attachmentId}`, error);
  }
}
