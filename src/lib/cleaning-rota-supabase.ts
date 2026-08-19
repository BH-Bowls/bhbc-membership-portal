// src/lib/cleaning-rota-supabase.ts
// Postgres-backed replacement for cleaning-sheets.ts. cleaning_rota.id (a UUID)
// replaces the Sheets version's rowNumber. cleaning_rota.date is a real Postgres
// `date` column (migrate-rotas.ts assumes the current season/year when converting
// the sheet's year-less "Sat, 05 September" strings) — reformatted back to that same
// display string here so nothing above this layer needs to know or care.

import { getSupabaseClient } from './supabase';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-09-05" -> "Sat, 05 September" */
function formatCleaningDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  return `${DAY_NAMES[dateObj.getDay()]}, ${String(d).padStart(2, '0')} ${MONTH_NAMES[m - 1]}`;
}

export type CleaningPosition = 'lead' | 'second' | 'third' | 'fourth';

// TS field names stay bare; DB columns carry the _username suffix — same convention
// as fixtures.captain_username/tea_lead_username.
const POSITION_COLUMN: Record<CleaningPosition, string> = {
  lead: 'lead_username',
  second: 'second_username',
  third: 'third_username',
  fourth: 'fourth_username',
};

export interface CleaningRotaEntry {
  id: string;
  date: string;
  displayDate: string;   // same as date — kept for API-shape parity with the old Sheets version
  lead: string;
  second: string;
  third: string;
  fourth: string;
}

function mapRow(row: any): CleaningRotaEntry {
  const displayDate = formatCleaningDate(row.date);
  return {
    id: row.id,
    date: displayDate,
    displayDate,
    lead: row.lead_username || '',
    second: row.second_username || '',
    third: row.third_username || '',
    fourth: row.fourth_username || '',
  };
}

export async function getCleaningRotaList(): Promise<CleaningRotaEntry[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('cleaning_rota').select('*').order('date');
  if (error) throw new Error(`Failed to fetch cleaning rota: ${error.message}`);
  return (data || []).map(mapRow);
}

export async function getCleaningRotaEntry(id: string): Promise<CleaningRotaEntry | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('cleaning_rota').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to fetch cleaning rota entry: ${error.message}`);
  if (!data) return null;
  return mapRow(data);
}

export async function updateCleaningRotaAssignment(
  id: string,
  lead: string,
  second: string,
  third: string,
  fourth: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('cleaning_rota')
    .update({
      lead_username: lead || null,
      second_username: second || null,
      third_username: third || null,
      fourth_username: fourth || null,
    })
    .eq('id', id);
  if (error) throw new Error(`Failed to update cleaning rota: ${error.message}`);
}

export async function batchUpdateCleaningRotaAssignments(
  updates: { id: string; lead: string; second: string; third: string; fourth: string }[]
): Promise<void> {
  if (updates.length === 0) return;
  await Promise.all(
    updates.map((u) => updateCleaningRotaAssignment(u.id, u.lead, u.second, u.third, u.fourth))
  );
}

/**
 * Swap cleaning assignment between two members. If target is not specified, searches
 * every entry for where newUsername is currently assigned.
 */
export async function swapCleaningAssignment(
  id: string,
  position: CleaningPosition,
  oldUsername: string,
  newUsername: string,
  targetId?: string,
  targetPosition?: CleaningPosition
): Promise<CleaningRotaEntry> {
  const supabase = getSupabaseClient();

  let newUserId: string | null = targetId ?? null;
  let newUserPosition: CleaningPosition | null = targetPosition ?? null;

  if (!newUserId || !newUserPosition) {
    const all = await getCleaningRotaList();
    for (const entry of all) {
      if (entry.lead === newUsername) { newUserId = entry.id; newUserPosition = 'lead'; break; }
      if (entry.second === newUsername) { newUserId = entry.id; newUserPosition = 'second'; break; }
      if (entry.third === newUsername) { newUserId = entry.id; newUserPosition = 'third'; break; }
      if (entry.fourth === newUsername) { newUserId = entry.id; newUserPosition = 'fourth'; break; }
    }
  }

  const { error } = await supabase
    .from('cleaning_rota')
    .update({ [POSITION_COLUMN[position]]: newUsername })
    .eq('id', id);
  if (error) throw new Error(`Failed to swap cleaning assignment: ${error.message}`);

  if (newUserId && newUserPosition) {
    const { error: err2 } = await supabase
      .from('cleaning_rota')
      .update({ [POSITION_COLUMN[newUserPosition]]: oldUsername })
      .eq('id', newUserId);
    if (err2) throw new Error(`Failed to complete cleaning swap: ${err2.message}`);
  }

  const updated = await getCleaningRotaEntry(id);
  if (!updated) throw new Error('Failed to get updated entry');
  return updated;
}
