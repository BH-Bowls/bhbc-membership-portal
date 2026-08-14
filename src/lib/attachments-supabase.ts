// src/lib/attachments-supabase.ts
// Postgres-backed replacement for attachments-sheets.ts (Member Suggestion
// attachments). Same function names/signatures throughout, so every consumer
// route needs only an import swap.

import { getSupabaseClient } from './supabase';
import { checkDriveFileExists } from './drive';
import type { SuggestionAttachment, AttachmentType } from '@/types/attachments';

function mapRow(row: any): SuggestionAttachment {
  return {
    attachmentId: row.attachment_id,
    suggestionId: row.suggestion_id,
    type: row.type as AttachmentType,
    driveFileId: row.drive_file_id,
    url: row.url,
    description: row.description,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size !== null ? Number(row.file_size) : null,
    displayOrder: row.display_order,
    addedAt: row.added_at,
    addedByUsername: row.added_by_username,
    isDeleted: row.is_deleted === true,
  };
}

/** Generate next attachment ID (ATT-NNNNNN format). */
async function generateNextAttachmentId(): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('suggestion_attachments').select('attachment_id').like('attachment_id', 'ATT-%');
  if (error) throw new Error(`Failed to generate attachment ID: ${error.message}`);

  let maxNumber = 0;
  for (const row of data ?? []) {
    const numStr = (row.attachment_id as string).substring(4);
    const num = parseInt(numStr, 10);
    if (!isNaN(num) && num > maxNumber) maxNumber = num;
  }
  return `ATT-${String(maxNumber + 1).padStart(6, '0')}`;
}

export async function getAttachmentsBySuggestionId(suggestionId: string): Promise<SuggestionAttachment[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('suggestion_attachments')
    .select('*')
    .eq('suggestion_id', suggestionId)
    .order('display_order', { ascending: true });
  if (error) throw new Error(`Failed to fetch attachments for ${suggestionId}: ${error.message}`);
  return (data ?? []).map(mapRow);
}

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
    const existingAttachments = await getAttachmentsBySuggestionId(data.suggestionId);
    const displayOrder = existingAttachments.length + 1;
    const attachmentId = await generateNextAttachmentId();

    const supabase = getSupabaseClient();
    const { error } = await supabase.from('suggestion_attachments').insert({
      attachment_id: attachmentId,
      suggestion_id: data.suggestionId,
      type: data.type,
      drive_file_id: data.driveFileId || null,
      url: data.url,
      description: data.description,
      file_name: data.fileName || null,
      mime_type: data.mimeType || null,
      file_size: data.fileSize ?? null,
      display_order: displayOrder,
      added_by_username: data.addedByUsername,
      is_deleted: false,
    });
    if (error) throw new Error(error.message);

    return { success: true, attachmentId };
  } catch (error) {
    console.error('[createAttachment] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create attachment' };
  }
}

export async function deleteAttachment(attachmentId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const { error, count } = await supabase
    .from('suggestion_attachments')
    .delete({ count: 'exact' })
    .eq('attachment_id', attachmentId);
  if (error) return { success: false, error: error.message };
  if (!count) return { success: false, error: 'Attachment not found' };
  return { success: true };
}

/** Check all attachments for a suggestion and mark any whose Drive file is gone.
 *  Self-heals rows wrongly flagged deleted (e.g. a transient Drive auth error). */
export async function validateAttachments(suggestionId: string): Promise<SuggestionAttachment[]> {
  try {
    const attachments = await getAttachmentsBySuggestionId(suggestionId);
    const supabase = getSupabaseClient();

    for (const attachment of attachments) {
      if (!attachment.driveFileId) continue; // links / no file to check
      const exists = await checkDriveFileExists(attachment.driveFileId);
      const shouldBeDeleted = !exists;
      if (shouldBeDeleted !== attachment.isDeleted) {
        attachment.isDeleted = shouldBeDeleted;
        const { error } = await supabase
          .from('suggestion_attachments')
          .update({ is_deleted: shouldBeDeleted })
          .eq('attachment_id', attachment.attachmentId);
        if (error) console.error(`[validateAttachments] Failed to sync is_deleted for ${attachment.attachmentId}:`, error.message);
      }
    }

    return attachments;
  } catch (error) {
    console.error(`[validateAttachments] Error for ${suggestionId}:`, error);
    return await getAttachmentsBySuggestionId(suggestionId);
  }
}

export async function getAttachmentById(attachmentId: string): Promise<SuggestionAttachment | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('suggestion_attachments').select('*').eq('attachment_id', attachmentId).maybeSingle();
  if (error) throw new Error(`Failed to fetch attachment ${attachmentId}: ${error.message}`);
  return data ? mapRow(data) : null;
}
