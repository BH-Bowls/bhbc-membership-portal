// src/lib/availability-sheets.ts
// Google Sheets operations for the Availability Planner feature

import crypto from 'crypto';
import {
  getColumnMap,
  getColumnLetter,
  getGoogleSheetsClient,
} from './sheets';
import { createRowFieldGetter, wrapError } from './banking-sheets';
import type {
  AvailabilityEvent,
  AvailabilityEventSummary,
  AvailabilityEventDetail,
  AvailabilityManageDetail,
  AvailabilitySlot,
  AvailabilityResponseRecord,
  AvailabilityInvitee,
  AvailabilityParticipantResponses,
  AvailabilityVisibility,
  AvailabilityEventStatus,
  AvailabilityResponse,
  AvailabilityRespondentType,
} from '@/types/availability';

// ============================================================================
// CONSTANTS
// ============================================================================

const EVENTS_SHEET = 'AvailabilityEvents';
const SLOTS_SHEET = 'AvailabilitySlots';
const RESPONSES_SHEET = 'AvailabilityResponses';
const INVITEES_SHEET = 'AvailabilityInvitees';

const EVENTS_RANGE = `${EVENTS_SHEET}!A2:O`;
const SLOTS_RANGE = `${SLOTS_SHEET}!A2:F`;
const RESPONSES_RANGE = `${RESPONSES_SHEET}!A2:K`;
const INVITEES_RANGE = `${INVITEES_SHEET}!A2:J`;

const HEADER_ROW_OFFSET = 2;

// ============================================================================
// ENVIRONMENT VARIABLE GETTER
// ============================================================================

// Returns the Availability spreadsheet ID, throws if not configured
function getSpreadsheetId(): string {
  const id = process.env.AVAILABILITY_SPREADSHEET_ID;
  if (!id) {
    throw new Error('AVAILABILITY_SPREADSHEET_ID environment variable is not set');
  }
  return id;
}

// ============================================================================
// ROW PARSERS
// ============================================================================

// Parse a sheet row into an AvailabilityEvent object
function parseEventRow(
  row: any[],
  colMap: Record<string, number>
): AvailabilityEvent {
  const get = createRowFieldGetter(row, colMap);
  const showResp = get('show_responses_to_respondents');
  const notifyCreator = get('notify_creator_on_response');
  return {
    eventId: get('event_id'),
    title: get('title'),
    description: get('description'),
    createdByUsername: get('created_by_username'),
    createdByName: '',
    visibility: (get('visibility') as AvailabilityVisibility) || 'public',
    status: (get('status') as AvailabilityEventStatus) || 'open',
    showResponsesToRespondents: showResp === 'Y',
    notifyCreatorOnResponse: notifyCreator === 'Y',
    expiresAt: get('expires_at'),
    concludedSlotId: get('concluded_slot_id'),
    conclusionNote: get('conclusion_note'),
    concludedAt: get('concluded_at'),
    concludedByUsername: get('concluded_by_username'),
    createdAt: get('created_at'),
    updatedAt: get('updated_at'),
  };
}

// Parse a sheet row into an AvailabilitySlot object
function parseSlotRow(
  row: any[],
  colMap: Record<string, number>
): AvailabilitySlot {
  const get = createRowFieldGetter(row, colMap);
  const orderStr = get('display_order');
  return {
    slotId: get('slot_id'),
    eventId: get('event_id'),
    slotDatetime: get('slot_datetime'),
    slotLabel: get('slot_label'),
    displayOrder: orderStr ? parseInt(orderStr, 10) : 0,
    createdAt: get('created_at'),
  };
}

// Parse a sheet row into an AvailabilityResponseRecord object
function parseResponseRow(
  row: any[],
  colMap: Record<string, number>
): AvailabilityResponseRecord {
  const get = createRowFieldGetter(row, colMap);
  return {
    responseId: get('response_id'),
    eventId: get('event_id'),
    slotId: get('slot_id'),
    respondentType: (get('respondent_type') as AvailabilityRespondentType) || 'member',
    userName: get('user_name'),
    visitorName: get('visitor_name'),
    visitorEmail: get('visitor_email'),
    response: (get('response') as AvailabilityResponse) || 'no',
    respondedAt: get('responded_at'),
    updatedAt: get('updated_at'),
    inviteeId: get('invitee_id'),
  };
}

// Parse a sheet row into an AvailabilityInvitee object
function parseInviteeRow(
  row: any[],
  colMap: Record<string, number>
): AvailabilityInvitee {
  const get = createRowFieldGetter(row, colMap);
  return {
    inviteeId: get('invitee_id'),
    eventId: get('event_id'),
    inviteeType: (get('invitee_type') as 'member' | 'visitor') || 'member',
    userName: get('user_name'),
    visitorName: get('visitor_name'),
    visitorEmail: get('visitor_email'),
    token: get('token'),
    tokenExpiresAt: get('token_expires_at'),
    notifiedAt: get('notified_at'),
    createdAt: get('created_at'),
  };
}

// ============================================================================
// RAW BULK READS (single reads for composite functions)
// ============================================================================

// Fetch all event rows from the sheet
async function getAllEventRows(): Promise<{ rows: any[][]; colMap: Record<string, number> }> {
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: EVENTS_RANGE,
  });
  const rows = response.data.values || [];
  return { rows, colMap };
}

// Fetch all slot rows from the sheet
async function getAllSlotRows(): Promise<{ rows: any[][]; colMap: Record<string, number> }> {
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(SLOTS_SHEET, spreadsheetId);
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: SLOTS_RANGE,
  });
  const rows = response.data.values || [];
  return { rows, colMap };
}

// Fetch all response rows from the sheet
async function getAllResponseRows(): Promise<{ rows: any[][]; colMap: Record<string, number> }> {
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(RESPONSES_SHEET, spreadsheetId);
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RESPONSES_RANGE,
  });
  const rows = response.data.values || [];
  return { rows, colMap };
}

