// src/lib/sweeping-rota-supabase.ts
// Postgres-backed replacement for sweeping-sheets.ts. sweeping_rota.date is a real
// Postgres `date` column (unlike cleaning_rota's free-text date) — the live
// SweepingRota sheet's Date column carries a full year via normalizeToUKDate, so
// nothing is lost storing it properly.

import { getSupabaseClient } from './supabase';
import type { SweepingRotaEntry } from './types/sweeping';

export type { SweepingRotaEntry };

function toISODate(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function toUKDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function mapRow(row: any): SweepingRotaEntry {
  return {
    date: toUKDate(row.date),
    userName: row.username || '',
    isBlocked: !!row.is_blocked,
  };
}

export async function getSweepingRotaList(): Promise<SweepingRotaEntry[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('sweeping_rota').select('*').order('date');
  if (error) throw new Error(`Failed to fetch sweeping rota: ${error.message}`);
  return (data || []).map(mapRow);
}

export async function getSweepingRotaForDateRange(
  startDate: string,
  endDate: string
): Promise<SweepingRotaEntry[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('sweeping_rota')
    .select('*')
    .gte('date', toISODate(startDate))
    .lte('date', toISODate(endDate))
    .order('date');
  if (error) throw new Error(`Failed to fetch sweeping rota: ${error.message}`);
  return (data || []).map(mapRow);
}

export async function getSweepingRotaEntry(date: string): Promise<SweepingRotaEntry | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('sweeping_rota')
    .select('*')
    .eq('date', toISODate(date))
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch sweeping rota entry: ${error.message}`);
  if (!data) return null;
  return mapRow(data);
}

export async function addSweepingAssignment(
  date: string,
  userName: string
): Promise<{ success: boolean; reason?: string }> {
  if (!userName || userName.trim() === '') {
    return { success: false, reason: 'Username cannot be empty' };
  }
  const supabase = getSupabaseClient();
  const existing = await getSweepingRotaEntry(date);

  if (existing) {
    if (existing.isBlocked) return { success: false, reason: 'Date is blocked (maintenance day)' };
    if (existing.userName) return { success: false, reason: 'Date already has an assignment' };
    const { error } = await supabase
      .from('sweeping_rota')
      .update({ username: userName })
      .eq('date', toISODate(date));
    if (error) throw new Error(error.message);
    return { success: true };
  }

  const { error } = await supabase
    .from('sweeping_rota')
    .insert({ date: toISODate(date), username: userName, is_blocked: false });
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function removeSweepingAssignment(
  date: string,
  userName: string,
  isAdmin: boolean = false
): Promise<{ success: boolean; reason?: string }> {
  const supabase = getSupabaseClient();
  const existing = await getSweepingRotaEntry(date);

  if (!existing) return { success: false, reason: 'No entry for this date' };
  if (!existing.userName) return { success: false, reason: 'Date has no assignment' };
  if (!isAdmin && existing.userName !== userName) {
    return { success: false, reason: 'Can only remove your own assignment' };
  }

  const { error } = await supabase
    .from('sweeping_rota')
    .update({ username: null })
    .eq('date', toISODate(date));
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function blockSweepingDate(date: string): Promise<{ success: boolean; reason?: string }> {
  const supabase = getSupabaseClient();
  const existing = await getSweepingRotaEntry(date);

  if (existing) {
    if (existing.userName) return { success: false, reason: 'Cannot block a date with an existing assignment' };
    if (existing.isBlocked) return { success: false, reason: 'Date is already blocked' };
    const { error } = await supabase
      .from('sweeping_rota')
      .update({ is_blocked: true })
      .eq('date', toISODate(date));
    if (error) throw new Error(error.message);
    return { success: true };
  }

  const { error } = await supabase
    .from('sweeping_rota')
    .insert({ date: toISODate(date), username: null, is_blocked: true });
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function unblockSweepingDate(date: string): Promise<{ success: boolean; reason?: string }> {
  const supabase = getSupabaseClient();
  const existing = await getSweepingRotaEntry(date);

  if (!existing) return { success: false, reason: 'No entry for this date' };
  if (!existing.isBlocked) return { success: false, reason: 'Date is not blocked' };

  const { error } = await supabase
    .from('sweeping_rota')
    .update({ is_blocked: false })
    .eq('date', toISODate(date));
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function clearSweepingEntry(date: string): Promise<{ success: boolean; reason?: string }> {
  const supabase = getSupabaseClient();
  const existing = await getSweepingRotaEntry(date);

  if (!existing) return { success: false, reason: 'No entry for this date' };
  if (!existing.userName && !existing.isBlocked) return { success: false, reason: 'Date is already clear' };

  const { error } = await supabase
    .from('sweeping_rota')
    .update({ username: null, is_blocked: false })
    .eq('date', toISODate(date));
  if (error) throw new Error(error.message);
  return { success: true };
}

/** Batch add — used by both ad-hoc date lists and pattern-generated dates. */
export async function batchAddSweepingAssignments(
  dates: string[],
  userName: string,
  overwrite = false
): Promise<{ added: string[]; skipped: { date: string; reason: string }[] }> {
  if (!userName || userName.trim() === '') {
    return { added: [], skipped: dates.map((date) => ({ date, reason: 'Username cannot be empty' })) };
  }

  const supabase = getSupabaseClient();
  const isoDates = dates.map(toISODate);
  const { data, error } = await supabase.from('sweeping_rota').select('*').in('date', isoDates);
  if (error) throw new Error(error.message);
  const existingByIso = new Map((data || []).map((r) => [r.date, r]));

  const added: string[] = [];
  const skipped: { date: string; reason: string }[] = [];
  const toUpsert: { date: string; username: string; is_blocked: boolean }[] = [];

  for (const date of dates) {
    const iso = toISODate(date);
    const existing = existingByIso.get(iso);
    if (existing) {
      if (existing.is_blocked) { skipped.push({ date, reason: 'Date is blocked (maintenance day)' }); continue; }
      if (existing.username && !overwrite) { skipped.push({ date, reason: 'Date already has an assignment' }); continue; }
    }
    toUpsert.push({ date: iso, username: userName, is_blocked: false });
    added.push(date);
  }

  if (toUpsert.length > 0) {
    const { error: upErr } = await supabase.from('sweeping_rota').upsert(toUpsert, { onConflict: 'date' });
    if (upErr) throw new Error(upErr.message);
  }

  return { added, skipped };
}

export async function batchBlockSweepingDates(
  dates: string[]
): Promise<{ blocked: string[]; skipped: { date: string; reason: string }[] }> {
  const supabase = getSupabaseClient();
  const isoDates = dates.map(toISODate);
  const { data, error } = await supabase.from('sweeping_rota').select('*').in('date', isoDates);
  if (error) throw new Error(error.message);
  const existingByIso = new Map((data || []).map((r) => [r.date, r]));

  const blocked: string[] = [];
  const skipped: { date: string; reason: string }[] = [];
  const toUpsert: { date: string; is_blocked: boolean }[] = [];

  for (const date of dates) {
    const iso = toISODate(date);
    const existing = existingByIso.get(iso);
    if (existing) {
      if (existing.username) { skipped.push({ date, reason: 'Cannot block a date with an existing assignment' }); continue; }
      if (existing.is_blocked) { skipped.push({ date, reason: 'Date is already blocked' }); continue; }
    }
    toUpsert.push({ date: iso, is_blocked: true });
    blocked.push(date);
  }

  if (toUpsert.length > 0) {
    const { error: upErr } = await supabase.from('sweeping_rota').upsert(toUpsert, { onConflict: 'date' });
    if (upErr) throw new Error(upErr.message);
  }

  return { blocked, skipped };
}

export async function batchClearSweepingEntries(
  dates: string[]
): Promise<{ cleared: string[]; skipped: { date: string; reason: string }[] }> {
  const supabase = getSupabaseClient();
  const isoDates = dates.map(toISODate);
  const { data, error } = await supabase.from('sweeping_rota').select('*').in('date', isoDates);
  if (error) throw new Error(error.message);
  const existingByIso = new Map((data || []).map((r) => [r.date, r]));

  const cleared: string[] = [];
  const skipped: { date: string; reason: string }[] = [];
  const toClear: string[] = [];

  for (const date of dates) {
    const iso = toISODate(date);
    const existing = existingByIso.get(iso);
    if (!existing) { skipped.push({ date, reason: 'No entry for this date' }); continue; }
    if (!existing.username && !existing.is_blocked) { skipped.push({ date, reason: 'Date is already clear' }); continue; }
    toClear.push(iso);
    cleared.push(date);
  }

  if (toClear.length > 0) {
    const { error: upErr } = await supabase
      .from('sweeping_rota')
      .update({ username: null, is_blocked: false })
      .in('date', toClear);
    if (upErr) throw new Error(upErr.message);
  }

  return { cleared, skipped };
}
