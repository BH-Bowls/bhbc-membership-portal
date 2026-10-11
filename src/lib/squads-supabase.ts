// src/lib/squads-supabase.ts
// Squads — season-long fixture groups (kind 'squad') for the external leagues (MSL, BL,
// JSL, N/S). Phase 3 of specs/FIXTURE_GROUPS_SPEC.md; Club Teams (Phase 4) will reuse it.
//
// A squad is a fixture_group: its entries are the squad members (players join/leave
// themselves for a league), its fixtures are that season's league fixtures, and each
// week the organiser picks squad members into teams for a fixture (fixture_selections,
// one row per player per fixture — unlike friendlies, a player is picked for many
// fixtures across the season). No reserves: only the picked teams.
//
// Managers: anyone in fixture_group_managers for the squad, plus Captain and Admin for
// every squad. League teas (home fixtures) are two squad members — playing or not —
// stored in the fixture's tea_lead_username / tea_first_username.

import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';
import type { User } from './sheets';
import { getActiveSeasonId, mapFixtureRow, type Fixture } from './fixtures-supabase';
import { addEntries, markEntryWithdrawn, rejoinEntry, type FixtureGroup } from './fixture-groups-supabase';
import { hasRole } from './role-utils';
import { canEnterGame as canEnterGender, type GameGender } from './member-type-utils';
import { addOverride } from './member-availability';

// ============================================================================
// LEAGUES
// ============================================================================

export interface LeagueDefinition {
  leagueType: string;      // stored on fixture_groups.league_type
  label: string;
  fixtureTypes: string[];  // fixtures.fixture_type values this squad plays
}

// One squad per league per season. N/S A and N/S B are separate squads, each with its
// own players and organisers.
export const LEAGUES: LeagueDefinition[] = [
  { leagueType: 'MSL', label: 'MSL', fixtureTypes: ['MSL'] },
  { leagueType: 'BL', label: 'BL', fixtureTypes: ['BL'] },
  { leagueType: 'JSL', label: 'JSL', fixtureTypes: ['JSL'] },
  { leagueType: 'N/S A', label: 'N/S A', fixtureTypes: ['N/S A'] },
  { leagueType: 'N/S B', label: 'N/S B', fixtureTypes: ['N/S B'] },
];

export function getLeague(leagueType: string | null): LeagueDefinition | null {
  for (const league of LEAGUES) {
    if (league.leagueType === leagueType) return league;
  }
  return null;
}

// ============================================================================
// TYPES
// ============================================================================

export interface SquadSummary {
  id: string;
  label: string;
  leagueType: string | null;
  squadType: 'league' | 'club_team' | null;
  entryMode: 'self' | 'manager';            // self = members join themselves (leagues); manager = organiser picks (Club Teams)
  memberCount: number;
  fixtureCount: number;
  managers: Array<{ username: string; fullName: string }>;
  myStatus: 'member' | 'withdrawn' | null;   // the viewer's place in the squad
  canManage: boolean;
}

export interface SquadMember {
  username: string;
  fullName: string;
  status: 'entered' | 'withdrawn';
  entrySource: string;
  appearances: number;        // picked for a published or played fixture (not withdrawn)
}

export interface SquadFixturePlayer {
  username: string;
  fullName: string;
  team: number | null;
  position: string;
  withdrawn: boolean;
}

export interface SquadFixture {
  id: string;
  tabName: string;            // key for the friendlies game pages (selection, player view, match card)
  date: string;               // DD/MM/YYYY
  time: string;
  fixtureType: string;        // e.g. 'N/S A'
  opponent: string;
  clubName: string;           // directory club ('' when the opponent is free text)
  description: string;        // free-text opponent (Club Team fixtures)
  homeAway: 'H' | 'A';
  format: string;
  ladiesMen: string;
  status: string;             // '' | X | S | P | C | A
  result: 'W' | 'L' | 'D' | null;
  bhbcScore: number | null;
  opponentScore: number | null;
  teaLead: string;            // username or ''
  teaFirst: string;
  players: SquadFixturePlayer[];  // the picked teams (managers always; others once published)
  myPick: 'playing' | 'withdrawn' | null;
  myTeas: boolean;
  myUnavailable: boolean;
}

export interface SquadDetail {
  group: FixtureGroup;
  canManage: boolean;
  managers: Array<{ username: string; fullName: string }>;
  members: SquadMember[];
  fixtures: SquadFixture[];
  myEntry: { status: 'entered' | 'withdrawn' } | null;
}

// ============================================================================
// SMALL HELPERS
// ============================================================================

function usersByName(users: User[]): Map<string, User> {
  const map = new Map<string, User>();
  for (const u of users) {
    if (u.userName) map.set(u.userName.toLowerCase(), u);
  }
  return map;
}

