// src/lib/renewals-sheets.ts
// Renewals management operations for Google Sheets

import {
  getUserByUsername,
  type User,
  getColumnMap,
  getColumnLetter,
} from './sheets';
import { google } from 'googleapis';
import { sendTemplateEmail, isEmailConfigured } from './email/mailer';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface Renewal {
  userName: string;
  renewingMembership: boolean;
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
  _rowNumber?: number;
}

export interface FeeBreakdown {
  membershipFee: number;
  club200Fee: number;
  compsFee: number;
  total: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getSpreadsheetId(): string {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('SPREADSHEET_ID not set');
  return id;
}

function getServiceAccountEmail(): string {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL not set');
  return email;
}

function getPrivateKey(): string {
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!key) throw new Error('GOOGLE_PRIVATE_KEY not set');
  return key.replace(/\\n/g, '\n');
}

function getGoogleSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: getServiceAccountEmail(),
      private_key: getPrivateKey(),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

// Email transporter moved to centralized email/mailer.ts

/**
 * Parse a row from Renewals sheet into Renewal object
 */
function parseRenewalRow(
  row: any[],
  rowNumber: number,
  colMap: { [key: string]: number }
): Renewal {
  const get = (field: string): string | null => {
    const index = colMap[field];
    return index !== undefined ? (row[index] || null) : null;
  };

  const getBool = (field: string): boolean => {
    const val = get(field);
    return val === 'Y' || val === 'Yes' || val === 'yes' || val === 'TRUE' || val === 'true';
  };

  const getNumber = (field: string): number => {
    const val = get(field);
    if (!val) return 0;
    // Strip currency symbols (£, $), commas, and whitespace before parsing
    const cleaned = val.replace(/[£$,\s]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };

  return {
    userName: get('user_name') || '',
    renewingMembership: getBool('renewing_membership'),
    playingFees: getNumber('playing_fee'),
    socialFees: getNumber('social_fee'),
    compsFee: getNumber('competitions_fee'),
    fee200Club: getNumber('club_200_fee'),
    totalPayment: getNumber('total_fee_due'),
    outstanding: getNumber('outstanding') || null,
    banking: getNumber('banking') || null,
    dateReceived: get('date_paid'),
    number200ClubEntries: getNumber('club_200_entries'),
    pref200Club: get('club_200_preferred_numbers'),
    cleaningDatesToAvoid: get('cleaning_dates_to_avoid'),
    teaDatesToAvoid: get('tea_dates_to_avoid'),
    mensChampionship: getBool('comp_mens_championship'),
    ladiesMaynard: getBool('comp_ladies_maynard'),
    mensTwoWood: getBool('comp_mens_two_wood'),
    ladiesTwoWood: getBool('comp_ladies_two_wood'),
    marriedPairs: getBool('comp_married_pairs'),
    drawnPairs: getBool('comp_drawn_pairs'),
    australianPairs: getBool('comp_australian_pairs'),
    drawnTriples: getBool('comp_drawn_triples'),
    handicap: getBool('comp_handicap'),
    oldlands: getBool('comp_oldlands'),
    veterans: getBool('comp_veterans'),
    drawnPairsSub: getBool('sub_drawn_pairs'),
    australianPairsSub: getBool('sub_australian_pairs'),
    drawnTriplesSub: getBool('sub_drawn_triples'),
    confirmationEmailDate: get('confirmation_email_date'),
    createdAt: get('created_at'),
    dateUpdated: get('updated_at'),
    _rowNumber: rowNumber,
  };
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Get renewal data for a user
 * - Fetch from Renewals sheet
 * - If no row exists, create blank row with user_name
 * - Return renewal data
 */
export async function getRenewalByUsername(
  userName: string
): Promise<Renewal | null> {
  try {
    const colMap = await getColumnMap('Renewals');
    const sheets = getGoogleSheetsClient();

    // Get all renewals data (42 columns: A-AP)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Renewals!A2:AP', // Start from row 2 (skip header)
    });

    const rows = response.data.values || [];
    const userNameColIndex = colMap['user_name'];

    // Find user's row
    const rowIndex = rows.findIndex(
      (row) => row[userNameColIndex]?.toLowerCase() === userName.toLowerCase()
    );

    if (rowIndex >= 0) {
      // User exists - return their data
      return parseRenewalRow(rows[rowIndex], rowIndex + 2, colMap);
    }

    // User doesn't exist - create blank row with username and created_at
    const nextRowNumber = rows.length + 2; // +2 because header is row 1
    const now = new Date().toISOString();

    // Create a row with values in the correct positions
    // We need to put data in the right columns based on colMap
    const newRow: any[] = [];
    newRow[colMap['user_name']] = userName;
    newRow[colMap['created_at']] = now;

    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'Renewals!A:AP',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [newRow],
      },
    });

    // Return blank renewal object
    return {
      userName,
      renewingMembership: false,
      playingFees: 0,
      socialFees: 0,
      compsFee: 0,
      fee200Club: 0,
      totalPayment: 0,
      number200ClubEntries: 0,
      mensChampionship: false,
      ladiesMaynard: false,
      mensTwoWood: false,
      ladiesTwoWood: false,
      marriedPairs: false,
      drawnPairs: false,
      australianPairs: false,
      drawnTriples: false,
      handicap: false,
      oldlands: false,
      veterans: false,
      drawnPairsSub: false,
      australianPairsSub: false,
      drawnTriplesSub: false,
      createdAt: now,
      _rowNumber: nextRowNumber,
    };
  } catch (error) {
    console.error('Error getting renewal:', error);
    return null;
  }
}

