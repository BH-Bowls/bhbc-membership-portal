// src/lib/fixture-groups-supabase.ts
// Postgres data layer for fixture groups — the friendlies roster that used to live in
// the Friendlies spreadsheet (Players EAV tab, per-game tabs, _SelectionCache,
// ManageLog). See specs/FIXTURE_GROUPS_SPEC.md and migration 0072.
//
//   fixture_groups      what people enter: an 'occasion' (one friendly, or linked /
//                       reserve games on the same date) or a 'squad' (league / Club Team)
//   fixture_entries     a member's place in a group — the pool. A friendly reserve is
//                       an entry with no selection anywhere in its group.
//   fixture_selections  an entry picked for one fixture (team/position/driving)
//
// The read functions keep the shapes the Sheets layer returned (GameSheetPlayer,
// PlayerEntry, PlayerStats) so pages didn't have to change. The legacy entry codes
// (E/M/D/P/R/C/A + W) are DERIVED here from the real columns — nothing stores them.
// Stats are computed live from the season's entries; nothing is snapshotted.

import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';
import type { User } from './sheets';
import {
  getActiveSeasonId,
  getFixtureByTabName,
  mapFixtureRow,
  withLiveCounts,
  type Fixture,
} from './fixtures-supabase';
import { getClubByName, getContactsForClub } from './clubs-supabase';
import { canEnterGame as canEnterGender, type GameGender } from './member-type-utils';
import type {
  GameSheetPlayer,
  PlayerEntry,
  PlayerEntryStatus,
  PlayerStats,
  DriverBarInfo,
  ClubDetails,
  ClubContact,
  SelectionStatus,
  Position,
  ConfirmationStatus,
} from './types/friendlies';

// ============================================================================
// TYPES
// ============================================================================

export type GroupKind = 'occasion' | 'squad';
export type EntrySource = 'self' | 'buddy' | 'manager';
export type EntryPreference = 'preferred' | 'only';

export interface FixtureGroup {
  id: string;
  seasonId: string;
  kind: GroupKind;
  entryMode: 'self' | 'manager';
  label: string;
  squadType: 'league' | 'club_team' | null;
  leagueType: string | null;
  status: 'active' | 'archived';
  createdBy: string;
  createdAt: string;
}

export interface FixtureEntry {
  id: string;
  groupId: string;
  username: string;
  entrySource: EntrySource;
  enteredBy: string | null;
  enteredAt: string;
  status: 'entered' | 'withdrawn';
  withdrawnBy: string | null;
  withdrawnAt: string | null;
  preferredFixtureId: string | null;
  preference: EntryPreference | null;
  carNumber: string | null;
  confirmedAt: string | null;
  cancellationAcknowledgedAt: string | null;
  token: string;
}

export interface FixtureSelection {
  id: string;
  fixtureId: string;
  entryId: string;
  selection: 'Y' | 'O';
  team: number | null;
  position: Position;
  driving: string;
  carNumber: string;
  confirmedAt: string | null;
  withdrawnBy: string | null;
  withdrawnAt: string | null;
}

