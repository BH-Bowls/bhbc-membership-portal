// src/lib/availability-events-supabase.ts
// Postgres-backed replacement for availability-events-sheets.ts. Same function names
// and signatures as the Sheets version so the API routes need only an import swap.
// event id stays the human-readable "AV-YYYY-NNN" format (text primary key) — see
// supabase/migrations/0030_availability_planning.sql for why. Slot/response ids are
// ordinary UUIDs (never exposed in a URL). There is no invitees table — the roster is
// the group's members (see availability-groups-supabase.ts), each carrying its own
// response token.

import { getSupabaseClient } from './supabase';
import { getAllUsers, getUserByUsername } from './members-supabase';
import type { User } from './sheets';
import { disambiguateDisplayNames } from './display-name-utils';
import {
  getGroupById,
  canManageGroupMembers,
  getGroupMembers,
  getGroupMemberByToken,
} from './availability-groups-supabase';
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

// ─── ID Generator ───────────────────────────────────────────────────────────────

async function generateEventId(): Promise<string> {
  const supabase = getSupabaseClient();
  const currentYear = new Date().getFullYear();
  const prefix = `AV-${currentYear}-`;

  const { data, error } = await supabase.from('availability_events').select('id').like('id', `${prefix}%`);
  if (error) throw new Error(`Failed to generate event id: ${error.message}`);

  let maxNumber = 0;
  for (const row of data || []) {
    const num = parseInt(row.id.substring(prefix.length), 10);
    if (!isNaN(num) && num > maxNumber) maxNumber = num;
  }
  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`;
}

// ─── Row Mapping ──────────────────────────────────────────────────────────────

function mapEventRow(row: any): AvailabilityEvent {
  return {
    eventId: row.id,
    title: row.title || '',
    description: row.description || '',
    createdByUsername: row.created_by_username || '',
    groupId: row.group_id || '',
    type: (row.type || 'general') as AvailabilityEventType,
    slotType: (row.slot_type || 'datetime') as AvailabilitySlotType,
    status: row.status || 'open',
    showResponsesToRespondents: !!row.show_responses_to_respondents,
    notifyCreatorOnResponse: !!row.notify_creator_on_response,
    expiresAt: row.expires_at || '',
    concludedSlotId: row.concluded_slot_id || '',
    conclusionNote: row.conclusion_note || '',
    concludedAt: row.concluded_at || '',
    concludedByUsername: row.concluded_by_username || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    matchFinder: !!row.is_match_finder,
    offeredSlotIds: row.offered_slot_ids || [],
  };
}

function mapSlotRow(row: any): AvailabilitySlot {
  return {
    slotId: row.id,
    eventId: row.event_id,
    slotDatetime: row.slot_datetime || null,
    slotLabel: row.slot_label || '',
    displayOrder: row.display_order || 0,
    createdAt: row.created_at || '',
  };
}

function mapResponseRow(row: any): AvailabilityResponseRecord {
  return {
    responseId: row.id,
    eventId: row.event_id,
    slotId: row.slot_id,
    respondentType: row.respondent_type || 'member',
    userName: row.username || '',
    visitorName: row.visitor_name || '',
    visitorEmail: row.visitor_email || '',
    response: (row.response || 'no') as AvailabilityResponse,
    respondedAt: row.responded_at || '',
    updatedAt: row.updated_at || '',
    inviteeId: '',   // legacy field — there has never been an invitees table
  };
}

// ─── Event Functions ────────────────────────────────────────────────────────────

/** Fetch all events for a group (status != 'archived'), newest first. */
export async function getGroupEvents(groupId: string, callerUserName: string): Promise<AvailabilityEventSummary[]> {
  const supabase = getSupabaseClient();

  const [eventsResp, slotsResp, responsesResp, allUsers] = await Promise.all([
    supabase.from('availability_events').select('*').eq('group_id', groupId).neq('status', 'archived').order('created_at', { ascending: false }),
    supabase.from('availability_slots').select('id, event_id'),
    supabase.from('availability_responses').select('event_id, username, respondent_type, visitor_email'),
    getAllUsers(),
  ]);
  if (eventsResp.error) throw new Error(`Failed to fetch group events: ${eventsResp.error.message}`);
  if (slotsResp.error) throw new Error(`Failed to fetch slots: ${slotsResp.error.message}`);
  if (responsesResp.error) throw new Error(`Failed to fetch responses: ${responsesResp.error.message}`);

  const userNameToDisplay: Record<string, string> = {};
  for (const u of allUsers) {
    if (u.userName) userNameToDisplay[u.userName] = u.fullKnownAs || u.fullName || u.userName;
  }

  const slotCountMap: Record<string, number> = {};
  for (const row of slotsResp.data || []) {
    if (row.event_id) slotCountMap[row.event_id] = (slotCountMap[row.event_id] || 0) + 1;
  }

  const responseCountMap: Record<string, Set<string>> = {};
  const hasRespondedMap: Record<string, boolean> = {};
  for (const row of responsesResp.data || []) {
    if (!row.event_id) continue;
    if (!responseCountMap[row.event_id]) responseCountMap[row.event_id] = new Set();
    let uniqueKey = '';
    if (row.respondent_type === 'member' && row.username) {
      uniqueKey = `member:${row.username}`;
      if (row.username === callerUserName) hasRespondedMap[row.event_id] = true;
    } else if (row.visitor_email) {
      uniqueKey = `visitor:${row.visitor_email}`;
    }
    if (uniqueKey) responseCountMap[row.event_id].add(uniqueKey);
  }

  const results: AvailabilityEventSummary[] = [];
  for (const row of eventsResp.data || []) {
    const eventId = row.id;
    const createdByUsername = row.created_by_username || '';
    const responseSet = responseCountMap[eventId];
    results.push({
      eventId,
      title: row.title || '',
      description: row.description || '',
      type: (row.type || 'general') as AvailabilityEventType,
      status: row.status || 'open',
      groupId: row.group_id || '',
      createdByUsername,
      createdByName: userNameToDisplay[createdByUsername] || createdByUsername,
      expiresAt: row.expires_at || '',
      slotCount: slotCountMap[eventId] || 0,
      responseCount: responseSet ? responseSet.size : 0,
      hasResponded: hasRespondedMap[eventId] === true,
      concludedSlotLabel: row.conclusion_note || '',
      concludedSlotDatetime: row.concluded_at || '',
    });
  }

  return results;
}

/** Fetch a single event by id. Returns null if not found. */
export async function getEventById(eventId: string): Promise<AvailabilityEvent | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('availability_events').select('*').eq('id', eventId).maybeSingle();
  if (error) throw new Error(`Failed to fetch event: ${error.message}`);
  if (!data) return null;
  return mapEventRow(data);
}

/** Create a new event. Returns the generated id. */
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
  const supabase = getSupabaseClient();
  const eventId = await generateEventId();

  const { error } = await supabase.from('availability_events').insert({
    id: eventId,
    title: data.title,
    description: data.description || null,
    created_by_username: data.createdByUsername,
    group_id: data.groupId || null,
    type: data.type,
    slot_type: data.slotType || 'datetime',
    status: 'open',
    show_responses_to_respondents: data.showResponsesToRespondents,
    notify_creator_on_response: data.notifyCreatorOnResponse,
    expires_at: data.expiresAt || null,
    is_match_finder: !!data.matchFinder,
  });
  if (error) throw new Error(`Failed to create event: ${error.message}`);

  return eventId;
}

/** Update event fields. Sets updated_at. */
export async function updateEvent(
  eventId: string,
  updates: Partial<Pick<AvailabilityEvent,
    'title' | 'description' | 'type' | 'showResponsesToRespondents' |
    'notifyCreatorOnResponse' | 'expiresAt' | 'status'
  >>
): Promise<void> {
  const supabase = getSupabaseClient();
  const columnUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (updates.title !== undefined) columnUpdates.title = updates.title;
  if (updates.description !== undefined) columnUpdates.description = updates.description;
  if (updates.type !== undefined) columnUpdates.type = updates.type;
  if (updates.showResponsesToRespondents !== undefined) columnUpdates.show_responses_to_respondents = updates.showResponsesToRespondents;
  if (updates.notifyCreatorOnResponse !== undefined) columnUpdates.notify_creator_on_response = updates.notifyCreatorOnResponse;
  if (updates.expiresAt !== undefined) columnUpdates.expires_at = updates.expiresAt || null;
  if (updates.status !== undefined) columnUpdates.status = updates.status;

  const { error } = await supabase.from('availability_events').update(columnUpdates).eq('id', eventId);
  if (error) throw new Error(`Failed to update event: ${error.message}`);
}

/** Mark event as concluded. Sets all conclusion-related fields. */
export async function concludeEvent(
  eventId: string,
  concludedSlotId: string,
  conclusionNote: string,
  concludedByUsername: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('availability_events')
    .update({
      status: 'concluded',
      concluded_slot_id: concludedSlotId,
      conclusion_note: conclusionNote,
      concluded_at: now,
      concluded_by_username: concludedByUsername,
      updated_at: now,
    })
    .eq('id', eventId);
  if (error) throw new Error(`Failed to conclude event: ${error.message}`);
}

/** Clear conclusion fields when reopening an event. */
export async function clearConclusionFields(eventId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('availability_events')
    .update({
      concluded_slot_id: null,
      conclusion_note: null,
      concluded_at: null,
      concluded_by_username: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId);
  if (error) throw new Error(`Failed to clear conclusion fields: ${error.message}`);
}

/**
 * Permanently delete an event. Cascades (via FK ON DELETE CASCADE) to its slots and
 * responses. Irreversible — the caller is responsible for confirming with the user first.
 */
export async function deleteEvent(eventId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('availability_events').delete().eq('id', eventId);
  if (error) throw new Error(`Failed to delete event: ${error.message}`);
}

/** Persist the organiser's chosen "offered" slots for a match-finder event. */
export async function setOfferedSlots(eventId: string, slotIds: string[]): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('availability_events')
    .update({ offered_slot_ids: slotIds, updated_at: new Date().toISOString() })
    .eq('id', eventId);
  if (error) throw new Error(`Failed to set offered slots: ${error.message}`);
}

// ─── Slot Functions ──────────────────────────────────────────────────────────────

/** Fetch all slots for an event, ordered by display_order ascending. */
export async function getSlotsForEvent(eventId: string): Promise<AvailabilitySlot[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('availability_slots')
    .select('*')
    .eq('event_id', eventId)
    .order('display_order');
  if (error) throw new Error(`Failed to fetch slots: ${error.message}`);
  return (data || []).map(mapSlotRow);
}

/** Append one slot. Returns generated slot id. slotDatetime may be null for text-type polls. */
export async function addSlot(
  eventId: string,
  slotDatetime: string | null,
  slotLabel: string,
  displayOrder: number
): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('availability_slots')
    .insert({ event_id: eventId, slot_datetime: slotDatetime, slot_label: slotLabel, display_order: displayOrder })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to add slot: ${error.message}`);
  return data.id;
}

