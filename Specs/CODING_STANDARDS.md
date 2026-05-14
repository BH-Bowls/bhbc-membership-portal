# BHBC Membership Portal - Coding Standards

> For context on **why** these rules exist and the gotchas behind them, see `CLAUDE.md` at the project root.

---

## 1. File Headers (MANDATORY)

Every file must start with a header comment containing:
1. Full file path relative to project root
2. Brief description of what the file does

```typescript
// app/api/friendlies/games/route.ts
// API endpoint to fetch all available games with optional status filtering

// src/lib/friendlies-sheets.ts
// Google Sheets operations for Friendlies system - handles all data access

// components/UserSelector.tsx
// Dropdown component for admins to select which user to manage
```

---

## 2. Comprehensive Comments (MANDATORY)

**Every code chunk must have a comment explaining what it does and why.**

### What Must Be Commented:

#### Every Function/Method
```typescript
// Get all games from the Games sheet with optional status filtering
export async function getGames(statusFilter?: GameStatus): Promise<Game[]> {
```

#### Every Loop
```typescript
// Loop through all data rows (skip header at index 0)
for (let i = 1; i < rows.length; i++) {

// Iterate backward through game columns to get last 8 games
for (let i = headers.length - 1; i >= 0 && last8Games.length < 8; i--) {
```

#### Every If Statement (Complex Logic)
```typescript
// Check if we have a cached column mapping for this sheet
if (columnMapCache[spreadsheetId]) {
  if (columnMapCache[spreadsheetId][sheetName]) {

// Only process games with Open or Selecting status
if (['O', 'X'].includes(game.status)) {

// Skip the current game when collecting history
if (currentGameTabName && header === currentGameTabName) continue;
```

#### Every API Call / External Operation
```typescript
// Fetch all rows from the Games sheet
const response = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: 'Games!A2:ZZ',
});

// Update the game status in column L
await sheets.spreadsheets.values.update({
  spreadsheetId,
  range: `Games!${statusCol}${game.rowNumber}`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [[newStatus]] },
});

// Verify user is logged in
const session = await getServerSession(authOptions);
```

#### Every Data Transformation
```typescript
// Extract game date from row
const date = get(row, 'date') || '';

// Convert percentage string "64%" to decimal 0.64
const numStr = percentPlayedVal.replace('%', '').trim();
const num = parseFloat(numStr);
percentPlayed = num > 1 ? num / 100 : num;

// Build list of fixed column indices that shouldn't be cleared
const fixedColumns = new Set<number>();
for (const name of fixedColumnNames) {
  const colIndex = colMap[name];
  if (colIndex !== undefined) {
    fixedColumns.add(colIndex);
  }
}
```

#### Every State Update (React Components)
```typescript
// Fetch game data and player list on page load
useEffect(() => {
  fetchGameData();
  fetchAvailablePlayers();
}, [tabDate]);

// Show loading indicator while fetching stats
setGettingStats(true);
```

#### Every Error Handler
```typescript
// Log error but don't fail the entire operation
try {
  const stats = getPlayerStatsFromCache(name, playersRows, playersColMap, playersHeaders, tabName);
  last8Games = stats.last8Games;
} catch (error) {
  // Player not found in Players sheet - skip game history
}
```

### Comment Content Guidelines

