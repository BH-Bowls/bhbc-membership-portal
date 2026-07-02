# Spec: Availability Planning — Group-First Restructure

Restructures the `/availability` **planning layer** so polls are created from a group, support both
fixed-date and date-finder modes, let invited members respond from an email **token link** without
logging in, and let the date-finder pick **explicit date+time pairs** (not a date×time grid). This is
the "direction A" chosen during design, and the precursor that the member-availability substrate
(`specs/MEMBER_AVAILABILITY_SPEC.md`) will later pre-fill.

> Status: design accepted, not yet built (except where noted "DONE"). Planning layer stays on Google
> Sheets. Reuses the existing events/slots/responses/invitees model — do NOT fork it.

---

## What already exists (reuse)

- Events/slots/responses/invitees data layer: `src/lib/availability-events-sheets.ts`.
- Group model: `src/lib/availability-groups-sheets.ts` (`getGroupMembers`, `canManageGroupMembers`).
- Group poll create route: `app/api/availability/groups/[groupId]/events/route.ts` (snapshots invitees
  via `createInviteesFromGroupMembers`).
- Standalone match-finder (to be folded into group-first): `app/availability/match/new/page.tsx` +
  `app/api/availability/match/route.ts` (creates a **public** event, `groupId:''`, ad-hoc squad).
- Response page with three render paths: `app/availability/events/[eventId]/page.tsx` —
  `MatchMatrix` (date×time, own cells only), `RosterGrid` (group roster incl. non-responders, manager
  proxy-edit), flat list.
- **Visitor** token flow already exists: invitee `token`/`tokenExpiresAt`, page
  `app/availability/guest/[eventId]/page.tsx`, routes `app/api/availability/guest/[eventId]/route.ts`
  (+ `/respond`), data fn `getEventDetailForVisitor` + `validateVisitorToken`. Visitor responses are
  recorded keyed by `inviteeId` (`upsertVisitorResponse`).
- Invite emails: `src/lib/email/availability.ts` — **members** get a BCC batch with a login-required
  link (`/availability/events/[eventId]`); **visitors** get individual tokenised links
  (`/availability/guest/[eventId]?token=`).

---

## Part 0 — Roster from live group membership — **DONE**

Fixed this session: the group-poll roster came only from the invitee snapshot, so a member added after
creation (e.g. "Ray") never appeared and couldn't be proxy-edited. Added
`mergeLiveGroupMembersIntoInvitees(eventId, groupId, invitees)`; wired into `getEventDetailForMember`,
`getEventManageDetail`, and the proxy-save validation in
`app/api/availability/events/[eventId]/respond/route.ts`. Roster now reflects live membership.

---

## Part 1 — Group-first poll creation

Move poll creation to start from a group, with a mode choice.

- Entry point: from `app/availability/groups/[groupId]` → **Create poll** → choose:
  - **Fixed dates** — organiser is confirming/among known options; renders the existing `RosterGrid`
    (already shows non-responders + manager proxy-edit). Slots = the chosen options.
  - **Date finder** — organiser is searching for the best date; renders `MatchMatrix`; slots are
    date+time options (see Part 2); results/viability as the match-dates spec.
- Either mode creates a **group event** (`groupId` set) → invitees = group roster, emails as today.
- The `match` API (or a unified group-event create) must accept a `groupId` and, for date-finder
  events, set `matchFinder: true`. Load the roster for match events too (today `invitees`/
  `canManageGroup` only load when `groupId` is set — that now holds, good).
- **MatchMatrix gap:** the date-finder renders `MatchMatrix`, which shows only the caller's own cells.
  Add a manager **"Responding as: [member ▾]"** selector (squad/roster from invitees) so a manager can
  enter availability for non-responders in the matrix, posting with the existing `onBehalfOf` param —
  the same capability `RosterGrid` already has. Show a non-responder list/count.
- Keep the standalone squad-search match flow as an optional one-off, or retire it — decide at build.

---

## Part 2 — Date-finder: explicit date+time pairs (not a grid)

Today the create form collects a set of dates and a set of times and the API builds the **cross
product** (`app/api/availability/match/route.ts:85-93` → each date × each time). The organiser wants to
specify **arbitrary pairs** — e.g. "Mon 10:00, Tue 14:00, Wed 18:00, Thu 10:00" — without every time
on every date.

