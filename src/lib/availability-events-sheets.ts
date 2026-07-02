// src/lib/availability-events-sheets.ts
// Google Sheets data layer for Availability Planner v2 — Events, Slots, Responses.
// Handles CRUD for the AvailabilityEvents, AvailabilitySlots and AvailabilityResponses
// sheets. There is no invitees sheet — the roster is the group's members (see
// availability-groups-sheets.ts), and each member carries a response token.

import crypto from 'crypto';
import {
  getColumnMap,
  getColumnLetter,
  getGoogleSheetsClient,
  getAllUsers,
  getUserByUsername,
} from './sheets';
import type { User } from './sheets';
import { disambiguateDisplayNames } from './display-name-utils';
import {
  getGroupById,
  canManageGroupMembers,
  getGroupMembers,
  getGroupMemberByToken,
  ensureGroupMemberTokens,
} from './availability-groups-sheets';
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
  AvailabilitySlotType,
  AvailabilityGroupMember,
  OpenPollSummary,
} from '@/types/availability';

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENTS_SHEET = 'AvailabilityEvents';
const SLOTS_SHEET = 'AvailabilitySlots';
const RESPONSES_SHEET = 'AvailabilityResponses';

const EVENTS_RANGE = `${EVENTS_SHEET}!A2:V`;
const SLOTS_RANGE = `${SLOTS_SHEET}!A2:F`;
const RESPONSES_RANGE = `${RESPONSES_SHEET}!A2:K`;

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
    slotType: (get('slot_type') || 'datetime') as AvailabilitySlotType,
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
    matchFinder: get('is_match_finder') === 'Y',
    offeredSlotIds: (get('offered_slot_ids') || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
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
  const rawDatetime = get('slot_datetime');
  return {
    slotId: get('slot_id'),
    eventId: get('event_id'),
    slotDatetime: rawDatetime || null,
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

// ─── Event Functions ───────────────────────────────────────────────────────────

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
  slotType: AvailabilitySlotType;
  showResponsesToRespondents: boolean;
  notifyCreatorOnResponse: boolean;
  expiresAt: string;
  matchFinder?: boolean;
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
  setCol('slot_type', data.slotType || 'datetime');
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
  setCol('is_match_finder', data.matchFinder ? 'Y' : '');
  setCol('offered_slot_ids', '');

  // Append the new event row
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${EVENTS_SHEET}!A:V`,
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

// Persist the organiser's chosen "offered" slots for a match-finder event.
// Writes the slotIds as a comma-separated list into the offered_slot_ids column.
export async function setOfferedSlots(eventId: string, slotIds: string[]): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);

  const offeredCol = colMap['offered_slot_ids'];
  if (offeredCol === undefined) {
    throw new Error('offered_slot_ids column not found in AvailabilityEvents sheet');
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: EVENTS_RANGE,
  });
  const rows = response.data.values;
  if (!rows) {
    throw new Error(`Event not found: ${eventId}`);
  }

  const eventIdCol = colMap['event_id'];
  if (eventIdCol === undefined) {
    throw new Error('event_id column not found');
  }

  let rowNumber = -1;
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
  const updateData: Array<{ range: string; values: string[][] }> = [
    {
      range: `${EVENTS_SHEET}!${getColumnLetter(offeredCol)}${rowNumber}`,
      values: [[slotIds.join(',')]],
    },
  ];

  const updatedAtCol = colMap['updated_at'];
  if (updatedAtCol !== undefined) {
    updateData.push({
      range: `${EVENTS_SHEET}!${getColumnLetter(updatedAtCol)}${rowNumber}`,
      values: [[now]],
    });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { data: updateData, valueInputOption: 'USER_ENTERED' },
  });
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
// slotDatetime may be null for text-type poll options.
export async function addSlot(
  eventId: string,
  slotDatetime: string | null,
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
  setCol('slot_datetime', slotDatetime || '');
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

// Append MANY slots in a single Sheets call. Use this when creating a poll's slots — calling
// addSlot in a loop does one column read + one append PER slot, which blows the write quota
// for date-finder polls (dates × times can be 20+ slots). This reads the max slot ID once,
// assigns sequential IDs locally, then appends every row in one request.
export async function addSlots(
  eventId: string,
  slots: Array<{ slotDatetime: string | null; slotLabel: string; displayOrder: number }>
): Promise<void> {
  if (slots.length === 0) {
    return;
  }

  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(SLOTS_SHEET, spreadsheetId);

  // Read existing slot IDs ONCE to find the current max sequence number
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

  const now = new Date().toISOString();
  const maxCol = Math.max(...Object.values(colMap));

  // Build every slot row, assigning IDs sequentially from the max
  const values: string[][] = [];
  for (let i = 0; i < slots.length; i++) {
    const slotId = `AVS-${String(maxNumber + 1 + i).padStart(6, '0')}`;
    const newRow: string[] = new Array(maxCol + 1).fill('');
    const setCol = (key: string, value: string) => {
      const col = colMap[key];
      if (col !== undefined) {
        newRow[col] = value;
      }
    };
    setCol('slot_id', slotId);
    setCol('event_id', eventId);
    setCol('slot_datetime', slots[i].slotDatetime || '');
    setCol('slot_label', slots[i].slotLabel);
    setCol('display_order', String(slots[i].displayOrder));
    setCol('created_at', now);
    values.push(newRow);
  }

  // Single append for all rows
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SLOTS_SHEET}!A:F`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

// Update an existing slot's datetime and/or label. Sets no updated_at (slots sheet has none).
export async function updateSlot(
  slotId: string,
  slotDatetime: string | null,
  slotLabel: string
): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(SLOTS_SHEET, spreadsheetId);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: SLOTS_RANGE,
  });

  const rows = response.data.values;
  if (!rows) throw new Error(`Slot not found: ${slotId}`);

  const slotIdCol = colMap['slot_id'];
  if (slotIdCol === undefined) throw new Error('slot_id column not found');

  let rowNumber = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][slotIdCol] === slotId) {
      rowNumber = i + 2;
      break;
    }
  }
  if (rowNumber === -1) throw new Error(`Slot not found: ${slotId}`);

  const updateData: Array<{ range: string; values: string[][] }> = [];

  const datetimeCol = colMap['slot_datetime'];
  if (datetimeCol !== undefined) {
    updateData.push({
      range: `${SLOTS_SHEET}!${getColumnLetter(datetimeCol)}${rowNumber}`,
      values: [[slotDatetime || '']],
    });
  }
  const labelCol = colMap['slot_label'];
  if (labelCol !== undefined) {
    updateData.push({
      range: `${SLOTS_SHEET}!${getColumnLetter(labelCol)}${rowNumber}`,
      values: [[slotLabel]],
    });
  }

  if (updateData.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { data: updateData, valueInputOption: 'USER_ENTERED' },
    });
  }
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