/**
 * Update renewal data
 * - Update multiple columns in single batch operation
 * - Set date_updated to current timestamp
 * - Calculate and update total_payment
 * - Return updated renewal
 */
export async function updateRenewal(
  userName: string,
  updates: Partial<Renewal>
): Promise<{ success: boolean; error?: string }> {
  try {
    const renewal = await getRenewalByUsername(userName);

    if (!renewal || !renewal._rowNumber) {
      return { success: false, error: 'Renewal not found' };
    }

    const colMap = await getColumnMap('Renewals');
    const sheets = getGoogleSheetsClient();

    // Build batch update data
    const updateData: any[] = [];

    // Manual mapping for fields that don't follow standard pattern
    const fieldToColumnMap: { [key: string]: string } = {
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
      renewingMembership: 'renewing_membership',
      playingFees: 'playing_fee',
      socialFees: 'social_fee',
      compsFee: 'competitions_fee',
      fee200Club: 'club_200_fee',
      totalPayment: 'total_fee_due',
      outstanding: 'outstanding',
      banking: 'banking',
      dateReceived: 'date_paid',
      confirmationEmailDate: 'confirmation_email_date',
      createdAt: 'created_at',
      dateUpdated: 'updated_at',
    };

    // Update each field
    for (const [field, value] of Object.entries(updates)) {
      if (field === 'userName' || field === '_rowNumber') continue;

      const colName = fieldToColumnMap[field] ||
        field.replace(/([A-Z])/g, '_$1').toLowerCase();
      const colIndex = colMap[colName];

      if (colIndex !== undefined) {
        const colLetter = getColumnLetter(colIndex);

        // Convert boolean to Y/N for sheets
        let cellValue = value;
        if (typeof value === 'boolean') {
          cellValue = value ? 'Y' : 'N';
        }

        updateData.push({
          range: `Renewals!${colLetter}${renewal._rowNumber}`,
          values: [[cellValue ?? '']],
        });
      }
    }

    // Update updated_at timestamp
    const dateUpdatedCol = colMap['updated_at'];
    if (dateUpdatedCol !== undefined) {
      updateData.push({
        range: `Renewals!${getColumnLetter(dateUpdatedCol)}${renewal._rowNumber}`,
        values: [[new Date().toISOString()]],
      });
    }

    // Set created_at if it doesn't exist
    if (!renewal.createdAt) {
      const createdAtCol = colMap['created_at'];
      if (createdAtCol !== undefined) {
        updateData.push({
          range: `Renewals!${getColumnLetter(createdAtCol)}${renewal._rowNumber}`,
          values: [[new Date().toISOString()]],
        });
      }
    }

    // Execute batch update
    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: getSpreadsheetId(),
        requestBody: {
          data: updateData,
          valueInputOption: 'USER_ENTERED',
        },
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Error updating renewal:', error);
    return { success: false, error: 'Failed to update renewal' };
  }
}

