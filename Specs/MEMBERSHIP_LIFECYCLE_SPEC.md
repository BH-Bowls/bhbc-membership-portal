# BHBC Membership Portal — Membership Lifecycle Management
## Spec version 1.1 | June 2026

---

## Overview

This spec covers two related features:

1. **Application Management** — an admin workflow to progress new applicants from form submission through to full membership
2. **Member Archiving** — a managed process to move leavers to a `Leavers` sheet and reinstate them if needed

Both features are surfaced through a new `/admin/members` section of the portal.

---

## Preliminary Audit

Before writing any code, Claude Code must audit the live codebase for:

- `app/api/apply/route.ts` — understand current application submission handler and confirm the Applications sheet tab name. The Applications sheet lives in the Members spreadsheet (`MEMBERS_SPREADSHEET_ID`) — use `getSpreadsheetId()` from `src/lib/sheets.ts`
- `src/lib/renewals-sheets.ts` — understand fee calculation logic to replicate for applications
- `src/lib/email/renewal-mailer.ts` and `src/lib/email/member-mailer.ts` — understand email sending patterns
- `app/page.tsx` (home page) — locate the Diary / Coming Up panel component and understand its data fetching and cache invalidation pattern
- `src/lib/sheets.ts` `getAllUsers()` — confirm it reads only from the `Members` sheet tab (not `Leavers`)
- `middleware.ts` — confirm `/admin/*` routes are protected to Admin role only

---

## Part 1 — Schema Changes

### 1.1 Applications Sheet (existing sheet, new columns)

Add the following columns to the right of the existing Applications sheet. Do not alter existing columns or their order.

| New Column | Type | Notes |
|---|---|---|
| `Status` | String | `Submitted` / `Listed` / `Approved` / `Paid` / `Converted` / `Rejected` |
| `Listed Date` | String | DD/MM/YYYY — date physically added to clubhouse board |
| `Fee Due` | Number | Calculated on submission; can be overridden before payment email is sent |
| `Fee Paid` | Number | Entered when marking as Paid |
| `Payment Method` | String | `Bank Transfer` / `Card` / `Cash` / `Cheque` |
| `Payment Date` | String | DD/MM/YYYY |
| `Decision Notes` | String | Free text — reason for rejection or any admin notes |
| `Approved At` | String | ISO timestamp — when Approved action was taken |
| `Converted At` | String | ISO timestamp — when Convert to Member action was taken |
| `Converted Username` | String | The `user_name` assigned when converted |

**Backfill:** All existing rows in the Applications sheet should have `Status` set to `Converted` manually by Liam after this feature is deployed, since they are all historical accepted members.

### 1.2 New `Leavers` Sheet (new sheet tab in Members spreadsheet)

Create a new sheet tab called `Leavers` in the Members spreadsheet (`MEMBERS_SPREADSHEET_ID`).

Column structure: **identical to the `Members` sheet**, with three additional columns appended at the right:

| Extra Column | Type | Notes |
|---|---|---|
| `Left Date` | String | DD/MM/YYYY — date archived |
| `Left Reason` | String | `Lapsed` / `Resigned` / `Deceased` |
| `Left Notes` | String | Free text — optional admin notes |

The sheet must have a header row identical to Members row 1, plus the three extra headers. Data starts at row 2.

---

## Part 2 — Fee Calculation for New Applications

### 2.1 Logic

Fee calculation runs on the server when a new application is submitted (in `app/api/apply/route.ts`) and stores the result in the `Fee Due` column. The admin can override it before sending the payment email.

The calculation mirrors renewals fee logic. Audit `src/lib/renewals-sheets.ts` to understand the base fee amounts and member type mapping. Apply pro-rata reduction based on the current calendar month at time of submission:

- **January–April** (before season opens): full fee
- **May**: full fee (season just starting)
- **June**: 11/12 of full fee
- **July**: 10/12 of full fee
- **August**: 9/12 of full fee
- **September**: 8/12 of full fee
- **October onwards**: 7/12 of full fee (minimum — late season)

Round to nearest 50p (i.e. round to nearest 0.50).

The member type for fee calculation is derived from gender + membership type submitted on the form:
- Male + Playing → `PM`
- Female + Playing → `PL`
- Male + Social → `SM`
- Female + Social → `SL`

