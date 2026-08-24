// src/lib/season-planning-supabase.ts
// Season Planning — draft-season management, the carry-forward projection,
// and the Projected/Confirmed workflow, shared by Stage 1 (Events) and
// Stage 2 (Friendlies) via a fixtureType parameter. Date/time/description
// corrections (including moving an already-decided date) go through plain
// field edits — there's no separate "Rearrange" status; and removing a
// fixture is a real delete, not a soft-delete flag — both simplified from
// the original design after using Stage 1 in practice (deleted rows are easy
// enough to re-add manually if needed).
//
// Deliberately does NOT reuse getActiveSeasonId() from fixtures-supabase.ts —
// that helper only ever resolves the currently *active* season (matches the
// live in-season workflow), but this module needs both the active season (as
// the projection source) and a separate not-yet-active draft season (as the
// projection target), which that helper can't express.
//
// The fixtureType parameter only covers what Events and Friendlies actually
// share (projection, listing, plain edit, confirm, delete). Contact
// resolution and Gmail draft-link outreach are Friendlies-only, added below
// as their own section rather than widening the shared functions. Stage 3
// (Leagues) is structurally different again — no projection, no Projected
// status, rows land straight at Confirmed via bulk slot-generation — see the
// LEAGUES section below rather than forcing it through the shared functions.

import { getSupabaseClient } from './supabase';
import { projectFixtureDate } from './season-planning-dates';
import { getReservationOccurrences } from './season-planning-capacity';
import { LEAGUE_GAME_TYPES, type LeagueGameType } from './types/friendlies';

// The 5 league types are a fixed list, matching the live in-season Fixtures
// page's hardcoded GameType union (src/lib/types/friendlies.ts, re-exported
// here) — so rows Season Planning generates get the right badge/filter
// there for free. Dropping a league for a season is just "don't generate
// its slots" (no code change); adding a genuinely new league needs a small
// change there too, regardless of what this module does.
export const SEASON_PLANNING_LEAGUE_TYPES = LEAGUE_GAME_TYPES;
export type LeagueType = LeagueGameType;

export type PlanningFixtureType = 'Event' | 'Friendly' | LeagueType;
// 'Email Sent' only ever applies to Friendlies (Events has no outreach step)
// — Events fixtures simply never pass through it, same file-wide type either way.
export type PlanningStatus = 'Projected' | 'Email Sent' | 'Confirmed';
export type PlanningSource = 'Carried Forward' | 'Manually Added';

export interface Season {
  id: string;
  year: number;
  startDate: string; // DD/MM/YYYY, matching Fixture.date convention
  endDate: string;
  isActive: boolean;
}

export interface PlanningFixture {
  id: string;
  fixtureType: PlanningFixtureType;
  date: string; // DD/MM/YYYY
  time: string;
  clubName: string;
  clubSuffix: string;
  homeAway: 'H' | 'A' | '';
  description: string;
  format: string;
  ladiesMen: string;
  dress: string;
  eventType: string | null;
  rinksRequired: number;
  planningStatus: PlanningStatus;
  planningSource: PlanningSource;
}

