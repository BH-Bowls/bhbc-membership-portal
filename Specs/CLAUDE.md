# BHBC Membership Portal — Claude Context

This file gives context on project decisions and watch-outs. The **how** (rules, templates, code patterns) lives in `Specs/CODING_STANDARDS.md`. This file carries the **why** behind those rules and the traps that have bitten us before.

---

## Who you're working with

The project maintainer has a Google Apps Script / spreadsheet background, not a professional TypeScript background. This is why the coding standards ban `?.`, `??`, and functional method chains even though these are standard modern JS. The codebase must stay legible to someone whose primary scripting experience is in Apps Script and Excel macros. Favour explicit, readable code over concise, clever code — even when the shorter form is conventional elsewhere.

---

## Key watch-outs

### `drive_file_id` stores Cloudinary public IDs — legacy naming

File uploads originally used Google Drive, then migrated to Cloudinary. Every attachment sheet (`MemberSuggestionsAttachments`, `InviteGamesAttachments`, `LeagueAttachments`, …) has a column called `drive_file_id`. **This column now stores the Cloudinary `publicId`, not a Drive file ID.** Do not rename the column — rows in production use this name and renaming it would silently orphan all existing attachment records. The `isDriveFileId()` helper in `AttachmentsList.tsx` distinguishes between the two formats at runtime (a Drive ID contains no `/`; a Cloudinary public ID does).

### Tailwind JIT requires literal class strings

Tailwind's JIT compiler only includes CSS classes it finds as **literal strings** in source files. `src/config/theme.ts` holds human-readable design tokens but those values never reach the compiler. `src/config/theme-helpers.ts` holds the actual literal class strings Tailwind needs. If you change the colour scheme, **both files must be updated** — changing only `theme.ts` produces no visible effect in the app.

### Date parsing: `new Date()` silently fails on Sheets dates

Google Sheets stores dates as `DD/MM/YYYY`. JavaScript's `new Date("27/09/2025")` silently parses as a wrong or invalid date — it expects ISO (`YYYY-MM-DD`) or US (`MM/DD/YYYY`) format. We got bitten by this more than once (dates displaying as year 2001, or NaN). Always use the functions in `src/lib/date-utils.ts`; never use `new Date(sheetDateString)` directly anywhere in the codebase.

### Dark mode is not implemented

The app has no dark mode design. `color-scheme: light` is set in `globals.css` specifically to suppress the browser's automatic dark-mode adaptation — without it, light backgrounds render white text as invisible. Do not add `@media (prefers-color-scheme: dark)` blocks unless every single component has been designed and tested in dark mode.

### Gray text contrast — the most common bug in this project

`text-gray-400`, `text-gray-500`, and `text-gray-600` have been the single most frequent source of accessibility and contrast failures in this codebase. They look fine on a developer's calibrated monitor but fail WCAG AA and become nearly invisible in bright light or on cheaper screens. Always use `text-gray-700` (minimum) or `text-gray-900` for any text a user needs to read.

### Gmail SMTP: parallel sends kill the account

Gmail limits simultaneous SMTP connections. Sending bulk emails via `Promise.all()` opens one TCP connection per recipient and triggers Gmail rate-limiting or account suspension. The fix is a pooled transporter (`usePool: true, maxConnections: 1`) that reuses a single connection for all sequential sends. The pattern is in §14 of CODING_STANDARDS.md. This is not a theoretical concern — it was discovered in testing.

### Impersonation: `session.user.userName` is always the right user

When an admin is impersonating a member, `session.user.userName` is the **target member's** username (not the admin's). All data reads and writes should use `session.user.userName` — the impersonation layer handles this transparently. Use `session.user.originalAdmin` only when you need to write an audit record of who the real human was.

### Google Sheets retry is already wired in — don't add your own

`src/lib/sheets.ts` patches `withRetry()` onto all `spreadsheets.values.*` methods at client initialisation time. This gives up to 4 retries with exponential backoff (1 s → 2 s → 4 s → 8 s) on 429 / quota errors. Any data-layer function in `src/lib/` already has this automatically. Never add your own retry loop, and never call the Sheets SDK directly from route handlers — you'd bypass the retry wrapper and the column-mapping layer.

### In-memory rate limiting resets on server restart

Public endpoint rate limits use an in-memory `Map<ip, timestamp>`. The limit resets whenever the server process restarts (Vercel cold start, redeploy). This is a deliberate trade-off — a Redis or persistent store is not justified for the traffic level on this site. Authenticated routes don't need this at all; NextAuth handles brute-force protection on the login endpoint.

### sessionStorage page cache is for PWA back-button feel

The list-page pattern of loading cached data instantly from `sessionStorage` then re-fetching silently in the background exists specifically for the mobile/tablet PWA experience. Members use the app from their phones; the Android back button triggers a full page mount and a loading spinner feels broken. Only apply this pattern to list pages users navigate away from and back to frequently. Do not apply it to forms or detail pages where stale data would be misleading.

### Honeypot returns 200 — by design

Public forms (membership application, etc.) include a hidden honeypot field. When a bot fills it in, the API returns `{ success: true }` rather than a 4xx error. This is deliberate: returning an error tells automated scripts they were detected and prompts them to adapt. Silent acceptance stops the feedback loop.

### Environment variable getters — why not inline `process.env`

Inline `process.env.SOME_VAR` in data-layer code returns `undefined` silently when the variable is missing, producing confusing downstream errors ("Cannot read property of undefined" rather than "this env var is missing"). The named getter pattern (`export function getSpreadsheetId()`) throws immediately with a message that tells the developer exactly which `.env.local` entry to add.

### `alert()` in components — legacy pattern

A handful of older components still use `alert()` for error messages. This is legacy and should not be replicated. All new code should use inline error state (`const [error, setError] = useState<string | null>(null)`) or auto-dismiss toasts — see §17 of CODING_STANDARDS.md.

---

## Files to know

| File | Why it matters |
|---|---|
| `src/lib/sheets.ts` | All core member data access + `withRetry` setup + env var getters |
| `src/lib/date-utils.ts` | The only safe way to parse/format Sheets dates |
| `src/config/theme-helpers.ts` | Literal Tailwind class strings — update here if you change the colour scheme |
| `src/config/theme.ts` | Design tokens (human reference) — must stay in sync with `theme-helpers.ts` |
| `src/lib/role-utils.ts` | `hasRole()` and friends — never parse the role string yourself |
| `middleware.ts` | All route-level auth guards live here — not in individual pages |
| `src/lib/cloudinary.ts` | All Cloudinary operations — never call the SDK directly from routes |
| `src/lib/email/mailer.ts` | All email sends — pooled transporter, sequential sends |

---

## Branch and deploy notes

- **`main`** → auto-deploys to production (Vercel)
- Feature branches → deploy to isolated Vercel preview URLs
- Always test on a preview branch before merging to `main`