/** Append many slots in a single call — used when creating a poll's slots. */
export async function addSlots(
  eventId: string,
  slots: Array<{ slotDatetime: string | null; slotLabel: string; displayOrder: number }>
): Promise<void> {
  if (slots.length === 0) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('availability_slots').insert(
    slots.map((s) => ({ event_id: eventId, slot_datetime: s.slotDatetime, slot_label: s.slotLabel, display_order: s.displayOrder }))
  );
  if (error) throw new Error(`Failed to add slots: ${error.message}`);
}

/** Update an existing slot's datetime and/or label. */
export async function updateSlot(slotId: string, slotDatetime: string | null, slotLabel: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('availability_slots')
    .update({ slot_datetime: slotDatetime, slot_label: slotLabel })
    .eq('id', slotId);
  if (error) throw new Error(`Failed to update slot: ${error.message}`);
}

/** Delete a slot. Cascades to delete its responses (FK on delete cascade). */
export async function deleteSlot(slotId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('availability_slots').delete().eq('id', slotId);
  if (error) throw new Error(`Failed to delete slot: ${error.message}`);
}

// ─── Response Functions ──────────────────────────────────────────────────────────

/** Fetch all responses for an event. */
export async function getResponsesForEvent(eventId: string): Promise<AvailabilityResponseRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('availability_responses').select('*').eq('event_id', eventId);
  if (error) throw new Error(`Failed to fetch responses: ${error.message}`);
  return (data || []).map(mapResponseRow);
}

