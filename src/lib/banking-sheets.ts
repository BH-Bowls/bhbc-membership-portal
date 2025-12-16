// src/lib/banking-sheets.ts
// Banking reconciliation sheet operations

import { getGoogleSheetsClient, getSpreadsheetId, getColumnMap } from './sheets';

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
  fullKnownAs: string;
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
// Payment Operations (Renewal Payments Sheet)
// ============================================================================

/**
 * Parse a row from Renewal Payments sheet
 */
function parsePaymentRow(row: any[], rowNumber: number, colMap: Record<string, number>): Payment {
  const get = (field: string): string => {
    const colIndex = colMap[field];
    return colIndex !== undefined ? (row[colIndex] || '').toString().trim() : '';
  };

  const getNumber = (field: string): number => {
    const val = get(field);
    if (!val) return 0;
    // Strip currency symbols, commas, whitespace
    const cleaned = val.replace(/[£$,\s]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };

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
 * Get all unmatched payments from Renewal Payments sheet
 */
export async function getUnmatchedPayments(): Promise<Payment[]> {
  try {
    const colMap = await getColumnMap('Renewal Payments');
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Renewal Payments!A2:G', // 7 columns: A-G
    });

    const rows = response.data.values || [];

    return rows
      .map((row, index) => parsePaymentRow(row, index + 2, colMap))
      .filter(p => p.status === 'Unmatched'); // Only unmatched
  } catch (error) {
    console.error('Error getting unmatched payments:', error);
    throw error;
  }
}

/**
 * Generate next payment ID (P001, P002, etc.)
 */
export async function generateNextPaymentId(): Promise<string> {
  try {
    const colMap = await getColumnMap('Renewal Payments');
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Renewal Payments!A2:A', // Just payment_id column
    });

    const rows = response.data.values || [];

    if (rows.length === 0) {
      return 'P001';
    }

    // Get last payment ID and increment
    const lastId = rows[rows.length - 1][0];
    const num = parseInt(lastId.substring(1)) + 1;
    return `P${String(num).padStart(3, '0')}`;
  } catch (error) {
    console.error('Error generating payment ID:', error);
    return 'P001';
  }
}

/**
 * Add payment to Renewal Payments sheet
 */
export async function addPaymentToSheet(payment: Omit<Payment, '_rowNumber'>): Promise<void> {
  try {
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
      range: 'Renewal Payments!A:G',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  } catch (error) {
    console.error('Error adding payment:', error);
    throw error;
  }
}

/**
 * Update payment in Renewal Payments sheet
 */
export async function updatePaymentInSheet(
  payment_id: string,
  updates: Partial<Payment>
): Promise<void> {
  try {
    const colMap = await getColumnMap('Renewal Payments');
    const sheets = getGoogleSheetsClient();

    // Find payment row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Renewal Payments!A2:G',
    });

    const rows = response.data.values || [];
    const paymentIdCol = colMap['payment_id'];

    const rowIndex = rows.findIndex(row => row[paymentIdCol] === payment_id);

    if (rowIndex < 0) {
      throw new Error(`Payment ${payment_id} not found`);
    }

    const rowNumber = rowIndex + 2;

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
        const columnLetter = String.fromCharCode(65 + colMap[columnName]);
        updateData.push({
          range: `Renewal Payments!${columnLetter}${rowNumber}`,
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
    console.error('Error updating payment:', error);
    throw error;
  }
}

/**
 * Get payment by ID
 */
export async function getPayment(payment_id: string): Promise<Payment | null> {
  try {
    const colMap = await getColumnMap('Renewal Payments');
    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Renewal Payments!A2:G',
    });

    const rows = response.data.values || [];
    const paymentIdCol = colMap['payment_id'];

    const rowIndex = rows.findIndex(row => row[paymentIdCol] === payment_id);

    if (rowIndex < 0) {
      return null;
    }

    return parsePaymentRow(rows[rowIndex], rowIndex + 2, colMap);
  } catch (error) {
    console.error('Error getting payment:', error);
    return null;
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
  const get = (field: string): string => {
    const colIndex = colMap[field];
    return colIndex !== undefined ? (row[colIndex] || '').toString().trim() : '';
  };

  const getNumber = (field: string): number => {
    const val = get(field);
    if (!val) return 0;
    const cleaned = val.replace(/[£$,\s]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };

  return {
    userName: get('user_name'),
    fullKnownAs: get('full_name'),
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

    return rows
      .map((row, index) => parseRenewalForBanking(row, index + 2, colMap))
      .filter(r => r.outstanding > 0); // Only unpaid/part-paid
  } catch (error) {
    console.error('Error getting renewals with outstanding:', error);
    throw error;
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
    paymentTypeColumn: string;
    paymentTypeAmount: number;
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

    const rowNumber = rowIndex + 2;

    // Prepare batch update
    const updateData: any[] = [];

    const addUpdate = (columnName: string, value: any) => {
      if (colMap[columnName] !== undefined) {
        const columnLetter = String.fromCharCode(65 + colMap[columnName]);
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
    addUpdate(updates.paymentTypeColumn, updates.paymentTypeAmount);
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
    console.error('Error updating renewal payment:', error);
    throw error;
  }
}

/**
 * Get payment type column name for renewal sheet
 */
export function getPaymentTypeColumn(type: string): string {
  const mapping: Record<string, string> = {
    'TRF': 'bank_transfer',
    'CDM': 'card_machine',
    'CHQ': 'cheque',
    'CSH': 'cash',
  };
  return mapping[type] || 'bank_transfer';
}
