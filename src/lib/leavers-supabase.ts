// src/lib/leavers-supabase.ts
// Postgres-backed replacement for leavers-sheets.ts. Archiving/reinstating no longer
// means moving rows between two sheets — it flips users.is_active and records
// left_at/leaver_reason/leaver_notes on member_profiles (the same row throughout the
// member's whole lifecycle, active or archived — nothing is copied or deleted).
//
// Roles are cleared on archive (an archived member's user_roles rows are deleted, so
// any role-based query that doesn't explicitly filter is_active=true never counts
// them — matches the original migration plan's reasoning) and deliberately NOT
// restored on reinstate: a reinstated member comes back as a plain 'Member', and an
// admin re-adds any special role (Captain, GMC, etc.) manually via the profile editor,
// same as any newly created member starts as plain Member too. Confirmed with the
// user rather than silently decided.

import { getSupabaseClient } from './supabase';
import { invalidateCache } from './members-supabase';

/** Leaver — a lightweight view of one archived member for list display. */
export interface Leaver {
  userName: string;
  firstName: string;
  lastName: string;
  knownAs: string;
  memberType: string;
  yearStarted: string;
  emailAddress: string;
  leftDate: string;
  leftReason: string;
  leftNotes: string;
}

/** Full detail of a single leaver for the read-only view. */
export interface LeaverDetail {
  userName: string;
  firstName: string;
  lastName: string;
  knownAs: string;
  emailAddress: string;
  landline: string;
  mobile: string;
  address1: string;
  address2: string;
  address3: string;
  postCode: string;
  ageDemographic: string;
  birthdate: string;
  memberType: string;
  yearStarted: string;
  honorary: string;
  handicap: string;
  role: string;
  leftDate: string;
  leftReason: string;
  leftNotes: string;
}

/** Format a Postgres timestamptz value as DD/MM/YYYY, or '' when null. */
function formatDateOnly(value: string | null): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return '';
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

// member_profiles has two FKs to users (user_id, buddy_user_name) — !user_id picks
// the profile-ownership one, matching members-supabase.ts's own disambiguation.
const LEAVER_SELECT = 'username, member_profiles!user_id(*)';

function mapLeaverRow(row: any): Leaver {
  const profile = row.member_profiles || {};
  return {
    userName: row.username,
    firstName: profile.first_name || '',
    lastName: profile.last_name || '',
    knownAs: profile.known_as || '',
    memberType: profile.member_type || '',
    yearStarted: profile.year_started ? String(profile.year_started) : '',
    emailAddress: profile.email_address || '',
    leftDate: formatDateOnly(profile.left_at),
    leftReason: profile.leaver_reason || '',
    leftNotes: profile.leaver_notes || '',
  };
}

function mapLeaverDetailRow(row: any): LeaverDetail {
  const profile = row.member_profiles || {};
  return {
    userName: row.username,
    firstName: profile.first_name || '',
    lastName: profile.last_name || '',
    knownAs: profile.known_as || '',
    emailAddress: profile.email_address || '',
    landline: profile.landline || '',
    mobile: profile.mobile || '',
    address1: profile.address_1 || '',
    address2: profile.address_2 || '',
    address3: profile.address_3 || '',
    postCode: profile.post_code || '',
    ageDemographic: profile.age_demographic || '',
    birthdate: profile.birthdate || '',
    memberType: profile.member_type || '',
    yearStarted: profile.year_started ? String(profile.year_started) : '',
    honorary: profile.honorary || '',
    handicap: profile.handicap === null || profile.handicap === undefined ? '' : String(profile.handicap),
    role: '', // roles are cleared on archive — see file header
    leftDate: formatDateOnly(profile.left_at),
    leftReason: profile.leaver_reason || '',
    leftNotes: profile.leaver_notes || '',
  };
}

/** List all leavers (is_active=false) for the leavers management page. */
export async function getAllLeavers(): Promise<Leaver[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .select(LEAVER_SELECT)
    .eq('is_active', false)
    .order('username', { ascending: true });
  if (error) throw new Error(`Failed to fetch leavers: ${error.message}`);
  return (data || []).map(mapLeaverRow);
}

/** Read a single leaver's full details by username (for the read-only view). */
export async function getLeaverByUserName(userName: string): Promise<LeaverDetail | null> {
  if (!userName) return null;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .select(LEAVER_SELECT)
    .eq('is_active', false)
    .ilike('username', userName)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch leaver: ${error.message}`);
  if (!data) return null;
  return mapLeaverDetailRow(data);
}

/**
 * Archive an active member: mark them inactive, record why/when/notes, and clear
 * their roles (see file header for why roles aren't preserved for restoration).
 *
 * @param userName The member's username
 * @param leftDate Date archived — a Postgres-parseable date (YYYY-MM-DD)
 * @param leftReason Reason (Lapsed / Resigned / Deceased)
 * @param leftNotes Optional free-text notes
 */
export async function archiveMember(
  userName: string,
  leftDate: string,
  leftReason: string,
  leftNotes: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseClient();

    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('id')
      .ilike('username', userName)
      .eq('is_active', true)
      .maybeSingle();
    if (userError) throw new Error(userError.message);
    if (!userRow) return { success: false, error: 'Member not found' };

    const { error: profileError } = await supabase
      .from('member_profiles')
      .update({
        left_at: leftDate,
        leaver_reason: leftReason,
        leaver_notes: leftNotes || null,
      })
      .eq('user_id', userRow.id);
    if (profileError) throw new Error(profileError.message);

    const { error: rolesError } = await supabase.from('user_roles').delete().eq('user_id', userRow.id);
    if (rolesError) throw new Error(rolesError.message);

    const { error: usersError } = await supabase
      .from('users')
      .update({ is_active: false })
      .eq('id', userRow.id);
    if (usersError) throw new Error(usersError.message);

    invalidateCache();
    return { success: true };
  } catch (error) {
    console.error(`[archiveMember] Failed to archive ${userName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to archive member',
    };
  }
}

/**
 * Reinstate a leaver: mark them active again, clear the leaver metadata, and give
 * them back the plain 'Member' role (see file header — prior roles are not restored).
 */
export async function reinstateMember(
  userName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseClient();

    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('id')
      .ilike('username', userName)
      .eq('is_active', false)
      .maybeSingle();
    if (userError) throw new Error(userError.message);
    if (!userRow) return { success: false, error: 'Leaver not found' };

    const { error: usersError } = await supabase
      .from('users')
      .update({ is_active: true })
      .eq('id', userRow.id);
    if (usersError) throw new Error(usersError.message);

    const { error: profileError } = await supabase
      .from('member_profiles')
      .update({
        left_at: null,
        leaver_reason: null,
        leaver_notes: null,
      })
      .eq('user_id', userRow.id);
    if (profileError) throw new Error(profileError.message);

    const { error: roleError } = await supabase
      .from('user_roles')
      .insert({ user_id: userRow.id, role: 'Member' });
    if (roleError) throw new Error(roleError.message);

    invalidateCache();
    return { success: true };
  } catch (error) {
    console.error(`[reinstateMember] Failed to reinstate ${userName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reinstate member',
    };
  }
}
