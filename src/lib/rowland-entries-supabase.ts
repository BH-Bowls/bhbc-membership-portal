// src/lib/rowland-entries-supabase.ts
// Rowland Cup team entry — see Specs/ROWLAND_TEAM_ENTRY_SPEC.md for the full design.
// Kept separate from rowland-supabase.ts (which owns comps/matches/the home-page
// message), same separation already used between renewals-supabase.ts and
// banking-supabase.ts.
//
// Schema + entry form only this pass — no functions here yet for the draw-setup
// integration (assigning a team-entry to a bracket, §6 of the spec) or bank
// reconciliation (§7) — those are separate, deliberately deferred pieces.

import crypto from 'crypto';
import { getSupabaseClient } from './supabase';
import { getConfig } from './config-supabase';

export type RowlandTrophy = 'edward' | 'gladys';
export type RowlandPaymentStatus = 'Unpaid' | 'Partial' | 'Paid';
export type RowlandTeamEntryStatus = 'Entered' | 'Withdrawn';

export interface TeamEntryInput {
  trophy: RowlandTrophy;
  teamNumber: 1 | 2;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
}

export interface SubmitRowlandEntryInput {
  clubName: string;
  season: string;
  consentToPublish: boolean;
  teams: TeamEntryInput[];
}

export interface TeamEntry {
  id: string;
  rowlandEntryId: string;
  trophy: RowlandTrophy;
  teamNumber: 1 | 2;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  status: RowlandTeamEntryStatus;
}

export interface RowlandEntry {
  id: string;
  clubName: string;
  season: string;
  consentToPublish: boolean;
  submittedAt: string;
  amountDuePence: number;
  amountReceivedPence: number;
  paymentStatus: RowlandPaymentStatus;
  paymentReceivedAt: string | null;
}

export interface RowlandEntryWithTeams extends RowlandEntry {
  teams: TeamEntry[];
}

function mapEntryRow(row: any): RowlandEntry {
  return {
    id: row.id,
    clubName: row.club_name,
    season: row.season,
    consentToPublish: row.consent_to_publish,
    submittedAt: row.submitted_at,
    amountDuePence: row.amount_due_pence,
    amountReceivedPence: row.amount_received_pence,
    paymentStatus: row.payment_status,
    paymentReceivedAt: row.payment_received_at,
  };
}

function mapTeamEntryRow(row: any): TeamEntry {
  return {
    id: row.id,
    rowlandEntryId: row.rowland_entry_id,
    trophy: row.trophy,
    teamNumber: row.team_number,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    status: row.status,
  };
}

/** £16.00 (a string, from config) -> 1600 (pence). Config default matches 0051's seed. */
export async function getRowlandEntryFeePence(): Promise<number> {
  const config = await getConfig();
  const pounds = parseFloat(config.rowland_entry_fee || '16.00');
  return Math.round(pounds * 100);
}

export async function getRowlandEntryDeadline(): Promise<string> {
  const config = await getConfig();
  return config.rowland_entry_deadline || '';
}

/** Which season new entry submissions get tagged with — see 0051's seed comment. */
export async function getRowlandEntrySeason(): Promise<string> {
  const config = await getConfig();
  return config.rowland_entry_season || '';
}

/**
 * Creates the rowland_entries row and its rowland_team_entries rows together. If the
 * club already has an entry for this season, adds these teams onto it instead of
 * creating a second entry (unique(club_name, season) means a plain insert would fail
 * otherwise) — matches the "one entry record per club, added to over time via their
 * token" design in the spec (§2/§5).
 */