**Do Comment:**
- **What** the code does (in business terms)
- **Why** we're doing it (business logic, requirements)
- **Google Sheets specifics** (row numbers, column mappings, ranges)
- **Data transformations** (what format changes we're making)
- **Edge cases** (what happens when data is missing)
- **Business rules** (status transitions, validation rules)

**Don't Over-Explain:**
- Basic JavaScript syntax
- TypeScript types
- Standard React patterns
- Keep comments concise and meaningful

---

## 3. Avoid Modern Syntax - Use Explicit Code

### ❌ AVOID: Optional Chaining (`?.`)

**Bad:**
```typescript
if (columnMapCache[spreadsheetId]?.[sheetName]) {
```

**Good:**
```typescript
// Check if we have a cached column mapping for this spreadsheet
if (columnMapCache[spreadsheetId]) {
  // Check if we have the mapping for this specific sheet
  if (columnMapCache[spreadsheetId][sheetName]) {
```

### ❌ AVOID: Nullish Coalescing (`??`)

**Bad:**
```typescript
const nameColumn = colMap['full_name'] ?? colMap['name'];
const userNameCol = membersColMap['user_name'] ?? 0;
```

**Good:**
```typescript
// Try full_name column first, fall back to name column if not found
let nameColumn = colMap['full_name'];
if (nameColumn === undefined) {
  nameColumn = colMap['name'];
}

// Find user_name column, default to first column (index 0) if not found
let userNameCol = membersColMap['user_name'];
if (userNameCol === undefined) {
  userNameCol = 0;
}
```

### ❌ AVOID: Complex Array Method Chains

**Bad:**
```typescript
const fixedColumns = new Set(
  fixedColumnNames
    .map(name => colMap[name])
    .filter(idx => idx !== undefined)
);
```

**Good:**
```typescript
// Build set of column indices that should not be cleared (fixed columns)
const fixedColumns = new Set<number>();

// Loop through each fixed column name and get its index
for (const name of fixedColumnNames) {
  const colIndex = colMap[name];

  // Only add if column exists in this sheet
  if (colIndex !== undefined) {
    fixedColumns.add(colIndex);
  }
}
```

### ❌ AVOID: `.findIndex()`, `.find()`

**Bad:**
```typescript
const userRowIndex = rows.findIndex((row, index) =>
  index > 0 && row[userNameCol] === lookupValue
);
```

**Good:**
```typescript
// Find the row index for this user in the sheet
let userRowIndex = -1;

// Loop through data rows (skip header at index 0)
for (let i = 1; i < rows.length; i++) {
  // Check if this row matches the user we're looking for
  if (rows[i][userNameCol] === lookupValue) {
    userRowIndex = i;
    break;
  }
}
```

---

## 4. Google Sheets Specific Comments

Always comment Google Sheets operations with context:

```typescript
// Row 1 is header, data starts at row 2
const rowNumber = index + 2;

// Fetch from Members sheet to get buddy relationships
const membersResponse = await sheets.spreadsheets.values.get({
  spreadsheetId: getSpreadsheetId(),
  range: 'Members!A2:AZ',
});
```

---

## 5. Error Handling Comments

Always explain what errors mean and how they're handled:

```typescript
try {
  // Attempt to fetch user profile from Members sheet
  const profile = await getUserProfile(userName);
} catch (error) {
  // User not found in Members sheet - return default profile
  return getDefaultProfile();
}

try {
  // Try to update renewal status
  await updateRenewalPayment(userName, updates);
} catch (error) {
  // Log error but don't crash - user can retry
  console.error('Failed to update renewal:', error);
  throw new Error('Unable to save payment. Please try again.');
}
```

---

## 6. React Component Comments

Comment all React hooks and state updates:

```typescript
// Track loading state while fetching data
const [isLoading, setIsLoading] = useState(false);

// Store list of available games
const [games, setGames] = useState<Game[]>([]);

// Fetch games when component mounts
useEffect(() => {
  loadGames();
}, []);

// Reload games when status filter changes
useEffect(() => {
  if (statusFilter) {
    loadGames();
  }
}, [statusFilter]);

// Handle game selection and navigate to details page
const handleGameClick = (tabDate: string) => {
  // Navigate to game details page
  router.push(`/friendlies/game/${tabDate}`);
};
```

---

## 7. API Routes — Standard Template

Every API route follows this structure. Do not deviate from it.

```typescript
// app/api/friendlies/games/route.ts
// API endpoint to fetch all available games with optional status filtering

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';

export async function POST(request: NextRequest) {
  try {
    // 1. Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Check the user has the required role (omit this block for member-accessible routes)
    if (!hasRole(session.user.role, 'Admin', 'Captain')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 3. Parse and validate input
    const body = await request.json();
    const { userName, amount } = body;

    if (!userName || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: userName, amount' },
        { status: 400 }
      );
    }

    // 4. Execute business logic (call the data layer in src/lib/)
    await updateRenewalPayment(userName, { amount });

    // 5. Return success
    return NextResponse.json({ success: true });

  } catch (error) {
    // Log the full error server-side for debugging
    console.error('[POST /api/renewals/payment] Error:', error);

    // Return a generic message to the client — never expose internal details
    return NextResponse.json({ error: 'Failed to process payment' }, { status: 500 });
  }
}
```

### Standard HTTP status codes

| Code | When to use |
|------|-------------|
| 200 | Success (default for NextResponse.json) |
| 400 | Missing or invalid input from the client |
| 401 | No session — user is not logged in |
| 403 | Session exists but user lacks the required role |
| 404 | Requested record does not exist |
| 500 | Unexpected server error (catch block) |

### Response format

Always return JSON with a consistent shape:
- Success: `{ success: true }` or `{ success: true, data: ... }`
- Error: `{ error: 'Human-readable message' }`

Never return raw strings or mixed formats.

---


## 8. When using Google Sheets, always use Dynamic Columns.

Column names can be in English or snake_case, eg Member Name or member_name. Map to camelCase, eg memberName

---
## 9. Examples - Good vs Bad

### Example 1: Optional Chaining

**❌ Bad:**
```typescript
if (cache?.sheets?.[sheetName]?.data) {
  return cache.sheets[sheetName].data;
}
```

**✅ Good:**
```typescript
// Check if we have cached data for this sheet
if (cache) {
  if (cache.sheets) {
    if (cache.sheets[sheetName]) {
      if (cache.sheets[sheetName].data) {
        // Return cached data
        return cache.sheets[sheetName].data;
      }
    }
  }
}
```
## 10. Theme and Component Styling

All buttons, inputs, badges, alerts, nav items, and cards must use the helper functions from `src/config/theme-helpers.ts`. Never write bespoke Tailwind button or badge classes inline.

### Available helpers

```typescript
import { getButtonClasses, getInputClasses, getBadgeClasses,
         getAlertClasses, getCardClasses, getNavItemClasses,
         getLinkClasses } from '@/config/theme-helpers';
```

| Helper | Variants | Sizes |
|--------|----------|-------|
| `getButtonClasses(variant, size, fullWidth?)` | `primary` `secondary` `danger` `success` `text` | `sm` `md` `lg` |
| `getInputClasses(hasError?)` | — | — |
| `getBadgeClasses(variant, size?)` | `primary` `secondary` `success` `danger` `warning` | `sm` `md` `lg` |
| `getAlertClasses(variant)` | `info` `success` `warning` `danger` | — |
| `getCardClasses(padding?)` | — | `none` `sm` `md` `lg` |

**Examples:**
```tsx
<button className={getButtonClasses('primary', 'md')}>Save</button>
<button className={getButtonClasses('danger', 'sm')}>Delete</button>
<Link href="/..." className={getButtonClasses('secondary', 'md')}>Back</Link>
<span className={getBadgeClasses('success')}>Confirmed</span>
<div className={getAlertClasses('warning')}>Please note…</div>
```

### Changing the colour scheme

Update **both** files — they must stay in sync:
1. `src/config/theme.ts` — design token values (human reference)
2. `src/config/theme-helpers.ts` — literal Tailwind class strings (what the compiler sees)

---

## 11. Date Handling from Google Sheets

Google Sheets stores dates in DD/MM/YYYY format, which JavaScript's `new Date()` does NOT parse correctly.

Use the utility functions in `src/lib/date-utils.ts` — never use `new Date(dateStr)` directly on a Sheets date string.

| Function | Input | Use case |
|----------|-------|----------|
| `parseUKDate(str)` | Any format (DD/MM/YYYY, ISO, "Wed, 29 April") | Display and UI — handles messy inputs |
| `parseNormalizedDate(str)` | DD/MM/YYYY only | Backend sorting/comparison — faster, known format |
| `normalizeToUKDate(str)` | Any format | Normalise before writing back to Sheets |
| `formatGameDate(str, options?)` | DD/MM/YYYY | Format for display (default: "Wed, 29 Apr") |

```typescript
import { parseUKDate, parseNormalizedDate, normalizeToUKDate, formatGameDate } from '@/lib/date-utils';

// Display
formatGameDate(game.date); // "Wed, 29 Apr"
formatGameDate(game.date, { weekday: 'long', day: 'numeric', month: 'long' }); // "Wednesday, 29 April"

// Comparison / sorting (backend)
const a = parseNormalizedDate(row.date);
const b = parseNormalizedDate(other.date);
rows.sort((a, b) => parseNormalizedDate(a.date).getTime() - parseNormalizedDate(b.date).getTime());

// Normalise before writing to Sheets (handles any input format)
const normalised = normalizeToUKDate(rawDateString); // → "29/04/2026"
```

### When to Use Each

- **`parseUKDate`** — anywhere you receive a date string from user input, form fields, or mixed-format data
- **`parseNormalizedDate`** — backend data layer functions where dates are already in DD/MM/YYYY (fast path)
- **`normalizeToUKDate`** — before writing any date back to Google Sheets
- **`formatGameDate`** — anywhere you display a date to the user

### Example in Components

```tsx
{/* Date column in table */}
<td className="px-6 py-4 whitespace-nowrap text-sm">
  <div>{formatGameDate(game.date)}</div>
  <div className="text-gray-700">{game.time}</div>
</td>
```

---

## 12. Text Color and Accessibility

### The core rule: always pair a background with a text color

When you set a background colour on an element, always set a text colour on the same element (or its immediate wrapper). If you only set the background, the text colour is inherited from the page body. This causes invisible text whenever the device is in dark mode, because the body text colour becomes near-white — which is unreadable on a white or light-coloured background.

**❌ Bad — background set, no text colour:**
```tsx
<div className="bg-white rounded-lg shadow p-4">
  <p className="font-medium">{player.fullName}</p>
</div>

<tr className="bg-yellow-50">
  <td className="text-sm">{entry.date}</td>
</tr>

<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
  <h4 className="font-semibold">Instructions:</h4>
  <ul className="text-sm">...</ul>
</div>
```

**✅ Good — background and text colour always paired:**
```tsx
<div className="bg-white rounded-lg shadow p-4 text-gray-900">
  <p className="font-medium">{player.fullName}</p>
</div>

<tr className="bg-yellow-50 text-gray-900">
  <td className="text-sm">{entry.date}</td>
</tr>

<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
  <h4 className="font-semibold text-gray-900">Instructions:</h4>
  <ul className="text-sm text-gray-900">...</ul>
</div>
```

### Dark mode

`globals.css` must have `color-scheme: light` in `:root`. Do not add `@media (prefers-color-scheme: dark)` blocks.

```css
/* globals.css */
:root {
  color-scheme: light;
  --background: #ffffff;
  --foreground: #171717;
}
```

### Text colour scale

| Use | Class | Contrast on white |
|-----|-------|-------------------|
| Primary content, headings, names, data | `text-gray-900` | ✅ Passes WCAG AA |
| Secondary content, descriptions, hints | `text-gray-700` | ✅ Passes WCAG AA |
| Placeholder / disabled / truly decorative | `text-gray-500` | ⚠️ Fails WCAG AA — use sparingly |

**Avoid `text-gray-400`, `text-gray-500`, `text-gray-600` for any text a user needs to read.**

### Tables

Add `text-gray-900` to `<table>` or `<tbody>` rather than repeating it on every `<td>`. Cells with explicit colours (status badges, action buttons) override this naturally.

```tsx
{/* ✅ Set once on tbody, all cells inherit */}
<tbody className="bg-white divide-y divide-gray-200 text-gray-900">
  {rows.map(row => (
    <tr key={row.id}>
      <td className="px-4 py-3 text-sm">{row.name}</td>
      <td className="px-4 py-3 text-sm">{row.date}</td>
    </tr>
  ))}
</tbody>
```

### Print styles

Print-specific CSS goes in a single `@media print` block in `globals.css` — not as inline styles on individual components. Use `-webkit-print-color-adjust: exact; print-color-adjust: exact` on any element whose background colour must be preserved in print output (e.g., coloured header rows, highlight rows).

```css
/* globals.css */
@media print {
  nav { display: none !important; }

  /* Preserve highlight colours */
  .bg-yellow-100 {
    background-color: #fef9c3 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
```

---

## 13. Cloudinary (File Storage)

Cloudinary is used to store all uploaded files (images, PDFs, documents). The Google Sheets row stores metadata; Cloudinary holds the actual file.

### Environment variables

Three variables must be set in `.env.local`:
```
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

### All operations go through `src/lib/cloudinary.ts`

Never call the Cloudinary SDK directly from API routes. Use the four functions in `src/lib/cloudinary.ts`:

| Function | Purpose |
|----------|---------|
| `uploadFileToCloudinary(entityId, buffer, fileName, mimeType, folderPrefix?)` | Upload a file |
| `deleteFileFromCloudinary(publicId)` | Delete a file |
| `fetchFileFromCloudinary(publicId, resourceType?)` | Download a file (server-side proxy) |
| `checkFileExists(publicId)` | Check if a file still exists |

### Folder structure

Files are stored as: `{folderPrefix}/{entityId}/{cleanFileName}`

```
bhbc-suggestions/2026-001/meeting_notes.pdf
bhbc-invite-games/IG-2026-001/photo.jpg
```

The `folderPrefix` parameter defaults to `'bhbc-suggestions'`. Pass a different prefix for each feature:

```typescript
await uploadFileToCloudinary(suggestionId, buffer, file.name, mimeType, 'bhbc-suggestions');
await uploadFileToCloudinary(inviteGameId, buffer, file.name, mimeType, 'bhbc-invite-games');
```

### Resource types

Cloudinary uses three resource types. The upload function detects these automatically from the MIME type:

| MIME type | Cloudinary resource type |
|-----------|--------------------------|
| `image/*` | `image` |
| `video/*` | `video` |
| Everything else (PDFs, docs, etc.) | `raw` |

`raw` resources cannot be served directly from the CDN without authentication — always proxy them through your own API route (see below).

### File size limit

50MB maximum, enforced in `AttachmentUpload.tsx`. Do not change this without checking Cloudinary plan limits.

### Storing the reference in Google Sheets

The Cloudinary `publicId` is stored in the `drive_file_id` column. Do not rename this column.

```typescript
// Store after upload
const result = await uploadFileToCloudinary(...);
// result.publicId  → store in drive_file_id column
// result.secureUrl → store in url column (direct URL for images; proxied for raw)
// result.thumbnailUrl → 200px-wide version for image previews
```

### Serving files to the client (proxy pattern)

**Never give the client a direct Cloudinary URL for `raw` resources** — the CDN returns 401 for raw files without authentication. Always proxy through an API route:

```
GET /api/suggestions/{id}/attachments/{attachmentId}         → triggers download
GET /api/suggestions/{id}/attachments/{attachmentId}?inline=true → opens in browser
```

The API route calls `fetchFileFromCloudinary()` server-side and pipes the response back. This also hides Cloudinary credentials and public IDs from the client.

Images can use their direct `secureUrl` for display (thumbnails etc.) since image resources are publicly accessible from the CDN.

### Delete pattern

When deleting, try `image` resource type first, then `raw`. You may not know which type was used at upload time:

```typescript
// deleteFileFromCloudinary handles this automatically — just pass the publicId
await deleteFileFromCloudinary(attachment.driveFileId);
```

Attachments use a **soft delete** in the sheet (`is_deleted = TRUE`) as well as deleting the actual file from Cloudinary. Always do both.

### Reusable attachment components

For any feature that needs file attachments, use the two pre-built components rather than building from scratch:

```tsx
import { AttachmentUpload } from '@/components/AttachmentUpload';
import { AttachmentsList } from '@/components/AttachmentsList';

// apiBasePath must have these endpoints:
//   POST   {apiBasePath}/attachments         — upload
//   DELETE {apiBasePath}/attachments/{id}    — delete
//   GET    {apiBasePath}/attachments/{id}    — serve/download

<AttachmentsList
  apiBasePath="/api/suggestions/2026-001"
  attachments={attachments}
  canDelete={isAdmin}
  onDelete={refreshAttachments}
/>

<AttachmentUpload
  apiBasePath="/api/suggestions/2026-001"
  onUploadComplete={refreshAttachments}
  onCancel={() => setShowUpload(false)}
/>
```

The `Attachment` type is in `src/types/attachments.ts`. Entity-specific types (`SuggestionAttachment`, `InviteGameAttachment`, `LeagueAttachment`) extend it with their own ID field.

---

## 14. Email (Gmail / SMTP)

Email is sent via Gmail SMTP using nodemailer. All email functions are in `src/lib/email/`.

### Environment variables

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=youraddress@gmail.com
SMTP_PASSWORD=your-gmail-app-password   # App Password, not your account password
```

### Always check configuration first

Before attempting to send, call `isEmailConfigured()`. If it returns false, return a graceful error — do not throw.

```typescript
import { isEmailConfigured, getEmailTransporter } from '@/lib/email/mailer';

if (!isEmailConfigured()) {
  return { success: false, error: 'Email service not configured' };
}
```

### Single email sends

Use the helper functions — never construct a transporter directly for a single send:

```typescript
import { sendTemplateEmail, sendEmail, sendEmailWithAttachments } from '@/lib/email/mailer';

// Handlebars template from src/lib/email/templates/
await sendTemplateEmail(to, subject, 'template-name', { userName, gameDate });

// Ad-hoc email (no template file)
await sendEmail(to, subject, plainText, htmlContent);

// Email with file attachments (e.g. PDF)
await sendEmailWithAttachments(to, subject, html, [{ filename: 'doc.pdf', content: buffer }]);
```

All three return `{ success: boolean; error?: string }`. Check the result — never assume success.

### Bulk sends (multiple recipients)

**Never use `Promise.all()` to send emails in parallel.** Use a pooled transporter and send sequentially:

**❌ Wrong:**
```typescript
await Promise.all(players.map(player =>
  sendEmail(player.email, subject, text, html)
));
```

**✅ Correct:**
```typescript
// Get a pooled transporter (maxConnections: 1, connection stays alive between sends)
const transporter = getEmailTransporter(true);

for (const player of players) {
  try {
    await transporter.sendMail({
      from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
      to: player.email,
      subject,
      text,
      html,
    });
  } catch (err) {
    // Log individual failure but continue sending to others
    console.error(`Failed to send to ${player.fullName}:`, err);
  }
}

// Always close the pooled connection when done
transporter.close();
```

The pooled transporter (`usePool: true`) reuses a single SMTP connection for all sends.

### Sending to a group (where recipients know each other)

For small groups who should see each other's addresses (e.g. tea rota members), use a single email with a comma-separated `To:` rather than individual sends:

```typescript
const toList = members.map(m => m.email).join(', ');
await transporter.sendMail({ from: ..., to: toList, subject, text, html });
```

### Email templates

Templates are Handlebars `.html` files in `src/lib/email/templates/`. The subject line is embedded as an HTML comment at the top of the template and extracted at send time:

```html
<!-- Subject: Team Selection Published - {{clubName}} {{gameDate}} -->
<!DOCTYPE html>
<html>...
```

Template variables available automatically (no need to pass them): `BRAND_NAME`, `BRAND_SHORT_NAME`, `HEADER_COLOR`, `BUTTON_COLOR`.

### Email failures must not block the main operation

If sending fails, log it and return a graceful result. Never let an email failure propagate as an unhandled exception that would roll back a save or return a 500 to the user.

```typescript
const emailResult = await sendTemplateEmail(...);
if (!emailResult.success) {
  // Log but continue — the data was already saved
  console.error('Email send failed:', emailResult.error);
}
return NextResponse.json({ success: true, emailsSent: emailResult.success ? 1 : 0 });
```

---

## 15. Role Checking

Use the helpers in `src/lib/role-utils.ts`. Never check `session.user.role` directly with string comparison — roles are comma-separated and must be parsed correctly.

```typescript
import { hasRole, isCommitteeMember, isMember } from '@/lib/role-utils';

// Check for one or more specific roles
if (hasRole(session.user.role, 'Admin')) { ... }
if (hasRole(session.user.role, 'Admin', 'Captain')) { ... }  // either role passes

// Committee = Captain, Treasurer, GMC, Admin (NOT RowlandOrganiser)
if (isCommitteeMember(session.user.role)) { ... }

// Regular member (no roles assigned)
if (isMember(session.user.role)) { ... }
```

**Role reference:**

| Role | Meaning |
|------|---------|
| *(empty string)* | Regular member |
| `Captain` | Friendly match captain |
| `Treasurer` | Club treasurer |
| `GMC` | General Management Committee |
| `Admin` | Full system administrator |
| `RowlandOrganiser` | Rowland competition organiser |
| `RowlandPlayer` | Rowland competition participant |
| `Club` | External club account (not a member) |
| `Kiosk` | Kiosk mode (simplified UI, no settings) |

Multiple roles are stored as comma-separated strings: `"Captain,RowlandOrganiser"`. The `hasRole()` function handles this automatically.

---

## 16. Session and Authentication

### In API routes (server-side)

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const session = await getServerSession(authOptions);
if (!session?.user?.userName) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

### In client components

```typescript
import { useSession } from 'next-auth/react';

const { data: session } = useSession();
const userName = session?.user?.userName;
const userRole = session?.user?.role ?? '';
```

### Session shape

```typescript
session.user.userName        // string  — unique login name
session.user.name            // string  — display name (full known-as)
session.user.role            // string  — raw role string, may be comma-separated
session.user.roles           // string[] — pre-parsed array of roles
session.user.email           // string  — email address
session.user.isImpersonating // boolean — true if an admin is viewing as another user
session.user.originalAdmin   // string | undefined — admin's userName when impersonating
session.user.mustChangePassword // boolean — true if user must change password on next login
```

### Impersonation

When `isImpersonating` is true, `session.user.userName` is the **target user** (the member being viewed), and `session.user.originalAdmin` is the real admin. Always use `session.user.userName` for data operations — the impersonation layer handles this transparently.

---

## 17. Displaying Errors and Success Messages

There is no global toast library. Each component manages its own feedback state.

### Inline error state (most common)

```typescript
const [error, setError] = useState<string | null>(null);

// In JSX:
{error && (
  <div className={getAlertClasses('danger')}>{error}</div>
)}
```

### Auto-dismissing toast (for non-critical confirmations)

```typescript
const [toast, setToast] = useState<string | null>(null);

// Dismiss after 4 seconds
useEffect(() => {
  if (!toast) return;
  const timer = setTimeout(() => setToast(null), 4000);
  return () => clearTimeout(timer);
}, [toast]);

// Trigger: setToast('File deleted successfully');

// In JSX:
{toast && (
  <div className={getAlertClasses('success')}>{toast}</div>
)}
```

### When to use what

| Situation | Use |
|-----------|-----|
| Form validation errors | Inline error state near the field |
| API call failures | Inline error state at the top of the form |
| Successful save/delete | Auto-dismiss toast |
| Destructive action requiring confirmation | `<ConfirmDialog>` component |
| Simple one-off error | `alert()` — avoid, use inline state instead |

---

## 18. Navigation

### Back links

Use `<RouterBackLink>` instead of a plain `<Link>` for back navigation. It uses `router.back()` when browser history exists (normal in-app flow) and falls back to a hardcoded href when the page was opened directly (e.g. from an email link).

```tsx
import { RouterBackLink } from '@/components/RouterBackLink';

<RouterBackLink fallbackHref="/friendlies/manage" label="Back to Manage Games" />
```

### Programmatic navigation

```typescript
import { useRouter } from 'next/navigation';
const router = useRouter();

router.push('/friendlies/manage');  // navigate forward
router.back();                       // browser back (only if history exists)
```

### Phone back-button interception

In PWA mode, the phone's back button can exit the app unintentionally. Pages that sit deep in a navigation stack should use the `usePhoneBackNavigation` hook:

```typescript
import { usePhoneBackNavigation } from '@/hooks/usePhoneBackNavigation';

// Intercepts the popstate event and pushes the user to the specified route instead
usePhoneBackNavigation('/friendlies/manage');
```

---

## 19. Form Drafts (Unsaved Changes Protection)

Use the utilities in `src/lib/form-draft-utils.ts` to preserve form state across accidental navigation.

```typescript
import { saveDraft, restoreDraft, clearDraft } from '@/lib/form-draft-utils';

const FORM_NAME = 'Profile';  // unique identifier for this form

// Save whenever the user changes something
saveDraft(FORM_NAME, session.user.userName, formData);

// Restore on page load (returns null if no draft or draft is older than 7 days)
const draft = restoreDraft<ProfileFormData>(FORM_NAME, session.user.userName);
if (draft) {
  setFormData(draft);
}

// Clear after successful save
clearDraft(FORM_NAME, session.user.userName);
```

Draft keys are namespaced by form name and username: `FormDraft-Profile-jsmith`. Drafts older than 7 days are automatically discarded.

### Full edit-mode pages: use `useEditMode`

For pages that have a dedicated Edit / Save / Cancel mode (rather than an inline form), use the `useEditMode` hook (`src/hooks/useEditMode.ts`) instead of wiring up draft logic manually. It provides:

- `isEditing`, `hasChanges`, `isSaving` — state flags
- `editedData`, `updateData(data)` — managed edit buffer
- `startEditing()`, `handleSave()`, `handleCancel()` — actions
- `getNavbarActions()` — returns navbar button config (Edit button when idle, Save + Cancel when editing)
- Auto-saves draft to `sessionStorage` while editing; clears it on save or cancel

```typescript
import { useEditMode } from '@/hooks/useEditMode';

const { isEditing, editedData, isSaving, hasChanges, updateData, getNavbarActions } = useEditMode({
  draftKey: 'FriendliesGame-13Jan25',  // unique per page instance
  initialData: gameData,
  onSave: async (data) => {
    const res = await fetch('/api/friendlies/game', { method: 'PUT', body: JSON.stringify(data) });
    return res.ok;
  },
});

// Pass to navbar
<Navbar actions={getNavbarActions()} />
```

---

## 20. Environment Variable Getters

Never read `process.env` inline inside data-layer functions or API routes. Instead, define a named getter for each environment variable in `src/lib/sheets.ts` (or the relevant library file). Each getter throws a clear error message if the variable is missing.

```typescript
// ✅ GOOD — lazy getter, throws with a helpful message
export function getSpreadsheetId(): string {
  const id = process.env.MEMBERS_SPREADSHEET_ID;
  if (!id) {
    throw new Error('MEMBERS_SPREADSHEET_ID environment variable is not set. Check your .env.local file.');
  }
  return id;
}

// Usage in data-layer function:
const sheets = await getGoogleSheetsClient();
const spreadsheetId = getSpreadsheetId(); // throws immediately if not configured
```

**Convention:** One getter per spreadsheet / integration, grouped at the top of the file. All getters are exported.

---

## 21. Google Sheets — Always Use the Data Layer

Always call data-layer functions in `src/lib/` rather than calling the Sheets SDK directly. Never call `spreadsheets.values.get()` from an API route or page.

```typescript
// ✅ GOOD — data layer handles retry, quota backoff, and column mapping
import { getAllUsers } from '@/lib/sheets';
const users = await getAllUsers();

// ❌ BAD — raw SDK call, bypasses all of the above
const sheets = google.sheets({ version: 'v4', auth });
const res = await sheets.spreadsheets.values.get({ ... });
```

---

## 22. Middleware and Route Protection

Route-level authorization lives in `middleware.ts` — not inside individual pages or components. This ensures protection runs before any server component or API handler is invoked, and makes the security model easy to audit in one place.

### How it works

`middleware.ts` uses NextAuth's `withAuth` wrapper. The `authorized` callback allows public routes through without a token; everything else requires authentication. The inner `middleware` function then handles role-based restrictions.

```typescript
// middleware.ts — adding a new protected route
// 1. If the route needs auth but no specific role: just ensure it isn't listed in isPublicRoute()
// 2. If the route needs a specific role, add a block like:
if (pathname.startsWith('/my-new-admin-section')) {
  if (!token || !hasRole(token.role as string, 'Admin')) {
    return NextResponse.redirect(new URL('/', req.url));
  }
}
```

### Public routes

Add to `isPublicRoute()` in `middleware.ts` — using exact match for pages and prefix match (`startsWith`) for sections with sub-paths. The function handles both page routes and API routes.

### Matcher

The `config.matcher` at the bottom of `middleware.ts` excludes Next.js internals (`_next/static`, `_next/image`), auth endpoints (`api/auth`), and truly public paths (`login`, `apply`, `kiosk`). Update it when adding new public entry points.

### Special cases already handled

- `mustChangePassword` — redirects to `/change-password` for all page routes (skipped when admin is impersonating)
- Club role — restricted to `/clubs` and `/rowland` paths only

---

## 23. Modal and Dialog Pattern

All modals follow the same structure. Use `ConfirmDialog` (`src/components/ConfirmDialog.tsx`) for simple confirm/cancel prompts. For custom modals, use this layout:

```tsx
{/* Backdrop — closes modal on click */}
<div
  className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
  onClick={onClose}
