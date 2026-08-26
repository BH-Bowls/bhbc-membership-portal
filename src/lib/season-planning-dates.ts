// src/lib/season-planning-dates.ts
// Date projection for Season Planning carry-forward (Events + Friendlies).
// Operates on ISO "YYYY-MM-DD" strings — the wire format Supabase actually
// returns for the fixtures.date column — deliberately NOT date-utils.ts,
// which is DD/MM/YYYY-string/UI oriented.
//
// Never build a Date from new Date(isoString) directly — the single-argument
// form is UTC-parsed and can shift a calendar day at local-time boundaries
// (the same class of bug CLAUDE.md warns about for DD/MM/YYYY strings,
// generalised here to ISO strings). Always build Date objects from explicit
// year/month/day components instead.
//
// Three selectable methods (ProjectionMethod), chosen once per projection
// run by whoever runs it — not auto-detected per fixture:
//
// - 'back-1-day' / 'forward-6-days': how BHBC's real fixture list actually
//   gets compiled. Add exactly 364 days (52 weeks) or 371 days (53 weeks) —
//   both are whole multiples of 7, so both always land on the same weekday
//   as the source, by construction. Verified against real historical
//   fixture data: 138/145 matched fixtures across the 2024->2025 and
//   2025->2026 transitions used exactly +364 days ("back 1 day" relative to
//   the naive same-calendar-date-next-year). "Forward 6 days" (+371) is used
//   instead in years where the club's convention calls for a forward
//   correction rather than another backward one — which one applies is a
//   judgment call for whoever runs the projection, not something this
//   module tries to infer from whether a 29 February falls in between (that
//   heuristic was checked against real examples and does not reliably
//   predict which one BHBC actually uses).
// - 'nth-weekday': the original algorithm (validated 67/77 exact against
//   real historical data — notably less accurate than the fixed-shift
//   methods above, kept only as a fallback option). From the source date,
//   work out which weekday, which month, and which occurrence of that
//   weekday within the month (1st/2nd/3rd/4th/"last"), then project forward
//   to the same weekday + same occurrence in the same month, N years on.
//   "Last occurrence" is computed as the true last weekday of the target
//   month, not naively as "the 4th occurrence" — some months have a 5th.
//   Known failure mode: when a month has 5 occurrences of a weekday in the
//   source year but only 4 in the target year, a fixture classified as
//   "4th occurrence" and a different one classified as "last" (5th, in the
//   source year) can collapse onto the identical target date.

export interface DatePattern {
  weekday: number;              // 0=Sun..6=Sat (Date.getDay() convention)
  month: number;                // 0=Jan..11=Dec
  occurrence: number | 'last';  // 1-4, or 'last'
}

function parseIsoDate(iso: string): Date {
  const parts = iso.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return new Date(year, month, day);
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function extractDatePattern(isoDate: string): DatePattern {
  const date = parseIsoDate(isoDate);
  const year = date.getFullYear();
  const month = date.getMonth();
  const weekday = date.getDay();
  const dayOfMonth = date.getDate();

  let occurrence: number | 'last' = Math.ceil(dayOfMonth / 7);
  if (dayOfMonth + 7 > daysInMonth(year, month)) {
    // Also absorbs the rare 5th-occurrence case automatically — any day in
    // the 5th week always satisfies dayOfMonth + 7 > daysInMonth.
    occurrence = 'last';
  }

  return { weekday, month, occurrence };
}

function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = firstOfMonth.getDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const firstOccurrenceDay = 1 + offset;
  const nthOccurrenceDay = firstOccurrenceDay + (n - 1) * 7;
  return new Date(year, month, nthOccurrenceDay);
}

function getLastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const lastDay = daysInMonth(year, month);
  const lastDate = new Date(year, month, lastDay);
  const lastWeekday = lastDate.getDay();
  const offset = (lastWeekday - weekday + 7) % 7;
  return new Date(year, month, lastDay - offset);
}

export function projectDatePattern(pattern: DatePattern, targetYear: number): Date {
  if (pattern.occurrence === 'last') {
    return getLastWeekdayOfMonth(targetYear, pattern.month, pattern.weekday);
  }
  return getNthWeekdayOfMonth(targetYear, pattern.month, pattern.weekday, pattern.occurrence);
}

/** Project a single fixture date forward N years (default 1) via the nth-weekday-of-month algorithm, returning ISO "YYYY-MM-DD". */
export function projectFixtureDate(sourceIsoDate: string, yearsForward: number = 1): string {
  const pattern = extractDatePattern(sourceIsoDate);
  const sourceYear = parseIsoDate(sourceIsoDate).getFullYear();
  const projected = projectDatePattern(pattern, sourceYear + yearsForward);
  return formatIsoDate(projected);
}

export type ProjectionMethod = 'back-1-day' | 'forward-6-days' | 'nth-weekday';

export const PROJECTION_METHOD_LABELS: Record<ProjectionMethod, string> = {
  'back-1-day': 'Back 1 day (364 days later)',
  'forward-6-days': 'Forward 6 days (371 days later)',
  'nth-weekday': 'Same weekday + occurrence in month',
};

/** Project a single fixture date forward N years (default 1) using the given method, returning ISO "YYYY-MM-DD". */
export function projectFixtureDateByMethod(sourceIsoDate: string, method: ProjectionMethod, yearsForward: number = 1): string {
  if (method === 'nth-weekday') return projectFixtureDate(sourceIsoDate, yearsForward);
  const daysPerYear = method === 'back-1-day' ? 364 : 371;
  const date = parseIsoDate(sourceIsoDate);
  date.setDate(date.getDate() + daysPerYear * yearsForward);
  return formatIsoDate(date);
}
