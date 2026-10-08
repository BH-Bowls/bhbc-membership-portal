// src/lib/halveit-supabase.ts
// Halve It darts league data layer (supabase/migrations/0074_halveit.sql).
// Self-contained: nothing outside Halve It reads these tables. Seasons are derived
// from night dates (see seasonForDate); league tables are computed from raw scores
// in halveit-stats.ts.

import { getSupabaseClient } from './supabase';
import { HALVEIT_DEFAULT_SETTINGS, HALVEIT_MAX_SCORE, seasonForDate, todayIso } from '@/types/halveit';
import type { HalveItNight, HalveItNightStatus, HalveItPlayer, HalveItScore, HalveItSeasonData, HalveItSettings } from '@/types/halveit';

const PLAYER_SELECT = '*, users(username, member_profiles!user_id(first_name, known_as, last_name))';

function mapPlayer(row: any): HalveItPlayer {
  // Display name from the member's profile: known-as (or first name) + last name,
  // falling back to the username if the profile is missing
  let name = row.username;
  if (row.users && row.users.member_profiles) {
    const profile = row.users.member_profiles;
    const firstName = profile.known_as || profile.first_name || '';
    const fullName = `${firstName} ${profile.last_name || ''}`.trim();
    if (fullName) name = fullName;
  }
  return {
    id: row.id,
    season: row.season,
    userName: row.username,
    name,
    active: row.active,
  };
}

function mapNight(row: any): HalveItNight {
  return {
    id: row.id,
    season: row.season,
    date: row.night_date,
    gamesCount: row.games_count,
    status: row.status,
    notes: row.notes,
  };
}

function mapScore(row: any): HalveItScore {
  return { nightId: row.night_id, playerId: row.player_id, gameNo: row.game_no, score: row.score };
}

export function currentSeason(): number {
  return seasonForDate(todayIso());
}

// ── Reads ──

export async function getSeasonData(season: number, includeDrafts: boolean): Promise<Omit<HalveItSeasonData, 'canManage'>> {
  const supabase = getSupabaseClient();
  let nightsQuery = supabase.from('halveit_nights').select('*').eq('season', season).order('night_date', { ascending: true });
  if (!includeDrafts) nightsQuery = nightsQuery.eq('status', 'final');

  const [players, nights, settings, playerSeasons, nightSeasons] = await Promise.all([
    supabase.from('halveit_players').select(PLAYER_SELECT).eq('season', season),
    nightsQuery,
    supabase.from('halveit_settings').select('*').eq('season', season).maybeSingle(),
    supabase.from('halveit_players').select('season'),
    supabase.from('halveit_nights').select('season'),
  ]);
  for (const r of [players, nights, settings, playerSeasons, nightSeasons]) {
    if (r.error) throw new Error(`Failed to fetch Halve It data: ${r.error.message}`);
  }

  const mappedNights: HalveItNight[] = [];
  for (const row of nights.data || []) mappedNights.push(mapNight(row));

  // Scores for the nights being returned
  const scores: HalveItScore[] = [];
  if (mappedNights.length > 0) {
    const nightIds: string[] = [];
    for (const night of mappedNights) nightIds.push(night.id);
    const { data, error } = await supabase.from('halveit_scores').select('*').in('night_id', nightIds);
    if (error) throw new Error(`Failed to fetch Halve It scores: ${error.message}`);
    for (const row of data || []) scores.push(mapScore(row));
  }

  // Every season that has a team or nights, plus the current and requested ones
  const seasons = new Set<number>([currentSeason(), season]);
  for (const row of playerSeasons.data || []) seasons.add(row.season);
  for (const row of nightSeasons.data || []) seasons.add(row.season);

  // Settings fall back to the defaults when this season has none saved
  let seasonSettings: HalveItSettings = HALVEIT_DEFAULT_SETTINGS;
  if (settings.data) {
    seasonSettings = { minGamesForAverage: settings.data.min_games_for_average, bestNGames: settings.data.best_n_games };
  }

  const mappedPlayers: HalveItPlayer[] = [];
  for (const row of players.data || []) mappedPlayers.push(mapPlayer(row));
  mappedPlayers.sort((a, b) => a.name.localeCompare(b.name));

  return {
    season,
    seasons: Array.from(seasons).sort((a, b) => b - a),
    settings: seasonSettings,
    players: mappedPlayers,
    nights: mappedNights,
    scores,
  };
}

