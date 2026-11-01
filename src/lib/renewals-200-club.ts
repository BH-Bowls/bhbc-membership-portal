// src/lib/renewals-200-club.ts
// 200 Club numbers on the renewal form (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §9).
//
// The member says how many entries they want and picks a free number for some or all of
// them; the rest are "Any number". Picks are saved with the draft
// (renewals.club_200_picked_numbers, migration 0090) but nothing is reserved until Submit,
// when they're inserted into two_hundred_club_entries. unique (season, number) means two
// members can't both get a number — the second Submit is refused and told which number
// went. "Any number" entries show on /200-club as still to allocate, for GMC to give out
// by hand.
//
// The 200 Club season is the renewal season as text ('2027'), and the price comes from
// that season's two_hundred_club_settings row. No row = entries aren't open yet.

import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';
import { getCurrentSeasonYear } from './renewals-supabase';

export interface Renewal200ClubInfo {
  season: string;
  open: boolean;          // false until the season's settings row exists
  price: number;          // pounds per entry
  poolSize: number;       // numbers run 1..poolSize
  takenByOthers: string[];
  held: string[];         // numbers this member holds this season
}

function sortNumbers(numbers: string[]): string[] {
  const sorted = numbers.slice();
  sorted.sort((a, b) => Number(a) - Number(b));
  return sorted;
}

/** "23", "23 and 45", "7, 23 and 45" */
export function listNumbers(numbers: string[]): string {
  const sorted = sortNumbers(numbers);
  if (sorted.length <= 1) return sorted.join('');
  return sorted.slice(0, sorted.length - 1).join(', ') + ' and ' + sorted[sorted.length - 1];
}

export async function getRenewal200ClubInfo(userName: string): Promise<Renewal200ClubInfo> {
  const season = String(getCurrentSeasonYear());
  const supabase = getSupabaseClient();
  const [settingsResult, entriesResult] = await Promise.all([
    supabase.from('two_hundred_club_settings').select('price, numbers').eq('season', season).maybeSingle(),
    supabase.from('two_hundred_club_entries').select('number, username').eq('season', season),
  ]);
  if (settingsResult.error) throw new Error(`Failed to load 200 Club settings: ${settingsResult.error.message}`);
  if (entriesResult.error) throw new Error(`Failed to load 200 Club numbers: ${entriesResult.error.message}`);

  const takenByOthers: string[] = [];
  const held: string[] = [];
  for (const row of entriesResult.data || []) {
    if (String(row.username).toLowerCase() === userName.toLowerCase()) held.push(String(row.number));
    else takenByOthers.push(String(row.number));
  }

  const settings = settingsResult.data;
  return {
    season: season,
    open: settings !== null,
    price: settings ? Number(settings.price) : 0,
    poolSize: settings ? Number(settings.numbers) : 0,
    takenByOthers: sortNumbers(takenByOthers),
    held: sortNumbers(held),
  };
}

/**
 * Check the picks sent with a save: whole numbers in the pool, no repeats, no more than
 * the number of entries. Returns the cleaned list, or an error message.
 */
export function cleanPicks(raw: unknown, entries: number, info: Renewal200ClubInfo): { picks: string[]; error: string | null } {
  const picks: string[] = [];
  if (!Array.isArray(raw)) return { picks, error: null };
  for (const value of raw) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > info.poolSize) {
      return { picks: [], error: `200 Club numbers run from 1 to ${info.poolSize}.` };
    }
    const text = String(n);
    if (picks.indexOf(text) === -1) picks.push(text);
  }
  if (picks.length > entries) {
    return { picks: [], error: `You've picked ${picks.length} 200 Club numbers but asked for ${entries} ${entries === 1 ? 'entry' : 'entries'}.` };
  }
  return { picks: sortNumbers(picks), error: null };
}

/** Picks someone else now holds. */
export function picksTaken(picks: string[], info: Renewal200ClubInfo): string[] {
  const taken: string[] = [];
  for (const p of picks) {
    if (info.takenByOthers.indexOf(p) !== -1) taken.push(p);
  }
  return taken;
}

/** "Number 23 has just been taken — please choose another" (or several). */
export function takenMessage(taken: string[]): string {
  if (taken.length === 1) return `200 Club number ${taken[0]} has just been taken — please choose another.`;
  return `200 Club numbers ${listNumbers(taken)} have just been taken — please choose others.`;
}