function isoToUKDate(iso: string | null): string {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return '';
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function toIsoDate(dateStr: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function mapSeasonRow(row: any): Season {
  return {
    id: row.id,
    year: row.year,
    startDate: isoToUKDate(row.start_date),
    endDate: isoToUKDate(row.end_date),
    isActive: !!row.is_active,
  };
}

function mapPlanningFixtureRow(row: any): PlanningFixture {
  return {
    id: row.id,
    fixtureType: row.fixture_type,
    date: isoToUKDate(row.date),
    time: (row.time || '').slice(0, 5), // Postgres `time` comes back "HH:MM:SS"
    clubName: row.club_name || '',
    clubSuffix: row.club_suffix || '',
    homeAway: (row.home_away === 'H' || row.home_away === 'A') ? row.home_away : '',
    description: row.description || '',
    format: row.format || '',
    ladiesMen: row.ladies_men || '',
    dress: row.dress || '',
    eventType: row.event_type || null,
    rinksRequired: row.rinks_required || 0,
    planningStatus: row.planning_status,
    planningSource: row.planning_source,
  };
}

// ============================================================================
// SEASONS
// ============================================================================

export async function getActiveSeason(): Promise<Season | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('seasons').select('*').eq('is_active', true).maybeSingle();
  if (error) throw new Error(`Failed to fetch active season: ${error.message}`);
  return data ? mapSeasonRow(data) : null;
}

/**
 * The "draft" season is the not-yet-active season being planned — the
 * is_active=false row with the year immediately after the active season's
 * year. There's no separate is_draft flag; this is inferred so that archived
 * past seasons (also is_active=false, but with an earlier year) are never
 * mistaken for the draft.
 */
export async function getDraftSeason(): Promise<Season | null> {
  const supabase = getSupabaseClient();
  const activeSeason = await getActiveSeason();
  if (!activeSeason) throw new Error('No active season found');

  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('is_active', false)
    .gt('year', activeSeason.year)
    .order('year', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch draft season: ${error.message}`);
  return data ? mapSeasonRow(data) : null;
}

export async function createDraftSeason(year: number, startDate: string, endDate: string): Promise<Season> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('seasons')
    .insert({
      year,
      start_date: toIsoDate(startDate),
      end_date: toIsoDate(endDate),
      is_active: false,
    })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create draft season: ${error.message}`);
  return mapSeasonRow(data);
}

/** Suggests next season's planning window as the active season's window, one calendar year on — an editable default, not enforced. */
export function suggestDraftSeasonWindow(activeSeason: Season): { year: number; startDate: string; endDate: string } {
  const startParts = activeSeason.startDate.split('/');
  const endParts = activeSeason.endDate.split('/');
  const nextYear = activeSeason.year + 1;
  const nextStart = `${startParts[0]}/${startParts[1]}/${nextYear}`;
  const nextEnd = `${endParts[0]}/${endParts[1]}/${nextYear}`;
  return { year: nextYear, startDate: nextStart, endDate: nextEnd };
}

// ============================================================================
// PROJECTION
// ============================================================================

export async function runFixtureProjection(draftSeasonId: string, fixtureType: PlanningFixtureType): Promise<{ inserted: number }> {
  const supabase = getSupabaseClient();

  const activeSeason = await getActiveSeason();
  if (!activeSeason) throw new Error('No active season found');

  const { count: existingCount, error: existingError } = await supabase
    .from('fixtures')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', draftSeasonId)
    .eq('fixture_type', fixtureType);
  if (existingError) throw new Error(`Failed to check for existing projected fixtures: ${existingError.message}`);
  if (existingCount && existingCount > 0) {
    throw new Error(`${fixtureType} fixtures have already been projected into this season. Delete or resolve them before re-running.`);
  }

  const { data: sourceFixtures, error: sourceError } = await supabase
    .from('fixtures')
    .select('*')
    .eq('season_id', activeSeason.id)
    .eq('fixture_type', fixtureType);
  if (sourceError) throw new Error(`Failed to fetch source fixtures: ${sourceError.message}`);

  const rowsToInsert = (sourceFixtures || []).map((row: any) => ({
    season_id: draftSeasonId,
    fixture_type: fixtureType,
    club_name: row.club_name,
    club_suffix: row.club_suffix,
    description: row.description,
    date: projectFixtureDate(row.date, 1),
    time: row.time,
    home_away: row.home_away,
    format: row.format,
    ladies_men: row.ladies_men,
    dress: row.dress,
    event_type: row.event_type,
    rinks_required: row.rinks_required,
    planning_status: 'Projected',
    planning_source: 'Carried Forward',
  }));

  if (rowsToInsert.length === 0) return { inserted: 0 };

  const { error: insertError } = await supabase.from('fixtures').insert(rowsToInsert);
  if (insertError) throw new Error(`Failed to insert projected fixtures: ${insertError.message}`);

  return { inserted: rowsToInsert.length };
}

// ============================================================================
// LISTING / EDITING
// ============================================================================

export async function listPlanningFixtures(seasonId: string, fixtureType: PlanningFixtureType): Promise<PlanningFixture[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixtures').select('*').eq('season_id', seasonId).eq('fixture_type', fixtureType);
  if (error) throw new Error(`Failed to fetch planning fixtures: ${error.message}`);
  return (data || []).map(mapPlanningFixtureRow);
}

export interface ManualFixtureFields {
  date: string;
  time?: string;
  description?: string;
  clubName?: string;
  clubSuffix?: string;
  homeAway?: 'H' | 'A';
  format?: string;
  ladiesMen?: string;
  dress?: string;
  eventType?: string;
  rinksRequired?: number;
}

export async function addManualFixture(
  seasonId: string,
  fixtureType: PlanningFixtureType,
  fields: ManualFixtureFields
): Promise<PlanningFixture> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixtures')
    .insert({
      season_id: seasonId,
      fixture_type: fixtureType,
      date: toIsoDate(fields.date),
      time: fields.time || null,
      description: fields.description || null,
      club_name: fields.clubName || null,
      club_suffix: fields.clubSuffix || null,
      home_away: fields.homeAway || null,
      format: fields.format || null,
      ladies_men: fields.ladiesMen || null,
      dress: fields.dress || null,
      event_type: fields.eventType || null,
      rinks_required: fields.rinksRequired || 0,
      // No projection happened here, so there's nothing to confirm against —
      // manual adds land straight at Confirmed, never Projected. Both fields
      // are hardcoded server-side, never client-controlled.
      planning_status: 'Confirmed',
      planning_source: 'Manually Added',
    })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to add fixture: ${error.message}`);
  return mapPlanningFixtureRow(data);
}

export async function updatePlanningFixtureFields(
  id: string,
  fields: {
    date?: string;
    time?: string;
    description?: string;
    clubName?: string;
    clubSuffix?: string;
    homeAway?: 'H' | 'A';
    format?: string;
    ladiesMen?: string;
    dress?: string;
    eventType?: string | null;
    rinksRequired?: number;
  }
): Promise<void> {
  const supabase = getSupabaseClient();
  const updates: Record<string, any> = {};

  if (fields.date !== undefined) updates.date = toIsoDate(fields.date);
  if (fields.time !== undefined) updates.time = fields.time;
  if (fields.description !== undefined) updates.description = fields.description;
  // club_name is foreign-keyed to club_profiles — an empty string isn't a
  // valid club and isn't null either, so it would trip the FK constraint.
  // Normalise to null (matches addManualFixture's fields.clubName || null),
  // which lets a row be switched to description-only by clearing this field.
  if (fields.clubName !== undefined) updates.club_name = fields.clubName || null;
  if (fields.clubSuffix !== undefined) updates.club_suffix = fields.clubSuffix;
  if (fields.homeAway !== undefined) updates.home_away = fields.homeAway;
  if (fields.format !== undefined) updates.format = fields.format;
  if (fields.ladiesMen !== undefined) updates.ladies_men = fields.ladiesMen;
  if (fields.dress !== undefined) updates.dress = fields.dress;
  if (fields.eventType !== undefined) updates.event_type = fields.eventType || null;
  if (fields.rinksRequired !== undefined) updates.rinks_required = fields.rinksRequired;

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase.from('fixtures').update(updates).eq('id', id);
  if (error) throw new Error(`Failed to update fixture: ${error.message}`);
}

// ============================================================================
// CONFIRM / DELETE
// ============================================================================

export async function confirmPlanningFixture(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('fixtures').update({ planning_status: 'Confirmed' }).eq('id', id);
  if (error) throw new Error(`Failed to confirm fixture: ${error.message}`);
}

/**
 * Reverts an accidentally-confirmed fixture back to Projected — deliberately
 * tucked inside Edit rather than a persistent list-row button, since
 * un-confirming is rare and the list screen shouldn't carry a button for
 * every uncommon action. Always reverts to Projected regardless of whether
 * the fixture passed through Email Sent first — simple, predictable, and
 * the user can re-mark Email Sent from Outreach if that part was accurate.
 */
export async function unconfirmPlanningFixture(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('fixtures').update({ planning_status: 'Projected' }).eq('id', id);
  if (error) throw new Error(`Failed to un-confirm fixture: ${error.message}`);
}

export async function deletePlanningFixture(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('fixtures').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete fixture: ${error.message}`);
}