/** The season a team player belongs to, or null if there's no such player. */
export async function getPlayerSeason(playerId: string): Promise<number | null> {
  const { data, error } = await getSupabaseClient().from('halveit_players').select('season').eq('id', playerId).maybeSingle();
  if (error) throw new Error(`Failed to fetch Halve It player: ${error.message}`);
  if (!data) return null;
  return data.season;
}

export async function getNight(nightId: string): Promise<HalveItNight | null> {
  const { data, error } = await getSupabaseClient().from('halveit_nights').select('*').eq('id', nightId).maybeSingle();
  if (error) throw new Error(`Failed to fetch Halve It night: ${error.message}`);
  if (!data) return null;
  return mapNight(data);
}

// ── Team ──

export async function addPlayer(season: number, userName: string): Promise<{ player?: HalveItPlayer; error?: string }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('halveit_players')
    .insert({ season, username: userName })
    .select(PLAYER_SELECT)
    .single();
  if (error) {
    // Unique (season, username) — they're already on this season's team
    if (error.message.includes('halveit_players_season_username_key')) return { error: 'That member is already in the team' };
    return { error: error.message };
  }
  return { player: mapPlayer(data) };
}

export async function setPlayerActive(playerId: string, active: boolean): Promise<void> {
  const { error } = await getSupabaseClient().from('halveit_players').update({ active }).eq('id', playerId);
  if (error) throw new Error(`Failed to update Halve It player: ${error.message}`);
}

/** Removes a player who has no scores; players with scores can only be made inactive. */
export async function removePlayer(playerId: string): Promise<{ error?: string }> {
  const supabase = getSupabaseClient();
  const { count, error: countError } = await supabase
    .from('halveit_scores')
    .select('*', { count: 'exact', head: true })
    .eq('player_id', playerId);
  if (countError) throw new Error(`Failed to check Halve It scores: ${countError.message}`);
  if (count && count > 0) return { error: 'This player has scores — make them inactive instead' };
  const { error } = await supabase.from('halveit_players').delete().eq('id', playerId);
  if (error) throw new Error(`Failed to remove Halve It player: ${error.message}`);
  return {};
}

// ── Settings ──

