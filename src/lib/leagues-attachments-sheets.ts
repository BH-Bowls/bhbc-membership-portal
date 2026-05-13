// src/lib/leagues-attachments-sheets.ts
// Google Sheets operations for League Attachments (rules documents etc.)

import {
  getColumnMap,
  getColumnLetter,
  getGoogleSheetsClient,
  getLeaguesSpreadsheetId,
} from './sheets';

function sid(): string {
  return getLeaguesSpreadsheetId();
}
import { createRowFieldGetter, createRowNumberGetter, wrapError } from './banking-sheets';
import { checkDriveFileExists, isDriveFileId } from './drive';
import type { LeagueAttachment, AttachmentType } from '@/types/attachments';

const ATTACHMENTS_SHEET = 'LeagueAttachments';
const ATTACHMENTS_RANGE = `${ATTACHMENTS_SHEET}!A2:AZ`;
const HEADER_ROW_OFFSET = 2;

function parseAttachmentRow(
  row: any[],
  rowNumber: number,
  colMap: Record<string, number>
): LeagueAttachment {
  const get = createRowFieldGetter(row, colMap);
  const getNumber = createRowNumberGetter(get);

  return {
    attachmentId: get('attachment_id') || '',
    leagueId: get('league_id') || '',
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

async function generateNextAttachmentId(): Promise<string> {
  const colMap = await getColumnMap(ATTACHMENTS_SHEET, sid());
  const sheets = getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sid(),
    range: ATTACHMENTS_RANGE,
  });

  const rows = response.data.values || [];
  let maxNumber = 0;

  for (const row of rows) {
    const id = row[colMap['attachment_id']];
    if (id && typeof id === 'string' && id.startsWith('LA-')) {
      const num = parseInt(id.substring(3), 10);
      if (!isNaN(num) && num > maxNumber) maxNumber = num;
    }
  }

  return `LA-${String(maxNumber + 1).padStart(6, '0')}`;
}

export async function getLeagueAttachmentsByLeagueId(
  leagueId: string
): Promise<LeagueAttachment[]> {
  try {
    const colMap = await getColumnMap(ATTACHMENTS_SHEET, sid());
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sid(),
      range: ATTACHMENTS_RANGE,
    });

    const rows = response.data.values || [];
    const attachments: LeagueAttachment[] = [];

    for (let i = 0; i < rows.length; i++) {
      const att = parseAttachmentRow(rows[i], i + HEADER_ROW_OFFSET, colMap);
      if (att.leagueId === leagueId && !att.isDeleted) attachments.push(att);
    }

    return attachments.sort((a, b) => a.displayOrder - b.displayOrder);
  } catch (error) {
    throw wrapError(`Failed to fetch attachments for league ${leagueId}`, error);
  }
}

export async function getLeagueAttachmentById(
  attachmentId: string
): Promise<LeagueAttachment | null> {
  try {
    const colMap = await getColumnMap(ATTACHMENTS_SHEET, sid());
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sid(),
      range: ATTACHMENTS_RANGE,
    });

    const rows = response.data.values || [];

    for (let i = 0; i < rows.length; i++) {
      if (rows[i][colMap['attachment_id']] === attachmentId) {
        return parseAttachmentRow(rows[i], i + HEADER_ROW_OFFSET, colMap);
      }
    }

    return null;
  } catch (error) {
    throw wrapError(`Failed to fetch attachment ${attachmentId}`, error);
  }
}

export async function createLeagueAttachment(data: {
  leagueId: string;
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
    const colMap = await getColumnMap(ATTACHMENTS_SHEET, sid());
    const sheets = getGoogleSheetsClient();

    const existing = await getLeagueAttachmentsByLeagueId(data.leagueId);
    const displayOrder = existing.length + 1;
    const attachmentId = await generateNextAttachmentId();
    const now = new Date().toISOString();

    const maxCol = Math.max(...Object.values(colMap));
    const newRow: any[] = new Array(maxCol + 1).fill('');

    newRow[colMap['attachment_id']] = attachmentId;
    newRow[colMap['league_id']] = data.leagueId;
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
      spreadsheetId: sid(),
      range: `${ATTACHMENTS_SHEET}!A:AZ`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });

    return { success: true, attachmentId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create attachment',
    };
  }
}

export async function deleteLeagueAttachment(
  attachmentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const colMap = await getColumnMap(ATTACHMENTS_SHEET, sid());
    const sheets = getGoogleSheetsClient();
    const spreadsheetId = sid();

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

    if (!targetRow) return { success: false, error: 'Attachment not found' };

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = spreadsheet.data.sheets?.find(
      (s) => s.properties?.title === ATTACHMENTS_SHEET
    );

    if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
      return { success: false, error: 'LeagueAttachments sheet not found' };
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
                startIndex: targetRow - 1,
                endIndex: targetRow,
              },
            },
          },
        ],
      },
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete attachment',
    };
  }
}