function fullNameOf(users: Map<string, User>, username: string): string {
  const u = users.get(username.toLowerCase());
  if (u && u.fullName) return u.fullName;
  return username;
}

/** Opponent label: club + suffix, else the free-text description. */
export function opponentOf(f: Pick<Fixture, 'clubName' | 'clubSuffix' | 'description'>): string {
  const club = [f.clubName, f.clubSuffix].filter(Boolean).join(' ');
  if (club) return club;
  if (f.description) return f.description;
  return 'TBC';
}

/** Availability session a fixture falls in, from its start time (evening league games). */
export function sessionForTime(time: string): 'morning' | 'afternoon' | 'evening' {
  const hour = parseInt((time || '').split(':')[0], 10);
  if (isNaN(hour)) return 'evening';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function ukToIso(uk: string): string {
  const parts = uk.split('/');
  if (parts.length !== 3) return uk;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function mapGroupRow(row: any): FixtureGroup {
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

// ============================================================================
// PERMISSIONS + MANAGERS
// ============================================================================

export async function getSquadManagers(groupId: string): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fixture_group_managers').select('username').eq('group_id', groupId);
  if (error) throw new Error(`Failed to fetch squad managers: ${error.message}`);
  const names: string[] = [];
  for (const row of data || []) names.push(row.username);
  return names;
}

/** Captain and Admin manage every squad; anyone else only squads they're a manager of. */
export async function canManageSquad(groupId: string, username: string, role: string | undefined | null): Promise<boolean> {
  if (hasRole(role, 'Captain', 'Admin')) return true;
  const managers = await getSquadManagers(groupId);
  return managers.includes(username);
}

/** Replace the squad's managers with exactly this list. */
export async function setSquadManagers(groupId: string, usernames: string[], addedBy: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error: delError } = await supabase.from('fixture_group_managers').delete().eq('group_id', groupId);
  if (delError) throw new Error(`Failed to update managers: ${delError.message}`);
  const unique = Array.from(new Set(usernames.filter(Boolean)));
  if (unique.length === 0) return;
  const rows = unique.map(username => ({ group_id: groupId, username, added_by: addedBy }));
  const { error } = await supabase.from('fixture_group_managers').insert(rows);
  if (error) throw new Error(`Failed to update managers: ${error.message}`);
}

// ============================================================================
// SQUADS
// ============================================================================

export async function getSquadGroup(groupId: string): Promise<FixtureGroup | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fixture_groups').select('*').eq('id', groupId).eq('kind', 'squad').maybeSingle();
  if (error) throw new Error(`Failed to fetch squad: ${error.message}`);
  if (!data) return null;
  return mapGroupRow(data);
}

/**
 * Attach any of the season's league fixtures not yet in the squad (e.g. added later in
 * Season Planning). Cheap and idempotent — run whenever a squad is loaded.
 */
async function attachLeagueFixtures(group: FixtureGroup): Promise<void> {
  const league = getLeague(group.leagueType);
  if (!league || group.squadType !== 'league') return;
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('fixtures')
    .update({ group_id: group.id })
    .eq('season_id', group.seasonId)
    .in('fixture_type', league.fixtureTypes)
    .is('group_id', null);
  if (error) throw new Error(`Failed to attach league fixtures: ${error.message}`);
}

/** Create the season's squad for one league (one per league per season). */
export async function createLeagueSquad(leagueType: string, createdBy: string, managers: string[]): Promise<FixtureGroup> {
  const league = getLeague(leagueType);
  if (!league) throw new Error(`Unknown league: ${leagueType}`);
  const supabase = getSupabaseClient();
  const seasonId = await getActiveSeasonId();

  const { data: existing, error: existingError } = await supabase
    .from('fixture_groups')
    .select('id')
    .eq('season_id', seasonId)
    .eq('kind', 'squad')
    .eq('league_type', leagueType)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) throw new Error(`There is already a ${league.label} squad for this season`);

  const { data: season, error: seasonError } = await supabase.from('seasons').select('year').eq('id', seasonId).single();
  if (seasonError || !season) throw new Error('Active season not found');

  const { data: inserted, error } = await supabase
    .from('fixture_groups')
    .insert({
      season_id: seasonId,
      kind: 'squad',
      entry_mode: 'self',
      squad_type: 'league',
      league_type: leagueType,
      label: `${league.label} ${season.year}`,
      created_by: createdBy,
    })
    .select('*')
    .single();
  if (error || !inserted) throw new Error(`Failed to create squad: ${error ? error.message : 'unknown error'}`);

  const group = mapGroupRow(inserted);
  await setSquadManagers(group.id, managers, createdBy);
  await attachLeagueFixtures(group);
  return group;
}