// ============================================================================
// LEAGUES (Stage 3)
// ============================================================================
// League fixtures come from Sussex County Bowls, not from BHBC's own
// projection/decision workflow — there's nothing to carry forward and no
// Projected/Confirmed decision to make, just data entry as the county's
// schedule becomes known. Rows always land straight at Confirmed (see
// generateLeagueSlots below), same as a manual add elsewhere in this file.

/** All 5 leagues' fixtures for a season together, sorted server-unordered — the UI groups/sorts as needed (e.g. to spot same-day clashes across leagues). */
export async function listPlanningLeagueFixtures(seasonId: string): Promise<PlanningFixture[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fixtures').select('*').eq('season_id', seasonId).in('fixture_type', SEASON_PLANNING_LEAGUE_TYPES);
  if (error) throw new Error(`Failed to fetch league fixtures: ${error.message}`);
  return (data || []).map(mapPlanningFixtureRow);
}

export interface GenerateLeagueSlotsFields {
  leagueType: LeagueType;
  weekday: number; // 0=Sun..6=Sat
  time: string;
  startDate: string; // DD/MM/YYYY
  endDate: string;
}

/**
 * Bulk-creates one blank "No Game" placeholder row per weekly occurrence
 * between startDate/endDate — the skeleton the committee fills in via plain
 * Edit as the county's real schedule and opponents become known. No club/
 * H-A/format at generation time, only date/time — matches the user's own
 * description of the workflow (slots created up front, filled in nearer the
 * time). Reuses the same weekly-occurrence date math as Reservations
 * (getReservationOccurrences) rather than duplicating it — seasonYear and
 * the config-default-window args are irrelevant here since startDate/endDate
 * are always both provided.
 */
