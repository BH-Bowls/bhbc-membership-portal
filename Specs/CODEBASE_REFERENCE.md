# BHBC Membership Portal — Codebase Reference
Generated: 2026-05-14. For use when uploading context to Claude AI.

---

## TABLE OF CONTENTS

1. [Stack & Architecture Overview](#1-stack--architecture-overview)
2. [Directory Tree](#2-directory-tree)
3. [Key File Contents](#3-key-file-contents)
4. [Types Inventory](#4-types-inventory)
5. [API Routes Inventory](#5-api-routes-inventory)
6. [Pages Inventory](#6-pages-inventory)

---

## 1. STACK & ARCHITECTURE OVERVIEW

- **Framework**: Next.js 14/15 App Router, TypeScript, Tailwind CSS
- **Auth**: NextAuth (session-based JWT). Roles stored as comma-separated string in Members sheet.
  - Roles: `Member` (empty/default), `Captain`, `Admin`, `Treasurer`, `GMC`, `RowlandOrganiser`, `RowlandPlayer`, `LeagueOrganiser`, `Club` (external club login), `Kiosk`
  - `isCommitteeMember()` = Captain | Treasurer | GMC | Admin
- **Database**: Google Sheets (no SQL). All data access via `src/lib/sheets.ts` and per-feature `*-sheets.ts` files.
  - Column mapping: headers normalised to `snake_case` via `getColumnMap()` — positions are NOT hardcoded.
  - Retry: `withRetry()` is patched onto all `spreadsheets.values.*` calls automatically.
- **File storage**: Google Drive (primary). Legacy Cloudinary for old attachments.
  - Column still named `drive_file_id` even though it originally stored Cloudinary publicIds.
- **Email**: Nodemailer + Gmail SMTP. Bulk sends use pooled transporter with `maxConnections: 1`.
- **Dates**: Sheets store DD/MM/YYYY. Never use `new Date("DD/MM/YYYY")` — always use `src/lib/date-utils.ts` helpers.
- **PWA**: `@ducanh2912/next-pwa`. Back-button cache uses `sessionStorage` pattern.
- **Middleware**: `middleware.ts` — protects all routes, guards by role, handles impersonation/Club restrictions.
- **Dark mode**: NOT implemented. `color-scheme: light` is forced in `globals.css`.

### Spreadsheets

| Key | Env Var | Contents |
|-----|---------|----------|
| MEMBERS | `MEMBERS_SPREADSHEET_ID` | Members, LoginAttempts, ImpersonationLog, MemberEmails, PasswordResetRequests, Renewals, RenewalPayments, CleaningRota, SweepingRota, MemberSuggestions, MemberSuggestionsAttachments, InviteGames, InviteGamesAttachments, ReportDefinitions |
| FRIENDLIES | `FRIENDLIES_SPREADSHEET_ID` | Games, Players, per-game tabs (e.g. "Newick 12 May 26") |
| CONTACTS | `MATCH_DAY_CONTACTS_SPREADSHEET_ID` | clubs, Contacts, PetrolBands |
| COMPS | `COMPETITIONS_SPREADSHEET_ID` | Per-competition match sheets (CompMensChampionship etc.) |
| ROWLAND | `ROWLAND_SPREADSHEET_ID` | RowlandControl, Rowland_edward-a/b, Rowland_gladys-a/b, RowlandSettings |
| LEAGUES | `LEAGUES_SPREADSHEET_ID` | LeagueControl, LeagueTeams, LeagueSquad, LeagueMatches, LeagueAttachments, LeagueSettings |
| CONFIG | `PORTAL_CONFIG_SPREADSHEET_ID` | Labels |

### Key library files

| File | Purpose |
|------|---------|
| `src/lib/sheets.ts` | Google Sheets client, `User` type, `getColumnMap`, `withRetry`, `getAllUsers` |
| `src/lib/auth.ts` | NextAuth config, session/JWT callbacks, credential validation |
| `src/lib/date-utils.ts` | UK date parsing/formatting (`parseUKDate`, `normalizeToUKDate`, `formatGameDate`) |
| `src/lib/role-utils.ts` | `parseRoles`, `hasRole`, `isCommitteeMember`, `isMember` |
| `src/lib/email/mailer.ts` | `sendEmail`, `sendTemplateEmail`, `sendEmailWithAttachments`, `getEmailTransporter` |
| `src/lib/cloudinary.ts` | Legacy Cloudinary upload/delete/fetch (new files go to Drive via `src/lib/drive.ts`) |
| `src/config/theme.ts` | Brand colours, typography, layout — single source of truth |
| `src/config/theme-helpers.ts` | `getButtonClasses`, `getInputClasses`, etc. — literal Tailwind classes (must match theme.ts) |
| `middleware.ts` | Route protection, role guards, Club/impersonation restrictions |

---

## 2. DIRECTORY TREE

```
app/
  admin/emails/page.tsx
  api/
    admin/emails/club-contacts/route.ts
    admin/emails/recipients/route.ts
    admin/emails/send/route.ts
    admin/emails/templates/preview/route.ts
    admin/emails/templates/route.ts
    admin/impersonate/clubs/route.ts
    admin/impersonate/start/route.ts
    admin/impersonate/stop/route.ts
    admin/impersonate/users/route.ts
    admin/labels/config/route.ts
    admin/labels/members/route.ts
    apply/route.ts
    attachments/upload-session/route.ts
    auth/[...nextauth]/route.ts
    auth/forgot-password/route.ts
    auth/refresh-session/route.ts
    auth/reset-password/route.ts
    banking/import/route.ts
    banking/payment/route.ts
    banking/payments/route.ts
    banking/renewals/route.ts
    banking/report/route.ts
    banking/submit/route.ts
    buddies/route.ts
    change-password/route.ts
    cleaning-rota/[rowNumber]/route.ts
    cleaning-rota/assignments/[userName]/route.ts
    cleaning-rota/batch/route.ts
    cleaning-rota/route.ts
    cleaning-rota/swap/route.ts
    clubs/[clubName]/contacts/[rowNumber]/route.ts
    clubs/[clubName]/contacts/route.ts
    clubs/[clubName]/fixtures/route.ts
    clubs/[clubName]/route.ts
    clubs/contact-roles/route.ts
    clubs/create/route.ts
    clubs/route.ts
    competitions/[compId]/entrants/route.ts
    competitions/[compId]/export-sheet/route.ts
    competitions/[compId]/matches/[matchId]/route.ts
    competitions/[compId]/route.ts
    competitions/[compId]/setup/route.ts
    competitions/handicaps/route.ts
    competitions/members/route.ts
    competitions/message/route.ts
    competitions/my/route.ts
    competitions/route.ts
    data-export/definitions/[id]/route.ts
    data-export/definitions/route.ts
    data-export/run/route.ts
    data-export/schemas/route.ts
    drive-image/route.ts
    fixtures/games/route.ts
    fixtures/manage/game/[rowNumber]/route.ts
    fixtures/manage/games/route.ts
    friendlies/add-players/route.ts
    friendlies/confirm/route.ts
    friendlies/enter/route.ts
    friendlies/entered-players/route.ts
    friendlies/game/[tabDate]/route.ts
    friendlies/games/route.ts
    friendlies/manage/add-player/route.ts
    friendlies/manage/allocate/route.ts
    friendlies/manage/game/[tabDate]/route.ts
    friendlies/manage/games/route.ts
    friendlies/manage/get-stats/route.ts
    friendlies/manage/lock/route.ts
    friendlies/manage/message/route.ts
    friendlies/manage/pickup-info/route.ts
    friendlies/manage/player-stats/route.ts
    friendlies/manage/players/route.ts
    friendlies/manage/selection-helper/route.ts
    friendlies/manage/send-test-email/route.ts
    friendlies/manage/status/route.ts
    friendlies/manage/update-selection/route.ts
    friendlies/manage/update-stats/route.ts
    friendlies/match-card/[tabDate]/route.ts
    friendlies/remove-player/route.ts
    friendlies/stats/route.ts
    friendlies/withdraw/route.ts
    internal-games/add-players/route.ts
    internal-games/enter/route.ts
    internal-games/entered-players/route.ts
    internal-games/game/[tabDate]/route.ts
    internal-games/games/route.ts
    internal-games/manage/game/[tabName]/route.ts
    internal-games/manage/players/route.ts
    internal-games/manage/status/route.ts
    internal-games/manage/update-player/route.ts
    internal-games/remove-player/route.ts
    internal-games/withdraw/route.ts
    invite-games/[id]/attachments/[attachmentId]/route.ts
    invite-games/[id]/attachments/route.ts
    invite-games/[id]/route.ts
    invite-games/route.ts
    leagues/[leagueId]/attachments/[attachmentId]/route.ts
    leagues/[leagueId]/attachments/route.ts
    leagues/[leagueId]/enter/route.ts
    leagues/[leagueId]/matches/[matchId]/route.ts
    leagues/[leagueId]/matches/route.ts
    leagues/[leagueId]/route.ts
    leagues/[leagueId]/squad/[rowNumber]/route.ts
    leagues/[leagueId]/teams/[teamId]/players/route.ts
    leagues/[leagueId]/teams/[teamId]/route.ts
    leagues/[leagueId]/teams/route.ts
    leagues/manage/games/route.ts
    leagues/manage/status/route.ts
    leagues/message/route.ts
    leagues/my-entries/route.ts
    leagues/route.ts
    members/lookup/route.ts
    profile/route.ts
    renewals/route.ts
    rowland/[compId]/matches/[matchId]/route.ts
    rowland/[compId]/matches/[matchId]/score-sheet/route.ts
    rowland/[compId]/matches/route.ts
    rowland/[compId]/next-match/route.ts
    rowland/[compId]/route.ts
    rowland/[compId]/setup/route.ts
    rowland/clubs/route.ts
    rowland/message/route.ts
    rowland/participants/route.ts
    rowland/route.ts
    social-events/add-players/route.ts
    social-events/enter/route.ts
    social-events/entered-players/route.ts
    social-events/event/[tabDate]/route.ts
    social-events/events/route.ts
    social-events/manage/players/route.ts
    social-events/manage/status/route.ts
    social-events/remove-player/route.ts
    suggestions/[id]/attachments/[attachmentId]/route.ts
    suggestions/[id]/attachments/route.ts
    suggestions/[id]/route.ts
    suggestions/route.ts
    sweeping-rota/[date]/route.ts
    sweeping-rota/blocked/[date]/route.ts
    sweeping-rota/blocked/route.ts
    sweeping-rota/clear/route.ts
    sweeping-rota/route.ts
    tea-rota/[rowNumber]/route.ts
    tea-rota/assignments/[userName]/route.ts
    tea-rota/batch/route.ts
    tea-rota/route.ts
    tea-rota/swap/route.ts
    users/list/route.ts
  apply/page.tsx
  banking/add-payments/page.tsx
  banking/page.tsx
  banking/report/page.tsx
  change-password/page.tsx
  cleaning-rota/page.tsx
  clublogin/page.tsx
  clubs/[clubName]/page.tsx
  clubs/new/page.tsx
  clubs/page.tsx
  competitions/[compId]/page.tsx
  competitions/[compId]/setup/page.tsx
  competitions/admin/page.tsx
  competitions/handicaps/page.tsx
  competitions/my/page.tsx
  competitions/page.tsx
  data-export/page.tsx
  fixtures/manage/page.tsx
  fixtures/page.tsx
  forgot-password/page.tsx
  friendlies/game/[tabDate]/page.tsx
  friendlies/manage/allocate/[date]/page.tsx
  friendlies/manage/game/[tabDate]/page.tsx
  friendlies/manage/page.tsx
  friendlies/manage/picker/[tabDate]/page.tsx
  friendlies/match-card/[tabDate]/page.tsx
  friendlies/page.tsx
  globals.css
  help/_components.tsx
  help/banking/page.tsx
  help/buddy/page.tsx
  help/cleaning-rota-admin/page.tsx
  help/club/page.tsx
  help/club-admin/page.tsx
  help/competitions/page.tsx
  help/competitions-admin/page.tsx
  help/data-export/page.tsx
  help/fixtures-admin/page.tsx
  help/friendlies/page.tsx
  help/friendly-management/page.tsx
  help/getting-around/page.tsx
  help/handicaps/page.tsx
  help/install/page.tsx
  help/internal-games/page.tsx
  help/invite-games/page.tsx
  help/leagues/page.tsx
  help/leagues-admin/page.tsx
  help/login/page.tsx
  help/lookups/page.tsx
  help/member-suggestions-admin/page.tsx
  help/page.tsx
  help/profile/page.tsx
  help/renewals/page.tsx
  help/rowland/page.tsx
  help/send-emails/page.tsx
  help/tea-rota-admin/page.tsx
  internal-games/manage/game/[tabName]/page.tsx
  internal-games/manage/page.tsx
  internal-games/page.tsx
  invite-games/[id]/page.tsx
  invite-games/new/page.tsx
  invite-games/page.tsx
  kiosk/page.tsx
  labels/page.tsx
  layout.tsx
  leagues/[leagueId]/page.tsx
  leagues/manage/[leagueId]/page.tsx
  leagues/manage/page.tsx
  leagues/page.tsx
  login/page.tsx
  member-suggestions/[id]/page.tsx
  member-suggestions/new/page.tsx
  member-suggestions/page.tsx
  members/page.tsx
  page.tsx
  profile/page.tsx
  providers.tsx
  renewals/page.tsx
  reset-password/page.tsx
  rowland/[compId]/page.tsx
  rowland/[compId]/setup/page.tsx
  rowland/admin/page.tsx
  rowland/page.tsx
  social-events/event/[tabDate]/page.tsx
  social-events/page.tsx
  sweeping-rota/page.tsx
  tea-rota/page.tsx

src/
  components/
    AttachmentsList.tsx
    AttachmentUpload.tsx
    competitions/
      bracketLayout.ts
      BracketView.tsx
      ExportSheetDialog.tsx
      MatchCard.tsx
      ScoreDialog.tsx
    ConfirmDialog.tsx
    game-management/
      EnteredPlayersModal.tsx
      GameInstructionsDialog.tsx
      SelectionHelperDialog.tsx
      SelectionHelperPanel.tsx
    ImpersonationModal.tsx
    Navbar.tsx
    RouterBackLink.tsx
    rowland/
      RowlandMatchDialog.tsx
    SearchableSelect.tsx
    sweeping-rota/
      ConfirmAddModal.tsx
      MonthCalendar.tsx
      PatternEntryModal.tsx
      PrintableCalendar.tsx
      PrintRangeModal.tsx
    UserSelector.tsx
    VersionDisplay.tsx
  config/
    theme.ts
    theme-helpers.ts
    version.ts
  hooks/
    useEditMode.ts
    useImpersonation.ts
    usePhoneBackNavigation.ts
    useSessionRefresh.ts
  lib/
    attachments-sheets.ts
    auth.ts
    auth-sheets.ts
    banking-match.ts
    banking-sheets.ts
    buddies-sheets.ts
    cleaning-sheets.ts
    cloudinary.ts
    clubs-sheets.ts
    competitions-sheets.ts
    config-sheets.ts
    data-export.ts
    date-utils.ts
    drive.ts
    email/
      club-change-notifier.ts
      club-mailer.ts
      friendlies.ts
      mailer.ts
      member-mailer.ts
      pdf-generator.ts
      renewal-mailer.ts
      template-loader.ts
      template-processor.ts
      template-reader.ts
      templates/  (HTML templates + Word attachment templates)
    form-draft-utils.ts
    friendlies-sheets.ts
    friendlies-utils.ts
    game-management/
      capacity.ts
      config.ts
      friendlies/parsers.ts
      internal-games/parsers.ts
      sheet-operations.ts
      social-events/parsers.ts
      types.ts
    ics-utils.ts
    internal-games-sheets.ts
    invite-games-attachments-sheets.ts
    invite-games-sheets.ts
    leagues-attachments-sheets.ts
    leagues-sheets.ts
    member-type-utils.ts
    mock-competitions-data.ts
    profile-sheets.ts
    renewals-sheets.ts
    role-utils.ts
    rowland-sheets.ts
    sheet-export.ts
    sheet-export-config.ts
    sheets.ts
    social-events-sheets.ts
    suggestions-sheets.ts
    sweeping-patterns.ts
    sweeping-sheets.ts
    types/
      cleaning.ts
      clubs.ts
      data-export.ts
      friendlies.ts
      sweeping.ts
  types/
    attachments.ts
    competitions.ts
    invite-games.ts
    leagues.ts
    next-auth.d.ts
    rowland.ts
    suggestions.ts
```

---

## 3. KEY FILE CONTENTS

### src/config/theme.ts

```typescript
// src/config/theme.ts
// Central theme configuration for the TDC Portal
// This is the single source of truth for all branding, colors, fonts, and component styling

export const theme = {
  brand: {
    name: 'Burgess Hill Bowls Club',
    shortName: 'BHBC',
    tagline: 'Member Portal',
    logo: { path: '/bhbc-Logo.png', alt: 'Burgess Hill Bowls Club Logo', height: 40 },
  },
  colors: {
    primary:   { DEFAULT: 'blue-500',  hover: 'blue-600',  light: 'blue-100',  text: 'blue-700'  },
    secondary: { DEFAULT: 'gray-300',  hover: 'gray-400',  light: 'gray-100',  text: 'gray-700'  },
    danger:    { DEFAULT: 'red-600',   hover: 'red-900',   light: 'red-50',    text: 'red-800'   },
    success:   { DEFAULT: 'green-600', hover: 'green-700', light: 'green-50',  text: 'green-800' },
    warning:   { DEFAULT: 'yellow-500',hover: 'yellow-600',light: 'yellow-50', text: 'yellow-800'},
    neutral: { 50:'gray-50', 100:'gray-100', 200:'gray-200', 300:'gray-300', 400:'gray-400',
               500:'gray-500', 600:'gray-600', 700:'gray-700', 800:'gray-800', 900:'gray-900' },
  },
  typography: {
    fontFamily: { sans: 'Arial, Helvetica, sans-serif' },
    fontSize: { xs:'0.75rem', sm:'0.875rem', base:'1rem', lg:'1.125rem', xl:'1.25rem', '2xl':'1.5rem', '3xl':'1.875rem' },
  },
  components: {
    button: { sizes: { sm:{padding:'px-3 py-1.5',fontSize:'text-sm'}, md:{padding:'px-4 py-2',fontSize:'text-sm'}, lg:{padding:'px-6 py-3',fontSize:'text-base'} }, borderRadius:'rounded-md', fontWeight:'font-medium' },
    input:  { borderRadius:'rounded-md', padding:'px-3 py-2', fontSize:'text-sm', borderWidth:'border' },
    card:   { borderRadius:'rounded-lg', shadow:'shadow', padding:{ none:'', sm:'p-4', md:'p-6', lg:'p-8' } },
    modal:  { sizes:{ sm:'max-w-md', md:'max-w-lg', lg:'max-w-2xl', xl:'max-w-4xl' }, borderRadius:'rounded-lg', shadow:'shadow-xl', backdrop:'bg-gray-500 bg-opacity-75' },
    badge:  { sizes:{ sm:'px-2 py-0.5 text-xs', md:'px-2.5 py-0.5 text-xs', lg:'px-3 py-1 text-sm' }, borderRadius:'rounded-full', fontWeight:'font-medium' },
    alert:  { borderRadius:'rounded-md', padding:'p-4' },
  },
  layout: { containerMaxWidth:'max-w-7xl', navbarHeight:'h-16', spacing:{ page:'py-8 px-4 sm:px-6 lg:px-8' } },
  // HTML email hex values (Tailwind classes don't work in emails)
  email: {
    headerColor:'#588FB1',      // Club primary blue
    headerTextColor:'#ffffff',
    bodyTextColor:'#1F2937',    // gray-800
    buttonColor:'#588FB1',
    buttonTextColor:'#ffffff',
    buttonHoverColor:'#4A7A95',
    backgroundColor:'#F9FAFB',  // gray-50
    borderColor:'#E5E7EB',      // gray-200
  },
} as const;
```

### src/config/theme-helpers.ts

```typescript
// IMPORTANT: Uses literal Tailwind classes due to JIT compiler limitations
// When changing colors, update both theme.ts AND the literal classes in this file

export function getButtonClasses(variant: 'primary'|'secondary'|'danger'|'success'|'text' = 'primary', size: 'sm'|'md'|'lg' = 'md', fullWidth = false): string
// primary   → bg-blue-500 hover:bg-blue-600 text-white
// secondary → bg-orange-600 hover:bg-orange-700 text-white
// danger    → bg-red-600 hover:bg-red-900 text-white
// success   → bg-green-600 hover:bg-green-700 text-white
// text      → text-blue-500 hover:text-blue-600 bg-transparent

export function getInputClasses(hasError = false): string
// Normal: border-gray-300 focus:ring-blue-500
// Error:  border-red-300 text-red-900 focus:ring-red-500

export function getNavItemClasses(isActive: boolean): string
// Active:   bg-blue-100 text-blue-700
// Inactive: text-gray-700 hover:bg-gray-100

export function getLinkClasses(variant: 'primary'|'secondary' = 'primary'): string
// primary   → text-blue-500 hover:text-blue-600
// secondary → text-orange-600 hover:text-orange-700

export function getProfileIconClasses(isImpersonating: boolean): string
// Impersonating: bg-orange-500 (visual indicator)
// Normal:        bg-blue-500

export function getCardClasses(padding: 'none'|'sm'|'md'|'lg' = 'md'): string
// bg-white shadow rounded-lg + padding

export function getBadgeClasses(variant: 'primary'|'secondary'|'success'|'danger'|'warning' = 'primary', size: 'sm'|'md'|'lg' = 'md'): string

export function getAlertClasses(variant: 'info'|'success'|'warning'|'danger' = 'info'): string
```

### src/lib/sheets.ts (key portions)

```typescript
// Environment variable getters (throw with helpful error if missing):
export function getSpreadsheetId(): string          // MEMBERS_SPREADSHEET_ID
export function getCompetitionsSpreadsheetId(): string
export function getRowlandSpreadsheetId(): string
export function getLeaguesSpreadsheetId(): string

// Retry wrapper — patched onto ALL spreadsheets.values.* methods automatically:
export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4, baseDelayMs = 1000): Promise<T>
// Retries on 429 and 403 Quota errors with exponential backoff (1s, 2s, 4s)

// Singleton client (retry already applied):
export function getGoogleSheetsClient(): ReturnType<typeof google.sheets>

// Column mapping — normalises header names to snake_case:
export async function getColumnMap(sheetName: string = 'Members', spreadsheetId?: string): Promise<Record<string, number>>
// e.g. "User Name" → "user_name", result cached in memory
export function clearColumnMapCache(): void

export function getColumnLetter(index: number): string  // 0→'A', 26→'AA', etc.

// User type (from Members sheet):
export interface User {
  firstName, lastName, knownAs, fullKnownAs, fullName
  emailAddress, landline, mobile
  address1, address2, address3, postCode
  lockerNo, birthdate, ageDemographic, memberType
  honorary, yearStarted, renewStatus
  friendlies2023, friendlies2024, friendliesLastYear
  comments, socialEmails, handbookEntry
  drivingAwayMatches, drivingAdditionalInfo
  greenMaintenance, greenAdditionalInfo, barDuty, barAdditionalInfo, otherSkills
  gmc, profileUpdatedDate
  handicap: number | null  // integer 0-10, Playing members only
  include, renewalEmailSentStatus  // renewal email fields
  buddyUserName, userName, passwordHash, isTempPassword, role
  lastLoginDate, lastLoginFailedDate, lastPasswordResetDate
  resetToken, resetTokenExpires, createdAt, updatedAt
  _rowNumber?: number
}

// User queries:
export async function getAllUsers(): Promise<User[]>
export async function getUserByUsername(userName: string): Promise<User | null>
export async function getUsersByEmail(email: string): Promise<User[]>
export async function updateLastLogin(userName: string, success: boolean): Promise<void>
```

### src/lib/date-utils.ts

```typescript
// CRITICAL: Google Sheets stores dates as DD/MM/YYYY.
// new Date("DD/MM/YYYY") is silently WRONG in JavaScript — always use these helpers.

export function parseUKDate(dateStr: string): Date
// Supports: DD/MM/YYYY, "Wed, 29 April", "Wed, 29 April 2026", YYYY-MM-DD

export function parseNormalizedDate(dateStr: string): Date
// Faster version for known DD/MM/YYYY input (backend use)

export function normalizeToUKDate(dateStr: string): string
// Converts any supported format to DD/MM/YYYY with zero-padding

export function formatGameDate(dateStr: string, options?: Intl.DateTimeFormatOptions): string
// Default: "Tue, 12 May" (weekday short + day + month short, en-GB locale)
```

### src/lib/role-utils.ts

```typescript
// Roles are stored as comma-separated string in Members sheet, e.g. "Captain,RowlandOrganiser"
// Empty string or "Member" = regular member (no special permissions)

export function parseRoles(role: string | undefined | null): string[]
// "Captain,GMC" → ['Captain', 'GMC']
// "Member" → []

export function hasRole(role: string | undefined | null, ...checkRoles: string[]): boolean
// hasRole(role, 'Captain', 'Admin') → true if user has either role

export function isCommitteeMember(role: string | undefined | null): boolean
// true for Captain | Treasurer | GMC | Admin
// NOTE: RowlandOrganiser and RowlandPlayer are NOT committee members

export function isMember(role: string | undefined | null): boolean
// true when user has no roles (regular member)
```

### src/lib/email/mailer.ts

```typescript
export function getEmailTransporter(usePool: boolean = false): Transporter
// SMTP via Gmail (port 587). Pool mode: maxConnections=1, sequential sends.
// IMPORTANT: Never send emails in parallel — risk of Gmail suspension.

export function isEmailConfigured(): boolean
// Checks SMTP_USER and SMTP_PASSWORD env vars

export async function sendTemplateEmail(
  to: string, subject: string, templateName: string,
  variables: Record<string, string | null | undefined>
): Promise<{ success: boolean; error?: string }>
// Loads HTML from src/lib/email/templates/{templateName}.html
// Processes with Handlebars. Auto-injects theme brand vars.

export async function sendEmail(
  to: string, subject: string, text: string,
  html?: string, attachments?: EmailAttachment[]
): Promise<{ success: boolean; error?: string }>

export async function sendEmailWithAttachments(
  to: string, subject: string, htmlContent: string,
  attachments: Array<{ filename: string; content: Buffer }>,
  transporter?: any
): Promise<{ success: boolean; error?: string }>
// Accepts optional pooled transporter for bulk operations

interface EmailAttachment { filename: string; content: string; contentType: string }
```

### src/lib/cloudinary.ts

```typescript
// Legacy file storage — new uploads go to Google Drive via src/lib/drive.ts
// The sheet column is still named "drive_file_id" even for Cloudinary publicIds

export async function uploadFileToCloudinary(
  entityId: string, fileBuffer: Buffer, fileName: string, mimeType: string,
  folderPrefix?: string  // default: 'bhbc-suggestions'
): Promise<{ publicId, url, secureUrl, thumbnailUrl, format, bytes }>

export async function deleteFileFromCloudinary(publicId: string): Promise<void>
// Tries image resource type first, then raw

export async function checkFileExists(publicId: string): Promise<boolean>

export async function fetchFileFromCloudinary(
  publicId: string, resourceType?: 'image' | 'raw'
): Promise<{ buffer: Buffer; contentType: string }>
// Uses authenticated download API (bypasses CDN restrictions)
// Tries multiple URL forms for raw/image compatibility
```

### middleware.ts

```typescript
// Public routes (no auth required — see full list in isPublicRoute()):
// /fixtures, /members, /friendlies, /competitions, /tea-rota, /cleaning-rota,
// /sweeping-rota, /rowland, /leagues, /clubs (and sub-paths),
// /friendlies/game/[tabDate], /rowland/[compId] (not setup),
// /competitions/[compId] (not admin/my/handicaps), /leagues/[leagueId]
// + corresponding API routes

// Role guards:
// mustChangePassword → redirect to /change-password (unless admin impersonating)
// Club role → restricted to /clubs, /rowland, /api/, /change-password, /help
// /friendlies/manage/* → Captain or Admin only
// /admin/emails → Admin only

// Matcher: all routes except api/auth, api/apply, login, clublogin,
//          forgot-password, reset-password, kiosk, apply, help/login,
//          _next/static, _next/image, favicon, manifest, icons
```

---

## 4. TYPES INVENTORY

### src/types/next-auth.d.ts

Extends NextAuth `User`, `Session`, `JWT` with:
```typescript
// User (from auth callbacks):
userName: string
role: string          // raw comma-separated string from sheet
roles?: string[]      // parsed array (computed in JWT callback)
name: string
email: string
clubId?: string       // Club role logins only
mustChangePassword?: boolean

// Session.user:
userName, role, roles, clubId, mustChangePassword
isImpersonating?: boolean
originalAdmin?: { userName, email, name, role, roles }

// JWT:
userName, role, roles, name, email, loginTime
clubId?, mustChangePassword?
isImpersonating?, originalAdmin?
impersonationStartTime?, impersonationSessionId?
```

### src/types/attachments.ts

```typescript
type AttachmentType = 'link' | 'image' | 'document'

interface Attachment {
  attachmentId: string
  type: AttachmentType
  driveFileId?: string | null  // Cloudinary publicId OR Drive file ID
  url: string
  description: string
  fileName?, mimeType?, fileSize?: number | null
  displayOrder: number
  addedAt: string
  addedByUsername: string
  isDeleted?: boolean
  _rowNumber?: number
}

interface SuggestionAttachment extends Attachment { suggestionId: string }
interface InviteGameAttachment  extends Attachment { inviteGameId: string }
interface LeagueAttachment      extends Attachment { leagueId: string }
```

### src/types/competitions.ts

```typescript
type CompType    = 'singles' | 'pairs' | 'triples'
type CompRound   = 'Prelim' | 'R1' | 'R2' | 'QF' | 'SF' | 'F'
type MatchStatus = 'Pending' | 'Complete' | 'Walkover' | 'Bye'
type CompStatus  = 'Not Started' | 'Draw Done' | 'In Progress' | 'Complete'

COMP_ROUND_LABELS: Record<CompRound, string>   // human labels
ROUND_ORDER: CompRound[]                        // progression order

interface CompMatch {
  matchId, round, position
  side1Usernames: string[]    // singles: 1 username; pairs: 2; triples: 3
  side2Usernames: string[] | null   // null = bye
  score1?, score2?, winnerSide?: 1 | 2 | null
  status: MatchStatus
  playByDate?, playedDate?, scoreSheetUrl?
}

interface Competition {
  compId, displayName, compType, status, year, finalsDate?
  prelimPlayBy?, r1PlayBy?, r2PlayBy?, qfPlayBy?, sfPlayBy?
  triplesFixedDay?, triplesFixedDate?
  drawSideCount?, compStartDate?, compDescription?
}

interface CompMemberInfo { username, fullName, handicap?, memberType?, mobile?, email? }
```

### src/types/leagues.ts

```typescript
type LeagueType        = 'triples' | 'pairs'
type LeagueStatus      = 'Not Started' | 'Entries Open' | 'In Progress' | 'Complete'
type LeagueMatchStatus = 'Scheduled' | 'Played' | 'Walkover' | 'Conceded' | 'Not Played'
type SquadPosition     = 'Skip' | 'Captain' | 'Lead' | 'Two' | ''

interface League {
  leagueId, name, type, season, status
  squadSize, playersPerMatch, dateLabel, legs: 1|2, message
}

interface LeagueTeam        { teamId, leagueId, teamName }
interface LeagueSquadMember { rowNumber, leagueId, teamId, username, fullName, position, enteredDate, mobile?, email? }
interface LeagueMatch        { matchId, leagueId, matchday, homeTeamId, awayTeamId,
                               scheduledDate?, scheduledTime?, playByDate?,
                               homeScore, awayScore, homeAdj, awayAdj,
                               homePoints, awayPoints, status }
interface LeagueTableRow     { teamId, teamName, played, won, drew, lost, shotsFor, shotsAgainst, shotDiff, points }

function calculateTable(teams: LeagueTeam[], matches: LeagueMatch[]): LeagueTableRow[]
function generateRoundRobin(teamIds: string[], legs: 1|2): { matchday, homeTeamId, awayTeamId }[]
```

### src/types/rowland.ts

```typescript
type RowlandCompId     = 'edward-a' | 'edward-b' | 'gladys-a' | 'gladys-b'
type RowlandRound      = 'Prelim' | 'R1' | 'R2' | 'QF' | 'SF' | 'F'
type RowlandMatchStatus = 'Pending' | 'Played' | 'Walkover' | 'Bye'
type RowlandCompStatus  = 'Not Started' | 'Draw Done' | 'In Progress' | 'Complete'

ROWLAND_COMP_NAMES:  Record<RowlandCompId, string>   // 'edward-a' → 'Edward A'
ROWLAND_ROUND_LABELS, ROWLAND_ROUND_ORDER
ROWLAND_SHEET_NAMES: Record<RowlandCompId, string>   // maps to sheet tab names

interface RowlandTeamRef { clubId, clubName, teamLetter }
interface RowlandMatch {
  matchId, round, position
  homeTeam: RowlandTeamRef | null    // null = TBD
  awayTeam: RowlandTeamRef | null    // null = TBD or bye
  homePlayers, awayPlayers: string[] // free-text names (not usernames)
  homeScore, awayScore, winnerSide: 1|2|null
  status, playByDate, playedDate, notes, scoreSheetUrl
}
interface RowlandComp {
  compId, compName, season, status, numTeams
  prelimPlayBy, r1PlayBy, r2PlayBy, qfPlayBy, sfPlayBy, fPlayBy
}
```

### src/types/suggestions.ts

```typescript
type SuggestionCategory = 'Facilities'|'Green'|'Grounds'|'Clubhouse'|'Bar'|'Social'|'Finance'|'Other'
type Priority       = 'Low'|'Medium'|'High'|'Safety essential'
type FundingSource  = 'Club Funds'|'Grant'|'Fundraising'|'Sponsor'|'Other'
type Decision       = 'Approved'|'Not Approved'|'Deferred'
type FinalOutcome   = 'Completed'|'Cancelled'|'On Hold'
type SuggestionStatus = 'new'|'ongoing'|'review'|'complete'|'cancelled'|'on_hold'

interface MemberSuggestion {
  suggestionId, title, category, description, reasonForImprovement
  createdByUsername, createdByFullName, createdAt
  committeeOnly?, dateReceived?, committeeAcceptance?
  priority?, coordinatorUsername?, coordinatorFullName?
  estimatedCost?, fundingSource?, costQuotesDetails?
  decision?, decisionReason?, targetCompletionDate?, progressNotes?, reviewDate?
  finalOutcome?, dateCompleted?
  updatedAt?, updatedByUsername?, _rowNumber?
}

function getSuggestionStatus(s: MemberSuggestion): SuggestionStatus
function getStatusLabel(status: SuggestionStatus): string
function getStatusColor(status: SuggestionStatus): string  // Tailwind bg-* class
```

### src/types/invite-games.ts

```typescript
interface InviteGame {
  inviteGameId: string  // IG-YYYY-NNN format
  title, description
  closingDate: string | null
  gameDate: string | null
  createdByUsername, createdByFullName, createdAt
  updatedAt?, updatedByUsername?, _rowNumber?
}
```

---

## 5. API ROUTES INVENTORY

Format: `METHOD /path — description`

### Admin: Emails
- `GET  /api/admin/emails/club-contacts` — count of club contacts with Include=Y that have email + Club ID
- `POST /api/admin/emails/club-contacts` — send emails to club contacts (SSE stream)
- `GET  /api/admin/emails/recipients` — count of member email recipients (Include="Y")
- `POST /api/admin/emails/send` — send bulk emails to members using selected template (SSE stream)
- `GET  /api/admin/emails/templates/preview?id=&type=` — return raw template HTML for preview (Admin)
- `GET  /api/admin/emails/templates` — list available email templates and attachment templates

### Admin: Impersonation
- `GET  /api/admin/impersonate/clubs` — list clubs available for impersonation (Admin + Rowland role)
- `POST /api/admin/impersonate/start` — start impersonating another user or club
- `POST /api/admin/impersonate/stop` — stop impersonating and return to original admin
- `GET  /api/admin/impersonate/users` — list users that current admin can impersonate

### Admin: Labels
- `GET  /api/admin/labels/config` — fetch Labels config from Config spreadsheet
- `POST /api/admin/labels/config` — update Labels config
- `GET  /api/admin/labels/members` — return members with fields needed for label printing

### Auth & Account
- `POST /api/apply` — public membership application with honeypot spam protection
- `POST /api/attachments/upload-session` — create Google Drive resumable upload session URI
- `*    /api/auth/[...nextauth]` — NextAuth handler (login, session, callbacks)
- `POST /api/auth/forgot-password` — generate password reset token and send email
- `POST /api/auth/refresh-session` — refresh session data from sheet (e.g. after role change)
- `POST /api/auth/reset-password` — validate reset token and set new password
- `POST /api/change-password` — authenticated password change

### Banking
- `POST /api/banking/import` — import payments from CSV file
- `POST/PATCH/DELETE /api/banking/payment` — add, amend, or delete a payment record
- `GET  /api/banking/payments` — get unmatched payments
- `GET  /api/banking/renewals` — get renewals with outstanding balance > 0
- `GET  /api/banking/report` — banking report (paid/unpaid subs, allocated/unallocated payments)
- `POST /api/banking/submit` — submit matched payments (write to Renewals sheet)

### Buddies & Profile
- `GET  /api/buddies` — get list of manageable users (buddy system)
- `GET  /api/profile` — get user profile (own or buddy)
- `PUT  /api/profile` — update user profile (own or buddy)
- `GET  /api/renewals` — get renewal data (own or buddy)
- `PUT  /api/renewals` — update renewal data (own or buddy)

### Cleaning Rota
- `GET  /api/cleaning-rota` — all cleaning rota entries
- `GET  /api/cleaning-rota/[rowNumber]` — get single cleaning rota entry
- `PUT  /api/cleaning-rota/[rowNumber]` — update single cleaning rota entry
- `GET  /api/cleaning-rota/assignments/[userName]` — all cleaning assignments for a user
- `POST /api/cleaning-rota/batch` — batch update multiple cleaning rota assignments
- `POST /api/cleaning-rota/swap` — swap cleaning duty between two members

### Clubs
- `GET  /api/clubs` — list all clubs (public)
- `POST /api/clubs/create` — create a new club (committee only)
- `GET  /api/clubs/contact-roles` — distinct contact roles across all clubs (for dropdowns)
- `GET  /api/clubs/[clubName]` — get single club details (public)
- `PUT  /api/clubs/[clubName]` — update club details (committee or own Club role)
- `DELETE /api/clubs/[clubName]` — delete a club (committee only)
- `POST /api/clubs/[clubName]/contacts` — add a contact to a club
- `PUT  /api/clubs/[clubName]/contacts/[rowNumber]` — update a club contact
- `DELETE /api/clubs/[clubName]/contacts/[rowNumber]` — remove a club contact
- `GET  /api/clubs/[clubName]/fixtures` — all friendly fixtures against a specific club

### Competitions (internal club comps, knockout bracket)
- `GET  /api/competitions` — list all competitions
- `GET  /api/competitions/message` — get competitions message (public)
- `PUT  /api/competitions/message` — update competitions message (Captain/Admin)
- `GET  /api/competitions/members` — CompMemberInfo for all members (used by bracket views)
- `GET  /api/competitions/handicaps` — Playing members with handicap values
- `PATCH /api/competitions/handicaps` — update one member's handicap (committee)
- `GET  /api/competitions/my` — current user's full journey across all entered competitions
- `GET  /api/competitions/[compId]` — competition details + all matches (public)
- `PATCH /api/competitions/[compId]` — update competition metadata: status, dates (committee)
- `POST /api/competitions/[compId]/setup` — save bracket draw (committee)
- `GET  /api/competitions/[compId]/entrants` — members who entered this competition (committee)
- `PATCH /api/competitions/[compId]/matches/[matchId]` — update match: score, walkover, sub
- `POST /api/competitions/[compId]/export-sheet` — export bracket to Google Sheet (Admin)

### Data Export
- `GET  /api/data-export/schemas` — all sheet schemas with columns (Admin)
- `GET  /api/data-export/definitions` — list saved report definitions
- `POST /api/data-export/definitions` — save or update a report definition (Admin)
- `GET  /api/data-export/definitions/[id]` — load full definition by ID
- `DELETE /api/data-export/definitions/[id]` — remove a definition (Admin)
- `POST /api/data-export/run` — execute a report, write results to ReportOutput tab (Admin)

### Drive
- `GET  /api/drive-image?id=` — server-side proxy for Google Drive images (bypasses auth)

### Fixtures (external fixtures list managed by Captain)
- `GET  /api/fixtures/games` — public fixtures list sorted by date
- `GET  /api/fixtures/manage/games` — all games for captain management (Captain/Admin)
- `POST /api/fixtures/manage/games` — add a new fixture (Captain/Admin)
- `PATCH /api/fixtures/manage/game/[rowNumber]` — update a fixture (Captain/Admin)
- `DELETE /api/fixtures/manage/game/[rowNumber]` — delete a fixture (Captain/Admin)

### Friendlies (home/away games, with full lifecycle management)
- `GET  /api/friendlies/games` — all games with user's entry status
- `POST /api/friendlies/enter` — enter one or more games
- `POST /api/friendlies/withdraw` — withdraw from a game
- `POST /api/friendlies/confirm` — confirm participation after being selected
- `POST /api/friendlies/add-players` — manually add other players to a game
- `POST /api/friendlies/remove-player` — remove a player from a game
- `GET  /api/friendlies/entered-players` — list of entered players for a game
- `GET  /api/friendlies/game/[tabDate]` — single game details (public)
- `GET  /api/friendlies/stats` — per-game stats for a player (own or captain querying any)
- `GET  /api/friendlies/match-card/[tabDate]` — generate match card data for printing
- `GET  /api/friendlies/manage/games` — all games for captain management
- `GET  /api/friendlies/manage/game/[tabDate]` — game details for team selection (Captain)
- `POST /api/friendlies/manage/status` — change game status (open/close/select/play/cancel)
- `POST /api/friendlies/manage/update-selection` — update player selections, teams, positions
- `POST /api/friendlies/manage/update-stats` — sync selection status back to Players sheet
- `POST /api/friendlies/manage/add-player` — add offline player to game sheet (Captain)
- `GET/POST/DELETE /api/friendlies/manage/lock` — acquire/release selection lock (prevents conflicts)
- `GET/POST /api/friendlies/manage/allocate` — allocate players between paired games (Captain)
- `GET  /api/friendlies/manage/players` — all players from Players sheet for selection
- `GET  /api/friendlies/manage/player-stats` — summary stats for every entered player (Captain)
- `POST /api/friendlies/manage/get-stats` — refresh player stats in game sheet from Players sheet
- `PUT  /api/friendlies/manage/message` — update special instructions for a game
- `PUT  /api/friendlies/manage/pickup-info` — update pickup information for a game
- `GET  /api/friendlies/manage/selection-helper` — selection analysis: bar/driver availability, etc.
- `POST /api/friendlies/manage/send-test-email` — send preview email to the captain

### Internal Games (structured internal club games)
- `GET  /api/internal-games/games` — all internal games with user's entry status
- `POST /api/internal-games/enter` — enter one or more internal games
- `POST /api/internal-games/withdraw` — withdraw from an internal game
- `POST /api/internal-games/add-players` — manually add players (M status)
- `POST /api/internal-games/remove-player` — remove manually added player
- `GET  /api/internal-games/entered-players` — entered players for a game
- `GET  /api/internal-games/game/[tabDate]` — single internal game details
- `GET  /api/internal-games/manage/game/[tabName]` — game details for selection (Captain)
- `POST /api/internal-games/manage/status` — change internal game status
- `GET  /api/internal-games/manage/players` — Playing members for selection
- `PATCH /api/internal-games/manage/update-player` — update single player selection

### Invite Games (external club invitations)
- `GET  /api/invite-games` — list all invite games
- `POST /api/invite-games` — create an invite game (committee)
- `GET  /api/invite-games/[id]` — get single invite game
- `PUT  /api/invite-games/[id]` — update invite game (committee)
- `DELETE /api/invite-games/[id]` — delete invite game (committee)
- `GET  /api/invite-games/[id]/attachments` — list attachments
- `POST /api/invite-games/[id]/attachments` — confirm upload, add attachment record
- `GET  /api/invite-games/[id]/attachments/[attachmentId]` — redirect/proxy to file
- `DELETE /api/invite-games/[id]/attachments/[attachmentId]` — delete attachment

### Leagues (club league system with teams, fixtures, table)
- `GET  /api/leagues` — list all leagues (public)
- `POST /api/leagues` — create a new league (Admin)
- `GET  /api/leagues/message` — leagues message (public)
- `PUT  /api/leagues/message` — update leagues message (committee)
- `GET  /api/leagues/my-entries` — league IDs the current user is entered in
- `GET  /api/leagues/[leagueId]` — league + teams + squad + matches + table (public)
- `PATCH /api/leagues/[leagueId]` — update league metadata/status (Admin/LeagueOrganiser)
- `POST /api/leagues/[leagueId]/enter` — enter the league
- `DELETE /api/leagues/[leagueId]/enter` — withdraw from the league
- `POST /api/leagues/[leagueId]/teams` — create a new team
- `PATCH /api/leagues/[leagueId]/teams/[teamId]` — rename a team
- `DELETE /api/leagues/[leagueId]/teams/[teamId]` — delete a team
- `PUT  /api/leagues/[leagueId]/teams/[teamId]/players` — bulk-save all players for a team
- `PATCH /api/leagues/[leagueId]/squad/[rowNumber]` — assign squad member to team/position
- `POST /api/leagues/[leagueId]/matches` — generate fixtures (double round-robin)
- `PUT  /api/leagues/[leagueId]/matches` — add a single manual fixture
- `PATCH /api/leagues/[leagueId]/matches/[matchId]` — update match score/status/date
- `DELETE /api/leagues/[leagueId]/matches/[matchId]` — delete a match
- `GET  /api/leagues/[leagueId]/attachments` — list attachments
- `POST /api/leagues/[leagueId]/attachments` — confirm upload, add attachment record
- `DELETE /api/leagues/[leagueId]/attachments/[attachmentId]` — delete attachment
- `GET  /api/leagues/manage/games` — league fixtures for captain result entry
- `POST /api/leagues/manage/status` — record result for a league game (played/cancel/abandon)

### Members
- `GET  /api/members/lookup` — member contact lookup (all logged-in members)
- `GET  /api/users/list` — full user list for searchable selects (authenticated)

### Rowland Cup (inter-club knockout cup)
- `GET  /api/rowland` — list all Rowland Cup competitions (public)
- `GET  /api/rowland/message` — get Rowland Cup message (public)
- `PUT  /api/rowland/message` — update message (committee)
- `GET  /api/rowland/clubs` — list clubs from Match Day Contacts spreadsheet
- `GET  /api/rowland/participants` — all unique clubs across active/in-progress comps (public)
- `GET  /api/rowland/[compId]` — single competition details (public)
- `PATCH /api/rowland/[compId]` — update metadata: status, dates, numTeams (committee)
- `POST /api/rowland/[compId]/setup` — create initial bracket
- `GET  /api/rowland/[compId]/matches` — all matches for a competition (public)
- `PATCH /api/rowland/[compId]/matches/[matchId]` — update players, score, status
- `POST /api/rowland/[compId]/matches/[matchId]/score-sheet` — confirm score sheet image uploaded to Drive
- `GET  /api/rowland/[compId]/next-match?clubId=` — club's next pending match + opponent contacts

### Social Events
- `GET  /api/social-events/events` — all social events
- `GET  /api/social-events/event/[tabDate]` — single social event with attendees
- `POST /api/social-events/enter` — enter one or more social events
- `POST /api/social-events/add-players` — manually add attendees (M status)
- `POST /api/social-events/remove-player` — remove manually added attendee
- `GET  /api/social-events/entered-players` — list of entered attendees
- `GET  /api/social-events/manage/players` — all members for attendee selection
- `POST /api/social-events/manage/status` — change social event status through lifecycle

### Suggestions (member improvement suggestions)
- `GET  /api/suggestions` — list all suggestions
- `POST /api/suggestions` — create a suggestion
- `GET  /api/suggestions/[id]` — get single suggestion
- `PUT  /api/suggestions/[id]` — update suggestion (committee fields)
- `GET  /api/suggestions/[id]/attachments` — list attachments
- `POST /api/suggestions/[id]/attachments` — confirm upload, add attachment record
- `GET/DELETE /api/suggestions/[id]/attachments/[attachmentId]` — get/delete attachment

### Sweeping Rota
- `GET  /api/sweeping-rota` — get rota entries
- `POST /api/sweeping-rota` — add entries
- `DELETE /api/sweeping-rota/[date]` — cancel a sweeping entry
- `GET  /api/sweeping-rota/blocked` — (via main route) get blocked dates
- `POST /api/sweeping-rota/blocked` — block a day (Admin)
- `DELETE /api/sweeping-rota/blocked/[date]` — unblock a specific day (Admin)
- `POST /api/sweeping-rota/clear` — clear days (remove assignments or unblock, non-members)

### Tea Rota
- `GET  /api/tea-rota` — all home games with tea duty assignments
- `PUT  /api/tea-rota/[rowNumber]` — update tea rota assignment (committee)
- `GET  /api/tea-rota/assignments/[userName]` — all tea assignments for a user
- `POST /api/tea-rota/batch` — batch update multiple assignments
- `POST /api/tea-rota/swap` — swap tea duty between two members

---

## 6. PAGES INVENTORY

Format: `Route — description`

### Authentication
- `/login` — login form (username/password)
- `/clublogin` — external club login page (for Club role accounts)
- `/forgot-password` — request password reset email
- `/reset-password` — set new password using reset token
- `/change-password` — forced password change (shown to users with temp password)
- `/apply` — public membership application form

### Home
- `/` — home/dashboard page (redirects based on role)
- `/kiosk` — simplified kiosk view (for Kiosk role, restricted nav)

### Profile & Renewals
- `/profile` — view and edit member profile
- `/renewals` — view/submit annual renewal form

### Friendlies (games against other clubs)
- `/friendlies` — list of all friendly games with entry/withdrawal controls
- `/friendlies/game/[tabDate]` — public read-only view of a specific game (selected players, rink info)
- `/friendlies/match-card/[tabDate]` — printable match card for a game
- `/friendlies/manage` — captain game management dashboard
- `/friendlies/manage/game/[tabDate]` — captain team selection screen for a specific game
- `/friendlies/manage/picker/[tabDate]` — player picker for a game (alternative selection view)
- `/friendlies/manage/allocate/[date]` — allocate players between paired games

### Internal Games
- `/internal-games` — list of internal games with entry controls
- `/internal-games/manage` — captain internal game management dashboard
- `/internal-games/manage/game/[tabName]` — captain selection for an internal game

### Social Events
- `/social-events` — list of social events with attendance options
- `/social-events/event/[tabDate]` — single social event details and attendees

### Fixtures
- `/fixtures` — public fixtures calendar (all game types)
- `/fixtures/manage` — captain fixtures management (add/edit/delete fixtures)

### Clubs
- `/clubs` — public list of all bowling clubs
- `/clubs/[clubName]` — club detail page with contacts and fixtures history
- `/clubs/new` — create a new club (committee)

### Rowland Cup
- `/rowland` — Rowland Cup overview (all four competitions)
- `/rowland/[compId]` — single Rowland Cup bracket view (public)
- `/rowland/[compId]/setup` — set up initial bracket draw (committee)
- `/rowland/admin` — admin overview of all Rowland Cup competitions

### Competitions (internal club knockout competitions)
- `/competitions` — list of all club competitions
- `/competitions/[compId]` — single competition bracket view (public)
- `/competitions/[compId]/setup` — draw/set up bracket (committee)
- `/competitions/admin` — admin overview of all competitions
- `/competitions/my` — member's personal competition journey across all entered comps
- `/competitions/handicaps` — view/edit member handicaps (committee)

### Leagues
- `/leagues` — list of all club leagues (public)
- `/leagues/[leagueId]` — league detail: table, fixtures, squad (public)
- `/leagues/manage` — league organiser dashboard
- `/leagues/manage/[leagueId]` — manage specific league: teams, squad, fixtures, results

### Member Suggestions
- `/member-suggestions` — list of member improvement suggestions
- `/member-suggestions/[id]` — single suggestion detail with attachments
- `/member-suggestions/new` — submit a new suggestion

### Invite Games
- `/invite-games` — list of external invitations from other clubs
- `/invite-games/[id]` — single invite game detail with attachments
- `/invite-games/new` — create an invite game entry (committee)

### Rotas
- `/cleaning-rota` — cleaning duty rota (view and manage assignments)
- `/sweeping-rota` — sweeping duty rota (calendar-based)
- `/tea-rota` — tea duty rota for home games

### Banking (Treasurer/Admin)
- `/banking` — main banking screen (match payments to renewals)
- `/banking/add-payments` — import/add payment records
- `/banking/report` — banking report (paid/unpaid, allocated/unallocated)

### Admin
- `/admin/emails` — compose and send bulk emails to members or clubs
- `/labels` — print address/membership labels (committee)
- `/members` — public member directory
- `/data-export` — Admin data export: build and run custom reports

### Help Pages
- `/help` — help centre index
- `/help/getting-around` — navigation guide
- `/help/login` — login/password help
- `/help/profile` — profile editing help
- `/help/renewals` — renewal form help
- `/help/install` — PWA install guide
- `/help/friendlies` — friendlies member guide
- `/help/friendly-management` — captain friendlies management guide
- `/help/internal-games` — internal games help
- `/help/invite-games` — invite games help
- `/help/competitions` — competitions member guide
- `/help/competitions-admin` — competitions admin guide
- `/help/handicaps` — handicap system guide
- `/help/rowland` — Rowland Cup guide
- `/help/leagues` — leagues member guide
- `/help/leagues-admin` — league organiser guide
- `/help/fixtures-admin` — fixtures management guide (Captain)
- `/help/banking` — banking guide (Treasurer)
- `/help/send-emails` — bulk email guide (Admin)
- `/help/cleaning-rota-admin` — cleaning rota admin guide
- `/help/tea-rota-admin` — tea rota admin guide
- `/help/buddy` — buddy system guide
- `/help/lookups` — member lookup guide
- `/help/data-export` — data export guide (Admin)
- `/help/club` — club portal guide (Club role)
- `/help/club-admin` — club admin guide (committee)
- `/help/member-suggestions-admin` — suggestions admin guide
