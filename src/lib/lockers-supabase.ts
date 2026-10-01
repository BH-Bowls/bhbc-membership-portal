// src/lib/lockers-supabase.ts
// Locker Register data layer — the master record of lockers, keys and who has them
// (supabase/migrations/0069_lockers.sql). The only writer of locker allocations;
// members-supabase.ts reads the same table to derive User.lockerNo read-only, so
// every write here invalidates its users cache.

import { getSupabaseClient } from './supabase';
import { invalidateCache as invalidateUsersCache } from './members-supabase';
import { LOCKER_ROOMS, LOCKER_STATUS_LABELS } from '@/types/lockers';
import type { Locker, LockerInput, LockerStatus, LockerWithMember } from '@/types/lockers';

function mapRow(row: any): LockerWithMember {
  const profile = row.users?.member_profiles ?? null;
  const firstName = profile?.known_as || profile?.first_name || '';
  const memberName = row.users ? `${firstName} ${profile?.last_name || ''}`.trim() || row.users.username : null;
  return {
    id: row.id,
    room: row.room,
    lockerNumber: row.locker_number,
    keyNumber: row.key_number,
    keysCount: row.keys_count,
    status: row.status,
    userName: row.username,
    notes: row.notes,
    memberName,
    memberActive: row.users ? row.users.is_active === true : false,
  };
}

const SELECT = '*, users(username, is_active, member_profiles!user_id(first_name, known_as, last_name))';

export async function getAllLockers(): Promise<LockerWithMember[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('lockers')
    .select(SELECT)
    .order('room', { ascending: false }) // Mens before Ladies
    .order('locker_number', { ascending: true });
  if (error) throw new Error(`Failed to fetch lockers: ${error.message}`);
  return (data ?? []).map(mapRow);
}

/** Validates and normalises a locker for writing; returns an error message or the row. */
function toRow(input: LockerInput): { error: string } | { row: Record<string, any> } {
  if (!LOCKER_ROOMS.includes(input.room)) return { error: 'Room must be Mens or Ladies' };
  if (!Number.isInteger(input.lockerNumber) || input.lockerNumber <= 0) return { error: 'Locker number must be a positive whole number' };
  if (!(input.status in LOCKER_STATUS_LABELS)) return { error: 'Invalid status' };
  if (input.keysCount !== null && (!Number.isInteger(input.keysCount) || input.keysCount < 0)) {
    return { error: 'Number of keys must be a whole number, 0 or more' };
  }
  const status: LockerStatus = input.status;
  const userName = input.userName && input.userName.trim() ? input.userName.trim() : null;
  if (status === 'member' && !userName) return { error: 'A member locker must be allocated to a member' };
  if (status === 'empty' && userName) return { error: 'An empty locker can\'t be allocated to a member' };
  return {
    row: {
      room: input.room,
      locker_number: input.lockerNumber,
      key_number: input.keyNumber && input.keyNumber.trim() ? input.keyNumber.trim() : null,
      keys_count: input.keysCount,
      status,
      username: userName,
      notes: input.notes && input.notes.trim() ? input.notes.trim() : null,
    },
  };
}

function friendlyError(message: string): string {
  if (message.includes('lockers_room_locker_number_key')) return 'That locker number already exists in this room';
  return message;
}

export async function createLocker(input: LockerInput): Promise<{ locker?: Locker; error?: string }> {
  const result = toRow(input);
  if ('error' in result) return { error: result.error };
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('lockers').insert(result.row).select(SELECT).single();
  if (error) return { error: friendlyError(error.message) };
  invalidateUsersCache();
  return { locker: mapRow(data) };
}

export async function updateLocker(id: string, input: LockerInput): Promise<{ locker?: Locker; error?: string }> {
  const result = toRow(input);
  if ('error' in result) return { error: result.error };
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('lockers')
    .update({ ...result.row, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(SELECT)
    .single();
  if (error) return { error: friendlyError(error.message) };
  invalidateUsersCache();
  return { locker: mapRow(data) };
}

export async function deleteLocker(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('lockers').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete locker: ${error.message}`);
  invalidateUsersCache();
}