export async function generateLeagueSlots(seasonId: string, fields: GenerateLeagueSlotsFields): Promise<{ inserted: number }> {
  const supabase = getSupabaseClient();

  const { count: existingCount, error: existingError } = await supabase
    .from('fixtures')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId)
    .eq('fixture_type', fields.leagueType);
  if (existingError) throw new Error(`Failed to check for existing ${fields.leagueType} fixtures: ${existingError.message}`);
  if (existingCount && existingCount > 0) {
    throw new Error(`${fields.leagueType} fixtures have already been generated into this season. Delete them first if you need to regenerate.`);
  }

  // getReservationOccurrences' date parsing expects UK DD/MM/YYYY (it's
  // normally only ever fed already-DB-round-tripped Reservation dates) —
  // fields.startDate/endDate here come straight from a client <input
  // type="date">, which is ISO YYYY-MM-DD, so normalise through
  // toIsoDate/isoToUKDate first (both already handle either format as input).
  const dates = getReservationOccurrences(
    {
      weekday: fields.weekday,
      startDate: isoToUKDate(toIsoDate(fields.startDate)),
      endDate: isoToUKDate(toIsoDate(fields.endDate)),
    },
    0, '', ''
  );

  const rowsToInsert = dates.map((date) => ({
    season_id: seasonId,
    fixture_type: fields.leagueType,
    date: toIsoDate(date),
    time: fields.time || null,
    description: 'No Game',
    club_name: null,
    club_suffix: null,
    home_away: null,
    format: null,
    planning_status: 'Confirmed',
    planning_source: 'Manually Added',
  }));

  if (rowsToInsert.length === 0) return { inserted: 0 };

  const { error: insertError } = await supabase.from('fixtures').insert(rowsToInsert);
  if (insertError) throw new Error(`Failed to generate ${fields.leagueType} slots: ${insertError.message}`);

  return { inserted: rowsToInsert.length };
}

// ============================================================================
// CLUBS + CLUB INFO (Friendlies only)
// ============================================================================

function splitRoles(role: string | null): string[] {
  return (role || '').split(',').map((r) => r.trim()).filter(Boolean);
}

export interface ClubListEntry {
  clubName: string;
  lastYearFixtureCount: number;
}

/** Every club in the directory, each with a count of last year's (active season's) Friendlies against them — including 0, so a club BHBC has never played still shows up. */
export async function listClubsForFriendlies(): Promise<ClubListEntry[]> {
  const supabase = getSupabaseClient();

  const { data: clubs, error: clubsError } = await supabase.from('club_profiles').select('club_name').order('club_name');
  if (clubsError) throw new Error(`Failed to fetch clubs: ${clubsError.message}`);

  const counts: Record<string, number> = {};
  const activeSeason = await getActiveSeason();
  if (activeSeason) {
    const { data: fixtureRows, error: fixturesError } = await supabase
      .from('fixtures')
      .select('club_name')
      .eq('season_id', activeSeason.id)
      .eq('fixture_type', 'Friendly')
      .not('club_name', 'is', null);
    if (fixturesError) throw new Error(`Failed to fetch last year's fixture counts: ${fixturesError.message}`);
    for (const row of fixtureRows || []) {
      counts[row.club_name] = (counts[row.club_name] || 0) + 1;
    }
  }

  return (clubs || []).map((c: any) => ({
    clubName: c.club_name,
    lastYearFixtureCount: counts[c.club_name] || 0,
  }));
}