// Fetch all invitee rows from the sheet
async function getAllInviteeRows(): Promise<{ rows: any[][]; colMap: Record<string, number> }> {
  const spreadsheetId = getSpreadsheetId();
  const colMap = await getColumnMap(INVITEES_SHEET, spreadsheetId);
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: INVITEES_RANGE,
  });
  const rows = response.data.values || [];
  return { rows, colMap };
}

// ============================================================================
// ID GENERATORS
// ============================================================================

// Generate next event ID in AV-YYYY-NNN format, resetting each calendar year
async function generateEventId(): Promise<string> {
  const { rows, colMap } = await getAllEventRows();
  const currentYear = new Date().getFullYear();
  const prefix = `AV-${currentYear}-`;
  let maxNumber = 0;

  // Find the highest NNN for the current year
  for (const row of rows) {
    const id = colMap['event_id'] !== undefined ? (row[colMap['event_id']] || '') : '';
    if (typeof id === 'string' && id.startsWith(prefix)) {
      const num = parseInt(id.substring(prefix.length), 10);
      if (!isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`;
}

// Generate next slot ID in AVS-NNNNNN format (never resets)
async function generateSlotId(): Promise<string> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  // Only fetch column A to minimise data transfer
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SLOTS_SHEET}!A2:A`,
  });
  const rows = response.data.values || [];
  let maxNumber = 0;

  // Find the highest numeric suffix across all slot IDs
  for (const row of rows) {
    const id = row[0] || '';
    if (typeof id === 'string' && id.startsWith('AVS-')) {
      const num = parseInt(id.substring(4), 10);
      if (!isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  return `AVS-${String(maxNumber + 1).padStart(6, '0')}`;
}

// Generate next response ID in AVR-NNNNNN format
async function generateResponseId(): Promise<string> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${RESPONSES_SHEET}!A2:A`,
  });
  const rows = response.data.values || [];
  let maxNumber = 0;

  for (const row of rows) {
    const id = row[0] || '';
    if (typeof id === 'string' && id.startsWith('AVR-')) {
      const num = parseInt(id.substring(4), 10);
      if (!isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  return `AVR-${String(maxNumber + 1).padStart(6, '0')}`;
}

// Generate next invitee ID in AVI-NNNNNN format
async function generateInviteeId(): Promise<string> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${INVITEES_SHEET}!A2:A`,
  });
  const rows = response.data.values || [];
  let maxNumber = 0;

  for (const row of rows) {
    const id = row[0] || '';
    if (typeof id === 'string' && id.startsWith('AVI-')) {
      const num = parseInt(id.substring(4), 10);
      if (!isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  return `AVI-${String(maxNumber + 1).padStart(6, '0')}`;
}

// ============================================================================
// EVENT FUNCTIONS
// ============================================================================

// Fetch all events visible to a given user (public + private where invited + own events)
// Resolves createdByName from Members sheet. Excludes archived events unless created by user.
export async function getAvailabilityEvents(userName: string): Promise<AvailabilityEventSummary[]> {
  try {
    const { rows: eventRows, colMap: eventColMap } = await getAllEventRows();
    const { rows: slotRows, colMap: slotColMap } = await getAllSlotRows();
    const { rows: responseRows, colMap: responseColMap } = await getAllResponseRows();
    const { rows: inviteeRows, colMap: inviteeColMap } = await getAllInviteeRows();

    // Parse all events
    const allEvents: AvailabilityEvent[] = [];
    for (const row of eventRows) {
      const event = parseEventRow(row, eventColMap);
      if (event.eventId) {
        allEvents.push(event);
      }
    }

    // Build set of eventIds where the user is an invitee (for private event access)
    const invitedEventIds = new Set<string>();
    for (const row of inviteeRows) {
      const inv = parseInviteeRow(row, inviteeColMap);
      if (inv.inviteeType === 'member' && inv.userName === userName) {
        invitedEventIds.add(inv.eventId);
      }
    }

    // Filter events the user can see
    const visibleEvents: AvailabilityEvent[] = [];
    for (const event of allEvents) {
      // Always include own events (any status including archived)
      if (event.createdByUsername === userName) {
        visibleEvents.push(event);
        continue;
      }
      // Skip archived events for non-creators
      if (event.status === 'archived') {
        continue;
      }
      // Public events — visible to all
      if (event.visibility === 'public') {
        visibleEvents.push(event);
        continue;
      }
      // Private events — only if on the invitee list
      if (event.visibility === 'private' && invitedEventIds.has(event.eventId)) {
        visibleEvents.push(event);
      }
    }

    // Resolve member display names from Members sheet
    const { getAllUsers } = await import('./sheets');
    const users = await getAllUsers();
    const nameMap = new Map<string, string>();
    for (const user of users) {
      if (user.userName) {
        nameMap.set(user.userName, user.fullName || user.userName);
      }
    }

    // Build slot count map
    const slotCountMap = new Map<string, number>();
    const slotByIdMap = new Map<string, AvailabilitySlot>();
    for (const row of slotRows) {
      const slot = parseSlotRow(row, slotColMap);
      if (slot.slotId) {
        slotByIdMap.set(slot.slotId, slot);
        const current = slotCountMap.get(slot.eventId) || 0;
        slotCountMap.set(slot.eventId, current + 1);
      }
    }

    // Build response count map and hasResponded map
    const responseCountMap = new Map<string, Set<string>>();
    const hasRespondedMap = new Map<string, boolean>();
    for (const row of responseRows) {
      const rec = parseResponseRow(row, responseColMap);
      if (rec.responseId) {
        // Count unique respondents per event
        if (!responseCountMap.has(rec.eventId)) {
          responseCountMap.set(rec.eventId, new Set<string>());
        }
        const key = rec.respondentType === 'member' ? rec.userName : (rec.inviteeId || rec.visitorEmail);
        const set = responseCountMap.get(rec.eventId);
        if (set) {
          set.add(key);
        }
        // Track whether the current user has responded
        if (rec.respondentType === 'member' && rec.userName === userName) {
          hasRespondedMap.set(rec.eventId, true);
        }
      }
    }

    // Build summaries
    const summaries: AvailabilityEventSummary[] = [];
    for (const event of visibleEvents) {
      const responders = responseCountMap.get(event.eventId);
      const responseCount = responders ? responders.size : 0;

      // Resolve concluded slot info
      let concludedSlotLabel = '';
      let concludedSlotDatetime = '';
      if (event.concludedSlotId) {
        const concludedSlot = slotByIdMap.get(event.concludedSlotId);
        if (concludedSlot) {
          concludedSlotLabel = concludedSlot.slotLabel;
          concludedSlotDatetime = concludedSlot.slotDatetime;
        }
      }

      summaries.push({
        eventId: event.eventId,
        title: event.title,
        description: event.description,
        createdByName: nameMap.get(event.createdByUsername) || event.createdByUsername,
        visibility: event.visibility,
        status: event.status,
        expiresAt: event.expiresAt,
        slotCount: slotCountMap.get(event.eventId) || 0,
        responseCount,
        hasResponded: hasRespondedMap.get(event.eventId) || false,
        isInvited: invitedEventIds.has(event.eventId),
        concludedSlotLabel,
        concludedSlotDatetime,
      });
    }

    return summaries;
  } catch (error) {
    console.error('[getAvailabilityEvents] Error:', error);
    throw wrapError('Failed to fetch availability events', error);
  }
}

// Fetch a single event by eventId. Returns null if not found.
export async function getAvailabilityEventById(eventId: string): Promise<AvailabilityEvent | null> {
  try {
    const { rows, colMap } = await getAllEventRows();

    // Search rows for matching event ID
    for (const row of rows) {
      const event = parseEventRow(row, colMap);
      if (event.eventId === eventId) {
        // Resolve creator name
        const { getUserByUsername } = await import('./sheets');
        const creator = await getUserByUsername(event.createdByUsername);
        if (creator) {
          event.createdByName = creator.fullName || creator.userName;
        } else {
          event.createdByName = event.createdByUsername;
        }
        return event;
      }
    }

    return null;
  } catch (error) {
    console.error(`[getAvailabilityEventById] Error for ${eventId}:`, error);
    throw wrapError(`Failed to fetch event ${eventId}`, error);
  }
}

// Create a new event. Appends one row to AvailabilityEvents. Returns the generated eventId.
export async function createAvailabilityEvent(data: {
  title: string;
  description: string;
  createdByUsername: string;
  visibility: AvailabilityVisibility;
  showResponsesToRespondents: boolean;
  notifyCreatorOnResponse: boolean;
  expiresAt: string;
}): Promise<string> {
  try {
    const spreadsheetId = getSpreadsheetId();
    const colMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);
    const sheets = getGoogleSheetsClient();
    const eventId = await generateEventId();
    const now = new Date().toISOString();

    // Build row array with correct column positions
    const maxCol = Math.max(...Object.values(colMap));
    const newRow: any[] = new Array(maxCol + 1).fill('');

    newRow[colMap['event_id']] = eventId;
    newRow[colMap['title']] = data.title;
    newRow[colMap['description']] = data.description;
    newRow[colMap['created_by_username']] = data.createdByUsername;
    newRow[colMap['visibility']] = data.visibility;
    newRow[colMap['status']] = 'open';
    newRow[colMap['show_responses_to_respondents']] = data.showResponsesToRespondents ? 'Y' : 'N';
    newRow[colMap['notify_creator_on_response']] = data.notifyCreatorOnResponse ? 'Y' : 'N';
    newRow[colMap['expires_at']] = data.expiresAt;
    newRow[colMap['concluded_slot_id']] = '';
    newRow[colMap['conclusion_note']] = '';
    newRow[colMap['concluded_at']] = '';
    newRow[colMap['concluded_by_username']] = '';
    newRow[colMap['created_at']] = now;
    newRow[colMap['updated_at']] = '';

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${EVENTS_SHEET}!A:O`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });

    return eventId;
  } catch (error) {
    console.error('[createAvailabilityEvent] Error:', error);
    throw wrapError('Failed to create availability event', error);
  }
}

// Update event fields. Finds the event row, updates changed columns, sets updated_at.
export async function updateAvailabilityEvent(
  eventId: string,
  updates: Partial<Pick<AvailabilityEvent,
    'title' | 'description' | 'showResponsesToRespondents' |
    'notifyCreatorOnResponse' | 'expiresAt' | 'status'
  >>
): Promise<void> {
  try {
    const spreadsheetId = getSpreadsheetId();
    const colMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);
    const sheets = getGoogleSheetsClient();

    // Find the row number for this event
    const { rows } = await getAllEventRows();
    let targetRowNumber = -1;
    for (let i = 0; i < rows.length; i++) {
      const get = createRowFieldGetter(rows[i], colMap);
      if (get('event_id') === eventId) {
        targetRowNumber = i + HEADER_ROW_OFFSET;
        break;
      }
    }

    if (targetRowNumber === -1) {
      throw new Error(`Event ${eventId} not found`);
    }

    // Map JS field names to sheet column keys
    const fieldToColumnKey: Record<string, string> = {
      title: 'title',
      description: 'description',
      showResponsesToRespondents: 'show_responses_to_respondents',
      notifyCreatorOnResponse: 'notify_creator_on_response',
      expiresAt: 'expires_at',
      status: 'status',
    };

    const updateData: { range: string; values: any[][] }[] = [];

    // Build update ranges for each changed field
    for (const jsKey of Object.keys(updates)) {
      const columnKey = fieldToColumnKey[jsKey];
      if (!columnKey) {
        continue;
      }
      if (colMap[columnKey] === undefined) {
        continue;
      }
      let value = (updates as any)[jsKey];
      // Convert booleans to Y/N for sheet storage
      if (jsKey === 'showResponsesToRespondents' || jsKey === 'notifyCreatorOnResponse') {
        value = value ? 'Y' : 'N';
      }
      const col = getColumnLetter(colMap[columnKey]);
      updateData.push({
        range: `${EVENTS_SHEET}!${col}${targetRowNumber}`,
        values: [[value !== undefined && value !== null ? value : '']],
      });
    }

    // Always update updated_at timestamp
    if (colMap['updated_at'] !== undefined) {
      const col = getColumnLetter(colMap['updated_at']);
      updateData.push({
        range: `${EVENTS_SHEET}!${col}${targetRowNumber}`,
        values: [[new Date().toISOString()]],
      });
    }

    if (updateData.length === 0) {
      return;
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updateData,
        valueInputOption: 'USER_ENTERED',
      },
    });
  } catch (error) {
    console.error(`[updateAvailabilityEvent] Error for ${eventId}:`, error);
    throw wrapError(`Failed to update event ${eventId}`, error);
  }
}

// Mark an event as concluded. Sets status, concluded_slot_id, conclusion_note,
// concluded_at, concluded_by_username, updated_at.
export async function concludeAvailabilityEvent(
  eventId: string,
  concludedSlotId: string,
  conclusionNote: string,
  concludedByUsername: string
): Promise<void> {
  try {
    const spreadsheetId = getSpreadsheetId();
    const colMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);
    const sheets = getGoogleSheetsClient();

    // Find the row number for this event
    const { rows } = await getAllEventRows();
    let targetRowNumber = -1;
    for (let i = 0; i < rows.length; i++) {
      const get = createRowFieldGetter(rows[i], colMap);
      if (get('event_id') === eventId) {
        targetRowNumber = i + HEADER_ROW_OFFSET;
        break;
      }
    }

    if (targetRowNumber === -1) {
      throw new Error(`Event ${eventId} not found`);
    }

    const now = new Date().toISOString();
    const updateData: { range: string; values: any[][] }[] = [];

    // Update all conclusion-related fields
    const fieldsToUpdate: Record<string, string> = {
      status: 'concluded',
      concluded_slot_id: concludedSlotId,
      conclusion_note: conclusionNote,
      concluded_at: now,
      concluded_by_username: concludedByUsername,
      updated_at: now,
    };

    for (const [colKey, value] of Object.entries(fieldsToUpdate)) {
      if (colMap[colKey] !== undefined) {
        const col = getColumnLetter(colMap[colKey]);
        updateData.push({
          range: `${EVENTS_SHEET}!${col}${targetRowNumber}`,
          values: [[value]],
        });
      }
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updateData,
        valueInputOption: 'USER_ENTERED',
      },
    });
  } catch (error) {
    console.error(`[concludeAvailabilityEvent] Error for ${eventId}:`, error);
    throw wrapError(`Failed to conclude event ${eventId}`, error);
  }
}

// Archive an event (soft delete). Sets status = 'archived'.
export async function archiveAvailabilityEvent(eventId: string): Promise<void> {
  await updateAvailabilityEvent(eventId, { status: 'archived' });
}

// Clear all conclusion fields when reopening an event.
export async function clearConclusionFields(eventId: string): Promise<void> {
  try {
    const spreadsheetId = getSpreadsheetId();
    const colMap = await getColumnMap(EVENTS_SHEET, spreadsheetId);
    const sheets = getGoogleSheetsClient();

    // Find the row number for this event
    const { rows } = await getAllEventRows();
    let targetRowNumber = -1;
    for (let i = 0; i < rows.length; i++) {
      const get = createRowFieldGetter(rows[i], colMap);
      if (get('event_id') === eventId) {
        targetRowNumber = i + HEADER_ROW_OFFSET;
        break;
      }
    }

    if (targetRowNumber === -1) {
      throw new Error(`Event ${eventId} not found`);
    }

    const now = new Date().toISOString();
    const updateData: { range: string; values: any[][] }[] = [];

    // Clear all conclusion fields and set updated_at
    const fieldsToClear = ['concluded_slot_id', 'conclusion_note', 'concluded_at', 'concluded_by_username'];
    for (const colKey of fieldsToClear) {
      if (colMap[colKey] !== undefined) {
        const col = getColumnLetter(colMap[colKey]);
        updateData.push({
          range: `${EVENTS_SHEET}!${col}${targetRowNumber}`,
          values: [['']],
        });
      }
    }

    // Set updated_at
    if (colMap['updated_at'] !== undefined) {
      const col = getColumnLetter(colMap['updated_at']);
      updateData.push({
        range: `${EVENTS_SHEET}!${col}${targetRowNumber}`,
        values: [[now]],
      });
    }

    if (updateData.length === 0) {
      return;
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updateData,
        valueInputOption: 'USER_ENTERED',
      },
    });
  } catch (error) {
    console.error(`[clearConclusionFields] Error for ${eventId}:`, error);
    throw wrapError(`Failed to clear conclusion fields for event ${eventId}`, error);
  }
}

// ============================================================================
// SLOT FUNCTIONS
// ============================================================================

// Fetch all slots for an event, ordered by display_order ascending
export async function getSlotsForEvent(eventId: string): Promise<AvailabilitySlot[]> {
  try {
    const { rows, colMap } = await getAllSlotRows();
    const slots: AvailabilitySlot[] = [];

    // Filter slots belonging to this event
    for (const row of rows) {
      const slot = parseSlotRow(row, colMap);
      if (slot.slotId && slot.eventId === eventId) {
        slots.push(slot);
      }
    }

    // Sort by displayOrder ascending
    slots.sort((a, b) => a.displayOrder - b.displayOrder);

    return slots;
  } catch (error) {
    console.error(`[getSlotsForEvent] Error for ${eventId}:`, error);
    throw wrapError(`Failed to fetch slots for event ${eventId}`, error);
  }
}

// Add a slot. Appends one row. Returns the generated slotId.
export async function addAvailabilitySlot(
  eventId: string,
  slotDatetime: string,
  slotLabel: string,
  displayOrder: number
): Promise<string> {
  try {
    const spreadsheetId = getSpreadsheetId();
    const colMap = await getColumnMap(SLOTS_SHEET, spreadsheetId);
    const sheets = getGoogleSheetsClient();
    const slotId = await generateSlotId();
    const now = new Date().toISOString();

    // Build row array with correct column positions
    const maxCol = Math.max(...Object.values(colMap));
    const newRow: any[] = new Array(maxCol + 1).fill('');

    newRow[colMap['slot_id']] = slotId;
    newRow[colMap['event_id']] = eventId;
    newRow[colMap['slot_datetime']] = slotDatetime;
    newRow[colMap['slot_label']] = slotLabel;
    newRow[colMap['display_order']] = displayOrder;
    newRow[colMap['created_at']] = now;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SLOTS_SHEET}!A:F`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });

    return slotId;
  } catch (error) {
    console.error('[addAvailabilitySlot] Error:', error);
    throw wrapError('Failed to add availability slot', error);
  }
}

// Delete a slot by slotId. Also deletes all response rows for that slotId (cascading).
export async function deleteAvailabilitySlot(slotId: string): Promise<void> {
  try {
    const spreadsheetId = getSpreadsheetId();
    const sheets = getGoogleSheetsClient();

    // --- Step 1: Delete all response rows for this slot (in reverse order) ---
    const { rows: responseRows, colMap: responseColMap } = await getAllResponseRows();
    const responseRowNumbers: number[] = [];

    for (let i = 0; i < responseRows.length; i++) {
      const get = createRowFieldGetter(responseRows[i], responseColMap);
      if (get('slot_id') === slotId) {
        responseRowNumbers.push(i + HEADER_ROW_OFFSET);
      }
    }

    if (responseRowNumbers.length > 0) {
      // Get sheet ID for the responses sheet
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const respSheet = spreadsheet.data.sheets
        ? spreadsheet.data.sheets.find((s) => s.properties && s.properties.title === RESPONSES_SHEET)
        : undefined;

      if (respSheet && respSheet.properties) {
        const respSheetId = respSheet.properties.sheetId;
        // Delete rows in reverse order to preserve indices
        const sortedDesc = responseRowNumbers.slice().sort((a, b) => b - a);
        for (const rowNum of sortedDesc) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                {
                  deleteDimension: {
                    range: {
                      sheetId: respSheetId,
                      dimension: 'ROWS',
                      startIndex: rowNum - 1,
                      endIndex: rowNum,
                    },
                  },
                },
              ],
            },
          });
        }
      }
    }

    // --- Step 2: Delete the slot row itself ---
    const { rows: slotRows, colMap: slotColMap } = await getAllSlotRows();
    let slotRowNumber = -1;

    for (let i = 0; i < slotRows.length; i++) {
      const get = createRowFieldGetter(slotRows[i], slotColMap);
      if (get('slot_id') === slotId) {
        slotRowNumber = i + HEADER_ROW_OFFSET;
        break;
      }
    }

    if (slotRowNumber === -1) {
      throw new Error(`Slot ${slotId} not found`);
    }

    // Get sheet ID for the slots sheet
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const slotsSheet = spreadsheet.data.sheets
      ? spreadsheet.data.sheets.find((s) => s.properties && s.properties.title === SLOTS_SHEET)
      : undefined;

    if (!slotsSheet || !slotsSheet.properties) {
      throw new Error(`${SLOTS_SHEET} sheet not found`);
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: slotsSheet.properties.sheetId,
                dimension: 'ROWS',
                startIndex: slotRowNumber - 1,
                endIndex: slotRowNumber,
              },
            },
          },
        ],
      },
    });
  } catch (error) {
    console.error(`[deleteAvailabilitySlot] Error for ${slotId}:`, error);
    throw wrapError(`Failed to delete slot ${slotId}`, error);
  }
}

