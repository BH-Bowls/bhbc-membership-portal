// src/lib/rowland-entries-supabase.ts
// Rowland Cup team entry — see Specs/ROWLAND_TEAM_ENTRY_SPEC.md for the full design.
// Kept separate from rowland-supabase.ts (which owns comps/matches/the home-page
// message), same separation already used between renewals-supabase.ts and
// banking-supabase.ts.
//
// No functions here yet for the draw-setup integration (assigning a team-entry to a
// bracket, §6 of the spec) — a separate, deliberately deferred piece. Payments (§7) are
// matched on /banking's Rowland Cup tab, or recorded as cash in Rowland Admin, through
// the rowland_transactions ledger (0098).

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

/** A problem with what was entered (e.g. too many teams); its message is safe to show. */
export class RowlandEntryError extends Error {}

export interface SubmitRowlandEntryInput {
  clubName: string;
  season: string;
  consentToPublish: boolean;
  teams: TeamEntryInput[];
  createdBy: string;   // who entered it: a committee login, or 'entry form'
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
  payments?: RowlandPaymentRecord[];   // getAllRowlandEntries only
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
  const feeForTheseTeamsPence = input.teams.length * feePence;
  const amountDuePence = (existing ? existing.amount_due_pence : 0) + feeForTheseTeamsPence;

  // The form always numbers teams from 1, so a club adding to its entry would clash with
  // its own team 1. Give the new teams the free numbers after the club's existing ones
  // (withdrawn teams keep their number), and refuse before anything is saved or charged
  // if that's more than 2 for a trophy.
  const teams: TeamEntryInput[] = [];
  const usedNumbers: Record<RowlandTrophy, number[]> = { edward: [], gladys: [] };
  if (existing) {
    const { data: existingTeams, error: existingTeamsError } = await supabase
      .from('rowland_team_entries')
      .select('trophy, team_number')
      .eq('rowland_entry_id', existing.id);
    if (existingTeamsError) throw new Error(`Failed to check the club's existing teams: ${existingTeamsError.message}`);
    for (const t of existingTeams || []) {
      usedNumbers[t.trophy as RowlandTrophy].push(t.team_number);
    }
  }
  for (const t of input.teams) {
    let teamNumber = 0;
    for (const n of [1, 2]) {
      if (!usedNumbers[t.trophy].includes(n)) {
        teamNumber = n;
        break;
      }
    }
    if (teamNumber === 0) {
      const trophyName = t.trophy === 'edward' ? 'Edward' : 'Gladys';
      throw new RowlandEntryError(
        `${input.clubName} already has 2 ${trophyName} Rowland teams for ${input.season}, which is the most a club can enter.`
      );
    }
    usedNumbers[t.trophy].push(teamNumber);
    teams.push({ ...t, teamNumber: teamNumber as 1 | 2 });
  }

  if (existing) {
    entryId = existing.id;
    const { error: updateError } = await supabase
      .from('rowland_entries')
      .update({ consent_to_publish: input.consentToPublish })
      .eq('id', entryId);
    if (updateError) throw new Error(`Failed to update the existing entry: ${updateError.message}`);
  } else {
    const { data: created, error: createError } = await supabase
      .from('rowland_entries')
      .insert({
        club_name: input.clubName,
        season: input.season,
        consent_to_publish: input.consentToPublish,
        amount_due_pence: 0,
      })
      .select('id')
      .single();
    if (createError) throw new Error(`Failed to create the entry: ${createError.message}`);
    entryId = created.id;
  }

