// src/lib/two-hundred-club-supabase.ts
// Postgres-backed replacement for two-hundred-club-sheets.ts. Same function
// names/signatures throughout, so every consumer route needs only an import swap.
//
// Three tables (supabase/migrations/0034_two_hundred_club.sql):
//   two_hundred_club_settings — one row per season, amounts is a real numeric[]
//     array (prize per position) instead of the old " / "-delimited string.
//   two_hundred_club_entries  — which number is assigned to whom for a season
//     (username is nullable — no row, or a cleared row, means unassigned).
//   two_hundred_club_winners  — pure append log, member is a display-name
//     snapshot taken at draw time (same as the old sheet — no username column).

import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';

export const MAX_PRIZES = 10;
export const DEFAULT_NUMBERS = 200;

// member = resolved display name; username = the raw stored value.
export interface ClubEntry { number: string; member: string; username: string; season: string; }
// `numbers` = size of the pool (1..numbers). `amounts` = prize per position.
export interface ClubSettings { season: string; draws: number; price: number; numbers: number; amounts: number[]; }
export interface ClubWinner { season: string; date: string; position: number; number: string; member: string; amount: number; }
export interface RecordedWinner { position: number; number: string; member: string; username: string; amount: number; date: string; }

/** Map of username (lowercased) → full display name, for resolving entries'
 *  Member column. Falls back to an empty map if Members can't be read. */
async function buildNameByUser(): Promise<Map<string, string>> {
  try {
    const users = await getAllUsers();
    return new Map(users.map(u => [
      (u.userName || '').toLowerCase(),
      u.fullName || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.userName,
    ]));
  } catch {
    return new Map();
  }
}

export async function getEntries(season?: string): Promise<ClubEntry[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from('two_hundred_club_entries').select('number, username, season');
  if (season) query = query.eq('season', season);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch 200 Club entries: ${error.message}`);

  const nameByUser = await buildNameByUser();
  return (data ?? []).map(row => {
    const raw = row.username || '';
    return {
      number: row.number,
      member: nameByUser.get(raw.toLowerCase()) || raw,
      username: raw,
      season: row.season,
    };
  });
}

export async function getAllSettings(): Promise<ClubSettings[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('two_hundred_club_settings').select('*');
  if (error) throw new Error(`Failed to fetch 200 Club settings: ${error.message}`);
  return (data ?? []).map(row => ({
    season: row.season,
    draws: row.draws,
    price: Number(row.price),
    numbers: row.numbers,
    amounts: (row.amounts ?? []).map(Number).slice(0, MAX_PRIZES),
  }));
}

export async function getWinners(season?: string): Promise<ClubWinner[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from('two_hundred_club_winners').select('season, date, position, number, member, amount');
  if (season) query = query.eq('season', season);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch 200 Club winners: ${error.message}`);
  return (data ?? []).map(row => ({
    season: row.season,
    date: row.date,
    position: row.position,
    number: row.number,
    member: row.member,
    amount: Number(row.amount),
  }));
}

/** The "current" season — the most recent one in Settings, else from entries. */
export async function getCurrentSeason(): Promise<string> {
  const settings = await getAllSettings();
  if (settings.length > 0) return settings.map(s => s.season).sort().reverse()[0];
  const seasons = [...new Set((await getEntries()).map(e => e.season).filter(Boolean))].sort().reverse();
  return seasons[0] || '';
}

/** Upsert the settings row for a season. */
export async function saveSettings(s: ClubSettings): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('two_hundred_club_settings').upsert({
    season: s.season,
    draws: s.draws,
    price: s.price,
    numbers: s.numbers,
    amounts: s.amounts,
  }, { onConflict: 'season' });
  if (error) throw new Error(`Failed to save 200 Club settings: ${error.message}`);
}

/** Record a draw — resolves each winning number to its member (from entries) and
 *  its prize amount (from the season settings), then appends the winner rows. */
export async function recordDraw(
  season: string,
  date: string,
  picks: { position: number; number: string }[],
): Promise<{ recorded: number; winners: RecordedWinner[] }> {
  const [entries, settingsList] = await Promise.all([getEntries(season), getAllSettings()]);
  const settings = settingsList.find(s => s.season === season);
  const prizeFor = (pos: number) => settings?.amounts[pos - 1] ?? 0;
  const entryFor = (num: string) => entries.find(e => e.number === num.trim());

  const rows: { season: string; date: string; position: number; number: string; member: string; amount: number }[] = [];
  const winners: RecordedWinner[] = [];
  for (const pick of picks) {
    const number = (pick.number ?? '').toString().trim();
    if (!number) continue;
    const entry = entryFor(number);
    const member = entry?.member || '';
    const username = entry?.username || '';
    const amount = prizeFor(pick.position);

    rows.push({ season, date, position: pick.position, number, member, amount });
    winners.push({ position: pick.position, number, member, username, amount, date });
  }

  if (rows.length > 0) {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('two_hundred_club_winners').insert(rows);
    if (error) throw new Error(`Failed to record 200 Club draw: ${error.message}`);
  }
  return { recorded: rows.length, winners };
}

/** Assign (or clear) a number's holder for a season. `username` empty = clear
 *  (removes the row entirely — an absent row and a blank-holder row mean the
 *  same "unassigned" thing, since the page renders the 1..numbers pool itself
 *  and only consults entries for who (if anyone) holds each number). */
export async function assignNumber(season: string, number: string, username: string): Promise<void> {
  const num = number.toString().trim();
  if (!num) return;
  const supabase = getSupabaseClient();
  if (!username) {
    const { error } = await supabase.from('two_hundred_club_entries').delete().eq('season', season).eq('number', num);
    if (error) throw new Error(`Failed to clear 200 Club number: ${error.message}`);
    return;
  }
  const { error } = await supabase.from('two_hundred_club_entries').upsert({
    season,
    number: num,
    username,
  }, { onConflict: 'season,number' });
  if (error) throw new Error(`Failed to assign 200 Club number: ${error.message}`);
}
