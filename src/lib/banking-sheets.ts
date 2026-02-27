// src/lib/banking-sheets.ts
// Banking reconciliation sheet operations

import { getGoogleSheetsClient, getSpreadsheetId, getColumnMap } from './sheets';

// ============================================================================
// Constants
// ============================================================================

/**
 * Payment ID format constants
 * Payment IDs are in format P### (e.g., P001, P042, P123)
 */
const PAYMENT_ID_PREFIX = 'P';
const PAYMENT_ID_NUMBER_LENGTH = 3;

/**
 * Google Sheets row offset
 * Row 1 is the header, so data starts at row 2
 */
const HEADER_ROW_OFFSET = 2;

// ============================================================================
// Type Definitions
// ============================================================================

export interface Payment {
  payment_id: string;
  date: string;
  type: 'TRF' | 'CDM' | 'CHQ' | 'CSH';
  reference: string;
  amount: number;
  status: 'Unmatched' | 'Matched' | 'Deleted';
  matched_users: string;
  _rowNumber?: number; // Internal use
}

export interface RenewalForBanking {
  userName: string;
  fullName: string;
  lastName: string;
  buddyUserName: string | null;
  outstanding: number;
  banking: number;
  donations: number;
  difference: number;
  totalPayment: number;
  bank_transfer: number;
  card_machine: number;
  cheque: number;
  cash: number;
  payment_ids: string;
  payment_notes: string | null;
  date_received: string | null;
  _rowNumber?: number; // Internal use
}

// ============================================================================
// Error Handling Utilities
// ============================================================================

/**
 * Wrap an error with additional context
 * Preserves the original error as the cause while adding contextual information
 *
 * @param message Context message describing what was being attempted
 * @param originalError The original error that occurred
 * @returns New error with context and original error preserved
 */
export function wrapError(message: string, originalError: unknown): Error {
  const error = new Error(message);
  error.cause = originalError;

  // Preserve stack trace from original error if available
  if (originalError instanceof Error && originalError.stack) {
    error.stack = `${error.stack}\n\nCaused by: ${originalError.stack}`;
  }

  return error;
}

// ============================================================================
// Shared Helper Functions
// ============================================================================

/**
 * Create a field getter for extracting string values from a sheet row
 *
 * @param row The sheet row data
 * @param colMap Column name to index mapping
 * @returns Function that gets a field value by column name
 */
export function createRowFieldGetter(row: any[], colMap: Record<string, number>) {
  return (field: string): string => {
    const colIndex = colMap[field];
    return colIndex !== undefined ? (row[colIndex] || '').toString().trim() : '';
  };
}

/**
 * Create a number getter for extracting numeric values from a sheet row
 * Handles currency formatting (£, $), commas, and whitespace
 *
 * @param get The field getter function
 * @returns Function that gets a numeric field value by column name
 */