/** The active season's squads, with the viewer's place in each. */
export async function getSquadSummaries(viewer: string, role: string | undefined | null): Promise<SquadSummary[]> {
  const supabase = getSupabaseClient();
  const seasonId = await getActiveSeasonId();
  const { data: groups, error } = await supabase
    .from('fixture_groups')
    .select('*')
    .eq('season_id', seasonId)
    .eq('kind', 'squad')
    .eq('status', 'active')
    .order('label');
  if (error) throw new Error(`Failed to fetch squads: ${error.message}`);
  if (!groups || groups.length === 0) return [];

  for (const g of groups) {
    await attachLeagueFixtures(mapGroupRow(g));
    await ensureSquadFixtureKeys(g.id);
  }

  const ids = groups.map(g => g.id);
  const [entriesResp, fixturesResp, managersResp, allUsers] = await Promise.all([
    supabase.from('fixture_entries').select('group_id, username, status').in('group_id', ids),
    supabase.from('fixtures').select('id, group_id').in('group_id', ids),
    supabase.from('fixture_group_managers').select('group_id, username').in('group_id', ids),
    getAllUsers(),
  ]);
  if (entriesResp.error) throw new Error(entriesResp.error.message);
  if (fixturesResp.error) throw new Error(fixturesResp.error.message);
  if (managersResp.error) throw new Error(managersResp.error.message);
  const users = usersByName(allUsers);
  const isCaptainOrAdmin = hasRole(role, 'Captain', 'Admin');

  const summaries: SquadSummary[] = [];
  for (const g of groups) {
    let memberCount = 0;
    let myStatus: SquadSummary['myStatus'] = null;
    for (const e of entriesResp.data || []) {
      if (e.group_id !== g.id) continue;
      if (e.status === 'entered') memberCount++;
      if (e.username === viewer) myStatus = e.status === 'entered' ? 'member' : 'withdrawn';
    }
    let fixtureCount = 0;
    for (const f of fixturesResp.data || []) {
      if (f.group_id === g.id) fixtureCount++;
    }
    const managers: Array<{ username: string; fullName: string }> = [];
    for (const m of managersResp.data || []) {
      if (m.group_id === g.id) managers.push({ username: m.username, fullName: fullNameOf(users, m.username) });
    }
    summaries.push({
      id: g.id,
      label: g.label,
      leagueType: g.league_type || null,
      squadType: g.squad_type || null,
      entryMode: g.entry_mode === 'manager' ? 'manager' : 'self',
      memberCount,
      fixtureCount,
      managers,
      myStatus,
      canManage: isCaptainOrAdmin || managers.some(m => m.username === viewer),
    });
  }
  return summaries;
}

