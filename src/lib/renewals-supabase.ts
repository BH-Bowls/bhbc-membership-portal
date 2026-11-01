// src/lib/renewals-supabase.ts
// Postgres-backed replacement for renewals-sheets.ts. Same function names/signatures for
// getRenewalByUsername/updateRenewal/calculateMembershipFee/calculateFees/
// sendRenewalConfirmation/sendCancellationConfirmation, so app/api/renewals and
// app/api/apply need only an import swap. calculateMembershipFee/calculateFees are pure —
// ported unchanged.
//
// Backed by the multi-year `renewals` table (supabase/migrations/0031_renewals.sql) —
// the Sheets version was a single current-cycle sheet with no year column, wiped by hand
// each season; since no in-app reset mechanism exists, every reader here filters to
// getCurrentSeasonYear() instead. Also read/written directly by:
//   - Competitions' entrant lookup (getRenewalCompetitionEntries, below)
//   - Banking's payment reconciliation (src/lib/banking-supabase.ts)
//
// Draft / Submit (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §3): submitted_at null = draft.
// Only the renewal form itself sees drafts — every other reader in this file filters to
// submitted renewals (§3.9), and so must any new one.
//
// Email sends are logged automatically by mailer.ts's transporter wrapper (see
// email-log-supabase.ts / supabase/migrations/0046) — withEmailLogContext below just
// attaches the right sentBy (member or whoever is managing them) to that log entry.

import { getSupabaseClient } from './supabase';
import { getUserByUsername } from './members-supabase';
import { sendTemplateEmail, isEmailConfigured, withEmailLogContext } from './email/mailer';
import { getBankDetails } from './bank-details';
import { getAppUrl } from './app-url';
import type { User } from './sheets';

// ============================================================================
// CONSTANTS
// ============================================================================

const MEMBERSHIP_FEES = {
  U18: 10,
  YOUNG_ADULT_STUDENT: 10,  // 18-24 in full-time education
  YOUNG_ADULT: 60,          // 18-24 not in education
  ADULT: 110,               // 25-59 and 60+
  SENIOR: 60,               // 80+
  SOCIAL: 25,
  HONORARY: 0,
} as const;

// Fallback only — the price normally comes from the season's two_hundred_club_settings row
// (spec §9.3), passed to calculateFees() by the renewals API.
const CLUB_200_ENTRY_FEE = 6;
const COMPETITION_ENTRY_FEE = 2;

export const RENEWAL_LOCKED_MESSAGE = "This renewal has already been submitted and can't be changed.";

// ============================================================================
// TYPES
// ============================================================================

export interface Renewal {
  userName: string;
  renewingMembership: boolean | null;
  renewalsClosed: boolean;
  playingFees: number;
  socialFees: number;
  compsFee: number;
  fee200Club: number;
  totalPayment: number;
  outstanding?: number | null;
  banking?: number | null;
  dateReceived?: string | null;
  number200ClubEntries: number;
  pref200Club?: string | null;
  club200PickedNumbers?: string[]; // numbers chosen on the form (spec §9), given out on Submit
  cleaningDatesToAvoid?: string | null;
  teaDatesToAvoid?: string | null;
  mensChampionship: boolean;
  ladiesMaynard: boolean;
  mensTwoWood: boolean;
  ladiesTwoWood: boolean;
  marriedPairs: boolean;
  drawnPairs: boolean;
  australianPairs: boolean;
  drawnTriples: boolean;
  handicap: boolean;
  oldlands: boolean;
  veterans: boolean;
  drawnPairsSub: boolean;
  australianPairsSub: boolean;
  drawnTriplesSub: boolean;
  confirmationEmailDate?: string | null;
  submittedAt?: string | null; // null = draft (or not started)
  submittedBy?: string | null; // the real person who pressed Submit (never an impersonated user)
  voidedAt?: string | null;    // §5 — set by voidRenewal() only
  voidedBy?: string | null;
  voidReason?: string | null;
  paidAtSubmission?: boolean;                // §11.3a — submitted and paid online together
  pendingCheckoutSessionId?: string | null;  // §11.3a — a "Submit and pay online" page is open
  pendingCheckoutExpiresAt?: string | null;
  createdAt?: string | null;
  dateUpdated?: string | null;
}

