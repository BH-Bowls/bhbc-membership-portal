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
// as their own section rather than widening the shared functions — capacity/
// reservations are still deferred to a later pass.

import { getSupabaseClient } from './supabase';
import { projectFixtureDate } from './season-planning-dates';

export type PlanningFixtureType = 'Event' | 'Friendly';
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
  date: string; // DD/MM/YYYY
  time: string;
  clubName: string;
  clubSuffix: string;
  homeAway: 'H' | 'A' | '';
  description: string;
  format: string;
  ladiesMen: string;
  dress: string;
  hardBlock: boolean;
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
    date: isoToUKDate(row.date),
    time: row.time || '',
    clubName: row.club_name || '',
    clubSuffix: row.club_suffix || '',
    homeAway: (row.home_away === 'H' || row.home_away === 'A') ? row.home_away : '',
    description: row.description || '',
    format: row.format || '',
    ladiesMen: row.ladies_men || '',
    dress: row.dress || '',
    hardBlock: !!row.hard_block,
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
    hard_block: row.hard_block,
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
  hardBlock?: boolean;
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
      hard_block: fields.hardBlock || false,
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
    hardBlock?: boolean;
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
  if (fields.hardBlock !== undefined) updates.hard_block = fields.hardBlock;

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

export async function deletePlanningFixture(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('fixtures').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete fixture: ${error.message}`);
}

// ============================================================================
// CONTACT RESOLUTION + OUTREACH (Friendlies only)
// ============================================================================

export type ContactTier = 'secretary' | 'captain' | 'secretary-no-email' | 'none';

export interface ClubContact {
  name: string;
  role: string;
  email: string | null;
}

export interface ClubOutreachGroup {
  clubName: string;
  fixtures: PlanningFixture[];
  contact: ClubContact | null;
  tier: ContactTier;
  allContacts: ClubContact[];
}

function splitRoles(role: string | null): string[] {
  return (role || '').split(',').map((r) => r.trim()).filter(Boolean);
}

/**
 * Match Secretary with email -> best case, no flag needed. Otherwise falls
 * back to a Captain (any Captain-ish role) with email, flagged since it's
 * not the ideal contact. If a Match Secretary exists but has no email
 * anywhere, or there's no Match Secretary at all, the caller is expected to
 * show allContacts for a manual pick — same three-tier scheme as the
 * original spreadsheet-based process this replaces.
 */
function resolveContact(rows: any[]): { contact: ClubContact | null; tier: ContactTier; allContacts: ClubContact[] } {
  const contacts: ClubContact[] = rows.map((row) => ({
    name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.role,
    role: row.role || '',
    email: row.email || null,
  }));
  const withRoles = rows.map((row, i) => ({ ...contacts[i], roles: splitRoles(row.role) }));

  let match = withRoles.find((c) => c.roles.includes('Match Secretary') && c.email);
  if (match) return { contact: match, tier: 'secretary', allContacts: contacts };

  match = withRoles.find((c) => c.roles.some((r) => r === 'Captain' || r.includes('Captain')) && c.email);
  if (match) return { contact: match, tier: 'captain', allContacts: contacts };

  match = withRoles.find((c) => c.roles.includes('Match Secretary'));
  if (match) return { contact: match, tier: 'secretary-no-email', allContacts: contacts };

  return { contact: null, tier: 'none', allContacts: contacts };
}

/**
 * Groups this draft season's not-yet-Confirmed Friendlies by club, each with
 * its resolved outreach contact. Fixtures with no club_name (ad-hoc
 * opponents — touring teams etc.) are skipped entirely; there's no club to
 * email. Confirmed fixtures drop out too — outreach is done once a club has
 * agreed the date, nothing left to chase.
 */
export async function getClubOutreachGroups(seasonId: string): Promise<ClubOutreachGroup[]> {
  const supabase = getSupabaseClient();

  const { data: fixtureRows, error: fixturesError } = await supabase
    .from('fixtures')
    .select('*')
    .eq('season_id', seasonId)
    .eq('fixture_type', 'Friendly')
    .not('club_name', 'is', null)
    .neq('planning_status', 'Confirmed');
  if (fixturesError) throw new Error(`Failed to fetch friendlies for outreach: ${fixturesError.message}`);

  const fixtures = (fixtureRows || []).map(mapPlanningFixtureRow);
  const clubNames = [...new Set(fixtures.map((f) => f.clubName))];
  if (clubNames.length === 0) return [];

  const { data: contactRows, error: contactsError } = await supabase
    .from('club_contact_profiles')
    .select('club_name, first_name, last_name, role, email')
    .in('club_name', clubNames);
  if (contactsError) throw new Error(`Failed to fetch club contacts: ${contactsError.message}`);

  const contactsByClub: Record<string, any[]> = {};
  for (const row of contactRows || []) {
    if (!contactsByClub[row.club_name]) contactsByClub[row.club_name] = [];
    contactsByClub[row.club_name].push(row);
  }

  const fixturesByClub: Record<string, PlanningFixture[]> = {};
  for (const f of fixtures) {
    if (!fixturesByClub[f.clubName]) fixturesByClub[f.clubName] = [];
    fixturesByClub[f.clubName].push(f);
  }

  return clubNames
    .sort((a, b) => a.localeCompare(b))
    .map((clubName) => {
      const resolved = resolveContact(contactsByClub[clubName] || []);
      return {
        clubName,
        fixtures: fixturesByClub[clubName],
        contact: resolved.contact,
        tier: resolved.tier,
        allContacts: resolved.allContacts,
      };
    });
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