export function createRowNumberGetter(get: (field: string) => string) {
  return (field: string): number => {
    const val = get(field);
    if (!val) return 0;
    // Strip currency symbols, commas, whitespace
    const cleaned = val.replace(/[£$,\s]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };
}

/**
 * Convert camelCase field name to snake_case column name
 * Handles special cases with custom field mapping
 *
 * @param field Field name in camelCase (e.g., "firstName", "emailAddress")
 * @param customMappings Optional custom field to column mappings
 * @returns Column name in snake_case (e.g., "first_name", "email_address")
 *
 * @example
 * camelToSnakeCase("firstName") // "first_name"
 * camelToSnakeCase("emailAddress") // "email_address"
 * camelToSnakeCase("address1", { address1: "address_1" }) // "address_1"
 */
export function camelToSnakeCase(
  field: string,
  customMappings?: Record<string, string>
): string {
  // Check custom mappings first
  if (customMappings && field in customMappings) {
    return customMappings[field];
  }

  // Convert camelCase to snake_case
  // Inserts underscore before each capital letter, then lowercases
  return field.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/**
 * Convert column index to Excel-style column letter
 *
 * Uses bijective base-26 numeration (A-Z, AA-ZZ, AAA-ZZZ, etc.)
 *
 * Examples:
 * - 0 → A
 * - 25 → Z
 * - 26 → AA
 * - 701 → ZZ
 * - 702 → AAA
 *
 * @param colIndex Column index (0-based, must be >= 0)
 * @returns Column letter in Excel format
 * @throws Error if colIndex is negative
 */
function getColumnLetter(colIndex: number): string {
  // Validation: column index must be non-negative
  if (colIndex < 0) {
    throw new Error(`Invalid column index: ${colIndex}. Column index must be >= 0`);
  }

  // Bijective base-26 algorithm
  // Converts 0-based index to Excel column letters
  let column = '';
  let index = colIndex + 1; // Convert to 1-based for the algorithm

  while (index > 0) {
    // Get the rightmost letter (A-Z)
    const remainder = (index - 1) % 26;
    column = String.fromCharCode(remainder + 65) + column;

    // Move to the next position (left)
    index = Math.floor((index - 1) / 26);
  }

  return column;
}

// ============================================================================
// Payment Operations (RenewalPayments Sheet)
// ============================================================================

/**
 * Parse a row from RenewalPayments sheet
 */
function parsePaymentRow(row: any[], rowNumber: number, colMap: Record<string, number>): Payment {
  const get = createRowFieldGetter(row, colMap);
  const getNumber = createRowNumberGetter(get);

  return {
    payment_id: get('payment_id'),
    date: get('date'),
    type: get('type') as Payment['type'],
    reference: get('reference'),
    amount: getNumber('amount'),
    status: get('status') as Payment['status'],
    matched_users: get('matched_users'),
    _rowNumber: rowNumber,
  };
}

/**
 * Get all unmatched payments from RenewalPayments sheet
 */
export async function getUnmatchedPayments(): Promise<Payment[]> {
  try {
    const colMap = await getColumnMap('RenewalPayments');
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'RenewalPayments!A2:G', // 7 columns: A-G
    });

    const rows = response.data.values || [];

    return rows
      .map((row, index) => parsePaymentRow(row, index + HEADER_ROW_OFFSET, colMap))
      .filter(p => p.status === 'Unmatched'); // Only unmatched
  } catch (error) {
    console.error('[getUnmatchedPayments] Failed to retrieve unmatched payments:', error);
    throw wrapError(
      'Failed to retrieve unmatched payments from RenewalPayments sheet',
      error
    );
  }
}

/**
 * Generate next payment ID (P001, P002, etc.)
 *
 * Implements duplicate detection to handle race conditions:
 * - Reads all existing payment IDs
 * - Finds the highest number used
 * - Returns next available ID
 *
 * Note: This doesn't fully prevent race conditions (would need database-level locks),
 * but reduces the likelihood. The addPaymentToSheet function should validate uniqueness.
 *
 * @returns Next payment ID in format P### (e.g., "P001", "P042")
 * @throws Error if unable to generate ID after examining existing payments
 */
export async function generateNextPaymentId(): Promise<string> {
  try {
    const colMap = await getColumnMap('RenewalPayments');
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'RenewalPayments!A2:A', // Just payment_id column
    });

    const rows = response.data.values || [];

    // If no payments exist, start with P001
    if (rows.length === 0) {
      return `${PAYMENT_ID_PREFIX}${String(1).padStart(PAYMENT_ID_NUMBER_LENGTH, '0')}`;
    }

    // Find the highest payment number used (handles gaps and out-of-order entries)
    let maxNumber = 0;
    for (const row of rows) {
      const paymentId = row[0];
      if (paymentId && typeof paymentId === 'string' && paymentId.startsWith(PAYMENT_ID_PREFIX)) {
        const numStr = paymentId.substring(PAYMENT_ID_PREFIX.length);
        const num = parseInt(numStr, 10);
        if (!isNaN(num) && num > maxNumber) {
          maxNumber = num;
        }
      }
    }

    // Return next ID after the highest found
    const nextNumber = maxNumber + 1;
    return `${PAYMENT_ID_PREFIX}${String(nextNumber).padStart(PAYMENT_ID_NUMBER_LENGTH, '0')}`;
  } catch (error) {
    console.error('[generateNextPaymentId] Failed to generate next payment ID:', error);
    throw wrapError(
      'Failed to generate next payment ID. Please try again.',
      error
    );
  }
}

