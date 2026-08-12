// src/lib/fixtures-supabase.ts
// Postgres-backed replacement for the fixture-row-level (not player/roster-level)
// slice of friendlies-sheets.ts. Covers: core fixture CRUD, the selection lock
// (locked_by/locked_at — plain columns on the fixture row, nothing to do with the
// Players tab), pickup info, special-instructions message, and tea rota (tea_lead/
// tea_first/tea_second are also plain fixture-row columns).
//
// Deliberately NOT here: anything touching the Players EAV tab or individual
// per-game sheet tabs (entries, selection, stats, driver/bar info) — those stay on
// Sheets until Step 4b (game_players) is designed and built, per the plan's own
// note that this data layer will look very different, not a straight port.
//
// Only ever reads/writes the currently-active season (seasons.is_active = true) —
// matches the live Sheets "Games" tab always being the current season; archived
// years (2024/2025) are historical reference data only, never touched by live
// fixture management.
//
// id (UUID) replaces the Sheets version's rowNumber throughout.

import { getSupabaseClient } from './supabase';
import type { GameStatus, GameType, HomeAway } from './types/friendlies';

export interface Fixture {
  id: string;
  date: string;                 // DD/MM/YYYY, matching the existing Game.date convention
  tabDate: string;               // always '' — vestigial, no live column ever populated it
  time: string;
  clubName: string;
  homeAway: HomeAway;
  format: string;
  ladiesMen: string;
  dress: string;
  league: string;                // always '' — no live data for this field
  tabName: string;
  status: GameStatus;
  include?: string;
  maxPlayers: number;
  entered: number;
  selected: number;
  reserves: number;
  bhbcScore: number | null;
  opponentScore: number | null;
  reason: string;
  who: string;
  lastModifiedBy: string;
  lastModifiedDate: string;
  paired: string;                // '' | 'Y' (open-linked) | 'C' (closed-linked/split)
  gameType: GameType;
  clubSuffix: string;
  specialInstructions: string;
  pickupInfo: string;
  captain: string;
  lockedBy: string;
  lockedAt: string;
  needsPlayers: boolean;
  description: string | null;
}

export interface TeaRotaEntry {
  id: string;
  tabName: string;
  date: string;
  displayDate: string;
  time: string;
  clubName: string;
  format: string;
  ladiesMen: string;
  teaLead: string;
  teaFirst: string;
  teaSecond: string;
  status: string;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Postgres date columns come back as ISO "YYYY-MM-DD" — convert to the DD/MM/YYYY
 * every existing consumer (parseNormalizedDate etc.) expects from Game.date. */
function isoToUKDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function displayDateFromUK(ukDate: string): string {
  if (!ukDate) return '';
  const [d, m, y] = ukDate.split('/').map((n) => parseInt(n, 10));
  if (!d || !m || !y) return ukDate;
  const dateObj = new Date(y, m - 1, d);
  if (isNaN(dateObj.getTime())) return ukDate;
  return `${DAY_NAMES[dateObj.getDay()]} ${dateObj.getDate()} ${MONTH_NAMES_SHORT[dateObj.getMonth()]}`;
}

function mapFixtureRow(row: any): Fixture {
  return {
    id: row.id,
    date: isoToUKDate(row.date),
    tabDate: '',
    time: row.time || '',
    clubName: row.club_name || '',
    homeAway: (row.home_away === 'A' ? 'A' : 'H') as HomeAway,
    format: row.format || '',
    ladiesMen: row.ladies_men || '',
    dress: row.dress || '',
    league: '',
    tabName: row.tab_name || '',
    status: (row.game_status || '') as GameStatus,
    include: undefined,
    maxPlayers: row.max_capacity ?? 0,
    entered: row.entered ?? 0,
    selected: row.selected ?? 0,
    reserves: row.reserves ?? 0,
    bhbcScore: row.bhbc_score,
    opponentScore: row.opponent_score,
    reason: row.reason || '',
    who: row.who || '',
    lastModifiedBy: row.last_modified_by || '',
    lastModifiedDate: row.last_modified_date || '',
    paired: row.paired || '',
    gameType: (row.fixture_type || 'Friendly') as GameType,
    clubSuffix: row.club_suffix || '',
    specialInstructions: row.special_instructions || '',
    pickupInfo: row.pickup_info || '',
    captain: row.captain_username || '',
    lockedBy: row.locked_by || '',
    lockedAt: row.locked_at || '',
    needsPlayers: (row.needs_players || '').trim().toUpperCase() === 'Y',
    description: row.description,
  };
}

function mapTeaRotaRow(row: any): TeaRotaEntry {
  const date = isoToUKDate(row.date);
  return {
    id: row.id,
    tabName: row.tab_name || '',
    date,
    displayDate: displayDateFromUK(date),
    time: row.time || '',
    clubName: row.club_name || '',
    format: row.format || '',
    ladiesMen: row.ladies_men || '',
    teaLead: row.tea_lead_username || '',
    teaFirst: row.tea_first_username || '',
    teaSecond: row.tea_second_username || '',
    status: row.game_status || '',
  };
}

async function getActiveSeasonId(): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('seasons').select('id').eq('is_active', true).single();
  if (error || !data) throw new Error('No active season found');
  return data.id;
}