/**
 * Calculate fees based on renewal data
 * - Takes user profile (age_demographic, member_type)
 * - Takes renewal selections
 * - Returns breakdown: { membershipFee, compsFee, club200Fee, total }
 */
export function calculateFees(
  profile: {
    ageDemographic: string;
    memberType: string;
    fullTimeEducation?: boolean;
  },
  renewal: Partial<Renewal>
): FeeBreakdown {
  let membershipFee = 0;

  // Calculate membership fees based on age and type
  const { ageDemographic, memberType, fullTimeEducation } = profile;

  // Fee calculation based on member type and age demographic
  switch (memberType) {
    case 'Playing':
      switch (ageDemographic) {
        case 'U18':
          membershipFee = 10;
          break;
        case '18-24':
          membershipFee = fullTimeEducation ? 10 : 60;
          break;
        case '25-59':
          membershipFee = 110;
          break;
        case '60+':
          membershipFee = 110;
          break;
        case '80+':
          membershipFee = 60;
          break;
      }
      break;
    case 'Social':
      membershipFee = 25;
      break;
    case 'Honorary':
      membershipFee = 0;
      break;
  }

  // Calculate 200 Club fees
  const club200Fee = (renewal.number200ClubEntries || 0) * 6;

  // Calculate competition fees
  const competitions = [
    'mensChampionship',
    'ladiesMaynard',
    'mensTwoWood',
    'ladiesTwoWood',
    'marriedPairs',
    'drawnPairs',
    'australianPairs',
    'drawnTriples',
    'handicap',
    'oldlands',
    'veterans',
  ];

  const compCount = competitions.filter(
    (comp) => renewal[comp as keyof Renewal] === true
  ).length;

  const compsFee = compCount * 2;

  // Calculate total
  const total = membershipFee + club200Fee + compsFee;

  return {
    membershipFee,
    club200Fee,
    compsFee,
    total,
  };
}

/**
 * Send renewal confirmation email
 * - Uses SMTP (nodemailer)
 * - Includes: name, fees breakdown, bank details
 */
export async function sendRenewalConfirmation(
  userName: string,
  renewal: Renewal,
  fees: FeeBreakdown
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get user profile for email address and name
    const user = await getUserByUsername(userName);
    if (!user || !user.emailAddress) {
      return { success: false, error: 'User email not found' };
    }

    // Check if SMTP is configured
    if (!isEmailConfigured()) {
      return { success: false, error: 'SMTP not configured' };
    }

    // Format currency
    const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`;

    // Build competitions list (excluding substitutes)
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

    // Build substitutes list
    const substitutes: string[] = [];
    if (renewal.drawnPairsSub) substitutes.push('Drawn Pairs');
    if (renewal.australianPairsSub) substitutes.push('Australian Pairs');
    if (renewal.drawnTriplesSub) substitutes.push('Drawn Triples');

    const substitutesText = substitutes.length > 0
      ? substitutes.join('<br>• ')
      : null;

    // Send email using template
    const result = await sendTemplateEmail(
      user.emailAddress,
      'BHBC Membership Renewal Confirmation',
      'renewal-confirmation',
      {
        memberName: user.fullKnownAs || user.firstName,
        membershipFee: formatCurrency(fees.membershipFee),
        compsFee: formatCurrency(fees.compsFee),
        club200Fee: formatCurrency(fees.club200Fee),
        totalFee: formatCurrency(fees.total),
        paymentReference: `SUBS ${(user.fullKnownAs || user.firstName).split(' ').pop()?.toUpperCase()}`,
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
      }
    );

    if (!result.success) {
      return result;
    }

    // Update confirmation_email_date in the sheet
    const emailSentDate = new Date().toISOString();
    await updateRenewal(userName, {
      confirmationEmailDate: emailSentDate,
    });

    return { success: true };
  } catch (error) {
    console.error('Error sending renewal confirmation:', error);
    return { success: false, error: 'Failed to send confirmation email' };
  }
}