function mapGroup(row: any): FixtureGroup {
  return {
    id: row.id,
    seasonId: row.season_id,
    kind: row.kind,
    entryMode: row.entry_mode,
    label: row.label,
    squadType: row.squad_type || null,
    leagueType: row.league_type || null,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapEntry(row: any): FixtureEntry {
  return {
    id: row.id,
    groupId: row.group_id,
    username: row.username,
    entrySource: row.entry_source,
    enteredBy: row.entered_by || null,
    enteredAt: row.entered_at,
    status: row.status,
    withdrawnBy: row.withdrawn_by || null,
    withdrawnAt: row.withdrawn_at || null,
    preferredFixtureId: row.preferred_fixture_id || null,
    preference: row.preference || null,
    carNumber: row.car_number || null,
    confirmedAt: row.confirmed_at || null,
    cancellationAcknowledgedAt: row.cancellation_acknowledged_at || null,
    token: row.token,
  };
}

function mapSelection(row: any): FixtureSelection {
  return {
    id: row.id,
    fixtureId: row.fixture_id,
    entryId: row.entry_id,
    selection: row.selection,
    team: orNull(row.team),
    position: (row.position || '') as Position,
    driving: row.driving || '',
    carNumber: row.car_number || '',
    confirmedAt: row.confirmed_at || null,
    withdrawnBy: row.withdrawn_by || null,
    withdrawnAt: row.withdrawn_at || null,
  };
}

/** null when a value is missing (undefined or null), otherwise the value itself. */
function orNull<T>(value: T | null | undefined): T | null {
  if (value === undefined || value === null) return null;
  return value;
}

// Supabase caps a single response at 1000 rows — page through anything season-wide.
const PAGE_SIZE = 1000;
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

// ============================================================================
// SMALL HELPERS
// ============================================================================

/** "Henfield A" from club + suffix; falls back to the free-text description. */
export function fixtureDisplayName(f: Pick<Fixture, 'clubName' | 'clubSuffix' | 'description'>): string {
  const club = [f.clubName, f.clubSuffix].filter(Boolean).join(' ');
  return club || (f.description || '').trim() || 'Game';
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Stable human-readable key for a fixture, used in URLs: "Henfield A 03 Jul 26". */
export function buildTabName(f: Pick<Fixture, 'clubName' | 'clubSuffix' | 'description' | 'date'>): string {
  const [d, m, y] = (f.date || '').split('/');
  const datePart = d && m && y ? `${d.padStart(2, '0')} ${MONTHS_SHORT[parseInt(m, 10) - 1] || m} ${y.slice(-2)}` : '';
  return `${fixtureDisplayName(f)} ${datePart}`.trim();
}

function driverBarCode(u: User | undefined): DriverBarInfo {
  if (!u) return { driver: false, bar: false, code: '-' };
  const driver = u.drivingAwayMatches === 'Yes' || u.drivingAwayMatches === 'Y';
  const bar = u.barDuty === 'Yes' || u.barDuty === 'Y';
  const code = driver && bar ? 'DB' : driver ? 'D' : bar ? 'B' : '-';
  return { driver, bar, code };
}

/** Full name for a username, falling back to the username itself. */
function fullNameOf(users: Map<string, User>, username: string): string {
  const u = users.get(username.toLowerCase());
  return u && u.fullName ? u.fullName : username;
}

function usersByName(users: User[]): Map<string, User> {
  const map = new Map<string, User>();
  for (const u of users) if (u.userName) map.set(u.userName.toLowerCase(), u);
  return map;
}

function isoToUK(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

// ============================================================================
// GROUPS
// ============================================================================

export async function getGroup(groupId: string): Promise<FixtureGroup | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fixture_groups').select('*').eq('id', groupId).maybeSingle();
  if (error) throw new Error(`Failed to fetch fixture group: ${error.message}`);
  return data ? mapGroup(data) : null;
}

/** Every fixture in a group, main games first, then reserve games, each by time. */
export async function getGroupFixtures(groupId: string): Promise<Fixture[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fixtures').select('*').eq('group_id', groupId);
  if (error) throw new Error(`Failed to fetch group fixtures: ${error.message}`);
  const fixtures = await withLiveCounts((data || []).map(mapFixtureRow));
  return fixtures.sort((a, b) => {
    if (!!a.reserveOf !== !!b.reserveOf) return a.reserveOf ? 1 : -1;
    return (a.time || '').localeCompare(b.time || '') || fixtureDisplayName(a).localeCompare(fixtureDisplayName(b));
  });
}

/**
 * Open one fixture, or several as a linked occasion. Creates the occasion group,
 * assigns tab names, and moves every fixture to 'O'. A fixture that already has a
 * group (opened before, then reverted to Upcoming) reopens its existing group.
 */
export async function openFixtures(fixtureIds: string[], openedBy: string): Promise<{ group: FixtureGroup; fixtures: Fixture[] }> {
  if (fixtureIds.length === 0) throw new Error('No fixtures to open');
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fixtures').select('*').in('id', fixtureIds);
  if (error) throw new Error(`Failed to fetch fixtures: ${error.message}`);
  const fixtures = (data || []).map(mapFixtureRow);
  if (fixtures.length !== fixtureIds.length) throw new Error('Fixture not found');

  for (const f of fixtures) {
    if (f.status !== '') throw new Error(`${fixtureDisplayName(f)} is not Upcoming — refresh the game list.`);
  }

  // Re-opening a previously opened single group: reuse it as-is.
  const existingGroupIds = Array.from(new Set(fixtures.map((f) => f.groupId).filter(Boolean))) as string[];
  if (existingGroupIds.length > 1) throw new Error('These games already belong to different groups');
  if (existingGroupIds.length === 1 && fixtures.some((f) => !f.groupId)) {
    throw new Error('Some of these games already belong to a group');
  }

  if (fixtures.length > 1) {
    const date = fixtures[0].date;
    if (fixtures.some((f) => f.date !== date)) throw new Error('Linked games must be on the same date');
    if (fixtures.some((f) => f.seasonId !== fixtures[0].seasonId)) throw new Error('Linked games must be in the same season');
    const sections = new Set(fixtures.map((f) => (f.ladiesMen || '').trim().toLowerCase()).filter(Boolean));
    if (sections.size > 1) {
      throw new Error(`Linked games must be the same section — ${fixtures.map((f) => `"${f.ladiesMen}"`).join(' vs ')}. Usually both Mixed.`);
    }
  }

  let group: FixtureGroup;
  if (existingGroupIds.length === 1) {
    const g = await getGroup(existingGroupIds[0]);
    if (!g) throw new Error('Fixture group not found');
    // League / Club Team fixtures belong to a squad and are managed on the Squads pages
    if (g.kind !== 'occasion') throw new Error('This fixture belongs to a squad — manage it from Squads');
    group = g;
  } else {
    const label = fixtures.map(fixtureDisplayName).join(' + ');
    const { data: inserted, error: insertError } = await supabase
      .from('fixture_groups')
      .insert({ season_id: fixtures[0].seasonId, kind: 'occasion', entry_mode: 'self', label, created_by: openedBy })
      .select('*')
      .single();
    if (insertError) throw new Error(`Failed to create fixture group: ${insertError.message}`);
    group = mapGroup(inserted);
  }

  const now = new Date().toISOString();
  for (const f of fixtures) {
    const tabName = f.tabName && f.tabName.trim() ? f.tabName.trim() : buildTabName(f);
    const { error: updateError } = await supabase
      .from('fixtures')
      .update({ group_id: group.id, game_status: 'O', tab_name: tabName, last_modified_by: openedBy, last_modified_date: now })
      .eq('id', f.id);
    if (updateError) throw new Error(`Failed to open ${fixtureDisplayName(f)}: ${updateError.message}`);
  }

  return { group, fixtures: await getGroupFixtures(group.id) };
}

/**
 * Move every fixture in a group that is currently `from` to `to` — open/close and
 * their undos act on the whole occasion together (one shared entry window).
 */
export async function setGroupFixturesStatus(
  groupId: string,
  from: string,
  to: string,
  modifiedBy: string,
  extra: Record<string, unknown> = {}
): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixtures')
    .update({ game_status: to, last_modified_by: modifiedBy, last_modified_date: new Date().toISOString(), ...extra })
    .eq('group_id', groupId)
    .eq('game_status', from)
    .select('id');
  if (error) throw new Error(`Failed to update group status: ${error.message}`);
  return (data || []).map((r: any) => r.id);
}

// ============================================================================
// ENTRIES — reads
// ============================================================================

export async function getGroupEntries(groupId: string): Promise<FixtureEntry[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixture_entries')
    .select('*')
    .eq('group_id', groupId)
    .order('entered_at', { ascending: true });
  if (error) throw new Error(`Failed to fetch entries: ${error.message}`);
  return (data || []).map(mapEntry);
}

export async function getEntry(groupId: string, username: string): Promise<FixtureEntry | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixture_entries')
    .select('*')
    .eq('group_id', groupId)
    .eq('username', username)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch entry: ${error.message}`);
  return data ? mapEntry(data) : null;
}

/** A member's entries in the active season, keyed by group id. */
export async function getUserEntriesByGroup(username: string): Promise<Map<string, FixtureEntry>> {
  const supabase = getSupabaseClient();
  const seasonId = await getActiveSeasonId();
  const { data, error } = await supabase
    .from('fixture_entries')
    .select('*, fixture_groups!inner(season_id)')
    .eq('username', username)
    .eq('fixture_groups.season_id', seasonId);
  if (error) throw new Error(`Failed to fetch entries: ${error.message}`);
  const map = new Map<string, FixtureEntry>();
  for (const row of data || []) map.set(row.group_id, mapEntry(row));
  return map;
}

export async function getSelectionsForFixtures(fixtureIds: string[]): Promise<FixtureSelection[]> {
  if (fixtureIds.length === 0) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fixture_selections').select('*').in('fixture_id', fixtureIds);
  if (error) throw new Error(`Failed to fetch selections: ${error.message}`);
  return (data || []).map(mapSelection);
}

/** Everything about one group: its fixtures, entries and selections. */
export async function getGroupState(groupId: string): Promise<{
  group: FixtureGroup;
  fixtures: Fixture[];
  entries: FixtureEntry[];
  selections: FixtureSelection[];
}> {
  const [group, fixtures, entries] = await Promise.all([getGroup(groupId), getGroupFixtures(groupId), getGroupEntries(groupId)]);
  if (!group) throw new Error('Fixture group not found');
  const selections = await getSelectionsForFixtures(fixtures.map((f) => f.id));
  return { group, fixtures, entries, selections };
}

// ============================================================================
// ENTRIES — eligibility + writes
// ============================================================================

export interface EntryWarning {
  username: string;
  fullName: string;
  /** Hard reasons for a self/buddy entry; shown as confirm-anyway warnings to a captain. */
  reasons: string[];
}

/**
 * Checks shared by every way of entering: gender eligibility for every game in the
 * group, and tea duty on any fixture in the group (friendlies only — you can't play a
 * game you're making the teas for). Returns one item per username with any problems.
 */
export async function checkEntryEligibility(fixtures: Fixture[], usernames: string[]): Promise<EntryWarning[]> {
  const supabase = getSupabaseClient();
  const ids = fixtures.map((f) => f.id);
  const { data, error } = await supabase
    .from('fixtures')
    .select('id, tea_lead_username, tea_first_username, tea_second_username, fixture_type')
    .in('id', ids);
  if (error) throw new Error(`Failed to check tea duty: ${error.message}`);
  const users = usersByName(await getAllUsers());

  return usernames.map((username) => {
    const reasons: string[] = [];
    const u = users.get(username.toLowerCase());
    for (const row of data || []) {
      if ((row.fixture_type || 'Friendly') !== 'Friendly') continue;
      if ([row.tea_lead_username, row.tea_first_username, row.tea_second_username].includes(username)) {
        const f = fixtures.find((x) => x.id === row.id);
        reasons.push(`on teas for ${f ? fixtureDisplayName(f) : 'this game'}`);
      }
    }
    const mainGames = fixtures.filter((f) => !f.reserveOf);
    if (u && mainGames.length > 0 && !mainGames.some((f) => canEnterGender(u.memberType || '', (f.ladiesMen || '') as GameGender))) {
      reasons.push(`not eligible for ${mainGames[0].ladiesMen} games`);
    }
    const fullName = u && u.fullName ? u.fullName : username;
    return { username, fullName, reasons };
  });
}

export type EnterResult = 'entered' | 'already' | 'full';

/**
 * Create entries atomically (uniqueness + capacity under a row lock) via the
 * fixture_group_enter RPC. Callers run checkEntryEligibility first.
 */
export async function addEntries(opts: {
  groupId: string;
  usernames: string[];
  source: EntrySource;            // 'self' (further usernames become 'buddy') or 'manager'
  enteredBy: string;
  enforceCapacity: boolean;
  preferredFixtureId?: string | null;
  preference?: EntryPreference | null;
  carNumber?: string | null;
}): Promise<Array<{ username: string; result: EnterResult }>> {
  if (opts.usernames.length === 0) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('fixture_group_enter', {
    p_group_id: opts.groupId,
    p_usernames: opts.usernames,
    p_entry_source: opts.source,
    p_entered_by: opts.enteredBy,
    p_enforce_capacity: opts.enforceCapacity,
    p_preferred_fixture_id: orNull(opts.preferredFixtureId),
    p_preference: opts.preferredFixtureId ? (opts.preference || 'preferred') : null,
    p_car_number: orNull(opts.carNumber),
  });
  if (error) throw new Error(`Failed to enter: ${error.message}`);
  return (data || []).map((r: any) => ({ username: r.username, result: r.result as EnterResult }));
}

/** Delete an entry outright (withdrawal while the group is still open, or a captain removal). */
export async function deleteEntry(groupId: string, username: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixture_entries')
    .delete()
    .eq('group_id', groupId)
    .eq('username', username)
    .select('id');
  if (error) throw new Error(`Failed to remove entry: ${error.message}`);
  return (data || []).length > 0;
}

/** Withdraw after close: the entry (and any selection) is kept so cards can say what they were. */
export async function markEntryWithdrawn(groupId: string, username: string, withdrawnBy: string): Promise<FixtureEntry | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixture_entries')
    .update({ status: 'withdrawn', withdrawn_by: withdrawnBy, withdrawn_at: new Date().toISOString() })
    .eq('group_id', groupId)
    .eq('username', username)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to withdraw: ${error.message}`);
  return data ? mapEntry(data) : null;
}