Store the calculated fee in the `Fee Due` column at the time of submission.

---

## Part 3 — New Admin Section: `/admin/members`

### 3.1 Route Structure

```
/admin/members                    — Member Management hub (tabs or cards linking to sub-sections)
/admin/members/applications       — Applications list and workflow
/admin/members/leavers            — Leavers list with reinstate action
```

All routes under `/admin/*` must be Admin-only. Confirm that `middleware.ts` already enforces this; if not, add the guard.

Add navigation entries for this section. The nav item label should be **"Members"** under an **"Admin"** group (or wherever the existing admin nav items sit — audit `src/components/Navbar.tsx` to match the existing pattern).

### 3.2 `/admin/members` Hub Page

A simple landing page with two prominent action cards:

- **Applications** — "Review and process new membership applications" → links to `/admin/members/applications`
- **Members & Leavers** — "Archive departing members and reinstate leavers" → links to `/admin/members/leavers`

Also display a summary count badge on the Applications card if there are applications awaiting action (status `Submitted` with no `Listed Date`, or status `Listed` with objection period expired). This count comes from the same API call used by the Diary panel (see §5).

---

## Part 4 — Applications Workflow (`/admin/members/applications`)

### 4.1 Page Layout

The page displays all applications grouped by status in the following tab or section order:

1. **Action Required** — `Submitted` (no listed date yet) + `Listed` where `listed_date + 14 days ≤ today`
2. **Pending** — `Listed` where objection period has not yet passed
3. **Approved** — awaiting payment
4. **Paid** — payment received, ready to convert
5. **Converted** — historical record (collapsed by default, expandable)
6. **Rejected** — historical record (collapsed by default, expandable)

Each application row shows: name, email, member type, submitted date, listed date (if set), objection deadline (if listed), status badge, and an action button.

### 4.2 Actions Per Status

#### Status: `Submitted`
Available actions:
- **Set Listed Date** — opens a modal with a date picker (defaults to today). On confirm, writes `Listed Date` to the Applications sheet and sets `Status` to `Listed`. Sends no email.

#### Status: `Listed` (objection period not yet passed)
Display only. Show the objection deadline date prominently. No actions available until the deadline passes.

#### Status: `Listed` (objection period passed — "Action Required")
Available actions:
- **Approve** — opens a modal (see §4.3)
- **Reject** — opens a modal with a free-text `Decision Notes` field and a confirm button. Sets status to `Rejected`. Does not automatically send an email (rejection communication is handled manually/by phone).

#### Status: `Approved`
Available actions:
- **Mark as Paid** — opens a modal with fields: Fee Paid (£, pre-filled with Fee Due), Payment Method (dropdown), Payment Date (date picker, defaults to today). On confirm, writes payment fields and sets status to `Paid`.
- **Resend Payment Email** — resends the payment request email. Useful if the applicant hasn't responded.

#### Status: `Paid`
Available actions:
- **Convert to Member** — opens a confirmation modal showing the derived `user_name` (see §4.4) and a summary of the member details to be created. On confirm, runs the conversion (see §4.4).

#### Status: `Converted` / `Rejected`
Read-only. Display details only. No actions.

### 4.3 Approve Modal

Fields:
- **Fee Due** (£) — pre-filled with calculated value from the Applications sheet. Editable.
- **Notes** — optional free text

On confirm:
1. Update Applications sheet: `Fee Due` (if changed), `Status` → `Approved`, `Approved At` → current ISO timestamp
2. Send payment request email to the applicant (see §4.5)

### 4.4 Convert to Member Logic

This is the core conversion step. Run server-side in a new API route `POST /api/admin/applications/[id]/convert`.

**Step 1 — Derive username**

```
baseFirst = knownAs if knownAs is non-empty, else firstName
userName  = (baseFirst + '.' + lastName).toLowerCase()
           with spaces removed and non-alphanumeric characters (except '.') stripped
```

Examples:
- Known As "Jim", Last Name "O'Brien" → `jim.obrien`
- Known As blank, First Name "Sarah", Last Name "Smith" → `sarah.smith`
- Known As "A.J.", Last Name "Moore" → `aj.moore`

If the derived `user_name` already exists in **either** the Members sheet or the Leavers sheet, append a number suffix: `jim.obrien2`, `jim.obrien3`, etc. Both sheets must be checked before writing, since a leaver retains their original username and reinstating them later would cause a collision if a new member had been assigned the same name.