export interface FeeBreakdown {
  membershipFee: number;
  club200Fee: number;
  compsFee: number;
  total: number;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * The bowls season is a plain calendar year — renewals go out in January.
 *
 * Testing override: RENEWALS_TEST_SEASON_YEAR (e.g. 2027 in .env.dev.local) makes the
 * renewal form, Banking and everything else that uses this act as that season, so next
 * year's renewals can be tried before 1 January. Ignored on production
 * (VERCEL_ENV=production) so it can never move live renewals by accident.
 */
export function getCurrentSeasonYear(): number {
  const override = process.env.RENEWALS_TEST_SEASON_YEAR;
  if (override && process.env.VERCEL_ENV !== 'production') {
    const year = parseInt(override, 10);
    if (year >= 2000 && year <= 2100) {
      return year;
    }
  }
  return new Date().getFullYear();
}

/**
 * The most recent season_year this member has confirmed renewing_membership = true for and paid,
 * or null if they never have. Used by the My Account membership card to derive a
 * "valid until" date (see app/api/account/membership-card/route.ts) -- interim, since
 * renewals has no stored expiry date yet.
 */
export async function getLatestRenewedSeason(userName: string): Promise<number | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('renewals')
    .select('season_year')
    .ilike('username', userName)
    .eq('renewing_membership', true)
    .not('submitted_at', 'is', null) // drafts don't count (§3.9)
    .is('voided_at', null)           // nor do voided renewals (§5)
    .or('outstanding.is.null,outstanding.lte.0') // nor unpaid ones — the card is valid once paid
    .order('season_year', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch latest renewed season for ${userName}: ${error.message}`);
  if (!data) {
    return null;
  }
  return data.season_year;
}

/**
 * What the My Account fee card (spec §7) shows for one member this season.
 *   none         — no renewal started (or an empty row)
 *   draft        — saved but not submitted
 *   payment_pending — a draft held while its "Submit and pay online" page is open (§11.3a)
 *   not_renewing — submitted as not renewing
 *   outstanding  — submitted, something still to pay
 *   paid         — submitted, nothing left to pay
 *   voided       — voided by an Admin (the card shows nothing)
 */
export type RenewalFeeState = 'none' | 'draft' | 'payment_pending' | 'not_renewing' | 'outstanding' | 'paid' | 'voided';

export interface RenewalFeeStatus {
  userName: string;
  state: RenewalFeeState;
  totalFee: number;
  outstanding: number;
}

/**
 * Fee status for each of the given usernames in the current season. Read only — unlike
 * getRenewalByUsername it never creates a row, so opening My Account doesn't start a
 * renewal for anyone.
 */
export async function getRenewalFeeStatuses(userNames: string[]): Promise<RenewalFeeStatus[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('renewals')
    .select('username, renewing_membership, submitted_at, voided_at, total_fee_due, outstanding, pending_checkout_session_id, pending_checkout_expires_at')
    .eq('season_year', getCurrentSeasonYear());
  if (error) throw new Error(`Failed to fetch renewal fee statuses: ${error.message}`);

  const rowsByUser = new Map<string, Record<string, unknown>>();
  for (const row of data || []) {
    rowsByUser.set(String(row.username).toLowerCase(), row);
  }

  const statuses: RenewalFeeStatus[] = [];
  for (const userName of userNames) {
    const row = rowsByUser.get(userName.toLowerCase());
    let state: RenewalFeeState = 'none';
    let totalFee = 0;
    let outstanding = 0;
    if (row) {
      totalFee = Number(row.total_fee_due) || 0;
      outstanding = Number(row.outstanding) || 0;
      if (row.voided_at) {
        state = 'voided';
      } else if (!row.submitted_at) {
        state = row.renewing_membership === null ? 'none' : 'draft';
        if (state === 'draft' && row.pending_checkout_session_id && row.pending_checkout_expires_at
          && new Date(String(row.pending_checkout_expires_at)).getTime() > Date.now()) {
          state = 'payment_pending';
        }
      } else if (row.renewing_membership === false) {
        state = 'not_renewing';
      } else if (outstanding > 0) {
        state = 'outstanding';
      } else {
        state = 'paid';
      }
    }
    statuses.push({ userName: userName, state: state, totalFee: totalFee, outstanding: outstanding });
  }
  return statuses;
}

// Bulk form of getLatestRenewedSeason for label printing — lowercased username →
// most recent season_year they confirmed renewing for. Paged, since the table is
// multi-year and PostgREST caps a single response at 1000 rows.
export async function getLatestRenewedSeasonsByUser(): Promise<Map<string, number>> {
  const supabase = getSupabaseClient();
  const latest = new Map<string, number>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('renewals')
      .select('username, season_year')
      .eq('renewing_membership', true)
      .not('submitted_at', 'is', null) // drafts don't count (§3.9)
      .is('voided_at', null)           // nor do voided renewals (§5)
      .or('outstanding.is.null,outstanding.lte.0') // nor unpaid ones
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to fetch renewed seasons: ${error.message}`);
    for (const row of data || []) {
      const key = String(row.username).toLowerCase();
      const current = latest.get(key);
      if (current === undefined || row.season_year > current) latest.set(key, row.season_year);
    }
    if (!data || data.length < pageSize) break;
  }
  return latest;
}

