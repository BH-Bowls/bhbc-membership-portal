// src/lib/availability-events-sheets.ts
// Google Sheets data layer for Availability Planner v2 — Events, Slots, Responses, Invitees
// Handles all CRUD operations for the AvailabilityEvents, AvailabilitySlots,
// AvailabilityResponses and AvailabilityInvitees sheets

import crypto from 'crypto';
import {
  getColumnMap,
  getColumnLetter,
  getGoogleSheetsClient,
  getAllUsers,
  getUserByUsername,
} from './sheets';
import type {
  AvailabilityEvent,
  AvailabilityEventSummary,
  AvailabilityEventDetail,
  AvailabilityManageDetail,
  AvailabilitySlot,
  AvailabilityResponseRecord,
  AvailabilityInvitee,
  AvailabilityParticipantResponses,
  AvailabilityResponse,
  AvailabilityEventType,
  AvailabilityGroupMember,
} from '@/types/availability';

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENTS_SHEET = 'AvailabilityEvents';
const SLOTS_SHEET = 'AvailabilitySlots';
const RESPONSES_SHEET = 'AvailabilityResponses';
const INVITEES_SHEET = 'AvailabilityInvitees';

const EVENTS_RANGE = `${EVENTS_SHEET}!A2:P`;
const SLOTS_RANGE = `${SLOTS_SHEET}!A2:F`;
const RESPONSES_RANGE = `${RESPONSES_SHEET}!A2:K`;
const INVITEES_RANGE = `${INVITEES_SHEET}!A2:K`;

// ─── Environment Variable Getter ──────────────────────────────────────────────

// Returns the Availability spreadsheet ID, throws if not configured
function getSpreadsheetId(): string {
  const id = process.env.AVAILABILITY_SPREADSHEET_ID;
  if (!id) {
    throw new Error('AVAILABILITY_SPREADSHEET_ID environment variable is not set');
  }
  return id;
}

// ─── ID Generators ────────────────────────────────────────────────────────────

// Generate next event ID in AV-YYYY-NNN format, resets each calendar year
async function generateEventId(): Promise<string> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Fetch column A of events sheet for existing IDs
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${EVENTS_SHEET}!A2:A`,
  });

  const rows = response.data.values;
  const currentYear = new Date().getFullYear();
  const prefix = `AV-${currentYear}-`;
  let maxNumber = 0;

  // Loop through existing IDs to find the max sequence number for this year
  if (rows) {
    for (let i = 0; i < rows.length; i++) {
      const id = rows[i][0];
      if (id && typeof id === 'string' && id.startsWith(prefix)) {
        const num = parseInt(id.substring(prefix.length), 10);
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
    }
  }

  return `AV-${currentYear}-${String(maxNumber + 1).padStart(3, '0')}`;
}

// Generate next slot ID in AVS-NNNNNN format, never resets
async function generateSlotId(): Promise<string> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Fetch column A of slots sheet for existing IDs
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SLOTS_SHEET}!A2:A`,
  });

  const rows = response.data.values;
  const prefix = 'AVS-';
  let maxNumber = 0;

  if (rows) {
    for (let i = 0; i < rows.length; i++) {
      const id = rows[i][0];
      if (id && typeof id === 'string' && id.startsWith(prefix)) {
        const num = parseInt(id.substring(prefix.length), 10);
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
    }
  }

  return `AVS-${String(maxNumber + 1).padStart(6, '0')}`;
}

// Generate next response ID in AVR-NNNNNN format, never resets
async function generateResponseId(): Promise<string> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Fetch column A of responses sheet for existing IDs
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${RESPONSES_SHEET}!A2:A`,
  });

  const rows = response.data.values;
  const prefix = 'AVR-';
  let maxNumber = 0;

  if (rows) {
    for (let i = 0; i < rows.length; i++) {
      const id = rows[i][0];
      if (id && typeof id === 'string' && id.startsWith(prefix)) {
        const num = parseInt(id.substring(prefix.length), 10);
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
    }
  }

  return `AVR-${String(maxNumber + 1).padStart(6, '0')}`;
}

// Generate next invitee ID in AVI-NNNNNN format, never resets
async function generateInviteeId(): Promise<string> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Fetch column A of invitees sheet for existing IDs
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${INVITEES_SHEET}!A2:A`,
  });

  const rows = response.data.values;
  const prefix = 'AVI-';
  let maxNumber = 0;

  if (rows) {
    for (let i = 0; i < rows.length; i++) {
      const id = rows[i][0];
      if (id && typeof id === 'string' && id.startsWith(prefix)) {
        const num = parseInt(id.substring(prefix.length), 10);
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
    }
  }

  return `AVI-${String(maxNumber + 1).padStart(6, '0')}`;
}

// ─── Row Parsers ──────────────────────────────────────────────────────────────

// Parse a raw sheet row into an AvailabilityEvent object
function parseEventRow(row: string[], colMap: Record<string, number>): AvailabilityEvent {
  const get = (key: string): string => {
    const col = colMap[key];
    if (col === undefined) {
      return '';
    }
    return row[col] || '';
  };

  return {
    eventId: get('event_id'),
    title: get('title'),
    description: get('description'),
    createdByUsername: get('created_by_username'),
    groupId: get('group_id'),
    type: (get('type') || 'general') as AvailabilityEventType,
    status: (get('status') || 'open') as 'open' | 'closed' | 'concluded' | 'archived',
    showResponsesToRespondents: get('show_responses_to_respondents') === 'Y',
    notifyCreatorOnResponse: get('notify_creator_on_response') === 'Y',
    expiresAt: get('expires_at'),
    concludedSlotId: get('concluded_slot_id'),
    conclusionNote: get('conclusion_note'),
    concludedAt: get('concluded_at'),
    concludedByUsername: get('concluded_by_username'),
    createdAt: get('created_at'),
    updatedAt: get('updated_at'),
  };
}

// Parse a raw sheet row into an AvailabilitySlot object
function parseSlotRow(row: string[], colMap: Record<string, number>): AvailabilitySlot {
  const get = (key: string): string => {
    const col = colMap[key];
    if (col === undefined) {
      return '';
    }
    return row[col] || '';
  };

  const displayOrderStr = get('display_order');
  return {
    slotId: get('slot_id'),
    eventId: get('event_id'),
    slotDatetime: get('slot_datetime'),
    slotLabel: get('slot_label'),
    displayOrder: displayOrderStr ? parseInt(displayOrderStr, 10) : 0,
    createdAt: get('created_at'),
  };
}