/**
 * Add payment to RenewalPayments sheet
 *
 * Validates payment data before insertion:
 * - Checks for duplicate payment_id
 * - Validates payment type is valid (TRF, CDM, CHQ, CSH)
 * - Validates amount is positive
 *
 * @param payment Payment to add (without _rowNumber)
 * @throws Error if validation fails or payment_id already exists
 */
export async function addPaymentToSheet(payment: Omit<Payment, '_rowNumber'>): Promise<void> {
  try {
    // Validation: Check payment type is valid
    const validTypes = ['TRF', 'CDM', 'CHQ', 'CSH'];
    if (!validTypes.includes(payment.type)) {
      throw new Error(`Invalid payment type: ${payment.type}. Must be one of: ${validTypes.join(', ')}`);
    }

    // Validation: Check amount is positive
    if (payment.amount <= 0) {
      throw new Error(`Invalid payment amount: ${payment.amount}. Must be greater than 0`);
    }

    // Validation: Check for duplicate payment_id
    const existingPayment = await getPayment(payment.payment_id);
    if (existingPayment) {
      throw new Error(`Payment ID ${payment.payment_id} already exists. This may be a race condition. Please try again.`);
    }

    const sheets = getGoogleSheetsClient();

    const values = [[
      payment.payment_id,
      payment.date,
      payment.type,
      payment.reference,
      payment.amount,
      payment.status,
      payment.matched_users,
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'RenewalPayments!A:G',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  } catch (error) {
    console.error(`[addPaymentToSheet] Failed to add payment ${payment.payment_id}:`, error);
    throw wrapError(
      `Failed to add payment ${payment.payment_id} to RenewalPayments sheet`,
      error
    );
  }
}

/**
 * Add multiple payments to RenewalPayments sheet in a single batch operation
 *
 * This function avoids Google Sheets API quota limits by writing all payments
 * in a single API call instead of individual writes for each payment.
 *
 * Validates all payment data before insertion:
 * - Checks for duplicate payment_ids (against existing payments)
 * - Validates all payment types are valid (TRF, CDM, CHQ, CSH)
 * - Validates all amounts are positive
 *
 * @param payments Array of payments to add (without _rowNumber)
 * @throws Error if validation fails for any payment or if any payment_id already exists
 */
export async function addPaymentsToSheet(payments: Omit<Payment, '_rowNumber'>[]): Promise<void> {
  try {
    // Return early if no payments to add
    if (payments.length === 0) {
      return;
    }

    // Define valid payment types for validation
    const validTypes = ['TRF', 'CDM', 'CHQ', 'CSH'];

    // Validate all payments before writing to Google Sheets
    // Loop through each payment to check
    for (const payment of payments) {
      // Check if payment type is one of the allowed types
      const isValidType = validTypes.includes(payment.type);
      if (!isValidType) {
        throw new Error(`Invalid payment type: ${payment.type}. Must be one of: ${validTypes.join(', ')}`);
      }

      // Check if amount is greater than zero
      if (payment.amount <= 0) {
        throw new Error(`Invalid payment amount: ${payment.amount} for payment ${payment.payment_id}. Must be greater than 0`);
      }
    }

    // Get column mapping for RenewalPayments sheet
    const colMap = await getColumnMap('RenewalPayments');

    // Get Google Sheets client
    const sheets = getGoogleSheetsClient();

    // Fetch all existing payment IDs from column A (payment_id column)
    // This allows us to check for duplicates in one API call instead of many
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'RenewalPayments!A2:A', // Column A, starting from row 2 (skip header)
    });

    // Build a Set of existing payment IDs for fast lookup
    const existingPaymentIds = new Set<string>();
    const rows = response.data.values || [];

    // Loop through all existing payment ID rows
    for (const row of rows) {
      // Check if this row has a payment ID in column A
      if (row[0]) {
        // Add payment ID to Set
        existingPaymentIds.add(row[0]);
      }
    }

    // Check if any of the new payments already exist in the sheet
    for (const payment of payments) {
      // Check if this payment ID is already in the Set
      if (existingPaymentIds.has(payment.payment_id)) {
        throw new Error(`Payment ID ${payment.payment_id} already exists. This may be a race condition. Please try again.`);
      }
    }

    // Build array of rows to append to the sheet
    // Each row contains: payment_id, date, type, reference, amount, status, matched_users
    // Columns A-G: payment_id, date, type, reference, amount, status, matched_users
    const values = payments.map(payment => [
      payment.payment_id,    // Column A: Payment ID (e.g., "P001")
      payment.date,          // Column B: Payment date
      payment.type,          // Column C: Payment type (TRF, CDM, CHQ, CSH)
      payment.reference,     // Column D: Payment reference from bank
      payment.amount,        // Column E: Payment amount
      payment.status,        // Column F: Payment status (Unmatched, Matched, Deleted)
      payment.matched_users, // Column G: Comma-separated list of matched usernames
    ]);

    // Write all payment rows to sheet in a single API call
    // This avoids hitting the 60 writes/minute quota limit
    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'RenewalPayments!A:G', // Append to columns A-G
      valueInputOption: 'USER_ENTERED', // Parse values as if user typed them
      requestBody: { values },
    });
  } catch (error) {
    // Log error with context for debugging
    console.error(`[addPaymentsToSheet] Failed to add ${payments.length} payments:`, error);

    // Wrap error with additional context and throw
    throw wrapError(
      `Failed to add ${payments.length} payments to RenewalPayments sheet`,
      error
    );
  }
}