- **Slots are already individual datetime rows**, so no storage change — only the create UI + API
  contract change.
- **Create UI:** replace "select dates" + "select times" with a builder that produces a list of
  `{ date, time }` pairs: pick a date, pick a time (10:00 / 14:00 / 18:00), **Add**; repeat; show the
  running list with remove buttons. (A quick "add all three times for this date" shortcut keeps the
  old behaviour available.)
- **API contract:** accept an explicit `slots: Array<{ date: string; time: string }>` (or pre-built
  ISO datetimes). Build each slot UTC-safe: `new Date(\`${date}T${time}:00Z\`).toISOString()`
  (`AVAILABILITY_SLOT_TIME_TZ_FIX`). Drop the implicit cross-product, or keep it only behind the
  "add all three" shortcut.
- The `MatchMatrix` already derives its rows/columns from whatever slots exist, so a sparse set of
  pairs renders fine (empty cells show as the existing greyed "no slot" placeholder).

---

## Part 3 — Member token responses (no login required)

Mirror the friendlies token model (`specs/FRIENDLY_TOKEN_AUTH_SPEC.md`) so an **invited member** can
respond from their email link without logging in — important for members who rarely log in. Generalise
the existing **visitor** token flow rather than building fresh.

### Behaviour / auth hierarchy
| Situation | Result |
|---|---|
| Logged-in session | Existing member page; token ignored (session precedence). |
| No session + valid member token | Token response page: full names, can submit **their own** responses. Restricted navbar (logo + Login). |
| No session + no/invalid token | Forbidden / login prompt (existing). |

### Data model
- Generate a `token` (+ `tokenExpiresAt` = event expiry) for **member** invitees too. Either at invitee
  creation, or **lazily on email send** (friendlies pattern — avoids tokens for never-emailed rows).
  `createInviteesFromGroupMembers` / `createInviteesFromUsernames` currently leave member `token` blank.
- A member token resolves to the member's `userName`; responses are recorded as **member** responses
  (`upsertMemberResponse` keyed by `userName`) — NOT visitor responses — so a token reply merges with
  any logged-in reply and appears in that member's roster row.

### Data layer
- `validateMemberToken(eventId, token)` → returns the member invitee (`userName`) if the token matches
  a member invitee and the event hasn't expired; else null.
- Reuse `getSlotsForEvent`, `getResponsesForEvent`; build the member's own response map by `userName`.

### Pages / routes
- **Landing page:** either extend `/availability/guest/[eventId]` to detect a member token and render
  the member variant, or add `/availability/respond/[eventId]?token=`. When the token is a member
  token, show the response UI (flat list or matrix per event type) and post to a **member token-respond**
  endpoint.
- **Respond endpoint:** public (no session) → rate-limited (`CODING_STANDARDS §27`); validate token;
  reject if event not open / expired; record via `upsertMemberResponse(eventId, slotId, userName, …)`.
- **Navbar restricted mode:** pass `isTokenMode` prop (do not add `useSearchParams` to Navbar) — same
  approach as the friendlies spec §7.1.

### Email change
- In `src/lib/email/availability.ts` `sendEventInviteEmails`, change the **member** link from
  `/availability/events/[eventId]` (login-required) to the tokenised member link. If tokens are lazy,
  call the token-ensure fn per member before building the BCC batch — note BCC can't carry per-member
  tokens in one mail, so **member token emails must be sent individually** (like visitors) rather than
  one BCC batch. Use the pooled transporter, sequential sends (`CODING_STANDARDS §14`).
- Same for conclusion/nudge links if we want those to be token-accessible.

### Security
- Tokens 64-char hex (`crypto.randomBytes(32)`), expire at event expiry. Public endpoints rate-limited.
  Validation failures return a neutral result (no brute-force signal).

---

## Part 5 — Poll email controls (like /friendlies publish)

Bring the friendlies publish-email UX to availability polls.