// ============================================================================
// RESPONSE FUNCTIONS
// ============================================================================

// Fetch all responses for an event
export async function getResponsesForEvent(eventId: string): Promise<AvailabilityResponseRecord[]> {
  try {
    const { rows, colMap } = await getAllResponseRows();
    const records: AvailabilityResponseRecord[] = [];

    // Filter by event ID
    for (const row of rows) {
      const rec = parseResponseRow(row, colMap);
      if (rec.responseId && rec.eventId === eventId) {
        records.push(rec);
      }
    }

    return records;
  } catch (error) {
    console.error(`[getResponsesForEvent] Error for ${eventId}:`, error);
    throw wrapError(`Failed to fetch responses for event ${eventId}`, error);
  }
}

// Fetch responses for a specific respondent
// For members: match by user_name. For visitors: match by invitee_id.
export async function getResponsesForRespondent(
  eventId: string,
  respondentType: AvailabilityRespondentType,
  identifier: string
): Promise<AvailabilityResponseRecord[]> {
  try {
    const { rows, colMap } = await getAllResponseRows();
    const records: AvailabilityResponseRecord[] = [];

    // Match on event ID and the appropriate identifier field
    for (const row of rows) {
      const rec = parseResponseRow(row, colMap);
      if (rec.responseId && rec.eventId === eventId) {
        if (respondentType === 'member' && rec.userName === identifier) {
          records.push(rec);
        } else if (respondentType === 'visitor' && rec.inviteeId === identifier) {
          records.push(rec);
        }
      }
    }

    return records;
  } catch (error) {
    console.error(`[getResponsesForRespondent] Error:`, error);
    throw wrapError('Failed to fetch respondent responses', error);
  }
}