function mapRow(row: any): Renewal {
  return {
    userName: row.username,
    renewingMembership: row.renewing_membership,
    renewalsClosed: row.renewals_closed === true,
    playingFees: Number(row.playing_fee) || 0,
    socialFees: Number(row.social_fee) || 0,
    compsFee: Number(row.competitions_fee) || 0,
    fee200Club: Number(row.club_200_fee) || 0,
    totalPayment: Number(row.total_fee_due) || 0,
    outstanding: row.outstanding === null || row.outstanding === undefined ? null : Number(row.outstanding),
    banking: row.banking === null || row.banking === undefined ? null : Number(row.banking),
    dateReceived: row.date_paid,
    number200ClubEntries: Number(row.club_200_entries) || 0,
    pref200Club: row.club_200_preferred_numbers,
    club200PickedNumbers: Array.isArray(row.club_200_picked_numbers) ? row.club_200_picked_numbers.map(String) : [],
    cleaningDatesToAvoid: row.cleaning_dates_to_avoid,
    teaDatesToAvoid: row.tea_dates_to_avoid,
    mensChampionship: row.comp_mens_championship === true,
    ladiesMaynard: row.comp_ladies_maynard === true,
    mensTwoWood: row.comp_mens_two_wood === true,
    ladiesTwoWood: row.comp_ladies_two_wood === true,
    marriedPairs: row.comp_married_pairs === true,
    drawnPairs: row.comp_drawn_pairs === true,
    australianPairs: row.comp_australian_pairs === true,
    drawnTriples: row.comp_drawn_triples === true,
    handicap: row.comp_handicap === true,
    oldlands: row.comp_oldlands === true,
    veterans: row.comp_veterans === true,
    drawnPairsSub: row.sub_drawn_pairs === true,
    australianPairsSub: row.sub_australian_pairs === true,
    drawnTriplesSub: row.sub_drawn_triples === true,
    confirmationEmailDate: row.confirmation_email_date,
    submittedAt: row.submitted_at,
    submittedBy: row.submitted_by,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
    voidReason: row.void_reason,
    paidAtSubmission: row.paid_at_submission === true,
    pendingCheckoutSessionId: row.pending_checkout_session_id || null,
    pendingCheckoutExpiresAt: row.pending_checkout_expires_at || null,
    createdAt: row.created_at,
    dateUpdated: row.updated_at,
  };
}

// Manual camelCase -> column mapping (explicit, not derived — mirrors the Sheets version's
// own manual map, safer than a generic camelCase-to-snake_case regex for fields like
// "fee200Club" that don't follow a clean pattern).
const FIELD_TO_COLUMN: Record<string, string> = {
  renewingMembership: 'renewing_membership',
  renewalsClosed: 'renewals_closed',
  playingFees: 'playing_fee',
  socialFees: 'social_fee',
  compsFee: 'competitions_fee',
  fee200Club: 'club_200_fee',
  totalPayment: 'total_fee_due',
  outstanding: 'outstanding',
  banking: 'banking',
  dateReceived: 'date_paid',
  number200ClubEntries: 'club_200_entries',
  pref200Club: 'club_200_preferred_numbers',
  club200PickedNumbers: 'club_200_picked_numbers',
  cleaningDatesToAvoid: 'cleaning_dates_to_avoid',
  teaDatesToAvoid: 'tea_dates_to_avoid',
  mensChampionship: 'comp_mens_championship',
  ladiesMaynard: 'comp_ladies_maynard',
  mensTwoWood: 'comp_mens_two_wood',
  ladiesTwoWood: 'comp_ladies_two_wood',
  marriedPairs: 'comp_married_pairs',
  drawnPairs: 'comp_drawn_pairs',
  australianPairs: 'comp_australian_pairs',
  drawnTriples: 'comp_drawn_triples',
  handicap: 'comp_handicap',
  oldlands: 'comp_oldlands',
  veterans: 'comp_veterans',
  drawnPairsSub: 'sub_drawn_pairs',
  australianPairsSub: 'sub_australian_pairs',
  drawnTriplesSub: 'sub_drawn_triples',
  confirmationEmailDate: 'confirmation_email_date',
  submittedAt: 'submitted_at',
  submittedBy: 'submitted_by',
  pendingCheckoutSessionId: 'pending_checkout_session_id',
  pendingCheckoutExpiresAt: 'pending_checkout_expires_at',
};

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Get renewal data for a user in the current season — creates a blank row on first access.
 * The table's own unique(username, season_year) constraint is the race-condition guard: if
 * two requests insert simultaneously, the loser's insert fails and it just re-selects.
 */