// Parse a raw sheet row into an AvailabilityResponseRecord object
function parseResponseRow(row: string[], colMap: Record<string, number>): AvailabilityResponseRecord {
  const get = (key: string): string => {
    const col = colMap[key];
    if (col === undefined) {
      return '';
    }
    return row[col] || '';
  };

  return {
    responseId: get('response_id'),
    eventId: get('event_id'),
    slotId: get('slot_id'),
    respondentType: (get('respondent_type') || 'member') as 'member' | 'visitor',
    userName: get('user_name'),
    visitorName: get('visitor_name'),
    visitorEmail: get('visitor_email'),
    response: (get('response') || 'no') as AvailabilityResponse,
    respondedAt: get('responded_at'),
    updatedAt: get('updated_at'),
    inviteeId: get('invitee_id'),
  };
}

// Parse a raw sheet row into an AvailabilityInvitee object
function parseInviteeRow(row: string[], colMap: Record<string, number>): AvailabilityInvitee {
  const get = (key: string): string => {
    const col = colMap[key];
    if (col === undefined) {
      return '';
    }
    return row[col] || '';
  };

  return {
    inviteeId: get('invitee_id'),
    eventId: get('event_id'),
    groupMemberId: get('group_member_id'),
    inviteeType: (get('invitee_type') || 'member') as 'member' | 'visitor',
    userName: get('user_name'),
    visitorName: get('visitor_name'),
    visitorEmail: get('visitor_email'),
    token: get('token'),
    tokenExpiresAt: get('token_expires_at'),
    notifiedAt: get('notified_at'),
    createdAt: get('created_at'),
  };
}

// ─── Event Functions ───────────────────────────────────────────────────────────

// Fetch all public events (group_id blank, status !== 'archived').
// Resolves hasResponded for the calling user and createdByName.
export async function getPublicEvents(
  callerUserName: string
): Promise<AvailabilityEventSummary[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const eventsColMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);
  const slotsColMap = await getColumnMap(SLOTS_SHEET, spreadsheetId);
  const responsesColMap = await getColumnMap(RESPONSES_SHEET, spreadsheetId);

  // Fetch all events
  const eventsResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: EVENTS_RANGE,
  });

  // Fetch all slots (for counting)
  const slotsResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: SLOTS_RANGE,
  });

  // Fetch all responses (for counting and hasResponded check)
  const responsesResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RESPONSES_RANGE,
  });

  const eventRows = eventsResp.data.values;
  const slotRows = slotsResp.data.values;
  const responseRows = responsesResp.data.values;

  // Build a map of user display names from the Members sheet
  const allUsers = await getAllUsers();
  const userNameToDisplay: Record<string, string> = {};
  for (let i = 0; i < allUsers.length; i++) {
    const u = allUsers[i];
    if (u.userName) {
      userNameToDisplay[u.userName] = u.fullKnownAs || u.fullName || u.userName;
    }
  }

  // Build slot count map: eventId → count
  const slotCountMap: Record<string, number> = {};
  if (slotRows) {
    const eventIdCol = slotsColMap['event_id'];
    if (eventIdCol !== undefined) {
      for (let i = 0; i < slotRows.length; i++) {
        const eid = slotRows[i][eventIdCol];
        if (eid) {
          if (slotCountMap[eid] === undefined) {
            slotCountMap[eid] = 0;
          }
          slotCountMap[eid] = slotCountMap[eid] + 1;
        }
      }
    }
  }

  // Build response count map: eventId → unique respondent count
  // Also build hasResponded map: eventId → boolean (true if callerUserName responded)
  const responseCountMap: Record<string, Set<string>> = {};
  const hasRespondedMap: Record<string, boolean> = {};

  if (responseRows) {
    const eventIdCol = responsesColMap['event_id'];
    const userNameCol = responsesColMap['user_name'];
    const respondentTypeCol = responsesColMap['respondent_type'];
    const visitorEmailCol = responsesColMap['visitor_email'];

    if (eventIdCol !== undefined) {
      for (let i = 0; i < responseRows.length; i++) {
        const row = responseRows[i];
        const eid = row[eventIdCol];
        if (!eid) {
          continue;
        }

        if (responseCountMap[eid] === undefined) {
          responseCountMap[eid] = new Set<string>();
        }

        // Use userName for members, visitorEmail for visitors as unique key
        const respondentType = respondentTypeCol !== undefined ? row[respondentTypeCol] : 'member';
        const uname = userNameCol !== undefined ? row[userNameCol] : '';
        const vemail = visitorEmailCol !== undefined ? row[visitorEmailCol] : '';

        let uniqueKey = '';
        if (respondentType === 'member' && uname) {
          uniqueKey = `member:${uname}`;
          // Check if caller has responded
          if (uname === callerUserName) {
            hasRespondedMap[eid] = true;
          }
        } else if (vemail) {
          uniqueKey = `visitor:${vemail}`;
        }

        if (uniqueKey) {
          responseCountMap[eid].add(uniqueKey);
        }
      }
    }
  }

  const results: AvailabilityEventSummary[] = [];

  if (!eventRows) {
    return results;
  }

  const eventsGroupIdCol = eventsColMap['group_id'];
  const eventsStatusCol = eventsColMap['status'];
  const eventsEventIdCol = eventsColMap['event_id'];

  for (let i = 0; i < eventRows.length; i++) {
    const row = eventRows[i];

    if (eventsEventIdCol === undefined || eventsStatusCol === undefined) {
      continue;
    }

    const status = row[eventsStatusCol] || '';

    // Skip archived events
    if (status === 'archived') {
      continue;
    }

    // Only include public events (group_id is blank)
    const groupId = eventsGroupIdCol !== undefined ? (row[eventsGroupIdCol] || '') : '';
    if (groupId !== '') {
      continue;
    }

    const eventId = row[eventsEventIdCol] || '';
    results.push(buildEventSummary(row, eventsColMap, eventId, userNameToDisplay, slotCountMap, responseCountMap, hasRespondedMap));
  }

  // Sort newest first by createdAt (cast to any because createdAt is not in the summary type)
  results.sort((a, b) => {
    const aCreated = (a as any).createdAt || '';
    const bCreated = (b as any).createdAt || '';
    if (aCreated > bCreated) return -1;
    if (aCreated < bCreated) return 1;
    return 0;
  });

  return results;
}

