# Friendly Game Token Authentication — Full Implementation Spec

> Target codebase: BHBC Membership Portal (Next.js 14/15, App Router, TypeScript, Google Sheets, Nodemailer)
> Read `CODING_STANDARDS.md`, `CLAUDE.md`, `SCHEMA.md`, and `PROJECT_OVERVIEW.md` before implementing anything.
> Every rule in those documents applies here without exception.

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Schema Changes](#2-schema-changes)
3. [Data Layer](#3-data-layer)
4. [API Routes](#4-api-routes)
5. [Email Changes](#5-email-changes)
6. [Page Changes](#6-page-changes)
7. [Component Changes](#7-component-changes)
8. [Build Order](#8-build-order)
9. [Codebase Alignment Check](#9-codebase-alignment-check)

---

## 1. Feature Overview

Every email sent to a player about a friendly game includes a unique token in the game URL. The token is stored on the player's own row in the per-game tab and generated lazily — only when an email is about to be sent.

When a player clicks the link in their email they land on the existing game view page. If they are already logged in, the session takes full precedence and they experience no change from the current behaviour. If they are not logged in but carry a valid token, they receive an enhanced view of the game with full player names and appropriate action buttons, but with a restricted navigation bar showing only the BHBC logo and a Login button.

The game view page — whether accessed by a logged-in member, a token-authenticated member, or an unauthenticated visitor — always shows confirmation and acknowledgement status columns alongside each selected player. This ensures the captain of the day, who does not have the Captain role and cannot access the manage page, can see who has confirmed their attendance or acknowledged a cancellation.

### Auth Hierarchy on the Game Page

| Situation | Names shown | Action buttons | Navigation |
|---|---|---|---|
| Logged-in session | Full names | Full functionality as now | Full nav |
| No session + valid token | Full names | Based on game status (see §1.1) | Logo + Login only |
| No session + no token | First names only | None | Full public nav |

### 1.1 Token Action Matrix

| Game status | Player situation | Available actions |
|---|---|---|
| Open (`O`) | Entered | View only |
| Allocating (`L`) | Entered | View only |
| Selecting (`X`) | Entered | View only |
| Published (`S`) | Selected / Reserve / Reserve Team (`Y`/`R`/`T`) — not confirmed | Confirm I'm Attending |
| Published (`S`) | Selected / Reserve / Reserve Team (`Y`/`R`/`T`) — confirmed | Withdraw |
| Published (`S`) | Selected / Reserve / Reserve Team (`Y`/`R`/`T`) — withdrawn | Re-confirm |
| Cancelled (`C`) | Any entered player — not acknowledged | I've noted the cancellation |
| Cancelled (`C`) | Any entered player — acknowledged | ✓ Noted (disabled, informational) |
| Played (`P`) | Any | View only |
| Abandoned (`A`) | Any | View only |

`'L'` (Allocating) is used only in paired-game flows. `'A'` (Abandoned) is a game that started but was not completed. Both are view-only for token visitors.

### 1.2 Confirmation and Acknowledgement Columns

Visible on the game view to **all** visitors regardless of auth state:

- **Confirmed** column — shows each selected player's confirmation status. Values: `✓ Confirmed`, `Withdrawn`, or blank (not yet responded). Only shown when game status is `S` (Published).
- **Acknowledged** column — shows whether each entered player has acknowledged the cancellation. Values: `✓ Noted` or blank. Only shown when game status is `C` (Cancelled).

Also shown on the manage page for completeness.

### 1.3 Token Validity

Tokens are valid until the game date. Once the game date has passed the token is expired and the page falls back to the standard unauthenticated view (first names, no actions).

### 1.4 Withdrawal Captain Notification

When a player withdraws via a token link (not logged in), the captain receives a notification email. This mirrors the existing withdrawal notification behaviour for logged-in members.

---

## 2. Schema Changes

### 2.1 Per-Game Player Tab — Two New Columns

Two columns are added to every per-game player tab (the dynamic per-game sheets in the Friendlies spreadsheet, e.g. `West Hoathly 25-Sep`).

| Column header (exact) | Normalised key | Type | Notes |
|---|---|---|---|
| `Token` | `token` | String | 64-char hex. Generated lazily on first email send. Blank until then. |
| `Acknowledged Cancellation` | `acknowledged_cancellation` | String | `Y` or blank. Set when player acknowledges a cancellation. |

**Lazy column creation:** These columns do not need to exist on every tab from day one. The data layer functions that read or write these columns must check whether the column exists in the column map for that tab. If `token` is absent when `ensurePlayerToken` is called, the function appends the `Token` header to the header row at the next available column position, then writes the token value for the relevant player row. The same pattern applies to `Acknowledged Cancellation`. The column map cache must be cleared after adding a new column header so subsequent reads pick it up.

**Existing tabs** (created before this feature) are handled automatically by the lazy creation logic. No migration script is needed.

---

## 3. Data Layer

All new functions go in `src/lib/friendlies-sheets.ts` alongside the existing data layer for friendlies. Follow all existing patterns in that file — column map usage, retry wrapper, env var getters.

### 3.1 `ensurePlayerToken`

```typescript
// Ensures a 64-char hex token exists for the given player on the given game tab.
// If the Token column does not exist on the tab, creates the column header first.
// If the player's token cell is blank, generates a new token using
// crypto.randomBytes(32).toString('hex') and writes it to the sheet.
// If the player already has a token, returns it unchanged.
// Returns the token string.
export async function ensurePlayerToken(
  tabName: string,
  userName: string
): Promise<string>
```

Implementation notes:
- Use `getColumnMap(tabName, getFriendliesSpreadsheetId())` to get the current column map
- If `colMap['token']` is undefined: append `Token` as a new header at `getColumnLetter(Object.keys(colMap).length)` in row 1, then call `clearColumnMapCache()` and re-fetch the map
- Find the player's row by matching `user_name` column — use an explicit `for` loop, not `.find()`
- If player row not found → throw with a descriptive error message
- If token cell is blank: generate token, write to sheet, return it
- If token cell already has a value: return it as-is

---

### 3.2 `validateGameToken`

```typescript
// Validates a token against the per-game tab.
// Returns player row data if valid, null if not.
// A token is invalid if: not found in any row, OR the game date is in the past.
// The game date is read from the Games sheet (not the tab itself).
export async function validateGameToken(
  tabName: string,
  token: string
): Promise<{
  userName: string;
  rowNumber: number;                 // 1-based row index in the tab; required by updateGameSheet
  playerSelected: string;            // Y, R, T, O, or blank
  playerConfirmation: string;        // Y, W, or blank
  playerTeam: number | null;         // team number; required by sendWithdrawalEmail
  playerPosition: string;            // S/1/2/3 or blank; required by sendWithdrawalEmail
  acknowledgedCancellation: string;  // Y or blank
  gameStatus: string;                // from Games sheet
  gameDate: string;                  // DD/MM/YYYY from Games sheet
} | null>
```

Implementation notes:
- Fetch the per-game tab rows and column map
- Iterate rows with an explicit `for` loop to find the row where `token` column value matches; capture the loop index as `rowNumber` (add 2: +1 for 0-based index, +1 for header row)
- If not found → return null
- Fetch the game record from the Games sheet to get `game_date` and `status`
- Parse the game date using `parseNormalizedDate()` from `date-utils.ts` — never use `new Date()` directly on a Sheets date string
- If game date is in the past → return null (token expired)
- Return the player data object including `rowNumber`, `playerTeam`, and `playerPosition`

---

### 3.3 `acknowledgeGameCancellation`

```typescript
// Sets acknowledged_cancellation = 'Y' for the given player on the given game tab.
// If the Acknowledged Cancellation column does not exist, creates it first
// (same lazy creation pattern as ensurePlayerToken).
// Used by both token-authenticated and session-authenticated players.
export async function acknowledgeGameCancellation(
  tabName: string,
  userName: string
): Promise<void>
```

---

### 3.4 `getGameConfirmationStatus`

```typescript
// Returns confirmation and acknowledgement status for all players on a game tab.
// Used by the game view page to show the status columns to all visitors.
// Returns a map of userName → { playerConfirmation, acknowledgedCancellation }.
// If the Token or Acknowledged Cancellation columns do not exist on the tab,
// returns empty strings for those fields rather than throwing.
export async function getGameConfirmationStatus(
  tabName: string
): Promise<Record<string, {
  playerConfirmation: string;
  acknowledgedCancellation: string;
}>>
```

---

## 4. API Routes

All public routes (no auth required) must have in-memory rate limiting per `CODING_STANDARDS.md §27`. All routes follow the standard template from `CODING_STANDARDS.md §7`.

### 4.1 `GET /api/friendlies/game/[tabDate]/validate-token`

**File:** `app/api/friendlies/game/[tabDate]/validate-token/route.ts`

Auth: none — public endpoint. Rate limit: 30 requests per minute per IP.
Query param: `token` (required) → 400 if missing.

Steps:
1. `tabDate` in this codebase IS the `tabName` (e.g. `"West Hoathly 25-Sep"`). The URL param is misleadingly named. Resolve the game record by matching `tabDate === game.tabName` against the Games sheet — the same pattern used by the existing game detail route.
2. Call `validateGameToken(tabName, token)`
3. If null → return `{ valid: false }` with status 200 (do not return 401 — reveals nothing to a brute-force attacker)
4. Return `{ valid: true, playerSelected, playerConfirmation, acknowledgedCancellation, gameStatus, gameDate }`

Do **not** return `userName`, `rowNumber`, `playerTeam`, or `playerPosition` in the response — the client does not need them from this endpoint.

---

### 4.2 `POST /api/friendlies/game/[tabDate]/token-action`

**File:** `app/api/friendlies/game/[tabDate]/token-action/route.ts`

Auth: none — public endpoint. Rate limit: 10 requests per 5 minutes per IP.
Body: `{ token: string, action: 'confirm' | 'withdraw' | 'acknowledge' }`

Validation:
- `token` required, non-empty
- `action` must be one of the three valid values → 400 otherwise

Steps:
1. `tabDate` IS the `tabName` — use it directly (see note in §4.1).
2. Call `validateGameToken(tabName, token)` → if null return 401 `{ error: 'Invalid or expired link' }`
3. Check game status is appropriate for the requested action (use the matrix in §1.1) → 400 if not
4. Execute the action:
   - **confirm**: call `updateGameSheet(tabName, [{ rowNumber: tokenData.rowNumber, status: 'Y' }])`. `updateGameSheet` is the existing generic function — there is no dedicated `updatePlayerConfirmation`.
   - **withdraw**: call `updateGameSheet(tabName, [{ rowNumber: tokenData.rowNumber, status: 'W' }])`; then send the captain withdrawal notification email using `tokenData.userName`, `tokenData.playerSelected`, `tokenData.playerTeam`, and `tokenData.playerPosition` (see §5.2).
   - **acknowledge**: call `acknowledgeGameCancellation(tabName, tokenData.userName)`
5. Return `{ success: true }`

For withdraw — email failure must not block the 200 response. Log the error and continue.

---

### 4.3 `POST /api/friendlies/acknowledge`

**File:** `app/api/friendlies/acknowledge/route.ts`

Auth: any logged-in member (session required).
Body: `{ tabDate: string }`

Validation: `tabDate` required.

Steps:
1. `tabDate` IS the `tabName` — use it directly (see note in §4.1).
2. Verify the calling user (`session.user.userName`) is in the player list for this game → 403 if not
3. Call `acknowledgeGameCancellation(tabName, session.user.userName)`
4. Return `{ success: true }`

---

## 5. Email Changes

### 5.1 Adding Tokens to Existing Emails

The following existing email-sending functions in `src/lib/email/friendlies.ts` (or wherever the friendly email logic lives — check the actual file before editing) must be updated to include a token URL.

For each player recipient, before building the email:
1. Call `ensurePlayerToken(tabName, userName)` to get (or lazily create) the player's token
2. Build the game URL as: `${appUrl}/friendlies/game/${tabDate}?token=${token}` — existing functions receive `appUrl` as a parameter; use that rather than reading `process.env.NEXTAUTH_URL` directly
3. Pass this URL into the email HTML (existing functions build HTML inline via template literals — there are no separate `.html` template files)

**Emails to update:**
- **Entry Confirmed** (`sendEntryConfirmedEmail`) — single recipient; call `ensurePlayerToken` once before building the HTML
- **Selection Published / Updated** (`sendGamePublishedEmail`, called with `isRepublish = true` for updates) — iterates a players array; call `ensurePlayerToken` inside the existing player loop, before building each player's email
- **Cancellation** (`sendGameCancelledEmail`) — see §5.3 for the tea rota split required here

**Important:** `ensurePlayerToken` makes a Sheets write on first call. Do not call it inside a `Promise.all()`. Call it sequentially for each player before sending their email. Use the pooled transporter pattern already established in this codebase for bulk sends.

---

### 5.2 Captain Withdrawal Notification (Token-Triggered)

When a player withdraws via token (not logged in), the captain must be notified. The existing function is `sendWithdrawalEmail(userName, game, selection, appUrl)` in `src/lib/email/friendlies.ts`. Reuse it rather than creating a new template.

`sendWithdrawalEmail` requires a `selection` object: `{ selected, team, position }`. These are available from `validateGameToken` as `tokenData.playerSelected`, `tokenData.playerTeam`, and `tokenData.playerPosition` — this is why `validateGameToken` must return those fields (see §3.2).

The notification should clearly indicate that the withdrawal was submitted via email link (not via the portal). Add a `viaToken?: boolean` parameter to `sendWithdrawalEmail` and include a conditional line in the email HTML: *"This withdrawal was submitted via their email link."* when `viaToken` is true. The existing call site (logged-in withdrawal) does not pass `viaToken`, so it defaults to `false` and the message does not appear — no change to existing behaviour.

---

### 5.3 Cancellation Email — Token Link and Acknowledge CTA

The cancellation email HTML is built inline inside `sendGameCancelledEmail()` using template literals — there is no separate `.html` file. Edit that inline HTML directly.

Add the following to the player-recipient email HTML:
- A prominent CTA button: **"I've noted the cancellation"** — links to the player's token URL
- A note beneath the button: *"Clicking this button lets the captain know you've seen this message."*

**Tea rota split — required signature change:** `sendGameCancelledEmail` currently takes a single flat players array. Tea rota members (home games only) must not receive a token link. Restructure the function signature to accept two separate arrays:

```typescript
async function sendGameCancelledEmail(
  game: Game,
  players: Array<{ userName: string; fullName: string; email: string | null }>,
  teaRotaMembers: Array<{ fullName: string; email: string | null }>,  // new — no token
  appUrl: string,
  reason?: string
): Promise<{ success: boolean; emailsSent: number; playersWithoutEmail: string[]; error?: string }>
```

Update the single existing call site to pass the two arrays separately. For `players`, call `ensurePlayerToken` and build the token URL for each recipient before sending. For `teaRotaMembers`, send the existing email HTML unchanged (no token URL, no CTA button).

---

## 6. Page Changes

### 6.1 `/friendlies/game/[tabDate]` — Token-Aware Game View

**File:** `app/friendlies/game/[tabDate]/page.tsx`

This page already exists. The following changes are required.

#### Token Detection and Validation

The page is a client component (or must become one if it is not already). On mount:

> **Note on existing URL parameters:** Current game emails include a `?me=username` parameter in the game URL. Check the existing page to see whether it reads this parameter — if it does, the token URL (`?token=...`) must coexist with it, or you must confirm `?me=` is no longer used before removing it. Do not silently drop an in-use parameter.

1. Read `token` from `useSearchParams()`
2. Check `useSession()` — if the user has an active session, **skip all token logic entirely**. Session always takes precedence.
3. If no session and `token` is present: call `GET /api/friendlies/game/[tabDate]/validate-token?token=<token>`
4. Store the result in local state: `tokenPlayer` (the validated player data, or null if invalid)
5. Show a loading state while validation is in progress — do not flash the unauthenticated view first

```typescript
// Track token authentication state
const [tokenPlayer, setTokenPlayer] = useState<TokenPlayerState | null>(null);
const [tokenValidating, setTokenValidating] = useState(false);

// TokenPlayerState shape:
interface TokenPlayerState {
  playerSelected: string;
  playerConfirmation: string;
  acknowledgedCancellation: string;
  gameStatus: string;
}
```

#### Confirmation and Acknowledgement Status Columns

These columns are shown to **all** visitors regardless of auth state. Update the player list rendering to include:

- When game status is `S` (Published): add a **Confirmed** column showing each player's confirmation status. Values: `✓ Confirmed` (green badge), `Withdrawn` (red badge), or `—` (blank).
- When game status is `C` (Cancelled): add an **Acknowledged** column showing `✓ Noted` (green badge) or `—` (blank).

The confirmation/acknowledgement data comes from `getGameConfirmationStatus` — this must be called server-side or fetched via the existing game detail API route. Check the existing API route response shape before adding new fields. If the existing route already returns player data including the `status` (confirmation) column, extend it to also return `acknowledgedCancellation`. Add these fields to the existing API response rather than making a separate API call.

#### Action Buttons (Token Mode Only)

When `tokenPlayer` is set (token validated, no session), show action buttons based on the matrix in §1.1.

All action buttons call `POST /api/friendlies/game/[tabDate]/token-action` with `{ token, action }`.

Show success/error feedback inline. On successful confirm or withdraw, refresh the game data so the status column updates. Do not redirect.

**Confirm button:** primary style, `getButtonClasses('primary', 'md')`
**Withdraw button:** danger style, `getButtonClasses('danger', 'md')` — preceded by a `<ConfirmDialog>` ("Are you sure you want to withdraw? The captain will be notified.")
**Acknowledge button:** success style, `getButtonClasses('success', 'md')` — once clicked, replace with `✓ Cancellation noted` disabled state.

#### Acknowledge Button (Session Mode)

When the user is logged in and the game is cancelled and the player is in the squad: show the same Acknowledge button. On click, call `POST /api/friendlies/acknowledge` with `{ tabDate }`. Same inline feedback pattern.

The button state (already acknowledged or not) is determined by the `acknowledgedCancellation` value returned in the game data for the logged-in user's own row.

#### Name Display

- If `tokenPlayer` is set OR session is active: show full player names
- If neither: show first names only (existing behaviour — do not change)

---

### 6.2 `/friendlies/manage/game/[tabDate]` — Manage Page Acknowledgement Column

**File:** `app/friendlies/manage/game/[tabDate]/page.tsx`

This page already exists. One addition required:

When game status is `C` (Cancelled): add an **Acknowledged** column to the player list table. Shows `✓ Noted` (green badge) or `Pending` (amber badge) for each player. Captain can see at a glance who still needs chasing.

The `acknowledgedCancellation` value per player must be included in the data returned by the existing manage game API route. Check `GET /api/friendlies/manage/game/[tabDate]` — if it already returns player row data, add `acknowledgedCancellation` to the player object shape. If it does not, extend the route and data layer to include it.

---

## 7. Component Changes

### 7.1 `Navbar.tsx`

**File:** `src/components/Navbar.tsx`

The Navbar must render in a restricted mode when the user is not logged in but a `token` query parameter is present in the URL.

In restricted mode:
- Show BHBC logo (left side, same as normal)
- Show a single **Login** button (right side, `getButtonClasses('primary', 'sm')`)
- Hide all navigation links
- Hide all other controls (impersonation, settings, etc.)

Implementation:

`Navbar.tsx` is already a `'use client'` component. It does **not** currently use `useSearchParams()`. Do not add `useSearchParams()` to Navbar — instead, pass `isTokenMode` as a new optional prop. The game view page (§6.1) is already a client component reading `useSearchParams()` and computing this value; pass it down:

```typescript
// In Navbar.tsx — add to props interface
isTokenMode?: boolean;

// In the game view page — pass to Navbar
<Navbar isTokenMode={!session && !!searchParams.get('token')} ... />
```

This avoids adding a `useSearchParams()` call (and its Suspense requirements) to a component that is rendered in many places across the app.

If `isTokenMode` is true, render the restricted layout. Otherwise render the existing layout unchanged.

The Login button in restricted mode links to `/login` with a `callbackUrl` set to the current page path (so the player lands back on the game page after logging in):

```typescript
// Build login URL that returns the player to the current game page after login
const loginUrl = `/login?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`;
```

**Important:** Do not change any existing Navbar behaviour. The restricted mode is purely additive — it only activates in the specific condition described above.

---

## 8. Build Order

Implement in this order:

1. **Schema** — identify the per-game tab column structure in the live codebase (see §9 first), understand how new columns have been added previously, confirm the lazy creation approach works with the existing column map infrastructure
2. **Data layer** — add all four new functions to `src/lib/friendlies-sheets.ts`
3. **Validate-token route** — `GET /api/friendlies/game/[tabDate]/validate-token`
4. **Token-action route** — `POST /api/friendlies/game/[tabDate]/token-action`
5. **Acknowledge route** — `POST /api/friendlies/acknowledge`
6. **Email changes** — update existing email functions to include token URLs; update cancellation template; add/reuse withdrawal notification
7. **Game view page** — token detection, validation, action buttons, status columns
8. **Manage page** — acknowledgement column
9. **Navbar** — restricted mode
10. **Version bump** — `npm run release:minor`

---

## 9. Codebase Alignment Check

The following questions were checked against the live codebase. Answers are recorded here so they do not need re-checking during implementation. Verify only if significant time has passed since this spec was last updated.

1. **Existing email functions** — **Resolved.** Logic lives in `src/lib/email/friendlies.ts`. Function names: `sendEntryConfirmedEmail`, `sendGamePublishedEmail` (pass `isRepublish = true` for updates), `sendGameCancelledEmail`. All accept `appUrl` (not `gameUrl`) as a parameter; token URLs must be built using that variable. No per-player game URL exists yet — add it per §5.1.

2. **Cancellation email** — **Resolved.** There is no `.html` template file. The email HTML is built inline via template literals inside `sendGameCancelledEmail()`. Edit that inline HTML directly per §5.3. The function currently accepts a single flat player array; it must be split into `players` + `teaRotaMembers` per §5.3.

3. **Withdrawal notification** — **Resolved.** `sendWithdrawalEmail(userName, game, selection, appUrl)` exists in `src/lib/email/friendlies.ts`. Reuse it. Add an optional `viaToken?: boolean` param and a conditional line in the email HTML per §5.2.

4. **Game detail API route** — **Resolved.** `GET /api/friendlies/game/[tabDate]` already returns `status` (confirmation: `Y`/`W`/blank) per player. It does **not** return `acknowledgedCancellation`. Extend the existing response shape to include it — do not create a parallel data fetch.

5. **Manage game API route** — **Resolved.** `GET /api/friendlies/manage/game/[tabDate]` already returns `status` per player. It does **not** return `acknowledgedCancellation`. Extend it the same way.

6. **Per-game tab column structure** — **Resolved.** `createGameColumn()` in `src/lib/friendlies-sheets.ts` adds a new column to the **Players sheet** (the main tracking tab), not to individual per-game tabs. Lazy column creation for `Token` and `Acknowledged Cancellation` on per-game tabs is an entirely separate mechanism and does not conflict with it. `getColumnMap`, `clearColumnMapCache`, and `getColumnLetter` are all already available in `friendlies-sheets.ts`.

7. **Existing confirm/withdraw functions** — **Resolved.** There is no dedicated confirm or withdraw function. Use `updateGameSheet(tabName, [{ rowNumber, status: 'Y' }])` for confirm and `status: 'W'` for withdraw. `rowNumber` must come from `validateGameToken` — see §3.2.

8. **Navbar structure** — **Resolved.** `Navbar.tsx` is already `'use client'`. It does **not** use `useSearchParams()` and is **not** rendered in the root layout — it is imported per-page. Do not add `useSearchParams()` to it. Pass `isTokenMode` as a prop from the game view page per §7.1.

9. **Game status codes** — **Resolved.** Live type is `'' | 'O' | 'L' | 'X' | 'S' | 'P' | 'C' | 'A'`. The spec's action matrix has been updated to include `'L'` (Allocating — view only) and `'A'` (Abandoned — view only). See §1.1.

10. **`tabDate` to `tabName` resolution** — **Resolved.** The URL parameter named `tabDate` actually contains the full `tabName` string (e.g. `"West Hoathly 25-Sep"`). No resolution step is needed — match it directly against `game.tabName` using a `for` loop, the same pattern used by the existing game detail route.

**If any of the above reveals a significant discrepancy with this spec, resolve it in favour of the live codebase. The spec describes intent — the codebase describes reality.**