  // Teams first, then the fee, so a failed save never leaves a charge behind
  const teamsToInsert = teams.map((t) => ({
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

  // What's owed only ever changes through the ledger, so it goes in the Xero journal
  // (0098). Adding teams to a Paid entry makes it Partial again.
  const { error: feeError } = await supabase.rpc('rowland_add_entry_fee', {
    p_entry_id: entryId,
    p_teams: teams.length,
    p_amount_pence: feeForTheseTeamsPence,
    p_created_by: input.createdBy,
  });
  if (feeError) {
    const insertedIds: string[] = [];
    for (const row of insertedTeams || []) insertedIds.push(row.id);
    if (insertedIds.length > 0) {
      const { error: undoError } = await supabase.from('rowland_team_entries').delete().in('id', insertedIds);
      if (undoError) console.error('[rowland] Failed to remove teams after the fee failed:', undoError.message);
    }
    throw new Error(`Failed to record the entry fee: ${feeError.message}`);
  }

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
// COMMITTEE ADMIN — view all entries, withdraw a team.
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

  const paymentsByEntry = await getPaymentsByEntry(entryRows.map((r) => r.id));

  return entryRows.map((entryRow) => ({
    ...mapEntryRow(entryRow),
    teams: (teamRows || [])
      .filter((t) => t.rowland_entry_id === entryRow.id)
      .map(mapTeamEntryRow),
    payments: paymentsByEntry.get(entryRow.id) || [],
  }));
}

// ============================================================================
// PAYMENTS (0098) — Banking payments matched on /banking's Rowland Cup tab, and cash
// recorded in Rowland Admin. Each is a rowland_transactions row, so it goes in the Xero
// journal with renewals. A part payment leaves the entry Partial; it's Paid once the
// full amount is in.
// ============================================================================

export interface RowlandPaymentResult {
  paymentStatus: RowlandPaymentStatus;
  becamePaid: boolean;   // this payment made it Paid — send the payment-received email
}

/**
 * Record a payment against a club's entry. Banking: the Unmatched payments in
 * paymentIds, for their total, dated with the latest bank date. Cash: amountPence today.
 * Refused (nothing saved) if it's more than the club still owes.
 */
export async function recordRowlandPayment(opts: {
  entryId: string;
  source: 'banking' | 'cash';
  paymentIds: string[];
  amountPence: number;
  createdBy: string;
}): Promise<RowlandPaymentResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('rowland_record_payment', {
    p_entry_id: opts.entryId,
    p_source: opts.source,
    p_payment_ids: opts.paymentIds,
    p_amount_pence: opts.amountPence,
    p_txn_date: null,
    p_created_by: opts.createdBy,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('The payment could not be recorded');
  return { paymentStatus: row.payment_status, becamePaid: row.became_paid === true };
}

/** Undo a payment that hasn't been exported to Xero. A Banking payment goes back to Unmatched. */
export async function removeRowlandPayment(txnId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('rowland_remove_payment', { p_txn_id: txnId });
  if (error) throw new Error(error.message);
}

export interface RowlandPaymentRecord {
  id: string;
  date: string;
  amountPence: number;
  source: 'banking' | 'cash';
  paymentIds: string;
  exported: boolean;
}

async function getPaymentsByEntry(entryIds: string[]): Promise<Map<string, RowlandPaymentRecord[]>> {
  const byEntry = new Map<string, RowlandPaymentRecord[]>();
  if (entryIds.length === 0) return byEntry;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('rowland_transactions')
    .select('id, rowland_entry_id, txn_date, amount_pence, source, payment_ids, xero_export_id')
    .eq('kind', 'payment')
    .in('rowland_entry_id', entryIds)
    .order('txn_date');
  if (error) throw new Error(`Failed to fetch payments: ${error.message}`);
  for (const row of data || []) {
    const list = byEntry.get(row.rowland_entry_id) || [];
    list.push({
      id: row.id,
      date: row.txn_date,
      amountPence: row.amount_pence,
      source: row.source,
      paymentIds: row.payment_ids || '',
      exported: !!row.xero_export_id,
    });
    byEntry.set(row.rowland_entry_id, list);
  }
  return byEntry;
}

/** Entries, any season, with money still owed — the left-hand list on /banking's Rowland Cup tab. */
export async function getRowlandEntriesOwing(): Promise<RowlandEntry[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('rowland_entries')
    .select('*')
    .neq('payment_status', 'Paid')
    .order('club_name');
  if (error) throw new Error(`Failed to fetch entries: ${error.message}`);
  const entries: RowlandEntry[] = [];
  for (const row of data || []) {
    if (row.amount_due_pence > row.amount_received_pence) entries.push(mapEntryRow(row));
  }
  return entries;
}

/** Each contact address for a club's entered teams, with the teams they look after. */
export async function getEntryContacts(entryId: string): Promise<{
  entry: RowlandEntry;
  contacts: Array<{ email: string; name: string; teams: TeamEntry[] }>;
} | null> {
  const entry = await getRowlandEntry(entryId);
  if (!entry) return null;
  const byEmail = new Map<string, { email: string; name: string; teams: TeamEntry[] }>();
  for (const team of entry.teams) {
    if (team.status !== 'Entered' || !team.contactEmail) continue;
    const key = team.contactEmail.toLowerCase();
    let contact = byEmail.get(key);
    if (!contact) {
      contact = { email: team.contactEmail, name: team.contactName, teams: [] };
      byEmail.set(key, contact);
    }
    contact.teams.push(team);
  }
  return { entry, contacts: Array.from(byEmail.values()) };
}

/**
 * Withdraws a single team (e.g. payment never arrives) — sets status rather than
 * deleting, so there's a record of "entered but withdrawn" rather than the row simply
 * disappearing. Suspending a whole club is calling this for each of their teams.
 * Doesn't touch what the club owes: the entry fee is kept once entered.
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