>
  {/* Panel — stop clicks propagating to backdrop */}
  <div
    className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
    onClick={(e) => e.stopPropagation()}
  >
    {/* Header */}
    <div className="flex items-center justify-between p-4 border-b">
      <h2 className="text-lg font-semibold text-gray-900">Title</h2>
      <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
    </div>

    {/* Scrollable body */}
    <div className="flex-1 overflow-y-auto p-4">
      {/* content */}
    </div>

    {/* Footer actions */}
    <div className="flex justify-end gap-3 p-4 border-t">
      <button onClick={onClose} className={getButtonClasses('secondary')}>Cancel</button>
      <button onClick={onConfirm} className={getButtonClasses('primary')}>Confirm</button>
    </div>
  </div>
</div>
```

**ESC key handling** — add a `useEffect` to close on Escape:

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}, [onClose]);
```

**Scroll lock** — for tall modals, prevent the body from scrolling behind the overlay:

```typescript
useEffect(() => {
  document.body.style.overflow = 'hidden';
  return () => { document.body.style.overflow = ''; };
}, []);
```

---

## 24. Server-Sent Events (SSE) for Long-Running Operations

Use SSE when an operation processes many items sequentially and the user needs progress feedback (e.g., bulk email sends, imports). Return a `ReadableStream` response from the API route and consume it on the client.