/**
 * Give the member their picked numbers. Numbers they already hold are skipped.
 *
 * skipTaken false (Submit): all or nothing — one INSERT, so if any number has gone since
 * the form loaded, none are given and the taken ones are returned.
 * skipTaken true (Stripe webhook, payment already taken): numbers that have gone are left
 * out and become "Any number" entries for GMC to allocate.
 */
export async function claimPickedNumbers(
  userName: string,
  picks: string[],
  skipTaken: boolean,
): Promise<{ claimed: string[]; taken: string[] }> {
  if (picks.length === 0) return { claimed: [], taken: [] };
  const info = await getRenewal200ClubInfo(userName);
  const toInsert: string[] = [];
  for (const p of picks) {
    if (info.held.indexOf(p) === -1) toInsert.push(p);
  }
  if (toInsert.length === 0) return { claimed: [], taken: [] };

  const taken = picksTaken(toInsert, info);
  if (taken.length > 0 && !skipTaken) return { claimed: [], taken: taken };

  const rows: { season: string; number: string; username: string }[] = [];
  for (const p of toInsert) {
    if (taken.indexOf(p) === -1) rows.push({ season: info.season, number: p, username: userName });
  }
  if (rows.length === 0) return { claimed: [], taken: taken };

  const supabase = getSupabaseClient();
  if (skipTaken) {
    // Anything taken in the moment since the check above is skipped too
    const { data, error } = await supabase.from('two_hundred_club_entries')
      .upsert(rows, { onConflict: 'season,number', ignoreDuplicates: true })
      .select('number');
    if (error) throw new Error(`Failed to give 200 Club numbers: ${error.message}`);
    const claimed: string[] = [];
    for (const row of data || []) claimed.push(String(row.number));
    const missed = taken.slice();
    for (const r of rows) {
      if (claimed.indexOf(r.number) === -1) missed.push(r.number);
    }
    return { claimed: sortNumbers(claimed), taken: sortNumbers(missed) };
  }

  const { error } = await supabase.from('two_hundred_club_entries').insert(rows);
  if (error) {
    // 23505 = unique violation: someone took one of them in the moment since the check
    if (error.code === '23505') {
      const fresh = await getRenewal200ClubInfo(userName);
      return { claimed: [], taken: picksTaken(toInsert, fresh) };
    }
    throw new Error(`Failed to give 200 Club numbers: ${error.message}`);
  }
  const claimed: string[] = [];
  for (const r of rows) claimed.push(r.number);
  return { claimed: claimed, taken: [] };
}

/** Undo claimPickedNumbers if the Submit then fails. */
export async function releaseNumbers(userName: string, numbers: string[]): Promise<void> {
  if (numbers.length === 0) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('two_hundred_club_entries')
    .delete()
    .eq('season', String(getCurrentSeasonYear()))
    .eq('username', userName)
    .in('number', numbers);
  if (error) console.error(`Failed to release 200 Club numbers ${numbers.join(', ')} for ${userName}:`, error.message);
}

export interface Renewal200ClubRequest {
  userName: string;
  fullName: string;
  entries: number;
}

/**
 * Members whose submitted renewal asks for 200 Club entries this season. /200-club
 * compares each with the numbers they hold to show who's still to allocate — "Any
 * number" entries waiting to be given a number by hand (§9.2). Drafts are ignored
 * (§3.9); voided renewals stay in, as GMC deals with those by hand.
 */
export async function getRenewal200ClubRequests(season: string): Promise<Renewal200ClubRequest[]> {
  const seasonYear = Number(season);
  if (!Number.isInteger(seasonYear)) return [];
  const supabase = getSupabaseClient();
  const [renewalsResult, users] = await Promise.all([
    supabase.from('renewals')
      .select('username, club_200_entries')
      .eq('season_year', seasonYear)
      .eq('renewing_membership', true)
      .not('submitted_at', 'is', null)
      .gt('club_200_entries', 0),
    getAllUsers(),
  ]);
  if (renewalsResult.error) throw new Error(`Failed to load renewals: ${renewalsResult.error.message}`);
  const names = new Map<string, string>();
  for (const u of users) {
    if (u.userName) names.set(u.userName.toLowerCase(), u.fullName || u.userName);
  }

  const result: Renewal200ClubRequest[] = [];
  for (const row of renewalsResult.data || []) {
    const userName = String(row.username);
    result.push({
      userName: userName,
      fullName: names.get(userName.toLowerCase()) || userName,
      entries: Number(row.club_200_entries) || 0,
    });
  }
  result.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return result;
}