// Build an event summary object from a raw row plus precomputed maps
function buildEventSummary(
  row: string[],
  colMap: Record<string, number>,
  eventId: string,
  userNameToDisplay: Record<string, string>,
  slotCountMap: Record<string, number>,
  responseCountMap: Record<string, Set<string>>,
  hasRespondedMap: Record<string, boolean>
): AvailabilityEventSummary {
  const get = (key: string): string => {
    const col = colMap[key];
    if (col === undefined) {
      return '';
    }
    return row[col] || '';
  };

  const createdByUsername = get('created_by_username');
  const createdByName = userNameToDisplay[createdByUsername] || createdByUsername;
  const responseSet = responseCountMap[eventId];
  const responseCount = responseSet ? responseSet.size : 0;
  const slotCount = slotCountMap[eventId] !== undefined ? slotCountMap[eventId] : 0;

  return {
    eventId,
    title: get('title'),
    description: get('description'),
    type: (get('type') || 'general') as AvailabilityEventType,
    status: (get('status') || 'open') as 'open' | 'closed' | 'concluded' | 'archived',
    groupId: get('group_id'),
    createdByUsername,
    createdByName,
    expiresAt: get('expires_at'),
    slotCount,
    responseCount,
    hasResponded: hasRespondedMap[eventId] === true,
    concludedSlotLabel: get('conclusion_note'),
    concludedSlotDatetime: get('concluded_at'),
    // Extra field needed for createdAt sorting
    createdAt: get('created_at'),
  } as AvailabilityEventSummary & { createdAt: string };
}

// Fetch all events for a group (status !== 'archived'), newest first.
// Resolves hasResponded for the calling user.
export async function getGroupEvents(
  groupId: string,
  callerUserName: string
): Promise<AvailabilityEventSummary[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const eventsColMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);
  const slotsColMap = await getColumnMap(SLOTS_SHEET, spreadsheetId);
  const responsesColMap = await getColumnMap(RESPONSES_SHEET, spreadsheetId);

  // Fetch all required sheets
  const eventsResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: EVENTS_RANGE,
  });

  const slotsResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: SLOTS_RANGE,
  });

  const responsesResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RESPONSES_RANGE,
  });

  const eventRows = eventsResp.data.values;
  const slotRows = slotsResp.data.values;
  const responseRows = responsesResp.data.values;

  // Get user display names
  const allUsers = await getAllUsers();
  const userNameToDisplay: Record<string, string> = {};
  for (let i = 0; i < allUsers.length; i++) {
    const u = allUsers[i];
    if (u.userName) {
      userNameToDisplay[u.userName] = u.fullKnownAs || u.fullName || u.userName;
    }
  }

  // Build slot count map
  const slotCountMap: Record<string, number> = {};
  if (slotRows) {
    const eventIdCol = slotsColMap['event_id'];
    if (eventIdCol !== undefined) {
      for (let i = 0; i < slotRows.length; i++) {
        const eid = slotRows[i][eventIdCol];
        if (eid) {
          if (slotCountMap[eid] === undefined) {
            slotCountMap[eid] = 0;
          }
          slotCountMap[eid] = slotCountMap[eid] + 1;
        }
      }
    }
  }

  // Build response count and hasResponded maps
  const responseCountMap: Record<string, Set<string>> = {};
  const hasRespondedMap: Record<string, boolean> = {};

  if (responseRows) {
    const eventIdCol = responsesColMap['event_id'];
    const userNameCol = responsesColMap['user_name'];
    const respondentTypeCol = responsesColMap['respondent_type'];
    const visitorEmailCol = responsesColMap['visitor_email'];

    if (eventIdCol !== undefined) {
      for (let i = 0; i < responseRows.length; i++) {
        const row = responseRows[i];
        const eid = row[eventIdCol];
        if (!eid) {
          continue;
        }

        if (responseCountMap[eid] === undefined) {
          responseCountMap[eid] = new Set<string>();
        }

        const respondentType = respondentTypeCol !== undefined ? row[respondentTypeCol] : 'member';
        const uname = userNameCol !== undefined ? row[userNameCol] : '';
        const vemail = visitorEmailCol !== undefined ? row[visitorEmailCol] : '';

        let uniqueKey = '';
        if (respondentType === 'member' && uname) {
          uniqueKey = `member:${uname}`;
          if (uname === callerUserName) {
            hasRespondedMap[eid] = true;
          }
        } else if (vemail) {
          uniqueKey = `visitor:${vemail}`;
        }

        if (uniqueKey) {
          responseCountMap[eid].add(uniqueKey);
        }
      }
    }
  }

  const results: AvailabilityEventSummary[] = [];

  if (!eventRows) {
    return results;
  }

  const eventsGroupIdCol = eventsColMap['group_id'];
  const eventsStatusCol = eventsColMap['status'];
  const eventsEventIdCol = eventsColMap['event_id'];

  for (let i = 0; i < eventRows.length; i++) {
    const row = eventRows[i];

    if (eventsEventIdCol === undefined || eventsStatusCol === undefined) {
      continue;
    }

    const status = row[eventsStatusCol] || '';

    // Skip archived events
    if (status === 'archived') {
      continue;
    }

    // Only include events for this group
    const rowGroupId = eventsGroupIdCol !== undefined ? (row[eventsGroupIdCol] || '') : '';
    if (rowGroupId !== groupId) {
      continue;
    }

    const eventId = row[eventsEventIdCol] || '';
    results.push(buildEventSummary(row, eventsColMap, eventId, userNameToDisplay, slotCountMap, responseCountMap, hasRespondedMap));
  }

  // Sort newest first
  results.sort((a, b) => {
    const aCreated = (a as any).createdAt || '';
    const bCreated = (b as any).createdAt || '';
    if (aCreated > bCreated) return -1;
    if (aCreated < bCreated) return 1;
    return 0;
  });

  return results;
}

// Fetch a single event by eventId. Returns null if not found.
export async function getEventById(eventId: string): Promise<AvailabilityEvent | null> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);

  // Fetch all event rows
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: EVENTS_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    return null;
  }

  const eventIdCol = colMap['event_id'];
  if (eventIdCol === undefined) {
    return null;
  }

  // Search for matching event
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][eventIdCol] === eventId) {
      return parseEventRow(rows[i], colMap);
    }
  }

  return null;
}