/**
 * Update payment in RenewalPayments sheet
 */
export async function updatePaymentInSheet(
  payment_id: string,
  updates: Partial<Payment>
): Promise<void> {
  try {
    const colMap = await getColumnMap('RenewalPayments');
    const sheets = getGoogleSheetsClient();

    // Find payment row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'RenewalPayments!A2:G',
    });

    const rows = response.data.values || [];
    const paymentIdCol = colMap['payment_id'];

    const rowIndex = rows.findIndex(row => row[paymentIdCol] === payment_id);

    if (rowIndex < 0) {
      throw new Error(`Payment ${payment_id} not found`);
    }

    const rowNumber = rowIndex + HEADER_ROW_OFFSET;

    // Field to column mapping
    const fieldToColumnMap: Record<string, string> = {
      date: 'date',
      type: 'type',
      reference: 'reference',
      amount: 'amount',
      status: 'status',
      matched_users: 'matched_users',
    };

    // Prepare batch update
    const updateData: any[] = [];

    for (const [field, value] of Object.entries(updates)) {
      const columnName = fieldToColumnMap[field];
      if (columnName && colMap[columnName] !== undefined) {
        const columnLetter = getColumnLetter(colMap[columnName]);
        updateData.push({
          range: `RenewalPayments!${columnLetter}${rowNumber}`,
          values: [[value]],
        });
      }
    }

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: getSpreadsheetId(),
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updateData,
        },
      });
    }
  } catch (error) {
    console.error(`[updatePaymentInSheet] Failed to update payment ${payment_id}:`, error);
    throw wrapError(
      `Failed to update payment ${payment_id} in RenewalPayments sheet`,
      error
    );
  }
}

/**
 * Get payment by ID
 *
 * @returns Payment if found, null if not found
 * @throws Error if unable to query the sheet (network error, API error, etc.)
 */