// Upsert a member's response for a slot.
// If a row already exists for (eventId, slotId, userName), update it.
// Otherwise, append a new row.
export async function upsertMemberResponse(
  eventId: string,
  slotId: string,
  userName: string,
  response: AvailabilityResponse
): Promise<void> {
  try {
    const spreadsheetId = getSpreadsheetId();
    const colMap = await getColumnMap(RESPONSES_SHEET, spreadsheetId);
    const sheets = getGoogleSheetsClient();

    // Check for existing row
    const { rows } = await getAllResponseRows();
    let existingRowNumber = -1;

    for (let i = 0; i < rows.length; i++) {
      const get = createRowFieldGetter(rows[i], colMap);
      if (
        get('event_id') === eventId &&
        get('slot_id') === slotId &&
        get('user_name') === userName &&
        get('respondent_type') === 'member'
      ) {
        existingRowNumber = i + HEADER_ROW_OFFSET;
        break;
      }
    }

    const now = new Date().toISOString();

    if (existingRowNumber !== -1) {
      // Update existing row — set response and updated_at
      const updateData: { range: string; values: any[][] }[] = [];

      if (colMap['response'] !== undefined) {
        const col = getColumnLetter(colMap['response']);
        updateData.push({
          range: `${RESPONSES_SHEET}!${col}${existingRowNumber}`,
          values: [[response]],
        });
      }

      if (colMap['updated_at'] !== undefined) {
        const col = getColumnLetter(colMap['updated_at']);
        updateData.push({
          range: `${RESPONSES_SHEET}!${col}${existingRowNumber}`,
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
      // Insert new row
      const responseId = await generateResponseId();
      const maxCol = Math.max(...Object.values(colMap));
      const newRow: any[] = new Array(maxCol + 1).fill('');

      newRow[colMap['response_id']] = responseId;
      newRow[colMap['event_id']] = eventId;
      newRow[colMap['slot_id']] = slotId;
      newRow[colMap['respondent_type']] = 'member';
      newRow[colMap['user_name']] = userName;
      newRow[colMap['visitor_name']] = '';
      newRow[colMap['visitor_email']] = '';
      newRow[colMap['response']] = response;
      newRow[colMap['responded_at']] = now;
      newRow[colMap['updated_at']] = '';
      newRow[colMap['invitee_id']] = '';

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${RESPONSES_SHEET}!A:K`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] },
      });
    }
  } catch (error) {
    console.error('[upsertMemberResponse] Error:', error);
    throw wrapError('Failed to upsert member response', error);
  }
}

// Upsert a visitor's response for a slot, identified by inviteeId.
export async function upsertVisitorResponse(
  eventId: string,
  slotId: string,
  inviteeId: string,
  visitorName: string,
  visitorEmail: string,
  response: AvailabilityResponse
): Promise<void> {
  try {
    const spreadsheetId = getSpreadsheetId();
    const colMap = await getColumnMap(RESPONSES_SHEET, spreadsheetId);
    const sheets = getGoogleSheetsClient();

    // Check for existing row matching on invitee_id
    const { rows } = await getAllResponseRows();
    let existingRowNumber = -1;

    for (let i = 0; i < rows.length; i++) {
      const get = createRowFieldGetter(rows[i], colMap);
      if (
        get('event_id') === eventId &&
        get('slot_id') === slotId &&
        get('invitee_id') === inviteeId &&
        get('respondent_type') === 'visitor'
      ) {
        existingRowNumber = i + HEADER_ROW_OFFSET;
        break;
      }
    }

    const now = new Date().toISOString();

    if (existingRowNumber !== -1) {
      // Update existing row
      const updateData: { range: string; values: any[][] }[] = [];

      if (colMap['response'] !== undefined) {
        const col = getColumnLetter(colMap['response']);
        updateData.push({
          range: `${RESPONSES_SHEET}!${col}${existingRowNumber}`,
          values: [[response]],
        });
      }

      if (colMap['updated_at'] !== undefined) {
        const col = getColumnLetter(colMap['updated_at']);
        updateData.push({
          range: `${RESPONSES_SHEET}!${col}${existingRowNumber}`,
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
      // Insert new row
      const responseId = await generateResponseId();
      const maxCol = Math.max(...Object.values(colMap));
      const newRow: any[] = new Array(maxCol + 1).fill('');

      newRow[colMap['response_id']] = responseId;
      newRow[colMap['event_id']] = eventId;
      newRow[colMap['slot_id']] = slotId;
      newRow[colMap['respondent_type']] = 'visitor';
      newRow[colMap['user_name']] = '';
      newRow[colMap['visitor_name']] = visitorName;
      newRow[colMap['visitor_email']] = visitorEmail;
      newRow[colMap['response']] = response;
      newRow[colMap['responded_at']] = now;
      newRow[colMap['updated_at']] = '';
      newRow[colMap['invitee_id']] = inviteeId;

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${RESPONSES_SHEET}!A:K`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] },
      });
    }
  } catch (error) {
    console.error('[upsertVisitorResponse] Error:', error);
    throw wrapError('Failed to upsert visitor response', error);
  }
}