export async function submitRowlandEntry(input: SubmitRowlandEntryInput): Promise<{
  entryId: string;
  amountDuePence: number;
  paymentReference: string;
  teams: TeamEntry[];
}> {
  const supabase = getSupabaseClient();
  const feePence = await getRowlandEntryFeePence();

  const { data: existing, error: existingError } = await supabase
    .from('rowland_entries')
    .select('id, amount_due_pence')
    .eq('club_name', input.clubName)
    .eq('season', input.season)
    .maybeSingle();
  if (existingError) throw new Error(`Failed to check for an existing entry: ${existingError.message}`);

  let entryId: string;
  let amountDuePence: number;

  if (existing) {
    entryId = existing.id;
    amountDuePence = existing.amount_due_pence + input.teams.length * feePence;
    const { error: updateError } = await supabase
      .from('rowland_entries')
      .update({
        consent_to_publish: input.consentToPublish,
        amount_due_pence: amountDuePence,
      })
      .eq('id', entryId);
    if (updateError) throw new Error(`Failed to update the existing entry: ${updateError.message}`);
  } else {
    amountDuePence = input.teams.length * feePence;
    const { data: created, error: createError } = await supabase
      .from('rowland_entries')
      .insert({
        club_name: input.clubName,
        season: input.season,
        consent_to_publish: input.consentToPublish,
        amount_due_pence: amountDuePence,
      })
      .select('id')
      .single();
    if (createError) throw new Error(`Failed to create the entry: ${createError.message}`);
    entryId = created.id;
  }

  const teamsToInsert = input.teams.map((t) => ({
    rowland_entry_id: entryId,
    trophy: t.trophy,
    team_number: t.teamNumber,
    contact_name: t.contactName,
    contact_phone: t.contactPhone,
    contact_email: t.contactEmail,
  }));

  const { data: insertedTeams, error: teamsError } = await supabase
    .from('rowland_team_entries')
    .insert(teamsToInsert)
    .select('*');
  if (teamsError) throw new Error(`Failed to save team entries: ${teamsError.message}`);

  return {
    entryId,
    amountDuePence,
    paymentReference: `EGR ${input.clubName}`,
    teams: (insertedTeams || []).map(mapTeamEntryRow),
  };
}

export async function getRowlandEntry(id: string): Promise<RowlandEntryWithTeams | null> {
  const supabase = getSupabaseClient();
  const { data: entryRow, error: entryError } = await supabase
    .from('rowland_entries')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (entryError) throw new Error(`Failed to fetch entry: ${entryError.message}`);
  if (!entryRow) return null;

  const { data: teamRows, error: teamsError } = await supabase
    .from('rowland_team_entries')
    .select('*')
    .eq('rowland_entry_id', id);
  if (teamsError) throw new Error(`Failed to fetch team entries: ${teamsError.message}`);

  return { ...mapEntryRow(entryRow), teams: (teamRows || []).map(mapTeamEntryRow) };
}

export async function getRowlandEntryByClub(clubName: string, season: string): Promise<RowlandEntryWithTeams | null> {
  const supabase = getSupabaseClient();
  const { data: entryRow, error: entryError } = await supabase
    .from('rowland_entries')
    .select('*')
    .eq('club_name', clubName)
    .eq('season', season)
    .maybeSingle();
  if (entryError) throw new Error(`Failed to fetch entry: ${entryError.message}`);
  if (!entryRow) return null;

  return getRowlandEntry(entryRow.id);
}

// ============================================================================
// COMMITTEE ADMIN — view all entries, mark payment received, withdraw a team.
// No bank-rec matching yet (§7 of the spec, deferred) — payment status is set by
// hand here until that exists.
// ============================================================================

/** Every club's entry + teams for a season, clubs sorted alphabetically. */
export async function getAllRowlandEntries(season: string): Promise<RowlandEntryWithTeams[]> {
  const supabase = getSupabaseClient();
  const { data: entryRows, error: entryError } = await supabase
    .from('rowland_entries')
    .select('*')
    .eq('season', season)
    .order('club_name');
  if (entryError) throw new Error(`Failed to fetch entries: ${entryError.message}`);
  if (!entryRows || entryRows.length === 0) return [];

  const { data: teamRows, error: teamsError } = await supabase
    .from('rowland_team_entries')
    .select('*')
    .in('rowland_entry_id', entryRows.map((r) => r.id));
  if (teamsError) throw new Error(`Failed to fetch team entries: ${teamsError.message}`);

  return entryRows.map((entryRow) => ({
    ...mapEntryRow(entryRow),
    teams: (teamRows || [])
      .filter((t) => t.rowland_entry_id === entryRow.id)
      .map(mapTeamEntryRow),
  }));
}

/**
 * Marks the whole club's combined payment as received in full. No bank-rec matching
 * yet, so this is a manual "we've checked the bank and it's arrived" action — a
 * partial amount isn't supported here, only fully paid or not.
 */
