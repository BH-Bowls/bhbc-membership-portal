// src/lib/renewals-sheets.ts
// Renewals management operations for Google Sheets

import {
  getUserByUsername,
  type User,
  getColumnMap,
  getColumnLetter,
  updateEmailSentStatus,
  logMemberEmail,
} from './sheets';
import {
  createRowFieldGetter,
  createRowNumberGetter,
  wrapError,
} from './banking-sheets';
import { google } from 'googleapis';
import { sendTemplateEmail, isEmailConfigured } from './email/mailer';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Membership fee structure (in pounds)
 */
const MEMBERSHIP_FEES = {
  U18: 10,
  YOUNG_ADULT_STUDENT: 10,  // 18-24 in full-time education
  YOUNG_ADULT: 60,          // 18-24 not in education
  ADULT: 110,               // 25-59 and 60+
  SENIOR: 60,               // 80+
  SOCIAL: 25,
  HONORARY: 0,
} as const;

/**
 * Fee per 200 Club entry (in pounds)
 */
const CLUB_200_ENTRY_FEE = 6;

/**
 * Fee per competition entry (in pounds)
 */
const COMPETITION_ENTRY_FEE = 2;

/**
 * Google Sheets constants
 */
const RENEWALS_SHEET_RANGE = 'Renewals!A2:AP';  // 42 columns: A-AP
const HEADER_ROW_OFFSET = 2;  // Row 1 is header, data starts at row 2

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
  const id = process.env.MEMBERS_SPREADSHEET_ID;
  if (!id) throw new Error('MEMBERS_SPREADSHEET_ID not set');
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
 * Parse a Google Sheets row into a Renewal object
 * Extracts all renewal fields from a sheet row using column mapping
 *
 * @param row The raw row data from Google Sheets (array of cell values)
 * @param rowNumber The row number in the sheet (for tracking/updates)
 * @param colMap Mapping of column names to array indices
 * @returns Parsed Renewal object with all fields populated
 */
