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
// resolution, capacity/reservations, and email-draft generation are
// Friendlies-only and deliberately not modelled here — they land as
// Friendly-specific additions in a later pass, not a widening of this file's
// existing functions.

import { getSupabaseClient } from './supabase';
import { projectFixtureDate } from './season-planning-dates';

export type PlanningFixtureType = 'Event' | 'Friendly';
export type PlanningStatus = 'Projected' | 'Confirmed';
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
