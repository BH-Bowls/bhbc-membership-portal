# Spec: Match Date Finder (part of Availability)

A "best date & time for the squad to meet" tool, used to offer an opponent the top dates
for a match. Built **on top of the existing Availability system** — it reuses the
events/slots/responses/invites model and adds a match-specific create flow, a grid response
UI, and a ranked results view.

## Use case
Club needs to offer an opponent ~3 dates. A squad of up to ~12 players (need **8** to field a
team) marks availability across candidate dates × the standard match times. Organiser picks
the best 3 viable dates to send the opponent. Match is usually within the next 2–3 weeks.

## What already exists (reuse)
- `src/types/availability.ts`: `AvailabilityResponse = 'yes' | 'maybe' | 'no'`,
  `AvailabilityEventType = 'general' | 'fixture' | 'signup'`, `AvailabilitySlotType = 'datetime' | 'text'`.
- Events + slots + responses data layer: `src/lib/availability-events-sheets.ts`.
- Invite/response email flow (`src/lib/email/availability.ts`), respond API
  (`app/api/availability/events/[eventId]/respond/route.ts`), event page
  (`app/availability/events/[eventId]/page.tsx`), conclude API (picks ONE slot).
- Access: open to any logged-in member; per-event route guards (public/group; manage = creator/Admin).
- ⚠️ Slot datetimes must be built UTC-safe: `new Date(\`${date}T${time}:00Z\`).toISOString()`
  (see AVAILABILITY_SLOT_TIME_TZ_FIX) and displayed with `timeZone: 'UTC'`.

## New / changed pieces

### 1. Data model
- Mark these events as a match finder. Either reuse `type: 'fixture'` or add a flag — check
  what `'fixture'` currently does first; cleanest is a dedicated marker so generic polls are
  unaffected.
- Add an event field **`needed`** (integer, min players to field a team; default 8). New column
  in the events sheet + the event types. Used only by the results view.
- Slots are normal **datetime** slots, auto-generated (see create flow). No new slot storage.

### 2. Create flow (organiser)
A match-finder create form (a mode of the new-event page, or a sibling page under
`/availability`). Inputs:
- **Title / opponent** (e.g. "vs Lindfield").
- **Candidate dates** — a small **date picker**: organiser ticks specific days in the next
  ~2–3 weeks (NOT a blanket range — keeps slot count sane).
- **Times** — checkboxes for **10:00 / 14:00 / 18:00** (default all three; any subset). These
  three are fixed in the picker (no custom times); the chosen slot time can be tweaked
  manually afterwards if needed.
- **Needed** — min players (default 8).
- **Players** — select the squad pool, reusing the existing invitee/group selection + email links.
- On submit: generate datetime slots = **each selected date × each selected time** (UTC-safe).

### 3. Response — grid/matrix
The respond page, in match mode, renders a **matrix**: rows = dates, columns = times, each cell
a 3-state `yes / maybe / no` control. Posts to the existing respond API per slot. (A flat list
of 20–36 slots is unusable; the matrix is the main new UI.) Keep the existing flat list for
non-match events.

### 4. Results — ranked, viability, pick top 3 (organiser)
A results view per slot showing the tally: **yes / maybe / no / no-response**.
- **Score:** sort by `yes` count; show `maybe` alongside; tie-break by `yes + maybe`.
- **Viability vs `needed`:** colour each slot — **green** when `yes >= needed`, **amber** when
  `yes + maybe >= needed` (possible), **red** when it can't be fielded.
- **Highlight the top viable slots**; let the organiser **select 3** (tick them).
- **"Copy the 3 dates"** — a formatted summary to paste/email the opponent (e.g.
  "We can offer: Tue 8 Jul 2pm, Thu 10 Jul 10am, Sat 12 Jul 6pm").

### 5. Access
Same as availability: open to logged-in members; the squad responds via their invite links;
manage/results restricted to the creator or Admin (route-level, as existing).

## Future (designed-for, NOT built now)
- **Create the friendly game** from a chosen slot once a date is agreed (a "definite maybe").
  Keep the slot's date/time + opponent so this is a later wire-up to the friendlies create flow.

## Build notes / gotchas
- UTC-safe datetime building + UTC display (timezone bug already fixed elsewhere).
- Reuse the respond API and email flow; don't fork them.
- The conclude endpoint picks one slot — results here pick N (3), so it's a separate
  results/selection view, not the conclude flow.
- Matrix should degrade gracefully on mobile (stack or horizontal scroll).
