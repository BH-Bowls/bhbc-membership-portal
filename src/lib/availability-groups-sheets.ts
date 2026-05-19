// src/lib/availability-groups-sheets.ts
// Google Sheets data layer for Availability Planner v2 — Groups and Group Members
// Handles all CRUD operations for AvailabilityGroups and AvailabilityGroupMembers sheets

import {
  getColumnMap,
  getColumnLetter,
  getGoogleSheetsClient,
  getAllUsers,
} from './sheets';
import type {
  AvailabilityGroup,
  AvailabilityGroupMember,
  AvailabilityGroupSummary,
  AvailabilityGroupDetail,
  AvailabilityEventSummary,
} from '@/types/availability';
import { hasRole } from './role-utils';

// ─── Constants ────────────────────────────────────────────────────────────────

// Sheet names within the Availability spreadsheet
const GROUPS_SHEET = 'AvailabilityGroups';
const MEMBERS_SHEET = 'AvailabilityGroupMembers';
const EVENTS_SHEET = 'AvailabilityEvents';

// Data ranges (row 1 = header, data starts row 2)
const GROUPS_RANGE = `${GROUPS_SHEET}!A2:I`;
const MEMBERS_RANGE = `${MEMBERS_SHEET}!A2:H`;
const EVENTS_RANGE = `${EVENTS_SHEET}!A2:P`;

// ─── Environment Variable Getter ──────────────────────────────────────────────

// Returns the Availability spreadsheet ID, throws if not configured
function getSpreadsheetId(): string {
  // Read the env var and throw immediately if missing so the error is obvious
  const id = process.env.AVAILABILITY_SPREADSHEET_ID;
  if (!id) {
    throw new Error('AVAILABILITY_SPREADSHEET_ID environment variable is not set');
  }
  return id;
}

// ─── ID Generators ────────────────────────────────────────────────────────────

// Generate next group ID in AG-YYYY-NNN format, resets each calendar year
async function generateGroupId(): Promise<string> {
  // Get the spreadsheet client and column map
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(GROUPS_SHEET, spreadsheetId);

  // Fetch all existing group rows to find the max NNN for this year
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: GROUPS_RANGE,
  });

  const rows = response.data.values;
  const currentYear = new Date().getFullYear();
  const prefix = `AG-${currentYear}-`;
  let maxNumber = 0;

  // Check if there are any existing rows
  if (rows) {
    // Loop through each existing row to find the highest sequence number for this year
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Get the group_id column value
      const groupIdCol = colMap['group_id'];
      if (groupIdCol === undefined) {
        continue;
      }
      const id = row[groupIdCol];
      // Check if this ID belongs to the current year
      if (id && typeof id === 'string' && id.startsWith(prefix)) {
        // Parse the numeric suffix
        const numStr = id.substring(prefix.length);
        const num = parseInt(numStr, 10);
        // Track the highest number found
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
    }
  }

  // Increment and format as AG-YYYY-NNN (3-digit padding)
  return `AG-${currentYear}-${String(maxNumber + 1).padStart(3, '0')}`;
}