/** Upsert a member's response for a slot. Matches on (event_id, slot_id, username). */
export async function upsertMemberResponse(
  eventId: string,
  slotId: string,
  userName: string,
  response: AvailabilityResponse
): Promise<void> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from('availability_responses').upsert(
    {
      event_id: eventId,
      slot_id: slotId,
      respondent_type: 'member',
      username: userName,
      response,
      responded_at: now,
      updated_at: now,
    },
    { onConflict: 'event_id,slot_id,username' }
  );
  if (error) throw new Error(`Failed to save response: ${error.message}`);
}

/** Delete a member's response for a slot (clears a previously-saved choice). No-op if not found. */
export async function deleteMemberResponse(eventId: string, slotId: string, userName: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('availability_responses')
    .delete()
    .eq('event_id', eventId)
    .eq('slot_id', slotId)
    .eq('respondent_type', 'member')
    .eq('username', userName);
  if (error) throw new Error(`Failed to delete response: ${error.message}`);
}

/** Delete a visitor's saved response for one slot. No-op if not found. */
export async function deleteVisitorResponse(eventId: string, slotId: string, visitorEmail: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('availability_responses')
    .delete()
    .eq('event_id', eventId)
    .eq('slot_id', slotId)
    .eq('respondent_type', 'visitor')
    .eq('visitor_email', visitorEmail);
  if (error) throw new Error(`Failed to delete visitor response: ${error.message}`);
}

