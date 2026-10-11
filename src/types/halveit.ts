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
  moneyIn: number; // pence
  moneyOut: number; // pence
  broughtForward: number; // pence — the balance before this night, from every earlier night this season (drafts included)
  playerOrder: string[]; // player ids in game-sheet order, for score entry
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

/** The most that can be entered as a night's money in or out (£10,000), in pence. */
export const HALVEIT_MAX_MONEY_PENCE = 1000000;

/** Pence as pounds, e.g. 1250 -> "£12.50", -300 -> "-£3.00". */
export function formatMoney(pence: number): string {
  const pounds = (Math.abs(pence) / 100).toFixed(2);
  return pence < 0 ? `-£${pounds}` : `£${pounds}`;
}

/** Pence as a plain amount for an input box, e.g. 1250 -> "12.50", 0 -> "". */
export function moneyInputValue(pence: number): string {
  if (pence === 0) return '';
  return (pence / 100).toFixed(2);
}

/** A typed amount in pounds ("12", "12.5", "£12.50") as pence; blank = 0; null if it isn't money. */
export function parseMoney(value: string): number | null {
  const v = value.trim().replace(/^£/, '');
  if (v === '') return 0;
  const match = v.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const pence = parseInt(match[1]) * 100 + parseInt((match[2] || '0').padEnd(2, '0'));
  if (pence > HALVEIT_MAX_MONEY_PENCE) return null;
  return pence;
}

/** A night date's month as YYYY-MM. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** e.g. "2026-10" -> "October 2026". */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

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