// Create a new event. Appends one row to AvailabilityEvents.
// Returns generated eventId.
export async function createEvent(data: {
  title: string;
  description: string;
  createdByUsername: string;
  groupId: string;
  type: AvailabilityEventType;
  showResponsesToRespondents: boolean;
  notifyCreatorOnResponse: boolean;
  expiresAt: string;
}): Promise<string> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);

  // Generate unique event ID
  const eventId = await generateEventId();
  const now = new Date().toISOString();

  // Build the new row
  const maxCol = Math.max(...Object.values(colMap));
  const newRow: string[] = new Array(maxCol + 1).fill('');

  const setCol = (key: string, value: string) => {
    const col = colMap[key];
    if (col !== undefined) {
      newRow[col] = value;
    }
  };

  setCol('event_id', eventId);
  setCol('title', data.title);
  setCol('description', data.description);
  setCol('created_by_username', data.createdByUsername);
  setCol('group_id', data.groupId);
  setCol('type', data.type);
  setCol('status', 'open');
  setCol('show_responses_to_respondents', data.showResponsesToRespondents ? 'Y' : 'N');
  setCol('notify_creator_on_response', data.notifyCreatorOnResponse ? 'Y' : 'N');
  setCol('expires_at', data.expiresAt);
  setCol('concluded_slot_id', '');
  setCol('conclusion_note', '');
  setCol('concluded_at', '');
  setCol('concluded_by_username', '');
  setCol('created_at', now);
  setCol('updated_at', '');

  // Append the new event row
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${EVENTS_SHEET}!A:P`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [newRow] },
  });

  return eventId;
}

// Update event fields. Sets updated_at.
export async function updateEvent(
  eventId: string,
  updates: Partial<Pick<AvailabilityEvent,
    'title' | 'description' | 'type' | 'showResponsesToRespondents' |
    'notifyCreatorOnResponse' | 'expiresAt' | 'status'
  >>
): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);

  // Find the row number for this event
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: EVENTS_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    throw new Error(`Event not found: ${eventId}`);
  }

  let rowNumber = -1;
  const eventIdCol = colMap['event_id'];
  if (eventIdCol === undefined) {
    throw new Error('event_id column not found');
  }

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][eventIdCol] === eventId) {
      rowNumber = i + 2;
      break;
    }
  }

  if (rowNumber === -1) {
    throw new Error(`Event not found: ${eventId}`);
  }

  const now = new Date().toISOString();
  const updateData: Array<{ range: string; values: string[][] }> = [];

  // Map from TypeScript field name to sheet column key
  const fieldMapping: Array<{ field: string; colKey: string; transform?: (v: any) => string }> = [
    { field: 'title', colKey: 'title' },
    { field: 'description', colKey: 'description' },
    { field: 'type', colKey: 'type' },
    { field: 'showResponsesToRespondents', colKey: 'show_responses_to_respondents', transform: (v) => v ? 'Y' : 'N' },
    { field: 'notifyCreatorOnResponse', colKey: 'notify_creator_on_response', transform: (v) => v ? 'Y' : 'N' },
    { field: 'expiresAt', colKey: 'expires_at' },
    { field: 'status', colKey: 'status' },
  ];

  // Build update data array for changed fields
  for (let i = 0; i < fieldMapping.length; i++) {
    const mapping = fieldMapping[i];
    const updatesAny = updates as any;
    if (updatesAny[mapping.field] !== undefined) {
      const col = colMap[mapping.colKey];
      if (col !== undefined) {
        let value = updatesAny[mapping.field];
        if (mapping.transform) {
          value = mapping.transform(value);
        }
        updateData.push({
          range: `${EVENTS_SHEET}!${getColumnLetter(col)}${rowNumber}`,
          values: [[String(value)]],
        });
      }
    }
  }

  // Always update the updated_at timestamp
  const updatedAtCol = colMap['updated_at'];
  if (updatedAtCol !== undefined) {
    updateData.push({
      range: `${EVENTS_SHEET}!${getColumnLetter(updatedAtCol)}${rowNumber}`,
      values: [[now]],
    });
  }

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

// Mark event as concluded. Sets all conclusion-related fields.
export async function concludeEvent(
  eventId: string,
  concludedSlotId: string,
  conclusionNote: string,
  concludedByUsername: string
): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);

  // Find the row number for this event
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: EVENTS_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    throw new Error(`Event not found: ${eventId}`);
  }

  let rowNumber = -1;
  const eventIdCol = colMap['event_id'];
  if (eventIdCol === undefined) {
    throw new Error('event_id column not found');
  }

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][eventIdCol] === eventId) {
      rowNumber = i + 2;
      break;
    }
  }

  if (rowNumber === -1) {
    throw new Error(`Event not found: ${eventId}`);
  }

  const now = new Date().toISOString();
  const updateData: Array<{ range: string; values: string[][] }> = [];

  // Set all conclusion fields
  const conclusionFields: Array<{ colKey: string; value: string }> = [
    { colKey: 'status', value: 'concluded' },
    { colKey: 'concluded_slot_id', value: concludedSlotId },
    { colKey: 'conclusion_note', value: conclusionNote },
    { colKey: 'concluded_at', value: now },
    { colKey: 'concluded_by_username', value: concludedByUsername },
    { colKey: 'updated_at', value: now },
  ];

  for (let i = 0; i < conclusionFields.length; i++) {
    const f = conclusionFields[i];
    const col = colMap[f.colKey];
    if (col !== undefined) {
      updateData.push({
        range: `${EVENTS_SHEET}!${getColumnLetter(col)}${rowNumber}`,
        values: [[f.value]],
      });
    }
  }

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

// Clear conclusion fields when reopening an event.
export async function clearConclusionFields(eventId: string): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);

  // Find the row number for this event
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: EVENTS_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    throw new Error(`Event not found: ${eventId}`);
  }

  let rowNumber = -1;
  const eventIdCol = colMap['event_id'];
  if (eventIdCol === undefined) {
    throw new Error('event_id column not found');
  }

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][eventIdCol] === eventId) {
      rowNumber = i + 2;
      break;
    }
  }

  if (rowNumber === -1) {
    throw new Error(`Event not found: ${eventId}`);
  }

  const now = new Date().toISOString();
  const updateData: Array<{ range: string; values: string[][] }> = [];

  // Clear all conclusion fields
  const fieldsToReset = ['concluded_slot_id', 'conclusion_note', 'concluded_at', 'concluded_by_username'];
  for (let i = 0; i < fieldsToReset.length; i++) {
    const col = colMap[fieldsToReset[i]];
    if (col !== undefined) {
      updateData.push({
        range: `${EVENTS_SHEET}!${getColumnLetter(col)}${rowNumber}`,
        values: [['']],
      });
    }
  }

  // Update the updated_at timestamp
  const updatedAtCol = colMap['updated_at'];
  if (updatedAtCol !== undefined) {
    updateData.push({
      range: `${EVENTS_SHEET}!${getColumnLetter(updatedAtCol)}${rowNumber}`,
      values: [[now]],
    });
  }

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

// Soft-delete. Sets status = 'archived'.
export async function archiveEvent(eventId: string): Promise<void> {
  // Delegate to updateEvent for status change
  await updateEvent(eventId, { status: 'archived' });
}

// ─── Slot Functions ────────────────────────────────────────────────────────────

// Fetch all slots for an event, ordered by display_order ascending.
export async function getSlotsForEvent(eventId: string): Promise<AvailabilitySlot[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(SLOTS_SHEET, spreadsheetId);

  // Fetch all slot rows
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: SLOTS_RANGE,
  });

  const rows = response.data.values;
  const results: AvailabilitySlot[] = [];

  if (!rows) {
    return results;
  }

  const eventIdCol = colMap['event_id'];
  if (eventIdCol === undefined) {
    return results;
  }

  // Filter slots belonging to this event
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row[eventIdCol] === eventId) {
      results.push(parseSlotRow(row, colMap));
    }
  }

  // Sort by display_order ascending
  results.sort((a, b) => a.displayOrder - b.displayOrder);

  return results;
}

// Append one slot. Returns generated slotId.
export async function addSlot(
  eventId: string,
  slotDatetime: string,
  slotLabel: string,
  displayOrder: number
): Promise<string> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(SLOTS_SHEET, spreadsheetId);

  // Generate unique slot ID
  const slotId = await generateSlotId();
  const now = new Date().toISOString();

  // Build the new row
  const maxCol = Math.max(...Object.values(colMap));
  const newRow: string[] = new Array(maxCol + 1).fill('');

  const setCol = (key: string, value: string) => {
    const col = colMap[key];
    if (col !== undefined) {
      newRow[col] = value;
    }
  };

  setCol('slot_id', slotId);
  setCol('event_id', eventId);
  setCol('slot_datetime', slotDatetime);
  setCol('slot_label', slotLabel);
  setCol('display_order', String(displayOrder));
  setCol('created_at', now);

  // Append the new slot row
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SLOTS_SHEET}!A:F`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [newRow] },
  });

  return slotId;
}