// ============================================================================
// FIXTURES — CORE
// ============================================================================

export async function getFixtures(statusFilter?: GameStatus, typeFilter?: GameType[]): Promise<Fixture[]> {
  const supabase = getSupabaseClient();
  const seasonId = await getActiveSeasonId();

  let query = supabase.from('fixtures').select('*').eq('season_id', seasonId);
  if (statusFilter !== undefined) query = query.eq('game_status', statusFilter);
  if (typeFilter && typeFilter.length > 0) query = query.in('fixture_type', typeFilter);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch fixtures: ${error.message}`);
  return (data || []).map(mapFixtureRow);
}

export async function getFixtureByTabName(tabName: string): Promise<Fixture | null> {
  const supabase = getSupabaseClient();
  const seasonId = await getActiveSeasonId();
  const { data, error } = await supabase
    .from('fixtures')
    .select('*')
    .eq('season_id', seasonId)
    .eq('tab_name', tabName)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch fixture: ${error.message}`);
  return data ? mapFixtureRow(data) : null;
}

export async function createFixture(data: {
  date: string; // YYYY-MM-DD (HTML date input) or DD/MM/YYYY
  time?: string;
  type?: GameType;
  clubName: string;
  clubSuffix?: string;
  homeAway?: 'H' | 'A';
  format?: string;
  ladiesMen?: string;
  dress?: string;
  paired?: string;
  maxPlayers?: number;
  message?: string;
  pickupInfo?: string;
  tabName?: string;
  status?: string;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const seasonId = await getActiveSeasonId();

  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(data.date)
    ? data.date
    : data.date.split('/').reverse().join('-'); // DD/MM/YYYY -> YYYY-MM-DD

  const { error } = await supabase.from('fixtures').insert({
    season_id: seasonId,
    date: isoDate,
    time: data.time || null,
    fixture_type: data.type || 'Friendly',
    club_name: data.clubName,
    club_suffix: data.clubSuffix || null,
    home_away: data.homeAway || 'H',
    format: data.format || null,
    ladies_men: data.ladiesMen || null,
    dress: data.dress || null,
    paired: data.paired || '',
    max_capacity: data.maxPlayers ?? null,
    special_instructions: data.message || null,
    pickup_info: data.pickupInfo || null,
    tab_name: data.tabName || null,
    game_status: data.status ?? '',
  });
  if (error) throw new Error(`Failed to create fixture: ${error.message}`);
}

export async function updateFixture(
  id: string,
  fields: {
    date?: string;
    time?: string;
    type?: GameType;
    clubName?: string;
    clubSuffix?: string;
    homeAway?: 'H' | 'A';
    format?: string;
    ladiesMen?: string;
    dress?: string;
    paired?: string;
    maxPlayers?: number;
    message?: string;
    pickupInfo?: string;
    tabName?: string;
    status?: string;
    bhbcScore?: number;
    opponentScore?: number;
    reason?: string;
    who?: string;
    lastModifiedBy?: string;
    needsPlayers?: boolean;
    entered?: number;
    selected?: number;
    reserves?: number;
    captain?: string; // '' clears the captain designation
  }
): Promise<void> {
  const supabase = getSupabaseClient();
  const updates: Record<string, any> = {};

  if (fields.date !== undefined) {
    updates.date = /^\d{4}-\d{2}-\d{2}$/.test(fields.date) ? fields.date : fields.date.split('/').reverse().join('-');
  }
  if (fields.time !== undefined) updates.time = fields.time;
  if (fields.type !== undefined) updates.fixture_type = fields.type;
  if (fields.clubName !== undefined) updates.club_name = fields.clubName;
  if (fields.clubSuffix !== undefined) updates.club_suffix = fields.clubSuffix;
  if (fields.homeAway !== undefined) updates.home_away = fields.homeAway;
  if (fields.format !== undefined) updates.format = fields.format;
  if (fields.ladiesMen !== undefined) updates.ladies_men = fields.ladiesMen;
  if (fields.dress !== undefined) updates.dress = fields.dress;
  if (fields.paired !== undefined) updates.paired = fields.paired;
  if (fields.maxPlayers !== undefined) updates.max_capacity = fields.maxPlayers;
  if (fields.message !== undefined) updates.special_instructions = fields.message;
  if (fields.pickupInfo !== undefined) updates.pickup_info = fields.pickupInfo;
  if (fields.tabName !== undefined) updates.tab_name = fields.tabName;
  if (fields.status !== undefined) updates.game_status = fields.status;
  if (fields.bhbcScore !== undefined) updates.bhbc_score = fields.bhbcScore;
  if (fields.opponentScore !== undefined) updates.opponent_score = fields.opponentScore;
  if (fields.reason !== undefined) updates.reason = fields.reason;
  if (fields.who !== undefined) updates.who = fields.who;
  if (fields.lastModifiedBy !== undefined) {
    updates.last_modified_by = fields.lastModifiedBy;
    updates.last_modified_date = new Date().toISOString();
  }
  if (fields.needsPlayers !== undefined) updates.needs_players = fields.needsPlayers ? 'Y' : '';
  if (fields.entered !== undefined) updates.entered = fields.entered;
  if (fields.selected !== undefined) updates.selected = fields.selected;
  if (fields.reserves !== undefined) updates.reserves = fields.reserves;
  if (fields.captain !== undefined) updates.captain_username = fields.captain || null;

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase.from('fixtures').update(updates).eq('id', id);
  if (error) throw new Error(`Failed to update fixture: ${error.message}`);
}

export async function deleteFixture(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('fixtures').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete fixture: ${error.message}`);
}

/**
 * Create a same-club "reserve game" (<tab>-2) for an oversubscribed standalone game,
 * so the captain can move overflow reserves into it. Copies the original fixture's
 * row, then overrides tab_name/club_name-or-suffix/format/status/counts. Marks the
 * original as paired='C' (closed-linked — see the plan's reasoning on 'Y' vs 'C').
 * Tea duty belongs to the original only, so it's left blank on the reserve.
 * Guards here: original must exist and not already be paired, and the -2 game must
 * not already exist. Status/oversubscription are enforced by the caller (the route).
 */
export async function createReserveFixture(
  originalId: string,
  options?: { teamName?: string; format?: string }
): Promise<{ id: string; tabName: string }> {
  const supabase = getSupabaseClient();

  const { data: original, error: fetchError } = await supabase
    .from('fixtures')
    .select('*')
    .eq('id', originalId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!original) throw new Error(`Fixture not found: ${originalId}`);
  if (original.paired) throw new Error('Game is already part of a pair');

  const newTabName = `${original.tab_name}-2`;
  const { data: existing } = await supabase.from('fixtures').select('id').eq('tab_name', newTabName).maybeSingle();
  if (existing) throw new Error(`A reserve game already exists for ${original.tab_name}`);

  const hasTeamName = !!(options?.teamName && options.teamName.trim());
  const insertRow = {
    season_id: original.season_id,
    fixture_type: original.fixture_type,
    club_name: hasTeamName ? options!.teamName!.trim() : original.club_name,
    club_suffix: hasTeamName ? '' : '2',
    date: original.date,
    time: original.time,
    home_away: original.home_away,
    format: (options?.format && options.format.trim()) ? options.format.trim() : original.format,
    ladies_men: original.ladies_men,
    dress: original.dress,
    tab_name: newTabName,
    paired: 'C',
    game_status: 'X',
    entered: 0,
    selected: 0,
    reserves: 0,
    special_instructions: original.special_instructions,
    pickup_info: original.pickup_info,
  };

  const { data: inserted, error: insertError } = await supabase.from('fixtures').insert(insertRow).select('id').single();
  if (insertError) throw new Error(insertError.message);

  const { error: updateError } = await supabase.from('fixtures').update({ paired: 'C' }).eq('id', originalId);
  if (updateError) throw new Error(updateError.message);

  return { id: inserted.id, tabName: newTabName };
}

// ============================================================================
// SELECTION LOCK
// ============================================================================

export async function acquireFixtureLock(
  id: string,
  username: string,
  force = false
): Promise<{ acquired: boolean; lockedBy: string; lockedAt: string }> {
  const supabase = getSupabaseClient();

  const { data: fixture, error: fetchError } = await supabase
    .from('fixtures')
    .select('id, locked_by, locked_at')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!fixture) throw new Error(`Fixture not found: ${id}`);

  if (fixture.locked_by && fixture.locked_by !== username && !force) {
    return { acquired: false, lockedBy: fixture.locked_by, lockedAt: fixture.locked_at || '' };
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from('fixtures').update({ locked_by: username, locked_at: now }).eq('id', id);
  if (error) throw new Error(error.message);

  return { acquired: true, lockedBy: username, lockedAt: now };
}

export async function releaseFixtureLock(id: string, username: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: fixture, error: fetchError } = await supabase
    .from('fixtures')
    .select('id, locked_by')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!fixture) return;
  if (fixture.locked_by && fixture.locked_by !== username) return; // someone else owns it

  const { error } = await supabase.from('fixtures').update({ locked_by: null, locked_at: null }).eq('id', id);
  if (error) throw new Error(error.message);
}

// ============================================================================
// MESSAGE / PICKUP INFO
// ============================================================================

export async function updateFixtureMessage(id: string, message: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error, count } = await supabase
    .from('fixtures')
    .update({ special_instructions: message }, { count: 'exact' })
    .eq('id', id);
  if (error) throw new Error(error.message);
  if (!count) throw new Error(`Fixture not found: ${id}`);
}

export async function updateFixturePickupInfo(id: string, pickupInfo: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error, count } = await supabase
    .from('fixtures')
    .update({ pickup_info: pickupInfo }, { count: 'exact' })
    .eq('id', id);
  if (error) throw new Error(error.message);
  if (!count) throw new Error(`Fixture not found: ${id}`);
}

// ============================================================================
// TEA ROTA
// ============================================================================

export async function getTeaRotaList(options?: { includeCancelled?: boolean }): Promise<TeaRotaEntry[]> {
  const supabase = getSupabaseClient();
  const seasonId = await getActiveSeasonId();

  let query = supabase
    .from('fixtures')
    .select('*')
    .eq('season_id', seasonId)
    .eq('home_away', 'H')
    .or('fixture_type.is.null,fixture_type.eq.,fixture_type.eq.Friendly');
  if (!options?.includeCancelled) query = query.neq('game_status', 'C');

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch tea rota: ${error.message}`);

  const entries = (data || []).map(mapTeaRotaRow);
  entries.sort((a, b) => {
    const [da, ma, ya] = a.date.split('/').map((n) => parseInt(n, 10));
    const [db, mb, yb] = b.date.split('/').map((n) => parseInt(n, 10));
    return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
  });
  return entries;
}

