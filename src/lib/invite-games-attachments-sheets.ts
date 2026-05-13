// src/lib/invite-games-attachments-sheets.ts
// Google Sheets operations for Invite Games Attachments

import {
  getColumnMap,
  getColumnLetter,
  getGoogleSheetsClient,
  getSpreadsheetId,
} from './sheets';
import { createRowFieldGetter, createRowNumberGetter, wrapError } from './banking-sheets';
import { checkDriveFileExists, isDriveFileId } from './drive';
import type { InviteGameAttachment, AttachmentType } from '@/types/attachments';

// ============================================================================
// CONSTANTS
// ============================================================================

const ATTACHMENTS_SHEET = 'InviteGamesAttachments';
const ATTACHMENTS_RANGE = `${ATTACHMENTS_SHEET}!A2:AZ`;
const HEADER_ROW_OFFSET = 2;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse a Google Sheets row into an InviteGameAttachment object
 */
function parseAttachmentRow(
  row: any[],
  rowNumber: number,
  colMap: Record<string, number>
): InviteGameAttachment {
  const get = createRowFieldGetter(row, colMap);
  const getNumber = createRowNumberGetter(get);

  return {
    attachmentId: get('attachment_id') || '',
    inviteGameId: get('invite_game_id') || '',
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
 * Generate next attachment ID (IGA-NNNNNN format)
 */
async function generateNextAttachmentId(): Promise<string> {
  const colMap = await getColumnMap(ATTACHMENTS_SHEET);
  const sheets = getGoogleSheetsClient();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: ATTACHMENTS_RANGE,
    });

    const rows = response.data.values || [];
    let maxNumber = 0;

    for (const row of rows) {
      const id = row[colMap['attachment_id']];
      if (id && typeof id === 'string' && id.startsWith('IGA-')) {
        const num = parseInt(id.substring(4), 10);
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
    }

    return `IGA-${String(maxNumber + 1).padStart(6, '0')}`;
  } catch (error) {
    console.error('[generateNextAttachmentId] Error:', error);
    throw wrapError('Failed to generate attachment ID', error);
  }
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Get all attachments for an invite game
 */
export async function getAttachmentsByInviteGameId(
  inviteGameId: string
): Promise<InviteGameAttachment[]> {
  try {
    const colMap = await getColumnMap(ATTACHMENTS_SHEET);
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: ATTACHMENTS_RANGE,
    });

    const rows = response.data.values || [];
    const attachments: InviteGameAttachment[] = [];

    for (let i = 0; i < rows.length; i++) {
      const attachment = parseAttachmentRow(rows[i], i + HEADER_ROW_OFFSET, colMap);
      if (attachment.inviteGameId === inviteGameId) {
        attachments.push(attachment);
      }
    }

    return attachments.sort((a, b) => a.displayOrder - b.displayOrder);
  } catch (error) {
    console.error(`[getAttachmentsByInviteGameId] Error for ${inviteGameId}:`, error);
    throw wrapError(`Failed to fetch attachments for ${inviteGameId}`, error);
  }
}

/**
 * Get a single attachment by ID
 */
export async function getInviteGameAttachmentById(
  attachmentId: string
): Promise<InviteGameAttachment | null> {
  try {
    const colMap = await getColumnMap(ATTACHMENTS_SHEET);
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: ATTACHMENTS_RANGE,
    });

    const rows = response.data.values || [];

    for (let i = 0; i < rows.length; i++) {
      const id = rows[i][colMap['attachment_id']];
      if (id === attachmentId) {
        return parseAttachmentRow(rows[i], i + HEADER_ROW_OFFSET, colMap);
      }
    }

    return null;
  } catch (error) {
    console.error(`[getInviteGameAttachmentById] Error for ${attachmentId}:`, error);
    throw wrapError(`Failed to fetch attachment ${attachmentId}`, error);
  }
}

/**
 * Create a new attachment for an invite game
 */
export async function createInviteGameAttachment(data: {
  inviteGameId: string;
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
    const colMap = await getColumnMap(ATTACHMENTS_SHEET);
    const sheets = getGoogleSheetsClient();

    const existingAttachments = await getAttachmentsByInviteGameId(data.inviteGameId);
    const displayOrder = existingAttachments.length + 1;

    const attachmentId = await generateNextAttachmentId();
    const now = new Date().toISOString();

    const maxCol = Math.max(...Object.values(colMap));
    const newRow: any[] = new Array(maxCol + 1).fill('');

    newRow[colMap['attachment_id']] = attachmentId;
    newRow[colMap['invite_game_id']] = data.inviteGameId;
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

    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: `${ATTACHMENTS_SHEET}!A:AZ`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });

    return { success: true, attachmentId };
  } catch (error) {
    console.error('[createInviteGameAttachment] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create attachment',
    };
  }
}

/**
 * Delete an attachment row from the sheet
 */
export async function deleteInviteGameAttachment(
  attachmentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const colMap = await getColumnMap(ATTACHMENTS_SHEET);
    const sheets = getGoogleSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: ATTACHMENTS_RANGE,
    });

    const rows = response.data.values || [];
    let targetRow: number | null = null;

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][colMap['attachment_id']] === attachmentId) {
        targetRow = i + HEADER_ROW_OFFSET;
        break;
      }
    }

    if (!targetRow) {
      return { success: false, error: 'Attachment not found' };
    }

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = spreadsheet.data.sheets?.find(
      (s) => s.properties?.title === ATTACHMENTS_SHEET
    );

    if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
      return { success: false, error: 'Attachments sheet not found' };
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: sheet.properties.sheetId,
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
    console.error(`[deleteInviteGameAttachment] Error for ${attachmentId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete attachment',
    };
  }
}

/**
 * Validate attachments for an invite game — marks deleted Cloudinary files
 */
export async function validateInviteGameAttachments(
  inviteGameId: string
): Promise<InviteGameAttachment[]> {
  try {
    const attachments = await getAttachmentsByInviteGameId(inviteGameId);
    const colMap = await getColumnMap(ATTACHMENTS_SHEET);
    const sheets = getGoogleSheetsClient();

    const updates: any[] = [];

    for (const attachment of attachments) {
      if (attachment.isDeleted || !attachment.driveFileId) continue;
      if (!isDriveFileId(attachment.driveFileId)) continue;

      const exists = await checkDriveFileExists(attachment.driveFileId);

      if (!exists && attachment._rowNumber) {
        attachment.isDeleted = true;
        const colLetter = getColumnLetter(colMap['is_deleted']);
        updates.push({
          range: `${ATTACHMENTS_SHEET}!${colLetter}${attachment._rowNumber}`,
          values: [['TRUE']],
        });
      }
    }

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
    console.error(`[validateInviteGameAttachments] Error for ${inviteGameId}:`, error);
    return await getAttachmentsByInviteGameId(inviteGameId);
  }
}