// Generate next group member ID in AGM-NNNNNN format, never resets
async function generateGroupMemberId(): Promise<string> {
  // Get the spreadsheet client and column map
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(MEMBERS_SHEET, spreadsheetId);

  // Fetch column A of the members sheet to find the max sequence number
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${MEMBERS_SHEET}!A2:A`,
  });

  const rows = response.data.values;
  const prefix = 'AGM-';
  let maxNumber = 0;

  // Check if there are any existing rows
  if (rows) {
    // Loop through each existing ID to find the highest sequence number
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = row[0];
      // Parse the numeric suffix from AGM-NNNNNN
      if (id && typeof id === 'string' && id.startsWith(prefix)) {
        const numStr = id.substring(prefix.length);
        const num = parseInt(numStr, 10);
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
    }
  }

  // Increment and pad to 6 digits
  return `AGM-${String(maxNumber + 1).padStart(6, '0')}`;
}

// ─── Group Functions ───────────────────────────────────────────────────────────

// Fetch all groups visible to the calling user:
//   - Groups the user created
//   - Groups where user appears in AvailabilityGroupMembers (user_name matches)
//   - Only status = 'active'
// Resolves memberCount and openEventCount for each group.
export async function getGroups(userName: string): Promise<AvailabilityGroupSummary[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Fetch column maps for all three sheets we need
  const groupsColMap = await getColumnMap(GROUPS_SHEET, spreadsheetId);
  const membersColMap = await getColumnMap(MEMBERS_SHEET, spreadsheetId);
  const eventsColMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);

  // Fetch all group rows
  const groupsResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: GROUPS_RANGE,
  });

  // Fetch all group member rows
  const membersResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: MEMBERS_RANGE,
  });

  // Fetch all events rows to count open events per group
  const eventsResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: EVENTS_RANGE,
  });

  const groupRows = groupsResp.data.values;
  const memberRows = membersResp.data.values;
  const eventRows = eventsResp.data.values;

  // Build a set of group IDs the user is a member of
  const memberGroupIds = new Set<string>();
  if (memberRows) {
    // Loop through every group member row
    for (let i = 0; i < memberRows.length; i++) {
      const row = memberRows[i];
      const userNameCol = membersColMap['user_name'];
      const groupIdCol = membersColMap['group_id'];
      const memberTypeCol = membersColMap['member_type'];
      if (userNameCol === undefined || groupIdCol === undefined || memberTypeCol === undefined) {
        continue;
      }
      const rowUserName = row[userNameCol];
      const rowGroupId = row[groupIdCol];
      const rowMemberType = row[memberTypeCol];
      // Only track member-type entries that match this user
      if (rowMemberType === 'member' && rowUserName === userName && rowGroupId) {
        memberGroupIds.add(rowGroupId);
      }
    }
  }

  // Build member count map: groupId → count
  const memberCountMap: Record<string, number> = {};
  if (memberRows) {
    for (let i = 0; i < memberRows.length; i++) {
      const row = memberRows[i];
      const groupIdCol = membersColMap['group_id'];
      if (groupIdCol === undefined) {
        continue;
      }
      const rowGroupId = row[groupIdCol];
      if (rowGroupId) {
        // Increment count for this group
        if (memberCountMap[rowGroupId] === undefined) {
          memberCountMap[rowGroupId] = 0;
        }
        memberCountMap[rowGroupId] = memberCountMap[rowGroupId] + 1;
      }
    }
  }

  // Build open event count map: groupId → count
  const openEventCountMap: Record<string, number> = {};
  if (eventRows) {
    for (let i = 0; i < eventRows.length; i++) {
      const row = eventRows[i];
      const groupIdCol = eventsColMap['group_id'];
      const statusCol = eventsColMap['status'];
      const expiresAtCol = eventsColMap['expires_at'];
      if (groupIdCol === undefined || statusCol === undefined) {
        continue;
      }
      const rowGroupId = row[groupIdCol];
      const rowStatus = row[statusCol];
      const rowExpiresAt = expiresAtCol !== undefined ? row[expiresAtCol] : '';

      // Count this event as open if status is 'open' and not yet expired
      if (rowGroupId && rowStatus === 'open') {
        // Check expiry — expired open events are still logically open (just read-only)
        const isExpired = rowExpiresAt ? new Date(rowExpiresAt) < new Date() : false;
        if (!isExpired) {
          if (openEventCountMap[rowGroupId] === undefined) {
            openEventCountMap[rowGroupId] = 0;
          }
          openEventCountMap[rowGroupId] = openEventCountMap[rowGroupId] + 1;
        }
      }
    }
  }

  // Build the result array — only groups the user created or is a member of
  const results: AvailabilityGroupSummary[] = [];

  if (!groupRows) {
    return results;
  }

  for (let i = 0; i < groupRows.length; i++) {
    const row = groupRows[i];
    const groupIdCol = groupsColMap['group_id'];
    const nameCol = groupsColMap['name'];
    const descriptionCol = groupsColMap['description'];
    const createdByUsernameCol = groupsColMap['created_by_username'];
    const allowMemberManagementCol = groupsColMap['allow_member_management'];
    const statusCol = groupsColMap['status'];

    if (groupIdCol === undefined || nameCol === undefined || statusCol === undefined) {
      continue;
    }

    const groupId = row[groupIdCol] || '';
    const status = row[statusCol] || '';
    const createdByUsername = createdByUsernameCol !== undefined ? (row[createdByUsernameCol] || '') : '';

    // Only include active groups
    if (status !== 'active') {
      continue;
    }

    // Only include groups the user created or is a member of
    const isCreator = createdByUsername === userName;
    const isMember = memberGroupIds.has(groupId);
    if (!isCreator && !isMember) {
      continue;
    }

    const allowMemberManagement = allowMemberManagementCol !== undefined
      ? row[allowMemberManagementCol] === 'Y'
      : false;

    // Determine if this user can manage members
    const canManageMembers = isCreator || (allowMemberManagement && isMember);

    results.push({
      groupId,
      name: nameCol !== undefined ? (row[nameCol] || '') : '',
      description: descriptionCol !== undefined ? (row[descriptionCol] || '') : '',
      createdByUsername,
      status: 'active',
      memberCount: memberCountMap[groupId] !== undefined ? memberCountMap[groupId] : 0,
      openEventCount: openEventCountMap[groupId] !== undefined ? openEventCountMap[groupId] : 0,
      isCreator,
      canManageMembers,
    });
  }

  return results;
}

// Fetch a single group by groupId. Returns null if not found.
// Does NOT check access — caller (API route) is responsible.
export async function getGroupById(groupId: string): Promise<AvailabilityGroup | null> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(GROUPS_SHEET, spreadsheetId);

  // Fetch all group rows and search for matching ID
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: GROUPS_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    return null;
  }

  // Loop through rows to find matching groupId
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const groupIdCol = colMap['group_id'];
    if (groupIdCol === undefined) {
      continue;
    }
    const rowGroupId = row[groupIdCol];
    if (rowGroupId === groupId) {
      // Found — parse and return the group
      return parseGroupRow(row, colMap);
    }
  }

  return null;
}

// Parse a raw sheet row into an AvailabilityGroup object
function parseGroupRow(row: string[], colMap: Record<string, number>): AvailabilityGroup {
  // Helper to safely get a cell value by column key
  const get = (key: string): string => {
    const col = colMap[key];
    if (col === undefined) {
      return '';
    }
    return row[col] || '';
  };

  return {
    groupId: get('group_id'),
    name: get('name'),
    description: get('description'),
    createdByUsername: get('created_by_username'),
    allowMemberManagement: get('allow_member_management') === 'Y',
    teamId: get('team_id'),
    status: (get('status') || 'active') as 'active' | 'archived',
    createdAt: get('created_at'),
    updatedAt: get('updated_at'),
  };
}

// Build the full group detail for the group page.
// Fetches group, members, and event summaries.
// Resolves display names for member-type group members via Members sheet.
// Resolves isCreator and canManageMembers for the calling user.
export async function getGroupDetail(
  groupId: string,
  callerUserName: string
): Promise<AvailabilityGroupDetail | null> {
  // Fetch the group first
  const group = await getGroupById(groupId);
  if (!group) {
    return null;
  }

  // Fetch group members
  const members = await getGroupMembers(groupId);

  // Resolve display names for member-type group members
  const memberDisplayNames: Record<string, string> = {};

  // Collect all unique usernames of member-type group members
  const userNamesToLookup: string[] = [];
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (m.memberType === 'member' && m.userName) {
      userNamesToLookup.push(m.userName);
    }
  }

  // If there are usernames to look up, fetch from Members sheet
  if (userNamesToLookup.length > 0) {
    // Get all users to build a name lookup map
    const allUsers = await getAllUsers();

    // Build a map of userName → fullKnownAs for fast lookup
    const userNameMap: Record<string, string> = {};
    for (let i = 0; i < allUsers.length; i++) {
      const user = allUsers[i];
      if (user.userName) {
        userNameMap[user.userName] = user.fullKnownAs || user.fullName || user.userName;
      }
    }

    // Populate display names for members in this group
    for (let i = 0; i < userNamesToLookup.length; i++) {
      const un = userNamesToLookup[i];
      if (userNameMap[un]) {
        memberDisplayNames[un] = userNameMap[un];
      } else {
        // Fallback to userName if no display name found
        memberDisplayNames[un] = un;
      }
    }
  }

  // Fetch events for this group (import lazily to avoid circular dependencies)
  const { getGroupEvents } = await import('./availability-events-sheets');
  const events: AvailabilityEventSummary[] = await getGroupEvents(groupId, callerUserName);

  // Determine caller's relationship to this group
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

// Create a new group. Appends one row to AvailabilityGroups.
// Returns the generated groupId.
export async function createGroup(data: {
  name: string;
  description: string;
  createdByUsername: string;
  allowMemberManagement: boolean;
}): Promise<string> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(GROUPS_SHEET, spreadsheetId);

  // Generate unique group ID
  const groupId = await generateGroupId();
  const now = new Date().toISOString();

  // Build the row array with all required columns
  const maxCol = Math.max(...Object.values(colMap));
  const newRow: string[] = new Array(maxCol + 1).fill('');

  // Set each column value using the dynamic column map
  const setCol = (key: string, value: string) => {
    const col = colMap[key];
    if (col !== undefined) {
      newRow[col] = value;
    }
  };

  setCol('group_id', groupId);
  setCol('name', data.name);
  setCol('description', data.description);
  setCol('created_by_username', data.createdByUsername);
  setCol('allow_member_management', data.allowMemberManagement ? 'Y' : 'N');
  setCol('team_id', '');
  setCol('status', 'active');
  setCol('created_at', now);
  setCol('updated_at', '');

  // Append the new row to the sheet
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${GROUPS_SHEET}!A:I`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [newRow] },
  });

  return groupId;
}