export async function rejoinEntry(groupId: string, username: string): Promise<FixtureEntry | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixture_entries')
    .update({ status: 'entered', withdrawn_by: null, withdrawn_at: null, confirmed_at: null })
    .eq('group_id', groupId)
    .eq('username', username)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Failed to rejoin: ${error.message}`);
  return data ? mapEntry(data) : null;
}

export async function setEntryConfirmed(groupId: string, username: string, confirmed: boolean): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('fixture_entries')
    .update({ confirmed_at: confirmed ? new Date().toISOString() : null })
    .eq('group_id', groupId)
    .eq('username', username);
  if (error) throw new Error(`Failed to update confirmation: ${error.message}`);
}

// ============================================================================
// SELECTIONS — writes
// ============================================================================

export interface SelectionChange {
  username: string;
  selected?: string;          // 'Y' | 'O' = picked for this fixture; 'R' / '' / 'T' = back to the pool
  team?: number | null;
  position?: string;
  driving?: string;
  carNumber?: string;
}

/**
 * Apply a captain's selection save for one fixture. Picking someone inserts/updates
 * their selection row; changing them back to reserve deletes it (team/position/driving
 * go with it). In an occasion group a player can hold only one selection — if they were
 * just picked for another game in the group, they come back in `conflicts`.
 */
export async function saveSelections(
  fixture: Fixture,
  changes: SelectionChange[]
): Promise<{ conflicts: Array<{ username: string; fixtureName: string }> }> {
  if (!fixture.groupId) throw new Error('Game has not been opened');
  const supabase = getSupabaseClient();
  const { group, fixtures, entries, selections } = await getGroupState(fixture.groupId);
  const entryByName = new Map(entries.map((e) => [e.username.toLowerCase(), e]));
  const conflicts: Array<{ username: string; fixtureName: string }> = [];
  const isOccasion = group.kind === 'occasion';

  // A friendly player's confirmation is for what they were told; moving them between
  // reserve and playing means they need to confirm again (as the old sheet did).
  const clearConfirmation = async (entry: FixtureEntry) => {
    if (!isOccasion || !entry.confirmedAt) return;
    const { error } = await supabase.from('fixture_entries').update({ confirmed_at: null }).eq('id', entry.id);
    if (error) throw new Error(`Failed to update confirmation: ${error.message}`);
  };

  for (const c of changes) {
    const entry = entryByName.get(c.username.toLowerCase());
    if (!entry) continue; // removed since the page loaded — don't recreate
    const existing = selections.find((s) => s.entryId === entry.id && s.fixtureId === fixture.id);
    const wantsPick = c.selected === 'Y' || c.selected === 'O';

    if (!wantsPick) {
      if (existing && c.selected !== undefined) {
        const { error } = await supabase.from('fixture_selections').delete().eq('id', existing.id);
        if (error) throw new Error(`Failed to update selection: ${error.message}`);
        await clearConfirmation(entry);
      }
      continue;
    }

    const fields: Record<string, unknown> = { selection: c.selected };
    if (c.team !== undefined) fields.team = orNull(c.team);
    if (c.position !== undefined) fields.position = c.position || null;
    if (c.driving !== undefined) fields.driving = c.driving || null;
    if (c.carNumber !== undefined) fields.car_number = c.carNumber || null;

    if (existing) {
      const { error } = await supabase.from('fixture_selections').update(fields).eq('id', existing.id);
      if (error) throw new Error(`Failed to update selection: ${error.message}`);
      if (existing.selection !== c.selected) await clearConfirmation(entry);
      continue;
    }

    // Friendlies: one game per occasion. Squads: one game per day (the shared N/S squad
    // can't put someone in both N/S A and N/S B that night).
    const elsewhere = selections.find((s) => {
      if (s.entryId !== entry.id || s.fixtureId === fixture.id) return false;
      if (isOccasion) return true;
      const other = fixtures.find((f) => f.id === s.fixtureId);
      return !s.withdrawnAt && !!other && !!fixture.date && other.date === fixture.date;
    });
    if (elsewhere) {
      const other = fixtures.find((f) => f.id === elsewhere.fixtureId);
      conflicts.push({ username: entry.username, fixtureName: other ? fixtureDisplayName(other) : 'another game' });
      continue;
    }

    const { error } = await supabase.from('fixture_selections').insert({
      fixture_id: fixture.id,
      entry_id: entry.id,
      car_number: entry.carNumber,
      one_per_entry: isOccasion,
      ...fields,
    });
    if (error) {
      // 23505 = unique violation: someone picked them for another game in the group a moment ago
      if ((error as any).code === '23505') {
        conflicts.push({ username: entry.username, fixtureName: 'another game in this group' });
        continue;
      }
      throw new Error(`Failed to update selection: ${error.message}`);
    }
    await clearConfirmation(entry);
  }

  return { conflicts };
}

/** Cancel one game of a linked group and send its selected players back to the pool. */
export async function returnSelectionsToPool(fixtureId: string): Promise<number> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fixture_selections').delete().eq('fixture_id', fixtureId).select('id');
  if (error) throw new Error(`Failed to return players to reserves: ${error.message}`);
  return (data || []).length;
}

// ============================================================================
// SEASON DATA + LEGACY CODES + STATS
// ============================================================================

interface LiteFixture {
  id: string;
  groupId: string;
  tabName: string;
  date: string;      // ISO
  status: string;
  reserveOf: string | null;
}

interface SeasonOccasionData {
  fixtures: Map<string, LiteFixture>;
  groupFixtures: Map<string, LiteFixture[]>;
  entries: FixtureEntry[];
  entriesByUser: Map<string, FixtureEntry[]>;
  selectionByEntry: Map<string, FixtureSelection>;
}

/** All friendly (occasion) fixtures, entries and selections for a season, for stats/codes. */
async function loadSeasonOccasionData(seasonId?: string): Promise<SeasonOccasionData> {
  const supabase = getSupabaseClient();
  const sid = seasonId || (await getActiveSeasonId());

  const [fixtureRows, entryRows, selectionRows] = await Promise.all([
    fetchAllRows<any>((from, to) =>
      supabase
        .from('fixtures')
        .select('id, group_id, tab_name, date, game_status, reserve_of, fixture_groups!inner(kind)')
        .eq('season_id', sid)
        .eq('fixture_groups.kind', 'occasion')
        .order('id')
        .range(from, to)
    ),
    fetchAllRows<any>((from, to) =>
      supabase
        .from('fixture_entries')
        .select('*, fixture_groups!inner(season_id, kind)')
        .eq('fixture_groups.season_id', sid)
        .eq('fixture_groups.kind', 'occasion')
        .order('id')
        .range(from, to)
    ),
    fetchAllRows<any>((from, to) =>
      supabase
        .from('fixture_selections')
        .select('*, fixtures!inner(season_id)')
        .eq('fixtures.season_id', sid)
        .eq('one_per_entry', true)
        .order('id')
        .range(from, to)
    ),
  ]);

  const fixtures = new Map<string, LiteFixture>();
  const groupFixtures = new Map<string, LiteFixture[]>();
  for (const r of fixtureRows) {
    const lf: LiteFixture = {
      id: r.id,
      groupId: r.group_id,
      tabName: r.tab_name || '',
      date: r.date || '',
      status: r.game_status || '',
      reserveOf: r.reserve_of || null,
    };
    fixtures.set(lf.id, lf);
    const list = groupFixtures.get(lf.groupId) || [];
    list.push(lf);
    groupFixtures.set(lf.groupId, list);
  }
  for (const list of groupFixtures.values()) list.sort((a, b) => (a.reserveOf ? 1 : 0) - (b.reserveOf ? 1 : 0));

  const entries = entryRows.map(mapEntry);
  const entriesByUser = new Map<string, FixtureEntry[]>();
  for (const e of entries) {
    const key = e.username.toLowerCase();
    const list = entriesByUser.get(key) || [];
    list.push(e);
    entriesByUser.set(key, list);
  }

  const selectionByEntry = new Map<string, FixtureSelection>();
  for (const r of selectionRows) selectionByEntry.set(r.entry_id, mapSelection(r));

  return { fixtures, groupFixtures, entries, entriesByUser, selectionByEntry };
}

/**
 * Where an entry "sits" for status purposes: the fixture it's selected for, or — for a
 * reserve in the pool — the group's main fixture. The status is that fixture's, except
 * a pool reserve only counts as cancelled when every game in the group is C/A.
 */
function entryAnchor(
  entry: FixtureEntry,
  data: SeasonOccasionData
): { fixture: LiteFixture | null; status: string; selection: FixtureSelection | null } {
  const selection = data.selectionByEntry.get(entry.id) || null;
  if (selection) {
    const f = data.fixtures.get(selection.fixtureId) || null;
    return { fixture: f, status: f ? f.status : '', selection };
  }
  const groupList = data.groupFixtures.get(entry.groupId) || [];
  if (groupList.length === 0) return { fixture: null, status: '', selection: null };
  if (groupList.some((f) => f.status === 'O')) return { fixture: groupList[0], status: 'O', selection: null };
  if (groupList.some((f) => f.status === '')) return { fixture: groupList[0], status: '', selection: null };
  const goingAhead = groupList.find((f) => f.status !== 'C' && f.status !== 'A');
  if (goingAhead) return { fixture: goingAhead, status: goingAhead.status, selection: null };
  return { fixture: groupList[0], status: groupList.every((f) => f.status === 'A') ? 'A' : 'C', selection: null };
}

/**
 * The old Players-sheet code for an entry, derived from the real columns.
 * reveal=false hides the selection outcome until the team is published (S/P),
 * matching what players saw before.
 */
function legacyCode(entry: FixtureEntry, status: string, selection: FixtureSelection | null, reveal: boolean): PlayerEntryStatus | '' {
  if (status === 'C' || status === 'A') return status as PlayerEntryStatus;
  const withdrawn = entry.status === 'withdrawn';
  const published = status === 'S' || status === 'P';
  let base: string;
  if ((reveal || published || withdrawn) && status !== 'O' && status !== '') {
    const picked = selection ? selection.selection : null;
    base = picked === 'Y' ? 'P' : picked === 'O' ? 'D' : 'R';
  } else {
    base = entry.entrySource === 'manager' ? 'M' : 'E';
  }
  return (withdrawn ? `${base}W` : base) as PlayerEntryStatus;
}

function computeStats(username: string, data: SeasonOccasionData, excludeGroupId?: string): PlayerStats {
  const stats: PlayerStats = { nameDown: 0, picked: 0, percentPlayed: 0, futureEntered: 0, withdrawn: 0, cancelled: 0, last6Games: [] };
  const history: Array<{ date: string; label: string }> = [];

  for (const entry of data.entriesByUser.get(username.toLowerCase()) || []) {
    if (excludeGroupId && entry.groupId === excludeGroupId) continue;
    const { fixture, status, selection } = entryAnchor(entry, data);

    if (status === 'C' || status === 'A') {
      stats.cancelled++;
    } else if (entry.status === 'withdrawn') {
      stats.withdrawn++;
    } else if (status === 'O' || status === '') {
      stats.futureEntered++;
      continue; // open games have no outcome yet — not part of the history
    } else if (selection && selection.selection === 'Y') {
      stats.nameDown++;
      stats.picked++;
    } else if (!selection || selection.selection !== 'O') {
      stats.nameDown++; // a reserve in a closed game
    }

    const code = legacyCode(entry, status, selection, true);
    if (code && fixture) history.push({ date: fixture.date, label: `${fixture.tabName}    ${code}` });
  }

  stats.percentPlayed = stats.nameDown > 0 ? Math.round((stats.picked / stats.nameDown) * 100) / 100 : 0;
  history.sort((a, b) => b.date.localeCompare(a.date)); // newest first, as the UI expects
  stats.last6Games = history.slice(0, 6).map((h) => h.label);
  return stats;
}

/** Season friendly stats for one player (live — nothing stored). */
export async function getPlayerStats(userName: string): Promise<PlayerStats> {
  const data = await loadSeasonOccasionData();
  return computeStats(userName, data);
}

/** Season friendly stats for every player with an entry, keyed by lowercase username. */
export async function getAllPlayerStats(seasonId?: string): Promise<Map<string, PlayerStats>> {
  const data = await loadSeasonOccasionData(seasonId);
  const result = new Map<string, PlayerStats>();
  for (const key of data.entriesByUser.keys()) result.set(key, computeStats(key, data));
  return result;
}

/**
 * Every season entry with its derived code and fixture — for the stats pages that used
 * to scan the Players sheet. One row per entry (a pool reserve is anchored to the
 * group's main fixture).
 */
export async function getSeasonEntryCodes(seasonId?: string): Promise<Array<{
  username: string;
  fixtureId: string;
  tabName: string;
  date: string;      // DD/MM/YYYY
  status: string;    // fixture status
  code: PlayerEntryStatus | '';
  selection: 'Y' | 'O' | null;
  withdrawn: boolean;
}>> {
  const data = await loadSeasonOccasionData(seasonId);
  const rows = [];
  for (const entry of data.entries) {
    const { fixture, status, selection } = entryAnchor(entry, data);
    if (!fixture) continue;
    rows.push({
      username: entry.username,
      fixtureId: fixture.id,
      tabName: fixture.tabName,
      date: isoToUK(fixture.date),
      status,
      code: legacyCode(entry, status, selection, true),
      selection: selection ? selection.selection : null,
      withdrawn: entry.status === 'withdrawn',
    });
  }
  return rows;
}

/**
 * A player's entries in the active season, one per fixture they're attached to, with
 * the legacy code. A pool reserve in a linked group appears against every game in the
 * group they could still be picked for.
 */
export async function getPlayerEntries(userName: string): Promise<PlayerEntry[]> {
  const data = await loadSeasonOccasionData();
  const out: PlayerEntry[] = [];
  for (const entry of data.entriesByUser.get(userName.toLowerCase()) || []) {
    const selection = data.selectionByEntry.get(entry.id) || null;
    const targets = selection
      ? [data.fixtures.get(selection.fixtureId)].filter(Boolean) as LiteFixture[]
      : data.groupFixtures.get(entry.groupId) || [];
    for (const f of targets) {
      const code = legacyCode(entry, f.status, selection, false);
      if (code) out.push({ tabName: f.tabName, status: code as PlayerEntryStatus });
    }
  }
  return out;
}

// ============================================================================
// GAME ROSTER (the old per-game tab) — compat read
// ============================================================================

/**
 * The roster for one fixture, in the old game-sheet shape: everyone selected for this
 * fixture plus the group's pool (shown as 'R'). Players selected for a different game in
 * the same group aren't on this game's roster. Stats exclude this fixture's own group so
 * a captain's picks don't move the numbers they're looking at.
 */
export async function getGameSheet(tabName: string): Promise<GameSheetPlayer[]> {
  const fixture = await getFixtureByTabName(tabName);
  if (!fixture || !fixture.groupId) return [];
  return getFixtureRoster(fixture);
}

export async function getFixtureRoster(fixture: Fixture): Promise<GameSheetPlayer[]> {
  if (!fixture.groupId) return [];
  const state = await getGroupState(fixture.groupId);
  if (state.group.kind === 'squad') return getSquadFixtureRoster(fixture, state);

  const [seasonData, allUsers] = await Promise.all([loadSeasonOccasionData(fixture.seasonId), getAllUsers()]);
  const users = usersByName(allUsers);
  const players: GameSheetPlayer[] = [];

  for (const entry of state.entries) {
    const mine = state.selections.find((s) => s.entryId === entry.id && s.fixtureId === fixture.id) || null;
    const elsewhere = state.selections.some((s) => s.entryId === entry.id && s.fixtureId !== fixture.id);
    if (!mine && elsewhere) continue;

    const u = users.get(entry.username.toLowerCase());
    const stats = computeStats(entry.username, seasonData, fixture.groupId);

    players.push({
      rowNumber: players.length + 2,
      name: entry.username,
      fullName: u && u.fullName ? u.fullName : entry.username,
      lastName: u && u.lastName ? u.lastName : '',
      nameDown: stats.nameDown,
      picked: stats.picked,
      percentPlayed: stats.percentPlayed,
      futureEntered: stats.futureEntered,
      driverBar: driverBarCode(u).code,
      selected: (mine ? mine.selection : 'R') as SelectionStatus,
      team: mine ? mine.team : null,
      position: (mine ? mine.position : '') as Position,
      driving: mine ? mine.driving : '',
      carNumber: (mine && mine.carNumber) || entry.carNumber || '',
      // Friendlies withdraw and confirm per entry (reserves confirm too)
      status: (entry.status === 'withdrawn' ? 'W' : entry.confirmedAt ? 'Y' : '') as ConfirmationStatus,
      captain: fixture.captain && fixture.captain === entry.username ? 'Y' : '',
      last8Games: stats.last6Games,
      acknowledgedCancellation: entry.cancellationAcknowledgedAt ? 'Y' : '',
      preference: preferenceFor(entry, fixture, state.fixtures),
      enteredBy: entry.enteredBy || '',
      entrySource: entry.entrySource,
    });
  }
  return players;
}

/**
 * A squad fixture's roster (league squads, Club Teams) in the same shape the friendlies
 * selection page uses. Everyone in the squad is on it: picked players as Y, the rest as
 * R (the squad is effectively the reserves). Confirm/withdraw are per fixture (on the
 * selection). Stats are this squad's games: of the published/played fixtures since they
 * joined, how many they were picked for. squadNote flags "Away — Holiday" (an
 * availability override for that date/session) and, for the shared N/S squad, being
 * picked for the other team that night.
 */
async function getSquadFixtureRoster(
  fixture: Fixture,
  state: { group: FixtureGroup; fixtures: Fixture[]; entries: FixtureEntry[]; selections: FixtureSelection[] }
): Promise<GameSheetPlayer[]> {
  const users = usersByName(await getAllUsers());
  const fixtureById = new Map(state.fixtures.map((f) => [f.id, f]));
  const isoOf = (uk: string) => {
    const [d, m, y] = uk.split('/');
    return d && m && y ? `${y}-${m}-${d}` : '';
  };
  const thisIso = isoOf(fixture.date);

  // Away notes: busy availability overrides on this date covering the fixture's session
  const away = new Map<string, string>();
  if (thisIso) {
    const hour = parseInt((fixture.time || '').split(':')[0], 10);
    const session = isNaN(hour) ? 'evening' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('availability_overrides')
      .select('username, session, label')
      .eq('date', thisIso)
      .eq('status', 'busy')
      .in('username', state.entries.map((e) => e.username));
    if (error) throw new Error(`Failed to fetch availability: ${error.message}`);
    for (const o of data || []) {
      if (o.session === 'all' || o.session === session) away.set(o.username, o.label || 'Away');
    }
  }

  // The squad's settled fixtures (published/played), newest first, excluding this one
  const settled = state.fixtures
    .filter((f) => f.id !== fixture.id && (f.status === 'S' || f.status === 'P') && !!f.date)
    .sort((a, b) => isoOf(b.date).localeCompare(isoOf(a.date)));

  const players: GameSheetPlayer[] = [];
  for (const entry of state.entries) {
    const mine = state.selections.find((s) => s.entryId === entry.id && s.fixtureId === fixture.id) || null;
    // Someone who has left the squad only stays on a team sheet they're already on
    if (entry.status === 'withdrawn' && !mine) continue;

    // Games since they joined: picked (and didn't drop out) vs available
    const joinedIso = (entry.enteredAt || '').slice(0, 10);
    let nameDown = 0;
    let picked = 0;
    const history: string[] = [];
    for (const f of settled) {
      if (joinedIso && isoOf(f.date) < joinedIso) continue;
      nameDown++;
      const sel = state.selections.find((s) => s.entryId === entry.id && s.fixtureId === f.id);
      let code = 'R';
      if (sel && sel.selection === 'Y') {
        code = sel.withdrawnAt ? 'PW' : 'P';
        if (!sel.withdrawnAt) picked++;
      }
      if (history.length < 6) history.push(`${f.tabName}    ${code}`);
    }

    // Shared squad (N/S): already picked for another of the squad's fixtures that night
    let note = away.has(entry.username) ? `Away — ${away.get(entry.username)}` : '';
    if (thisIso) {
      for (const s of state.selections) {
        if (s.entryId !== entry.id || s.fixtureId === fixture.id || s.withdrawnAt) continue;
        const other = fixtureById.get(s.fixtureId);
        if (other && isoOf(other.date) === thisIso) {
          note = `Playing ${fixtureDisplayName(other)}${other.gameType ? ` (${other.gameType})` : ''} that day`;
        }
      }
    }

    const u = users.get(entry.username.toLowerCase());
    players.push({
      rowNumber: players.length + 2,
      name: entry.username,
      fullName: u && u.fullName ? u.fullName : entry.username,
      lastName: u && u.lastName ? u.lastName : '',
      nameDown,
      picked,
      percentPlayed: nameDown > 0 ? Math.round((picked / nameDown) * 100) / 100 : 0,
      futureEntered: 0,
      driverBar: driverBarCode(u).code,
      selected: (mine ? mine.selection : 'R') as SelectionStatus,
      team: mine ? mine.team : null,
      position: (mine ? mine.position : '') as Position,
      driving: mine ? mine.driving : '',
      carNumber: mine ? mine.carNumber : '',
      status: (mine && mine.withdrawnAt ? 'W' : mine && mine.confirmedAt ? 'Y' : '') as ConfirmationStatus,
      captain: fixture.captain && fixture.captain === entry.username ? 'Y' : '',
      last8Games: history,
      acknowledgedCancellation: entry.cancellationAcknowledgedAt ? 'Y' : '',
      preference: null,
      enteredBy: entry.enteredBy || '',
      entrySource: entry.entrySource,
      squadNote: note,
    });
  }
  return players;
}

/**
 * A player's linked-game preference as it applies to `fixture`. A preference for game X
 * also covers any reserve game split from X.
 */
function preferenceFor(entry: FixtureEntry, fixture: Fixture, groupFixtures: Fixture[]): GameSheetPlayer['preference'] {
  if (!entry.preferredFixtureId || !entry.preference) return null;
  const named = groupFixtures.find((f) => f.id === entry.preferredFixtureId);
  if (!named) return null;
  const forThisGame = fixture.id === named.id || fixture.reserveOf === named.id;
  return { gameName: fixtureDisplayName(named), kind: entry.preference, forThisGame };
}

/** Sort for display: Playing → Reserve → unselected → Opposition, then team, position, surname. */
export function sortGameSheetPlayers(players: GameSheetPlayer[]): GameSheetPlayer[] {
  const selectionOrder: Record<string, number> = { Y: 0, R: 1, T: 2, '': 3, O: 4 };
  const positionOrder: Record<string, number> = { S: 0, '1': 1, '2': 2, '3': 3, '': 4 };
  // Look up a sort rank, using the fallback when the value isn't in the table
  const rank = (table: Record<string, number>, key: string, fallback: number) =>
    table[key] !== undefined ? table[key] : fallback;
  return [...players].sort((a, b) => {
    const sa = rank(selectionOrder, a.selected, 3);
    const sb = rank(selectionOrder, b.selected, 3);
    if (sa !== sb) return sa - sb;
    const ta = a.team !== null ? a.team : 999;
    const tb = b.team !== null ? b.team : 999;
    if (ta !== tb) return ta - tb;
    const pa = rank(positionOrder, a.position, 4);
    const pb = rank(positionOrder, b.position, 4);
    if (pa !== pb) return pa - pb;
    return (a.lastName || a.fullName).localeCompare(b.lastName || b.fullName) || a.fullName.localeCompare(b.fullName);
  });
}

/** Everyone in a fixture's group pool/roster with their legacy code (for the entered-players list). */
export async function getEnteredPlayers(tabName: string): Promise<Array<{ userName: string; fullName: string; status: string }>> {
  const fixture = await getFixtureByTabName(tabName);
  if (!fixture) throw new Error(`Game not found: ${tabName}`);
  if (!fixture.groupId) return [];
  const [state, allUsers] = await Promise.all([getGroupState(fixture.groupId), getAllUsers()]);
  const users = usersByName(allUsers);
  const out: Array<{ userName: string; fullName: string; status: string }> = [];

  // League / Club Team: just the picked team (the rest of the squad are reserves only in
  // the sense of who could be picked — they aren't emailed or listed as the game's players)
  if (state.group.kind === 'squad') {
    for (const p of await getSquadFixtureRoster(fixture, state)) {
      if (p.selected === 'R') continue;
      const base = p.selected === 'Y' ? 'P' : p.selected === 'O' ? 'D' : 'R';
      out.push({ userName: p.name, fullName: p.fullName, status: p.status === 'W' ? `${base}W` : base });
    }
    return out;
  }

  for (const entry of state.entries) {
    const mine = state.selections.find((s) => s.entryId === entry.id && s.fixtureId === fixture.id) || null;
    const elsewhere = state.selections.some((s) => s.entryId === entry.id && s.fixtureId !== fixture.id);
    if (!mine && elsewhere) continue;
    out.push({
      userName: entry.username,
      fullName: fullNameOf(users, entry.username),
      status: legacyCode(entry, fixture.status, mine, true),
    });
  }
  return out;
}

/** Active (non-withdrawn) entries in the fixture's group. */
export async function getActiveEnteredCount(tabName: string): Promise<number> {
  const fixture = await getFixtureByTabName(tabName);
  if (!fixture || !fixture.groupId) return 0;
  return fixture.entered;
}

// ============================================================================
// PLAYERS / DRIVER-BAR / CLUBS (moved unchanged from friendlies-sheets.ts)
// ============================================================================

/** All members for the captain's "add player" picker (playing members by default). */
export async function getAllPlayers(playingMembersOnly: boolean = true): Promise<{ userName: string; fullName: string; memberType: string }[]> {
  const allUsers = await getAllUsers();
  const players = allUsers
    .filter((u) => {
      if (!u.userName || !u.userName.trim()) return false;
      if (playingMembersOnly && u.memberType) {
        const isPlaying = u.memberType.startsWith('P') || u.memberType === 'Full';
        if (!isPlaying) return false;
      }
      return true;
    })
    .map((u) => ({ userName: u.userName.trim(), fullName: (u.fullName || u.userName).trim(), memberType: u.memberType || '' }));
  players.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return players;
}

export async function getDriverBarInfo(userName: string): Promise<DriverBarInfo> {
  const users = usersByName(await getAllUsers());
  const info = driverBarCode(users.get(userName.toLowerCase()));
  return { ...info, code: info.code === '-' ? '' : info.code };
}

const _clubDetailsCache = new Map<string, { data: ClubDetails | null; ts: number }>();
const CLUB_DETAILS_CACHE_TTL_MS = 5 * 60_000;

export async function getClubDetails(clubName: string): Promise<ClubDetails | null> {
  const cached = _clubDetailsCache.get(clubName);
  if (cached && Date.now() - cached.ts < CLUB_DETAILS_CACHE_TTL_MS) return cached.data;

  const club = await getClubByName(clubName);
  if (!club) {
    _clubDetailsCache.set(clubName, { data: null, ts: Date.now() });
    return null;
  }
  const result: ClubDetails = {
    clubName: club.clubName,
    clubNumber: club.clubNumber,
    clubMobile: club.clubMobile,
    clubEmail: club.clubEmailAddress,
    clubEmailNote: club.clubEmailNote,
    generalInfo: club.generalInformation,
    drivingBand: club.drivingBand,
    petrolCost: club.petrolCost,
    miles: club.miles,
    travelTime: club.travelTime,
    address1: club.address1,
    address2: club.address2,
    address3: club.address3,
    address4: club.address4,
    postCode: club.postCode,
    googleAddress: '',
    latitude: club.latitude !== null ? String(club.latitude) : '',
    longitude: club.longitude !== null ? String(club.longitude) : '',
    bowlsEnglandUrl: '',
    website: club.website,
    bhWebsite: '',
  };
  _clubDetailsCache.set(clubName, { data: result, ts: Date.now() });
  return result;
}

export async function getClubContacts(clubName: string): Promise<ClubContact[]> {
  const contacts = await getContactsForClub(clubName);
  return contacts.map((c) => ({
    clubName: c.clubName,
    role: c.role,
    firstName: c.firstName,
    lastName: c.lastName,
    name: c.name,
    phoneNumber: c.phoneNumber,
    mobileNumber: c.mobileNumber,
    notes: c.notes,
    email: c.email,
  }));
}

// ============================================================================
// TOKENS + CANCELLATION ACKNOWLEDGEMENT
// ============================================================================

/** The player's magic-link token for this game — created with their entry, never lazily. */
export async function ensurePlayerToken(tabName: string, userName: string): Promise<string> {
  const fixture = await getFixtureByTabName(tabName);
  if (!fixture || !fixture.groupId) throw new Error(`ensurePlayerToken: game "${tabName}" has not been opened`);
  const entry = await getEntry(fixture.groupId, userName);
  if (!entry) throw new Error(`ensurePlayerToken: player "${userName}" is not entered in "${tabName}"`);
  return entry.token;
}

/**
 * Validate an email token for a game. Valid when it belongs to an entry in the
 * fixture's group and the game date hasn't passed. Same return shape as before.
 */
export async function validateGameToken(tabName: string, token: string): Promise<{
  userName: string;
  rowNumber: number;
  playerSelected: string;
  playerConfirmation: string;
  playerTeam: number | null;
  playerPosition: string;
  acknowledgedCancellation: string;
  gameStatus: string;
  gameDate: string;
} | null> {
  if (!token) return null;
  const fixture = await getFixtureByTabName(tabName);
  if (!fixture || !fixture.groupId) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixture_entries')
    .select('*')
    .eq('group_id', fixture.groupId)
    .eq('token', token)
    .maybeSingle();
  if (error || !data) return null;
  const entry = mapEntry(data);

  const [d, m, y] = fixture.date.split('/').map((n) => parseInt(n, 10));
  const gameDate = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (isNaN(gameDate.getTime()) || gameDate < today) return null;

  const roster = await getFixtureRoster(fixture);
  const me = roster.find((p) => p.name === entry.username);
  if (!me) return null; // selected for a different game in the group

  return {
    userName: entry.username,
    rowNumber: me.rowNumber,
    playerSelected: me.selected,
    playerConfirmation: me.status,
    playerTeam: me.team,
    playerPosition: me.position,
    acknowledgedCancellation: me.acknowledgedCancellation || '',
    gameStatus: fixture.status,
    gameDate: fixture.date,
  };
}

export async function acknowledgeGameCancellation(tabName: string, userName: string): Promise<void> {
  const fixture = await getFixtureByTabName(tabName);
  if (!fixture || !fixture.groupId) throw new Error(`Game "${tabName}" has not been opened`);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixture_entries')
    .update({ cancellation_acknowledged_at: new Date().toISOString() })
    .eq('group_id', fixture.groupId)
    .eq('username', userName)
    .select('id');
  if (error) throw new Error(`Failed to acknowledge: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`Player "${userName}" is not in "${tabName}"`);
}