// Delete a member's response for a slot (used to clear/unset a previously-saved choice).
// Matches on (event_id, slot_id, user_name, respondent_type = member). No-op if not found.
export async function deleteMemberResponse(
  eventId: string,
  slotId: string,
  userName: string
): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(RESPONSES_SHEET, spreadsheetId);

  // Need the sheetId for a deleteDimension request
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetsData = spreadsheet.data.sheets;
  if (!sheetsData) {
    throw new Error('Could not fetch spreadsheet metadata');
  }

  let responsesSheetId: number | null = null;
  for (let i = 0; i < sheetsData.length; i++) {
    const s = sheetsData[i];
    if (s.properties && s.properties.title === RESPONSES_SHEET) {
      if (s.properties.sheetId !== undefined && s.properties.sheetId !== null) {
        responsesSheetId = s.properties.sheetId;
      }
    }
  }
  if (responsesSheetId === null) {
    throw new Error(`${RESPONSES_SHEET} sheet not found`);
  }

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RESPONSES_RANGE,
  });
  const rows = resp.data.values;
  if (!rows) {
    return;
  }

  const eventIdCol = colMap['event_id'];
  const slotIdCol = colMap['slot_id'];
  const userNameCol = colMap['user_name'];
  const respondentTypeCol = colMap['respondent_type'];

  if (eventIdCol === undefined || slotIdCol === undefined || userNameCol === undefined) {
    throw new Error('Required columns not found in AvailabilityResponses sheet');
  }

  let rowNumber = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowType = respondentTypeCol !== undefined ? row[respondentTypeCol] : 'member';
    if (row[eventIdCol] === eventId && row[slotIdCol] === slotId && rowType === 'member' && row[userNameCol] === userName) {
      rowNumber = i + 2;
      break;
    }
  }

  // Nothing saved for this slot — nothing to clear
  if (rowNumber === -1) {
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: responsesSheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });
}