### API route (server)

```typescript
export async function POST(request: NextRequest) {
  // ... auth checks, parse body ...

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Helper to emit an SSE event
      const sendEvent = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const items = await getItemsToProcess();

        sendEvent({ type: 'progress', current: 0, total: items.length });

        for (let i = 0; i < items.length; i++) {
          try {
            await processItem(items[i]);
            sendEvent({ type: 'success', current: i + 1, total: items.length, id: items[i].id });
          } catch (err) {
            sendEvent({ type: 'error', current: i + 1, total: items.length, error: String(err) });
          }
        }

        sendEvent({ type: 'complete', succeeded, failed });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

### Client-side consumption

```typescript
const response = await fetch('/api/admin/emails/send', { method: 'POST', body: JSON.stringify(payload) });
const reader = response.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  // SSE format: "data: {...}\n\n" — split on double newline
  const lines = text.split('\n\n').filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const event = JSON.parse(line.slice(6));
      // Update progress UI based on event.type
    }
  }
}
```

**Event types convention:** `progress` (current/total update), `success` (item succeeded), `error` (item failed — do not abort), `complete` (final summary with counts).

---

## 25. Client-Side sessionStorage Caching

For pages where instant back-button navigation matters (e.g., list → detail → back to list), cache the last API response in `sessionStorage`. On mount: show cached data immediately, then re-fetch silently in the background to get fresh data.

```typescript
const CACHE_KEY = 'FriendliesManageCache';

