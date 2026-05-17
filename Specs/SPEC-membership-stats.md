# Spec: Membership Statistics Page

## Overview

Build a read-only statistics page that gives Admin and Committee users instant
answers to the most commonly asked membership questions: how many members do we
have, broken down by type and age demographic, plus two operational indicators
(members without an email address, and new members this year).

---

## Files to Create

| File | Purpose |
|---|---|
| `app/api/admin/stats/route.ts` | API endpoint — reads Members sheet, computes all stats, returns JSON |
| `app/admin/stats/page.tsx` | Page — fetches stats and renders them as stat cards + tables |

---

## 1. API Route — `app/api/admin/stats/route.ts`

### Method
`GET`

### Auth / Role Guard
Follow the standard pattern (see CODING_STANDARDS §6):
1. `getServerSession(authOptions)` — return `401` if no session
2. `hasRole(session.user, 'Admin') || hasRole(session.user, 'Committee')` — return `403` if neither role matches

### Data Source
Read from the **Members sheet** in `MEMBERS_SPREADSHEET_ID`.

Use `getColumnMap('Members')` and `getSheetData('Members')` from `src/lib/sheets.ts`
(the same pattern used throughout the codebase — do not call the Sheets SDK directly).

**Range:** `Members!A2:BZ` (all data rows, skip header).

### Filtering — Who to Count

Only count rows where **`include` = `'Y'`**.

Exclude rows where `include` is blank, `'N'`, or the row has no `user_name` value.
This mirrors how renewal emails are scoped and ensures system/test accounts are excluded.

### Stats to Compute

#### A — Member Type Counts

Use the `member_type` column. Count rows matching each of the four codes:

| Stat key | member_type value | Label |
|---|---|---|
| `playingLadies` | `PL` | Playing Ladies |
| `playingMen` | `PM` | Playing Men |
| `socialLadies` | `SL` | Social Ladies |
| `socialMen` | `SM` | Social Men |

Also compute two rollup totals:

| Stat key | Derivation |
|---|---|
| `totalPlaying` | `playingLadies + playingMen` |
| `totalSocial` | `socialLadies + socialMen` |
| `totalMembers` | `totalPlaying + totalSocial` |

#### B — Age Demographic Counts

Use the `age_demographic` column. The values stored in the sheet are exactly:

| Stat key | age_demographic value |
|---|---|
| `ageU18` | `'U18'` |
| `age18to24` | `'18-24'` |
| `age25to59` | `'25-59'` |
| `age60plus` | `'60+'` |
| `age80plus` | `'80+'` |
| `ageUnknown` | blank / any other value |

`ageUnknown` = rows where `age_demographic` is blank or does not match any of
the five known values. Include this count in the response so the admin can see
if any profiles need updating.

#### C — Members Without an Email Address

Count rows (within the `include = 'Y'` set) where `email_address` is blank or
an empty string.

Stat key: `noEmail`

#### D — New Members This Year

Count rows where `year_started` equals the **current calendar year**
(`new Date().getFullYear()`).

Stat key: `newThisYear`

### Response Shape

Return a single JSON object. Use `NextResponse.json(...)` with status `200` on
success, or `{ error: 'message' }` with status `500` on failure.

```typescript
{
  // Member type counts
  playingLadies: number,
  playingMen:    number,
  socialLadies:  number,
  socialMen:     number,
  totalPlaying:  number,
  totalSocial:   number,
  totalMembers:  number,

  // Age demographics
  ageU18:    number,
  age18to24: number,
  age25to59: number,
  age60plus: number,
  age80plus: number,
  ageUnknown: number,

  // Operational indicators
  noEmail:     number,
  newThisYear: number,
  currentYear: number,   // so the page can label the "New this year" card correctly
}
```

---

## 2. Page — `app/admin/stats/page.tsx`

### Auth
This is a protected route. Add `/admin/stats` to `middleware.ts` alongside the
existing `/admin/emails` entry, guarded to `Admin` and `Committee` roles.

### Client Component
Mark with `'use client'` at the top. Fetch data from `/api/admin/stats` on mount.

### Loading / Error States
- While fetching: show a simple loading message (same style used on other admin pages)
- On fetch error: show an inline error message using `useState<string | null>` — do **not** use `alert()`

### Layout

The page has three sections, each with a heading:

---

**Section 1 — Membership by Type**

A row of four stat cards (one per member type) showing name and count, plus
a summary row below showing Total Playing, Total Social, and Grand Total.

Card order: Playing Ladies | Playing Men | Social Ladies | Social Men

Use the badge/card styles from `theme-helpers.ts`. Every card must have an
explicit background colour and an explicit text colour on the same element or
its immediate wrapper (no implicit colour inheritance). Do not use
`text-gray-400/500/600` — use `text-gray-700` minimum.

---

**Section 2 — Age Demographics**

A simple two-column table (Age Group | Count) listing all five bands in order:

| Age Group | Count |
|---|---|
| Under 18 | — |
| 18 – 24 | — |
| 25 – 59 | — |
| 60+ | — |
| 80+ | — |

If `ageUnknown > 0`, add a sixth row labelled "Unknown / Not Set" in
`text-gray-700` italic, so the admin knows some profiles need attention.

---

**Section 3 — Indicators**

Two stat cards side by side:

- **No Email Address** — count of members with no email (label: "No email address on record")
- **New Members {currentYear}** — count of members whose `year_started` is the current year

---

### Page Title
`Membership Statistics`

### Navigation
Add a back link using `<RouterBackLink fallbackHref="/" label="Back to Home" />`
at the top of the page.

---

## 3. middleware.ts Update

Add `/admin/stats` to the route protection block that currently covers
`/admin/emails`. It should require the same roles: `Admin` or `Committee`.

---

## Coding Standards Reminders

(All of these are mandatory per `CODING_STANDARDS.md` and `CLAUDE.md`.)

- **File header comment** on every new file: full path + one-line description
- **No optional chaining (`?.`)** — use explicit `if` checks
- **No nullish coalescing (`??`)** — use explicit fallback `if` blocks
- **No `.find()` or `.findIndex()`** — use explicit `for` loops
- **Every loop, every `if`, every API call, every data transformation** must have a comment explaining what and why
- **Column access via `getColumnMap`** — never hardcode column indices
- **Dates:** `year_started` is an integer in the sheet — compare directly with `new Date().getFullYear()`. Do not use `new Date()` on any string date value from the sheet
- **Error logging:** `console.error('[api/admin/stats]', error)` in the catch block, then return `{ error: 'Failed to load membership stats' }` with status `500`
- **Text contrast:** no `text-gray-400/500/600` — `text-gray-700` minimum
- **No `alert()`** — inline error state only