/** Everything the squad page needs, shaped for the viewer. */
export async function getSquadDetail(groupId: string, viewer: string, role: string | undefined | null): Promise<SquadDetail | null> {
  const group = await getSquadGroup(groupId);
  if (!group) return null;
  await attachLeagueFixtures(group);
  await ensureSquadFixtureKeys(groupId);

  const supabase = getSupabaseClient();
  const [entriesResp, fixturesResp, managerNames, allUsers] = await Promise.all([
    supabase.from('fixture_entries').select('*').eq('group_id', groupId).order('entered_at'),
    supabase.from('fixtures').select('*').eq('group_id', groupId),
    getSquadManagers(groupId),
    getAllUsers(),
  ]);
  if (entriesResp.error) throw new Error(entriesResp.error.message);
  if (fixturesResp.error) throw new Error(fixturesResp.error.message);
  const users = usersByName(allUsers);
  const canManage = hasRole(role, 'Captain', 'Admin') || managerNames.includes(viewer);

  const fixtures = (fixturesResp.data || []).map(mapFixtureRow);
  // By date; Club Team fixtures still waiting for a date ("TBC") go last
  fixtures.sort((a, b) => {
    if (!a.date || !b.date) return (a.date ? 0 : 1) - (b.date ? 0 : 1);
    return ukToIso(a.date).localeCompare(ukToIso(b.date)) || (a.time || '').localeCompare(b.time || '');
  });
  const fixtureIds = fixtures.map(f => f.id);

  const entries = entriesResp.data || [];
  const entryById = new Map<string, any>();
  for (const e of entries) entryById.set(e.id, e);

  const selections: any[] = [];
  if (fixtureIds.length > 0) {
    const { data, error } = await supabase.from('fixture_selections').select('*').in('fixture_id', fixtureIds);
    if (error) throw new Error(error.message);
    for (const s of data || []) selections.push(s);
  }

  // The viewer's own "can't make it" overrides across the season's fixture dates
  const myBusy = new Set<string>();
  const dated = fixtures.filter(f => !!f.date);
  if (dated.length > 0) {
    const { data, error } = await supabase
      .from('availability_overrides')
      .select('date, session')
      .eq('username', viewer)
      .eq('status', 'busy')
      .gte('date', ukToIso(dated[0].date))
      .lte('date', ukToIso(dated[dated.length - 1].date));
    if (error) throw new Error(error.message);
    for (const o of data || []) myBusy.add(`${o.date}|${o.session}`);
  }

  // Appearances: picked (not withdrawn) for a published or played fixture
  const statusById = new Map<string, string>();
  for (const f of fixtures) statusById.set(f.id, f.status);
  const appearances = new Map<string, number>();
  for (const s of selections) {
    const st = statusById.get(s.fixture_id) || '';
    if (s.selection !== 'Y' || s.withdrawn_at || (st !== 'S' && st !== 'P')) continue;
    appearances.set(s.entry_id, (appearances.get(s.entry_id) || 0) + 1);
  }

  const members: SquadMember[] = entries.map(e => ({
    username: e.username,
    fullName: fullNameOf(users, e.username),
    status: e.status,
    entrySource: e.entry_source,
    appearances: appearances.get(e.id) || 0,
  }));
  members.sort((a, b) => a.fullName.localeCompare(b.fullName));

  let myEntryRow: any = null;
  for (const e of entries) {
    if (e.username === viewer) myEntryRow = e;
  }

  const squadFixtures: SquadFixture[] = fixtures.map(f => {
    const published = f.status === 'S' || f.status === 'P';
    const players: SquadFixturePlayer[] = [];
    let myPick: SquadFixture['myPick'] = null;
    for (const s of selections) {
      if (s.fixture_id !== f.id) continue;
      const entry = entryById.get(s.entry_id);
      if (!entry) continue;
      if (entry.username === viewer && published) myPick = s.withdrawn_at ? 'withdrawn' : 'playing';
      if (!canManage && !published) continue;
      players.push({
        username: entry.username,
        fullName: fullNameOf(users, entry.username),
        team: s.team === null || s.team === undefined ? null : s.team,
        position: s.position || '',
        withdrawn: !!s.withdrawn_at,
      });
    }
    players.sort((a, b) => (a.team || 99) - (b.team || 99) || positionRank(a.position) - positionRank(b.position));

    const iso = ukToIso(f.date);
    const session = sessionForTime(f.time);
    return {
      id: f.id,
      tabName: f.tabName,
      date: f.date,
      time: (f.time || '').slice(0, 5),
      fixtureType: f.gameType,
      opponent: opponentOf(f),
      clubName: f.clubName,
      description: f.description || '',
      homeAway: f.homeAway,
      format: f.format,
      ladiesMen: f.ladiesMen,
      status: f.status,
      result: f.result,
      bhbcScore: f.bhbcScore,
      opponentScore: f.opponentScore,
      teaLead: teaOf(fixturesResp.data || [], f.id, 'tea_lead_username'),
      teaFirst: teaOf(fixturesResp.data || [], f.id, 'tea_first_username'),
      players,
      myPick,
      myTeas: published && (teaOf(fixturesResp.data || [], f.id, 'tea_lead_username') === viewer || teaOf(fixturesResp.data || [], f.id, 'tea_first_username') === viewer),
      myUnavailable: myBusy.has(`${iso}|all`) || myBusy.has(`${iso}|${session}`),
    };
  });

  return {
    group,
    canManage,
    managers: managerNames.map(username => ({ username, fullName: fullNameOf(users, username) })),
    members,
    fixtures: squadFixtures,
    myEntry: myEntryRow ? { status: myEntryRow.status } : null,
  };
}

function teaOf(rows: any[], fixtureId: string, column: string): string {
  for (const r of rows) {
    if (r.id === fixtureId) return r[column] || '';
  }
  return '';
}

function positionRank(position: string): number {
  const order: Record<string, number> = { S: 0, '1': 1, '2': 2, '3': 3 };
  return order[position] !== undefined ? order[position] : 9;
}

// ============================================================================
// JOINING AND LEAVING
// ============================================================================

/** Gender eligibility for a league squad, from its fixtures' Ladies/Men field. */
export async function checkSquadEligibility(groupId: string, username: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fixtures').select('ladies_men').eq('group_id', groupId);
  if (error) throw new Error(error.message);
  const users = usersByName(await getAllUsers());
  const u = users.get(username.toLowerCase());
  if (!u) return 'Member not found';
  const sections = new Set<string>();
  for (const row of data || []) {
    if (row.ladies_men) sections.add(row.ladies_men);
  }
  if (sections.size === 0) return null;
  for (const section of sections) {
    if (canEnterGender(u.memberType || '', section as GameGender)) return null;
  }
  return `not eligible for ${Array.from(sections).join('/')} games`;
}

