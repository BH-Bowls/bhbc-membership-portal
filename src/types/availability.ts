// src/types/availability.ts
// TypeScript types for the Availability Planner v2 feature

// ─── Shared ───────────────────────────────────────────────────────────────────

export type AvailabilityResponse = 'yes' | 'maybe' | 'no';
export type AvailabilityRespondentType = 'member' | 'visitor';

// ─── Groups ───────────────────────────────────────────────────────────────────

export type AvailabilityGroupStatus = 'active' | 'archived';
export type AvailabilityGroupMemberType = 'member' | 'visitor';

// Full group record as stored in the sheet
export interface AvailabilityGroup {
  groupId: string;
  name: string;
  description: string;
  createdByUsername: string;
  allowMemberManagement: boolean;
  teamId: string;               // optional FK to teams — blank by default
  status: AvailabilityGroupStatus;
  createdAt: string;            // ISO timestamp
  updatedAt: string;            // ISO timestamp
}

// One member of a group
export interface AvailabilityGroupMember {
  memberId: string;
  groupId: string;
  memberType: AvailabilityGroupMemberType;
  userName: string;             // blank for visitors
  visitorName: string;          // blank for members
  visitorEmail: string;         // blank for members
  addedByUsername: string;
  createdAt: string;
}

// Summary returned to the groups list / hub page
export interface AvailabilityGroupSummary {
  groupId: string;
  name: string;
  description: string;
  createdByUsername: string;
  status: AvailabilityGroupStatus;
  memberCount: number;
  openEventCount: number;
  isCreator: boolean;           // resolved for the calling user
  canManageMembers: boolean;    // resolved for the calling user
}

// Full group detail returned to the group page
export interface AvailabilityGroupDetail {
  group: AvailabilityGroup;
  members: AvailabilityGroupMember[];
  // Display names resolved for member-type group members
  memberDisplayNames: Record<string, string>;   // userName → displayName
  events: AvailabilityEventSummary[];
  isCreator: boolean;
  canManageMembers: boolean;
}

// Body for creating a group
export interface CreateGroupPayload {
  name: string;
  description: string;
  allowMemberManagement: boolean;
  memberUserNames: string[];    // array of userNames to add immediately
  visitorMembers: Array<{
    visitorName: string;
    visitorEmail: string;
  }>;
}

// Body for adding members to a group
export interface AddGroupMembersPayload {
  memberUserNames: string[];
  visitorMembers: Array<{
    visitorName: string;
    visitorEmail: string;
  }>;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type AvailabilityEventType = 'general' | 'fixture' | 'signup';
export type AvailabilityEventStatus = 'open' | 'closed' | 'concluded' | 'archived';
export type AvailabilityInviteeType = 'member' | 'visitor';
export type AvailabilitySlotType = 'datetime' | 'text';

// Full event record as stored in the sheet
export interface AvailabilityEvent {
  eventId: string;
  title: string;
  description: string;
  createdByUsername: string;
  groupId: string;              // blank for public events
  type: AvailabilityEventType;
  slotType: AvailabilitySlotType; // 'datetime' (default) or 'text'
  status: AvailabilityEventStatus;
  showResponsesToRespondents: boolean;
  notifyCreatorOnResponse: boolean;
  expiresAt: string;            // ISO timestamp
  concludedSlotId: string;
  conclusionNote: string;
  concludedAt: string;          // ISO timestamp
  concludedByUsername: string;
  createdAt: string;
  updatedAt: string;
}

// Summary used in lists (group page event feed, public event list)
export interface AvailabilityEventSummary {
  eventId: string;
  title: string;
  description: string;
  type: AvailabilityEventType;
  status: AvailabilityEventStatus;
  groupId: string;
  createdByUsername: string;
  createdByName: string;        // resolved at read time
  expiresAt: string;
  slotCount: number;
  responseCount: number;
  hasResponded: boolean;        // resolved for calling user
  concludedSlotLabel: string;   // blank until concluded
  concludedSlotDatetime: string;
}

// A single candidate slot (datetime or text option)
export interface AvailabilitySlot {
  slotId: string;
  eventId: string;
  slotDatetime: string | null;  // ISO timestamp; null for text-type slots
  slotLabel: string;
  displayOrder: number;
  createdAt: string;
}

// One person's response to one slot
export interface AvailabilityResponseRecord {
  responseId: string;
  eventId: string;
  slotId: string;
  respondentType: AvailabilityRespondentType;
  userName: string;
  visitorName: string;
  visitorEmail: string;
  response: AvailabilityResponse;
  respondedAt: string;
  updatedAt: string;
  inviteeId: string;
}

// Invitee record (snapshot of who was invited when event was created)
export interface AvailabilityInvitee {
  inviteeId: string;
  eventId: string;
  groupMemberId: string;        // FK to group member — blank for public event additions
  inviteeType: AvailabilityInviteeType;
  userName: string;
  visitorName: string;
  visitorEmail: string;
  token: string;                // blank for members
  tokenExpiresAt: string;       // blank for members
  notifiedAt: string;
  createdAt: string;
}

// One participant's responses across all slots — shown in the response grid
export interface AvailabilityParticipantResponses {
  displayName: string;
  respondentType: AvailabilityRespondentType;
  responses: Record<string, AvailabilityResponse>; // slotId → response
}

// Full event detail returned to the member response page
export interface AvailabilityEventDetail {
  event: AvailabilityEvent;
  slots: AvailabilitySlot[];
  myResponses: Record<string, AvailabilityResponse>; // slotId → response
  // Empty array if show_responses_to_respondents is false and caller is not creator
  allResponses: AvailabilityParticipantResponses[];
  concludedSlot: AvailabilitySlot | null;
}

// Full detail returned to the manage page
export interface AvailabilityManageDetail {
  event: AvailabilityEvent;
  slots: AvailabilitySlot[];
  allResponses: AvailabilityParticipantResponses[];
  responseSummary: Array<{
    slotId: string;
    yesCount: number;
    maybeCount: number;
    noCount: number;
  }>;
  invitees: AvailabilityInvitee[];
  inviteeDisplayNames: Record<string, string>; // userName → displayName
}

// Body for creating an event (group or public)
export interface CreateEventPayload {
  title: string;
  description: string;
  type: AvailabilityEventType;
  slotType: AvailabilitySlotType;
  showResponsesToRespondents: boolean;
  notifyCreatorOnResponse: boolean;
  expiresAt: string;            // ISO timestamp
  slots: Array<{
    slotDatetime?: string | null;
    slotLabel: string;
  }>;
}

// Body for member respond endpoint
export interface MemberRespondPayload {
  responses: Array<{
    slotId: string;
    response: AvailabilityResponse;
  }>;
}

// Body for guest respond endpoint
export interface GuestRespondPayload {
  token: string;
  responses: Array<{
    slotId: string;
    response: AvailabilityResponse;
  }>;
}

// Lightweight summary used for the home-page Open Polls panel
export interface OpenPollSummary {
  eventId: string;
  title: string;
  slotType: AvailabilitySlotType;
  hasResponded: boolean;
  optionCount: number;
  responseCount: number;
  groupName: string | null; // null = public poll
  expiresAt: string;
}

// Body for conclude endpoint
export interface ConcludeEventPayload {
  concludedSlotId: string;
  conclusionNote: string;
  notifyRespondents: boolean;
}
