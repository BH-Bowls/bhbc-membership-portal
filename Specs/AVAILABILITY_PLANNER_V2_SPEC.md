# Availability Planner v2 — Full Implementation Spec

> Target codebase: BHBC Membership Portal (Next.js 14/15, App Router, TypeScript, Google Sheets, Nodemailer)
> Read `CODING_STANDARDS.md`, `CLAUDE.md`, `SCHEMA.md`, and `PROJECT_OVERVIEW.md` before implementing anything.
> Every rule in those documents applies here without exception.

---

## Table of Contents

1. [Cleanup — Remove Previous Implementation](#1-cleanup--remove-previous-implementation)
2. [Feature Overview](#2-feature-overview)
3. [Environment Variable](#3-environment-variable)
4. [Google Sheets — New Spreadsheet](#4-google-sheets--new-spreadsheet)
5. [TypeScript Types](#5-typescript-types)
6. [Data Layer](#6-data-layer)
7. [API Routes](#7-api-routes)
8. [Pages](#8-pages)
9. [Email Templates](#9-email-templates)
10. [Middleware Update](#10-middleware-update)
11. [Navigation Update](#11-navigation-update)
12. [Help Page](#12-help-page)
13. [Build Order](#13-build-order)
14. [Coding Standards Reminders](#14-coding-standards-reminders)

---

## 1. Cleanup — Remove Previous Implementation

Before writing any new code, delete the previous availability implementation entirely.

**Delete these directories and files:**

```
app/availability/
app/api/availability/
src/lib/availability-sheets.ts
src/types/availability.ts
src/lib/email/templates/availability-invite.html
src/lib/email/templates/availability-conclusion.html
src/lib/email/templates/availability-response-notification.html
```

**Revert additions to these files:**

- `middleware.ts` — remove the `/availability/guest/:path*` public route entry
- The Navbar component (check `src/components/`) — remove the Availability nav link
- `.env.local` — remove `AVAILABILITY_SPREADSHEET_ID`
- `.env.local.example` — remove `AVAILABILITY_SPREADSHEET_ID`

After cleanup, verify the app builds and runs without errors before proceeding.

---

## 2. Feature Overview

A WhatsApp-poll-style availability planner. **Groups are the primary object.** Events (availability polls) are created within a group and automatically sent to all group members. Public events (visible to all members, no group) also exist for club-wide polls.

### Key Rules

- **Any member** can create a group or a public event.
- A **group** is a saved, reusable list of people — members (by username) and/or visitors (by name + email). Groups persist across multiple events, eliminating the need to rebuild invitee lists each time.
- **Group events** are created within a group. All current group members are automatically invited when the event is created. If a new person is added to a group that has open events, they are automatically invited to those open events.
- **Public events** are visible to all logged-in members. No invitee list required. Members respond by logging in. Visitors cannot be invited to public events.
- The group creator sets whether other group members can manage group membership (`allow_member_management`).
- Any group member can create an event within the group.
- Events have a **type**: `general`, `fixture`, or `signup` — for categorisation and future fixture creation integration.
- Groups have an optional `team_id` field for future linking to the existing league/team structure.
- Events have Yes / Maybe / No responses per slot.
- The creator can optionally enable **"Notify me when someone responds"** — a transactional email per response save. Disabled by default.
- The creator can **conclude** an event by nominating a winning slot and optionally notifying all respondents.
- Visitor tokens are scoped per event and expire when the event expires.
- Expired events are read-only. No responses accepted.

---

## 3. Environment Variable

Add one new environment variable. Follow the existing getter pattern — no inline `process.env` in data-layer code.

```
AVAILABILITY_SPREADSHEET_ID=<google-sheets-id>
```

Add getters to both data layer files:

```typescript
// Returns the Availability spreadsheet ID, throws if not configured
function getSpreadsheetId(): string {
  const id = process.env.AVAILABILITY_SPREADSHEET_ID;
  if (!id) {
    throw new Error('AVAILABILITY_SPREADSHEET_ID environment variable is not set');
  }
  return id;
}
```

Add `AVAILABILITY_SPREADSHEET_ID` to `.env.local.example` with a descriptive comment.

---

## 4. Google Sheets — New Spreadsheet

Create a new Google Spreadsheet. Share it with the service account email (same as all other spreadsheets). Add the spreadsheet ID as `AVAILABILITY_SPREADSHEET_ID` in `.env.local`.

The spreadsheet contains **six sheets**. Create them with exactly the column headers listed below — the dynamic column-map system reads the header row and normalises to `snake_case`.

### 4.1 Sheet: `AvailabilityGroups`

Row 1 header. Data from row 2. Range `A2:I`.

| Column header (exact) | Normalised key | Type | Notes |
|---|---|---|---|
| `Group ID` | `group_id` | String | `AG-YYYY-NNN`. Resets each calendar year. |
| `Name` | `name` | String | Group display name |
| `Description` | `description` | String | Optional |
| `Created By Username` | `created_by_username` | String | FK → `Members.user_name` |
| `Allow Member Management` | `allow_member_management` | String | `Y` or `N` — if `Y`, any group member can add/remove people |
| `Team ID` | `team_id` | String | Optional FK to existing teams structure. Blank by default. Reserved for future fixture integration. |
| `Status` | `status` | String | `active` or `archived` |
| `Created At` | `created_at` | String | ISO timestamp |
| `Updated At` | `updated_at` | String | ISO timestamp — blank on creation |

### 4.2 Sheet: `AvailabilityGroupMembers`

Row 1 header. Data from row 2. Range `A2:H`.

| Column header (exact) | Normalised key | Type | Notes |
|---|---|---|---|
| `Member ID` | `member_id` | String | `AGM-NNNNNN`. Never resets. |
| `Group ID` | `group_id` | String | FK → `AvailabilityGroups.group_id` |
| `Member Type` | `member_type` | String | `member` or `visitor` |
| `User Name` | `user_name` | String | FK → `Members.user_name` — blank for visitors |
| `Visitor Name` | `visitor_name` | String | Blank for members |
| `Visitor Email` | `visitor_email` | String | Blank for members |
| `Added By Username` | `added_by_username` | String | FK → `Members.user_name` |
| `Created At` | `created_at` | String | ISO timestamp |

### 4.3 Sheet: `AvailabilityEvents`

Row 1 header. Data from row 2. Range `A2:P`.

| Column header (exact) | Normalised key | Type | Notes |
|---|---|---|---|
| `Event ID` | `event_id` | String | `AV-YYYY-NNN`. Resets each calendar year. |
| `Title` | `title` | String | |
| `Description` | `description` | String | Optional |
| `Created By Username` | `created_by_username` | String | FK → `Members.user_name` |
| `Group ID` | `group_id` | String | FK → `AvailabilityGroups.group_id` — blank for public events |
| `Type` | `type` | String | `general`, `fixture`, or `signup` |
| `Status` | `status` | String | `open`, `closed`, `concluded`, `archived` |
| `Show Responses To Respondents` | `show_responses_to_respondents` | String | `Y` or `N` |
| `Notify Creator On Response` | `notify_creator_on_response` | String | `Y` or `N` |
| `Expires At` | `expires_at` | String | ISO timestamp |
| `Concluded Slot ID` | `concluded_slot_id` | String | FK → `AvailabilitySlots.slot_id` — blank until concluded |
| `Conclusion Note` | `conclusion_note` | String | Optional — blank until concluded |
| `Concluded At` | `concluded_at` | String | ISO timestamp — blank until concluded |
| `Concluded By Username` | `concluded_by_username` | String | FK → `Members.user_name` — blank until concluded |
| `Created At` | `created_at` | String | ISO timestamp |
| `Updated At` | `updated_at` | String | ISO timestamp — blank on creation |

### 4.4 Sheet: `AvailabilitySlots`

Row 1 header. Data from row 2. Range `A2:F`.

| Column header (exact) | Normalised key | Type | Notes |
|---|---|---|---|
| `Slot ID` | `slot_id` | String | `AVS-NNNNNN`. Never resets. |
| `Event ID` | `event_id` | String | FK → `AvailabilityEvents.event_id` |
| `Slot Datetime` | `slot_datetime` | String | ISO timestamp |
| `Slot Label` | `slot_label` | String | Optional override. If blank, UI formats `slot_datetime`. |
| `Display Order` | `display_order` | Integer | 1-based |
| `Created At` | `created_at` | String | ISO timestamp |

### 4.5 Sheet: `AvailabilityResponses`

Row 1 header. Data from row 2. Range `A2:K`.

| Column header (exact) | Normalised key | Type | Notes |
|---|---|---|---|
| `Response ID` | `response_id` | String | `AVR-NNNNNN`. Never resets. |
| `Event ID` | `event_id` | String | FK → `AvailabilityEvents.event_id` |
| `Slot ID` | `slot_id` | String | FK → `AvailabilitySlots.slot_id` |
| `Respondent Type` | `respondent_type` | String | `member` or `visitor` |
| `User Name` | `user_name` | String | FK → `Members.user_name` — blank for visitors |
| `Visitor Name` | `visitor_name` | String | Blank for members |
| `Visitor Email` | `visitor_email` | String | Blank for members |
| `Response` | `response` | String | `yes`, `maybe`, or `no` |
| `Responded At` | `responded_at` | String | ISO timestamp of first response |
| `Updated At` | `updated_at` | String | ISO timestamp — blank on first response |
| `Invitee ID` | `invitee_id` | String | FK → `AvailabilityInvitees.invitee_id` — blank for public event member responses |

### 4.6 Sheet: `AvailabilityInvitees`

Row 1 header. Data from row 2. Range `A2:K`.

| Column header (exact) | Normalised key | Type | Notes |
|---|---|---|---|
| `Invitee ID` | `invitee_id` | String | `AVI-NNNNNN`. Never resets. |
| `Event ID` | `event_id` | String | FK → `AvailabilityEvents.event_id` |
| `Group Member ID` | `group_member_id` | String | FK → `AvailabilityGroupMembers.member_id` — blank for public event manual additions |
| `Invitee Type` | `invitee_type` | String | `member` or `visitor` |
| `User Name` | `user_name` | String | FK → `Members.user_name` — blank for visitors |
| `Visitor Name` | `visitor_name` | String | Blank for members |
| `Visitor Email` | `visitor_email` | String | Blank for members |
| `Token` | `token` | String | 64-char hex — blank for members |
| `Token Expires At` | `token_expires_at` | String | ISO timestamp — same as event `expires_at`. Blank for members. |
| `Notified At` | `notified_at` | String | ISO timestamp of invite email send. Blank until sent. |
| `Created At` | `created_at` | String | ISO timestamp |

---

## 5. TypeScript Types

**File:** `src/types/availability.ts`

```typescript
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

// Full event record as stored in the sheet
export interface AvailabilityEvent {
  eventId: string;
  title: string;
  description: string;
  createdByUsername: string;
  groupId: string;              // blank for public events
  type: AvailabilityEventType;
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

// A single candidate date/time slot
export interface AvailabilitySlot {
  slotId: string;
  eventId: string;
  slotDatetime: string;         // ISO timestamp
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
  showResponsesToRespondents: boolean;
  notifyCreatorOnResponse: boolean;
  expiresAt: string;            // ISO timestamp
  slots: Array<{
    slotDatetime: string;
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

// Body for conclude endpoint
export interface ConcludeEventPayload {
  concludedSlotId: string;
  conclusionNote: string;
  notifyRespondents: boolean;
}
```

---

## 6. Data Layer

Split into two files to keep each manageable. Both use `getGoogleSheetsClient()` from `src/lib/sheets.ts`. Follow patterns from `src/lib/invite-games-sheets.ts` and `src/lib/social-events-sheets.ts` for column-map usage, ID generation, and row upserts.

### 6.1 File: `src/lib/availability-groups-sheets.ts`

#### ID Generators

```typescript
// AG-YYYY-NNN format, resets each calendar year.
// Fetches existing group IDs, finds max NNN for current year, increments.
async function generateGroupId(): Promise<string>

// AGM-NNNNNN format, never resets.
// Fetches column A of AvailabilityGroupMembers, parses suffix, finds max, increments.
// Pads to 6 digits.
async function generateGroupMemberId(): Promise<string>
```

#### Group Functions

```typescript
// Fetch all groups visible to the calling user:
//   - Groups the user created
//   - Groups where user appears in AvailabilityGroupMembers (user_name matches)
//   - Only status = 'active'
// Resolves memberCount and openEventCount for each group.
export async function getGroups(userName: string): Promise<AvailabilityGroupSummary[]>

// Fetch a single group by groupId. Returns null if not found.
// Does NOT check access — caller (API route) is responsible.
export async function getGroupById(groupId: string): Promise<AvailabilityGroup | null>

// Build the full group detail for the group page.
// Fetches group, members, and event summaries.
// Resolves display names for member-type group members via Members sheet.
// Resolves isCreator and canManageMembers for the calling user.
export async function getGroupDetail(
  groupId: string,
  callerUserName: string
): Promise<AvailabilityGroupDetail | null>

// Create a new group. Appends one row to AvailabilityGroups.
// Returns the generated groupId.
export async function createGroup(data: {
  name: string;
  description: string;
  createdByUsername: string;
  allowMemberManagement: boolean;
}): Promise<string>

// Update group fields. Sets updated_at.
// Updatable fields: name, description, allow_member_management
export async function updateGroup(
  groupId: string,
  updates: Partial<Pick<AvailabilityGroup,
    'name' | 'description' | 'allowMemberManagement'
  >>
): Promise<void>

// Soft-delete a group. Sets status = 'archived'.
export async function archiveGroup(groupId: string): Promise<void>

// Check whether a user (by userName) is a member of a group.
export async function isGroupMember(groupId: string, userName: string): Promise<boolean>

// Determine whether a user can manage group membership.
// True if: user is the group creator, OR user has Admin role,
// OR (group.allow_member_management is true AND user is a group member).
export async function canManageGroupMembers(
  group: AvailabilityGroup,
  userName: string,
  userRole: string
): Promise<boolean>
```

#### Group Member Functions

```typescript
// Fetch all members of a group.
export async function getGroupMembers(groupId: string): Promise<AvailabilityGroupMember[]>

// Add a batch of members to a group.
// For each member-type entry: check they are not already in the group (skip duplicates silently).
// For each visitor-type entry: check no existing visitor with same email in this group (skip duplicates silently).
// Returns the list of created AvailabilityGroupMember records.
// After inserting, the caller is responsible for adding the new members to any open group events.
export async function addGroupMembers(
  groupId: string,
  addedByUsername: string,
  memberUserNames: string[],
  visitorMembers: Array<{ visitorName: string; visitorEmail: string }>
): Promise<AvailabilityGroupMember[]>

// Remove a group member by memberId.
// Does NOT cascade to existing invitee records — past event invites remain intact.
export async function removeGroupMember(memberId: string): Promise<void>
```

---

### 6.2 File: `src/lib/availability-events-sheets.ts`

#### ID Generators

```typescript
// AV-YYYY-NNN format, resets each calendar year.
async function generateEventId(): Promise<string>

// AVS-NNNNNN, AVR-NNNNNN, AVI-NNNNNN — never reset.
async function generateSlotId(): Promise<string>
async function generateResponseId(): Promise<string>
async function generateInviteeId(): Promise<string>
```

For all NNNNNN generators: fetch column A of the relevant sheet, parse the numeric suffix of each ID, find the maximum, add 1, pad to 6 digits. If the sheet is empty, start at 1.

#### Event Functions

```typescript
// Fetch all public events (group_id blank, status !== 'archived').
// Resolves hasResponded for the calling user and createdByName.
export async function getPublicEvents(
  callerUserName: string
): Promise<AvailabilityEventSummary[]>

// Fetch all events for a group (status !== 'archived'), newest first.
// Resolves hasResponded for the calling user.
export async function getGroupEvents(
  groupId: string,
  callerUserName: string
): Promise<AvailabilityEventSummary[]>

// Fetch a single event by eventId. Returns null if not found.
export async function getEventById(eventId: string): Promise<AvailabilityEvent | null>

// Create a new event. Appends one row to AvailabilityEvents.
// Returns generated eventId.
export async function createEvent(data: {
  title: string;
  description: string;
  createdByUsername: string;
  groupId: string;              // pass empty string for public events
  type: AvailabilityEventType;
  showResponsesToRespondents: boolean;
  notifyCreatorOnResponse: boolean;
  expiresAt: string;
}): Promise<string>

// Update event fields. Sets updated_at.
// Updatable: title, description, type, show_responses_to_respondents,
//            notify_creator_on_response, expires_at, status
export async function updateEvent(
  eventId: string,
  updates: Partial<Pick<AvailabilityEvent,
    'title' | 'description' | 'type' | 'showResponsesToRespondents' |
    'notifyCreatorOnResponse' | 'expiresAt' | 'status'
  >>
): Promise<void>

// Mark event as concluded.
// Sets status='concluded', concluded_slot_id, conclusion_note,
// concluded_at, concluded_by_username, updated_at.
export async function concludeEvent(
  eventId: string,
  concludedSlotId: string,
  conclusionNote: string,
  concludedByUsername: string
): Promise<void>

// Clear conclusion fields when reopening.
// Sets concluded_slot_id, conclusion_note, concluded_at, concluded_by_username
// all to empty string. Sets updated_at.
export async function clearConclusionFields(eventId: string): Promise<void>

// Soft-delete. Sets status = 'archived'.
export async function archiveEvent(eventId: string): Promise<void>
```

#### Slot Functions

```typescript
// Fetch all slots for an event, ordered by display_order ascending.
export async function getSlotsForEvent(eventId: string): Promise<AvailabilitySlot[]>

// Append one slot. Returns generated slotId.
export async function addSlot(
  eventId: string,
  slotDatetime: string,
  slotLabel: string,
  displayOrder: number
): Promise<string>

// Delete a slot. Also cascades: fetch AvailabilityResponses, delete all rows
// where slot_id matches, iterating in reverse order to preserve row indices.
export async function deleteSlot(slotId: string): Promise<void>
```

#### Response Functions

```typescript
// Fetch all responses for an event.
export async function getResponsesForEvent(
  eventId: string
): Promise<AvailabilityResponseRecord[]>

// Upsert a member's response for a slot.
// Match existing row on (event_id, slot_id, user_name).
// If found: update response and set updated_at.
// If not found: append new row with responded_at.
export async function upsertMemberResponse(
  eventId: string,
  slotId: string,
  userName: string,
  response: AvailabilityResponse
): Promise<void>

// Upsert a visitor's response. Matches on (event_id, slot_id, invitee_id).
export async function upsertVisitorResponse(
  eventId: string,
  slotId: string,
  inviteeId: string,
  visitorName: string,
  visitorEmail: string,
  response: AvailabilityResponse
): Promise<void>
```

#### Invitee Functions

```typescript
// Fetch all invitees for an event.
export async function getInviteesForEvent(
  eventId: string
): Promise<AvailabilityInvitee[]>

// Create invitee records from a list of group members (called when event is created
// or when a new member is added to a group with open events).
// For member-type: creates row with no token.
// For visitor-type: generates 64-char hex token using crypto.randomBytes(32),
//   sets token and token_expires_at from event's expires_at.
// Returns the list of created invitee records.
export async function createInviteesFromGroupMembers(
  eventId: string,
  tokenExpiresAt: string,
  groupMembers: AvailabilityGroupMember[]
): Promise<AvailabilityInvitee[]>

// Validate a visitor token. Returns matching invitee or null.
// Checks: token exists in sheet, event_id matches, token_expires_at not passed.
export async function validateVisitorToken(
  eventId: string,
  token: string
): Promise<AvailabilityInvitee | null>

// Mark invitees as notified by setting notified_at to current ISO timestamp.
export async function markInviteesNotified(inviteeIds: string[]): Promise<void>

// Check whether a member is an invitee for a specific event.
export async function isMemberInvitee(
  eventId: string,
  userName: string
): Promise<boolean>
```

#### Composite Read Functions

```typescript
// Build AvailabilityEventDetail for the member response page.
// Fetches event, slots, responses. Resolves display names.
// If show_responses_to_respondents is false AND caller is not creator, returns allResponses: [].
export async function getEventDetailForMember(
  eventId: string,
  callerUserName: string
): Promise<AvailabilityEventDetail | null>

// Build AvailabilityManageDetail for the manage page.
// Always returns full response grid regardless of show_responses_to_respondents.
export async function getEventManageDetail(
  eventId: string
): Promise<AvailabilityManageDetail | null>

// Build response detail for the guest token page.
// Validates token. Returns null if invalid or expired.
// If show_responses_to_respondents is true, includes other respondents' responses.
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
} | null>
```

---

## 7. API Routes

All routes follow the standard template from `CODING_STANDARDS.md §7`. Every route: check session → access check → validate input → call data layer → return JSON. Catch block logs `console.error('[route path] Error:', error)` and returns `{ error: '...' }` with status 500.

Public routes (guest pages) must have in-memory rate limiting per `CODING_STANDARDS.md §27`.

---

### 7.1 Groups

#### `GET /api/availability/groups`
**File:** `app/api/availability/groups/route.ts`

Auth: any logged-in member.
Calls `getGroups(session.user.userName)`.
Returns `{ groups: AvailabilityGroupSummary[] }`.

---

#### `POST /api/availability/groups`
**File:** `app/api/availability/groups/route.ts`

Auth: any logged-in member.
Body: `CreateGroupPayload`

Validation:
- `name` required, non-empty
- Visitor members: `visitorName` and `visitorEmail` both required for each

Steps:
1. Call `createGroup(...)` → returns `groupId`
2. If any members or visitors provided, call `addGroupMembers(groupId, session.user.userName, memberUserNames, visitorMembers)`
3. Send group-added notification email to new members (see §9.1)
4. Return `{ success: true, groupId }`

---

#### `GET /api/availability/groups/[groupId]`
**File:** `app/api/availability/groups/[groupId]/route.ts`

Auth: any logged-in member.
Access: user must be a group member OR group creator OR Admin. Else → 403.
Calls `getGroupDetail(groupId, session.user.userName)`.
Returns `AvailabilityGroupDetail`.

---

#### `PUT /api/availability/groups/[groupId]`
**File:** `app/api/availability/groups/[groupId]/route.ts`

Auth: any logged-in member.
Body: `Partial<{ name, description, allowMemberManagement }>`
Access: group creator OR Admin only.
Group must not be `archived` → 400.
Calls `updateGroup(groupId, updates)`.
Returns `{ success: true }`.

---

#### `DELETE /api/availability/groups/[groupId]`
**File:** `app/api/availability/groups/[groupId]/route.ts`

Auth: any logged-in member.
Access: group creator OR Admin.
Calls `archiveGroup(groupId)`.
Returns `{ success: true }`.

---

#### `GET /api/availability/groups/[groupId]/members`
**File:** `app/api/availability/groups/[groupId]/members/route.ts`

Auth: any logged-in member.
Access: group member OR creator OR Admin.
Calls `getGroupMembers(groupId)`.
Returns `{ members: AvailabilityGroupMember[] }`.

---

#### `POST /api/availability/groups/[groupId]/members`
**File:** `app/api/availability/groups/[groupId]/members/route.ts`

Auth: any logged-in member.
Body: `AddGroupMembersPayload`
Access: `canManageGroupMembers(group, session.user.userName, session.user.role)` → 403 if false.
Group must be `active` → 400 if archived.

Steps:
1. Call `addGroupMembers(...)` → returns newly created group member records
2. Fetch all open events for this group via `getGroupEvents(groupId, session.user.userName)` filtered to `status === 'open'` and not expired
3. For each open event, call `createInviteesFromGroupMembers(eventId, event.expiresAt, newMembers)` to add the new members as invitees
4. Send invite emails for each open event to the new members (see §9.2)
5. Send group-added notification to new members (see §9.1)
6. Return `{ success: true, addedCount: number }`

---

#### `DELETE /api/availability/groups/[groupId]/members/[memberId]`
**File:** `app/api/availability/groups/[groupId]/members/[memberId]/route.ts`

Auth: any logged-in member.
Access: `canManageGroupMembers(group, ...)`.
Calls `removeGroupMember(memberId)`.
Returns `{ success: true }`.

---

### 7.2 Events

#### `GET /api/availability/events`
**File:** `app/api/availability/events/route.ts`

Auth: any logged-in member.
Calls `getPublicEvents(session.user.userName)`.
Returns `{ events: AvailabilityEventSummary[] }`.

---

#### `POST /api/availability/events`
**File:** `app/api/availability/events/route.ts`

Auth: any logged-in member.
Body: `CreateEventPayload`

Validation:
- `title` required, non-empty
- `expiresAt` required, valid ISO, in the future
- `slots` required, at least one entry
- Each slot: `slotDatetime` required, valid ISO
- `type` must be one of `general`, `fixture`, `signup`

Steps:
1. Call `createEvent({ ..., groupId: '' })` → returns `eventId`
2. For each slot, call `addSlot(...)` with `displayOrder` = 1-based index
3. Return `{ success: true, eventId }`

No invitees or emails for public events — all members see it in their list.

---

#### `GET /api/availability/events/[eventId]`
**File:** `app/api/availability/events/[eventId]/route.ts`

Auth: any logged-in member.

Access check:
- Fetch event. Not found → 404.
- If `groupId` is blank (public event): allow any member.
- If `groupId` is set: allow if `isGroupMember(groupId, userName)` OR creator OR Admin. Else → 403.

Calls `getEventDetailForMember(eventId, session.user.userName)`.
Returns `AvailabilityEventDetail`.

---

#### `PUT /api/availability/events/[eventId]`
**File:** `app/api/availability/events/[eventId]/route.ts`

Auth: any logged-in member.
Body: `Partial<{ title, description, type, showResponsesToRespondents, notifyCreatorOnResponse, expiresAt, status }>`
Access: event creator OR Admin.
Event must not be `concluded` or `archived` → 400.
Calls `updateEvent(eventId, updates)`.
Returns `{ success: true }`.

---

#### `DELETE /api/availability/events/[eventId]`
**File:** `app/api/availability/events/[eventId]/route.ts`

Auth: any logged-in member.
Access: event creator OR Admin.
Calls `archiveEvent(eventId)`.
Returns `{ success: true }`.

---

#### `POST /api/availability/events/[eventId]/slots`
**File:** `app/api/availability/events/[eventId]/slots/route.ts`

Auth: any logged-in member.
Body: `{ slotDatetime: string, slotLabel: string }`
Access: event creator OR Admin.
Event must have status `open`.
Validation: `slotDatetime` required, valid ISO.
Fetch existing slots to determine next `displayOrder` (max + 1).
Calls `addSlot(...)`.
Returns `{ success: true, slotId }`.

---

#### `DELETE /api/availability/events/[eventId]/slots/[slotId]`
**File:** `app/api/availability/events/[eventId]/slots/[slotId]/route.ts`

Auth: any logged-in member.
Access: event creator OR Admin.
Event must have status `open`.
Calls `deleteSlot(slotId)` (cascades to responses).
Returns `{ success: true }`.

---

#### `POST /api/availability/events/[eventId]/respond`
**File:** `app/api/availability/events/[eventId]/respond/route.ts`

Auth: any logged-in member.
Body: `MemberRespondPayload`

Validation:
- `responses` non-empty array
- Each entry: `slotId` and `response` (`yes` | `maybe` | `no`) required

Access: same as GET (public or group member check).
Event must be `open` and `expiresAt` not in the past → 400 if either fails.
Verify each `slotId` belongs to the event → 400 if mismatch.
For each response, call `upsertMemberResponse(...)`.
After saving, check `event.notifyCreatorOnResponse`. If `true`, send response notification email to creator (see §9.4). Email failure must not block the 200 response — log and continue.
Returns `{ success: true }`.

---

#### `GET /api/availability/events/[eventId]/manage`
**File:** `app/api/availability/events/[eventId]/manage/route.ts`

Auth: any logged-in member.
Access: event creator OR Admin → 403 otherwise.
Calls `getEventManageDetail(eventId)`.
Returns `AvailabilityManageDetail`.

---

#### `POST /api/availability/events/[eventId]/conclude`
**File:** `app/api/availability/events/[eventId]/conclude/route.ts`

Auth: any logged-in member.
Body: `ConcludeEventPayload`
Access: event creator OR Admin.

Validation:
- `concludedSlotId` required, must belong to this event
- Event must have status `open` or `closed`

Steps:
1. Call `concludeEvent(eventId, concludedSlotId, conclusionNote, session.user.userName)`
2. If `notifyRespondents === true`, send conclusion emails (see §9.3)
3. Return `{ success: true }`

---

#### `POST /api/availability/events/[eventId]/reopen`
**File:** `app/api/availability/events/[eventId]/reopen/route.ts`

Auth: any logged-in member.
Access: event creator OR Admin.
Event must have status `closed` or `concluded` (not `archived`).
Calls `updateEvent(eventId, { status: 'open' })`.
Calls `clearConclusionFields(eventId)`.
Returns `{ success: true }`.

---

### 7.3 Group Events

#### `GET /api/availability/groups/[groupId]/events`
**File:** `app/api/availability/groups/[groupId]/events/route.ts`

Auth: any logged-in member.
Access: group member OR creator OR Admin.
Calls `getGroupEvents(groupId, session.user.userName)`.
Returns `{ events: AvailabilityEventSummary[] }`.

---

#### `POST /api/availability/groups/[groupId]/events`
**File:** `app/api/availability/groups/[groupId]/events/route.ts`

Auth: any logged-in member.
Body: `CreateEventPayload`
Access: group member OR creator OR Admin (any group member can create events).
Group must be `active` → 400 if archived.

Validation: same as `POST /api/availability/events` above.

Steps:
1. Call `createEvent({ ..., groupId })` → returns `eventId`
2. For each slot, call `addSlot(...)`
3. Fetch all group members via `getGroupMembers(groupId)`
4. Call `createInviteesFromGroupMembers(eventId, expiresAt, groupMembers)` → returns invitees list
5. Send invite emails to all group members (see §9.2)
6. Return `{ success: true, eventId }`

---

### 7.4 Guest Routes (Public — No Auth)

#### `GET /api/availability/guest/[eventId]`
**File:** `app/api/availability/guest/[eventId]/route.ts`

Auth: none. Rate limit: 30 requests per minute per IP.
Query param: `token` required → 400 if missing.
Calls `getEventDetailForVisitor(eventId, token)`.
Returns 404 if null.
Returns `{ event, slots, invitee: { visitorName }, myResponses, allResponses, concludedSlot }`.
Do **not** return the raw token or `inviteeId` in the response body.

---

#### `POST /api/availability/guest/[eventId]/respond`
**File:** `app/api/availability/guest/[eventId]/respond/route.ts`

Auth: none. Rate limit: 10 requests per 5 minutes per IP.
Body: `GuestRespondPayload`

Steps:
1. Validate token with `validateVisitorToken(eventId, token)` → 401 if null
2. Verify event is `open` and not expired → 400
3. Validate each `slotId` belongs to event
4. For each response, call `upsertVisitorResponse(...)`
5. Check `event.notifyCreatorOnResponse`. If true, send response notification email (see §9.4). Email failure must not block the response — log and continue.
6. Return `{ success: true }`

---

## 8. Pages

### 8.1 `/availability` — Hub Page

**File:** `app/availability/page.tsx`
**Client component.** Uses `useSessionRefresh()`.
Uses `sessionStorage` caching (key: `'AvailabilityHubCache'`).

Fetches both `GET /api/availability/groups` and `GET /api/availability/events` in parallel (sequential fetches, not Promise.all — see coding standards).

**Layout:**

- Page title: "Availability"
- "Create Public Event" button (secondary, top right) → `/availability/events/new`
- "Create Group" button (primary, top right) → `/availability/groups/new`

**Your Groups section** (main content):
- Grid of group cards (2 columns desktop, 1 mobile)
- Each card: group name, description (if present), member count badge, open event count badge, "View Group" link
- If `isCreator`: show a small "Manage" link
- Empty state: "You are not in any groups yet. Create one to get started."

**Public Events section** (below groups):
- Same three sub-sections as original spec: "Awaiting your response" / "You've responded" / "Concluded or Closed" (collapsed)
- Each event card: title (link), created by, type badge, status badge, expiry, slot count, response count
- Empty state per sub-section if no events

---

### 8.2 `/availability/groups/new` — Create Group

**File:** `app/availability/groups/new/page.tsx`
**Client component.**
Uses draft save/restore with key `'AvailabilityNewGroup'`.

**Form:**

**Section 1 — Group Details**
- Name (text input, required)
- Description (textarea, optional)
- Allow members to manage membership: Yes / No toggle (default No). Helper text: *"If Yes, any group member can add or remove people."*

**Section 2 — Initial Members**
Two sub-sections side by side (stacked on mobile):
- **Members:** searchable select using existing member lookup component. Selected members shown in a list with remove button.
- **Visitors:** Name + Email form + "Add" button. Added visitors shown in list with remove button.
- At least one member or visitor is not required at creation — a group can be created empty and populated later.

**Submit:** "Create Group" button.
On success: clear draft, redirect to `/availability/groups/[groupId]`.
On error: show inline error alert.

---

### 8.3 `/availability/groups/[groupId]` — Group Page

**File:** `app/availability/groups/[groupId]/page.tsx`
**Client component.** Uses `useSessionRefresh()`.
Uses `sessionStorage` caching (key: `'AvailabilityGroup-[groupId]-Cache'`).

Fetches `GET /api/availability/groups/[groupId]`.
Non-members (403): show "You are not a member of this group."

**Layout:**

**Header:**
- Back link → `/availability`
- Group name (h1) + `active`/`archived` badge
- Member count
- "Manage Members" button (shown if `canManageMembers`) → opens inline membership panel
- "Edit Group" button (shown if `isCreator`) → opens inline edit form for name, description, allow_member_management
- "Archive Group" danger button (shown if `isCreator` or Admin)
- "Create Event" button (primary) → `/availability/groups/[groupId]/events/new`

**Membership panel** (inline, toggled by "Manage Members"):
- List of current members: display name | type badge (Member/Visitor) | "Remove" button
- Add Members sub-form (same as group creation form — member searchable select + visitor name/email form)
- "Save Changes" button → calls `POST /api/availability/groups/[groupId]/members`

**Event Feed** (main content — below header):
Events displayed as cards in reverse chronological order (newest first), like a message feed.

Open events displayed prominently (white card, coloured status indicator). Concluded/archived events displayed in a muted style below.

Each event card shows:
- Title (link to `/availability/events/[eventId]`)
- Type badge (`General` / `Fixture` / `Signup`) using `getBadgeClasses()`
- Status badge
- Created by name + relative time ("3 days ago")
- Slot count
- Response summary (e.g. "8 responses across 3 dates")
- Whether you have responded (tick icon if yes)
- If concluded: winning slot label highlighted in green
- "Manage" link (shown if current user is event creator or Admin)

Empty state: "No events yet. Create the first one."

---

### 8.4 `/availability/groups/[groupId]/events/new` — Create Group Event

**File:** `app/availability/groups/[groupId]/events/new/page.tsx`
**Client component.**
Uses draft save/restore with key `'AvailabilityNewGroupEvent-[groupId]'`.

Fetches group name to display in heading: "New Event — [Group Name]".

**Form:**

**Section 1 — Event Details**
- Title (required)
- Description (optional)
- Type: three-button toggle — `General` / `Fixture` / `Signup` (default `General`)
- Expires On (date input, required, must be future)
- Show responses to all respondents: Yes / No (default Yes)
- Notify me when someone responds: Yes / No (default No). Helper text: *"Useful for one-on-one polls where an immediate reply matters."*

**Section 2 — Date/Time Slots** (identical to original spec §7.2 Section 2)
- "Add Slot" inline form with date, optional time, optional label override
- Existing slots listed with remove button
- At least 1 slot required

No invitees section — the group handles invitations automatically.

**Invitee note** (read-only, shown beneath slots):
> *"This event will be sent to all [N] members of [Group Name]. To invite additional people, add them to the group first."*

**Submit:** "Create Event" button.
On success: clear draft, redirect to `/availability/events/[eventId]/manage`.
On error: show inline error alert.

---

### 8.5 `/availability/events/new` — Create Public Event

**File:** `app/availability/events/new/page.tsx`
**Client component.**
Uses draft save/restore with key `'AvailabilityNewPublicEvent'`.

Identical to §8.4 form but:
- Heading: "New Public Event"
- No invitee note — public events are visible to all members automatically
- On success: redirect to `/availability/events/[eventId]/manage`

---

### 8.6 `/availability/events/[eventId]` — Member Response Page

**File:** `app/availability/events/[eventId]/page.tsx`
**Client component.** Uses `useSessionRefresh()`.
Fetches `GET /api/availability/events/[eventId]`.

**Layout:**

- Back link: if event has a `groupId`, back to `/availability/groups/[groupId]`. Otherwise back to `/availability`.
- Event title (h1)
- Type badge + status badge
- Description (if present)
- Created by / Expires On metadata row
- "Manage Event" link (secondary button) — only shown if current user is event creator or Admin

**Status banners:**
- If `concluded`: green info box showing winning slot label and conclusion note.
- If expired but still `open`: amber warning "This event has expired — no more responses are being accepted."

**Response grid** (main content):
- One column per slot. Header shows label (or formatted datetime). Date on one line, time below in smaller text.
- Current user's row always shown first, always editable (if event is open and not expired).
- Other respondents below (read-only) — shown only if `showResponsesToRespondents === true` OR user is creator.
- Display name only for other respondents (never email).
- Response cells for current user: three buttons — **✓ Yes** (green), **? Maybe** (amber), **✗ No** (red). Selected state visually filled. Unresponded shows all three equally.
- Response cells for others: coloured badge only.
- Per-slot summary row: Yes / Maybe / No counts in coloured text.

**"Save My Responses"** button (primary). Calls `POST /api/availability/events/[eventId]/respond`. Show success/error inline. Disabled if event is expired or not `open`.

If event is a group event and current user is not a group member: show 403 message.

---

### 8.7 `/availability/events/[eventId]/manage` — Management Page

**File:** `app/availability/events/[eventId]/manage/page.tsx`
**Client component.** Uses `useSessionRefresh()`.
Only accessible to event creator or Admin.
Fetches `GET /api/availability/events/[eventId]/manage`.

**Layout:**

**Header:**
- Back link: if group event → `/availability/groups/[groupId]`. Else → `/availability`.
- Event title (h1) + type badge + status badge
- "Edit Event" button → inline edit panel for title, description, type, expiry, show_responses_to_respondents, notify_creator_on_response. Calls `PUT /api/availability/events/[eventId]`.
- "View as Member" link → `/availability/events/[eventId]`

**Status controls:**
- If `open`: "Close Event" button → `PUT { status: 'closed' }`
- If `closed`: "Reopen" + "Conclude Event" buttons
- If `concluded`: "Reopen" button. Concluded slot column highlighted green in grid.
- Always: "Archive Event" danger button

**Response grid:**
Same as §8.6 but always shows all respondents (ignores `showResponsesToRespondents`). Read-only — creator cannot edit others' responses from here. Per-slot Yes/Maybe/No summary row shown.

**Conclude Event panel** (inline, shown when "Conclude Event" clicked):
- Dropdown: "Choose the winning slot" — all slots by label/datetime
- Textarea: "Conclusion note" (optional)
- Checkbox: "Send notification email to all respondents"
- "Confirm Conclusion" + "Cancel" buttons
- Calls `POST /api/availability/events/[eventId]/conclude`

**Slots section:**
- Current slots in display order
- "Add Slot" button → inline form (same as create page). Calls `POST /api/availability/events/[eventId]/slots`.
- Remove (×) button per slot — only enabled while `open`. Warns: "Removing this slot will also delete all responses to it." Calls `DELETE /api/availability/events/[eventId]/slots/[slotId]`.

**Invitees section** (group events only, shown below slots):
- Header: "Invitees"
- Table: Name | Type | Notified | Responded
- Note: *"To invite more people, add them to the group."* Link → `/availability/groups/[groupId]`

---

### 8.8 `/availability/guest/[eventId]` — Visitor Response Page

**File:** `app/availability/guest/[eventId]/page.tsx`
**Client component. No authentication required.**
Reads `token` from `useSearchParams()`.

If `token` absent: "This link appears to be incomplete. Please check the email you received and try again."

Fetches `GET /api/availability/guest/[eventId]?token=<token>`.
On 401/404: "This link is no longer valid or has expired."
On event expired/not open: read-only view with "This event is no longer accepting responses."

**Layout:**
- BHBC branding header (same as other public pages — no nav)
- Greeting: "Hello [visitorName]"
- Event title (h1), type badge, description, created by, expiry date
- Status banner if concluded (green box with winning slot + conclusion note)
- Response grid — identical interaction to §8.6. Visitor's own row is the editable row.
- "Save My Responses" primary button. On success: show inline "Your responses have been saved. You can update them any time using this link." Do not redirect.
- Honeypot field: `<input type="text" name="website" style="display:none" tabIndex={-1} />`
- No nav bar. No session UI.

---

## 9. Email Templates

### 9.1 Group Added Notification

**File:** `src/lib/email/templates/availability-group-added.html`

Sent when a member or visitor is added to a group.

Subject:
```html
<!-- Subject: You've been added to a group — {{groupName}} -->
```

Variables: `{{recipientName}}`, `{{groupName}}`, `{{addedByName}}`, `{{groupUrl}}` (for members — `https://<APP_URL>/availability/groups/<groupId>`), `{{isVisitor}}` (boolean for conditional).

Structure:
1. Greeting: "Hello {{recipientName}},"
2. "{{addedByName}} has added you to the group **{{groupName}}**."
3. For members: CTA button "View Group" → `{{groupUrl}}`
4. For visitors: "You will receive an email with a link to respond when an event is created for this group."
5. Standard BHBC footer

**Send logic** (called from `POST /api/availability/groups` and `POST /api/availability/groups/[groupId]/members`):
- Members: one BCC email to all new member email addresses. Single `getEmailTransporter()` send.
- Visitors: no email at this point — they receive an invite when an event is created.

---

### 9.2 Event Invite

**File:** `src/lib/email/templates/availability-event-invite.html`

Sent to group members when a group event is created, and to any members/visitors added to a group that has open events.

Subject:
```html
<!-- Subject: New availability poll — {{eventTitle}} -->
```

Variables: `{{inviteeName}}`, `{{eventTitle}}`, `{{eventType}}`, `{{groupName}}` (blank for public), `{{creatorName}}`, `{{expiresAtFormatted}}`, `{{responseUrl}}`

- Members: `responseUrl` = `https://<APP_URL>/availability/events/<eventId>`
- Visitors: `responseUrl` = `https://<APP_URL>/availability/guest/<eventId>?token=<token>`

Structure:
1. Greeting: "Hello {{inviteeName}},"
2. "{{creatorName}} has created a new availability poll: **{{eventTitle}}**{{#if groupName}} in {{groupName}}{{/if}}."
3. "Please indicate your availability by {{expiresAtFormatted}}."
4. CTA button "Indicate My Availability" → `{{responseUrl}}`
5. Standard footer

**Send logic** (called from `POST /api/availability/groups/[groupId]/events` and from `POST /api/availability/groups/[groupId]/members` for open events):
```typescript
// Members: one BCC email, generic login URL, standard transporter
// Visitors: sequential individual emails, pooled transporter, each with unique token URL
const pooledTransporter = getEmailTransporter(true);
for (const invitee of visitorInvitees) {
  await pooledTransporter.sendMail({ ... });
}
pooledTransporter.close();
```
After sending, call `markInviteesNotified(inviteeIds)`.

---

### 9.3 Conclusion Notification

**File:** `src/lib/email/templates/availability-conclusion.html`

Sent to all respondents when creator concludes with `notifyRespondents === true`.

Subject:
```html
<!-- Subject: Event update — {{eventTitle}} -->
```

Variables: `{{respondentName}}`, `{{eventTitle}}`, `{{chosenSlotLabel}}`, `{{conclusionNote}}` (conditional), `{{creatorName}}`

Structure:
1. "{{creatorName}} has finalised **{{eventTitle}}**."
2. "The chosen date is: **{{chosenSlotLabel}}**"
3. Conclusion note block (conditional on `{{#if conclusionNote}}`)
4. Standard footer

**Send logic:**
Fetch all unique respondents from `getResponsesForEvent(eventId)`. Deduplicate by `userName` / `visitorEmail`.
- Members who responded: one BCC email via standard transporter
- Visitors who responded: sequential individual emails via pooled transporter

---

### 9.4 Response Notification

**File:** `src/lib/email/templates/availability-response-notification.html`

Sent to the event creator when `notifyCreatorOnResponse === true` and any respondent saves responses.

Subject:
```html
<!-- Subject: New response — {{eventTitle}} -->
```

Variables: `{{creatorName}}`, `{{eventTitle}}`, `{{respondentName}}`, `{{manageUrl}}` (`https://<APP_URL>/availability/events/<eventId>/manage`)

Structure:
1. "{{respondentName}} has just responded to **{{eventTitle}}**."
2. CTA button "View Responses" → `{{manageUrl}}`
3. Standard footer

**Send logic:**
Single transactional send to the creator using `sendTemplateEmail()`. Use the existing member lookup (e.g. `getUserByUsername()` from `src/lib/sheets.ts` or `src/lib/auth-sheets.ts` — do not create a new function) to resolve the creator's email address. Email failure must not block the 200 response — log and continue.

`respondentDisplayName`:
- Members: member's `full_known_as` resolved from Members sheet
- Visitors: `visitor_name` from the invitee record

---

## 10. Middleware Update

**File:** `middleware.ts`

Add the guest response page to the public routes list (no NextAuth redirect):

```typescript
// Availability guest token page — no auth required
'/availability/guest/:path*'
```

All other `/availability/*` routes require authentication (covered by the default rule — verify the middleware matcher includes them).

---

## 11. Navigation Update

**File:** the Navbar component (check `src/components/`)

Add "Availability" as a nav link → `/availability`. Position it alongside Social Events and Internal Games. Use `getNavItemClasses()` from `theme-helpers.ts`. Visible to all authenticated members (no role restriction).

---

## 12. Help Page

**File:** `app/help/availability/page.tsx`

Follow the existing help page pattern. Cover:

1. What the availability planner is and when to use it
2. Groups — what they are, how to create one, how to manage membership
3. The `allow_member_management` setting
4. Creating an event within a group
5. Event types: General, Fixture, Signup
6. Creating a public event
7. How to respond to an event (Yes / Maybe / No)
8. What visitors see (token link, no login required, can update responses)
9. Managing an event — viewing responses, adding slots, closing, concluding
10. What "Show responses to all respondents" means
11. What "Notify me when someone responds" means and when to use it
12. Concluding an event and notifying respondents
13. Archiving a group or event

---

## 13. Build Order

Implement in this order to allow incremental testing at each stage:

1. **Cleanup** — delete old implementation, verify build passes
2. **Environment variable** — add getter, create spreadsheet, add to `.env.local`
3. **TypeScript types** — `src/types/availability.ts`
4. **Groups data layer** — `src/lib/availability-groups-sheets.ts` (all functions)
5. **Events data layer** — `src/lib/availability-events-sheets.ts` (all functions)
6. **Groups API routes** — CRUD + members
7. **Events API routes** — public events CRUD, slots, respond, manage, conclude, reopen
8. **Group events API route** — `POST /api/availability/groups/[groupId]/events`
9. **Guest API routes** — GET and POST with token validation
10. **Pages** — hub → create group → group page → create event → member response → manage → visitor guest page
11. **Email templates** — all four; wire up send logic in relevant routes
12. **Middleware update**
13. **Navigation update**
14. **Help page**
15. **Version bump** — `npm run release:minor`

---

## 14. Coding Standards Reminders

Specific to this feature — all general rules from `CODING_STANDARDS.md` still apply.

- No `?.` or `??` anywhere — use explicit `if` checks.
- No `Promise.all()` for any Sheets calls or email sends.
- Email sends to multiple visitors: sequential loop with pooled transporter only.
- Public routes (`/api/availability/guest/*`) must have in-memory rate limiting.
- Guest page form must include a honeypot field.
- All user-visible text must use `text-gray-700` minimum.
- Buttons and badges must use `getButtonClasses()` and `getBadgeClasses()` from `theme-helpers.ts`.
- All datetime values in sheets are ISO strings — use the project's date parsing utilities consistently.
- Every file starts with the path + description header comment.
- Every function, loop, conditional, API call, and state update must have an inline comment.
- `session.user.userName` is always the correct member identifier — works transparently during admin impersonation.
- Google Sheets calls go through the data layer only — never call `googleapis` directly from route handlers.
- The `type` field on events (`general` / `fixture` / `signup`) and `team_id` on groups are reserved for future fixture integration — do not omit them even though they have no active logic yet beyond storage and display.
