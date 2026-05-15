// src/types/availability.ts
// TypeScript types for the Availability Planner feature

export type AvailabilityEventStatus = 'open' | 'closed' | 'concluded' | 'archived';
export type AvailabilityVisibility = 'public' | 'private';
export type AvailabilityResponse = 'yes' | 'maybe' | 'no';
export type AvailabilityRespondentType = 'member' | 'visitor';
export type AvailabilityInviteeType = 'member' | 'visitor';

// Full event record as stored in the sheet
export interface AvailabilityEvent {
  eventId: string;
  title: string;
  description: string;
  createdByUsername: string;
  createdByName: string;        // resolved at read time — not stored
  visibility: AvailabilityVisibility;
  status: AvailabilityEventStatus;
  showResponsesToRespondents: boolean;
  notifyCreatorOnResponse: boolean;
  expiresAt: string;            // ISO timestamp
  concludedSlotId: string;
  conclusionNote: string;
  concludedAt: string;          // ISO timestamp
  concludedByUsername: string;
  createdAt: string;            // ISO timestamp
  updatedAt: string;            // ISO timestamp
}

// A single candidate date/time slot
export interface AvailabilitySlot {
  slotId: string;
  eventId: string;
  slotDatetime: string;         // ISO timestamp
  slotLabel: string;            // if blank, UI formats slotDatetime
  displayOrder: number;
  createdAt: string;
}

// One person's response to one slot
export interface AvailabilityResponseRecord {
  responseId: string;
  eventId: string;
  slotId: string;
  respondentType: AvailabilityRespondentType;
  userName: string;             // blank for visitors
  visitorName: string;          // blank for members
  visitorEmail: string;         // blank for members
  response: AvailabilityResponse;
  respondedAt: string;
  updatedAt: string;
  inviteeId: string;
}

// Invitee record (private events only)
export interface AvailabilityInvitee {
  inviteeId: string;
  eventId: string;
  inviteeType: AvailabilityInviteeType;
  userName: string;             // blank for visitors
  visitorName: string;          // blank for members
  visitorEmail: string;         // blank for members
  token: string;                // blank for members
  tokenExpiresAt: string;       // blank for members
  notifiedAt: string;
  createdAt: string;
}

// Shape passed to the create-event API
export interface CreateEventPayload {
  title: string;
  description: string;
  visibility: AvailabilityVisibility;
  showResponsesToRespondents: boolean;
  notifyCreatorOnResponse: boolean;
  expiresAt: string;            // ISO timestamp
  slots: Array<{
    slotDatetime: string;       // ISO timestamp
    slotLabel: string;
  }>;
  // Only present if visibility === 'private'
  memberInvitees: string[];     // array of userNames
  visitorInvitees: Array<{
    visitorName: string;
    visitorEmail: string;
  }>;
}

// Shape returned to the member event list page
export interface AvailabilityEventSummary {
  eventId: string;
  title: string;
  description: string;
  createdByName: string;
  visibility: AvailabilityVisibility;
  status: AvailabilityEventStatus;
  expiresAt: string;
  slotCount: number;
  responseCount: number;
  // Whether the current logged-in member has responded to at least one slot
  hasResponded: boolean;
  // For private events — whether the current user is on the invitee list
  isInvited: boolean;
  // Set on concluded events
  concludedSlotLabel: string;
  concludedSlotDatetime: string;
}

// Full event detail returned to the response page
export interface AvailabilityEventDetail {
  event: AvailabilityEvent;
  slots: AvailabilitySlot[];
  // The current user's responses, keyed by slotId
  myResponses: Record<string, AvailabilityResponse>;
  // If show_responses_to_respondents === 'Y', also return other responses
  allResponses: AvailabilityParticipantResponses[];
  // The concluded slot detail (if event is concluded)
  concludedSlot: AvailabilitySlot | null;
}

// One participant's responses across all slots — shown in the grid
export interface AvailabilityParticipantResponses {
  displayName: string;          // member full name or visitor name
  respondentType: AvailabilityRespondentType;
  // Map of slotId → response (may have gaps if not responded to all slots)
  responses: Record<string, AvailabilityResponse>;
}

// Shape returned to the manage page
export interface AvailabilityManageDetail {
  event: AvailabilityEvent;
  slots: AvailabilitySlot[];
  // Full response grid — all participants, all slots
  allResponses: AvailabilityParticipantResponses[];
  // Raw response records (for totals per slot)
  responseSummary: Array<{
    slotId: string;
    yesCount: number;
    maybeCount: number;
    noCount: number;
  }>;
  // For private events, the invitee list
  invitees: AvailabilityInvitee[];
  // Names resolved for member invitees
  inviteeDisplayNames: Record<string, string>; // userName → displayName
}

// Body for the guest respond endpoint
export interface GuestRespondPayload {
  token: string;
  responses: Array<{
    slotId: string;
    response: AvailabilityResponse;
  }>;
}

// Body for the member respond endpoint
export interface MemberRespondPayload {
  responses: Array<{
    slotId: string;
    response: AvailabilityResponse;
  }>;
}

// Body for the conclude endpoint
export interface ConcludeEventPayload {
  concludedSlotId: string;
  conclusionNote: string;       // may be empty string
  notifyRespondents: boolean;
}