// On mount
useEffect(() => {
  // Show cached data instantly (avoids blank screen on back-navigation)
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      setData(JSON.parse(cached));
    } catch { /* ignore corrupt cache */ }
  }

  // Always re-fetch in background to get fresh data
  fetchData({ silent: !!cached });
}, []);

// After fetch
const fetchData = async ({ silent = false }) => {
  if (!silent) setLoading(true);
  try {
    const res = await fetch('/api/friendlies/games');
    const json = await res.json();
    setData(json);
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(json));
  } finally {
    if (!silent) setLoading(false);
  }
};
```

**When to use:** List pages that users navigate away from and back to frequently. **Do not use** for data that must always be fresh (e.g., a form's initial values before editing).

---

## 26. PWA Configuration

The app is configured as a Progressive Web App using `@ducanh2912/next-pwa` in `next.config.ts`. Key settings:

```typescript
// next.config.ts
const withPWA = withPWAInit({
  dest: "public",              // Service worker output directory
  cacheOnFrontEndNav: true,    // Cache pages visited via client-side navigation
  aggressiveFrontEndNavCaching: true,  // Prefetch aggressively for offline use
  reloadOnOnline: true,        // Reload page when connectivity is restored
  disable: process.env.NODE_ENV === "development",  // Disabled in dev
});
```

**Notes:**
- Test PWA behaviour with a production build (`npm run build && npm start`) — service workers are disabled in development
- Keep `public/manifest.json` and `public/icons/` up to date if the app name, colours, or icons change
- Ensure POST/PUT/DELETE calls are never cached by the service worker

---

## 27. Rate Limiting on Public Endpoints

Any API route that does not require authentication must have rate limiting to prevent abuse. Use an in-memory `Map` keyed by IP address.

```typescript
// At module level (persists across requests on the same server instance)
const submissionTimes: Map<string, number> = new Map();
const RATE_LIMIT_MINUTES = 5;