export async function getPayment(payment_id: string): Promise<Payment | null> {
  try {
    const colMap = await getColumnMap('RenewalPayments');
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'RenewalPayments!A2:G',
    });

    const rows = response.data.values || [];
    const paymentIdCol = colMap['payment_id'];

    const rowIndex = rows.findIndex(row => row[paymentIdCol] === payment_id);

    // Payment not found - this is a valid case, not an error
    if (rowIndex < 0) {
      return null;
    }

    return parsePaymentRow(rows[rowIndex], rowIndex + HEADER_ROW_OFFSET, colMap);
  } catch (error) {
    // Actual error occurred (network, API, parsing, etc.) - throw, don't return null
    console.error(`[getPayment] Failed to retrieve payment ${payment_id}:`, error);
    throw wrapError(
      `Failed to retrieve payment ${payment_id} from RenewalPayments sheet`,
      error
    );
  }
}

// ============================================================================
// Renewal Operations (for Banking)
// ============================================================================

/**
 * Parse renewal row for banking purposes
 */
function parseRenewalForBanking(
  row: any[],
  rowNumber: number,
  colMap: Record<string, number>
): RenewalForBanking {
  const get = createRowFieldGetter(row, colMap);
  const getNumber = createRowNumberGetter(get);

  // Try multiple column names for full name
  const userName = get('user_name');
  let fullName = get('full_name');
  if (!fullName) {
    fullName = get('full_known_as');
  }
  if (!fullName) {
    fullName = get('name');
  }
  if (!fullName) {
    fullName = userName; // Fallback to userName
  }

  return {
    userName,
    fullName,
    lastName: get('last_name'),
    buddyUserName: get('buddy_user_name') || null,
    outstanding: getNumber('outstanding'),
    banking: getNumber('banking'),
    donations: getNumber('donations'),
    difference: getNumber('difference'),
    totalPayment: getNumber('total_fee_due'),
    bank_transfer: getNumber('bank_transfer'),
    card_machine: getNumber('card_machine'),
    cheque: getNumber('cheque'),
    cash: getNumber('cash'),
    payment_ids: get('payment_ids'),
    payment_notes: get('payment_notes') || null,
    date_received: get('date_paid') || null,
    _rowNumber: rowNumber,
  };
}

/**
 * Get renewals with outstanding > 0
 */
export async function getRenewalsWithOutstanding(): Promise<RenewalForBanking[]> {
  try {
    const colMap = await getColumnMap('Renewals');
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Renewals!A2:AP',
    });

    const rows = response.data.values || [];

    // Also get Members sheet to lookup full names, last names, and buddy information
    const membersColMap = await getColumnMap('Members');
    const membersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Members!A2:AZ',
    });
    const membersRows = membersResponse.data.values || [];

    // Build member lookup map: userName → { fullName, lastName, buddyUserName }
    interface MemberInfo {
      fullName: string;
      lastName: string;
      buddyUserName: string | null;
    }
    const memberMap = new Map<string, MemberInfo>();
    const userNameCol = membersColMap['user_name'];
    const buddyCol = membersColMap['buddy_user_name'];
    // Try multiple column names for full name (different sheets use different names)
    // Members sheet typically uses 'full_name' column
    const fullNameCol = membersColMap['full_name'] ?? membersColMap['full_known_as'] ?? membersColMap['name'];
    const lastNameCol = membersColMap['last_name'] ?? membersColMap['surname'];

    for (const memberRow of membersRows) {
      const userName = memberRow[userNameCol];
      if (userName) {
        const fullName = (fullNameCol !== undefined ? memberRow[fullNameCol] : '') || userName;
        const lastName = (lastNameCol !== undefined ? memberRow[lastNameCol] : '') || '';
        const buddyUserName = memberRow[buddyCol] || null;
        memberMap.set(userName.toLowerCase(), { fullName, lastName, buddyUserName });
      }
    }

    // Parse renewals and enrich with member information from Members sheet
    const renewals = rows
      .map((row, index) => {
        const renewal = parseRenewalForBanking(row, index + HEADER_ROW_OFFSET, colMap);

        // Override fullName, lastName, and buddyUserName from Members sheet
        // (Renewals sheet only has userName, not full member details)
        const memberInfo = memberMap.get(renewal.userName.toLowerCase());
        if (memberInfo) {
          renewal.fullName = memberInfo.fullName;
          renewal.lastName = memberInfo.lastName;
          renewal.buddyUserName = memberInfo.buddyUserName;
        }

        return renewal;
      })
      .filter(r => r.outstanding > 0); // Only unpaid/part-paid

    return renewals;
  } catch (error) {
    console.error('[getRenewalsWithOutstanding] Failed to retrieve renewals with outstanding balances:', error);
    throw wrapError(
      'Failed to retrieve renewals with outstanding balances from Renewals sheet',
      error
    );
  }
}