/** Join (or rejoin) a squad. `byManager` = a manager adding someone. */
export async function joinSquad(groupId: string, username: string, by: string, byManager: boolean): Promise<'joined' | 'rejoined' | 'already'> {
  const supabase = getSupabaseClient();
  const { data: existing, error } = await supabase
    .from('fixture_entries')
    .select('status')
    .eq('group_id', groupId)
    .eq('username', username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) {
    if (existing.status === 'entered') return 'already';
    await rejoinEntry(groupId, username);
    return 'rejoined';
  }
  await addEntries({
    groupId,
    usernames: [username],
    source: byManager ? 'manager' : 'self',
    enteredBy: by,
    enforceCapacity: false,
  });
  return 'joined';
}

/**
 * Leave a squad. Their picks for fixtures not yet played are dropped, and any tea slots
 * they hold on upcoming fixtures are cleared — returned so the managers can be told.
 */
export async function leaveSquad(groupId: string, username: string, by: string): Promise<{ clearedTeas: SquadFixtureRef[]; droppedPicks: SquadFixtureRef[] }> {
  const supabase = getSupabaseClient();
  const entry = await markEntryWithdrawn(groupId, username, by);
  const clearedTeas: SquadFixtureRef[] = [];
  const droppedPicks: SquadFixtureRef[] = [];
  if (!entry) return { clearedTeas, droppedPicks };

  const { data: fixtureRows, error } = await supabase.from('fixtures').select('*').eq('group_id', groupId);
  if (error) throw new Error(error.message);
  const today = new Date().toISOString().slice(0, 10);

  for (const row of fixtureRows || []) {
    // Undated (TBC) fixtures count as upcoming
    const upcoming = (!row.date || row.date >= today) && !['P', 'C', 'A'].includes(row.game_status || '');
    if (!upcoming) continue;
    const f = mapFixtureRow(row);
    const ref = { id: f.id, date: f.date, opponent: opponentOf(f), fixtureType: f.gameType };

    const teaUpdate: Record<string, null> = {};
    if (row.tea_lead_username === username) teaUpdate.tea_lead_username = null;
    if (row.tea_first_username === username) teaUpdate.tea_first_username = null;
    if (Object.keys(teaUpdate).length > 0) {
      const { error: teaError } = await supabase.from('fixtures').update(teaUpdate).eq('id', f.id);
      if (teaError) throw new Error(teaError.message);
      clearedTeas.push(ref);
    }

    const { data: removed, error: selError } = await supabase
      .from('fixture_selections')
      .delete()
      .eq('fixture_id', f.id)
      .eq('entry_id', entry.id)
      .select('id');
    if (selError) throw new Error(selError.message);
    if (removed && removed.length > 0) droppedPicks.push(ref);
  }
  return { clearedTeas, droppedPicks };
}

export interface SquadFixtureRef {
  id: string;
  date: string;
  opponent: string;
  fixtureType: string;
}

// ============================================================================
// ONE FIXTURE: STATUS, RESULT, WITHDRAW, AVAILABILITY
// ============================================================================

export type SquadFixtureAction = 'publish' | 'unpublish' | 'result' | 'cancel' | 'reinstate';

