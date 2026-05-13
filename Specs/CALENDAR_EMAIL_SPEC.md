# Calendar Email (.ics) Feature — Friendlies

## Overview

When a member's status changes in a friendly game, they receive an email with an `.ics`
calendar attachment. The attachment uses standard iCalendar fields so the event is
**added or updated** in the member's calendar automatically — no separate "Add to
Calendar" button required.

## Approach: .ics attachment only

- **No Google Calendar URL link.** A Google Calendar URL always creates a brand-new
  event regardless of whether one exists already. Only `.ics` attachments can update
  an existing event via the UID + SEQUENCE mechanism.
- The `.ics` file is attached to the existing trigger emails (enter, publish, confirm,
  withdraw). No new email types needed.
- Works with Apple Calendar, Outlook, Thunderbird, and most other clients. Google
  Calendar support for `.ics` updates is best-effort (Google respects SEQUENCE but
  behaviour varies by client version).

## UID Strategy

The UID must be **stable** across all emails for the same game, so the calendar client
knows they all refer to the same event.

```
BHBC-FRIENDLY-{tabDate}-{userName}@bhbc.org.uk
```

Example: `BHBC-FRIENDLY-25Apr26-jsmith@bhbc.org.uk`

- `tabDate` is the game's sheet tab name (e.g. `25 Apr 26`), spaces stripped or
  replaced to keep the UID clean.
- `userName` scopes the event to the individual player so two players in the same game
  have independent calendar events (different confirmation states etc.).

## SEQUENCE & STATUS by trigger

| Trigger | SEQUENCE | STATUS | METHOD | Notes |
|---|---|---|---|---|
| Entered game | 0 | TENTATIVE | PUBLISH | "You have entered, awaiting selection" |
| Team published (selected) | 1 | TENTATIVE | PUBLISH | "You have been selected" |
| Team republished (re-issued) | 2 | TENTATIVE | PUBLISH | Increment if published more than once |
| Participation confirmed | 99 | CONFIRMED | PUBLISH | Final confirmed state |
| Withdrawn | 99 | CANCELLED | CANCEL | Removes event from calendar |
| Game cancelled (by captain) | 99 | CANCELLED | CANCEL | Sent to all entered players; removes event from calendar |

> If the team is published more than once (e.g. squad amended), increment SEQUENCE
> each time. Simplest approach: store the current SEQUENCE in the game sheet, or
> derive it from status history. TBD at implementation time.

## ICS Template

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//BHBC Membership Portal//EN
METHOD:{METHOD}
BEGIN:VEVENT
UID:{uid}
SEQUENCE:{sequence}
DTSTAMP:{now in UTC, YYYYMMDDTHHmmssZ}
DTSTART:{game date+time in UTC}
DTEND:{game date+time + 3 hours in UTC}
SUMMARY:{summary — see below}
DESCRIPTION:{description — see below}
LOCATION:{Home: Henfield Bowling Club / Away: {clubName}}
STATUS:{STATUS}
END:VEVENT
END:VCALENDAR
```

### SUMMARY text by trigger

| Trigger | SUMMARY |
|---|---|
| Entered | Entered: Friendly vs {clubName} |
| Selected (published) | Selected: Friendly vs {clubName} |
| Confirmed | Confirmed: Friendly vs {clubName} |
| Withdrawn | Withdrawn: Friendly vs {clubName} |

### DESCRIPTION text

Include: date, time, venue (Home/Away), format, team number and position if known,
captain of day if known at time of sending.

## Duration

Default event duration: **3 hours** from the game start time. This is a reasonable
approximation for a bowls friendly. Not configurable in v1.

## Time zone

Game times are stored as local UK time (no timezone in sheet). When building the ICS:
- Convert to UTC using the Europe/London timezone (handles BST/GMT automatically).
- Use the `date-fns-tz` package (already used elsewhere in the project) or Node's
  `Intl` API.

## Implementation files (to be created/modified)

| File | Change |
|---|---|
| `src/lib/ics-utils.ts` | New. `buildFriendlyICS(params)` → returns `.ics` string |
| `src/lib/email/mailer.ts` | Modify `sendEmail()` to accept optional `attachments` array |
| `app/api/friendlies/enter/route.ts` | Attach ICS on successful entry |
| `app/api/friendlies/confirm/route.ts` | Attach ICS on successful confirm |
| `app/api/friendlies/withdraw/route.ts` | Attach ICS (METHOD:CANCEL) on successful withdraw |
| `src/lib/email/friendlies.ts` | `sendGamePublishedEmail` — attach per-player ICS; add `sendGameCancelledEmail` and `sendTeaRotaCancelledEmail` |
| `app/api/friendlies/manage/status/route.ts` | `cancel` case — send cancellation emails with ICS to all entered players; send tea rota cancellation for home games |
| `app/friendlies/manage/page.tsx` | Cancel dialog — add email player / email tea rota checkboxes |

## Email attachment format (Nodemailer)

```typescript
attachments: [
  {
    filename: `BHBC-${tabDate}.ics`,
    content: icsString,
    contentType: 'text/calendar; method=REQUEST',
  }
]
```

For withdrawals use `contentType: 'text/calendar; method=CANCEL'`.

## Scope

- **Friendlies only** in v1. Competitions and other game types are out of scope.
- **Members only** — Club role accounts do not get ICS emails.
- The existing email content is unchanged; ICS is appended as an attachment.

## Branch

Implement on `feature/calendar-emails` branched from `main`.