// Delete a slot. Also cascades: deletes all responses with matching slot_id.
export async function deleteSlot(slotId: string): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Get sheet metadata to find sheet IDs for deleteDimension requests
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetsData = spreadsheet.data.sheets;
  if (!sheetsData) {
    throw new Error('Could not fetch spreadsheet metadata');
  }

  // Find sheet IDs for both Slots and Responses sheets
  let slotsSheetId: number | null = null;
  let responsesSheetId: number | null = null;

  for (let i = 0; i < sheetsData.length; i++) {
    const s = sheetsData[i];
    if (s.properties && s.properties.title === SLOTS_SHEET) {
      if (s.properties.sheetId !== undefined && s.properties.sheetId !== null) {
        slotsSheetId = s.properties.sheetId;
      }
    }
    if (s.properties && s.properties.title === RESPONSES_SHEET) {
      if (s.properties.sheetId !== undefined && s.properties.sheetId !== null) {
        responsesSheetId = s.properties.sheetId;
      }
    }
  }

  if (slotsSheetId === null) {
    throw new Error(`${SLOTS_SHEET} sheet not found`);
  }

  // Fetch slots to find the row number for this slot
  const slotsColMap = await getColumnMap(SLOTS_SHEET, spreadsheetId);
  const slotsResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: SLOTS_RANGE,
  });

  const slotRows = slotsResp.data.values;
  let slotRowNumber = -1;

  if (slotRows) {
    const slotIdCol = slotsColMap['slot_id'];
    if (slotIdCol !== undefined) {
      for (let i = 0; i < slotRows.length; i++) {
        if (slotRows[i][slotIdCol] === slotId) {
          slotRowNumber = i + 2;
          break;
        }
      }
    }
  }

  if (slotRowNumber === -1) {
    throw new Error(`Slot not found: ${slotId}`);
  }

  // Find all response rows that reference this slot (for cascade delete)
  const responsesColMap = await getColumnMap(RESPONSES_SHEET, spreadsheetId);
  const responsesResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RESPONSES_RANGE,
  });

  const responseRows = responsesResp.data.values;
  const responseRowNumbers: number[] = [];

  if (responseRows && responsesSheetId !== null) {
    const slotIdCol = responsesColMap['slot_id'];
    if (slotIdCol !== undefined) {
      for (let i = 0; i < responseRows.length; i++) {
        if (responseRows[i][slotIdCol] === slotId) {
          // Row number is 1-based: data starts at row 2
          responseRowNumbers.push(i + 2);
        }
      }
    }
  }

  // Delete response rows in reverse order to preserve row indices during deletion
  if (responsesSheetId !== null && responseRowNumbers.length > 0) {
    // Reverse sort so we delete from the bottom up
    responseRowNumbers.sort((a, b) => b - a);

    for (let i = 0; i < responseRowNumbers.length; i++) {
      const rn = responseRowNumbers[i];
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: responsesSheetId,
                  dimension: 'ROWS',
                  startIndex: rn - 1,
                  endIndex: rn,
                },
              },
            },
          ],
        },
      });
    }
  }

  // Now delete the slot row itself
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: slotsSheetId,
              dimension: 'ROWS',
              startIndex: slotRowNumber - 1,
              endIndex: slotRowNumber,
            },
          },
        },
      ],
    },
  });
}

// ─── Response Functions ────────────────────────────────────────────────────────

// Fetch all responses for an event.
export async function getResponsesForEvent(
  eventId: string
): Promise<AvailabilityResponseRecord[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(RESPONSES_SHEET, spreadsheetId);

  // Fetch all response rows
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RESPONSES_RANGE,
  });

  const rows = response.data.values;
  const results: AvailabilityResponseRecord[] = [];

  if (!rows) {
    return results;
  }

  const eventIdCol = colMap['event_id'];
  if (eventIdCol === undefined) {
    return results;
  }

  // Filter responses for this event
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row[eventIdCol] === eventId) {
      results.push(parseResponseRow(row, colMap));
    }
  }

  return results;
}

