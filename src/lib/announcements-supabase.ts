// src/lib/announcements-supabase.ts
// Postgres-backed replacement for announcements-sheets.ts. Same function
// names/signatures throughout, so every consumer route needs only an import swap.
//
// One table (supabase/migrations/0035_announcements.sql). updatedBy/updatedAt are
// nullable columns but the Announcement type contract (src/types/diary.ts) expects
// '' rather than null/undefined for "not yet updated" — mapRow preserves that.

import { getSupabaseClient } from './supabase';
import type { Announcement } from '@/types/diary';

function mapRow(row: any): Announcement {
  const expiresAt = row.expires_at ? new Date(row.expires_at).toISOString() : '';
  return {
    id: row.id,
    message: row.message,
    expiresAt,
    createdBy: row.created_by || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
    updatedBy: row.updated_by || '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    isExpired: expiresAt ? expiresAt < new Date().toISOString() : true,
  };
}

// Read all rows, sorted by createdAt descending (newest first).
// Returns both active and expired rows — callers filter as needed.
export async function getAllAnnouncements(): Promise<Announcement[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to fetch announcements: ${error.message}`);
  return (data ?? []).map(mapRow);
}

// Returns only active (non-expired) announcements, ordered newest first
export async function getActiveAnnouncements(): Promise<Announcement[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to fetch active announcements: ${error.message}`);
  return (data ?? []).map(mapRow);
}

// Create a new announcement.
export async function createAnnouncement(
  message: string,
  expiresAt: string,
  createdBy: string
): Promise<Announcement> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('announcements')
    .insert({ message, expires_at: expiresAt, created_by: createdBy })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create announcement: ${error.message}`);
  return mapRow(data);
}

// Update message and expiresAt for an existing announcement by its ID.
// Throws if the ID is not found.
export async function updateAnnouncement(
  id: string,
  message: string,
  expiresAt: string,
  updatedBy: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error, count } = await supabase
    .from('announcements')
    .update({ message, expires_at: expiresAt, updated_by: updatedBy, updated_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', id);
  if (error) throw new Error(`Failed to update announcement: ${error.message}`);
  if (!count) throw new Error(`Announcement not found: ${id}`);
}

// Delete an announcement by its ID. Throws if the ID is not found.
export async function deleteAnnouncement(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error, count } = await supabase
    .from('announcements')
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error) throw new Error(`Failed to delete announcement: ${error.message}`);
  if (!count) throw new Error(`Announcement not found: ${id}`);
}