// Update group fields. Sets updated_at.
// Updatable fields: name, description, allow_member_management
export async function updateGroup(
  groupId: string,
  updates: Partial<Pick<AvailabilityGroup, 'name' | 'description' | 'allowMemberManagement'>>
): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(GROUPS_SHEET, spreadsheetId);

  // Fetch all rows to find the row number for this group
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: GROUPS_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    throw new Error(`Group not found: ${groupId}`);
  }

  // Find the row index for this group
  let rowNumber = -1;
  const groupIdCol = colMap['group_id'];
  if (groupIdCol === undefined) {
    throw new Error('group_id column not found in AvailabilityGroups sheet');
  }

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][groupIdCol] === groupId) {
      // Row number is 1-based: row 2 is the first data row (offset from header row 1)
      rowNumber = i + 2;
      break;
    }
  }

  if (rowNumber === -1) {
    throw new Error(`Group not found: ${groupId}`);
  }

  const now = new Date().toISOString();

  // Build batch update data — only update the fields that were provided
  const updateData: Array<{ range: string; values: string[][] }> = [];

  // Update name if provided
  if (updates.name !== undefined) {
    const col = colMap['name'];
    if (col !== undefined) {
      updateData.push({
        range: `${GROUPS_SHEET}!${getColumnLetter(col)}${rowNumber}`,
        values: [[updates.name]],
      });
    }
  }

  // Update description if provided
  if (updates.description !== undefined) {
    const col = colMap['description'];
    if (col !== undefined) {
      updateData.push({
        range: `${GROUPS_SHEET}!${getColumnLetter(col)}${rowNumber}`,
        values: [[updates.description]],
      });
    }
  }

  // Update allow_member_management if provided
  if (updates.allowMemberManagement !== undefined) {
    const col = colMap['allow_member_management'];
    if (col !== undefined) {
      updateData.push({
        range: `${GROUPS_SHEET}!${getColumnLetter(col)}${rowNumber}`,
        values: [[updates.allowMemberManagement ? 'Y' : 'N']],
      });
    }
  }

  // Always update updated_at timestamp
  const updatedAtCol = colMap['updated_at'];
  if (updatedAtCol !== undefined) {
    updateData.push({
      range: `${GROUPS_SHEET}!${getColumnLetter(updatedAtCol)}${rowNumber}`,
      values: [[now]],
    });
  }

  // Execute batch update if there are fields to update
  if (updateData.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updateData,
        valueInputOption: 'USER_ENTERED',
      },
    });
  }
}