// Upsert a member's response for a slot.
// Match on (event_id, slot_id, user_name). Update if exists, insert if not.
export async function upsertMemberResponse(
  eventId: string,
  slotId: string,
  userName: string,
  response: AvailabilityResponse
): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(RESPONSES_SHEET, spreadsheetId);

  // Fetch all response rows to check if this member has already responded to this slot
  const existingResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RESPONSES_RANGE,
  });

  const rows = existingResp.data.values;
  const now = new Date().toISOString();

  const eventIdCol = colMap['event_id'];
  const slotIdCol = colMap['slot_id'];
  const userNameCol = colMap['user_name'];
  const respondentTypeCol = colMap['respondent_type'];
  const responseCol = colMap['response'];
  const updatedAtCol = colMap['updated_at'];

  if (eventIdCol === undefined || slotIdCol === undefined || userNameCol === undefined) {
    throw new Error('Required columns not found in AvailabilityResponses sheet');
  }

  // Look for an existing response row for this event/slot/user combination
  let existingRowNumber = -1;

  if (rows) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowEventId = row[eventIdCol];
      const rowSlotId = row[slotIdCol];
      const rowUserName = row[userNameCol];
      const rowType = respondentTypeCol !== undefined ? row[respondentTypeCol] : 'member';

      if (rowEventId === eventId && rowSlotId === slotId && rowType === 'member' && rowUserName === userName) {
        existingRowNumber = i + 2;
        break;
      }
    }
  }

  if (existingRowNumber !== -1) {
    // Update existing response
    const updateData: Array<{ range: string; values: string[][] }> = [];

    if (responseCol !== undefined) {
      updateData.push({
        range: `${RESPONSES_SHEET}!${getColumnLetter(responseCol)}${existingRowNumber}`,
        values: [[response]],
      });
    }

    if (updatedAtCol !== undefined) {
      updateData.push({
        range: `${RESPONSES_SHEET}!${getColumnLetter(updatedAtCol)}${existingRowNumber}`,
        values: [[now]],
      });
    }

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          data: updateData,
          valueInputOption: 'USER_ENTERED',
        },
      });
    }
  } else {
    // Insert new response row
    const responseId = await generateResponseId();
    const maxCol = Math.max(...Object.values(colMap));
    const newRow: string[] = new Array(maxCol + 1).fill('');

    const setCol = (key: string, value: string) => {
      const col = colMap[key];
      if (col !== undefined) {
        newRow[col] = value;
      }
    };

    setCol('response_id', responseId);
    setCol('event_id', eventId);
    setCol('slot_id', slotId);
    setCol('respondent_type', 'member');
    setCol('user_name', userName);
    setCol('visitor_name', '');
    setCol('visitor_email', '');
    setCol('response', response);
    setCol('responded_at', now);
    setCol('updated_at', '');
    setCol('invitee_id', '');

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${RESPONSES_SHEET}!A:K`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });
  }
}

// Upsert a visitor's response. Matches on (event_id, slot_id, invitee_id).
export async function upsertVisitorResponse(
  eventId: string,
  slotId: string,
  inviteeId: string,
  visitorName: string,
  visitorEmail: string,
  response: AvailabilityResponse
): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(RESPONSES_SHEET, spreadsheetId);

  // Fetch all response rows to check if this visitor has already responded to this slot
  const existingResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RESPONSES_RANGE,
  });

  const rows = existingResp.data.values;
  const now = new Date().toISOString();

  const eventIdCol = colMap['event_id'];
  const slotIdCol = colMap['slot_id'];
  const inviteeIdCol = colMap['invitee_id'];
  const respondentTypeCol = colMap['respondent_type'];
  const responseCol = colMap['response'];
  const updatedAtCol = colMap['updated_at'];

  if (eventIdCol === undefined || slotIdCol === undefined || inviteeIdCol === undefined) {
    throw new Error('Required columns not found in AvailabilityResponses sheet');
  }

  // Look for existing visitor response for this event/slot/invitee combination
  let existingRowNumber = -1;

  if (rows) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowEventId = row[eventIdCol];
      const rowSlotId = row[slotIdCol];
      const rowInviteeId = row[inviteeIdCol];
      const rowType = respondentTypeCol !== undefined ? row[respondentTypeCol] : 'member';

      if (rowEventId === eventId && rowSlotId === slotId && rowType === 'visitor' && rowInviteeId === inviteeId) {
        existingRowNumber = i + 2;
        break;
      }
    }
  }

  if (existingRowNumber !== -1) {
    // Update the existing visitor response
    const updateData: Array<{ range: string; values: string[][] }> = [];

    if (responseCol !== undefined) {
      updateData.push({
        range: `${RESPONSES_SHEET}!${getColumnLetter(responseCol)}${existingRowNumber}`,
        values: [[response]],
      });
    }

    if (updatedAtCol !== undefined) {
      updateData.push({
        range: `${RESPONSES_SHEET}!${getColumnLetter(updatedAtCol)}${existingRowNumber}`,
        values: [[now]],
      });
    }

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          data: updateData,
          valueInputOption: 'USER_ENTERED',
        },
      });
    }
  } else {
    // Insert new visitor response row
    const responseId = await generateResponseId();
    const maxCol = Math.max(...Object.values(colMap));
    const newRow: string[] = new Array(maxCol + 1).fill('');

    const setCol = (key: string, value: string) => {
      const col = colMap[key];
      if (col !== undefined) {
        newRow[col] = value;
      }
    };

    setCol('response_id', responseId);
    setCol('event_id', eventId);
    setCol('slot_id', slotId);
    setCol('respondent_type', 'visitor');
    setCol('user_name', '');
    setCol('visitor_name', visitorName);
    setCol('visitor_email', visitorEmail);
    setCol('response', response);
    setCol('responded_at', now);
    setCol('updated_at', '');
    setCol('invitee_id', inviteeId);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${RESPONSES_SHEET}!A:K`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });
  }
}

// ─── Invitee Functions ─────────────────────────────────────────────────────────

// Fetch all invitees for an event.
export async function getInviteesForEvent(
  eventId: string
): Promise<AvailabilityInvitee[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(INVITEES_SHEET, spreadsheetId);

  // Fetch all invitee rows
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: INVITEES_RANGE,
  });

  const rows = response.data.values;
  const results: AvailabilityInvitee[] = [];

  if (!rows) {
    return results;
  }

  const eventIdCol = colMap['event_id'];
  if (eventIdCol === undefined) {
    return results;
  }

  // Filter invitees for this event
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row[eventIdCol] === eventId) {
      results.push(parseInviteeRow(row, colMap));
    }
  }

  return results;
}