export async function markEntryPaid(entryId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: entryRow, error: fetchError } = await supabase
    .from('rowland_entries')
    .select('amount_due_pence')
    .eq('id', entryId)
    .maybeSingle();
  if (fetchError) throw new Error(`Failed to fetch entry: ${fetchError.message}`);
  if (!entryRow) throw new Error('Entry not found');

  const { error } = await supabase
    .from('rowland_entries')
    .update({
      amount_received_pence: entryRow.amount_due_pence,
      payment_status: 'Paid',
      payment_received_at: new Date().toISOString(),
    })
    .eq('id', entryId);
  if (error) throw new Error(`Failed to mark entry paid: ${error.message}`);
}

/** Undoes a mistaken "mark paid" — resets back to Unpaid, zero received. */
export async function markEntryUnpaid(entryId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('rowland_entries')
    .update({ amount_received_pence: 0, payment_status: 'Unpaid', payment_received_at: null })
    .eq('id', entryId);
  if (error) throw new Error(`Failed to mark entry unpaid: ${error.message}`);
}

/**
 * Withdraws a single team (e.g. payment never arrives) — sets status rather than
 * deleting, so there's a record of "entered but withdrawn" rather than the row simply
 * disappearing. Suspending a whole club is calling this for each of their teams.
 * Doesn't touch rowland_entries.amount_due_pence — if the fee owed needs adjusting to
 * match, that's a manual edit for now (no per-team fee is tracked to recalculate from).
 */
export async function withdrawTeamEntry(teamEntryId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('rowland_team_entries')
    .update({ status: 'Withdrawn' })
    .eq('id', teamEntryId);
  if (error) throw new Error(`Failed to withdraw team entry: ${error.message}`);
}

export async function reinstateTeamEntry(teamEntryId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('rowland_team_entries')
    .update({ status: 'Entered' })
    .eq('id', teamEntryId);
  if (error) throw new Error(`Failed to reinstate team entry: ${error.message}`);
}

// ============================================================================
// ACCESS TOKENS — one per team-entry, resolved server-side, no login required.
// Same shape as the password-reset token pattern in members-supabase.ts.
// ============================================================================

export async function createAccessToken(teamEntryId: string, expiresAt: string): Promise<string> {
  const supabase = getSupabaseClient();
  const token = crypto.randomBytes(32).toString('hex');
  const { error } = await supabase.from('rowland_access_tokens').insert({
    token,
    team_entry_id: teamEntryId,
    expires_at: expiresAt,
  });
  if (error) throw new Error(`Failed to create access token: ${error.message}`);
  return token;
}

export interface ResolvedAccessToken {
  team: TeamEntry;
  entry: RowlandEntry;
}

/** Returns null if the token doesn't exist, is expired, or has been revoked. */
export async function resolveAccessToken(token: string): Promise<ResolvedAccessToken | null> {
  const supabase = getSupabaseClient();
  const { data: tokenRow, error: tokenError } = await supabase
    .from('rowland_access_tokens')
    .select('team_entry_id, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle();
  if (tokenError) throw new Error(`Failed to look up token: ${tokenError.message}`);
  if (!tokenRow) return null;
  if (tokenRow.revoked_at) return null;
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) return null;

  const { data: teamRow, error: teamError } = await supabase
    .from('rowland_team_entries')
    .select('*')
    .eq('id', tokenRow.team_entry_id)
    .maybeSingle();
  if (teamError) throw new Error(`Failed to fetch team entry: ${teamError.message}`);
  if (!teamRow) return null;

  const { data: entryRow, error: entryError } = await supabase
    .from('rowland_entries')
    .select('*')
    .eq('id', teamRow.rowland_entry_id)
    .maybeSingle();
  if (entryError) throw new Error(`Failed to fetch entry: ${entryError.message}`);
  if (!entryRow) return null;

  return { team: mapTeamEntryRow(teamRow), entry: mapEntryRow(entryRow) };
}

export async function revokeAccessToken(token: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('rowland_access_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token', token);
  if (error) throw new Error(`Failed to revoke token: ${error.message}`);
}