// Soft-delete a group. Sets status = 'archived'.
export async function archiveGroup(groupId: string): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(GROUPS_SHEET, spreadsheetId);

  // Fetch rows to find the row number for this group
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: GROUPS_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    throw new Error(`Group not found: ${groupId}`);
  }

  // Find row index for this group
  let rowNumber = -1;
  const groupIdCol = colMap['group_id'];
  if (groupIdCol === undefined) {
    throw new Error('group_id column not found');
  }

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][groupIdCol] === groupId) {
      rowNumber = i + 2;
      break;
    }
  }

  if (rowNumber === -1) {
    throw new Error(`Group not found: ${groupId}`);
  }

  const now = new Date().toISOString();

  // Update status to 'archived' and set updated_at
  const updateData: Array<{ range: string; values: string[][] }> = [];

  const statusCol = colMap['status'];
  if (statusCol !== undefined) {
    updateData.push({
      range: `${GROUPS_SHEET}!${getColumnLetter(statusCol)}${rowNumber}`,
      values: [['archived']],
    });
  }

  const updatedAtCol = colMap['updated_at'];
  if (updatedAtCol !== undefined) {
    updateData.push({
      range: `${GROUPS_SHEET}!${getColumnLetter(updatedAtCol)}${rowNumber}`,
      values: [[now]],
    });
  }

  // Execute update
  if (updateData.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updateData,
        valueInputOption: 'USER_ENTERED',
      },
    });
  }
}