export interface ClubBasicInfo {
  clubName: string;
  address: string;
  postCode: string;
  phone: string;
  email: string;
  website: string;
}

export interface ClubContactEntry {
  name: string;
  role: string;
  email: string | null;
}

export interface ClubFixtureHistoryRow {
  id: string;
  seasonYear: number;
  date: string; // DD/MM/YYYY
  time: string;
  homeAway: 'H' | 'A' | '';
  format: string;
  ladiesMen: string;
  clubSuffix: string;
  planningStatus: string | null; // only meaningful for the draft season's row
  planningSource: string | null;
  gameStatus: string; // '', 'P','C','A','O','S' — live-workflow status, only ever populated for the active season so far
  bhbcScore: number | null;
  opponentScore: number | null;
  reason: string;
  who: string;
}

export interface ClubClash {
  clubName: string;
  homeAway: 'H' | 'A' | '';
  ladiesMen: string;
  format: string;
  isEvent?: boolean;
}

export interface ClubInfo {
  club: ClubBasicInfo | null;
  contacts: ClubContactEntry[];
  /** Only set when a real Match Secretary role has an email on file — the one case the UI shows directly instead of falling back to a manual radio pick. */
  matchSecretary: ClubContactEntry | null;
  fixturesBySeasonYear: Record<number, ClubFixtureHistoryRow[]>;
  /** Draft-season date (DD/MM/YYYY) -> other clubs' fixture details that same day, for the Clash badge's hover tooltip. */
  sameDayClashes: Record<string, ClubClash[]>;
}