// Delete a visitor's saved response for one slot. Matches on
// (event_id, slot_id, respondent_type='visitor', visitor_email). No-op if not found.
export async function deleteVisitorResponse(
  eventId: string,
  slotId: string,
  visitorEmail: string
): Promise<void> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(RESPONSES_SHEET, spreadsheetId);

  // Need the sheetId for a deleteDimension request
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetsData = spreadsheet.data.sheets;
  if (!sheetsData) {
    throw new Error('Could not fetch spreadsheet metadata');
  }

  let responsesSheetId: number | null = null;
  for (let i = 0; i < sheetsData.length; i++) {
    const s = sheetsData[i];
    if (s.properties && s.properties.title === RESPONSES_SHEET) {
      if (s.properties.sheetId !== undefined && s.properties.sheetId !== null) {
        responsesSheetId = s.properties.sheetId;
      }
    }
  }
  if (responsesSheetId === null) {
    throw new Error(`${RESPONSES_SHEET} sheet not found`);
  }

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RESPONSES_RANGE,
  });
  const rows = resp.data.values;
  if (!rows) {
    return;
  }

  const eventIdCol = colMap['event_id'];
  const slotIdCol = colMap['slot_id'];
  const visitorEmailCol = colMap['visitor_email'];
  const respondentTypeCol = colMap['respondent_type'];

  if (eventIdCol === undefined || slotIdCol === undefined || visitorEmailCol === undefined) {
    throw new Error('Required columns not found in AvailabilityResponses sheet');
  }

  let rowNumber = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowType = respondentTypeCol !== undefined ? row[respondentTypeCol] : '';
    if (row[eventIdCol] === eventId && row[slotIdCol] === slotId && rowType === 'visitor' && row[visitorEmailCol] === visitorEmail) {
      rowNumber = i + 2;
      break;
    }
  }

  // Nothing saved for this slot — nothing to clear
  if (rowNumber === -1) {
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: responsesSheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });
}