export async function getTeaRotaEntry(id: string): Promise<TeaRotaEntry | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fixtures').select('*').eq('id', id).eq('home_away', 'H').maybeSingle();
  if (error) throw new Error(`Failed to fetch tea rota entry: ${error.message}`);
  return data ? mapTeaRotaRow(data) : null;
}

export async function updateTeaRotaAssignment(
  id: string,
  teaLead: string,
  teaFirst: string,
  teaSecond: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('fixtures')
    .update({
      tea_lead_username: teaLead || null,
      tea_first_username: teaFirst || null,
      tea_second_username: teaSecond || null,
    })
    .eq('id', id);
  if (error) throw new Error(`Failed to update tea rota assignment: ${error.message}`);
}

export async function batchUpdateTeaRotaAssignments(
  updates: { id: string; teaLead: string; teaFirst: string; teaSecond: string }[]
): Promise<void> {
  if (updates.length === 0) return;
  // Supabase has no multi-row "batch update with different values per row" call —
  // fire them concurrently rather than one at a time.
  await Promise.all(updates.map((u) => updateTeaRotaAssignment(u.id, u.teaLead, u.teaFirst, u.teaSecond)));
}

export async function swapTeaAssignment(
  id: string,
  position: 'teaLead' | 'teaFirst' | 'teaSecond',
  oldUsername: string,
  newUsername: string,
  targetId?: string,
  targetPosition?: 'teaLead' | 'teaFirst' | 'teaSecond'
): Promise<TeaRotaEntry> {
  const supabase = getSupabaseClient();
  const positionToColumn: Record<string, string> = {
    teaLead: 'tea_lead_username',
    teaFirst: 'tea_first_username',
    teaSecond: 'tea_second_username',
  };

  const entry = await getTeaRotaEntry(id);
  if (!entry) throw new Error('Tea rota entry not found');
  if (entry[position] !== oldUsername) {
    throw new Error(`Cannot swap: you are not assigned to ${position}`);
  }

  let newUserId: string | null = targetId ?? null;
  let newUserPosition: 'teaLead' | 'teaFirst' | 'teaSecond' | null = targetPosition ?? null;

  if (!newUserId) {
    // Search for newUsername in any tea position across all home games this season
    const seasonId = await getActiveSeasonId();
    const { data, error } = await supabase
      .from('fixtures')
      .select('id, tea_lead_username, tea_first_username, tea_second_username')
      .eq('season_id', seasonId)
      .eq('home_away', 'H');
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      if (row.tea_lead_username === newUsername) { newUserId = row.id; newUserPosition = 'teaLead'; break; }
      if (row.tea_first_username === newUsername) { newUserId = row.id; newUserPosition = 'teaFirst'; break; }
      if (row.tea_second_username === newUsername) { newUserId = row.id; newUserPosition = 'teaSecond'; break; }
    }
  }

  const { error: updateError } = await supabase
    .from('fixtures')
    .update({ [positionToColumn[position]]: newUsername })
    .eq('id', id);
  if (updateError) throw new Error(updateError.message);

  if (newUserId && newUserPosition) {
    const { error: targetError } = await supabase
      .from('fixtures')
      .update({ [positionToColumn[newUserPosition]]: oldUsername })
      .eq('id', newUserId);
    if (targetError) throw new Error(targetError.message);
  }

  const updated = await getTeaRotaEntry(id);
  if (!updated) throw new Error('Fixture disappeared during swap');
  return updated;
}
