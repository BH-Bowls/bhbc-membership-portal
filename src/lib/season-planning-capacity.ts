// src/lib/season-planning-capacity.ts
// Season Planning — same-day capacity math for Friendlies. Pure functions,
// computed client-side from data the Friendlies page already has loaded
// (all of that season's Friendlies, Events' rinks_required, and generated
// Reservation occurrences) — no new aggregation endpoint needed for this.
//
// Two independent checks, not one:
// - Rinks: everything that claims BHBC's own green the same day — Home
//   Friendlies (an Away fixture uses the opponent's green, not ours),
//   Events with Rinks Required set, and standing Reservation occurrences —
//   summed against green_total_rinks. There's no separate "hard block"
//   concept: an Event or Reservation that claims all of green_total_rinks
//   behaves as one automatically, through this same sum.
// - Players: every Friendly fixture that day needs a full team from the
//   club, Home or Away — summed against max_players_per_day, a soft guide
//   only, never enforced. A Home 6-rink game plus an Away 6-rink game the
//   same day is invisible to the rinks check (0 clash) but very visible
//   here. Events/Reservations don't have a player count to add here.

export interface FormatBreakdown {
  rinks: number;
  players: number;
}

/**
 * Parses free-text format strings like "6 Rinks", "4 Triples", "5 A/Pairs"
 * into a rink count and a player count. The leading number is always the
 * rink count regardless of team size — "N Rinks"/"N Triples"/"N Pairs" all
 * use N actual rinks of green, just with 4/3/2 players per rink
 * respectively. Returns null for anything that doesn't start with a number
 * (blank, or a format string that was never filled in).
 */
export function parseFixtureFormat(format: string): FormatBreakdown | null {
  const match = format.trim().match(/^(\d+)\s*(.*)$/);
  if (!match) return null;
  const rinks = parseInt(match[1], 10);
  if (!rinks) return null;

  const descriptor = match[2].toLowerCase();
  let playersPerRink = 4; // "Rinks" (fours) — the default/most common format
  if (descriptor.includes('pair')) playersPerRink = 2;
  else if (descriptor.includes('triple')) playersPerRink = 3;

  return { rinks, players: rinks * playersPerRink };
}

export interface CapacityContributor {
  label: string;
  rinks: number;
}

export interface DayCapacity {
  fixtureIds: string[];
  homeRinks: number;
  totalPlayers: number;
  /** Events/Reservations claiming rinks that day — Friendlies aren't included here since they're already visible as rows on the page. */
  contributors: CapacityContributor[];
}

interface CapacityFixture {
  id: string;
  date: string; // DD/MM/YYYY
  homeAway: string;
  format: string;
}

export interface CapacityEvent {
  date: string; // DD/MM/YYYY
  label: string;
  rinksRequired: number;
}

export interface CapacityReservationOccurrence {
  date: string; // DD/MM/YYYY
  label: string;
  rinksReserved: number;
}

export function computeDayCapacity(
  fixtures: CapacityFixture[],
  events: CapacityEvent[] = [],
  reservationOccurrences: CapacityReservationOccurrence[] = []
): Record<string, DayCapacity> {
  const byDate: Record<string, DayCapacity> = {};

  function ensureDay(date: string): DayCapacity {
    if (!byDate[date]) {
      byDate[date] = { fixtureIds: [], homeRinks: 0, totalPlayers: 0, contributors: [] };
    }
    return byDate[date];
  }

  for (const f of fixtures) {
    const day = ensureDay(f.date);
    day.fixtureIds.push(f.id);

    const breakdown = parseFixtureFormat(f.format);
    if (breakdown) {
      if (f.homeAway === 'H') day.homeRinks += breakdown.rinks;
      day.totalPlayers += breakdown.players;
    }
  }

  for (const e of events) {
    if (e.rinksRequired <= 0) continue;
    const day = ensureDay(e.date);
    day.homeRinks += e.rinksRequired;
    day.contributors.push({ label: e.label, rinks: e.rinksRequired });
  }

  for (const r of reservationOccurrences) {
    if (r.rinksReserved <= 0) continue;
    const day = ensureDay(r.date);
    day.homeRinks += r.rinksReserved;
    day.contributors.push({ label: r.label, rinks: r.rinksReserved });
  }

  return byDate;
}

// ============================================================================
// RESERVATION OCCURRENCES
// ============================================================================
// A pure date-math function, deliberately kept in this Supabase-free module
// rather than reservations-supabase.ts, so client components (the Friendlies
// page) can runtime-import it directly instead of only `import type`ing from
// the Supabase-touching data-layer file.

interface ReservationForOccurrences {
  weekday: number; // 0=Sun..6=Sat
  startDate: string | null; // DD/MM/YYYY — set together with endDate, or both null
  endDate: string | null;
}

/** Parses a config-stored "DD-MM" default-window bound onto a real year, in local time (never `new Date(isoString)` — see season-planning-dates.ts's note on the same UTC-shift trap). */
function ddmmForYear(ddmm: string, year: number): Date {
  const [day, month] = ddmm.split('-').map((n) => parseInt(n, 10));
  return new Date(year, month - 1, day);
}

function parseUKDate(dateStr: string): Date {
  const [day, month, year] = dateStr.split('/').map((n) => parseInt(n, 10));
  return new Date(year, month - 1, day);
}

function formatUKDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

/**
 * Every occurrence date (DD/MM/YYYY) a reservation produces within the given
 * season year: its own start/end if it's a one-off (naturally produces
 * nothing for a season year those dates don't fall within), else the config
 * default window (DD-MM, no year) projected onto seasonYear.
 */
export function getReservationOccurrences(
  reservation: ReservationForOccurrences,
  seasonYear: number,
  defaultStart: string,
  defaultEnd: string
): string[] {
  const windowStart = reservation.startDate ? parseUKDate(reservation.startDate) : ddmmForYear(defaultStart, seasonYear);
  const windowEnd = reservation.endDate ? parseUKDate(reservation.endDate) : ddmmForYear(defaultEnd, seasonYear);
  if (windowStart > windowEnd) return [];

  const occurrences: string[] = [];
  const d = new Date(windowStart);
  d.setDate(d.getDate() + ((reservation.weekday - d.getDay() + 7) % 7));
  while (d <= windowEnd) {
    occurrences.push(formatUKDate(d));
    d.setDate(d.getDate() + 7);
  }
  return occurrences;
}