// Check whether a user (by userName) is a member of a group.
export async function isGroupMember(groupId: string, userName: string): Promise<boolean> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(MEMBERS_SHEET, spreadsheetId);

  // Fetch all group member rows
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: MEMBERS_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    return false;
  }

  const groupIdCol = colMap['group_id'];
  const userNameCol = colMap['user_name'];
  const memberTypeCol = colMap['member_type'];

  if (groupIdCol === undefined || userNameCol === undefined || memberTypeCol === undefined) {
    return false;
  }

  // Search for a row matching both groupId and userName with type 'member'
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Only check member-type entries (not visitors)
    if (row[memberTypeCol] === 'member' && row[groupIdCol] === groupId && row[userNameCol] === userName) {
      return true;
    }
  }

  return false;
}

// Determine whether a user can manage group membership.
// True if: user is the group creator, OR user has Admin role,
// OR (group.allow_member_management is true AND user is a group member).
export async function canManageGroupMembers(
  group: AvailabilityGroup,
  userName: string,
  userRole: string
): Promise<boolean> {
  // Group creator can always manage members
  if (group.createdByUsername === userName) {
    return true;
  }

  // Admin role can always manage members
  if (hasRole(userRole, 'Admin')) {
    return true;
  }

  // If allowMemberManagement is true, any group member can manage
  if (group.allowMemberManagement) {
    const isMember = await isGroupMember(group.groupId, userName);
    return isMember;
  }

  return false;
}

// ─── Group Member Functions ────────────────────────────────────────────────────

// Fetch all members of a group.
export async function getGroupMembers(groupId: string): Promise<AvailabilityGroupMember[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(MEMBERS_SHEET, spreadsheetId);

  // Fetch all group member rows
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: MEMBERS_RANGE,
  });

  const rows = response.data.values;
  const results: AvailabilityGroupMember[] = [];

  if (!rows) {
    return results;
  }

  const groupIdCol = colMap['group_id'];
  if (groupIdCol === undefined) {
    return results;
  }

  // Loop through and collect only rows belonging to this group
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row[groupIdCol] === groupId) {
      results.push(parseGroupMemberRow(row, colMap));
    }
  }

  return results;
}

// Parse a raw sheet row into an AvailabilityGroupMember object
function parseGroupMemberRow(row: string[], colMap: Record<string, number>): AvailabilityGroupMember {
  // Helper to safely get a cell value by column key
  const get = (key: string): string => {
    const col = colMap[key];
    if (col === undefined) {
      return '';
    }
    return row[col] || '';
  };

  return {
    memberId: get('member_id'),
    groupId: get('group_id'),
    memberType: (get('member_type') || 'member') as 'member' | 'visitor',
    userName: get('user_name'),
    visitorName: get('visitor_name'),
    visitorEmail: get('visitor_email'),
    addedByUsername: get('added_by_username'),
    createdAt: get('created_at'),
  };
}