// Upsert a visitor's response. Matches on (event_id, slot_id, visitor_email).
export async function upsertVisitorResponse(
  eventId: string,
  slotId: string,
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
  const visitorEmailCol = colMap['visitor_email'];
  const respondentTypeCol = colMap['respondent_type'];
  const responseCol = colMap['response'];
  const updatedAtCol = colMap['updated_at'];

  if (eventIdCol === undefined || slotIdCol === undefined || visitorEmailCol === undefined) {
    throw new Error('Required columns not found in AvailabilityResponses sheet');
  }

  // Look for existing visitor response for this event/slot/visitor-email combination
  let existingRowNumber = -1;

  if (rows) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowEventId = row[eventIdCol];
      const rowSlotId = row[slotIdCol];
      const rowVisitorEmail = row[visitorEmailCol];
      const rowType = respondentTypeCol !== undefined ? row[respondentTypeCol] : 'member';

      if (rowEventId === eventId && rowSlotId === slotId && rowType === 'visitor' && rowVisitorEmail === visitorEmail) {
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

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${RESPONSES_SHEET}!A:K`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });
  }
}

// ─── Roster + Token Functions ──────────────────────────────────────────────────

// Build an event's roster directly from LIVE group membership. There is no invitees sheet —
// the group members ARE the roster. Returns invitee-shaped objects so the response/manage
// grids (which read detail.invitees) need no change. The per-member token is NEVER included
// here — it stays server-side (used only for email links + validation).
export async function getEventRoster(event: AvailabilityEvent): Promise<AvailabilityInvitee[]> {
  if (!event.groupId) {
    return [];
  }
  const members = await getGroupMembers(event.groupId);
  const roster: AvailabilityInvitee[] = [];
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    roster.push({
      inviteeId: m.memberId,
      eventId: event.eventId,
      groupMemberId: m.memberId,
      inviteeType: m.memberType,
      userName: m.userName,
      visitorName: m.visitorName,
      visitorEmail: m.visitorEmail,
      token: '',            // never expose the token to the client
      tokenExpiresAt: '',
      notifiedAt: '',
      createdAt: m.createdAt || '',
    });
  }
  return roster;
}

// Validate a response-link token. Resolves the group member holding it, then checks that
// member's group owns this event and the group is still active (annual expiry via archival).
// Returns the group member on success, else null.
export async function validateGroupMemberToken(
  eventId: string,
  token: string
): Promise<AvailabilityGroupMember | null> {
  const event = await getEventById(eventId);
  if (!event || !event.groupId) {
    return null;
  }
  const member = await getGroupMemberByToken(token);
  if (!member) {
    return null;
  }
  // The token's member must belong to this event's group
  if (member.groupId !== event.groupId) {
    return null;
  }
  // Reject tokens for archived groups (last season's groups expire when archived)
  const group = await getGroupById(event.groupId);
  if (!group || group.status === 'archived') {
    return null;
  }
  return member;
}


// ─── Composite Read Functions ──────────────────────────────────────────────────

// Build a userName → display-name map for a poll's roster, disambiguating shared first
// names against each other only (a lone "Sue" stays "Sue"; two "Sue"s become "Sue A"/
// "Sue B", extending the surname prefix as needed). See display-name-utils.
function buildRosterDisplayNames(userNames: string[], allUsers: User[]): Record<string, string> {
  const byUser: Record<string, User> = {};
  for (let i = 0; i < allUsers.length; i++) {
    if (allUsers[i].userName) byUser[allUsers[i].userName] = allUsers[i];
  }
  const seen: Record<string, boolean> = {};
  const people: Array<{ userName: string; firstName: string; lastName: string }> = [];
  for (let i = 0; i < userNames.length; i++) {
    const un = userNames[i];
    if (!un || seen[un]) continue;
    seen[un] = true;
    const u = byUser[un];
    if (u) {
      people.push({ userName: un, firstName: u.fullKnownAs || u.firstName || un, lastName: u.lastName || '' });
    } else {
      people.push({ userName: un, firstName: un, lastName: '' });
    }
  }
  return disambiguateDisplayNames(people);
}

// Build AvailabilityEventDetail for the member response page.
export async function getEventDetailForMember(
  eventId: string,
  callerUserName: string,
  callerRole: string = ''
): Promise<AvailabilityEventDetail | null> {
  // Fetch event + slots + responses + invitees in a single batched read
  const bundle = await fetchEventBundle(eventId);
  if (!bundle) {
    return null;
  }
  const event = bundle.event;
  const slots = bundle.slots;
  const allResponseRecords = bundle.responses;

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

  // Roster (group events) — fetched up front so its members join the display-name
  // disambiguation set alongside respondents (so a shared first name resolves the same
  // way whether the person has replied yet or not).
  let invitees: AvailabilityInvitee[] = [];
  if (event.groupId) {
    invitees = await getEventRoster(event);
  }

  // Build ONE disambiguated display-name map for every member shown in this poll
  // (caller + member respondents + roster members).
  const rosterUserNames: string[] = [callerUserName];
  for (let i = 0; i < allResponseRecords.length; i++) {
    const rec = allResponseRecords[i];
    if (rec.respondentType === 'member' && rec.userName) rosterUserNames.push(rec.userName);
  }
  for (let i = 0; i < invitees.length; i++) {
    const inv = invitees[i];
    if (inv.inviteeType === 'member' && inv.userName) rosterUserNames.push(inv.userName);
  }
  const allUsers = await getAllUsers();
  const userNameToDisplay = buildRosterDisplayNames(rosterUserNames, allUsers);

  let allResponses: AvailabilityParticipantResponses[] = [];

  if (showAll) {
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
          userName: rec.respondentType === 'member' ? rec.userName : '',
          responses: {},
        };
      }

      participantMap[participantKey].responses[rec.slotId] = rec.response;
    }

    // Convert to array, EXCLUDING the caller. The client renders the caller's own
    // responses separately (via myResponses / the "You" row, and adds them into the
    // per-slot tallies from pendingResponses). Including the caller here as well would
    // double-count them in the counts and show them twice in the responses modal.
    const keys = Object.keys(participantMap);
    const callerKey = `member:${callerUserName}`;

    // Add all participants except the caller
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

  // Invitee display names (group events) reuse the disambiguated map built above, plus
  // whether the caller can manage the group (and thus proxy-respond).
  const inviteeDisplayNames: Record<string, string> = {};
  let canManageGroup = false;

  if (event.groupId) {
    for (let i = 0; i < invitees.length; i++) {
      const inv = invitees[i];
      if (inv.inviteeType === 'member' && inv.userName) {
        inviteeDisplayNames[inv.userName] = userNameToDisplay[inv.userName] || inv.userName;
      }
    }

    // Determine whether the caller can manage the group (and thus proxy-respond)
    const group = await getGroupById(event.groupId);
    if (group) {
      canManageGroup = await canManageGroupMembers(group, callerUserName, callerRole);
    }
  }

  return {
    event,
    slots,
    myResponses,
    allResponses,
    concludedSlot,
    invitees,
    inviteeDisplayNames,
    canManageGroup,
  };
}

// Fetch an event plus its slots, responses, and invitees in ONE batchGet instead of four
// separate reads. Column maps are cached, so this is a single Sheets read per call — used by
// the manage + member detail builders to stay well under the per-minute read quota.
async function fetchEventBundle(eventId: string): Promise<{
  event: AvailabilityEvent;
  slots: AvailabilitySlot[];
  responses: AvailabilityResponseRecord[];
} | null> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const [eventsColMap, slotsColMap, respColMap] = await Promise.all([
    getColumnMap(EVENTS_SHEET, spreadsheetId),
    getColumnMap(SLOTS_SHEET, spreadsheetId),
    getColumnMap(RESPONSES_SHEET, spreadsheetId),
  ]);

  // Single batched read of the three ranges (roster comes from group members, not a sheet)
  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [EVENTS_RANGE, SLOTS_RANGE, RESPONSES_RANGE],
  });
  const vr = batch.data.valueRanges || [];
  const eventRows = (vr[0] && vr[0].values) ? (vr[0].values as string[][]) : [];
  const slotRows = (vr[1] && vr[1].values) ? (vr[1].values as string[][]) : [];
  const respRows = (vr[2] && vr[2].values) ? (vr[2].values as string[][]) : [];

  // Find the event
  const eventIdCol = eventsColMap['event_id'];
  let event: AvailabilityEvent | null = null;
  if (eventIdCol !== undefined) {
    for (let i = 0; i < eventRows.length; i++) {
      if (eventRows[i][eventIdCol] === eventId) {
        event = parseEventRow(eventRows[i], eventsColMap);
        break;
      }
    }
  }
  if (!event) {
    return null;
  }

  // Slots for this event, ordered by display_order
  const slots: AvailabilitySlot[] = [];
  const slotsEventIdCol = slotsColMap['event_id'];
  if (slotsEventIdCol !== undefined) {
    for (let i = 0; i < slotRows.length; i++) {
      if (slotRows[i][slotsEventIdCol] === eventId) {
        slots.push(parseSlotRow(slotRows[i], slotsColMap));
      }
    }
  }
  slots.sort((a, b) => a.displayOrder - b.displayOrder);

  // Responses for this event
  const responses: AvailabilityResponseRecord[] = [];
  const respEventIdCol = respColMap['event_id'];
  if (respEventIdCol !== undefined) {
    for (let i = 0; i < respRows.length; i++) {
      if (respRows[i][respEventIdCol] === eventId) {
        responses.push(parseResponseRow(respRows[i], respColMap));
      }
    }
  }

  return { event, slots, responses };
}

// Build AvailabilityManageDetail for the manage page.
// Always returns full response grid regardless of show_responses_to_respondents.
export async function getEventManageDetail(
  eventId: string
): Promise<AvailabilityManageDetail | null> {
  // Fetch event + slots + responses + invitees in a single batched read
  const bundle = await fetchEventBundle(eventId);
  if (!bundle) {
    return null;
  }
  const event = bundle.event;
  const slots = bundle.slots;
  const allResponseRecords = bundle.responses;
  // Roster comes straight from live group membership (there is no invitees sheet)
  const invitees = await getEventRoster(event);

  // Disambiguated display names for every member shown (roster + respondents)
  const rosterUserNames: string[] = [];
  for (let i = 0; i < invitees.length; i++) {
    const inv = invitees[i];
    if (inv.inviteeType === 'member' && inv.userName) rosterUserNames.push(inv.userName);
  }
  for (let i = 0; i < allResponseRecords.length; i++) {
    const rec = allResponseRecords[i];
    if (rec.respondentType === 'member' && rec.userName) rosterUserNames.push(rec.userName);
  }
  const allUsers = await getAllUsers();
  const userNameToDisplay = buildRosterDisplayNames(rosterUserNames, allUsers);

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
        userName: rec.respondentType === 'member' ? rec.userName : '',
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
  // Validate the token → the group member holding it
  const member = await validateGroupMemberToken(eventId, token);
  if (!member) {
    return null;
  }

  // Fetch the event
  const event = await getEventById(eventId);
  if (!event) {
    return null;
  }

  // Build an invitee-shaped record from the group member (the guest page reads
  // invitee.visitorName as its greeting label)
  const invitee: AvailabilityInvitee = {
    inviteeId: member.memberId,
    eventId,
    groupMemberId: member.memberId,
    inviteeType: member.memberType,
    userName: member.userName,
    visitorName: member.visitorName,
    visitorEmail: member.visitorEmail,
    token: '',
    tokenExpiresAt: '',
    notifiedAt: '',
    createdAt: member.createdAt || '',
  };

  // Fetch slots + responses for this event
  const slots = await getSlotsForEvent(eventId);
  const allResponseRecords = await getResponsesForEvent(eventId);

  // Build the person's own response map. Members are keyed by userName (so it merges with a
  // logged-in reply); visitors by visitor email.
  const isMemberInvitee = member.memberType === 'member';
  const myResponses: Record<string, AvailabilityResponse> = {};
  for (let i = 0; i < allResponseRecords.length; i++) {
    const rec = allResponseRecords[i];
    if (isMemberInvitee) {
      if (rec.respondentType === 'member' && rec.userName === member.userName) {
        myResponses[rec.slotId] = rec.response;
      }
    } else {
      if (rec.respondentType === 'visitor' && rec.visitorEmail === member.visitorEmail) {
        myResponses[rec.slotId] = rec.response;
      }
    }
  }

  // For members, resolve a display name so the page greets them by name (reuses the
  // visitorName field as the label on the shared guest page).
  if (isMemberInvitee && member.userName) {
    const memberUser = await getUserByUsername(member.userName);
    if (memberUser) {
      invitee.visitorName = memberUser.fullKnownAs || memberUser.fullName || member.userName;
    }
  }

  // Build allResponses based on showResponsesToRespondents
  let allResponses: AvailabilityParticipantResponses[] = [];

  if (event.showResponsesToRespondents) {
    // Disambiguated display names for the member respondents shown in the results
    const rosterUserNames: string[] = [];
    for (let i = 0; i < allResponseRecords.length; i++) {
      const rec = allResponseRecords[i];
      if (rec.respondentType === 'member' && rec.userName) rosterUserNames.push(rec.userName);
    }
    const allUsers = await getAllUsers();
    const userNameToDisplay = buildRosterDisplayNames(rosterUserNames, allUsers);

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
          userName: rec.respondentType === 'member' ? rec.userName : '',
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

// Return all open polls (public + group) that the given member is invited to.
// Used by the home-page Open Polls panel. Single batchGet for efficiency.
export async function getOpenPollsForMember(
  callerUserName: string
): Promise<OpenPollSummary[]> {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const batchResp = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [
      EVENTS_RANGE,                     // 0
      `${SLOTS_SHEET}!A2:F`,            // 1
      `${RESPONSES_SHEET}!A2:K`,        // 2
      'AvailabilityGroupMembers!A2:N',  // 3 — the roster (there is no invitees sheet)
      'AvailabilityGroups!A2:I',        // 4
    ],
  });

  const vr = batchResp.data.valueRanges;
  if (!vr || vr.length < 5) return [];

  const eventRows  = (vr[0].values || []) as string[][];
  const slotRows   = (vr[1].values || []) as string[][];
  const respRows   = (vr[2].values || []) as string[][];
  const memberRows = (vr[3].values || []) as string[][];
  const groupRows  = (vr[4].values || []) as string[][];

  const [eventsColMap, slotsColMap, respColMap, membersColMap, groupsColMap] = await Promise.all([
    getColumnMap(EVENTS_SHEET, spreadsheetId),
    getColumnMap(SLOTS_SHEET, spreadsheetId),
    getColumnMap(RESPONSES_SHEET, spreadsheetId),
    getColumnMap('AvailabilityGroupMembers', spreadsheetId),
    getColumnMap('AvailabilityGroups', spreadsheetId),
  ]);

  function makeGet(colMap: Record<string, number>) {
    return (row: string[], field: string): string => {
      const idx = colMap[field];
      if (idx === undefined) return '';
      return row[idx] ? String(row[idx]).trim() : '';
    };
  }
  const getEv  = makeGet(eventsColMap);
  const getSl  = makeGet(slotsColMap);
  const getRe  = makeGet(respColMap);
  const getMem = makeGet(membersColMap);
  const getGr  = makeGet(groupsColMap);

  // Group name lookup: groupId → name
  const groupNames: Record<string, string> = {};
  for (let i = 0; i < groupRows.length; i++) {
    const gid  = getGr(groupRows[i], 'group_id');
    const name = getGr(groupRows[i], 'name');
    if (gid) groupNames[gid] = name;
  }

  // Option count per event
  const optionCountMap: Record<string, number> = {};
  for (let i = 0; i < slotRows.length; i++) {
    const eid = getSl(slotRows[i], 'event_id');
    if (eid) optionCountMap[eid] = (optionCountMap[eid] || 0) + 1;
  }

  // Response count and hasResponded per event
  const respCountMap: Record<string, Set<string>> = {};
  const hasRespondedSet = new Set<string>(); // eventIds where caller responded
  for (let i = 0; i < respRows.length; i++) {
    const eid  = getRe(respRows[i], 'event_id');
    if (!eid) continue;
    if (!respCountMap[eid]) respCountMap[eid] = new Set();
    const rType = getRe(respRows[i], 'respondent_type') || 'member';
    const uname = getRe(respRows[i], 'user_name');
    const vemail = getRe(respRows[i], 'visitor_email');
    const key = rType === 'member' && uname ? `m:${uname}` : vemail ? `v:${vemail}` : '';
    if (key) respCountMap[eid].add(key);
    if (rType === 'member' && uname === callerUserName) hasRespondedSet.add(eid);
  }

  // GroupIds the caller belongs to. Polls are group-only, so a member sees a poll only
  // when they are a member of that poll's group.
  const callerGroupIds = new Set<string>();
  for (let i = 0; i < memberRows.length; i++) {
    const uname = getMem(memberRows[i], 'user_name');
    if (uname.toLowerCase() === callerUserName.toLowerCase()) {
      const gid = getMem(memberRows[i], 'group_id');
      if (gid) callerGroupIds.add(gid);
    }
  }

  const results: OpenPollSummary[] = [];
  for (let i = 0; i < eventRows.length; i++) {
    const row = eventRows[i];
    if (getEv(row, 'status') !== 'open') continue;

    const eventId = getEv(row, 'event_id');
    if (!eventId) continue;

    const groupId = getEv(row, 'group_id');

    // Only show polls whose group the caller belongs to
    if (!groupId || !callerGroupIds.has(groupId)) continue;

    results.push({
      eventId,
      title: getEv(row, 'title') || 'Poll',
      slotType: (getEv(row, 'slot_type') || 'datetime') as AvailabilitySlotType,
      hasResponded: hasRespondedSet.has(eventId),
      optionCount: optionCountMap[eventId] || 0,
      responseCount: respCountMap[eventId] ? respCountMap[eventId].size : 0,
      groupName: groupId ? (groupNames[groupId] || null) : null,
      expiresAt: getEv(row, 'expires_at'),
    });
  }

  // Most recently created first (event_id is chronological)
  results.reverse();

  return results;
}