export async function setSquadFixtureStatus(
  fixtureId: string,
  action: SquadFixtureAction,
  by: string,
  outcome?: { result?: 'W' | 'L' | 'D'; bhbcScore?: number | null; opponentScore?: number | null; reason?: string }
): Promise<string> {
  const supabase = getSupabaseClient();
  const { data: row, error } = await supabase.from('fixtures').select('game_status, date').eq('id', fixtureId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error('Fixture not found');
  const current = row.game_status || '';

  const updates: Record<string, unknown> = { last_modified_by: by, last_modified_date: new Date().toISOString() };
  if (action === 'publish') {
    if (!['', 'X'].includes(current)) throw new Error('Only a fixture still being picked can be published');
    if (!row.date) throw new Error('Set the date before publishing the team');
    updates.game_status = 'S';
  } else if (action === 'unpublish') {
    if (current !== 'S') throw new Error('Only a published fixture can be unpublished');
    updates.game_status = 'X';
  } else if (action === 'result') {
    if (!outcome || !outcome.result || !['W', 'L', 'D'].includes(outcome.result)) throw new Error('Result must be W, L or D');
    updates.game_status = 'P';
    updates.result = outcome.result;
    updates.bhbc_score = outcome.bhbcScore === undefined ? null : outcome.bhbcScore;
    updates.opponent_score = outcome.opponentScore === undefined ? null : outcome.opponentScore;
  } else if (action === 'cancel') {
    updates.game_status = 'C';
    updates.reason = outcome && outcome.reason ? outcome.reason : null;
  } else if (action === 'reinstate') {
    if (!['P', 'C'].includes(current)) throw new Error('Only a played or cancelled fixture can be reinstated');
    updates.game_status = 'S';
    updates.result = null;
  }

  const { error: upError } = await supabase.from('fixtures').update(updates).eq('id', fixtureId);
  if (upError) throw new Error(upError.message);
  return String(updates.game_status || current);
}

/** A picked player drops out of one fixture (they stay in the squad). */
export async function withdrawFromSquadFixture(fixtureId: string, username: string, by: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data: fxRow, error } = await supabase.from('fixtures').select('group_id').eq('id', fixtureId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!fxRow || !fxRow.group_id) return false;
  const { data: entry, error: entryError } = await supabase
    .from('fixture_entries')
    .select('id')
    .eq('group_id', fxRow.group_id)
    .eq('username', username)
    .maybeSingle();
  if (entryError) throw new Error(entryError.message);
  if (!entry) return false;
  const { data, error: upError } = await supabase
    .from('fixture_selections')
    .update({ withdrawn_at: new Date().toISOString(), withdrawn_by: by })
    .eq('fixture_id', fixtureId)
    .eq('entry_id', entry.id)
    .is('withdrawn_at', null)
    .select('id');
  if (upError) throw new Error(upError.message);
  return !!data && data.length > 0;
}

/**
 * "Can't make this one" — written as a busy availability override for that date and
 * session, so it also shows on the member's availability page (and vice versa: a holiday
 * entered there shows on the organiser's selection page).
 */