// Add a batch of members to a group.
// For each member-type entry: check they are not already in the group (skip duplicates silently).
// For each visitor-type entry: check no existing visitor with same email in this group (skip duplicates silently).
// Returns the list of created AvailabilityGroupMember records.
export async function addGroupMembers(
  groupId: string,
  addedByUsername: string,
  memberUserNames: string[],
  visitorMembers: Array<{ visitorName: string; visitorEmail: string }>
): Promise<AvailabilityGroupMember[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(MEMBERS_SHEET, spreadsheetId);

  // Fetch existing members to check for duplicates
  const existingMembers = await getGroupMembers(groupId);

  // Build set of existing usernames to detect duplicates
  const existingUserNames = new Set<string>();
  for (let i = 0; i < existingMembers.length; i++) {
    const m = existingMembers[i];
    if (m.memberType === 'member' && m.userName) {
      existingUserNames.add(m.userName);
    }
  }

  // Build set of existing visitor emails to detect duplicates
  const existingVisitorEmails = new Set<string>();
  for (let i = 0; i < existingMembers.length; i++) {
    const m = existingMembers[i];
    if (m.memberType === 'visitor' && m.visitorEmail) {
      existingVisitorEmails.add(m.visitorEmail.toLowerCase());
    }
  }

  const createdMembers: AvailabilityGroupMember[] = [];
  const now = new Date().toISOString();
  const maxCol = Math.max(...Object.values(colMap));

  // Helper to build and append a row for a new group member
  const appendMemberRow = async (record: AvailabilityGroupMember): Promise<void> => {
    const newRow: string[] = new Array(maxCol + 1).fill('');
    const setCol = (key: string, value: string) => {
      const col = colMap[key];
      if (col !== undefined) {
        newRow[col] = value;
      }
    };
    setCol('member_id', record.memberId);
    setCol('group_id', record.groupId);
    setCol('member_type', record.memberType);
    setCol('user_name', record.userName);
    setCol('visitor_name', record.visitorName);
    setCol('visitor_email', record.visitorEmail);
    setCol('added_by_username', record.addedByUsername);
    setCol('created_at', record.createdAt);

    // Append the row to the sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${MEMBERS_SHEET}!A:H`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });
  };

  // Process member-type additions (by username)
  for (let i = 0; i < memberUserNames.length; i++) {
    const un = memberUserNames[i];
    // Skip if already in the group
    if (existingUserNames.has(un)) {
      continue;
    }
    // Generate unique member ID for this entry
    const memberId = await generateGroupMemberId();

    const record: AvailabilityGroupMember = {
      memberId,
      groupId,
      memberType: 'member',
      userName: un,
      visitorName: '',
      visitorEmail: '',
      addedByUsername,
      createdAt: now,
    };

    // Append to sheet sequentially
    await appendMemberRow(record);
    createdMembers.push(record);
  }

  // Process visitor-type additions (by name and email)
  for (let i = 0; i < visitorMembers.length; i++) {
    const v = visitorMembers[i];
    // Skip if visitor with same email already in group
    if (existingVisitorEmails.has(v.visitorEmail.toLowerCase())) {
      continue;
    }
    // Generate unique member ID for this entry
    const memberId = await generateGroupMemberId();

    const record: AvailabilityGroupMember = {
      memberId,
      groupId,
      memberType: 'visitor',
      userName: '',
      visitorName: v.visitorName,
      visitorEmail: v.visitorEmail,
      addedByUsername,
      createdAt: now,
    };

    // Append to sheet sequentially
    await appendMemberRow(record);
    createdMembers.push(record);
  }

  return createdMembers;
}

// Remove a group member by memberId.
// Does NOT cascade to existing invitee records — past event invites remain intact.
export async function removeGroupMember(memberId: string): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(MEMBERS_SHEET, spreadsheetId);

  // Fetch all rows to find the row number for this member
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: MEMBERS_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    throw new Error(`Group member not found: ${memberId}`);
  }

  // Find the row index for this member
  let rowNumber = -1;
  const memberIdCol = colMap['member_id'];
  if (memberIdCol === undefined) {
    throw new Error('member_id column not found');
  }

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][memberIdCol] === memberId) {
      // Row number is 1-based: data starts at row 2 (header is row 1)
      rowNumber = i + 2;
      break;
    }
  }

  if (rowNumber === -1) {
    throw new Error(`Group member not found: ${memberId}`);
  }

  // Get sheet metadata to find the sheetId for the batchUpdate request
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetsData = spreadsheet.data.sheets;
  if (!sheetsData) {
    throw new Error('Could not fetch spreadsheet metadata');
  }

  // Find the AvailabilityGroupMembers sheet ID
  let sheetId: number | null = null;
  for (let i = 0; i < sheetsData.length; i++) {
    const s = sheetsData[i];
    if (s.properties && s.properties.title === MEMBERS_SHEET) {
      if (s.properties.sheetId !== undefined && s.properties.sheetId !== null) {
        sheetId = s.properties.sheetId;
      }
      break;
    }
  }

  if (sheetId === null) {
    throw new Error(`${MEMBERS_SHEET} sheet not found in spreadsheet`);
  }

  // Delete the row using the deleteDimension request
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              // startIndex is 0-based: row 2 → index 1
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });
}