**Step 2 — Generate temporary password**

Generate a random 8-character alphanumeric temporary password. Store as bcrypt hash in the Members sheet (`password_hash`), and set `is_temp_password` to `Y`.

**Step 3 — Translate member type**

| Gender (from application) | Membership Type (from application) | member_type |
|---|---|---|
| M | Playing | PM |
| F | Playing | PL |
| M | Social | SM |
| F | Social | SL |

**Step 4 — Write to Members sheet**

Append a new row to the `Members` sheet. Map application fields to Members columns as follows:

| Members column | Source |
|---|---|
| `first_name` | application `First Name` |
| `last_name` | application `Last Name` |
| `known_as` | application `Known As` |
| `email_address` | application `Email Address` |
| `landline` | application `Landline` |
| `mobile` | application `Mobile` |
| `address_1` | application `Address 1` |
| `address_2` | application `Address 2` |
| `address_3` | application `Address 3` |
| `post_code` | application `Post Code` |
| `age_demographic` | application `Age Demographic` |
| `birthdate` | application `DOB` |
| `member_type` | derived (see Step 3) |
| `year_started` | current calendar year |
| `user_name` | derived (see Step 1) |
| `password_hash` | bcrypt hash of temp password (see Step 2) |
| `is_temp_password` | `Y` |
| `role` | `Member` |
| `include` | `Y` |
| `social_emails` | `Y` |
| `handbook_entry` | `Y` |
| `created_at` | current ISO timestamp |
| `updated_at` | current ISO timestamp |

All other Members columns: leave blank.

**Step 5 — Update Application row**

Set `Status` → `Converted`, `Converted At` → current ISO timestamp, `Converted Username` → the assigned `user_name`.

**Step 6 — Send welcome email**

Send a welcome email to the applicant's email address (see §4.6).

**Step 7 — Return result**

Return the assigned `user_name` and a success confirmation to the UI. The UI should display the username to the admin so they can note it if needed.

### 4.5 Payment Request Email

Template name: `application-payment-request`

Create `src/lib/email/templates/application-payment-request.html`.

The email follows the same HTML structure and brand styling as existing templates in `src/lib/email/templates/`. Audit an existing renewal payment email template for the exact HTML structure to replicate.

Variables to inject:
- `{{firstName}}` — applicant's known as or first name
- `{{feeAmount}}` — formatted as £XX.XX
- `{{memberType}}` — human-readable e.g. "Playing Lady", "Social Man"
- `{{bankDetails}}` — audit `src/lib/email/renewal-mailer.ts` (or the renewals email template) to find how bank details are currently sourced and injected, and replicate that exact mechanism here
- `{{contactEmail}}` — `burgesshillbc@gmail.com` (or from Portal Config key `ContactEmail`)

Subject: `Burgess Hill Bowls Club — Membership Fee`

Sent to: applicant's email address
CC: `burgesshillbc@gmail.com`

### 4.6 Welcome / Credentials Email

Template name: `application-welcome`

Create `src/lib/email/templates/application-welcome.html`.

Variables:
- `{{firstName}}` — known as or first name
- `{{userName}}` — their new portal username
- `{{tempPassword}}` — the plain-text temporary password (only time it is sent in plain text)
- `{{portalUrl}}` — the portal login URL (from env var `NEXTAUTH_URL`)

The email should welcome them as a new member, give their login credentials, and note that they will be asked to change their password on first login.

Subject: `Welcome to Burgess Hill Bowls Club — Your Portal Login`

Sent to: applicant's email address only (no CC).

---

## Part 5 — Diary Panel Integration

### 5.1 New API Endpoint

Create `GET /api/admin/applications/pending-count`.

- Admin-only route
- Reads the Applications sheet
- Returns a count of applications that need action:
  - Status is `Submitted` (needs a listed date set), OR
  - Status is `Listed` AND `listed_date + 14 days ≤ today` (objection period has passed)
- Response: `{ count: number }`

### 5.2 Home Page / Diary Panel Integration

Audit `app/page.tsx` and the Diary / Coming Up panel component to understand the existing data fetching pattern and the 48-hour per-user cache mechanism.

Add a new item type to the Diary panel data fetch. If the current user has the `Admin` role:

- Call `GET /api/admin/applications/pending-count` as part of the Diary data fetch
- If `count > 0`, include a Diary panel item of the new type `applications_pending`:
  - Icon: a suitable indicator (e.g. a person/user icon or document icon — match the style of other Diary panel items)
  - Text: `"[N] membership application[s] ready for review"` (pluralise correctly)
  - Link: `/admin/members/applications`

This item should appear at the top of the Diary panel, above other items, when present.

The 48-hour cache is acceptable — applications ready for review are not time-critical to the hour.

Cache invalidation: The Diary cache should be invalidated when:
- A `Listed Date` is set on an application (status changes from `Submitted` to `Listed`)
- An application is `Approved`, `Rejected`, or `Converted`

Follow the existing cache invalidation pattern used by other write operations in the Diary panel.

---

## Part 6 — Member Archiving (`/admin/members/leavers`)

### 6.1 Page Layout

The page has two sections:

**Active Members — Archive**

A searchable list of all current active members (from the Members sheet). Search filters by name. Each row shows: name, member type, year started, email, and an **Archive** button.

**Leavers — Reinstate**

A list of all rows in the `Leavers` sheet. Each row shows: name, member type, left date, left reason, and a **Reinstate** button.

Both lists are loaded on page mount. Use the standard `sessionStorage` back-button cache pattern only for the Leavers list (it changes infrequently). The active members list can re-fetch each visit.

### 6.2 Archive Action

Clicking **Archive** on an active member opens a confirmation modal with:
- Member name (read-only, for confirmation)
- **Reason** — dropdown: `Lapsed` / `Resigned` / `Deceased`
- **Left Date** — date picker, defaults to today
- **Notes** — optional free text

On confirm, call `POST /api/admin/members/[userName]/archive`.

**Server-side logic:**

1. Fetch the member row from the `Members` sheet by `user_name`
2. Append that row to the `Leavers` sheet, adding `left_date`, `left_reason`, `left_notes` in the three extra columns
3. Delete the row from the `Members` sheet (physical row deletion, not a soft delete)
4. Invalidate the Diary panel cache for this user (to clear any stale member data)
5. Return success

**Important:** Do not send any email as part of this action. Communication with the leaving member is handled manually.

**Important:** The `Leavers` sheet columns must be written in the same order as the Members sheet headers, resolved via `getColumnMap`. Do not hardcode column positions.

### 6.3 Reinstate Action

Clicking **Reinstate** on a leaver opens a confirmation modal with:
- Member name (read-only)
- A note: "This will restore [Name] as an active member. You may wish to update their contact details and reset their password after reinstatement."
- Confirm button

On confirm, call `POST /api/admin/members/[userName]/reinstate`.

**Server-side logic:**

1. Fetch the member row from the `Leavers` sheet by `user_name`
2. Write that row back to the `Members` sheet (append), **excluding** the `left_date`, `left_reason`, `left_notes` columns (they have no corresponding Members columns)
3. Delete the row from the `Leavers` sheet
4. Return success

After reinstatement, the admin should manually:
- Update any changed contact details via the member's profile
- Reset the password if needed (via the existing admin impersonation or password reset flow)

---

## Part 7 — New API Routes Summary