function parseRenewalRow(
  row: any[],
  rowNumber: number,
  colMap: { [key: string]: number }
): Renewal {
  // Create field getter function using shared helper from banking-sheets
  // This safely extracts string values from cells by column name
  const get = createRowFieldGetter(row, colMap);

  // Create number getter function using shared helper
  // This extracts numeric values, handling currency symbols and commas
  const getNumber = createRowNumberGetter(get);

  // Create boolean getter for Y/N fields in Google Sheets
  // Google Sheets stores boolean preferences as text (Y/N, Yes/No, TRUE/FALSE)
  const getBool = (field: string): boolean => {
    const val = get(field);
    // Check if value is any form of "yes" or "true"
    return val === 'Y' || val === 'Yes' || val === 'yes' || val === 'TRUE' || val === 'true';
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
 *
 * Race Condition Handling:
 * - If two requests come in simultaneously for a non-existent user,
 *   both may create rows, resulting in duplicates
 * - After creation, we re-read to verify and detect duplicates
 * - This doesn't fully prevent race conditions (would need database locks),
 *   but significantly reduces likelihood and handles duplicates gracefully
 *
 * @param userName Username to look up (case-insensitive)
 * @returns Renewal data if found/created
 * @throws Error if unable to query or create renewal (network error, API error, etc.)
 */
export async function getRenewalByUsername(
  userName: string
): Promise<Renewal> {
  try {
    const colMap = await getColumnMap('Renewals');
    const sheets = getGoogleSheetsClient();

    // Get all renewals data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: RENEWALS_SHEET_RANGE,
    });

    // Extract rows from response (empty array if no data)
    const rows = response.data.values;
    if (!rows) {
      // No data in sheet - create first row for this user
      const now = new Date().toISOString();
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

      // Re-read to get the created row
      const verifyResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: getSpreadsheetId(),
        range: RENEWALS_SHEET_RANGE,
      });

      const verifyRows = verifyResponse.data.values || [];
      return parseRenewalRow(verifyRows[0], HEADER_ROW_OFFSET, colMap);
    }

    // Get the column index for user_name field
    const userNameColIndex = colMap['user_name'];

    // Find user's row by searching for matching username (case-insensitive)
    // Loop through all rows to find the one with matching user_name
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Get the username value from this row
      const rowUserName = row[userNameColIndex];

      // Check if this row has a username and it matches our search
      if (rowUserName) {
        if (rowUserName.toLowerCase() === userName.toLowerCase()) {
          rowIndex = i;
          break;
        }
      }
    }

    // Check if we found the user
    if (rowIndex >= 0) {
      // User exists - parse and return their renewal data
      // Row numbers in Google Sheets start at 1, and row 1 is the header
      // So data row index 0 corresponds to sheet row 2
      return parseRenewalRow(rows[rowIndex], rowIndex + HEADER_ROW_OFFSET, colMap);
    }

    // User doesn't exist - create blank row with username and created_at
    const now = new Date().toISOString();

    // Create a row with values in the correct positions
    // We need to put data in the right columns based on colMap
    const newRow: any[] = [];
    newRow[colMap['user_name']] = userName;
    newRow[colMap['created_at']] = now;

    // Attempt to create the row
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'Renewals!A:AP',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [newRow],
      },
    });

    // Re-read sheet to verify creation and detect race condition duplicates
    // If another request created a row simultaneously, we'll find it here
    const verifyResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: RENEWALS_SHEET_RANGE,
    });

    // Extract rows from verification response
    const verifyRows = verifyResponse.data.values;
    if (!verifyRows) {
      throw new Error(`Created renewal row for ${userName} but sheet is empty on verification`);
    }

    // Find the user's row (may be the one we just created, or one created by another request)
    // This handles the race condition where two requests create rows simultaneously
    let verifyRowIndex = -1;
    for (let i = 0; i < verifyRows.length; i++) {
      const row = verifyRows[i];

      // Get the username from this row
      const rowUserName = row[userNameColIndex];

      // Check if this row matches our user
      if (rowUserName) {
        if (rowUserName.toLowerCase() === userName.toLowerCase()) {
          verifyRowIndex = i;
          break;
        }
      }
    }

    // Check if we found the row we just created
    if (verifyRowIndex >= 0) {
      // Return the actual row from the sheet (handles race condition gracefully)
      // If another request created a duplicate, we return the first match found
      return parseRenewalRow(verifyRows[verifyRowIndex], verifyRowIndex + HEADER_ROW_OFFSET, colMap);
    }

    // This should never happen - we just created the row!
    console.error(`[getRenewalByUsername] Created row for ${userName} but cannot find it on re-read`);
    throw new Error(`Created renewal row for ${userName} but cannot verify creation`);
  } catch (error) {
    console.error(`[getRenewalByUsername] Error getting/creating renewal for ${userName}:`, error);
    throw wrapError(
      `Failed to get or create renewal for user ${userName}`,
      error
    );
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
    console.error(`[updateRenewal] Failed to update renewal for ${userName}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update renewal',
    };
  }
}

/**
 * Calculate fees based on renewal data
 * Determines total fees owed based on member type, age, honorary status, and selections
 *
 * Fee Structure:
 * - Membership fee: Based on member type (Playing Lady/Man, Social Lady/Man), age, and honorary status
 * - 200 Club fee: £6 per entry
 * - Competition fee: £2 per competition entered
 *
 * Age-based Playing Membership Fees:
 * - Under 18: £10
 * - 18-24 (student): £10
 * - 18-24 (not student): £60
 * - 25-59: £110
 * - 60+: £110
 * - 80+: £60
 *
 * @param profile User profile with age demographic, member type, and honorary status
 * @param renewal Renewal selections (competitions, 200 Club entries, etc.)
 * @returns Fee breakdown with membership, 200 Club, competitions, and total
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
  // Initialize membership fee (will be set based on type and age)
  let membershipFee = 0;

  // Extract profile fields for easier access
  const { ageDemographic, memberType, fullTimeEducation, honorary } = profile;

  // Honorary members pay no fee regardless of member type or age
  if (honorary === 'Y') {
    membershipFee = MEMBERSHIP_FEES.HONORARY;
  }
  // Playing members (Playing Lady or Playing Man)
  else if (memberType === 'Playing Lady' || memberType === 'Playing Man') {
    switch (ageDemographic) {
      case 'U18':
        membershipFee = MEMBERSHIP_FEES.U18;
        break;
      case '18-24':
        membershipFee = fullTimeEducation ? MEMBERSHIP_FEES.YOUNG_ADULT_STUDENT : MEMBERSHIP_FEES.YOUNG_ADULT;
        break;
      case '25-59':
        membershipFee = MEMBERSHIP_FEES.ADULT;
        break;
      case '60+':
        membershipFee = MEMBERSHIP_FEES.ADULT;
        break;
      case '80+':
        membershipFee = MEMBERSHIP_FEES.SENIOR;
        break;
    }
  }
  // Social members (Social Lady or Social Man)
  else if (memberType === 'Social Lady' || memberType === 'Social Man') {
    membershipFee = MEMBERSHIP_FEES.SOCIAL;
  }

  // Calculate 200 Club fees
  // Each entry in the 200 Club costs £6
  // If number200ClubEntries is undefined or null, default to 0
  let num200ClubEntries = renewal.number200ClubEntries;
  if (num200ClubEntries === undefined || num200ClubEntries === null) {
    num200ClubEntries = 0;
  }
  const club200Fee = num200ClubEntries * CLUB_200_ENTRY_FEE;

  // Calculate competition fees
  // Count how many competitions the user has entered
  // Each competition costs £2 (note: substitute entries are free)
  const competitions = [
    'mensChampionship',    // Men's Championship
    'ladiesMaynard',       // Ladies Maynard
    'mensTwoWood',         // Men's Two Wood
    'ladiesTwoWood',       // Ladies Two Wood
    'marriedPairs',        // Married Pairs
    'drawnPairs',          // Drawn Pairs
    'australianPairs',     // Australian Pairs
    'drawnTriples',        // Drawn Triples

    'handicap',            // Handicap Competition
    'oldlands',            // Oldlands Competition
    'veterans',            // Veterans Competition
  ];

  // Count how many competitions are selected
  // Loop through each competition name and check if user selected it
  let compCount = 0;
  for (const comp of competitions) {
    // Check if this competition field is set to true in the renewal
    const isSelected = renewal[comp as keyof Renewal];
    if (isSelected) {
      compCount++;
    }
  }

  // Calculate total competition fees (£2 per competition)
  const compsFee = compCount * COMPETITION_ENTRY_FEE;

  // Calculate total amount owed
  // Sum of membership fee + 200 Club fees + competition fees
  const total = membershipFee + club200Fee + compsFee;

  // Return fee breakdown with all components
  return {
    membershipFee,        // Base membership fee
    club200Fee,           // 200 Club fees
    compsFee,             // Competition entry fees
    total,                // Total amount owed
  };
}

/**
 * Send renewal confirmation email
 * - Uses SMTP (nodemailer)
 * - Includes: name, fees breakdown, bank details
 * - If user has no email, sends to manager (person submitting) or their designated buddy
 */
export async function sendRenewalConfirmation(
  userName: string,
  renewal: Renewal,
  fees: FeeBreakdown,
  managerUserName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get user profile for email address and name
    const user = await getUserByUsername(userName);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Check if SMTP is configured
    if (!isEmailConfigured()) {
      return { success: false, error: 'SMTP not configured' };
    }

    // Determine recipient email - prioritize user's email, then manager, then buddy
    let recipientEmail = user.emailAddress;
    let memberName = user.fullKnownAs || user.firstName;

    // If user has no email, send to the person managing this renewal (if different from user)
    if (!recipientEmail && managerUserName && managerUserName !== userName) {
      const manager = await getUserByUsername(managerUserName);
      if (manager?.emailAddress) {
        recipientEmail = manager.emailAddress;
        // Note in template that this is being sent to the manager
        memberName = `${memberName} (sent to manager: ${manager.fullKnownAs || manager.firstName})`;
      }
    }

    // If still no email and user has a designated buddy, try sending to buddy
    if (!recipientEmail && user.buddyUserName) {
      const buddy = await getUserByUsername(user.buddyUserName);
      if (buddy?.emailAddress) {
        recipientEmail = buddy.emailAddress;
        // Note in template that this is for their buddy
        memberName = `${memberName} (sent to buddy: ${buddy.fullKnownAs || buddy.firstName})`;
      }
    }

    // If still no email address, return error
    if (!recipientEmail) {
      return { success: false, error: 'No email address found for user, manager, or buddy' };
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
    );

    if (!result.success) {
      // Log to MemberEmails sheet (full audit trail)
      await logMemberEmail({
        userName,
        emailAddress: user.emailAddress,
        templateName: 'Renewal Confirmation',
        subject: 'BHBC Membership Renewal Confirmation',
        success: false,
        errorMessage: result.error,
        sentBy: managerUserName || userName,
        attachments: [],
      });

      // Update Members sheet with failure status
      await updateEmailSentStatus(userName, false, result.error);
      return result;
    }

    // Log to MemberEmails sheet (full audit trail)
    await logMemberEmail({
      userName,
      emailAddress: user.emailAddress,
      templateName: 'Renewal Confirmation',
      subject: 'BHBC Membership Renewal Confirmation',
      success: true,
      sentBy: managerUserName || userName,
      attachments: [],
    });

    // Update confirmation_email_date in Renewals sheet
    const emailSentDate = new Date().toISOString();
    await updateRenewal(userName, {
      confirmationEmailDate: emailSentDate,
    });

    // Update Member Email Sent Status in Members sheet (quick reference)
    await updateEmailSentStatus(userName, true);

    return { success: true };
  } catch (error) {
    console.error(`[sendRenewalConfirmation] Failed to send confirmation for ${userName}:`, error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to send confirmation email';

    // Log to MemberEmails sheet (full audit trail)
    await logMemberEmail({
      userName,
      emailAddress: null,
      templateName: 'Renewal Confirmation',
      subject: 'BHBC Membership Renewal Confirmation',
      success: false,
      errorMessage: errorMsg,
      sentBy: managerUserName || userName,
      attachments: [],
    });

    // Update Members sheet with failure status
    await updateEmailSentStatus(userName, false, errorMsg);

    return {
      success: false,
      error: errorMsg,
    };
  }
}