/** Upsert a visitor's response. Matches on (event_id, slot_id, visitor_email). */
export async function upsertVisitorResponse(
  eventId: string,
  slotId: string,
  visitorName: string,
  visitorEmail: string,
  response: AvailabilityResponse
): Promise<void> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from('availability_responses').upsert(
    {
      event_id: eventId,
      slot_id: slotId,
      respondent_type: 'visitor',
      visitor_name: visitorName,
      visitor_email: visitorEmail,
      response,
      responded_at: now,
      updated_at: now,
    },
    { onConflict: 'event_id,slot_id,visitor_email' }
  );
  if (error) throw new Error(`Failed to save visitor response: ${error.message}`);
}

// ─── Roster + Token Functions ────────────────────────────────────────────────────

/**
 * Build an event's roster directly from LIVE group membership. There is no invitees
 * table — the group members ARE the roster. The per-member token is never included
 * here — it stays server-side (used only for email links + validation).
 */
export async function getEventRoster(event: AvailabilityEvent): Promise<AvailabilityInvitee[]> {
  if (!event.groupId) return [];
  const members = await getGroupMembers(event.groupId);
  return members.map((m) => ({
    inviteeId: m.memberId,
    eventId: event.eventId,
    groupMemberId: m.memberId,
    inviteeType: m.memberType,
    userName: m.userName,
    visitorName: m.visitorName,
    visitorEmail: m.visitorEmail,
    token: '',
    tokenExpiresAt: '',
    notifiedAt: '',
    createdAt: m.createdAt || '',
  }));
}