All new routes are Admin-only unless stated. All follow existing patterns in the codebase: validate session, use `getColumnMap`, use `withRetry` (automatically, via the sheets client), return `{ success: true/false }` with appropriate HTTP status codes.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/admin/applications` | List all applications with status |
| `PATCH` | `/api/admin/applications/[id]/set-listed-date` | Set listed date, status → Listed |
| `PATCH` | `/api/admin/applications/[id]/approve` | Set fee, status → Approved, send payment email |
| `PATCH` | `/api/admin/applications/[id]/reject` | Set notes, status → Rejected |
| `PATCH` | `/api/admin/applications/[id]/mark-paid` | Set payment fields, status → Paid |
| `PATCH` | `/api/admin/applications/[id]/resend-payment-email` | Resend payment request email |
| `POST` | `/api/admin/applications/[id]/convert` | Full conversion to Member (see §4.4) |
| `GET` | `/api/admin/applications/pending-count` | Count of applications needing action (for Diary) |
| `GET` | `/api/admin/members` | List active members for archiving |
| `POST` | `/api/admin/members/[userName]/archive` | Move member to Leavers sheet |
| `GET` | `/api/admin/leavers` | List all leavers |
| `POST` | `/api/admin/members/[userName]/reinstate` | Move leaver back to Members sheet |

**Application ID:** The `[id]` parameter should be the row number in the Applications sheet (integer). This is the simplest stable identifier given the Google Sheets backend. The API must validate that the row number is within bounds and that the row's current status is valid for the requested action (e.g. cannot Approve an already-Converted application).

---

## Part 8 — Data Library Files to Create

Create the following new files, following the naming and pattern conventions of existing `*-sheets.ts` files:

### `src/lib/applications-sheets.ts`

Functions:
- `getAllApplications()` — reads entire Applications sheet, returns typed array
- `getApplicationByRow(rowNumber: number)` — reads a single application row
- `updateApplicationFields(rowNumber: number, fields: Partial<Application>)` — writes specified fields only
- `getPendingApplicationsCount()` — returns count of applications needing action (for Diary endpoint)

### `src/lib/leavers-sheets.ts`

Functions:
- `getAllLeavers()` — reads entire Leavers sheet
- `archiveMember(user: User, leftDate: string, leftReason: string, leftNotes: string)` — appends to Leavers, deletes from Members
- `reinstateMember(userName: string)` — reads from Leavers, appends to Members, deletes from Leavers

Define a TypeScript interface `Application` in `src/lib/applications-sheets.ts`:

```typescript
// Application — represents one row from the Applications sheet
interface Application {
  rowNumber: number;          // 1-indexed sheet row
  firstName: string;
  lastName: string;
  knownAs: string;
  gender: string;             // 'M' or 'F'
  emailAddress: string;
  landline: string;
  mobile: string;
  address1: string;
  address2: string;
  address3: string;
  postCode: string;
  ageDemographic: string;
  dob: string;
  ftEducation: string;
  memberType: string;         // 'Playing' or 'Social'
  previousExperience: string;
  disabilities: string;
  proposerName: string;
  seconderName: string;
  comments: string;
  createdAt: string;
  // New columns:
  status: string;
  listedDate: string;
  feeDue: number | null;
  feePaid: number | null;
  paymentMethod: string;
  paymentDate: string;
  decisionNotes: string;
  approvedAt: string;
  convertedAt: string;
  convertedUsername: string;
}
```

---

## Part 9 — Middleware Updates

Audit `middleware.ts`. Confirm that `/admin/*` routes are already restricted to Admin role. If they are not, add the guard.

Add `/admin/members`, `/admin/members/applications`, and `/admin/members/leavers` (and their API equivalents under `/api/admin/`) to whatever existing Admin-only guard mechanism is in place.

---

## Part 10 — Coding Standards Reminders

- All new files must have a header comment with file path and description
- All functions must have a comment explaining what they do
- Use `parseUKDate` / `normalizeToUKDate` from `src/lib/date-utils.ts` for all date handling — never `new Date(dateString)` directly
- Use `getColumnMap()` for all sheet reads/writes — never hardcode column positions
- Use `getButtonClasses()`, `getInputClasses()`, `getCardClasses()` from `src/config/theme-helpers.ts`
- Use `text-gray-700` minimum for all readable text — never `text-gray-400/500/600`
- Use `sendTemplateEmail()` from `src/lib/email/mailer.ts` for all emails — never construct raw HTML in route handlers
- Use inline error state (`useState`) for all error display — never `alert()`
- `getAllUsers()` and related member queries already have `withRetry` — do not add your own retry loops
- The Applications sheet is in a different spreadsheet from Members — confirm the correct spreadsheet ID by auditing `app/api/apply/route.ts`
- All modals should use the existing `ConfirmDialog` component pattern if it fits, or follow the existing modal pattern from `src/components/`

---

## Part 11 — Out of Scope

The following are explicitly out of scope for this spec and should not be built:

- Password reset for reinstated members (handled via existing forgot-password flow)
- Bulk archive or bulk reject actions
- Email notification to the leaving member on archive
- Any changes to the public `/apply` form (it already works)
- Any changes to how `getAllUsers()` reads the Members sheet (Leavers sheet is separate, so no filtering is needed)
- Editing an application's personal details after submission (admin can note discrepancies in Decision Notes)