// Create invitee records from a list of group members.
// For member-type: creates row with no token.
// For visitor-type: generates 64-char hex token, sets token and token_expires_at.
// Returns the list of created invitee records.
export async function createInviteesFromGroupMembers(
  eventId: string,
  tokenExpiresAt: string,
  groupMembers: AvailabilityGroupMember[]
): Promise<AvailabilityInvitee[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(INVITEES_SHEET, spreadsheetId);

  const createdInvitees: AvailabilityInvitee[] = [];
  const now = new Date().toISOString();

  const maxCol = Math.max(...Object.values(colMap));

  // Helper to build and append an invitee row
  const appendInviteeRow = async (invitee: AvailabilityInvitee): Promise<void> => {
    const newRow: string[] = new Array(maxCol + 1).fill('');
    const setCol = (key: string, value: string) => {
      const col = colMap[key];
      if (col !== undefined) {
        newRow[col] = value;
      }
    };

    setCol('invitee_id', invitee.inviteeId);
    setCol('event_id', invitee.eventId);
    setCol('group_member_id', invitee.groupMemberId);
    setCol('invitee_type', invitee.inviteeType);
    setCol('user_name', invitee.userName);
    setCol('visitor_name', invitee.visitorName);
    setCol('visitor_email', invitee.visitorEmail);
    setCol('token', invitee.token);
    setCol('token_expires_at', invitee.tokenExpiresAt);
    setCol('notified_at', invitee.notifiedAt);
    setCol('created_at', invitee.createdAt);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${INVITEES_SHEET}!A:K`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });
  };

  // Process each group member sequentially to avoid parallel Sheets calls
  for (let i = 0; i < groupMembers.length; i++) {
    const member = groupMembers[i];
    const inviteeId = await generateInviteeId();

    let token = '';
    let tokenExp = '';

    // Visitor-type invitees get a unique 64-char hex token
    if (member.memberType === 'visitor') {
      // Generate 32 random bytes = 64 hex characters
      token = crypto.randomBytes(32).toString('hex');
      tokenExp = tokenExpiresAt;
    }

    const invitee: AvailabilityInvitee = {
      inviteeId,
      eventId,
      groupMemberId: member.memberId,
      inviteeType: member.memberType,
      userName: member.userName,
      visitorName: member.visitorName,
      visitorEmail: member.visitorEmail,
      token,
      tokenExpiresAt: tokenExp,
      notifiedAt: '',
      createdAt: now,
    };

    // Append to sheet sequentially
    await appendInviteeRow(invitee);
    createdInvitees.push(invitee);
  }

  return createdInvitees;
}

// Validate a visitor token. Returns matching invitee or null.
// Checks: token exists in sheet, event_id matches, token_expires_at not passed.
export async function validateVisitorToken(
  eventId: string,
  token: string
): Promise<AvailabilityInvitee | null> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(INVITEES_SHEET, spreadsheetId);

  // Fetch all invitee rows
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: INVITEES_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    return null;
  }

  const eventIdCol = colMap['event_id'];
  const tokenCol = colMap['token'];
  const tokenExpiresAtCol = colMap['token_expires_at'];

  if (eventIdCol === undefined || tokenCol === undefined) {
    return null;
  }

  const now = new Date();

  // Search for a matching token
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowEventId = row[eventIdCol];
    const rowToken = row[tokenCol];

    // Check event ID and token match
    if (rowEventId !== eventId || rowToken !== token) {
      continue;
    }

    // Check token expiry
    if (tokenExpiresAtCol !== undefined) {
      const expiresAt = row[tokenExpiresAtCol];
      if (expiresAt && new Date(expiresAt) < now) {
        // Token has expired
        return null;
      }
    }

    // Token is valid
    return parseInviteeRow(row, colMap);
  }

  return null;
}

// Mark invitees as notified by setting notified_at to current ISO timestamp.
export async function markInviteesNotified(inviteeIds: string[]): Promise<void> {
  if (inviteeIds.length === 0) {
    return;
  }

  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(INVITEES_SHEET, spreadsheetId);

  // Fetch all invitee rows to find row numbers for the given IDs
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: INVITEES_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    return;
  }

  const inviteeIdCol = colMap['invitee_id'];
  const notifiedAtCol = colMap['notified_at'];

  if (inviteeIdCol === undefined || notifiedAtCol === undefined) {
    return;
  }

  const now = new Date().toISOString();
  const updateData: Array<{ range: string; values: string[][] }> = [];

  // Build set of IDs to update for fast lookup
  const idsToNotify = new Set<string>(inviteeIds);

  // Find row numbers for matching invitees
  for (let i = 0; i < rows.length; i++) {
    const inviteeId = rows[i][inviteeIdCol];
    if (inviteeId && idsToNotify.has(inviteeId)) {
      const rowNumber = i + 2;
      updateData.push({
        range: `${INVITEES_SHEET}!${getColumnLetter(notifiedAtCol)}${rowNumber}`,
        values: [[now]],
      });
    }
  }

  // Execute batch update for all notified invitees at once
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

// Check whether a member is an invitee for a specific event.
export async function isMemberInvitee(
  eventId: string,
  userName: string
): Promise<boolean> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(INVITEES_SHEET, spreadsheetId);

  // Fetch all invitee rows
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: INVITEES_RANGE,
  });

  const rows = response.data.values;
  if (!rows) {
    return false;
  }

  const eventIdCol = colMap['event_id'];
  const userNameCol = colMap['user_name'];
  const inviteeTypeCol = colMap['invitee_type'];

  if (eventIdCol === undefined || userNameCol === undefined) {
    return false;
  }

  // Search for a matching member invitee
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowType = inviteeTypeCol !== undefined ? row[inviteeTypeCol] : 'member';
    if (row[eventIdCol] === eventId && rowType === 'member' && row[userNameCol] === userName) {
      return true;
    }
  }

  return false;
}

// ─── Composite Read Functions ──────────────────────────────────────────────────

// Build AvailabilityEventDetail for the member response page.
export async function getEventDetailForMember(
  eventId: string,
  callerUserName: string
): Promise<AvailabilityEventDetail | null> {
  // Fetch the event
  const event = await getEventById(eventId);
  if (!event) {
    return null;
  }

  // Fetch slots for this event
  const slots = await getSlotsForEvent(eventId);

  // Fetch all responses for this event
  const allResponseRecords = await getResponsesForEvent(eventId);

  // Build caller's own response map: slotId → response
  const myResponses: Record<string, AvailabilityResponse> = {};
  for (let i = 0; i < allResponseRecords.length; i++) {
    const rec = allResponseRecords[i];
    if (rec.respondentType === 'member' && rec.userName === callerUserName) {
      myResponses[rec.slotId] = rec.response;
    }
  }

  // Determine whether to include other respondents' responses
  const isCreator = event.createdByUsername === callerUserName;
  const showAll = event.showResponsesToRespondents || isCreator;

  let allResponses: AvailabilityParticipantResponses[] = [];

  if (showAll) {
    // Get display names for member respondents
    const allUsers = await getAllUsers();
    const userNameToDisplay: Record<string, string> = {};
    for (let i = 0; i < allUsers.length; i++) {
      const u = allUsers[i];
      if (u.userName) {
        userNameToDisplay[u.userName] = u.fullKnownAs || u.fullName || u.userName;
      }
    }

    // Group responses by respondent
    const participantMap: Record<string, AvailabilityParticipantResponses> = {};

    for (let i = 0; i < allResponseRecords.length; i++) {
      const rec = allResponseRecords[i];

      // Build a unique key per participant
      let participantKey = '';
      let displayName = '';

      if (rec.respondentType === 'member') {
        participantKey = `member:${rec.userName}`;
        displayName = userNameToDisplay[rec.userName] || rec.userName;
      } else {
        participantKey = `visitor:${rec.visitorEmail}`;
        displayName = rec.visitorName || rec.visitorEmail;
      }

      if (!participantMap[participantKey]) {
        participantMap[participantKey] = {
          displayName,
          respondentType: rec.respondentType,
          responses: {},
        };
      }

      participantMap[participantKey].responses[rec.slotId] = rec.response;
    }

    // Convert to array, putting the caller first
    const keys = Object.keys(participantMap);
    const callerKey = `member:${callerUserName}`;

    // Start with caller's entry if it exists
    if (participantMap[callerKey]) {
      allResponses.push(participantMap[callerKey]);
    }

    // Add remaining participants
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== callerKey) {
        allResponses.push(participantMap[keys[i]]);
      }
    }
  }

  // Find the concluded slot if the event is concluded
  let concludedSlot: AvailabilitySlot | null = null;
  if (event.concludedSlotId) {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].slotId === event.concludedSlotId) {
        concludedSlot = slots[i];
        break;
      }
    }
  }

  return {
    event,
    slots,
    myResponses,
    allResponses,
    concludedSlot,
  };
}

// Build AvailabilityManageDetail for the manage page.
// Always returns full response grid regardless of show_responses_to_respondents.
export async function getEventManageDetail(
  eventId: string
): Promise<AvailabilityManageDetail | null> {
  // Fetch the event
  const event = await getEventById(eventId);
  if (!event) {
    return null;
  }

  // Fetch slots for this event
  const slots = await getSlotsForEvent(eventId);

  // Fetch all responses for this event
  const allResponseRecords = await getResponsesForEvent(eventId);

  // Fetch all invitees for this event
  const invitees = await getInviteesForEvent(eventId);

  // Get display names for member respondents and invitees
  const allUsers = await getAllUsers();
  const userNameToDisplay: Record<string, string> = {};
  for (let i = 0; i < allUsers.length; i++) {
    const u = allUsers[i];
    if (u.userName) {
      userNameToDisplay[u.userName] = u.fullKnownAs || u.fullName || u.userName;
    }
  }

  // Build invitee display names map (only for member-type invitees)
  const inviteeDisplayNames: Record<string, string> = {};
  for (let i = 0; i < invitees.length; i++) {
    const inv = invitees[i];
    if (inv.inviteeType === 'member' && inv.userName) {
      inviteeDisplayNames[inv.userName] = userNameToDisplay[inv.userName] || inv.userName;
    }
  }

  // Group all responses by participant
  const participantMap: Record<string, AvailabilityParticipantResponses> = {};

  for (let i = 0; i < allResponseRecords.length; i++) {
    const rec = allResponseRecords[i];

    let participantKey = '';
    let displayName = '';

    if (rec.respondentType === 'member') {
      participantKey = `member:${rec.userName}`;
      displayName = userNameToDisplay[rec.userName] || rec.userName;
    } else {
      participantKey = `visitor:${rec.visitorEmail}`;
      displayName = rec.visitorName || rec.visitorEmail;
    }

    if (!participantMap[participantKey]) {
      participantMap[participantKey] = {
        displayName,
        respondentType: rec.respondentType,
        responses: {},
      };
    }

    participantMap[participantKey].responses[rec.slotId] = rec.response;
  }

  const allResponses = Object.values(participantMap);

  // Build per-slot response summary
  const responseSummary: Array<{
    slotId: string;
    yesCount: number;
    maybeCount: number;
    noCount: number;
  }> = [];

  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si];
    let yesCount = 0;
    let maybeCount = 0;
    let noCount = 0;

    // Count responses for this slot
    for (let ri = 0; ri < allResponseRecords.length; ri++) {
      const rec = allResponseRecords[ri];
      if (rec.slotId === slot.slotId) {
        if (rec.response === 'yes') {
          yesCount = yesCount + 1;
        } else if (rec.response === 'maybe') {
          maybeCount = maybeCount + 1;
        } else if (rec.response === 'no') {
          noCount = noCount + 1;
        }
      }
    }

    responseSummary.push({ slotId: slot.slotId, yesCount, maybeCount, noCount });
  }

  return {
    event,
    slots,
    allResponses,
    responseSummary,
    invitees,
    inviteeDisplayNames,
  };
}

// Build response detail for the guest token page.
// Validates token. Returns null if invalid or expired.
export async function getEventDetailForVisitor(
  eventId: string,
  token: string
): Promise<{
  event: AvailabilityEvent;
  slots: AvailabilitySlot[];
  invitee: AvailabilityInvitee;
  myResponses: Record<string, AvailabilityResponse>;
  allResponses: AvailabilityParticipantResponses[];
  concludedSlot: AvailabilitySlot | null;
} | null> {
  // Validate the visitor token first
  const invitee = await validateVisitorToken(eventId, token);
  if (!invitee) {
    return null;
  }

  // Fetch the event
  const event = await getEventById(eventId);
  if (!event) {
    return null;
  }

  // Fetch slots for this event
  const slots = await getSlotsForEvent(eventId);

  // Fetch all responses for this event
  const allResponseRecords = await getResponsesForEvent(eventId);

  // Build visitor's own response map using inviteeId as the key
  const myResponses: Record<string, AvailabilityResponse> = {};
  for (let i = 0; i < allResponseRecords.length; i++) {
    const rec = allResponseRecords[i];
    if (rec.respondentType === 'visitor' && rec.inviteeId === invitee.inviteeId) {
      myResponses[rec.slotId] = rec.response;
    }
  }

  // Build allResponses based on showResponsesToRespondents
  let allResponses: AvailabilityParticipantResponses[] = [];

  if (event.showResponsesToRespondents) {
    // Get display names for member respondents
    const allUsers = await getAllUsers();
    const userNameToDisplay: Record<string, string> = {};
    for (let i = 0; i < allUsers.length; i++) {
      const u = allUsers[i];
      if (u.userName) {
        userNameToDisplay[u.userName] = u.fullKnownAs || u.fullName || u.userName;
      }
    }

    const participantMap: Record<string, AvailabilityParticipantResponses> = {};

    for (let i = 0; i < allResponseRecords.length; i++) {
      const rec = allResponseRecords[i];

      let participantKey = '';
      let displayName = '';

      if (rec.respondentType === 'member') {
        participantKey = `member:${rec.userName}`;
        displayName = userNameToDisplay[rec.userName] || rec.userName;
      } else {
        participantKey = `visitor:${rec.visitorEmail}`;
        displayName = rec.visitorName || rec.visitorEmail;
      }

      if (!participantMap[participantKey]) {
        participantMap[participantKey] = {
          displayName,
          respondentType: rec.respondentType,
          responses: {},
        };
      }

      participantMap[participantKey].responses[rec.slotId] = rec.response;
    }

    allResponses = Object.values(participantMap);
  }

  // Find the concluded slot if the event is concluded
  let concludedSlot: AvailabilitySlot | null = null;
  if (event.concludedSlotId) {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].slotId === event.concludedSlotId) {
        concludedSlot = slots[i];
        break;
      }
    }
  }

  return {
    event,
    slots,
    invitee,
    myResponses,
    allResponses,
    concludedSlot,
  };
}