**5a. Captain footer + Reply-To — DONE.** The poll **creator** acts as the "captain". Invite +
reminder emails now end with *"Please do not reply to this email. To discuss this poll, contact
{creator}{ on {phone}}{ ({email})}."* and set **Reply-To = creator's email** (member + visitor sends).
Template `availability-event-invite.html` gained `captainName/captainEmail/captainPhone` (guarded) +
a `customMessage` block. Wired in `sendEventInviteEmails` + the nudge route.
> Reply-To caveat: honoured by most mail clients but not guaranteed — hence the explicit footer text.
> If groups later link to league teams, "captain" could resolve to the team captain instead of creator.

**5b. Send controls at creation — DONE.** Group create page has an **Invite email** card: *Send now?*
Yes/No; *Who to email* All/Choose (member checklist); optional *Message*. Payload adds `sendEmail`,
`emailMessage`, `emailRecipientUsernames`; the `groups/[groupId]/events` POST filters invitees to the
chosen members (visitors always emailed) and passes `customMessage`. `sendEventInviteEmails` now takes
`options?: { customMessage?, subject? }` and returns the sent count. Invitee rows still created for all.

**5c. Republish (replaces "nudge") — DONE.** The nudge route is now a republish endpoint taking
`{ target: 'nonresponders' | 'all' | 'selected', selectedUserNames, message }` (bare POST still = old
non-responders behaviour). It merges live group members, filters by target, and calls
`sendEventInviteEmails` with a `Reminder: <title>` subject + the message (so it inherits the captain
footer + Reply-To + tokenised links). Manage page's nudge button replaced with a **Send a reminder**
panel: target (Non-responders / Everyone / Choose) + member checklist + message.

## Build order

1. **Part 0** — DONE (live-membership roster).
2. **Part 2** — DONE. Date+time pair picker built into the group create page's Date-finder mode.
3. **Part 1** — DONE. Group create page (`app/availability/groups/[groupId]/events/new/page.tsx`)
   now has **Fixed dates / options** and **Find best date** modes; group events route accepts
   `matchFinder` + `needed`; MatchMatrix has a manager **"Responding as"** proxy selector and owns its
   save buttons (caller + proxy), since the parent save button is hidden for match-finders.
4. **Part 3** — DONE. Member invitees get tokens (`createInviteesFrom*` + lazy `ensureInviteeToken`);
   `getEventDetailForVisitor` + the guest respond route handle member tokens (recorded as MEMBER
   responses keyed by userName); invite emails now send **individual tokenised** links to members
   (guest page, no login) instead of a BCC batch.

> All four parts implemented and `tsc --noEmit` clean (not yet committed; not yet runtime-tested by the
> user). Known follow-up: the guest page renders match-finder slots as a flat list (not the matrix).

### Revision (group-first now the only entry point)
- **Date-finder create UI reverted to the grid** (user preferred it): the group "Find best date" mode
  uses the tappable candidate-date grid × 10/2/6 time toggles, then shows the **generated slot list with
  Remove buttons** ("Restore removed" to undo) so the organiser trims unwanted date/time combinations
  before publishing. The per-row date+time "pairs" builder was removed.
- **Standalone flows removed entirely** (user deleted all public/no-group polls from the sheets):
  deleted pages `app/availability/match/new` + `app/availability/events/new`, routes
  `app/api/availability/match` + `app/api/availability/events` (the events collection GET/POST), the
  hub's "Public Polls" section (hub is now Groups-only), and dead data-layer fns `getPublicEvents`,
  `createInviteesFromUsernames`, `getMissingMatchColumns`. Everything is group-first now. (Note:
  `getOpenPollsForMember`'s public-event handling is harmless dead code — no public events exist.)

---

## Build notes / gotchas

- Reuse the events/slots/responses/invitees model and the existing visitor token machinery — don't
  fork. Member token = same shape, recorded as a member response.
- Member token emails can't be a single BCC batch (per-member token) — send individually, pooled,
  sequential.
- UTC-safe slot datetimes + UTC display (`AVAILABILITY_SLOT_TIME_TZ_FIX`).
- Session always beats token (friendlies precedent). Restricted navbar via `isTokenMode` prop.
- No `?.` / `??` / functional chains (`CODING_STANDARDS §3`). API routes per §7; public routes
  rate-limited per §27.
