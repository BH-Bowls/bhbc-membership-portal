// src/lib/invite-games-attachments-supabase.ts
// Postgres-backed replacement for invite-games-attachments-sheets.ts. Same function
// names/signatures throughout, so every consumer route needs only an import swap.

import { getSupabaseClient } from './supabase';
import { checkDriveFileExists } from './drive';
import type { InviteGameAttachment, AttachmentType } from '@/types/attachments';

function mapRow(row: any): InviteGameAttachment {
  return {
    attachmentId: row.attachment_id,
    inviteGameId: row.invite_game_id,
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

async function generateNextAttachmentId(): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('invite_game_attachments').select('attachment_id').like('attachment_id', 'IGA-%');
  if (error) throw new Error(`Failed to generate attachment ID: ${error.message}`);

  let maxNumber = 0;
  for (const row of data ?? []) {
    const num = parseInt((row.attachment_id as string).substring(4), 10);
    if (!isNaN(num) && num > maxNumber) maxNumber = num;
  }
  return `IGA-${String(maxNumber + 1).padStart(6, '0')}`;
}

export async function getAttachmentsByInviteGameId(inviteGameId: string): Promise<InviteGameAttachment[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('invite_game_attachments')
    .select('*')
    .eq('invite_game_id', inviteGameId)
    .order('display_order', { ascending: true });
  if (error) throw new Error(`Failed to fetch attachments for ${inviteGameId}: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export async function getInviteGameAttachmentById(attachmentId: string): Promise<InviteGameAttachment | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('invite_game_attachments').select('*').eq('attachment_id', attachmentId).maybeSingle();
  if (error) throw new Error(`Failed to fetch attachment ${attachmentId}: ${error.message}`);
  return data ? mapRow(data) : null;
}

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
    const existing = await getAttachmentsByInviteGameId(data.inviteGameId);
    const displayOrder = existing.length + 1;
    const attachmentId = await generateNextAttachmentId();

    const supabase = getSupabaseClient();
    const { error } = await supabase.from('invite_game_attachments').insert({
      attachment_id: attachmentId,
      invite_game_id: data.inviteGameId,
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
    console.error('[createInviteGameAttachment] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create attachment' };
  }
}

export async function deleteInviteGameAttachment(attachmentId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const { error, count } = await supabase.from('invite_game_attachments').delete({ count: 'exact' }).eq('attachment_id', attachmentId);
  if (error) return { success: false, error: error.message };
  if (!count) return { success: false, error: 'Attachment not found' };
  return { success: true };
}

/** Check all attachments for an invite game and mark any whose Drive file is gone.
 *  Self-heals rows wrongly flagged deleted (e.g. a transient Drive auth error). */
export async function validateInviteGameAttachments(inviteGameId: string): Promise<InviteGameAttachment[]> {
  try {
    const attachments = await getAttachmentsByInviteGameId(inviteGameId);
    const supabase = getSupabaseClient();

    for (const attachment of attachments) {
      if (!attachment.driveFileId) continue; // links / no file to check
      const exists = await checkDriveFileExists(attachment.driveFileId);
      const shouldBeDeleted = !exists;
      if (shouldBeDeleted !== attachment.isDeleted) {
        attachment.isDeleted = shouldBeDeleted;
        const { error } = await supabase
          .from('invite_game_attachments')
          .update({ is_deleted: shouldBeDeleted })
          .eq('attachment_id', attachment.attachmentId);
        if (error) console.error(`[validateInviteGameAttachments] Failed to sync is_deleted for ${attachment.attachmentId}:`, error.message);
      }
    }

    return attachments;
  } catch (error) {
    console.error(`[validateInviteGameAttachments] Error for ${inviteGameId}:`, error);
    return await getAttachmentsByInviteGameId(inviteGameId);
  }
}