/**
 * Validate a response-link token. Resolves the group member holding it, then checks
 * that member's group owns this event and the group is still active.
 */
export async function validateGroupMemberToken(eventId: string, token: string): Promise<AvailabilityGroupMember | null> {
  const event = await getEventById(eventId);
  if (!event || !event.groupId) return null;
  const member = await getGroupMemberByToken(token);
  if (!member) return null;
  if (member.groupId !== event.groupId) return null;
  const group = await getGroupById(event.groupId);
  if (!group || group.status === 'archived') return null;
  return member;
}

// ─── Composite Read Functions ─────────────────────────────────────────────────────

/**
 * Build a userName -> display-name map for a poll's roster, disambiguating shared
 * first names against each other only.
 */
function buildRosterDisplayNames(userNames: string[], allUsers: User[]): Record<string, string> {
  const byUser: Record<string, User> = {};
  for (const u of allUsers) {
    if (u.userName) byUser[u.userName] = u;
  }
  const seen: Record<string, boolean> = {};
  const people: Array<{ userName: string; firstName: string; lastName: string }> = [];
  for (const un of userNames) {
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

/** Fetch an event plus its slots and responses in one round trip. */
async function fetchEventBundle(eventId: string): Promise<{
  event: AvailabilityEvent;
  slots: AvailabilitySlot[];
  responses: AvailabilityResponseRecord[];
} | null> {
  const event = await getEventById(eventId);
  if (!event) return null;

  const [slots, responses] = await Promise.all([getSlotsForEvent(eventId), getResponsesForEvent(eventId)]);
  return { event, slots, responses };
}

/** Build AvailabilityEventDetail for the member response page. */
export async function getEventDetailForMember(
  eventId: string,
  callerUserName: string,
  callerRole: string = ''
): Promise<AvailabilityEventDetail | null> {
  const bundle = await fetchEventBundle(eventId);
  if (!bundle) return null;
  const { event, slots, responses: allResponseRecords } = bundle;

  const myResponses: Record<string, AvailabilityResponse> = {};
  for (const rec of allResponseRecords) {
    if (rec.respondentType === 'member' && rec.userName === callerUserName) {
      myResponses[rec.slotId] = rec.response;
    }
  }

  const isCreator = event.createdByUsername === callerUserName;
  const showAll = event.showResponsesToRespondents || isCreator;

  let invitees: AvailabilityInvitee[] = [];
  if (event.groupId) {
    invitees = await getEventRoster(event);
  }

  const rosterUserNames: string[] = [callerUserName];
  for (const rec of allResponseRecords) {
    if (rec.respondentType === 'member' && rec.userName) rosterUserNames.push(rec.userName);
  }
  for (const inv of invitees) {
    if (inv.inviteeType === 'member' && inv.userName) rosterUserNames.push(inv.userName);
  }
  const allUsers = await getAllUsers();
  const userNameToDisplay = buildRosterDisplayNames(rosterUserNames, allUsers);

  let allResponses: AvailabilityParticipantResponses[] = [];
  if (showAll) {
    const participantMap: Record<string, AvailabilityParticipantResponses> = {};
    for (const rec of allResponseRecords) {
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
    const callerKey = `member:${callerUserName}`;
    for (const key of Object.keys(participantMap)) {
      if (key !== callerKey) allResponses.push(participantMap[key]);
    }
  }

  let concludedSlot: AvailabilitySlot | null = null;
  if (event.concludedSlotId) {
    concludedSlot = slots.find((s) => s.slotId === event.concludedSlotId) || null;
  }

  const inviteeDisplayNames: Record<string, string> = {};
  let canManageGroup = false;
  if (event.groupId) {
    for (const inv of invitees) {
      if (inv.inviteeType === 'member' && inv.userName) {
        inviteeDisplayNames[inv.userName] = userNameToDisplay[inv.userName] || inv.userName;
      }
    }
    const group = await getGroupById(event.groupId);
    if (group) {
      canManageGroup = await canManageGroupMembers(group, callerUserName, callerRole);
    }
  }

  return { event, slots, myResponses, allResponses, concludedSlot, invitees, inviteeDisplayNames, canManageGroup };
}

/** Build AvailabilityManageDetail for the manage page — always the full response grid. */
export async function getEventManageDetail(eventId: string): Promise<AvailabilityManageDetail | null> {
  const bundle = await fetchEventBundle(eventId);
  if (!bundle) return null;
  const { event, slots, responses: allResponseRecords } = bundle;

  const invitees = await getEventRoster(event);

  const rosterUserNames: string[] = [];
  for (const inv of invitees) {
    if (inv.inviteeType === 'member' && inv.userName) rosterUserNames.push(inv.userName);
  }
  for (const rec of allResponseRecords) {
    if (rec.respondentType === 'member' && rec.userName) rosterUserNames.push(rec.userName);
  }
  const allUsers = await getAllUsers();
  const userNameToDisplay = buildRosterDisplayNames(rosterUserNames, allUsers);

  const inviteeDisplayNames: Record<string, string> = {};
  for (const inv of invitees) {
    if (inv.inviteeType === 'member' && inv.userName) {
      inviteeDisplayNames[inv.userName] = userNameToDisplay[inv.userName] || inv.userName;
    }
  }

  const participantMap: Record<string, AvailabilityParticipantResponses> = {};
  for (const rec of allResponseRecords) {
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

  const responseSummary: Array<{ slotId: string; yesCount: number; maybeCount: number; noCount: number }> = [];
  for (const slot of slots) {
    let yesCount = 0, maybeCount = 0, noCount = 0;
    for (const rec of allResponseRecords) {
      if (rec.slotId !== slot.slotId) continue;
      if (rec.response === 'yes') yesCount++;
      else if (rec.response === 'maybe') maybeCount++;
      else if (rec.response === 'no') noCount++;
    }
    responseSummary.push({ slotId: slot.slotId, yesCount, maybeCount, noCount });
  }

  return { event, slots, allResponses, responseSummary, invitees, inviteeDisplayNames };
}

/** Build response detail for the guest/member-token page. Validates token, null if invalid. */
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
  const member = await validateGroupMemberToken(eventId, token);
  if (!member) return null;

  const event = await getEventById(eventId);
  if (!event) return null;

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

  const [slots, allResponseRecords] = await Promise.all([getSlotsForEvent(eventId), getResponsesForEvent(eventId)]);

  const isMemberInvitee = member.memberType === 'member';
  const myResponses: Record<string, AvailabilityResponse> = {};
  for (const rec of allResponseRecords) {
    if (isMemberInvitee) {
      if (rec.respondentType === 'member' && rec.userName === member.userName) myResponses[rec.slotId] = rec.response;
    } else {
      if (rec.respondentType === 'visitor' && rec.visitorEmail === member.visitorEmail) myResponses[rec.slotId] = rec.response;
    }
  }

  if (isMemberInvitee && member.userName) {
    const memberUser = await getUserByUsername(member.userName);
    if (memberUser) {
      invitee.visitorName = memberUser.fullKnownAs || memberUser.fullName || member.userName;
    }
  }

  let allResponses: AvailabilityParticipantResponses[] = [];
  if (event.showResponsesToRespondents) {
    const rosterUserNames: string[] = [];
    for (const rec of allResponseRecords) {
      if (rec.respondentType === 'member' && rec.userName) rosterUserNames.push(rec.userName);
    }
    const allUsers = await getAllUsers();
    const userNameToDisplay = buildRosterDisplayNames(rosterUserNames, allUsers);

    const participantMap: Record<string, AvailabilityParticipantResponses> = {};
    for (const rec of allResponseRecords) {
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

  let concludedSlot: AvailabilitySlot | null = null;
  if (event.concludedSlotId) {
    concludedSlot = slots.find((s) => s.slotId === event.concludedSlotId) || null;
  }

  return { event, slots, invitee, myResponses, allResponses, concludedSlot };
}

/**
 * Return open polls (group) the given member is invited to, still awaiting their response
 * (not expired, not yet responded). Used by the home page's Open Polls panel — a poll the
 * member has already answered, or that's past its expiry, has nothing left for them to do.
 */
export async function getOpenPollsForMember(callerUserName: string): Promise<OpenPollSummary[]> {
  const supabase = getSupabaseClient();

  const [eventsResp, slotsResp, responsesResp, membersResp, groupsResp] = await Promise.all([
    supabase.from('availability_events').select('*').eq('status', 'open'),
    supabase.from('availability_slots').select('event_id'),
    supabase.from('availability_responses').select('event_id, respondent_type, username, visitor_email'),
    supabase.from('availability_group_members').select('group_id, username'),
    supabase.from('availability_groups').select('id, name'),
  ]);
  if (eventsResp.error) throw new Error(`Failed to fetch open polls: ${eventsResp.error.message}`);
  if (slotsResp.error) throw new Error(`Failed to fetch slots: ${slotsResp.error.message}`);
  if (responsesResp.error) throw new Error(`Failed to fetch responses: ${responsesResp.error.message}`);
  if (membersResp.error) throw new Error(`Failed to fetch group members: ${membersResp.error.message}`);
  if (groupsResp.error) throw new Error(`Failed to fetch groups: ${groupsResp.error.message}`);

  const groupNames: Record<string, string> = {};
  for (const g of groupsResp.data || []) groupNames[g.id] = g.name;

  const optionCountMap: Record<string, number> = {};
  for (const row of slotsResp.data || []) {
    if (row.event_id) optionCountMap[row.event_id] = (optionCountMap[row.event_id] || 0) + 1;
  }

  const respCountMap: Record<string, Set<string>> = {};
  const hasRespondedSet = new Set<string>();
  for (const row of responsesResp.data || []) {
    if (!row.event_id) continue;
    if (!respCountMap[row.event_id]) respCountMap[row.event_id] = new Set();
    const key = row.respondent_type === 'member' && row.username ? `m:${row.username}` : row.visitor_email ? `v:${row.visitor_email}` : '';
    if (key) respCountMap[row.event_id].add(key);
    if (row.respondent_type === 'member' && row.username === callerUserName) hasRespondedSet.add(row.event_id);
  }

  const callerGroupIds = new Set<string>();
  for (const row of membersResp.data || []) {
    if (row.username && row.username.toLowerCase() === callerUserName.toLowerCase() && row.group_id) {
      callerGroupIds.add(row.group_id);
    }
  }

  const results: OpenPollSummary[] = [];
  for (const row of eventsResp.data || []) {
    const groupId = row.group_id;
    if (!groupId || !callerGroupIds.has(groupId)) continue;
    if (hasRespondedSet.has(row.id)) continue;
    if (row.expires_at && new Date(row.expires_at) < new Date()) continue;
    results.push({
      eventId: row.id,
      title: row.title || 'Poll',
      slotType: (row.slot_type || 'datetime') as AvailabilitySlotType,
      hasResponded: hasRespondedSet.has(row.id),
      optionCount: optionCountMap[row.id] || 0,
      responseCount: respCountMap[row.id] ? respCountMap[row.id].size : 0,
      groupName: groupId ? (groupNames[groupId] || null) : null,
      expiresAt: row.expires_at || '',
    });
  }

  // Most recently created first
  results.sort((a, b) => (a.eventId < b.eventId ? 1 : -1));

  return results;
}