export async function getClubInfo(clubName: string): Promise<ClubInfo> {
  const supabase = getSupabaseClient();

  const { data: clubRow, error: clubError } = await supabase
    .from('club_profiles')
    .select('club_name, address_1, address_2, post_code, club_mobile, club_email_address, website')
    .eq('club_name', clubName)
    .maybeSingle();
  if (clubError) throw new Error(`Failed to fetch club: ${clubError.message}`);

  const club: ClubBasicInfo | null = clubRow ? {
    clubName: clubRow.club_name,
    address: [clubRow.address_1, clubRow.address_2].filter(Boolean).join(', '),
    postCode: clubRow.post_code || '',
    phone: clubRow.club_mobile || '',
    email: clubRow.club_email_address || '',
    website: clubRow.website || '',
  } : null;

  const { data: contactRows, error: contactsError } = await supabase
    .from('club_contact_profiles')
    .select('first_name, last_name, role, email')
    .eq('club_name', clubName);
  if (contactsError) throw new Error(`Failed to fetch contacts: ${contactsError.message}`);

  const contacts: ClubContactEntry[] = (contactRows || []).map((row: any) => ({
    name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.role || 'Unnamed contact',
    role: row.role || '',
    email: row.email || null,
  }));

  const matchSecretary = contacts.find((c) => splitRoles(c.role).includes('Match Secretary') && c.email) || null;

  const { data: fixtureRows, error: fixturesError } = await supabase
    .from('fixtures')
    .select('id, season_id, date, time, home_away, format, ladies_men, club_suffix, planning_status, planning_source, game_status, bhbc_score, opponent_score, reason, who')
    .eq('club_name', clubName)
    .eq('fixture_type', 'Friendly');
  if (fixturesError) throw new Error(`Failed to fetch fixture history: ${fixturesError.message}`);

  const { data: seasonRows, error: seasonsError } = await supabase.from('seasons').select('id, year');
  if (seasonsError) throw new Error(`Failed to fetch seasons: ${seasonsError.message}`);
  const yearBySeasonId: Record<string, number> = {};
  for (const s of seasonRows || []) yearBySeasonId[s.id] = s.year;

  const fixturesBySeasonYear: Record<number, ClubFixtureHistoryRow[]> = {};
  for (const row of fixtureRows || []) {
    const year = yearBySeasonId[row.season_id];
    if (year === undefined) continue;
    if (!fixturesBySeasonYear[year]) fixturesBySeasonYear[year] = [];
    fixturesBySeasonYear[year].push({
      id: row.id,
      seasonYear: year,
      date: isoToUKDate(row.date),
      time: (row.time || '').slice(0, 5), // Postgres `time` comes back "HH:MM:SS"
      homeAway: (row.home_away === 'H' || row.home_away === 'A') ? row.home_away : '',
      format: row.format || '',
      ladiesMen: row.ladies_men || '',
      clubSuffix: row.club_suffix || '',
      planningStatus: row.planning_status,
      planningSource: row.planning_source,
      gameStatus: row.game_status || '',
      bhbcScore: row.bhbc_score,
      opponentScore: row.opponent_score,
      reason: row.reason || '',
      who: row.who || '',
    });
  }
  for (const year of Object.keys(fixturesBySeasonYear)) {
    fixturesBySeasonYear[Number(year)].sort((a, b) =>
      a.date.split('/').reverse().join('-').localeCompare(b.date.split('/').reverse().join('-'))
    );
  }

  // Same-day clashes: other clubs' Friendlies, and any Event, sharing a date
  // with one of this club's fixtures — across every season shown on this
  // page, not just the draft. A calendar date string (DD/MM/YYYY) already
  // pins down a single real-world day, which belongs to exactly one season,
  // so matching on date alone is season-safe without a season_id join.
  const sameDayClashes: Record<string, ClubClash[]> = {};
  const thisClubDates = new Set(Object.values(fixturesBySeasonYear).flat().map((f) => f.date));
  if (thisClubDates.size > 0) {
    const { data: otherRows, error: otherError } = await supabase
      .from('fixtures')
      .select('date, club_name, home_away, ladies_men, format')
      .eq('fixture_type', 'Friendly')
      .not('club_name', 'is', null)
      .neq('club_name', clubName);
    if (otherError) throw new Error(`Failed to check same-day clashes: ${otherError.message}`);
    for (const row of otherRows || []) {
      const ukDate = isoToUKDate(row.date);
      if (thisClubDates.has(ukDate)) {
        if (!sameDayClashes[ukDate]) sameDayClashes[ukDate] = [];
        sameDayClashes[ukDate].push({
          clubName: row.club_name,
          homeAway: (row.home_away === 'H' || row.home_away === 'A') ? row.home_away : '',
          ladiesMen: row.ladies_men || '',
          format: row.format || '',
        });
      }
    }

    const { data: eventRows, error: eventsError } = await supabase
      .from('fixtures')
      .select('date, club_name, description, home_away, format')
      .eq('fixture_type', 'Event');
    if (eventsError) throw new Error(`Failed to check same-day event clashes: ${eventsError.message}`);
    for (const row of eventRows || []) {
      const ukDate = isoToUKDate(row.date);
      if (thisClubDates.has(ukDate)) {
        if (!sameDayClashes[ukDate]) sameDayClashes[ukDate] = [];
        sameDayClashes[ukDate].push({
          clubName: row.club_name || row.description || 'Event',
          homeAway: (row.home_away === 'H' || row.home_away === 'A') ? row.home_away : '',
          ladiesMen: '',
          format: row.format || '',
          isEvent: true,
        });
      }
    }
  }

  return { club, contacts, matchSecretary, fixturesBySeasonYear, sameDayClashes };
}

/**
 * Bulk-flips a set of fixtures' status — one club's whole group at once,
 * since one email (or one un-send) covers all of that club's pending
 * fixtures together. A deliberate, separate action from opening the Gmail
 * draft link — clicking "Draft Email" doesn't mean it was actually sent, so
 * this is never triggered automatically, only by the explicit Mark Sent /
 * Mark Unsent buttons.
 */
export async function setFixturesEmailStatus(ids: string[], sent: boolean): Promise<void> {
  if (ids.length === 0) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('fixtures')
    .update({ planning_status: sent ? 'Email Sent' : 'Projected' })
    .in('id', ids);
  if (error) throw new Error(`Failed to mark fixtures as ${sent ? 'Email Sent' : 'unsent'}: ${error.message}`);
}
