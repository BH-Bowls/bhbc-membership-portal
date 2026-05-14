# Availability Planner — Full Implementation Spec

> Target codebase: BHBC Membership Portal (Next.js 14/15, App Router, TypeScript, Google Sheets, Nodemailer)  
> Read `CODING_STANDARDS.md`, `CLAUDE.md`, `SCHEMA.md`, and `PROJECT_OVERVIEW.md` before implementing anything.  
> Every rule in those documents applies here without exception.

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Environment Variable](#2-environment-variable)
3. [Google Sheets — New Spreadsheet](#3-google-sheets--new-spreadsheet)
4. [TypeScript Types](#4-typescript-types)
5. [Data Layer](#5-data-layer)
6. [API Routes](#6-api-routes)
7. [Pages](#7-pages)
8. [Email Templates](#8-email-templates)
9. [Middleware Update](#9-middleware-update)
10. [Navigation Update](#10-navigation-update)
11. [Help Page](#11-help-page)
12. [Build Order](#12-build-order)

---

## 1. Feature Overview

A Doodle-style availability planner. Any logged-in member can create an event with several candidate date/time slots. Other members and external visitors then mark each slot as Yes / Maybe / No. The event creator reviews the responses and optionally concludes the event by nominating the winning slot and notifying all respondents.

### Key rules

- **Any member** (any role) can create an event.
- Events are either **public** (visible to all members in the list) or **private** (invite-only).
- Private events have an invitee list. Invitees can be **members** (identified by username) or **visitors** (name + email address).
- Member invitees receive one BCC email with a generic login link. They see the event in their list once logged in.
- Visitor invitees receive individual emails each containing a unique 64-char hex token link. Token validity matches the event's `expires_at` date.
- Visitors can update their response at any time before expiry (re-using the same token link).
- The event creator chooses at creation time whether respondents can see each other's answers.
- The creator can **conclude** the event: nominate a winning slot, write an optional note, and optionally send a conclusion notification email to all respondents.
- The creator can optionally enable **"Notify me when someone responds"** at creation time. When enabled, a single transactional email is sent to the creator each time any respondent (member or visitor) saves their responses. Useful for one-on-one polls where an immediate reply matters. Disabled by default.
- Expired events (`expires_at` in the past, status still `open`) are displayed as read-only. No responses accepted.

---

## 2. Environment Variable

Add one new environment variable. Follow the existing getter pattern from `src/lib/sheets.ts` — no inline `process.env` in data-layer code.

```
AVAILABILITY_SPREADSHEET_ID=<google-sheets-id>
```

Add the getter to `src/lib/availability-sheets.ts`:

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

Add `AVAILABILITY_SPREADSHEET_ID` to `.env.local.example` (or equivalent) with a descriptive comment.

---

## 3. Google Sheets — New Spreadsheet

Create a new Google Spreadsheet. Share it with the service account email (same as all other spreadsheets in the project). Add the spreadsheet ID as `AVAILABILITY_SPREADSHEET_ID` in `.env.local`.

The spreadsheet contains **four sheets** (tabs). Create them with exactly the column headers listed below — the dynamic column-map system reads the header row and normalises to `snake_case`.

### 3.1 Sheet: `AvailabilityEvents`

Row 1 is the header row. Data starts at row 2. Range `A2:O`.

| Column header (exact) | Normalised key | Type | Notes |
|---|---|---|---|
| `Event ID` | `event_id` | String | `AV-YYYY-NNN`, e.g. `AV-2026-001`. Resets each calendar year. |
| `Title` | `title` | String | Short event name |
| `Description` | `description` | String | Optional longer description |
| `Created By Username` | `created_by_username` | String | FK → `Members.user_name` |
| `Visibility` | `visibility` | String | `public` or `private` |
| `Status` | `status` | String | `open`, `closed`, `concluded`, `archived` |
| `Show Responses To Respondents` | `show_responses_to_respondents` | String | `Y` or `N` |
| `Notify Creator On Response` | `notify_creator_on_response` | String | `Y` or `N` — if `Y`, creator receives an email each time any respondent saves responses |
| `Expires At` | `expires_at` | String | ISO timestamp |
| `Concluded Slot ID` | `concluded_slot_id` | String | FK → `AvailabilitySlots.slot_id` — blank until concluded |
| `Conclusion Note` | `conclusion_note` | String | Optional free text — blank until concluded |
| `Concluded At` | `concluded_at` | String | ISO timestamp — blank until concluded |
| `Concluded By Username` | `concluded_by_username` | String | FK → `Members.user_name` — blank until concluded |
| `Created At` | `created_at` | String | ISO timestamp |
| `Updated At` | `updated_at` | String | ISO timestamp — blank on creation, set on any edit |

### 3.2 Sheet: `AvailabilitySlots`

Row 1 is the header row. Data starts at row 2. Range `A2:F`.

| Column header (exact) | Normalised key | Type | Notes |
|---|---|---|---|
| `Slot ID` | `slot_id` | String | `AVS-NNNNNN`, e.g. `AVS-000001`. Never resets. |
| `Event ID` | `event_id` | String | FK → `AvailabilityEvents.event_id` |
| `Slot Datetime` | `slot_datetime` | String | ISO timestamp representing the candidate date/time |
| `Slot Label` | `slot_label` | String | Optional override label. If blank, UI formats `slot_datetime` for display. |
| `Display Order` | `display_order` | Integer | 1-based. Controls slot order on response page. |
| `Created At` | `created_at` | String | ISO timestamp |

### 3.3 Sheet: `AvailabilityResponses`

Row 1 is the header row. Data starts at row 2. Range `A2:K`.

| Column header (exact) | Normalised key | Type | Notes |
|---|---|---|---|
| `Response ID` | `response_id` | String | `AVR-NNNNNN`, e.g. `AVR-000001`. Never resets. |
| `Event ID` | `event_id` | String | FK → `AvailabilityEvents.event_id` |
| `Slot ID` | `slot_id` | String | FK → `AvailabilitySlots.slot_id` |
| `Respondent Type` | `respondent_type` | String | `member` or `visitor` |
| `User Name` | `user_name` | String | FK → `Members.user_name` — blank for visitors |
| `Visitor Name` | `visitor_name` | String | Blank for members |
| `Visitor Email` | `visitor_email` | String | Blank for members |
| `Response` | `response` | String | `yes`, `maybe`, or `no` |
| `Responded At` | `responded_at` | String | ISO timestamp of first response |
| `Updated At` | `updated_at` | String | ISO timestamp — blank on first response, set on edit |
| `Invitee ID` | `invitee_id` | String | FK → `AvailabilityInvitees.invitee_id` — blank for public-event member responses |

### 3.4 Sheet: `AvailabilityInvitees`

Only populated for **private** events. Row 1 is the header row. Data starts at row 2. Range `A2:J`.

| Column header (exact) | Normalised key | Type | Notes |
|---|---|---|---|
| `Invitee ID` | `invitee_id` | String | `AVI-NNNNNN`, e.g. `AVI-000001`. Never resets. |
| `Event ID` | `event_id` | String | FK → `AvailabilityEvents.event_id` |
| `Invitee Type` | `invitee_type` | String | `member` or `visitor` |
| `User Name` | `user_name` | String | FK → `Members.user_name` — blank for visitors |
| `Visitor Name` | `visitor_name` | String | Blank for members |
| `Visitor Email` | `visitor_email` | String | Blank for members |
| `Token` | `token` | String | 64-char hex — blank for members, set for visitors |
| `Token Expires At` | `token_expires_at` | String | ISO timestamp — same as event `expires_at`. Blank for members. |
| `Notified At` | `notified_at` | String | ISO timestamp of invite email send. Blank until sent. |
| `Created At` | `created_at` | String | ISO timestamp |

---

## 4. TypeScript Types

**File:** `src/types/availability.ts`

```typescript
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
  notifyCreatorOnResponse: boolean;   // if true, creator is emailed on each response save
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
  // Each entry is one person's set of responses across all slots
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
```

---

## 5. Data Layer

**File:** `src/lib/availability-sheets.ts`

Implement the following functions. Follow the exact patterns from `src/lib/invite-games-sheets.ts` and `src/lib/social-events-sheets.ts` for structure, column-map usage, and ID generation. Use `getGoogleSheetsClient()` from `src/lib/sheets.ts`. All Google Sheets calls go through the data layer — never call the SDK directly from route handlers.

### 5.1 ID Generators

```typescript
// Generate next event ID in AV-YYYY-NNN format, resetting each calendar year.
// Fetches all existing event IDs, finds the max NNN for the current year, increments.
async function generateEventId(): Promise<string>

// Generate next slot ID in AVS-NNNNNN format (never resets).
// Fetches all existing slot IDs, finds max N, increments.
async function generateSlotId(): Promise<string>

// Generate next response ID in AVR-NNNNNN format.
async function generateResponseId(): Promise<string>

// Generate next invitee ID in AVI-NNNNNN format.
async function generateInviteeId(): Promise<string>
```

For the NNNNNN IDs (slots, responses, invitees): fetch the entire sheet column A (IDs only), parse the numeric suffix of each, find the maximum, add 1. If the sheet is empty, start at 1. Pad to 6 digits with `String(n).padStart(6, '0')`.

For event IDs: filter to IDs matching the current year (`AV-YYYY-`), find max NNN for that year, pad to 3 digits.

### 5.2 Event Functions

```typescript
// Fetch all events. Used by the list page.
// Returns events filtered by the caller's access:
//   - All public events with status !== 'archived'
//   - Private events where the given userName appears in AvailabilityInvitees
//   - All events created by the given userName
// Resolves createdByName from Members sheet.
export async function getAvailabilityEvents(userName: string): Promise<AvailabilityEventSummary[]>

// Fetch a single event by eventId. Returns null if not found.
// Does NOT check access — caller (API route) is responsible for access checks.
export async function getAvailabilityEventById(eventId: string): Promise<AvailabilityEvent | null>

// Create a new event. Appends one row to AvailabilityEvents sheet.
// Returns the generated eventId.
export async function createAvailabilityEvent(
  data: {
    title: string;
    description: string;
    createdByUsername: string;
    visibility: AvailabilityVisibility;
    showResponsesToRespondents: boolean;
    notifyCreatorOnResponse: boolean;
    expiresAt: string;
  }
): Promise<string>

// Update event fields. Finds the event row by eventId, updates changed columns only.
// Sets updated_at to current ISO timestamp.
// Updatable fields: title, description, show_responses_to_respondents, notify_creator_on_response, expires_at, status
export async function updateAvailabilityEvent(
  eventId: string,
  updates: Partial<Pick<AvailabilityEvent,
    'title' | 'description' | 'showResponsesToRespondents' |
    'notifyCreatorOnResponse' | 'expiresAt' | 'status'
  >>
): Promise<void>

// Mark an event as concluded. Sets status, concluded_slot_id, conclusion_note,
// concluded_at, concluded_by_username, updated_at.
export async function concludeAvailabilityEvent(
  eventId: string,
  concludedSlotId: string,
  conclusionNote: string,
  concludedByUsername: string
): Promise<void>

// Archive an event (soft delete). Sets status = 'archived'.
export async function archiveAvailabilityEvent(eventId: string): Promise<void>

// Clear all conclusion fields when reopening an event.
// Sets concluded_slot_id, conclusion_note, concluded_at, concluded_by_username
// to empty string and sets updated_at to current ISO timestamp.
export async function clearConclusionFields(eventId: string): Promise<void>
```

### 5.3 Slot Functions

```typescript
// Fetch all slots for an event, ordered by display_order ascending.
export async function getSlotsForEvent(eventId: string): Promise<AvailabilitySlot[]>

// Add a slot. Appends one row. Returns the generated slotId.
export async function addAvailabilitySlot(
  eventId: string,
  slotDatetime: string,
  slotLabel: string,
  displayOrder: number
): Promise<string>

// Delete a slot by slotId. Also deletes all AvailabilityResponses rows
// for that slotId (cascading delete — fetch responses sheet, delete matching rows
// by iterating in reverse order to preserve row indices).
export async function deleteAvailabilitySlot(slotId: string): Promise<void>
```

### 5.4 Response Functions

```typescript
// Fetch all responses for an event.
export async function getResponsesForEvent(eventId: string): Promise<AvailabilityResponseRecord[]>

// Fetch responses for a specific respondent (member or visitor).
// For members, match by user_name. For visitors, match by invitee_id.
export async function getResponsesForRespondent(
  eventId: string,
  respondentType: AvailabilityRespondentType,
  identifier: string    // userName for members, inviteeId for visitors
): Promise<AvailabilityResponseRecord[]>

// Upsert a member's response for a slot.
// If a response row already exists for (eventId, slotId, userName), update it.
// Otherwise, append a new row.
// For updates, sets updated_at. For inserts, sets responded_at.
export async function upsertMemberResponse(
  eventId: string,
  slotId: string,
  userName: string,
  response: AvailabilityResponse
): Promise<void>

// Upsert a visitor's response for a slot, identified by inviteeId.
// Same upsert logic as above but matches on invitee_id column.
export async function upsertVisitorResponse(
  eventId: string,
  slotId: string,
  inviteeId: string,
  visitorName: string,
  visitorEmail: string,
  response: AvailabilityResponse
): Promise<void>
```

### 5.5 Invitee Functions

```typescript
// Fetch all invitees for an event.
export async function getInviteesForEvent(eventId: string): Promise<AvailabilityInvitee[]>

// Add a batch of invitees for a private event.
// For each member invitee: creates row with invitee_type='member', user_name, no token.
// For each visitor invitee: generates a 64-char hex token using crypto.randomBytes(32),
//   sets token and token_expires_at (from event's expires_at).
// Returns the list of created invitee records (needed for sending emails).
export async function addInvitees(
  eventId: string,
  tokenExpiresAt: string,
  memberUserNames: string[],
  visitorInvitees: Array<{ visitorName: string; visitorEmail: string }>
): Promise<AvailabilityInvitee[]>

// Validate a visitor token. Returns the matching invitee record or null.
// Checks: token exists, event matches, token_expires_at has not passed.
export async function validateVisitorToken(
  eventId: string,
  token: string
): Promise<AvailabilityInvitee | null>

// Mark one or more invitees as notified by setting notified_at.
export async function markInviteesNotified(inviteeIds: string[]): Promise<void>

// Check whether a member is on the invitee list for a private event.
export async function isMemberInvited(eventId: string, userName: string): Promise<boolean>
```

### 5.6 Composite Read Functions

These are used by the API route handlers to assemble full response objects.

```typescript
// Build AvailabilityEventDetail for the member response page.
// Fetches event, slots, and responses. Resolves display names.
// If event.showResponsesToRespondents is false AND the caller is not the creator,
// returns allResponses: [] (empty).
export async function getEventDetailForMember(
  eventId: string,
  callerUserName: string
): Promise<AvailabilityEventDetail | null>

// Build AvailabilityManageDetail for the manage page.
// Always returns full response grid regardless of showResponsesToRespondents.
export async function getEventManageDetail(
  eventId: string
): Promise<AvailabilityManageDetail | null>

// Build response detail for the guest token page.
// Validates token, fetches event + slots + the visitor's own existing responses.
// Returns null if token is invalid or expired.
export async function getEventDetailForVisitor(
  eventId: string,
  token: string
): Promise<{
  event: AvailabilityEvent;
  slots: AvailabilitySlot[];
  invitee: AvailabilityInvitee;
  myResponses: Record<string, AvailabilityResponse>;
  // If show_responses_to_respondents === 'Y', include other responses
  allResponses: AvailabilityParticipantResponses[];
  concludedSlot: AvailabilitySlot | null;
} | null>
```

---

## 6. API Routes

All routes follow the standard template from `CODING_STANDARDS.md §7`. Every route: check session → role check → validate input → call data layer → return JSON. Catch block logs `console.error('[ROUTE PATH] Error:', error)` and returns `{ error: '...' }` with status 500.

Public routes (guest token pages) must have in-memory rate limiting per `CODING_STANDARDS.md §27`.

### 6.1 `GET /api/availability`

**File:** `app/api/availability/route.ts`

Auth: any logged-in member (session required, no role check).  
Returns: `{ events: AvailabilityEventSummary[] }`  
Calls `getAvailabilityEvents(session.user.userName)`.  
The data layer function handles public/private filtering.

---

### 6.2 `POST /api/availability`

**File:** `app/api/availability/route.ts`

Auth: any logged-in member.  
Body: `CreateEventPayload`

Validation:
- `title` required, non-empty
- `expiresAt` required, must be a valid ISO date string, must be in the future
- `slots` required, must contain at least one entry
- Each slot: `slotDatetime` required, valid ISO date string
- If `visibility === 'private'`: at least one of `memberInvitees` or `visitorInvitees` must be non-empty
- Visitor invitees: `visitorName` and `visitorEmail` both required for each

Steps:
1. Call `createAvailabilityEvent(...)` — returns `eventId`
2. For each slot in `payload.slots`, call `addAvailabilitySlot(...)` with `displayOrder` = 1-based index
3. If `visibility === 'private'`, call `addInvitees(...)` — returns created invitees list
4. If private, send invite emails (see §8.1)
5. Return `{ success: true, eventId }`

---

### 6.3 `GET /api/availability/[eventId]`

**File:** `app/api/availability/[eventId]/route.ts`

Auth: any logged-in member.  
Returns: `AvailabilityEventDetail`

Access check:
- Fetch event. If not found → 404.
- If `visibility === 'public'`: allow any member.
- If `visibility === 'private'`: allow if `session.user.userName === event.createdByUsername` OR `isMemberInvited(eventId, userName)` returns true OR user has `Admin` role.
- Else → 403.

Calls `getEventDetailForMember(eventId, session.user.userName)`.

---

### 6.4 `PUT /api/availability/[eventId]`

**File:** `app/api/availability/[eventId]/route.ts`

Auth: logged-in member.  
Body: `Partial<{ title, description, showResponsesToRespondents, notifyCreatorOnResponse, expiresAt, status }>`

Access: `session.user.userName === event.createdByUsername` OR `hasRole(session.user.role, 'Admin')`.  
If event status is `concluded` or `archived` → 400 "Event cannot be edited in its current status".  
Calls `updateAvailabilityEvent(eventId, updates)`.  
Returns `{ success: true }`.

---

### 6.5 `DELETE /api/availability/[eventId]`

**File:** `app/api/availability/[eventId]/route.ts`

Auth: logged-in member.  
Access: creator or Admin.  
Calls `archiveAvailabilityEvent(eventId)`.  
Returns `{ success: true }`.

---

### 6.6 `POST /api/availability/[eventId]/slots`

**File:** `app/api/availability/[eventId]/slots/route.ts`

Auth: logged-in member.  
Body: `{ slotDatetime: string, slotLabel: string }`

Access: creator or Admin.  
Validation: `slotDatetime` required, valid ISO, in the future.  
Event must have status `open`.

Fetch existing slots for event to determine next `displayOrder` (max existing order + 1).  
Calls `addAvailabilitySlot(...)`.  
Returns `{ success: true, slotId }`.

---

### 6.7 `DELETE /api/availability/[eventId]/slots/[slotId]`

**File:** `app/api/availability/[eventId]/slots/[slotId]/route.ts`

Auth: logged-in member.  
Access: creator or Admin.  
Event must have status `open` — cannot delete slots after closing.  
Calls `deleteAvailabilitySlot(slotId)` (cascades to responses).  
Returns `{ success: true }`.

---

### 6.8 `POST /api/availability/[eventId]/respond`

**File:** `app/api/availability/[eventId]/respond/route.ts`

Auth: logged-in member.  
Body: `MemberRespondPayload`

Validation:
- `responses` must be a non-empty array
- Each entry: `slotId` and `response` (`yes` | `maybe` | `no`) required

Access check (same as GET for private events above).  
Event must have status `open` and `expires_at` must not be in the past → 400 if either fails.  
Verify each `slotId` belongs to the event (fetch slots for event, check set membership) → 400 if any mismatch.  
For each response, call `upsertMemberResponse(...)`.  
After all responses are saved, check `event.notifyCreatorOnResponse`. If `true`, fetch the creator's email from the Members sheet and send a response notification email (see §8.3). Email failure must not block the 200 response — log and continue.  
Returns `{ success: true }`.

---

### 6.9 `GET /api/availability/[eventId]/manage`

**File:** `app/api/availability/[eventId]/manage/route.ts`

Auth: logged-in member.  
Access: `session.user.userName === event.createdByUsername` OR `hasRole(session.user.role, 'Admin')`. Else → 403.  
Calls `getEventManageDetail(eventId)`.  
Returns `AvailabilityManageDetail`.

---

### 6.10 `POST /api/availability/[eventId]/conclude`

**File:** `app/api/availability/[eventId]/conclude/route.ts`

Auth: logged-in member.  
Body: `ConcludeEventPayload`

Access: creator or Admin.  
Validation:
- `concludedSlotId` required, must belong to this event
- Event must have status `open` or `closed` — cannot conclude an already-concluded event

Steps:
1. Call `concludeAvailabilityEvent(eventId, concludedSlotId, conclusionNote, session.user.userName)`
2. If `notifyRespondents === true`, send conclusion emails (see §8.2)
3. Return `{ success: true }`

---

### 6.11 `POST /api/availability/[eventId]/reopen`

**File:** `app/api/availability/[eventId]/reopen/route.ts`

Auth: logged-in member.  
Access: creator or Admin.  
Event must have status `closed` or `concluded` (not `archived`).  
Calls `updateAvailabilityEvent(eventId, { status: 'open' })`.  
Also clears `concluded_slot_id`, `conclusion_note`, `concluded_at`, `concluded_by_username` by calling a dedicated `clearConclusionFields(eventId)` function in the data layer (which updates those four columns to empty string and sets `updated_at`).  
Returns `{ success: true }`.

---

### 6.12 `POST /api/availability/[eventId]/invitees`

**File:** `app/api/availability/[eventId]/invitees/route.ts`

Auth: logged-in member.  
Body: `{ memberUserNames: string[], visitorInvitees: Array<{ visitorName, visitorEmail }> }`

Access: creator or Admin.  
Event must be `private` and status `open`.  
Purpose: allows the creator to add more invitees after initial creation (e.g. someone was missed).

Validation: same as create-event invitee validation.  
Calls `addInvitees(...)` → sends invite emails for new invitees only.  
Returns `{ success: true, addedCount: number }`.

---

### 6.13 `GET /api/availability/guest/[eventId]`

**File:** `app/api/availability/guest/[eventId]/route.ts`

Auth: **none** — public endpoint. Rate limit: 30 requests per minute per IP.  
Query param: `token` (required) → 400 if missing.

Calls `getEventDetailForVisitor(eventId, token)`.  
Returns 404 if null (invalid/expired token or event not found).  
Returns `{ event, slots, invitee: { visitorName }, myResponses, allResponses, concludedSlot }`.  
Do **not** return the token itself or `inviteeId` in the response body.

---

### 6.14 `POST /api/availability/guest/[eventId]/respond`

**File:** `app/api/availability/guest/[eventId]/respond/route.ts`

Auth: **none** — public endpoint. Rate limit: 10 requests per 5 minutes per IP (stricter, prevents abuse).  
Body: `GuestRespondPayload` (contains `token` and `responses` array).

Steps:
1. Validate token with `validateVisitorToken(eventId, token)` → 401 if null
2. Verify event is `open` and not expired → 400 if not
3. Validate each `slotId` belongs to event
4. For each response, call `upsertVisitorResponse(eventId, slotId, invitee.inviteeId, invitee.visitorName, invitee.visitorEmail, response)`
5. Check `event.notifyCreatorOnResponse`. If `true`, fetch creator's email and send a response notification email (see §8.3). Email failure must not block the 200 response — log and continue.
6. Return `{ success: true }`

---

## 7. Pages

### 7.1 `/availability` — Member Event List

**File:** `app/availability/page.tsx`  
**Client component.** Uses `useSessionRefresh()` hook.  
Uses `sessionStorage` caching pattern (§25 of CODING_STANDARDS.md) — key: `'AvailabilityListCache'`.

**Layout:**
- Page title: "Availability Planner"
- "Create Event" button (primary, top right) → links to `/availability/new`
- Three sections displayed as separate lists:

  **"Awaiting your response"** — open events where `hasResponded === false`  
  **"You've responded"** — open events where `hasResponded === true`  
  **"Concluded / Closed"** — events with status `concluded` or `closed`, collapsed by default (show toggle)

Each event card shows:
- Title (link to `/availability/[eventId]`)
- Created by name
- Visibility badge: green `Public` or amber `Private`
- Status badge: green `Open`, grey `Closed`, blue `Concluded`
- Expires: formatted date using `formatGameDate`
- Slot count
- Response count
- If concluded: the winning slot label/date
- "Manage" link → `/availability/[eventId]/manage` (only shown if current user is event creator)

If no events in a section, show a subtle empty-state message (e.g. "No events awaiting your response").

---

### 7.2 `/availability/new` — Create Event

**File:** `app/availability/new/page.tsx`  
**Client component.**  
Uses `saveDraft` / `restoreDraft` / `clearDraft` from `src/lib/form-draft-utils.ts` with key `'AvailabilityNewEvent'`.

**Form sections (all on one page, no steps):**

**Section 1 — Event Details**
- Title (text input, required)
- Description (textarea, optional)
- Expires On (date picker / date input, required — must be in the future)
- Visibility toggle: "Public" / "Private" (two-button toggle, default Public)
- Show responses to all respondents: Yes / No toggle (default Yes)
- Notify me when someone responds: Yes / No toggle (default No). Helper text beneath: *"Useful for one-on-one polls where an immediate reply matters."*

**Section 2 — Date/Time Slots**
- Label: "Candidate Date/Times"
- Instruction text: "Add at least one date and time for respondents to vote on."
- "Add Slot" button → opens an inline form with:
  - Date (date input)
  - Time (time input, optional — if omitted, event is treated as all-day)
  - Optional label override (text input, placeholder "e.g. Saturday afternoon")
  - "Add" / "Cancel" buttons
- Existing slots rendered as a list with a remove (×) button on each
- Slots display in the order added (display_order = order added)
- Validation: at least 1 slot required before submitting

**Section 3 — Invitees (only shown when Visibility = Private)**
- Two sub-sections side by side (stacked on mobile):
  - **Members:** searchable select using existing member lookup (same `SearchableSelect` component used elsewhere). Selecting a member adds them to a displayed list. Remove button on each. Shows member's full name.
  - **Visitors:** small form: Name (text) + Email (email input) + "Add" button. Added visitors shown in list with remove button.
- Validation: at least one invitee (member or visitor) required for private events

**Submit:** "Create Event" button (primary).  
On success: clear draft, redirect to `/availability/[eventId]/manage`.  
On error: show inline error alert.

---

### 7.3 `/availability/[eventId]` — Member Response Page

**File:** `app/availability/[eventId]/page.tsx`  
**Client component.** Uses `useSessionRefresh()`.  
Fetches from `GET /api/availability/[eventId]`.

**Layout:**

- Back link → `/availability` (use `<RouterBackLink>`)
- Event title (h1)
- Description (if present)
- Created by / Expires On metadata row
- "Manage Event" link (secondary button) — only shown if current user is event creator
- Status banner: if status is `concluded`, show a green info box with the winning slot and conclusion note. If expired but still `open`, show amber "This event has expired — no more responses are being accepted."

**Response grid** (main content):

Displayed as a table or card grid (responsive):
- One column per slot. Slot header shows the label (or formatted datetime if no label). Show date on one line and time below in smaller text.
- One row per respondent (if `showResponsesToRespondents === true`, or if current user is the creator).
- The current user's row is always shown first and is editable.
- Other respondents shown below (read-only) — display name only (not email).
- Response cells for the current user: three clickable buttons: **✓ Yes** (green), **? Maybe** (amber), **✗ No** (red). Selected state is visually distinct (filled background vs outline). Unresponded slots show all three options with equal weight.
- Response cells for other respondents: coloured badge only (✓ / ? / ✗).

**Slot summary row** (below the grid, above other respondents):
- Per slot: count of Yes / Maybe / No responses shown as coloured counts.

**Save button:** "Save My Responses" (primary). Calls `POST /api/availability/[eventId]/respond` with all current user's slot responses. Show success/error inline. The button is disabled if the event is expired or not open.

If the event is private and the current user is not on the invitee list: show 403 message ("You have not been invited to this event").

---

### 7.4 `/availability/[eventId]/manage` — Management Page

**File:** `app/availability/[eventId]/manage/page.tsx`  
**Client component.** Uses `useSessionRefresh()`.  
Only accessible to event creator or Admin (enforced both in middleware and API). Non-creators see 403.

Fetches from `GET /api/availability/[eventId]/manage`.

**Layout:**

**Header section:**
- Back link → `/availability`
- Event title (h1) + status badge
- "Edit Event" button (secondary) — opens an inline edit panel for title, description, expiry, show_responses_to_respondents, notify_creator_on_response. Uses `PUT /api/availability/[eventId]`.
- "View as Member" link → `/availability/[eventId]` (opens in same tab)

**Status controls (top right button group):**
- If `open`: "Close Event" button → calls PUT with `{ status: 'closed' }`
- If `closed`: "Reopen" button → calls POST `/reopen`; "Conclude Event" button → opens conclude panel
- If `concluded`: "Reopen" button → calls POST `/reopen`
- Archive: always show a "Archive Event" danger button

**Response grid:**
Same grid as the response page but always shows all respondents regardless of `showResponsesToRespondents`. The creator cannot edit responses from this page (read-only). Include the per-slot Yes/Maybe/No summary row. Highlight the concluded slot column (if concluded) with a green header.

**Conclude Event panel** (shown inline when creator clicks "Conclude Event"):
- Dropdown: "Choose the winning slot" — lists all slots by label/datetime
- Text area: "Conclusion note" (optional, placeholder "e.g. We'll go with Saturday 14 June at 2pm — see you there!")
- Checkbox: "Send notification email to all respondents"
- "Confirm Conclusion" (primary) + "Cancel" buttons
- Calls `POST /api/availability/[eventId]/conclude`

**Invitees section** (only for private events, shown below grid):
- Header: "Invitees"
- Table: Name | Type (Member/Visitor) | Notified | Responded
- "Add More Invitees" button → opens the same member/visitor invitee sub-form as the create page. On save: calls `POST /api/availability/[eventId]/invitees` → triggers emails for newly added invitees.

**Slots section:**
- Lists current slots in display order
- "Add Slot" button (same inline form as create page). Calls `POST /api/availability/[eventId]/slots`.
- Each existing slot has a "Remove" (×) button — only enabled while event is `open`. Calls `DELETE /api/availability/[eventId]/slots/[slotId]`.
- Warn before deleting: "Removing this slot will also delete all responses to it."

---

### 7.5 `/availability/guest/[eventId]` — Visitor Response Page

**File:** `app/availability/guest/[eventId]/page.tsx`  
**Client component. No authentication required.** Reads `token` from `useSearchParams()`.

If `token` is absent from the URL: show a plain message "This link appears to be incomplete. Please check the email you received and try again."

Fetches from `GET /api/availability/guest/[eventId]?token=<token>`.  
On 401/404: show "This link is no longer valid or has expired."  
On event expired (status not `open`): show read-only view with "This event is no longer accepting responses."

**Layout:**
- BHBC branding header (same as public pages — no nav required)
- Greeting: "Hello [visitorName]"
- Event title (h1)
- Description
- Created by name
- Expiry date
- Response grid — identical layout and interaction to the member response page (§7.3) but with no login-gated rows for other respondents. The visitor's own row is the editable row.
- "Save My Responses" button. On success: show a success confirmation message inline ("Your responses have been saved. You can update them any time using this link."). Do not redirect.
- No nav bar, no session UI.

---

## 8. Email Templates

### 8.1 Invite Email

**File:** `src/lib/email/templates/availability-invite.html`

Subject line (embedded as HTML comment at top of template, as per project convention):
```html
<!-- Subject: You're invited — {{eventTitle}} -->
```

Handlebars variables:
- `{{inviteeName}}` — recipient's name (member's known_as + last_name, or visitor's name)
- `{{eventTitle}}`
- `{{eventDescription}}` — may be blank; wrap in `{{#if eventDescription}}...{{/if}}`
- `{{creatorName}}` — event creator's full known name
- `{{expiresAtFormatted}}` — human-readable date, e.g. "Friday, 20 June 2026"
- `{{responseUrl}}` — full URL to respond:
  - Members: `https://<APP_URL>/availability/<eventId>` (login-required page)
  - Visitors: `https://<APP_URL>/availability/guest/<eventId>?token=<token>`

Template structure:
1. Greeting: "Hello {{inviteeName}},"
2. Body: "{{creatorName}} has invited you to indicate your availability for **{{eventTitle}}**."
3. Description block (conditional)
4. "Please respond by {{expiresAtFormatted}}."
5. Large CTA button → `{{responseUrl}}` labelled "Indicate My Availability"
6. Footer: standard BHBC footer

**Send logic** in the create-event API route (and add-invitees route):

```typescript
// Members: one BCC email. All member emails in the BCC field. Body uses the
// generic login URL (no token). Use getEmailTransporter() — single standard send.
const memberEmails = resolvedMemberInvitees.map(m => m.emailAddress).filter(Boolean).join(', ');
if (memberEmails) {
  await transporter.sendMail({
    from: ...,
    bcc: memberEmails,
    subject: `You're invited — ${event.title}`,
    html: compiledHtml,   // responseUrl = /availability/<eventId> (no token)
  });
}

// Visitors: individual sequential emails via pooled transporter.
// Each email has that visitor's unique token in responseUrl.
const pooledTransporter = getEmailTransporter(true);
for (const invitee of visitorInvitees) {
  // Build visitor-specific HTML with their token URL
  await pooledTransporter.sendMail({ ... });
}
pooledTransporter.close();
```

After sending, call `markInviteesNotified(inviteeIds)` to set `notified_at`.

---

### 8.2 Conclusion Email

**File:** `src/lib/email/templates/availability-conclusion.html`

Subject line:
```html
<!-- Subject: Event update — {{eventTitle}} -->
```

Handlebars variables:
- `{{respondentName}}`
- `{{eventTitle}}`
- `{{chosenSlotLabel}}` — the winning slot label or formatted datetime
- `{{conclusionNote}}` — may be blank; wrap in `{{#if conclusionNote}}`
- `{{creatorName}}`

Template structure:
1. Greeting
2. Body: "{{creatorName}} has finalised **{{eventTitle}}**."
3. "The chosen date is: **{{chosenSlotLabel}}**"
4. Conclusion note block (conditional)
5. Standard footer

**Send logic** in the conclude-event API route (only when `notifyRespondents === true`):

Fetch all unique respondents from `getResponsesForEvent(eventId)`. Deduplicate by `userName` / `visitorEmail` (a person may have responded to multiple slots — only send one email).

```typescript
// Members who responded: one BCC email (generic, no token needed)
// Visitors who responded: individual sequential emails via pooled transporter
```

---

### 8.3 Response Notification Email

**File:** `src/lib/email/templates/availability-response-notification.html`

Sent to the event creator when `notify_creator_on_response === 'Y'` and any respondent saves their responses. Uses the standard `sendTemplateEmail()` — single transactional send to one recipient, no pooled transporter needed.

Subject line:
```html
<!-- Subject: New response — {{eventTitle}} -->
```

Handlebars variables:
- `{{creatorName}}` — event creator's display name
- `{{eventTitle}}`
- `{{respondentName}}` — the member's full known name, or the visitor's name
- `{{manageUrl}}` — full URL to the manage page: `https://<APP_URL>/availability/<eventId>/manage`

Template structure:
1. Greeting: "Hello {{creatorName}},"
2. Body: "{{respondentName}} has just responded to **{{eventTitle}}**."
3. CTA button → `{{manageUrl}}` labelled "View Responses"
4. Standard BHBC footer

**Send logic** (used in both `POST /api/availability/[eventId]/respond` and `POST /api/availability/guest/[eventId]/respond`):

```typescript
// Only send if notify_creator_on_response === true
if (event.notifyCreatorOnResponse) {
  // Fetch creator's email address from the Members sheet.
  // Use the existing getUserByUsername() (or equivalent member lookup) from src/lib/sheets.ts
  // or src/lib/auth-sheets.ts — do not add a new member lookup function.
  const creator = await getMemberByUsername(event.createdByUsername);

  // Only send if creator has a registered email address
  if (creator && creator.emailAddress) {
    const emailResult = await sendTemplateEmail(
      creator.emailAddress,
      `New response — ${event.title}`,
      'availability-response-notification',
      {
        creatorName: creator.knownAs || creator.firstName,
        eventTitle: event.title,
        respondentName: respondentDisplayName,
        manageUrl: `${process.env.NEXTAUTH_URL}/availability/${event.eventId}/manage`,
      }
    );

    // Email failure must not block the response save — log and continue
    if (!emailResult.success) {
      console.error('[respond] Failed to send creator notification:', emailResult.error);
    }
  }
}
```

`respondentDisplayName` is:
- For members: the member's `full_known_as` (resolved from Members sheet using `session.user.userName`)
- For visitors: the `visitor_name` from the invitee record

---

## 9. Middleware Update

**File:** `middleware.ts`

The guest response page must be publicly accessible (no NextAuth redirect). Add it to the public routes list:

```typescript
// Availability guest token page — no auth required
'/availability/guest/:path*'
```

All other `/availability/*` routes require authentication (already covered by the default authenticated-routes rule, but verify the middleware matcher includes them).

---

## 10. Navigation Update

**File:** wherever the main nav items are defined (check `src/components/` for the Navbar component).

Add "Availability" as a nav link pointing to `/availability`. It should appear alongside Social Events and Internal Games in the navigation order. Use the same `getNavItemClasses()` helper from `theme-helpers.ts`.

Show the link to all authenticated members (no role restriction).

---

## 11. Help Page

**File:** `app/help/availability/page.tsx`

Following the project's help page pattern (see existing pages under `app/help/`), create a help page for the availability planner covering:

1. What the availability planner is
2. How to create an event (public vs private, setting expiry, adding slots)
3. How to add invitees to a private event
4. How to respond to an event (Yes / Maybe / No)
5. What visitors see (token link in email, no login needed)
6. How to manage an event (view responses, add slots, close, conclude)
7. What "Show responses to all respondents" means
8. What "Notify me when someone responds" means and when to use it
9. Concluding an event and sending the notification email
10. Archiving an event

---

## 12. Build Order

Implement in this order to allow incremental testing at each stage:

1. **Environment variable** — add `AVAILABILITY_SPREADSHEET_ID` getter, create spreadsheet, add to `.env.local`
2. **TypeScript types** — `src/types/availability.ts`
3. **Data layer** — `src/lib/availability-sheets.ts` (all functions). Test each function in isolation by writing temporary test API routes if needed.
4. **Core API routes** — events CRUD (`/api/availability`, `/api/availability/[eventId]`), slots, respond
5. **Guest API routes** — `/api/availability/guest/[eventId]` GET and POST with token validation
6. **Manage API routes** — `/api/availability/[eventId]/manage`, conclude, reopen, invitees
7. **Pages** — list → create → response page → guest page → manage page
8. **Email templates** — invite, conclusion, and response-notification; wire up send logic in create, conclude, and both respond routes
9. **Middleware update** — add guest path to public routes
10. **Navigation** — add nav link
11. **Help page**
12. **Version bump** — `npm run release:minor`

---

## Coding Standards Reminders Specific to This Feature

- No `?.` or `??` anywhere — use explicit `if` checks.
- No `Promise.all()` for email sends — sequential pooled transporter only.
- Public routes (`/api/availability/guest/*`) must have rate limiting (in-memory Map).
- The guest page form must include a honeypot field (`website` input, `display: none`).
- All text visible to users must use `text-gray-700` minimum — never `text-gray-400/500/600`.
- Buttons and badges must use `getButtonClasses()` and `getBadgeClasses()` from `theme-helpers.ts`.
- All datetime values stored in sheets are ISO strings — no `new Date(sheetString)` directly; use `parseUKDate()` from `date-utils.ts` when parsing any date from the sheet.
- Slot datetimes are written by the app as ISO strings, so they can be safely parsed with `new Date()` on read — but prefer `parseUKDate()` for consistency.
- Every file must start with the path + description header comment.
- Every function, loop, if-statement, API call, and state update must have a comment.
- New protected routes do not need individual page-level auth guards if middleware covers them — but verify the middleware matcher.
- `session.user.userName` is always the correct identifier — works transparently during admin impersonation.
- Google Sheets calls must go through the data layer — never call `googleapis` directly from route handlers.
