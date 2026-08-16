// src/lib/reservations-supabase.ts
// Season Planning — standing weekly rink reservations (league nights,
// Friday Night Drive, Greenkeepers morning, etc), plus one-off recurring
// bursts like a specific beginners course. Deliberately NOT season-scoped
// rows: a reservation is either evergreen (start/end both null, recurring
// every season within a config-driven default window) or a one-off with its
// own explicit start/end dates — the DB check constraint enforces the two
// are set together. Occurrences are generated on demand for whichever
// season year is being viewed, same principle as the rest of Season
// Planning (nothing here is pre-materialised into row-per-week storage).

import { getSupabaseClient } from './supabase';

export interface Reservation {
  id: string;
  name: string;
  weekday: number; // 0=Sun..6=Sat
  time: string; // HH:MM
  rinksReserved: number;
  startDate: string | null; // DD/MM/YYYY — set together with endDate, or both null
  endDate: string | null;
}

function isoToUKDate(iso: string | null): string | null {
  if (!iso) return null;
  const parts = iso.split('-');
  if (parts.length !== 3) return null;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function toIsoDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function mapReservationRow(row: any): Reservation {
  return {
    id: row.id,
    name: row.name,
    weekday: row.weekday,
    time: (row.time || '').slice(0, 5), // Postgres `time` comes back "HH:MM:SS"
    rinksReserved: row.rinks_reserved,
    startDate: isoToUKDate(row.start_date),
    endDate: isoToUKDate(row.end_date),
  };
}

export async function getReservations(): Promise<Reservation[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('reservations').select('*').order('weekday').order('time');
  if (error) throw new Error(`Failed to fetch reservations: ${error.message}`);
  return (data || []).map(mapReservationRow);
}

export interface ReservationFields {
  name: string;
  weekday: number;
  time: string;
  rinksReserved: number;
  startDate?: string | null;
  endDate?: string | null;
}

export async function createReservation(fields: ReservationFields): Promise<Reservation> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('reservations')
    .insert({
      name: fields.name,
      weekday: fields.weekday,
      time: fields.time,
      rinks_reserved: fields.rinksReserved,
      start_date: toIsoDate(fields.startDate),
      end_date: toIsoDate(fields.endDate),
    })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create reservation: ${error.message}`);
  return mapReservationRow(data);
}

export async function updateReservation(id: string, fields: Partial<ReservationFields>): Promise<void> {
  const supabase = getSupabaseClient();
  const updates: Record<string, any> = {};
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.weekday !== undefined) updates.weekday = fields.weekday;
  if (fields.time !== undefined) updates.time = fields.time;
  if (fields.rinksReserved !== undefined) updates.rinks_reserved = fields.rinksReserved;
  // start/end travel together — a PATCH that includes one always includes
  // both (the UI's one-off toggle sets/clears them as a pair), so there's no
  // need to separately guard against violating the DB's paired check
  // constraint here the way the individual `!== undefined` guards above do.
  if (fields.startDate !== undefined || fields.endDate !== undefined) {
    updates.start_date = toIsoDate(fields.startDate);
    updates.end_date = toIsoDate(fields.endDate);
  }

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase.from('reservations').update(updates).eq('id', id);
  if (error) throw new Error(`Failed to update reservation: ${error.message}`);
}

export async function deleteReservation(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('reservations').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete reservation: ${error.message}`);
}

// getReservationOccurrences lives in season-planning-capacity.ts, not here —
// it's a pure function the Friendlies page (a client component) needs to
// call directly, and that module has zero Supabase dependency so it's safe
// to runtime-import client-side, unlike this file (only ever `import type`d
// from client components, same reason season-planning-supabase.ts is).
