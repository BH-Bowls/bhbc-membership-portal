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
// Email sends are logged automatically by mailer.ts's transporter wrapper (see
// email-log-supabase.ts / supabase/migrations/0046) — withEmailLogContext below just
// attaches the right sentBy (member or whoever is managing them) to that log entry.

import { getSupabaseClient } from './supabase';
import { getUserByUsername } from './members-supabase';
import { sendTemplateEmail, isEmailConfigured, withEmailLogContext } from './email/mailer';

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

const CLUB_200_ENTRY_FEE = 6;
const COMPETITION_ENTRY_FEE = 2;

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

/** The bowls season is a plain calendar year (the renewals page itself is titled "for 2026 season"). */
export function getCurrentSeasonYear(): number {
  return new Date().getFullYear();
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

/** Update renewal data for a user in the current season. Ensures the row exists first. */
export async function updateRenewal(
  userName: string,
  updates: Partial<Renewal>
): Promise<{ success: boolean; error?: string }> {
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

    const { error } = await supabase
      .from('renewals')
      .update(columnUpdates)
      .ilike('username', userName)
      .eq('season_year', seasonYear);
    if (error) throw new Error(error.message);

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
    .eq('season_year', seasonYear);
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
 * 200 Club fee: £6 per entry. Competition fee: £2 per competition entered (subs are free).
 */
export function calculateFees(
  profile: {
    ageDemographic: string;
    memberType: string;
    fullTimeEducation?: boolean;
    honorary?: string | null;
  },
  renewal: Partial<Renewal>
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
  const club200Fee = num200ClubEntries * CLUB_200_ENTRY_FEE;

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
 * Send renewal confirmation email. If the user has no email, falls back to their manager
 * (person submitting on their behalf) or their designated buddy.
 */
export async function sendRenewalConfirmation(
  userName: string,
  renewal: Renewal,
  fees: FeeBreakdown,
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

    let recipientEmail = user.emailAddress;
    let memberName = user.fullKnownAs || user.firstName;

    if (!recipientEmail && managerUserName && managerUserName !== userName) {
      const manager = await getUserByUsername(managerUserName);
      if (manager?.emailAddress) {
        recipientEmail = manager.emailAddress;
        memberName = `${memberName} (sent to manager: ${manager.fullKnownAs || manager.firstName})`;
      }
    }

    if (!recipientEmail && user.buddyUserName) {
      const buddy = await getUserByUsername(user.buddyUserName);
      if (buddy?.emailAddress) {
        recipientEmail = buddy.emailAddress;
        memberName = `${memberName} (sent to buddy: ${buddy.fullKnownAs || buddy.firstName})`;
      }
    }

    if (!recipientEmail) {
      return { success: false, error: 'No email address found for user, manager, or buddy' };
    }

    const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`;

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

    const competitionsText = competitions.length > 0
      ? competitions.join('<br>• ')
      : 'None selected';

    const substitutes: string[] = [];
    if (renewal.drawnPairsSub) substitutes.push('Drawn Pairs');
    if (renewal.australianPairsSub) substitutes.push('Australian Pairs');
    if (renewal.drawnTriplesSub) substitutes.push('Drawn Triples');

    const substitutesText = substitutes.length > 0
      ? substitutes.join('<br>• ')
      : null;

    const result = await withEmailLogContext({ sentBy: managerUserName || userName, userName }, () =>
      sendTemplateEmail(
        recipientEmail,
        'BHBC Membership Renewal Confirmation',
        'renewal-confirmation',
        {
          memberName,
          membershipFee: formatCurrency(fees.membershipFee),
          compsFee: formatCurrency(fees.compsFee),
          club200Fee: formatCurrency(fees.club200Fee),
          totalFee: formatCurrency(fees.total),
          paymentReference: `SUBS ${user.lastName.toUpperCase()}`,
          memberType: user.memberType,
          number200Club: renewal.number200ClubEntries > 0 ? renewal.number200ClubEntries.toString() : 'None',
          pref200Club: renewal.pref200Club || null,
          competitions: '• ' + competitionsText,
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

    let recipientEmail = user.emailAddress;
    let memberName = user.fullKnownAs || user.firstName;

    if (!recipientEmail && managerUserName && managerUserName !== userName) {
      const manager = await getUserByUsername(managerUserName);
      if (manager?.emailAddress) {
        recipientEmail = manager.emailAddress;
        memberName = `${memberName} (sent to manager: ${manager.fullKnownAs || manager.firstName})`;
      }
    }

    if (!recipientEmail && user.buddyUserName) {
      const buddy = await getUserByUsername(user.buddyUserName);
      if (buddy?.emailAddress) {
        recipientEmail = buddy.emailAddress;
        memberName = `${memberName} (sent to buddy: ${buddy.fullKnownAs || buddy.firstName})`;
      }
    }

    if (!recipientEmail) {
      return { success: false, error: 'No email address found for user, manager, or buddy' };
    }

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