export async function saveSettings(season: number, settings: HalveItSettings): Promise<{ error?: string }> {
  const { minGamesForAverage, bestNGames } = settings;
  if (!Number.isInteger(minGamesForAverage) || minGamesForAverage < 1) return { error: 'Minimum games must be a whole number, 1 or more' };
  if (!Number.isInteger(bestNGames) || bestNGames < 1) return { error: 'Best N games must be a whole number, 1 or more' };
  const { error } = await getSupabaseClient().from('halveit_settings').upsert({
    season,
    min_games_for_average: minGamesForAverage,
    best_n_games: bestNGames,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to save Halve It settings: ${error.message}`);
  return {};
}

// ── Nights ──

export async function createNight(date: string): Promise<{ night?: HalveItNight; error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Invalid date' };
  const { data, error } = await getSupabaseClient()
    .from('halveit_nights')
    .insert({ night_date: date, season: seasonForDate(date) })
    .select('*')
    .single();
  if (error) {
    // night_date is unique — one night per date
    if (error.message.includes('halveit_nights_night_date_key')) return { error: 'There is already a night on that date' };
    return { error: error.message };
  }
  return { night: mapNight(data) };
}

export interface NightUpdate {
  gamesCount: number;
  status: HalveItNightStatus;
  notes: string | null;
  scores: { playerId: string; gameNo: number; score: number }[];
}

/** Saves a night's details and replaces its scores with the given set. */
export async function saveNight(nightId: string, update: NightUpdate): Promise<{ night?: HalveItNight; error?: string }> {
  const night = await getNight(nightId);
  if (!night) return { error: 'Night not found' };
  const { gamesCount, status, scores } = update;
  if (!Number.isInteger(gamesCount) || gamesCount < 1 || gamesCount > 50) return { error: 'Number of games must be between 1 and 50' };
  if (status !== 'draft' && status !== 'final') return { error: 'Invalid status' };

  const supabase = getSupabaseClient();

  // Scores may only be for players in this night's season team
  const { data: seasonPlayers, error: playersError } = await supabase.from('halveit_players').select('id').eq('season', night.season);
  if (playersError) throw new Error(`Failed to fetch Halve It players: ${playersError.message}`);
  const validPlayers = new Set<string>();
  for (const p of seasonPlayers || []) validPlayers.add(p.id);

  // Validate every score; `seen` also becomes the set of player:game keys being kept
  const seen = new Set<string>();
  for (const s of scores) {
    if (!validPlayers.has(s.playerId)) return { error: 'A score is for a player who isn\'t in this season\'s team' };
    if (!Number.isInteger(s.gameNo) || s.gameNo < 1 || s.gameNo > gamesCount) return { error: 'A score is for a game that doesn\'t exist' };
    if (!Number.isInteger(s.score) || s.score < 0 || s.score > HALVEIT_MAX_SCORE) return { error: `Scores must be whole numbers from 0 to ${HALVEIT_MAX_SCORE}` };
    const key = `${s.playerId}:${s.gameNo}`;
    if (seen.has(key)) return { error: 'Duplicate score for the same player and game' };
    seen.add(key);
  }

  const { data: existing, error: existingError } = await supabase.from('halveit_scores').select('player_id, game_no').eq('night_id', nightId);
  if (existingError) throw new Error(`Failed to fetch Halve It scores: ${existingError.message}`);

  // Upsert first, then remove whatever was cleared — a failure part-way never loses entered scores
  if (scores.length > 0) {
    const rows: Record<string, unknown>[] = [];
    for (const s of scores) rows.push({ night_id: nightId, player_id: s.playerId, game_no: s.gameNo, score: s.score });
    const { error } = await supabase.from('halveit_scores').upsert(rows);
    if (error) throw new Error(`Failed to save Halve It scores: ${error.message}`);
  }

  // Saved scores that are no longer in the grid, grouped by player
  const removed = new Map<string, number[]>();
  for (const row of existing || []) {
    if (seen.has(`${row.player_id}:${row.game_no}`)) continue;
    if (!removed.has(row.player_id)) removed.set(row.player_id, []);
    removed.get(row.player_id)!.push(row.game_no);
  }
  for (const [playerId, gameNos] of removed) {
    const { error } = await supabase.from('halveit_scores').delete().eq('night_id', nightId).eq('player_id', playerId).in('game_no', gameNos);
    if (error) throw new Error(`Failed to remove Halve It scores: ${error.message}`);
  }

  let notes: string | null = null;
  if (update.notes && update.notes.trim()) notes = update.notes.trim();

  const { data, error } = await supabase
    .from('halveit_nights')
    .update({ games_count: gamesCount, status, notes, updated_at: new Date().toISOString() })
    .eq('id', nightId)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to save Halve It night: ${error.message}`);
  return { night: mapNight(data) };
}

export async function deleteNight(nightId: string): Promise<void> {
  const { error } = await getSupabaseClient().from('halveit_nights').delete().eq('id', nightId);
  if (error) throw new Error(`Failed to delete Halve It night: ${error.message}`);
}