// ============================================================================
// MANAGE LOG (replaces the ManageLog sheet tab)
// ============================================================================

/** Append an audit row. Never throws — logging must not block the action being logged. */
export async function appendManageLog(entry: {
  username: string;
  action: string;
  tabName?: string;
  fixtureId?: string | null;
  groupId?: string | null;
  oldStatus?: string;
  newStatus?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from('friendlies_manage_log').insert({
      username: entry.username || null,
      action: entry.action,
      tab_name: orNull(entry.tabName),
      fixture_id: orNull(entry.fixtureId),
      group_id: orNull(entry.groupId),
      old_status: orNull(entry.oldStatus),
      new_status: orNull(entry.newStatus),
      details: orNull(entry.details),
    });
  } catch {
    // Never let logging failure propagate
  }
}

// ============================================================================
// PLAYER ACTIONS ON ONE FIXTURE — friendlies act on the entry, squads on the selection
// ============================================================================
// Friendlies: a player is in one game of the occasion, so confirm/withdraw/rejoin are on
// their entry. Squads (league / Club Team): the entry is squad membership for the whole
// season, so these act on that fixture's selection only — withdrawing from a game never
// takes anyone out of the squad.

async function squadEntryAndSelection(fixture: Fixture, username: string): Promise<{ entry: FixtureEntry | null; selection: FixtureSelection | null }> {
  const entry = fixture.groupId ? await getEntry(fixture.groupId, username) : null;
  if (!entry) return { entry: null, selection: null };
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixture_selections')
    .select('*')
    .eq('fixture_id', fixture.id)
    .eq('entry_id', entry.id)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch selection: ${error.message}`);
  return { entry, selection: data ? mapSelection(data) : null };
}

async function isSquadFixture(fixture: Fixture): Promise<boolean> {
  if (!fixture.groupId) return false;
  const group = await getGroup(fixture.groupId);
  return !!group && group.kind === 'squad';
}

/** Confirm (or un-confirm) a player for a fixture. */
export async function confirmForFixture(fixture: Fixture, username: string, confirmed: boolean): Promise<void> {
  if (!fixture.groupId) throw new Error('Game has not been opened');
  if (!(await isSquadFixture(fixture))) {
    await setEntryConfirmed(fixture.groupId, username, confirmed);
    return;
  }
  const { selection } = await squadEntryAndSelection(fixture, username);
  if (!selection) return; // squad reserves have nothing to confirm
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('fixture_selections')
    .update({ confirmed_at: confirmed ? new Date().toISOString() : null })
    .eq('id', selection.id);
  if (error) throw new Error(`Failed to update confirmation: ${error.message}`);
}

/**
 * Withdraw a player from a fixture after selection. Friendlies: the entry is withdrawn.
 * Squads: a picked player drops out of this game ('withdrawn'); a squad reserve is marked
 * as not available that day instead ('unavailable') — they stay in the squad either way.
 */
export async function withdrawFromFixture(fixture: Fixture, username: string, by: string): Promise<'withdrawn' | 'unavailable' | 'none'> {
  if (!fixture.groupId) return 'none';
  if (!(await isSquadFixture(fixture))) {
    const entry = await markEntryWithdrawn(fixture.groupId, username, by);
    return entry ? 'withdrawn' : 'none';
  }
  const { entry, selection } = await squadEntryAndSelection(fixture, username);
  if (!entry) return 'none';
  if (selection) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('fixture_selections')
      .update({ withdrawn_at: new Date().toISOString(), withdrawn_by: by })
      .eq('id', selection.id);
    if (error) throw new Error(`Failed to withdraw: ${error.message}`);
    return 'withdrawn';
  }
  if (fixture.date) {
    const hour = parseInt((fixture.time || '').split(':')[0], 10);
    const session = isNaN(hour) ? 'evening' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const { addOverride } = await import('./member-availability');
    await addOverride(username, fixture.date, session, 'busy', `Can't make ${fixtureDisplayName(fixture)}`);
    return 'unavailable';
  }
  return 'none';
}

/** Undo a withdrawal: friendlies rejoin the occasion; squads rejoin this one game. */
export async function rejoinFixture(fixture: Fixture, username: string): Promise<void> {
  if (!fixture.groupId) return;
  if (!(await isSquadFixture(fixture))) {
    await rejoinEntry(fixture.groupId, username);
    return;
  }
  const { selection } = await squadEntryAndSelection(fixture, username);
  if (!selection) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('fixture_selections')
    .update({ withdrawn_at: null, withdrawn_by: null, confirmed_at: null })
    .eq('id', selection.id);
  if (error) throw new Error(`Failed to rejoin: ${error.message}`);
}