export async function POST(request: NextRequest) {
  // Rate limiting by IP
  const ip = request.headers.get('x-forwarded-for')
    || request.headers.get('x-real-ip')
    || 'unknown';
  const lastSubmission = submissionTimes.get(ip);
  const now = Date.now();

  if (lastSubmission && (now - lastSubmission) < RATE_LIMIT_MINUTES * 60 * 1000) {
    return NextResponse.json(
      { error: 'Please wait a few minutes before submitting again' },
      { status: 429 }
    );
  }

  submissionTimes.set(ip, now);

  // ... rest of handler
}
```

**Notes:**
- Authenticated routes do not need this — NextAuth handles login brute-force protection.
- Return 429 with a human-readable message so the client can display it directly.

---

## 28. Form Honeypot (Bot Prevention)

Public forms (membership application, contact forms) should include a honeypot field — a hidden input that legitimate users never fill in, but bots typically do. If the field is populated, reject the submission silently (return 200, don't process).

### In the form component

```tsx
{/* Honeypot — hidden from humans, bots fill it in */}
<input
  type="text"
  name="website"
  value={formData.website || ''}
  onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
  style={{ display: 'none' }}
  tabIndex={-1}
  autoComplete="off"
  aria-hidden="true"
/>
```

### In the API route

```typescript
// Honeypot check — silent success so bots don't know they were rejected
if (data.website) {
  console.log('[route] Honeypot triggered — rejecting bot submission');
  return NextResponse.json({ success: true }); // Don't reveal the rejection
}
```

Return `{ success: true }` — not a 4xx — so bots don't detect the block. Combine with rate limiting (§27).

---

## Summary Checklist

Before submitting code, verify:

**Comments & readability**
- [ ] Every file has a header comment with path and description
- [ ] Every function has a comment explaining what it does
- [ ] Every loop has a comment explaining what it's iterating over
- [ ] Every API call has a comment explaining what data it's fetching/updating
- [ ] Every if statement (with complex logic) has a comment explaining the condition
- [ ] All error handling explains what errors mean
- [ ] All React hooks have comments explaining when they run

**Code style**
- [ ] No optional chaining (`?.`) — use explicit if checks instead
- [ ] No nullish coalescing (`??`) — use explicit fallbacks instead
- [ ] All variables have descriptive names
- [ ] Dates from Google Sheets are parsed using `parseUKDate()` / `parseNormalizedDate()` from `date-utils.ts` — never `new Date(dateStr)` directly

**Google Sheets**
- [ ] All Google Sheets operations include context (row numbers, column letters, ranges)
- [ ] Dynamic column mapping used — no hardcoded column indices

**API routes**
- [ ] Session checked first (`getServerSession`), returns 401 if missing
- [ ] Role checked with `hasRole()` from `role-utils.ts`, returns 403 if insufficient
- [ ] Input validated before use, returns 400 if invalid
- [ ] Response always `{ success: true }` or `{ error: 'message' }` — no mixed formats
- [ ] Catch block logs with `console.error('[route] context:', error)` and returns 500

**Styling**
- [ ] Buttons, inputs, badges, and alerts use helpers from `theme-helpers.ts` — no bespoke inline classes
- [ ] Every element with a background colour also has an explicit text colour on itself or its immediate wrapper
- [ ] `globals.css` has `color-scheme: light` if the app does not support dark mode
- [ ] No `text-gray-400`, `text-gray-500`, or `text-gray-600` on text the user needs to read — use `text-gray-700` minimum

**Navigation & forms**
- [ ] Back links use `<RouterBackLink>` not a plain `<Link href="...">`
- [ ] Deep-stack pages (PWA) use `usePhoneBackNavigation()`
- [ ] Forms with significant user input use `saveDraft` / `restoreDraft` to protect against accidental navigation
- [ ] Full edit-mode pages use `useEditMode` hook rather than hand-rolling draft + state management

**Security (public routes)**
- [ ] Public POST endpoints have rate limiting (in-memory Map + `RATE_LIMIT_MINUTES`)
- [ ] Public forms include a honeypot field — API returns 200 silently if it's filled
- [ ] New protected routes are added to `middleware.ts`, not guarded only inside the page

**Data & infrastructure**
- [ ] New env var access uses a getter function (throws with helpful message if missing) — no inline `process.env` in data-layer code
- [ ] Google Sheets calls go through the data-layer functions (which already have `withRetry` backoff) — no raw SDK calls in route handlers
- [ ] Long-running operations (bulk sends, imports) use SSE (`ReadableStream`) to stream progress, not a single blocking response
