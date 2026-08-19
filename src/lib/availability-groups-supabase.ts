// src/lib/availability-groups-supabase.ts
// Postgres-backed replacement for availability-groups-sheets.ts. Same function names
// and signatures as the Sheets version so the API routes need only an import swap.
// group id stays the human-readable "AG-YYYY-NNN" format (text primary key) — these are
// embedded in already-sent links, so the format is preserved across the cutover.

import crypto from 'crypto';
import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';
import type {
  AvailabilityGroup,
  AvailabilityGroupMember,
  AvailabilityGroupSummary,
  AvailabilityGroupDetail,
  AvailabilityEventSummary,
} from '@/types/availability';
import { hasRole } from './role-utils';

// ─── ID Generator ───────────────────────────────────────────────────────────────

async function generateGroupId(): Promise<string> {
  const supabase = getSupabaseClient();
  const currentYear = new Date().getFullYear();
  const prefix = `AG-${currentYear}-`;

  const { data, error } = await supabase
    .from('availability_groups')
    .select('id')
    .like('id', `${prefix}%`);
  if (error) throw new Error(`Failed to generate group id: ${error.message}`);

  let maxNumber = 0;
  for (const row of data || []) {
    const num = parseInt(row.id.substring(prefix.length), 10);
    if (!isNaN(num) && num > maxNumber) maxNumber = num;
  }
  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`;
}

// ─── Row Mapping ──────────────────────────────────────────────────────────────

function mapGroupRow(row: any): AvailabilityGroup {
  return {
    groupId: row.id,
    name: row.name || '',
    description: row.description || '',
    createdByUsername: row.created_by_username || '',
    allowMemberManagement: !!row.allow_member_management,
    teamId: row.team_id || '',
    status: row.status || 'active',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function mapMemberRow(row: any): AvailabilityGroupMember {
  return {
    memberId: row.id,
    groupId: row.group_id,
    memberType: row.member_type || 'member',
    userName: row.username || '',
    visitorName: row.visitor_name || '',
    visitorEmail: row.visitor_email || '',
    addedByUsername: row.added_by_username || '',
    createdAt: row.created_at || '',
    token: row.token || '',
  };
}

// ─── Group Functions ────────────────────────────────────────────────────────────

/**
 * Fetch all groups visible to the calling user: groups they created, or groups where
 * they appear as a member-type row. Only status='active'. Resolves memberCount and
 * openEventCount for each group.
 */
export async function getGroups(userName: string): Promise<AvailabilityGroupSummary[]> {
  const supabase = getSupabaseClient();

  const [groupsResp, membersResp, eventsResp] = await Promise.all([
    supabase.from('availability_groups').select('*').eq('status', 'active'),
    supabase.from('availability_group_members').select('group_id, username, member_type'),
    supabase.from('availability_events').select('group_id, status, expires_at').eq('status', 'open'),
  ]);
  if (groupsResp.error) throw new Error(`Failed to fetch groups: ${groupsResp.error.message}`);
  if (membersResp.error) throw new Error(`Failed to fetch group members: ${membersResp.error.message}`);
  if (eventsResp.error) throw new Error(`Failed to fetch events: ${eventsResp.error.message}`);

  const memberGroupIds = new Set<string>();
  const memberCountMap: Record<string, number> = {};
  for (const row of membersResp.data || []) {
    if (row.group_id) {
      memberCountMap[row.group_id] = (memberCountMap[row.group_id] || 0) + 1;
    }
    if (row.member_type === 'member' && row.username === userName && row.group_id) {
      memberGroupIds.add(row.group_id);
    }
  }

  const openEventCountMap: Record<string, number> = {};
  for (const row of eventsResp.data || []) {
    if (!row.group_id) continue;
    const isExpired = row.expires_at ? new Date(row.expires_at) < new Date() : false;
    if (!isExpired) {
      openEventCountMap[row.group_id] = (openEventCountMap[row.group_id] || 0) + 1;
    }
  }

  const results: AvailabilityGroupSummary[] = [];
  for (const row of groupsResp.data || []) {
    const groupId = row.id;
    const createdByUsername = row.created_by_username || '';
    const isCreator = createdByUsername === userName;
    const isMember = memberGroupIds.has(groupId);
    if (!isCreator && !isMember) continue;

    const allowMemberManagement = !!row.allow_member_management;
    results.push({
      groupId,
      name: row.name || '',
      description: row.description || '',
      createdByUsername,
      status: 'active',
      memberCount: memberCountMap[groupId] || 0,
      openEventCount: openEventCountMap[groupId] || 0,
      isCreator,
      canManageMembers: isCreator || (allowMemberManagement && isMember),
    });
  }

  return results;
}

/** Fetch a single group by id. Does NOT check access — caller is responsible. */
export async function getGroupById(groupId: string): Promise<AvailabilityGroup | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('availability_groups').select('*').eq('id', groupId).maybeSingle();
  if (error) throw new Error(`Failed to fetch group: ${error.message}`);
  if (!data) return null;
  return mapGroupRow(data);
}

/**
 * Build the full group detail for the group page: group, members, resolved display
 * names, event summaries, and the caller's isCreator/canManageMembers.
 */
export async function getGroupDetail(
  groupId: string,
  callerUserName: string
): Promise<AvailabilityGroupDetail | null> {
  const group = await getGroupById(groupId);
  if (!group) return null;

  const members = await getGroupMembers(groupId);

  const memberDisplayNames: Record<string, string> = {};
  const userNamesToLookup = members.filter((m) => m.memberType === 'member' && m.userName).map((m) => m.userName);

  if (userNamesToLookup.length > 0) {
    const allUsers = await getAllUsers();
    const userNameMap: Record<string, string> = {};
    for (const user of allUsers) {
      if (user.userName) userNameMap[user.userName] = user.fullName || user.fullKnownAs || user.userName;
    }
    for (const un of userNamesToLookup) {
      memberDisplayNames[un] = userNameMap[un] || un;
    }
  }

  // Lazy import to avoid a circular dependency with availability-events-supabase.ts
  const { getGroupEvents } = await import('./availability-events-supabase');
  const events: AvailabilityEventSummary[] = await getGroupEvents(groupId, callerUserName);

  const isCreator = group.createdByUsername === callerUserName;
  const isMemberResult = await isGroupMember(groupId, callerUserName);
  const canManage = isCreator || (group.allowMemberManagement && isMemberResult);

  return {
    group,
    members,
    memberDisplayNames,
    events,
    isCreator,
    canManageMembers: canManage,
  };
}

/** Create a new group. Returns the generated id. */
export async function createGroup(data: {
  name: string;
  description: string;
  createdByUsername: string;
  allowMemberManagement: boolean;
}): Promise<string> {
  const supabase = getSupabaseClient();
  const groupId = await generateGroupId();

  const { error } = await supabase.from('availability_groups').insert({
    id: groupId,
    name: data.name,
    description: data.description || null,
    created_by_username: data.createdByUsername,
    allow_member_management: data.allowMemberManagement,
    status: 'active',
  });
  if (error) throw new Error(`Failed to create group: ${error.message}`);

  return groupId;
}

/** Update group fields. Sets updated_at. */
export async function updateGroup(
  groupId: string,
  updates: Partial<Pick<AvailabilityGroup, 'name' | 'description' | 'allowMemberManagement'>>
): Promise<void> {
  const supabase = getSupabaseClient();
  const columnUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (updates.name !== undefined) columnUpdates.name = updates.name;
  if (updates.description !== undefined) columnUpdates.description = updates.description;
  if (updates.allowMemberManagement !== undefined) columnUpdates.allow_member_management = updates.allowMemberManagement;

  const { error } = await supabase.from('availability_groups').update(columnUpdates).eq('id', groupId);
  if (error) throw new Error(`Failed to update group: ${error.message}`);
}

/**
 * Permanently delete a group and everything in it. Cascades (via FK ON DELETE CASCADE)
 * to the group's events, which cascades further to those events' slots and responses,
 * plus the group's own group_members rows. Irreversible — the caller is responsible for
 * confirming with the user first.
 */
export async function deleteGroup(groupId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('availability_groups').delete().eq('id', groupId);
  if (error) throw new Error(`Failed to delete group: ${error.message}`);
}

/** Check whether a user is a member (member-type, not visitor) of a group. */
export async function isGroupMember(groupId: string, userName: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('availability_group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('member_type', 'member')
    .eq('username', userName)
    .maybeSingle();
  if (error) throw new Error(`Failed to check group membership: ${error.message}`);
  return !!data;
}

/**
 * Determine whether a user can manage group membership: creator, Admin, or (if the
 * group allows it) any group member.
 */
export async function canManageGroupMembers(
  group: AvailabilityGroup,
  userName: string,
  userRole: string
): Promise<boolean> {
  if (group.createdByUsername === userName) return true;
  if (hasRole(userRole, 'Admin')) return true;
  if (group.allowMemberManagement) {
    return isGroupMember(group.groupId, userName);
  }
  return false;
}

// ─── Group Member Functions ──────────────────────────────────────────────────────

/** Fetch all members of a group. */
export async function getGroupMembers(groupId: string): Promise<AvailabilityGroupMember[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('availability_group_members')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at');
  if (error) throw new Error(`Failed to fetch group members: ${error.message}`);
  return (data || []).map(mapMemberRow);
}

/**
 * Ensure every member of a group has a response token, generating (and persisting) one
 * for any that are blank. Returns the members with tokens populated.
 */
export async function ensureGroupMemberTokens(groupId: string): Promise<AvailabilityGroupMember[]> {
  const supabase = getSupabaseClient();
  const members = await getGroupMembers(groupId);

  const results: AvailabilityGroupMember[] = [];
  for (const member of members) {
    if (!member.token) {
      const token = crypto.randomBytes(32).toString('hex');
      const { error } = await supabase.from('availability_group_members').update({ token }).eq('id', member.memberId);
      if (error) throw new Error(`Failed to generate token: ${error.message}`);
      member.token = token;
    }
    results.push(member);
  }
  return results;
}

/**
 * Find the group member holding the given token, across all groups. Used to validate a
 * response link — the caller then checks the member's group owns the event.
 */
export async function getGroupMemberByToken(token: string): Promise<AvailabilityGroupMember | null> {
  if (!token) return null;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('availability_group_members').select('*').eq('token', token).maybeSingle();
  if (error) throw new Error(`Failed to look up token: ${error.message}`);
  if (!data) return null;
  return mapMemberRow(data);
}

/**
 * Add a batch of members to a group. Member-type entries are skipped if already in the
 * group; visitor-type entries are skipped if a visitor with the same email already is.
 * Returns the created records.
 */
export async function addGroupMembers(
  groupId: string,
  addedByUsername: string,
  memberUserNames: string[],
  visitorMembers: Array<{ visitorName: string; visitorEmail: string }>
): Promise<AvailabilityGroupMember[]> {
  const supabase = getSupabaseClient();
  const existingMembers = await getGroupMembers(groupId);

  const existingUserNames = new Set(
    existingMembers.filter((m) => m.memberType === 'member' && m.userName).map((m) => m.userName)
  );
  const existingVisitorEmails = new Set(
    existingMembers.filter((m) => m.memberType === 'visitor' && m.visitorEmail).map((m) => m.visitorEmail.toLowerCase())
  );

  const toInsert: { group_id: string; member_type: string; username: string | null; visitor_name: string | null; visitor_email: string | null; added_by_username: string }[] = [];

  for (const un of memberUserNames) {
    if (existingUserNames.has(un)) continue;
    toInsert.push({ group_id: groupId, member_type: 'member', username: un, visitor_name: null, visitor_email: null, added_by_username: addedByUsername });
  }
  for (const v of visitorMembers) {
    if (existingVisitorEmails.has(v.visitorEmail.toLowerCase())) continue;
    toInsert.push({ group_id: groupId, member_type: 'visitor', username: null, visitor_name: v.visitorName, visitor_email: v.visitorEmail, added_by_username: addedByUsername });
  }

  if (toInsert.length === 0) return [];

  const { data, error } = await supabase.from('availability_group_members').insert(toInsert).select('*');
  if (error) throw new Error(`Failed to add group members: ${error.message}`);
  return (data || []).map(mapMemberRow);
}

/**
 * Remove a group member by id. Does NOT cascade to existing response records — past
 * responses remain intact.
 */
export async function removeGroupMember(memberId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('availability_group_members').delete().eq('id', memberId);
  if (error) throw new Error(`Failed to remove group member: ${error.message}`);
}