export async function getRenewalByUsername(userName: string): Promise<Renewal> {
  const supabase = getSupabaseClient();
  const seasonYear = getCurrentSeasonYear();

  const { data: existing, error: selectError } = await supabase
    .from('renewals')
    .select('*')
    .ilike('username', userName)
    .eq('season_year', seasonYear)
    .maybeSingle();
  if (selectError) throw new Error(`Failed to fetch renewal for ${userName}: ${selectError.message}`);
  if (existing) return mapRow(existing);

  const { data: inserted, error: insertError } = await supabase
    .from('renewals')
    .insert({ username: userName, season_year: seasonYear })
    .select('*')
    .single();

  if (insertError) {
    // Likely a race — another request created the row first. Re-select rather than fail.
    const { data: retry, error: retryError } = await supabase
      .from('renewals')
      .select('*')
      .ilike('username', userName)
      .eq('season_year', seasonYear)
      .maybeSingle();
    if (retryError || !retry) {
      throw new Error(`Failed to get or create renewal for user ${userName}: ${insertError.message}`);
    }
    return mapRow(retry);
  }

  return mapRow(inserted);
}

/**
 * Update renewal data for a user in the current season. Ensures the row exists first.
 *
 * onlyIfDraft: the member's own form edits pass this, so the update only applies while
 * the renewal is still a draft (submitted_at null) — checked in the same UPDATE, so two
 * saves racing each other can't both get through after one has submitted. Returns
 * locked: true when nothing was changed because the renewal is already submitted.
 * Internal writes (confirmation email date, Banking's payment columns) leave it off.
 */