/**
 * Update renewal payment details
 */
export async function updateRenewalPayment(
  userName: string,
  updates: {
    outstanding: number;
    banking: number;
    donations: number;
    difference: number;
    typeAmounts: {
      bank_transfer: number;
      card_machine: number;
      cheque: number;
      cash: number;
    };
    payment_ids: string;
    payment_notes?: string;
    date_received: string;
  }
): Promise<void> {
  try {
    const colMap = await getColumnMap('Renewals');
    const sheets = getGoogleSheetsClient();

    // Find renewal row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Renewals!A2:AP',
    });

    const rows = response.data.values || [];
    const userNameCol = colMap['user_name'];

    const rowIndex = rows.findIndex(
      row => row[userNameCol]?.toLowerCase() === userName.toLowerCase()
    );

    if (rowIndex < 0) {
      throw new Error(`Renewal for ${userName} not found`);
    }

    const rowNumber = rowIndex + HEADER_ROW_OFFSET;

    // Prepare batch update
    const updateData: any[] = [];

    const addUpdate = (columnName: string, value: any) => {
      if (colMap[columnName] !== undefined) {
        const columnLetter = getColumnLetter(colMap[columnName]);
        updateData.push({
          range: `Renewals!${columnLetter}${rowNumber}`,
          values: [[value]],
        });
      }
    };

    addUpdate('outstanding', updates.outstanding);
    addUpdate('banking', updates.banking);
    addUpdate('donations', updates.donations);
    addUpdate('difference', updates.difference);
    // Update all payment type columns
    addUpdate('bank_transfer', updates.typeAmounts.bank_transfer);
    addUpdate('card_machine', updates.typeAmounts.card_machine);
    addUpdate('cheque', updates.typeAmounts.cheque);
    addUpdate('cash', updates.typeAmounts.cash);
    addUpdate('payment_ids', updates.payment_ids);
    if (updates.payment_notes) {
      addUpdate('payment_notes', updates.payment_notes);
    }
    addUpdate('date_paid', updates.date_received);

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: getSpreadsheetId(),
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updateData,
        },
      });
    }
  } catch (error) {
    console.error(`[updateRenewalPayment] Failed to update renewal for ${userName}:`, error);
    throw wrapError(
      `Failed to update renewal payment for ${userName} in Renewals sheet`,
      error
    );
  }
}

/**
 * Get payment type column name for renewal sheet
 *
 * Maps payment type codes to Renewals sheet column names:
 * - TRF → bank_transfer
 * - CDM → card_machine
 * - CHQ → cheque
 * - CSH → cash
 *
 * @param type Payment type code (case-insensitive)
 * @returns Column name in Renewals sheet
 * @throws Error if type is invalid
 */
export function getPaymentTypeColumn(type: string): string {
  // Normalize to uppercase for case-insensitive matching
  const normalizedType = type.toUpperCase();

  const mapping: Record<string, string> = {
    'TRF': 'bank_transfer',
    'CDM': 'card_machine',
    'CHQ': 'cheque',
    'CSH': 'cash',
  };

  const columnName = mapping[normalizedType];

  if (!columnName) {
    throw new Error(
      `Invalid payment type: "${type}". Must be one of: TRF, CDM, CHQ, CSH`
    );
  }

  return columnName;
}