export async function setSquadFixtureUnavailable(fixture: { date: string; time: string; label: string }, username: string, unavailable: boolean): Promise<void> {
  const session = sessionForTime(fixture.time);
  if (unavailable) {
    await addOverride(username, fixture.date, session, 'busy', `Can't make ${fixture.label}`);
    return;
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('availability_overrides')
    .delete()
    .eq('username', username)
    .eq('date', ukToIso(fixture.date))
    .eq('session', session);
  if (error) throw new Error(`Failed to update availability: ${error.message}`);
}

// ============================================================================
// DIARY
// ============================================================================

export interface SquadDiaryEntry {
  kind: 'playing' | 'teas';
  date: string;        // ISO
  label: string;       // "N/S A v Preston (Home)"
  squadLabel: string;
  fixtureId: string;
  tabName: string;     // for the game page link
}

/** Upcoming published squad fixtures the member is playing in or on teas for. */
export async function getSquadDiaryEntries(username: string, todayIso: string): Promise<SquadDiaryEntry[]> {
  const supabase = getSupabaseClient();
  const seasonId = await getActiveSeasonId();
  const { data: groups, error } = await supabase
    .from('fixture_groups')
    .select('id, label')
    .eq('season_id', seasonId)
    .eq('kind', 'squad');
  if (error) throw new Error(error.message);
  if (!groups || groups.length === 0) return [];
  const labelById = new Map<string, string>();
  for (const g of groups) labelById.set(g.id, g.label);
  const groupIds = groups.map(g => g.id);

  const [fixturesResp, entriesResp] = await Promise.all([
    supabase.from('fixtures').select('*').in('group_id', groupIds).eq('game_status', 'S').gte('date', todayIso),
    supabase.from('fixture_entries').select('id, group_id').eq('username', username).in('group_id', groupIds),
  ]);
  if (fixturesResp.error) throw new Error(fixturesResp.error.message);
  if (entriesResp.error) throw new Error(entriesResp.error.message);
  const fixtures = fixturesResp.data || [];
  if (fixtures.length === 0) return [];

  const myEntryIds = (entriesResp.data || []).map(e => e.id);
  const playing = new Set<string>();
  if (myEntryIds.length > 0) {
    const { data: sel, error: selError } = await supabase
      .from('fixture_selections')
      .select('fixture_id')
      .in('entry_id', myEntryIds)
      .in('fixture_id', fixtures.map(f => f.id))
      .is('withdrawn_at', null);
    if (selError) throw new Error(selError.message);
    for (const s of sel || []) playing.add(s.fixture_id);
  }

  const out: SquadDiaryEntry[] = [];
  for (const row of fixtures) {
    const f = mapFixtureRow(row);
    const label = `${f.gameType} v ${opponentOf(f)} (${f.homeAway === 'H' ? 'Home' : 'Away'})`;
    const squadLabel = labelById.get(row.group_id) || '';
    if (playing.has(f.id)) out.push({ kind: 'playing', date: row.date, label, squadLabel, fixtureId: f.id, tabName: f.tabName });
    if (row.tea_lead_username === username || row.tea_first_username === username) {
      out.push({ kind: 'teas', date: row.date, label, squadLabel, fixtureId: f.id, tabName: f.tabName });
    }
  }
  return out;
}

// ============================================================================
// CLUB TEAMS (Phase 4) — manager-run squads with ad-hoc fixtures
// ============================================================================

/**
 * Start a Club Team (e.g. "Gladys Rowland 2027", Top Clubs, Tony Alcock). Any member
 * can; they become its organiser. The organiser builds the squad (no self-entry).
 */
export async function createClubTeam(label: string, createdBy: string, coManagers: string[]): Promise<FixtureGroup> {
  const name = label.trim();
  if (!name) throw new Error('Give the team a name');
  const supabase = getSupabaseClient();
  const seasonId = await getActiveSeasonId();

  const { data: clash, error: clashError } = await supabase
    .from('fixture_groups')
    .select('id')
    .eq('season_id', seasonId)
    .eq('kind', 'squad')
    .ilike('label', name)
    .maybeSingle();
  if (clashError) throw new Error(clashError.message);
  if (clash) throw new Error(`There is already a squad called "${name}" this season`);

  const { data: inserted, error } = await supabase
    .from('fixture_groups')
    .insert({
      season_id: seasonId,
      kind: 'squad',
      entry_mode: 'manager',
      squad_type: 'club_team',
      label: name,
      created_by: createdBy,
    })
    .select('*')
    .single();
  if (error || !inserted) throw new Error(`Failed to create team: ${error ? error.message : 'unknown error'}`);

  const group = mapGroupRow(inserted);
  await setSquadManagers(group.id, [createdBy, ...coManagers], createdBy);
  return group;
}

export interface ClubTeamFixtureInput {
  date: string;            // YYYY-MM-DD from a date input, or '' when not agreed yet
  time: string;            // HH:MM or ''
  clubName: string;        // a club from the directory, or ''
  opponentText: string;    // free text when the opponent isn't in the directory (or 'TBC')
  homeAway: 'H' | 'A';
  format: string;
  ladiesMen: string;
}

function clubTeamFixtureColumns(input: ClubTeamFixtureInput): Record<string, unknown> {
  const club = input.clubName.trim();
  return {
    date: input.date ? input.date : null,
    time: input.time ? input.time : null,
    // club_name has a FK to the club directory — anything else goes in description
    club_name: club || null,
    description: club ? null : (input.opponentText.trim() || 'TBC'),
    home_away: input.homeAway === 'A' ? 'A' : 'H',
    format: input.format.trim() || null,
    ladies_men: input.ladiesMen.trim() || null,
  };
}

/** Add a fixture to a Club Team as a round comes up — the date can follow later. */
export async function addClubTeamFixture(group: FixtureGroup, input: ClubTeamFixtureInput, by: string): Promise<string> {
  if (group.squadType !== 'club_team') throw new Error('Fixtures can only be added to a Club Team');
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixtures')
    .insert({
      season_id: group.seasonId,
      fixture_type: 'Club Team',
      group_id: group.id,
      game_status: '',
      last_modified_by: by,
      last_modified_date: new Date().toISOString(),
      ...clubTeamFixtureColumns(input),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Failed to add fixture: ${error ? error.message : 'unknown error'}`);
  await ensureSquadFixtureKeys(group.id); // tab name + Selecting, for the friendlies pages
  return data.id;
}

/** Edit a Club Team fixture's details (date agreed, opponent known, venue…). */
export async function updateClubTeamFixture(fixtureId: string, input: ClubTeamFixtureInput, by: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('fixtures')
    .update({ ...clubTeamFixtureColumns(input), last_modified_by: by, last_modified_date: new Date().toISOString() })
    .eq('id', fixtureId)
    .eq('fixture_type', 'Club Team');
  if (error) throw new Error(`Failed to update fixture: ${error.message}`);
}

/** Delete a Club Team fixture (its team selections go with it). */
export async function deleteClubTeamFixture(fixtureId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('fixtures').delete().eq('id', fixtureId).eq('fixture_type', 'Club Team');
  if (error) throw new Error(`Failed to delete fixture: ${error.message}`);
}

/** The fixture's squad (group) id and type, for permission checks on a single fixture. */
export async function getFixtureSquad(fixtureId: string): Promise<{ groupId: string; fixtureType: string } | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fixtures').select('group_id, fixture_type').eq('id', fixtureId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.group_id) return null;
  return { groupId: data.group_id, fixtureType: data.fixture_type || '' };
}

/** Current (non-withdrawn) squad members' usernames — for "Ask squad". */
export async function getActiveSquadUsernames(groupId: string): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fixture_entries').select('username').eq('group_id', groupId).eq('status', 'entered');
  if (error) throw new Error(error.message);
  const names: string[] = [];
  for (const row of data || []) names.push(row.username);
  return names;
}

/** Read the Club Team fixture form fields from a request body (add + edit routes). */
export function readClubTeamFixtureInput(body: Record<string, unknown>): ClubTeamFixtureInput {
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const date = text(body.date);
  const time = text(body.time);
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    time: /^\d{2}:\d{2}$/.test(time) ? time : '',
    clubName: text(body.clubName),
    opponentText: text(body.opponentText),
    homeAway: body.homeAway === 'A' ? 'A' : 'H',
    format: text(body.format),
    ladiesMen: text(body.ladiesMen),
  };
}

// ============================================================================
// SQUAD FIXTURES IN THE FRIENDLIES SELECTION PAGE
// ============================================================================
// Squad fixtures are picked on the same page as friendlies (/friendlies/manage/game/
// [tabName]) and players use the same game page, match card and Confirm/Withdraw email
// links — all addressed by tab_name. League fixtures from Season Planning have none, and
// a Club Team fixture may have no date yet, so each squad fixture gets a stable tab name
// when it joins its squad, and starts as Selecting (squads have no entry window).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function squadTabName(row: any): string {
  const f = mapFixtureRow(row);
  let datePart = '';
  if (row.date) {
    const [y, m, d] = String(row.date).split('-');
    datePart = `${d} ${MONTHS[parseInt(m, 10) - 1]} ${y.slice(-2)}`;
  } else {
    datePart = `TBC ${String(row.id).slice(0, 4)}`;
  }
  return `${f.gameType} ${opponentOf(f)} ${datePart}`.trim();
}

/** Give every fixture in the squad a tab name and move untouched ones to Selecting. */
export async function ensureSquadFixtureKeys(groupId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixtures')
    .select('*')
    .eq('group_id', groupId)
    .or('tab_name.is.null,game_status.eq.');
  if (error) throw new Error(`Failed to check squad fixtures: ${error.message}`);
  for (const row of data || []) {
    const updates: Record<string, unknown> = {};
    if ((row.game_status || '') === '') updates.game_status = 'X';
    if (!row.tab_name) {
      // tab_name is unique — add a number if another fixture already has this one
      const base = squadTabName(row);
      let candidate = base;
      for (let n = 2; n < 20; n++) {
        const { data: clash } = await supabase.from('fixtures').select('id').eq('tab_name', candidate).maybeSingle();
        if (!clash) break;
        candidate = `${base} (${n})`;
      }
      updates.tab_name = candidate;
    }
    if (Object.keys(updates).length > 0) {
      const { error: upError } = await supabase.from('fixtures').update(updates).eq('id', row.id);
      if (upError) throw new Error(`Failed to prepare squad fixture: ${upError.message}`);
    }
  }
}

/**
 * Can this person manage this game on the friendlies pages? Captain and Admin always;
 * for a squad fixture also the squad's organisers.
 */
export async function canManageGame(fixture: Pick<Fixture, 'groupId'>, username: string, role: string | undefined | null): Promise<boolean> {
  if (hasRole(role, 'Captain', 'Admin')) return true;
  if (!fixture.groupId) return false;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fixture_groups').select('kind').eq('id', fixture.groupId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.kind !== 'squad') return false;
  return canManageSquad(fixture.groupId, username, role);
}

/** The squad a fixture belongs to (null for friendlies). */
export async function getSquadForFixture(fixture: Pick<Fixture, 'groupId'>): Promise<FixtureGroup | null> {
  if (!fixture.groupId) return null;
  return getSquadGroup(fixture.groupId);
}

/** League teas (home fixtures): any two current squad members, playing or not. */
export async function setSquadFixtureTeas(fixtureId: string, lead: string, first: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: fx, error } = await supabase.from('fixtures').select('group_id, home_away').eq('id', fixtureId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!fx || !fx.group_id) throw new Error('Fixture not found');
  if (fx.home_away === 'A') return;
  const members = await getActiveSquadUsernames(fx.group_id);
  const valid = (u: string) => (u && members.includes(u) ? u : null);
  const { error: upError } = await supabase
    .from('fixtures')
    .update({ tea_lead_username: valid(lead), tea_first_username: valid(first) })
    .eq('id', fixtureId);
  if (upError) throw new Error(`Failed to save teas: ${upError.message}`);
}