export async function updateRenewal(
  userName: string,
  updates: Partial<Renewal>,
  options?: { onlyIfDraft?: boolean }
): Promise<{ success: boolean; error?: string; locked?: boolean }> {
  try {
    await getRenewalByUsername(userName); // ensure the row exists
    const seasonYear = getCurrentSeasonYear();
    const supabase = getSupabaseClient();

    const columnUpdates: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(updates)) {
      if (field === 'userName') continue;
      const column = FIELD_TO_COLUMN[field];
      if (column) columnUpdates[column] = value;
    }
    columnUpdates.updated_at = new Date().toISOString();

    let query = supabase
      .from('renewals')
      .update(columnUpdates, { count: 'exact' })
      .ilike('username', userName)
      .eq('season_year', seasonYear);
    if (options && options.onlyIfDraft) {
      query = query.is('submitted_at', null);
    }
    const { error, count } = await query;
    if (error) throw new Error(error.message);

    if (options && options.onlyIfDraft && !count) {
      return { success: false, locked: true, error: RENEWAL_LOCKED_MESSAGE };
    }

    return { success: true };
  } catch (error) {
    console.error(`[updateRenewal] Failed to update renewal for ${userName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update renewal',
    };
  }
}

/**
 * Reopen a submitted "not renewing" renewal back to a draft (spec §3.7) — nothing was owed
 * on it, so nothing has gone to Xero. Only ever applies to a submitted row with
 * renewing_membership = false; any other row is left alone and success is false.
 */
export async function reopenRenewal(userName: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const seasonYear = getCurrentSeasonYear();
  const { error, count } = await supabase
    .from('renewals')
    .update({ submitted_at: null, submitted_by: null, updated_at: new Date().toISOString() }, { count: 'exact' })
    .ilike('username', userName)
    .eq('season_year', seasonYear)
    .eq('renewing_membership', false)
    .not('submitted_at', 'is', null);
  if (error) {
    return { success: false, error: `Failed to reopen renewal: ${error.message}` };
  }
  if (!count) {
    return { success: false, error: 'Only a submitted "not renewing" renewal can be reopened.' };
  }
  return { success: true };
}

/**
 * True when anything at all has been paid on a renewal row — a void is only allowed
 * before that (spec §5.1). Reads the raw payment columns.
 */
function hasAnyPayment(row: Record<string, unknown>): boolean {
  const columns = ['banking', 'bank_transfer', 'card_machine', 'cheque', 'cash'];
  for (const column of columns) {
    const value = row[column];
    if (value !== null && value !== undefined && Number(value) !== 0) {
      return true;
    }
  }
  return false;
}

/** Whether a renewal can be voided right now, and if not, why not (spec §5.1). */
export async function getVoidBlocker(userName: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('renewals')
    .select('submitted_at, voided_at, renewing_membership, banking, bank_transfer, card_machine, cheque, cash')
    .ilike('username', userName)
    .eq('season_year', getCurrentSeasonYear())
    .maybeSingle();
  if (error) throw new Error(`Failed to check renewal for ${userName}: ${error.message}`);
  if (!data) return 'There is no renewal for this season.';
  if (!data.submitted_at) return 'Only a submitted renewal can be voided.';
  if (data.voided_at) return 'This renewal has already been voided.';
  if (data.renewing_membership !== true) return 'Only a renewal that is renewing membership can be voided.';
  if (hasAnyPayment(data)) {
    return 'A payment has been received on this renewal, so it can\'t be voided. The Treasurer will need to make a credit adjustment instead.';
  }
  return null;
}

/**
 * Void a whole submitted renewal (spec §5.3) — Admin only, checked by the caller.
 * Purely financial: sets outstanding to 0 and records who/when/why. Doesn't touch the
 * member's choices, competition entries or 200 Club numbers.
 * The conditions are re-checked inside the UPDATE, so a payment recorded a moment
 * earlier still blocks it.
 */
export async function voidRenewal(
  userName: string,
  voidedBy: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const blocker = await getVoidBlocker(userName);
  if (blocker) {
    return { success: false, error: blocker };
  }

  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  const { error, count } = await supabase
    .from('renewals')
    .update(
      { voided_at: now, voided_by: voidedBy, void_reason: reason, outstanding: 0, updated_at: now },
      { count: 'exact' }
    )
    .ilike('username', userName)
    .eq('season_year', getCurrentSeasonYear())
    .not('submitted_at', 'is', null)
    .is('voided_at', null)
    // Banking's updateRenewalPayment() always sets the banking total along with the
    // per-method columns, so banking alone catches a payment recorded since the check above.
    .or('banking.is.null,banking.eq.0');
  if (error) {
    return { success: false, error: `Failed to void renewal: ${error.message}` };
  }
  if (!count) {
    return { success: false, error: 'The renewal changed while you were voiding it — please reload and check.' };
  }
  return { success: true };
}

/**
 * What's still attached to a member's renewal, shown in the Void dialog so the Admin can
 * deal with it by hand (spec §5.2): 200 Club numbers held this season, and competitions
 * entered.
 */
export async function getRenewalAttachments(userName: string): Promise<{
  club200Numbers: string[];
  competitions: Array<{ compId: string; name: string }>;
}> {
  const supabase = getSupabaseClient();
  const seasonYear = getCurrentSeasonYear();

  const { data: entries, error } = await supabase
    .from('two_hundred_club_entries')
    .select('number')
    .ilike('username', userName)
    .eq('season', String(seasonYear));
  if (error) throw new Error(`Failed to fetch 200 Club numbers for ${userName}: ${error.message}`);

  const club200Numbers: string[] = [];
  for (const entry of entries || []) {
    club200Numbers.push(String(entry.number));
  }
  club200Numbers.sort((a, b) => Number(a) - Number(b));

  // compId matches Competitions' own ids (competitions-supabase.ts COMP_SHEET_CONFIG),
  // so each can link to /competitions/[compId].
  const renewal = await getRenewalByUsername(userName);
  const entered: Array<[boolean, string, string]> = [
    [renewal.mensChampionship, 'mens-championship', 'Men\'s Championship'],
    [renewal.ladiesMaynard, 'ladies-maynard', 'Ladies Maynard'],
    [renewal.mensTwoWood, 'mens-two-wood', 'Men\'s Two Wood'],
    [renewal.ladiesTwoWood, 'ladies-two-wood', 'Ladies Two Wood'],
    [renewal.marriedPairs, 'married-pairs', 'Married Pairs'],
    [renewal.drawnPairs, 'drawn-pairs', 'Drawn Pairs'],
    [renewal.australianPairs, 'australian-pairs', 'Australian Pairs'],
    [renewal.drawnTriples, 'drawn-triples', 'Drawn Triples'],
    [renewal.handicap, 'handicap', 'Handicap'],
    [renewal.oldlands, 'oldlands', 'Oldlands'],
    [renewal.veterans, 'veterans', 'Veterans'],
    [renewal.drawnPairsSub, 'drawn-pairs', 'Drawn Pairs (substitute)'],
    [renewal.australianPairsSub, 'australian-pairs', 'Australian Pairs (substitute)'],
    [renewal.drawnTriplesSub, 'drawn-triples', 'Drawn Triples (substitute)'],
  ];
  const competitions: Array<{ compId: string; name: string }> = [];
  for (const [isEntered, compId, name] of entered) {
    if (isEntered) competitions.push({ compId, name });
  }

  return { club200Numbers, competitions };
}

/**
 * Return, for a given season, every renewal row's username plus its raw per-competition
 * entry/substitute boolean columns — used by Competitions' entrant lookup
 * (competitions-sheets.ts's getEntrantsFromRenewals), which already has its own
 * compId -> column-name config and just needs the raw column values keyed by their
 * Postgres names.
 */
export async function getRenewalCompetitionEntries(seasonYear: number): Promise<Array<Record<string, unknown>>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('renewals')
    .select('username, comp_mens_championship, comp_ladies_maynard, comp_mens_two_wood, comp_ladies_two_wood, comp_married_pairs, comp_drawn_pairs, comp_australian_pairs, comp_drawn_triples, comp_handicap, comp_oldlands, comp_veterans, sub_drawn_pairs, sub_australian_pairs, sub_drawn_triples')
    .eq('season_year', seasonYear)
    .not('submitted_at', 'is', null); // drafts aren't entries (§3.9)
  if (error) throw new Error(`Failed to fetch renewal competition entries: ${error.message}`);
  return data ?? [];
}

/**
 * Calculate the base membership fee for a member (membership portion only)
 * Excludes 200 Club and competition entry fees — this is just the annual subscription.
 * Single source of truth for the membership subscription amount, used both by renewals
 * (calculateFees, below) and by new membership applications (app/api/apply).
 */
export function calculateMembershipFee(
  ageDemographic: string,
  memberType: string,
  fullTimeEducation: boolean,
  honorary: string | null
): number {
  if (honorary === 'Y') {
    return MEMBERSHIP_FEES.HONORARY;
  }

  if (memberType === 'Playing Lady' || memberType === 'Playing Man') {
    switch (ageDemographic) {
      case 'U18':
        return MEMBERSHIP_FEES.U18;
      case '18-24':
        if (fullTimeEducation) {
          return MEMBERSHIP_FEES.YOUNG_ADULT_STUDENT;
        }
        return MEMBERSHIP_FEES.YOUNG_ADULT;
      case '25-59':
        return MEMBERSHIP_FEES.ADULT;
      case '60+':
        return MEMBERSHIP_FEES.ADULT;
      case '80+':
        return MEMBERSHIP_FEES.SENIOR;
    }
    return 0;
  }

  if (memberType === 'Social Lady' || memberType === 'Social Man') {
    return MEMBERSHIP_FEES.SOCIAL;
  }

  return 0;
}

/**
 * Calculate fees based on renewal data.
 * Membership fee: based on member type, age, and honorary status.
 * 200 Club fee: club200Price per entry (the season's 200 Club settings price; £6 if not
 * given). Competition fee: £2 per competition entered (subs are free).
 */
export function calculateFees(
  profile: {
    ageDemographic: string;
    memberType: string;
    fullTimeEducation?: boolean;
    honorary?: string | null;
  },
  renewal: Partial<Renewal>,
  club200Price: number = CLUB_200_ENTRY_FEE
): FeeBreakdown {
  const { ageDemographic, memberType, fullTimeEducation, honorary } = profile;

  const membershipFee = calculateMembershipFee(
    ageDemographic,
    memberType,
    fullTimeEducation === true,
    honorary || null
  );

  let num200ClubEntries = renewal.number200ClubEntries;
  if (num200ClubEntries === undefined || num200ClubEntries === null) {
    num200ClubEntries = 0;
  }
  const club200Fee = num200ClubEntries * club200Price;

  const competitions = [
    'mensChampionship', 'ladiesMaynard', 'mensTwoWood', 'ladiesTwoWood',
    'marriedPairs', 'drawnPairs', 'australianPairs', 'drawnTriples',
    'handicap', 'oldlands', 'veterans',
  ];

  let compCount = 0;
  for (const comp of competitions) {
    const isSelected = renewal[comp as keyof Renewal];
    if (isSelected) {
      compCount++;
    }
  }

  const compsFee = compCount * COMPETITION_ENTRY_FEE;
  const total = membershipFee + club200Fee + compsFee;

  return {
    membershipFee,
    club200Fee,
    compsFee,
    total,
  };
}

/**
 * The 200 Club numbers on a renewal, for emails: "23 and 45", "23, plus 1 to be given a
 * number", or "To be given a number" when none were picked. Null with no entries.
 */
export function describe200ClubNumbers(renewal: Partial<Renewal>): string | null {
  const entries = renewal.number200ClubEntries || 0;
  if (entries <= 0) return null;
  const picks: string[] = [];
  if (renewal.club200PickedNumbers) {
    for (const p of renewal.club200PickedNumbers) picks.push(p);
  }
  picks.sort((a, b) => Number(a) - Number(b));
  const anyCount = entries - picks.length;
  if (picks.length === 0) return 'To be given a number by the 200 Club organiser';
  let text = picks.length === 1 ? picks[0] : picks.slice(0, picks.length - 1).join(', ') + ' and ' + picks[picks.length - 1];
  if (anyCount > 0) text += `, plus ${anyCount} to be given a number`;
  return text;
}

/** The draft email's 200 Club line — picks aren't held until Submit, so it says so. */
function describeDraft200Club(renewal: Partial<Renewal>): string {
  const entries = renewal.number200ClubEntries || 0;
  if (entries <= 0) return 'none';
  let text = entries === 1 ? '1 entry' : `${entries} entries`;
  const picks = renewal.club200PickedNumbers || [];
  if (picks.length > 0) {
    text += ` — chose ${picks.join(', ')}, not held until you submit`;
  }
  return text;
}

/**
 * Who a renewal email goes to: the member, or — if they have no email address — the
 * person managing their renewal, or failing that their designated buddy. memberName
 * notes who it was redirected to. Null when nobody has an email address.
 */
async function resolveRenewalRecipient(
  user: User,
  managerUserName?: string
): Promise<{ recipientEmail: string; memberName: string } | null> {
  let recipientEmail = user.emailAddress;
  let memberName = user.fullKnownAs || user.firstName;

  if (!recipientEmail && managerUserName && managerUserName !== user.userName) {
    const manager = await getUserByUsername(managerUserName);
    if (manager && manager.emailAddress) {
      recipientEmail = manager.emailAddress;
      memberName = `${memberName} (sent to manager: ${manager.fullKnownAs || manager.firstName})`;
    }
  }

  if (!recipientEmail && user.buddyUserName) {
    const buddy = await getUserByUsername(user.buddyUserName);
    if (buddy && buddy.emailAddress) {
      recipientEmail = buddy.emailAddress;
      memberName = `${memberName} (sent to buddy: ${buddy.fullKnownAs || buddy.firstName})`;
    }
  }

  if (!recipientEmail) {
    return null;
  }
  return { recipientEmail, memberName };
}

/** The competitions entered, as an HTML bullet list for the renewal emails. */
function buildCompetitionsHtml(renewal: Renewal): string {
  const competitions: string[] = [];
  if (renewal.mensChampionship) competitions.push('Men\'s Championship');
  if (renewal.ladiesMaynard) competitions.push('Ladies Maynard');
  if (renewal.mensTwoWood) competitions.push('Men\'s Two Wood');
  if (renewal.ladiesTwoWood) competitions.push('Ladies Two Wood');
  if (renewal.marriedPairs) competitions.push('Married Pairs');
  if (renewal.drawnPairs) competitions.push('Drawn Pairs');
  if (renewal.australianPairs) competitions.push('Australian Pairs');
  if (renewal.drawnTriples) competitions.push('Drawn Triples');
  if (renewal.handicap) competitions.push('Handicap');
  if (renewal.oldlands) competitions.push('Oldlands');
  if (renewal.veterans) competitions.push('Veterans');

  if (competitions.length === 0) {
    return '• None selected';
  }
  return '• ' + competitions.join('<br>• ');
}

function formatCurrency(amount: number): string {
  return `£${amount.toFixed(2)}`;
}

/** The bank transfer reference — the username is unique, so Banking's auto-match finds exactly one member (spec §3.6). */
export function getPaymentReference(userName: string): string {
  return `SUBS ${userName}`;
}

/**
 * Send renewal confirmation email (on Submit). If the user has no email, falls back to
 * their manager (person submitting on their behalf) or their designated buddy.
 */
export async function sendRenewalConfirmation(
  userName: string,
  renewal: Renewal,
  fees: FeeBreakdown,
  managerUserName?: string,
  options?: { paidOnline?: boolean }  // §11.3a — "Paid, thank you" in place of how to pay
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUserByUsername(userName);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    if (!isEmailConfigured()) {
      return { success: false, error: 'SMTP not configured' };
    }

    let paidOnline: string | null = null;
    if (options && options.paidOnline) paidOnline = 'Y';

    const recipient = await resolveRenewalRecipient(user, managerUserName);
    if (!recipient) {
      return { success: false, error: 'No email address found for user, manager, or buddy' };
    }
    const recipientEmail = recipient.recipientEmail;
    const memberName = recipient.memberName;

    let printedMembershipBook = 'Not answered';
    if (user.printedMembershipBook === true) printedMembershipBook = 'Yes';
    if (user.printedMembershipBook === false) printedMembershipBook = 'No';

    const substitutes: string[] = [];
    if (renewal.drawnPairsSub) substitutes.push('Drawn Pairs');
    if (renewal.australianPairsSub) substitutes.push('Australian Pairs');
    if (renewal.drawnTriplesSub) substitutes.push('Drawn Triples');

    const substitutesText = substitutes.length > 0
      ? substitutes.join('<br>• ')
      : null;

    const bankDetails = await getBankDetails();

    const result = await withEmailLogContext({ sentBy: managerUserName || userName, userName }, () =>
      sendTemplateEmail(
        recipientEmail,
        'BHBC Membership Renewal Confirmation',
        'renewal-confirmation',
        {
          memberName,
          seasonYear: String(getCurrentSeasonYear()),
          membershipFee: formatCurrency(fees.membershipFee),
          compsFee: formatCurrency(fees.compsFee),
          club200Fee: formatCurrency(fees.club200Fee),
          totalFee: formatCurrency(fees.total),
          paymentReference: getPaymentReference(user.userName),
          memberType: user.memberType,
          number200Club: renewal.number200ClubEntries > 0 ? renewal.number200ClubEntries.toString() : 'None',
          club200Numbers: describe200ClubNumbers(renewal),
          printedMembershipBook,
          competitions: buildCompetitionsHtml(renewal),
          substitutes: substitutesText ? '• ' + substitutesText : null,
          teaDatesToAvoid: renewal.teaDatesToAvoid || null,
          cleaningDatesToAvoid: renewal.cleaningDatesToAvoid || null,
          drivingAwayMatches: user.drivingAwayMatches || null,
          drivingAdditionalInfo: user.drivingAdditionalInfo || null,
          greenMaintenance: user.greenMaintenance || null,
          greenAdditionalInfo: user.greenAdditionalInfo || null,
          barDuty: user.barDuty || null,
          barAdditionalInfo: user.barAdditionalInfo || null,
          otherSkills: user.otherSkills || null,
          showTriplesWarning: renewal.drawnTriples ? 'Y' : null,
          paidOnline,
          ...bankDetails,
        }
      )
    );

    if (!result.success) {
      return result;
    }

    const emailSentDate = new Date().toISOString();
    await updateRenewal(userName, {
      confirmationEmailDate: emailSentDate,
    });

    return { success: true };
  } catch (error) {
    console.error(`[sendRenewalConfirmation] Failed to send confirmation for ${userName}:`, error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to send confirmation email';

    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Send the "draft saved" email (on Save Draft). Deliberately says it's ONLY a draft and
 * carries no bank details or payment instructions, so nobody pays for a renewal that
 * hasn't been submitted (spec §3.5).
 */
export async function sendRenewalDraftEmail(
  userName: string,
  renewal: Renewal,
  fees: FeeBreakdown,
  memberType: string,
  managerUserName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUserByUsername(userName);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    if (!isEmailConfigured()) {
      return { success: false, error: 'SMTP not configured' };
    }

    const recipient = await resolveRenewalRecipient(user, managerUserName);
    if (!recipient) {
      return { success: false, error: 'No email address found for user, manager, or buddy' };
    }

    const appUrl = await getAppUrl();

    return await withEmailLogContext({ sentBy: managerUserName || userName, userName }, () =>
      sendTemplateEmail(
        recipient.recipientEmail,
        'BHBC Membership Renewal - Draft Saved (Not Yet Submitted)',
        'renewal-draft',
        {
          memberName: recipient.memberName,
          seasonYear: String(getCurrentSeasonYear()),
          memberType: memberType || user.memberType,
          membershipFee: formatCurrency(fees.membershipFee),
          compsFee: formatCurrency(fees.compsFee),
          club200Fee: formatCurrency(fees.club200Fee),
          totalFee: formatCurrency(fees.total),
          number200Club: describeDraft200Club(renewal),
          competitions: buildCompetitionsHtml(renewal),
          renewalsUrl: `${appUrl}/renewals`,
        }
      )
    );
  } catch (error) {
    console.error(`[sendRenewalDraftEmail] Failed to send draft email for ${userName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send draft email',
    };
  }
}

/** Send membership cancellation confirmation email — called when a member is not renewing. */
export async function sendCancellationConfirmation(
  userName: string,
  managerUserName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getUserByUsername(userName);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    if (!isEmailConfigured()) {
      return { success: false, error: 'SMTP not configured' };
    }

    const recipient = await resolveRenewalRecipient(user, managerUserName);
    if (!recipient) {
      return { success: false, error: 'No email address found for user, manager, or buddy' };
    }
    const recipientEmail = recipient.recipientEmail;
    const memberName = recipient.memberName;

    const result = await withEmailLogContext({ sentBy: managerUserName || userName, userName }, () =>
      sendTemplateEmail(
        recipientEmail,
        'BHBC Membership - Sorry to See You Go',
        'renewal-cancellation',
        {
          memberName,
        }
      )
    );

    if (!result.success) {
      return result;
    }

    return { success: true };
  } catch (error) {
    console.error(`[sendCancellationConfirmation] Failed to send cancellation email for ${userName}:`, error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to send cancellation email';

    return {
      success: false,
      error: errorMsg,
    };
  }
}