// ============================================================================
// INVITEE FUNCTIONS
// ============================================================================

// Fetch all invitees for an event
export async function getInviteesForEvent(eventId: string): Promise<AvailabilityInvitee[]> {
  try {
    const { rows, colMap } = await getAllInviteeRows();
    const invitees: AvailabilityInvitee[] = [];

    // Filter by event ID
    for (const row of rows) {
      const inv = parseInviteeRow(row, colMap);
      if (inv.inviteeId && inv.eventId === eventId) {
        invitees.push(inv);
      }
    }

    return invitees;
  } catch (error) {
    console.error(`[getInviteesForEvent] Error for ${eventId}:`, error);
    throw wrapError(`Failed to fetch invitees for event ${eventId}`, error);
  }
}

// Add a batch of invitees for a private event.
// Returns the list of created invitee records (needed for sending emails).
export async function addInvitees(
  eventId: string,
  tokenExpiresAt: string,
  memberUserNames: string[],
  visitorInvitees: Array<{ visitorName: string; visitorEmail: string }>
): Promise<AvailabilityInvitee[]> {
  try {
    const spreadsheetId = getSpreadsheetId();
    const colMap = await getColumnMap(INVITEES_SHEET, spreadsheetId);
    const sheets = getGoogleSheetsClient();
    const created: AvailabilityInvitee[] = [];
    const now = new Date().toISOString();

    // Add member invitees (no token)
    for (const userName of memberUserNames) {
      const inviteeId = await generateInviteeId();
      const maxCol = Math.max(...Object.values(colMap));
      const newRow: any[] = new Array(maxCol + 1).fill('');

      newRow[colMap['invitee_id']] = inviteeId;
      newRow[colMap['event_id']] = eventId;
      newRow[colMap['invitee_type']] = 'member';
      newRow[colMap['user_name']] = userName;
      newRow[colMap['visitor_name']] = '';
      newRow[colMap['visitor_email']] = '';
      newRow[colMap['token']] = '';
      newRow[colMap['token_expires_at']] = '';
      newRow[colMap['notified_at']] = '';
      newRow[colMap['created_at']] = now;

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${INVITEES_SHEET}!A:J`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] },
      });

      created.push({
        inviteeId,
        eventId,
        inviteeType: 'member',
        userName,
        visitorName: '',
        visitorEmail: '',
        token: '',
        tokenExpiresAt: '',
        notifiedAt: '',
        createdAt: now,
      });
    }

    // Add visitor invitees (generate unique token per visitor)
    for (const visitor of visitorInvitees) {
      const inviteeId = await generateInviteeId();
      // Generate 64-char hex token (32 random bytes)
      const token = crypto.randomBytes(32).toString('hex');
      const maxCol = Math.max(...Object.values(colMap));
      const newRow: any[] = new Array(maxCol + 1).fill('');

      newRow[colMap['invitee_id']] = inviteeId;
      newRow[colMap['event_id']] = eventId;
      newRow[colMap['invitee_type']] = 'visitor';
      newRow[colMap['user_name']] = '';
      newRow[colMap['visitor_name']] = visitor.visitorName;
      newRow[colMap['visitor_email']] = visitor.visitorEmail;
      newRow[colMap['token']] = token;
      newRow[colMap['token_expires_at']] = tokenExpiresAt;
      newRow[colMap['notified_at']] = '';
      newRow[colMap['created_at']] = now;

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${INVITEES_SHEET}!A:J`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [newRow] },
      });

      created.push({
        inviteeId,
        eventId,
        inviteeType: 'visitor',
        userName: '',
        visitorName: visitor.visitorName,
        visitorEmail: visitor.visitorEmail,
        token,
        tokenExpiresAt,
        notifiedAt: '',
        createdAt: now,
      });
    }

    return created;
  } catch (error) {
    console.error('[addInvitees] Error:', error);
    throw wrapError('Failed to add invitees', error);
  }
}

