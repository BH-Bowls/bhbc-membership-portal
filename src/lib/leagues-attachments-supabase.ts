// src/lib/leagues-attachments-supabase.ts
// Postgres-backed replacement for leagues-attachments-sheets.ts (League rules
// documents etc.). Same function names/signatures throughout, so every consumer
// route needs only an import swap.

import { getSupabaseClient } from './supabase';
import type { LeagueAttachment, AttachmentType } from '@/types/attachments';

function mapRow(row: any): LeagueAttachment {
  return {
    attachmentId: row.attachment_id,
    leagueId: row.league_id,
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
  const { data, error } = await supabase.from('league_attachments').select('attachment_id').like('attachment_id', 'LA-%');
  if (error) throw new Error(`Failed to generate attachment ID: ${error.message}`);

  let maxNumber = 0;
  for (const row of data ?? []) {
    const num = parseInt((row.attachment_id as string).substring(3), 10);
    if (!isNaN(num) && num > maxNumber) maxNumber = num;
  }
  return `LA-${String(maxNumber + 1).padStart(6, '0')}`;
}

export async function getLeagueAttachmentsByLeagueId(leagueId: string): Promise<LeagueAttachment[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('league_attachments')
    .select('*')
    .eq('league_id', leagueId)
    .eq('is_deleted', false)
    .order('display_order', { ascending: true });
  if (error) throw new Error(`Failed to fetch attachments for league ${leagueId}: ${error.message}`);
  return (data ?? []).map(mapRow);
}

export async function getLeagueAttachmentById(attachmentId: string): Promise<LeagueAttachment | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('league_attachments').select('*').eq('attachment_id', attachmentId).maybeSingle();
  if (error) throw new Error(`Failed to fetch attachment ${attachmentId}: ${error.message}`);
  return data ? mapRow(data) : null;
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
    const existing = await getLeagueAttachmentsByLeagueId(data.leagueId);
    const displayOrder = existing.length + 1;
    const attachmentId = await generateNextAttachmentId();

    const supabase = getSupabaseClient();
    const { error } = await supabase.from('league_attachments').insert({
      attachment_id: attachmentId,
      league_id: data.leagueId,
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
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create attachment' };
  }
}

export async function deleteLeagueAttachment(attachmentId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const { error, count } = await supabase.from('league_attachments').delete({ count: 'exact' }).eq('attachment_id', attachmentId);
  if (error) return { success: false, error: error.message };
  if (!count) return { success: false, error: 'Attachment not found' };
  return { success: true };
}
