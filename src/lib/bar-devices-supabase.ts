// src/lib/bar-devices-supabase.ts
// Data layer for the bar till's device allowlist (see 0061_bar_trusted_devices.sql).

import { getSupabaseClient } from './supabase';

export interface BarTrustedDevice {
  id: string;
  label: string | null;
  pairingCode: string;
  approved: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
}

function mapRow(r: any): BarTrustedDevice {
  return {
    id: r.id, label: r.label, pairingCode: r.pairing_code,
    approved: r.approved, approvedAt: r.approved_at, approvedBy: r.approved_by,
    revokedAt: r.revoked_at, revokedBy: r.revoked_by, createdAt: r.created_at,
  };
}

export async function listDevices(): Promise<BarTrustedDevice[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('bar_trusted_devices').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load devices: ${error.message}`);
  return (data ?? []).map(mapRow);
}

/** Called by the till itself (unauthenticated — this happens before login) the first
 * time it runs, to register the id/pairing code it generated and is showing on
 * screen. A no-op if that id is already registered (e.g. the page was reloaded). */
export async function registerDevice(id: string, pairingCode: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('bar_trusted_devices')
    .upsert({ id, pairing_code: pairingCode }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw new Error(`Failed to register device: ${error.message}`);
}

/** Approves a pending device — requires the pairing code shown on that physical
 * device's screen, so an admin can't approve one blind by guessing/enumerating ids. */
export async function approveDevice(id: string, pairingCode: string, label: string, approvedBy: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('bar_trusted_devices')
    .update({ approved: true, label: label.trim(), approved_at: new Date().toISOString(), approved_by: approvedBy })
    .eq('id', id).eq('pairing_code', pairingCode).is('revoked_at', null)
    .select('id');
  if (error) throw new Error(`Failed to approve device: ${error.message}`);
  if (!data || data.length === 0) throw new Error('Pairing code did not match that device.');
}

export async function revokeDevice(id: string, revokedBy: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('bar_trusted_devices')
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokedBy })
    .eq('id', id);
  if (error) throw new Error(`Failed to revoke device: ${error.message}`);
}

/** True only for an approved, not-revoked device — the check authorize() (src/lib/auth.ts)
 * makes for every login attempt to the 'Bar' role. */
export async function isDeviceTrusted(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('bar_trusted_devices').select('approved, revoked_at').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to check device: ${error.message}`);
  return !!data && data.approved && !data.revoked_at;
}