// Validate a visitor token. Returns the matching invitee record or null.
// Checks: token exists, event matches, token_expires_at has not passed.
export async function validateVisitorToken(
  eventId: string,
  token: string
): Promise<AvailabilityInvitee | null> {
  try {
    const { rows, colMap } = await getAllInviteeRows();

    // Find matching token row
    for (const row of rows) {
      const inv = parseInviteeRow(row, colMap);
      if (inv.eventId === eventId && inv.token === token && inv.inviteeType === 'visitor') {
        // Check token has not expired
        if (inv.tokenExpiresAt) {
          const expiry = new Date(inv.tokenExpiresAt);
          if (expiry <= new Date()) {
            return null;
          }
        }
        return inv;
      }
    }

    return null;
  } catch (error) {
    console.error('[validateVisitorToken] Error:', error);
    throw wrapError('Failed to validate visitor token', error);
  }
}

// Mark one or more invitees as notified by setting notified_at.
export async function markInviteesNotified(inviteeIds: string[]): Promise<void> {
  try {
    if (inviteeIds.length === 0) {
      return;
    }

    const spreadsheetId = getSpreadsheetId();
    const colMap = await getColumnMap(INVITEES_SHEET, spreadsheetId);
    const sheets = getGoogleSheetsClient();

    // Find all matching row numbers
    const { rows } = await getAllInviteeRows();
    const now = new Date().toISOString();
    const updateData: { range: string; values: any[][] }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const get = createRowFieldGetter(rows[i], colMap);
      const inviteeId = get('invitee_id');
      if (inviteeIds.includes(inviteeId) && colMap['notified_at'] !== undefined) {
        const rowNumber = i + HEADER_ROW_OFFSET;
        const col = getColumnLetter(colMap['notified_at']);
        updateData.push({
          range: `${INVITEES_SHEET}!${col}${rowNumber}`,
          values: [[now]],
        });
      }
    }

    if (updateData.length === 0) {
      return;
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updateData,
        valueInputOption: 'USER_ENTERED',
      },
    });
  } catch (error) {
    console.error('[markInviteesNotified] Error:', error);
    throw wrapError('Failed to mark invitees as notified', error);
  }
}

