// src/types/halveit.ts
// Halve It darts league types — shared by the data layer, API routes and pages
// (supabase/migrations/0074_halveit.sql).

export type HalveItNightStatus = 'draft' | 'final';

export interface HalveItPlayer {
  id: string;
  season: number;
  userName: string;
  name: string;
  active: boolean;
}

export interface HalveItNight {
  id: string;
  season: number;
  date: string; // YYYY-MM-DD
  gamesCount: number;
  status: HalveItNightStatus;
  notes: string | null;
}

export interface HalveItScore {
  nightId: string;
  playerId: string;
  gameNo: number;
  score: number;
}

export interface HalveItSettings {
  minGamesForAverage: number;
  bestNGames: number;
}

export const HALVEIT_DEFAULT_SETTINGS: HalveItSettings = { minGamesForAverage: 10, bestNGames: 20 };

export const HALVEIT_MAX_SCORE = 999;

/** Everything for one season, as returned by GET /api/halve-it. Non-managers only get final nights. */
export interface HalveItSeasonData {
  season: number;
  seasons: number[]; // every season with data, plus the current one, newest first
  settings: HalveItSettings;
  players: HalveItPlayer[];
  nights: HalveItNight[];
  scores: HalveItScore[];
  canManage: boolean;
}

/** The darts season a date falls in: July–December = that year, January–June = the year before. */
export function seasonForDate(date: string): number {
  const [y, m] = date.split('-').map(Number);
  return m >= 7 ? y : y - 1;
}

/** Today's date as YYYY-MM-DD in local time. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The months a season covers, e.g. 2026 -> "Oct 2026 – Mar 2027". */
export function seasonSpan(season: number): string {
  return `Oct ${season} – Mar ${season + 1}`;
}

/** e.g. "Wed 14 Oct 2026". */
export function formatNightDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
