# BHBC Membership Portal — Project Overview

> Version 1.11.0 (as of 2026-05-13). Audience: developers new to this codebase.

---

## Table of Contents

1. [What the System Does](#1-what-the-system-does)
2. [Who Uses It — Member Types and Roles](#2-who-uses-it--member-types-and-roles)
3. [Tech Stack](#3-tech-stack)
4. [Architecture Overview](#4-architecture-overview)
5. [Modules — Pages](#5-modules--pages)
6. [Modules — API Routes](#6-modules--api-routes)
7. [Modules — Data Layer (lib/)](#7-modules--data-layer-lib)
8. [Modules — Components](#8-modules--components)
9. [Key External Integrations](#9-key-external-integrations)
10. [Environment Variables](#10-environment-variables)
11. [Known Limitations and Technical Debt](#11-known-limitations-and-technical-debt)
12. [Developer Guide — Conventions, Patterns, and Gotchas](#12-developer-guide--conventions-patterns-and-gotchas)
13. [Owner Notes — To Be Completed](#13-owner-notes--to-be-completed)

---

## 1. What the System Does

The BHBC Membership Portal is an internal web application for **Burgess Hill Bowls Club (BHBC)**, a lawn bowls club in Burgess Hill, West Sussex, UK. It replaces (or supplements) manual spreadsheet management for the club's day-to-day operations.

Core capabilities:

- **Member management** — profiles, renewals, renewals fee calculation, email campaigns
- **Friendly match management** — lifecycle from opening entries to publishing team selections; match cards; player stats; driving coordination
- **Fixtures display** — public read-only listing of all scheduled games by type
- **Internal competitions** — club championship brackets (11 competitions), handicap management, bracket export to Google Sheets
- **Rowland Cup** — inter-club knockout competition across 4 divisions (Edward A/B, Gladys A/B)
- **Club Leagues** — internal team leagues (triples/pairs format)
- **Rota management** — tea duty, cleaning rota, sweeping rota (with pattern-based scheduling)
- **Opponent club directory** — contact details, addresses, petrol costs for away games
- **Member Suggestions** — GMC-facing feature for tracking member improvement suggestions with file attachments
- **Invite Games** — committee-posted invitations for informal games
- **Social Events** — sign-up/attendance tracking for non-competitive events
- **Banking reconciliation** — Treasurer/Admin tool to match bank payments to member renewal records
- **Bulk email campaigns** — Admin can send templated emails (with DOCX-generated PDF attachments) to members
- **Data export / report builder** — Admin can define and run cross-sheet queries, writing results to a sheet tab
- **Kiosk mode** — simplified PIN-based login for a shared clubhouse tablet
- **Print labels** — Admin can generate and print address labels from member data

---

## 2. Who Uses It — Member Types and Roles

### Member Types (stored in `memberType` column)

| Code | Description |
|------|-------------|
| `PL` | Playing Lady |
| `PM` | Playing Man |
| `SL` | Social Lady |
| `SM` | Social Man |

Social members cannot participate in competitive matches but may enter social events. Playing members can enter friendlies and competitions. An `honorary` flag (`Y`/`N`) marks honorary members (zero fees).

### Roles (stored comma-separated in the `role` column)

A user may hold multiple roles simultaneously, e.g. `"Captain,RowlandOrganiser"`. The empty string or `"Member"` means a regular member with no elevated permissions.

| Role | Who / What they can do |
|------|------------------------|
| _(empty / "Member")_ | Regular member — enter friendlies, view fixtures, edit own profile, manage renewals |
| `Captain` | Friendly management (open/close/publish games, select teams); Fixtures management; Competitions admin; Handicaps; League Management |
| `Treasurer` | Banking reconciliation |
| `GMC` | General Management Committee — Member Suggestions, Invite Games, Club admin |
| `Admin` | Full access to everything |
| `RowlandOrganiser` | Manage Rowland Cup draws and results |
| `RowlandPlayer` | BHBC member entered in the Rowland Cup (no extra UI, just eligibility filtering) |
| `LeagueOrganiser` | Manage league squads and fixtures |
| `Kiosk` | Simplified navigation for shared tablet (hardcoded in sheet, no UI to set it) |
| `Club` | External club account — restricted to `/clubs` and `/rowland` |

Role checking uses `src/lib/role-utils.ts`:

- `parseRoles(role)` — splits comma-separated string to array
- `hasRole(role, ...checkRoles)` — returns true if user has any of the named roles
- `isCommitteeMember(role)` — Captain, Treasurer, GMC, or Admin (Rowland roles excluded)

The `buddyUserName` field lets one member manage another member's profile/renewals (e.g., for members who cannot use the system themselves). The buddy relationship is one-directional: if Alice's `buddyUserName` is Bob, then Bob can manage Alice's data.

### Admin Impersonation

Admins (and RowlandOrganisers) can impersonate other users via the Impersonation modal in the navbar. The session token is updated in-place — the admin sees the portal exactly as that user. All impersonation start/stop events are logged to an `ImpersonationLog` sheet. When impersonating, the `isImpersonating` flag is set; `Club` and `mustChangePassword` guards are bypassed for the admin.

---

## 3. Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 14/15 (App Router) | Uses React 19, server and client components |
| Language | TypeScript 5 | Strict mode implied by project conventions |
| Styling | Tailwind CSS v4 | Central theme in `src/config/theme.ts` |
| Auth | NextAuth v4 (Credentials Provider) | JWT sessions; custom `userName` and `role` fields in token |
| Database | Google Sheets (via `googleapis`) | All persistent data lives in Google Sheets spreadsheets |
| File storage | Google Drive | Attachments for Invite Games, Leagues, Rowland, Member Suggestions |
| Legacy file storage | Cloudinary | Earlier attachment system; still used for Member Suggestions if migrated data |
| Email | Nodemailer (SMTP) | Gmail SMTP by default; Handlebars HTML templates |
| PDF generation | Docxtemplater + LibreOffice | DOCX templates rendered and converted to PDF for renewal emails |
| ICS/calendar | Custom `src/lib/ics-utils.ts` | Builds RFC 5545-compliant `.ics` files for friendly game emails |
| PWA | `@ducanh2912/next-pwa` | Service worker, offline caching, installable app |
| Password hashing | bcryptjs (cost 12) | Legacy XOR hash supported during migration |
| Validation | Zod | Used in selected API handlers |

**Why Google Sheets as a database?** The club's non-technical committee were already managing data in Google Sheets. Using Sheets as the backend means the committee can make bulk edits, run formulas, and view data without needing a separate admin UI. The portal reads from and writes to those same sheets, keeping the two views in sync.

**Why no traditional database?** The data volumes are small (hundreds of members, thousands of game records), and read/write latency from the Google Sheets API is acceptable for this use case. The trade-off is that complex queries require fetching full sheets into memory, and all relationships (e.g. member lookups) are resolved in application code.

---

## 4. Architecture Overview

```
Browser (React / Next.js App Router)
    ↕ HTTPS
Next.js Server (API Routes + Server/Client Components)
    ↕ googleapis (service account JWT)
Google Sheets (multiple spreadsheets — see §7)
    
    Also:
    ↕ Google Drive API (file attachments)
    ↕ SMTP (Nodemailer → Gmail)
    ↕ Cloudinary (legacy attachment retrieval)
```

All data access is server-side (API routes or Server Components). Client components call `/api/...` routes via `fetch`. There is no direct client-side Google API access.

**Authentication flow:**

1. User submits username + password to `/api/auth/signin` (NextAuth handler)
2. NextAuth calls `authorize()` in `src/lib/auth.ts`, which calls `authenticateUser()` in `src/lib/auth-sheets.ts`
3. `authenticateUser` fetches from the Members sheet, verifies bcrypt hash (or legacy XOR with auto-upgrade), checks rate limits
4. On success, a JWT token is issued containing `userName`, `role`, `roles[]`, `name`, `email`, `mustChangePassword`
5. Club logins fall through to `authenticateClub()` in `src/lib/clubs-sheets.ts` and receive role `"Club"`
6. Middleware at `middleware.ts` validates the token on every request, enforces role restrictions, redirects on `mustChangePassword`

**Session lifetime:** 30-day inactivity timeout, 90-day absolute maximum.

---

## 5. Modules — Pages

All pages live under `app/` following Next.js App Router conventions.

### Public pages (no login required)

| Path | Description |
|------|-------------|
| `/fixtures` | All scheduled games — Friendly, league types (N/S A, N/S B, MSL, JSL, BL), Events |
| `/friendlies` | Current friendly schedule with enter/withdraw for logged-in users |
| `/friendlies/game/[tabDate]` | Read-only game card (public) |
| `/competitions` | All club competitions list |
| `/competitions/[compId]` | Bracket view for a specific competition |
| `/rowland` | Rowland Cup overview |
| `/rowland/[compId]` | Rowland Cup bracket for one division |
| `/leagues` | Club leagues list |
| `/leagues/[leagueId]` | League table and fixtures |
| `/clubs` | Opponent club directory |
| `/clubs/[clubName]` | Single club details page |
| `/members` | Public member name lookup (no contact details) |
| `/tea-rota`, `/cleaning-rota`, `/sweeping-rota` | Rota views |
| `/apply` | Public membership application form |
| `/login`, `/clublogin`, `/forgot-password`, `/reset-password` | Auth pages |
| `/help/*` | In-app help documentation pages |

### Authenticated member pages

| Path | Description |
|------|-------------|
| `/` (home) | Welcome page with session summary |
| `/profile` | Edit own profile (name, contact, preferences, skills) |
| `/renewals` | View and submit annual renewal (fees, competition entries, 200 Club) |
| `/change-password` | Forced on first login if `mustChangePassword` is set |
| `/competitions/my` | Member's own competition matches |
| `/competitions/handicaps` | Handicap view (Captain/Admin — set handicaps for all players) |

### Captain / Admin pages

| Path | Description |
|------|-------------|
| `/friendlies/manage` | Game lifecycle management — open, close, publish, played, cancel |
| `/friendlies/manage/game/[tabDate]` | Team selection for a specific game |
| `/friendlies/manage/picker/[tabDate]` | Player picker / availability view |
| `/friendlies/manage/allocate/[date]` | Allocate players between paired games |
| `/friendlies/match-card/[tabDate]` | Printable match card |
| `/fixtures/manage` | Add/edit/delete fixtures |
| `/competitions/admin` | Overview of all competitions, link to bracket management |
| `/competitions/[compId]/setup` | Set up draw, configure competition |
| `/rowland/admin` | Rowland Cup admin overview |
| `/rowland/[compId]/setup` | Set up Rowland draw |
| `/leagues/manage` | League admin hub |
| `/leagues/manage/[leagueId]` | Manage a specific league (teams, squads, results) |

### Admin-only pages

| Path | Description |
|------|-------------|
| `/admin/emails` | Bulk email campaigns to members |
| `/banking` | Payment import and renewal reconciliation |
| `/banking/add-payments` | Manually add bank transactions |
| `/banking/report` | Reconciliation summary report |
| `/data-export` | Report builder — define and run cross-sheet queries |
| `/labels` | Generate address labels |

### GMC / Admin pages

| Path | Description |
|------|-------------|
| `/member-suggestions` | List of all member suggestions |
| `/member-suggestions/[id]` | View/edit a suggestion (file attachments supported) |
| `/member-suggestions/new` | Submit a new suggestion |
| `/invite-games` | Invite game listings |
| `/invite-games/[id]` | View an invite game |
| `/invite-games/new` | Create an invite game |

### Special pages

| Path | Description |
|------|-------------|
| `/kiosk` | PIN-based login for shared tablet |
| `/social-events` | Social event listings |
| `/social-events/event/[tabDate]` | Sign up for a social event |
| `/internal-games` | Internal game listings |
| `/internal-games/manage/game/[tabName]` | Manage internal game selection |
| `/clubs/new` | Create a new opponent club (admin) |
| `/help/*` | Context-specific help pages for every major feature |

---

## 6. Modules — API Routes

All routes follow the pattern: **check session → role guard → call data layer → return JSON**.

### Auth

| Route | Method | Notes |
|-------|--------|-------|
| `/api/auth/[...nextauth]` | GET/POST | NextAuth handler |
| `/api/auth/refresh-session` | POST | Refreshes JWT from current DB state |
| `/api/auth/reset-password` | GET/POST | Token-based password reset |
| `/api/change-password` | POST | Authenticated password change |

### Members & Profile

| Route | Method | Notes |
|-------|--------|-------|
| `/api/profile` | GET/PUT | Read/write own profile |
| `/api/members/lookup` | GET | Public name lookup by username |
| `/api/users/list` | GET | Admin-only — full member list |
| `/api/buddies` | GET | List users the current user can act as buddy for |
| `/api/apply` | POST | Public — submit membership application |

### Friendlies

| Route | Notes |
|-------|-------|
| `/api/friendlies/games` | List all games with user entry status |
| `/api/friendlies/game/[tabDate]` | Public game details |
| `/api/friendlies/enter` | Enter a game |
| `/api/friendlies/withdraw` | Withdraw from a game |
| `/api/friendlies/confirm` | Confirm attendance |
| `/api/friendlies/add-players` | Captain adds players manually |
| `/api/friendlies/remove-player` | Captain removes player |
| `/api/friendlies/entered-players` | List all entered players for a game |
| `/api/friendlies/stats` | Player stats summary |
| `/api/friendlies/match-card/[tabDate]` | Full match card data |
| `/api/friendlies/manage/*` | Captain-only management routes (status, selection, allocation, lock, messaging, test email, player stats, pickup info) |

### Fixtures

| Route | Notes |
|-------|-------|
| `/api/fixtures/games` | Public list of all fixtures |
| `/api/fixtures/manage/games` | Captain — manage fixture list |
| `/api/fixtures/manage/game/[rowNumber]` | Update/delete a fixture |

### Competitions

| Route | Notes |
|-------|-------|
| `/api/competitions` | List all competitions |
| `/api/competitions/[compId]` | Bracket data for one competition |
| `/api/competitions/[compId]/matches` | Match list |
| `/api/competitions/[compId]/matches/[matchId]` | Update match result |
| `/api/competitions/[compId]/entrants` | List eligible entrants |
| `/api/competitions/[compId]/setup` | Create/rebuild draw |
| `/api/competitions/[compId]/export-sheet` | Export bracket to Google Sheet |
| `/api/competitions/my` | Current user's competition matches |
| `/api/competitions/members` | Member list with handicaps for selection |
| `/api/competitions/handicaps` | Read/write handicaps (Captain/Admin) |
| `/api/competitions/message` | Competitions message/announcement |

### Rowland Cup

| Route | Notes |
|-------|-------|
| `/api/rowland` | List all Rowland divisions |
| `/api/rowland/[compId]` | Division data and bracket |
| `/api/rowland/[compId]/matches` | Match list |
| `/api/rowland/[compId]/matches/[matchId]` | Update match result |
| `/api/rowland/[compId]/setup` | Create/rebuild draw |
| `/api/rowland/clubs` | List registered clubs |
| `/api/rowland/participants` | All participants across divisions |
| `/api/rowland/message` | Rowland announcement message |

### Leagues

| Route | Notes |
|-------|-------|
| `/api/leagues` | List all leagues |
| `/api/leagues/[leagueId]` | League details |
| `/api/leagues/[leagueId]/teams` | Team list |
| `/api/leagues/[leagueId]/teams/[teamId]` | Team details |
| `/api/leagues/[leagueId]/teams/[teamId]/players` | Team players |
| `/api/leagues/[leagueId]/squad/[rowNumber]` | Squad member detail |
| `/api/leagues/[leagueId]/matches` | Fixtures |
| `/api/leagues/[leagueId]/matches/[matchId]` | Match result |
| `/api/leagues/[leagueId]/enter` | Enter / join a league |
| `/api/leagues/my-entries` | Current user's league registrations |
| `/api/leagues/message` | League announcement message |

### Clubs (Opponent Club Directory)

| Route | Notes |
|-------|-------|
| `/api/clubs` | List all opponent clubs |
| `/api/clubs/[clubName]` | Club details |
| `/api/clubs/[clubName]/contacts` | Club contacts |
| `/api/clubs/[clubName]/contacts/[rowNumber]` | Single contact |
| `/api/clubs/[clubName]/fixtures` | Fixtures against this club |
| `/api/clubs/create` | Create new club |
| `/api/clubs/contact-roles` | List available contact role values |

### Rotas

| Route | Notes |
|-------|-------|
| `/api/tea-rota` | Read rota; `batch`, `swap`, `assignments/[userName]`, `[rowNumber]` sub-routes for management |
| `/api/cleaning-rota` | Same structure as tea-rota |
| `/api/sweeping-rota` | Read rota; `blocked`, `blocked/[date]`, `clear` sub-routes |

### Internal Games, Social Events

| Route | Notes |
|-------|-------|
| `/api/internal-games/*` | Mirror of friendlies API structure for internal games |
| `/api/social-events/*` | Events list, sign-up, remove, entered-players |

### Member Suggestions, Invite Games

| Route | Notes |
|-------|-------|
| `/api/suggestions` | CRUD for suggestions |
| `/api/suggestions/[id]` | Single suggestion |
| `/api/invite-games` | CRUD for invite games |
| `/api/invite-games/[id]` | Single invite game |

### Admin

| Route | Notes |
|-------|-------|
| `/api/admin/emails/recipients` | List members eligible to receive bulk email |
| `/api/admin/emails/templates` | List / preview email templates |
| `/api/admin/emails/templates/preview` | Render template preview |
| `/api/admin/emails/club-contacts` | Send email to club contacts |
| `/api/admin/impersonate/start` | Begin impersonation of another user |
| `/api/admin/impersonate/stop` | End impersonation |
| `/api/admin/impersonate/users` | List users the current user can impersonate (buddies for members, all for admin) |
| `/api/admin/impersonate/clubs` | List club accounts for impersonation |
| `/api/admin/labels/config` | Read/write label layout config |
| `/api/admin/labels/members` | Member data for label printing |

### Banking

| Route | Notes |
|-------|-------|
| `/api/banking/payments` | List/add/update/delete payments |
| `/api/banking/payment` | Single payment CRUD |
| `/api/banking/renewals` | Renewal records for reconciliation |
| `/api/banking/import` | Import bank statement CSV |
| `/api/banking/submit` | Submit matched payments |
| `/api/banking/report` | Reconciliation report |

### Renewals

| Route | Notes |
|-------|-------|
| `/api/renewals` | Read/write renewal record for current (or buddy) user |

### Data Export

| Route | Notes |
|-------|-------|
| `/api/data-export/schemas` | Discover column headers from all registered sheets |
| `/api/data-export/definitions` | CRUD for saved report definitions |
| `/api/data-export/definitions/[id]` | Single definition |
| `/api/data-export/run` | Execute a report and write to ReportOutput sheet |

---

## 7. Modules — Data Layer (lib/)

### Spreadsheets in use

The application reads from and writes to multiple Google Sheets spreadsheets. Each is accessed via a dedicated environment variable:

| Env var | Contents |
|---------|----------|
| `MEMBERS_SPREADSHEET_ID` | Members, LoginAttempts, ImpersonationLog, PasswordResetRequests, MemberEmails, Renewals, RenewalPayments, CleaningRota, SweepingRota, MemberSuggestions, MemberSuggestionsAttachments, InviteGames, InternalGames, SocialEvents, BankPayments |
| `FRIENDLIES_SPREADSHEET_ID` | Games, Players, and individual game tab sheets (e.g. "West Hoathly 25-Sep") |
| `MATCH_DAY_CONTACTS_SPREADSHEET_ID` | Clubs (opponent club directory), Contacts, PetrolBands |
| `COMPETITIONS_SPREADSHEET_ID` | CompetitionsControl, CompMensChampionship, CompLadiesMaynard, and 9 other per-competition sheets |
| `ROWLAND_SPREADSHEET_ID` | RowlandControl, Rowland_edward-a/b, Rowland_gladys-a/b |
| `LEAGUES_SPREADSHEET_ID` | LeagueControl, LeagueTeams, LeagueSquad, LeagueMatches, LeagueSettings |
| `PORTAL_CONFIG_SPREADSHEET_ID` | Labels (key-value config for label printing) |

### Core data layer files

**`src/lib/sheets.ts`** — The foundation. Provides:
- `getGoogleSheetsClient()` — singleton authenticated Sheets client with auto-retry on quota errors
- `getColumnMap(sheetName, spreadsheetId?)` — reads header row and returns `{ normalized_column_name: index }` mapping (cached per sheet+spreadsheet)
- `getColumnLetter(index)` — converts 0-based index to A1 notation column letter (handles AA, AB, etc.)
- `getAllUsers()` / `getUserByUsername()` / `getUsersByEmail()` — Member sheet reads
- All auth-related writes: `updatePasswordHash`, `updateLastLogin`, `generatePasswordResetToken`, `validateResetToken`, `clearResetToken`
- Logging helpers: `logLoginAttempt`, `logMemberEmail`, `logImpersonationEvent`, `logPasswordResetRequest`
- `withRetry()` — exponential backoff for Sheets API quota errors (applied automatically to all client methods)

**`src/lib/friendlies-sheets.ts`** — All Friendlies data operations: game CRUD, player entry/withdrawal, team selection, match card data, player statistics.

**`src/lib/clubs-sheets.ts`** — Club and contact CRUD in the Match Day Contacts spreadsheet. Also handles club account authentication (`authenticateClub`).

**`src/lib/competitions-sheets.ts`** — Competition bracket management: `COMP_SHEET_CONFIG` maps `compId` to sheet name and renewal column; read/write for CompetitionsControl and per-comp match sheets.

**`src/lib/rowland-sheets.ts`** — Rowland Cup data layer. Handles serialised date normalisation (Google Sheets serial numbers, DD/MM/YYYY, and ISO formats). Players stored pipe-separated in cells.

**`src/lib/leagues-sheets.ts`** — Leagues data layer: control, teams, squad, matches, settings.

**`src/lib/banking-sheets.ts`** — Payment and renewal reconciliation records.

**`src/lib/renewals-sheets.ts`** — Annual renewal record: fee calculation (age-based tiers), competition entries, 200 Club.

**`src/lib/profile-sheets.ts`** — Field-level validated profile updates with batch Sheets API writes.

**`src/lib/auth-sheets.ts`** — `authenticateUser()`: bcrypt verification with legacy XOR fallback and auto-upgrade on login; rate limiting via `LoginAttempts` sheet.

**`src/lib/buddies-sheets.ts`** — `canManageUser()`: authorisation check (self, admin, or buddy relationship).

**`src/lib/data-export.ts`** — Report engine: `SHEET_REGISTRY` lists all queryable sheets; supports column selection, filter expressions, optional JOIN on username key; writes to `ReportOutput` sheet tab.

**`src/lib/cleaning-sheets.ts` / `src/lib/sweeping-sheets.ts`** — Simple rota CRUD. Cleaning rota has 4 positions (Lead, Second, Third, Fourth). Sweeping rota supports blocked dates.

**`src/lib/suggestions-sheets.ts`** / **`src/lib/attachments-sheets.ts`** — Member Suggestions and their file attachments (Drive file IDs or Cloudinary public IDs).

**`src/lib/invite-games-sheets.ts`** — Invite Games CRUD.

**`src/lib/social-events-sheets.ts`** / **`src/lib/internal-games-sheets.ts`** — Use a shared `game-management/` library (see below).

**`src/lib/game-management/`** — Shared library for systems with similar "game + player list" structure:
- `config.ts` — `GameSystemConfig` with feature flags (`hasStats`, `hasTeams`, `hasDriving`, etc.) for Friendlies, Internal Games, and Social Events
- `sheet-operations.ts` — Generic `getAllGames`, `getGameByTabDate`, `getPlayersForGame`, `addPlayerToGame`, `updatePlayer`
- `types.ts` — Shared TypeScript interfaces for generic game/player management
- `capacity.ts` — Game capacity/max-players logic

**`src/lib/sheet-export.ts`** — Exports competition brackets as formatted Google Sheets tabs (complex column/row layout with borders and connector lines for the bracket diagram).

**`src/lib/config-sheets.ts`** — Reads/writes from the Portal Config spreadsheet (currently: Labels key-value config).

### Utility files

- **`src/lib/role-utils.ts`** — `parseRoles`, `hasRole`, `isCommitteeMember`, `isMember`
- **`src/lib/date-utils.ts`** — Date parsing and normalisation between UK (DD/MM/YYYY) and ISO formats
- **`src/lib/friendlies-utils.ts`** — `groupPairedGames` — groups games that share a date and are marked `paired='Y'` into `[Game, Game]` tuples for the allocate UI
- **`src/lib/form-draft-utils.ts`** — `saveDraft` / `restoreDraft` / `clearDraft` — sessionStorage-based form draft persistence to prevent data loss on navigation
- **`src/lib/member-type-utils.ts`** — Helpers for interpreting the `memberType` field
- **`src/lib/banking-match.ts`** — Client-side banking reconciliation state logic (auto-matching, totals)
- **`src/lib/sweeping-patterns.ts`** — Date generation for sweeping rota patterns

---

## 8. Modules — Components

All shared components live under `src/components/`.

| Component | Purpose |
|-----------|---------|
| `Navbar.tsx` | Full responsive navigation bar. Role-aware menu items. Impersonation modal trigger. Unsaved-changes amber dot indicator. Kiosk mode simplified nav. Club mode restricted nav. |
| `ConfirmDialog.tsx` | Reusable modal for destructive action confirmation |
| `ImpersonationModal.tsx` | UI for admin/buddy to switch user context |
| `AttachmentUpload.tsx` | Generalised file attachment upload component (uses Google Drive resumable upload sessions); accepts `apiBasePath` prop |
| `AttachmentsList.tsx` | Display and manage uploaded attachments; accepts `apiBasePath` prop |
| `SearchableSelect.tsx` | Dropdown with search/filter for long lists |
| `UserSelector.tsx` | Member picker (used in captain management pages) |
| `VersionDisplay.tsx` | Shows version number from `src/config/version.ts` |
| `RouterBackLink.tsx` | Breadcrumb-style back link |
| `game-management/EnteredPlayersModal.tsx` | Modal showing all entered players for a game (shared between friendly and internal games management) |
| `game-management/SelectionHelperDialog.tsx` | Dialog with selection stats and history to assist captains |
| `game-management/SelectionHelperPanel.tsx` | Inline panel version of the selection helper |
| `game-management/GameInstructionsDialog.tsx` | Instructions dialog for game management pages |
| `competitions/BracketView.tsx` | Knockout bracket rendering for competition pages |
| `competitions/MatchCard.tsx` | Match result display/edit card |
| `competitions/ScoreDialog.tsx` | Modal for entering/editing competition scores |
| `competitions/ExportSheetDialog.tsx` | Dialog to configure and trigger bracket sheet export |
| `rowland/RowlandMatchDialog.tsx` | Match result entry for Rowland Cup |
| `sweeping-rota/MonthCalendar.tsx` | Monthly calendar view for sweeping rota |
| `sweeping-rota/PrintableCalendar.tsx` | Print-optimised calendar layout |
| `sweeping-rota/PatternEntryModal.tsx` | Modal to enter sweeping rota patterns |
| `sweeping-rota/ConfirmAddModal.tsx` | Confirmation for adding sweeping entries |
| `sweeping-rota/PrintRangeModal.tsx` | Date range picker for printing rota |

---

## 9. Key External Integrations

### Google Sheets (Database)

All persistent data is stored in Google Sheets. The service account credentials (`GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`) authenticate the server-side client.

**Column mapping pattern:** Rather than hardcoding column indices, every sheet read begins with `getColumnMap(sheetName)` which fetches row 1, normalises header names (lowercase, spaces to underscores), and caches the result in memory. This means adding a column to a sheet does not break existing code as long as the column header is unique and normalised correctly. Cache is cleared on login (`clearColumnMapCache()`) and can be cleared manually.

**Retry logic:** `withRetry()` wraps all Sheets API calls with exponential backoff on HTTP 429 / quota errors (up to 4 attempts, base 1s delay doubling each time).

**Multiple spreadsheets:** The application uses 7+ spreadsheet IDs, each injected via environment variable. Data across spreadsheets is joined in application code (e.g. looking up member names when displaying game players).

### Google Drive (File Attachments)

`src/lib/drive.ts` manages file storage under a shared root folder (`GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID`). Folder structure is `<root>/<category>/<entityId>/`.

The upload flow uses **resumable upload sessions**: the server creates a pre-authenticated session URI and returns it to the browser; the browser PUTs bytes directly to Google's servers (avoiding server memory usage for large files). After upload, the server sets public-read permissions on the file.

Authentication supports both service account (default) and OAuth2 refresh token (if `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` are set). `isDriveFileId(id)` distinguishes Drive IDs (no slashes) from legacy Cloudinary public IDs (contain slashes).

### Google OAuth / NextAuth

NextAuth is configured with a single **Credentials Provider** — there is no Google OAuth sign-in for members. Members log in with username/password verified against the Members sheet. The Google APIs (Sheets, Drive) are accessed server-side using a service account, not per-user OAuth.

### Cloudinary (Legacy File Storage)

`src/lib/cloudinary.ts` handles upload, delete, and download for files previously stored in Cloudinary. The system is being migrated to Google Drive. New uploads go to Drive; Cloudinary is retained for reading existing attachments. `isDriveFileId()` in `drive.ts` is used to route reads to the correct storage backend.

### NextAuth (Authentication)

- Provider: Credentials only
- Strategy: JWT (client-side storage, no database sessions)
- Token contents: `userName`, `role`, `roles[]`, `name`, `email`, `loginTime`, `mustChangePassword`, `isImpersonating`, impersonation fields
- 30-day inactivity expiry + 90-day absolute expiry enforced in the session callback
- `mustChangePassword` forces redirect to `/change-password` via middleware
- `Club` role is restricted to `/clubs` and `/rowland` paths only

### Nodemailer / Email

`src/lib/email/mailer.ts` provides three send functions:
- `sendTemplateEmail` — loads an HTML template from `src/lib/email/templates/`, compiles with Handlebars, sends via SMTP
- `sendEmail` — sends raw text/HTML content
- `sendEmailWithAttachments` — sends with Buffer attachments (e.g., generated PDFs)

Templates use `{{variable}}` Handlebars syntax. Theme variables (`BRAND_NAME`, `HEADER_COLOR`, etc.) are injected automatically from `src/config/theme.ts`.

Connection pooling is available (single SMTP connection reused for bulk sends).

Email types sent:
- Password reset, password changed
- Renewal confirmation/cancellation
- Tea duty and cleaning duty swap notifications
- Application confirmation
- Friendly withdrawal notifications to captains
- ICS calendar invites for friendly games
- Renewal emails with PDF attachments (DOCX template → LibreOffice → PDF)
- Bulk member emails (admin-triggered, logged to `MemberEmails` sheet)
- Club contact emails (for sending login credentials to opponent club contacts)
- Club change notifications (to a hardcoded club liaison address)

### ICS Calendar Utilities

`src/lib/ics-utils.ts` builds RFC 5545 `.ics` files for friendly game email notifications. Key behaviours:

- UIDs are stable per player+game (`BHBC-FRIENDLY-{tabName}-{userName}@bhbc.org.uk`), so calendar clients update rather than create duplicate events
- `SEQUENCE` increments with game status changes (0=entered, 1=published, 2=republished, 99=confirmed/withdrawn)
- `METHOD:CANCEL` used for withdrawals/cancellations
- Europe/London timezone handling with BST/GMT detection via `Intl.DateTimeFormat`
- Gmail special case: `isGmailAddress()` identifies Gmail users; Google Calendar handles `.ics` differently so update emails skip the attachment for Gmail unless `ICS_UPDATE_EMAILS=true` in environment

### LibreOffice (PDF Generation)

`src/lib/email/pdf-generator.ts` converts DOCX templates to PDF using LibreOffice's headless mode (`soffice.exe`). The LibreOffice path is currently hardcoded to `C:\Program Files\LibreOffice\program\soffice.exe` — this only works on Windows. Template variables use Docxtemplater `{placeholder}` syntax.

---

## 10. Environment Variables

The following environment variables must be set in `.env.local` (never committed):

### Required for all features

| Variable | Purpose |
|----------|---------|
| `MEMBERS_SPREADSHEET_ID` | Main members spreadsheet |
| `FRIENDLIES_SPREADSHEET_ID` | Friendlies and games spreadsheet |
| `MATCH_DAY_CONTACTS_SPREADSHEET_ID` | Opponent clubs directory |
| `COMPETITIONS_SPREADSHEET_ID` | Internal competitions |
| `ROWLAND_SPREADSHEET_ID` | Rowland Cup |
| `LEAGUES_SPREADSHEET_ID` | Club leagues |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email |
| `GOOGLE_PRIVATE_KEY` | Service account private key (with literal `\n` → replaced to actual newlines) |
| `NEXTAUTH_SECRET` | JWT signing secret |
| `NEXTAUTH_URL` | Full URL of the deployment (e.g. `https://portal.bhbc.org.uk`) |

### Email

| Variable | Purpose |
|----------|---------|
| `SMTP_HOST` | SMTP server (default: `smtp.gmail.com`) |
| `SMTP_PORT` | SMTP port (default: `587`) |
| `SMTP_USER` | SMTP username / From address |
| `SMTP_PASSWORD` | SMTP password (Gmail App Password) |

### File storage

| Variable | Purpose |
|----------|---------|
| `GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID` | Root Google Drive folder for all attachments |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name (legacy) |
| `CLOUDINARY_API_KEY` | Cloudinary API key (legacy) |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret (legacy) |

### Optional

| Variable | Purpose |
|----------|---------|
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth2 for Drive uploads (alternative to service account) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth2 for Drive |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | OAuth2 for Drive |
| `PORTAL_CONFIG_SPREADSHEET_ID` | Config spreadsheet (label printing) |
| `INTERNAL_GAMES_SPREADSHEET_ID` | Internal games spreadsheet |
| `SOCIAL_EVENTS_SPREADSHEET_ID` | Social events spreadsheet |
| `ICS_UPDATE_EMAILS` | Set to `"true"` to enable ICS attachments on publish/confirm/withdraw emails |

---

## 11. Known Limitations and Technical Debt

### Google Sheets as a database

- **No transactions.** Concurrent writes from multiple admin sessions can produce inconsistent state. There is a lock mechanism on game selection (`lockedBy` / `lockedAt` fields on the Games sheet), but no general concurrency protection.
- **Reads fetch full sheets.** `getAllUsers()` fetches the entire Members sheet on every call. There is in-process column map caching, but no row-level caching. High read traffic will hit Sheets API quota. The `withRetry()` wrapper mitigates transient 429 errors, but sustained high traffic is not supported.
- **Column map cache is in-process and per-instance.** In a serverless / multi-process deployment (Vercel Edge or multiple Node processes), each instance has its own cache and the cache is never shared. Column maps are cheap to re-fetch (one API call), but this means cache invalidation via `clearColumnMapCache()` only affects the current process.
- **Schema is implicit.** Column names in headers are the schema contract. Renaming a column header in the sheet without updating code (and clearing the cache) will silently break reads/writes for that field.
- **Data volume.** The system works well for hundreds of members and thousands of game records. It is not designed for thousands of concurrent users or millions of records.

### Authentication

- **Legacy XOR password hashes.** Some members may still have the original XOR-hashed password in the sheet (from a Google Apps Script predecessor). The login flow auto-upgrades to bcrypt on successful login, but until a member logs in, their password remains in the insecure format.
- **No MFA.** Authentication is single-factor (password only).

### Email and PDF

- **LibreOffice path hardcoded to Windows.** `src/lib/email/pdf-generator.ts` has `C:\Program Files\LibreOffice\program\soffice.exe`. This will fail on Linux/macOS deployments unless the path is changed or the code is refactored to read from an environment variable.
- **Gmail custom headers removed.** Comments in `mailer.ts` note that custom email headers were removed as a workaround because they appeared to cause Gmail to drop emails. This is unresolved.
- **Gmail addresses and ICS.** The `ICS_UPDATE_EMAILS` flag defaults to `false`, meaning update/cancel ICS attachments are suppressed. The initial entry email always sends ICS. This is a known partial implementation.

### Cloudinary migration

- The system is mid-migration from Cloudinary to Google Drive for file attachments. New uploads go to Drive; existing files in Cloudinary are still served. The `isDriveFileId()` utility in `drive.ts` is the discriminator. This dual-backend state is a known debt item until all legacy files are migrated.

### Code duplication in column mapping

- `getColumnMap` is re-implemented in multiple files: `src/lib/sheets.ts` (canonical), `src/lib/clubs-sheets.ts`, `src/lib/internal-games-sheets.ts`, `src/lib/social-events-sheets.ts`. The canonical version should be used everywhere but some files pre-date its extraction.

### Mock data

- `src/lib/mock-competitions-data.ts` contains hardcoded test data. This file is only used for UI development and should not be referenced in production code paths.

### Session refresh on all pages

- Pages call `useSessionRefresh()` hook to pick up role changes. This triggers a background refresh call but may mean a brief window after an admin role change where the UI shows stale permissions.

### Version management scripts

- `npm run release:patch/minor/major` amends the last commit with a version bump. This workflow modifies published git history (`--amend`) and requires force-push if the branch is already on remote.

---

## 12. Developer Guide — Conventions, Patterns, and Gotchas

### API route pattern

Every API route follows this structure:

```typescript
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user.role, 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // ... call data layer
  return NextResponse.json(data);
}
```

### Column name normalisation

All sheet column names are normalised: **lowercase, trim, spaces to underscores**. `"Email Address"` becomes `"email_address"`. Use `getColumnMap()` — never hardcode column indices. After a schema change (renaming a column header), call `clearColumnMapCache()` or restart the server.

### Usernames vs full names

Usernames are the persistent identifiers stored in sheets. Full names are always looked up at read/display time from the Members sheet. Never store full names as the primary key. In Friendlies, player entries store the username; names are resolved when building the API response.

### Dates

Dates appear in multiple formats across sheets: `DD/MM/YYYY` (UK format, common), `YYYY-MM-DD` (ISO), and Google Sheets serial numbers (integer days since 30 Dec 1899). `src/lib/date-utils.ts` provides `parseNormalizedDate` and `normalizeToUKDate`. The Rowland and Leagues data layers include local `normalizeDate` functions that handle all three formats.

The `tabDate` field in friendly games (e.g. `"25-Sep"`) is a short display string used as part of tab names in the Friendlies spreadsheet. `tabName` (e.g. `"West Hoathly 25-Sep"`) is the full unique identifier for a game tab sheet.

### Paired games

Some friendly games are "paired" — two games on the same date where the captain needs to allocate available players across both. When `game.paired === 'Y'`, both games should be shown together. `groupPairedGames()` from `src/lib/friendlies-utils.ts` handles this grouping on the manage page. The `'L'` (Allocating) game status represents the paired-game allocation phase.

### Role string format

Roles are stored as a comma-separated string in the `role` column: `"Captain,RowlandOrganiser"`. Use `hasRole()` and `parseRoles()` from `src/lib/role-utils.ts` — never do raw string comparisons. The empty string and `"Member"` are both treated as "no roles" by `parseRoles()`.

### Game status codes

Game lifecycle for friendlies (see `src/lib/types/friendlies.ts` for full docs):

```
'' (not opened) → 'O' (open for entries) → 'X' (selecting/closed) → 'S' (selected/published) → 'P' (played)
                                          ↘ 'L' (allocating, paired games only) ↗
                                          → 'C' (cancelled) / 'A' (abandoned) at any point
```

### Form drafts

Pages with data entry forms should use `saveDraft` / `restoreDraft` / `clearDraft` from `src/lib/form-draft-utils.ts`. Drafts are stored in `sessionStorage` with key `FormDraft-{formName}-{userName}`. The Navbar reads `checkForUnsavedChanges()` to show an amber indicator and prompt on navigation.

### Theme

All visual styling is centralised in `src/config/theme.ts`. Use `src/config/theme-helpers.ts` functions (`getButtonClasses`, `getBadgeClasses`, etc.) rather than writing Tailwind class strings inline — this makes global UI changes a single-file edit.

### PWA

The app is a Progressive Web App (installable). The service worker is generated by `@ducanh2912/next-pwa` and disabled in development. The manifest is at `public/manifest.json`.

### Help system

Every major feature has a corresponding help page under `app/help/`. These are standard Next.js pages rendered as markdown-like HTML. When adding a new feature, add a corresponding help page.

### TypeScript path aliases

`@/` is aliased to `src/`. Use `@/lib/...`, `@/components/...`, `@/types/...`, `@/config/...`, `@/hooks/...` throughout.

### Versioning

The version number is in `src/config/version.ts` and is displayed in the Navbar. Update via `npm run release:patch|minor|major` which bumps `package.json`, runs `update-version.js` to sync `version.ts`, amends the commit, and pushes with a version tag.

---

## 13. Owner Notes — To Be Completed

> This section is intentionally left blank for the club owner / administrator to complete. It should capture institutional knowledge that cannot be inferred from the code alone.

### Background

_[Describe the history of the portal: when it was built, what it replaced (e.g., a Google Apps Script or manual spreadsheet process), and who commissioned it.]_

### Business Decisions

_[Document any deliberate decisions about how the club operates that are encoded in the system — for example: fee structures, competition eligibility rules, which member types can enter which games, the driving-band/petrol-cost approach, renewal processes, etc.]_

_[Note any decisions that were made for practical reasons at the time but may need revisiting — for example: the choice to keep some data in Google Sheets rather than migrating to a proper database.]_

### Future Direction

_[Describe planned features, pending work, or aspirations for the portal. Examples might include: the calendar email / ICS implementation currently on the `feature/calendar-emails` branch; migration of all Cloudinary attachments to Google Drive; any planned changes to the competitions or leagues systems; mobile app plans; etc.]_

_[Note any known issues that have been deprioritised rather than fixed.]_