// Check whether a member is on the invitee list for a private event.
export async function isMemberInvited(eventId: string, userName: string): Promise<boolean> {
  try {
    const { rows, colMap } = await getAllInviteeRows();

    // Search for a member invitee row matching eventId and userName
    for (const row of rows) {
      const inv = parseInviteeRow(row, colMap);
      if (inv.eventId === eventId && inv.inviteeType === 'member' && inv.userName === userName) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('[isMemberInvited] Error:', error);
    throw wrapError('Failed to check member invitation status', error);
  }
}

// ============================================================================
// COMPOSITE READ FUNCTIONS
// ============================================================================

// Build participant response grid from raw response records and member name map
function buildParticipantGrid(
  responses: AvailabilityResponseRecord[],
  nameMap: Map<string, string>
): AvailabilityParticipantResponses[] {
  // Group responses by respondent (member username or visitor inviteeId)
  const participantMap = new Map<string, AvailabilityParticipantResponses>();

  for (const rec of responses) {
    const key = rec.respondentType === 'member' ? `member:${rec.userName}` : `visitor:${rec.inviteeId}`;
    if (!participantMap.has(key)) {
      let displayName = '';
      if (rec.respondentType === 'member') {
        displayName = nameMap.get(rec.userName) || rec.userName;
      } else {
        displayName = rec.visitorName || 'Visitor';
      }
      participantMap.set(key, {
        displayName,
        respondentType: rec.respondentType,
        responses: {},
      });
    }
    const participant = participantMap.get(key);
    if (participant) {
      participant.responses[rec.slotId] = rec.response;
    }
  }

  return Array.from(participantMap.values());
}

// Build AvailabilityEventDetail for the member response page.
export async function getEventDetailForMember(
  eventId: string,
  callerUserName: string
): Promise<AvailabilityEventDetail | null> {
  try {
    // Fetch event
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      return null;
    }

    // Fetch slots
    const slots = await getSlotsForEvent(eventId);

    // Fetch all responses for the event
    const allResponseRecords = await getResponsesForEvent(eventId);

    // Build name map for display
    const { getAllUsers } = await import('./sheets');
    const users = await getAllUsers();
    const nameMap = new Map<string, string>();
    for (const user of users) {
      if (user.userName) {
        nameMap.set(user.userName, user.fullName || user.userName);
      }
    }

    // Extract the caller's own responses
    const myResponses: Record<string, AvailabilityResponse> = {};
    for (const rec of allResponseRecords) {
      if (rec.respondentType === 'member' && rec.userName === callerUserName) {
        myResponses[rec.slotId] = rec.response;
      }
    }

    // Build allResponses — only if allowed
    let allResponses: AvailabilityParticipantResponses[] = [];
    const shouldShowAll = event.showResponsesToRespondents || event.createdByUsername === callerUserName;
    if (shouldShowAll) {
      allResponses = buildParticipantGrid(allResponseRecords, nameMap);
    }

    // Find concluded slot if applicable
    let concludedSlot: AvailabilitySlot | null = null;
    if (event.concludedSlotId) {
      for (const slot of slots) {
        if (slot.slotId === event.concludedSlotId) {
          concludedSlot = slot;
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
  } catch (error) {
    console.error(`[getEventDetailForMember] Error for ${eventId}:`, error);
    throw wrapError(`Failed to get event detail for member`, error);
  }
}

// Build AvailabilityManageDetail for the manage page.
// Always returns full response grid regardless of showResponsesToRespondents.
export async function getEventManageDetail(
  eventId: string
): Promise<AvailabilityManageDetail | null> {
  try {
    // Fetch event
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      return null;
    }

    // Fetch slots
    const slots = await getSlotsForEvent(eventId);

    // Fetch all responses
    const allResponseRecords = await getResponsesForEvent(eventId);

    // Fetch invitees (for private events)
    const invitees = await getInviteesForEvent(eventId);

    // Build name map
    const { getAllUsers } = await import('./sheets');
    const users = await getAllUsers();
    const nameMap = new Map<string, string>();
    for (const user of users) {
      if (user.userName) {
        nameMap.set(user.userName, user.fullName || user.userName);
      }
    }

    // Build full participant response grid
    const allResponses = buildParticipantGrid(allResponseRecords, nameMap);

    // Build per-slot response summary
    const slotSummaryMap = new Map<string, { yesCount: number; maybeCount: number; noCount: number }>();
    for (const slot of slots) {
      slotSummaryMap.set(slot.slotId, { yesCount: 0, maybeCount: 0, noCount: 0 });
    }

    for (const rec of allResponseRecords) {
      const summary = slotSummaryMap.get(rec.slotId);
      if (summary) {
        if (rec.response === 'yes') {
          summary.yesCount += 1;
        } else if (rec.response === 'maybe') {
          summary.maybeCount += 1;
        } else if (rec.response === 'no') {
          summary.noCount += 1;
        }
      }
    }

    const responseSummary = slots.map((slot) => {
      const summary = slotSummaryMap.get(slot.slotId);
      return {
        slotId: slot.slotId,
        yesCount: summary ? summary.yesCount : 0,
        maybeCount: summary ? summary.maybeCount : 0,
        noCount: summary ? summary.noCount : 0,
      };
    });

    // Build invitee display names map (for member invitees)
    const inviteeDisplayNames: Record<string, string> = {};
    for (const inv of invitees) {
      if (inv.inviteeType === 'member' && inv.userName) {
        inviteeDisplayNames[inv.userName] = nameMap.get(inv.userName) || inv.userName;
      }
    }

    return {
      event,
      slots,
      allResponses,
      responseSummary,
      invitees,
      inviteeDisplayNames,
    };
  } catch (error) {
    console.error(`[getEventManageDetail] Error for ${eventId}:`, error);
    throw wrapError(`Failed to get manage detail for event ${eventId}`, error);
  }
}

// Build response detail for the guest token page.
// Validates token, fetches event + slots + visitor's own responses.
// Returns null if token is invalid or expired.
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
  try {
    // Validate token
    const invitee = await validateVisitorToken(eventId, token);
    if (!invitee) {
      return null;
    }

    // Fetch event
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      return null;
    }

    // Fetch slots
    const slots = await getSlotsForEvent(eventId);

    // Fetch all responses
    const allResponseRecords = await getResponsesForEvent(eventId);

    // Extract this visitor's own responses (matched by invitee_id)
    const myResponses: Record<string, AvailabilityResponse> = {};
    for (const rec of allResponseRecords) {
      if (rec.respondentType === 'visitor' && rec.inviteeId === invitee.inviteeId) {
        myResponses[rec.slotId] = rec.response;
      }
    }

    // Build allResponses if event shows them
    let allResponses: AvailabilityParticipantResponses[] = [];
    if (event.showResponsesToRespondents) {
      const { getAllUsers } = await import('./sheets');
      const users = await getAllUsers();
      const nameMap = new Map<string, string>();
      for (const user of users) {
        if (user.userName) {
          nameMap.set(user.userName, user.fullName || user.userName);
        }
      }
      allResponses = buildParticipantGrid(allResponseRecords, nameMap);
    }

    // Find concluded slot if applicable
    let concludedSlot: AvailabilitySlot | null = null;
    if (event.concludedSlotId) {
      for (const slot of slots) {
        if (slot.slotId === event.concludedSlotId) {
          concludedSlot = slot;
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
  } catch (error) {
    console.error(`[getEventDetailForVisitor] Error for event ${eventId}:`, error);
    throw wrapError('Failed to get event detail for visitor', error);
  }
}
