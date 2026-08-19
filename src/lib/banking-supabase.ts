// src/lib/banking-supabase.ts
// Postgres-backed replacement for the Renewals/RenewalPayments-touching parts of
// banking-sheets.ts (the RenewalPayments sheet's payment CRUD, plus
// getRenewalsWithOutstanding/updateRenewalPayment which read+write the same `renewals`
// table renewals-supabase.ts owns). The rest of Banking (statement import parsing, the
// report page, its own reconciliation screens) stays Sheets-based for now — this is only
// the shared data those screens read/write, not a full Banking migration.
//
// Renamed from the old "...ToSheet"/"...InSheet" function names now that they're no
// longer accurate — see the 5 app/api/banking/* routes for the updated call sites.
// banking-sheets.ts itself is untouched: its shared row-parsing utilities
// (wrapError, createRowFieldGetter, createRowNumberGetter, etc.) are still used by
// several other still-Sheets modules.

import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';
import { getCurrentSeasonYear } from './renewals-supabase';
import { parseUKDate } from './date-utils';

const PAYMENT_ID_PREFIX = 'P';
const PAYMENT_ID_NUMBER_LENGTH = 3;

/**
 * renewal_payments.date is a real Postgres date column now — the Sheets version just
 * stored whatever string arrived (the CSV importer's Date column has no format validation
 * at all, and bank exports are typically DD/MM/YYYY). parseUKDate tolerantly handles UK,
 * ISO, and "Weekday, DD Month" formats via numeric Date(year, month, day) construction —
 * safe against the classic new Date("29/04/2026") day/month-swap trap. Idempotent for
 * already-ISO input (e.g. the manual add-payment form's <input type="date">).
 */
function toISODate(dateStr: string): string {
  const parsed = parseUKDate(dateStr);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Could not parse payment date: "${dateStr}"`);
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ============================================================================
// TYPES
// ============================================================================

export interface Payment {
  payment_id: string;
  date: string;
  type: 'TRF' | 'CDM' | 'CHQ' | 'CSH';
  reference: string;
  amount: number;
  status: 'Unmatched' | 'Matched' | 'Deleted';
  matched_users: string;
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
}

function mapPaymentRow(row: any): Payment {
  return {
    payment_id: row.payment_id,
    date: row.date,
    type: row.type,
    reference: row.reference ?? '',
    amount: Number(row.amount) || 0,
    status: row.status,
    matched_users: row.matched_users ?? '',
  };
}

// ============================================================================
// Payment Operations (renewal_payments table)
// ============================================================================

export async function getUnmatchedPayments(): Promise<Payment[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('renewal_payments').select('*').eq('status', 'Unmatched');
  if (error) throw new Error(`Failed to retrieve unmatched payments: ${error.message}`);
  return (data ?? []).map(mapPaymentRow);
}

/**
 * Generate next payment ID (P001, P002, etc.) — kept as a human-readable sequence rather
 * than switching to the row's own uuid, since it's what appears on bank reconciliation
 * records. Reads all existing IDs and picks the next number after the highest found;
 * doesn't fully prevent a race between two simultaneous generations (would need a DB
 * sequence/lock), same caveat as the Sheets version had.
 */
export async function generateNextPaymentId(): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('renewal_payments').select('payment_id');
  if (error) throw new Error(`Failed to generate next payment ID: ${error.message}`);

  let maxNumber = 0;
  for (const row of data ?? []) {
    const paymentId = row.payment_id as string;
    if (paymentId && paymentId.startsWith(PAYMENT_ID_PREFIX)) {
      const num = parseInt(paymentId.substring(PAYMENT_ID_PREFIX.length), 10);
      if (!isNaN(num) && num > maxNumber) maxNumber = num;
    }
  }

  return `${PAYMENT_ID_PREFIX}${String(maxNumber + 1).padStart(PAYMENT_ID_NUMBER_LENGTH, '0')}`;
}

/** Add a payment. Validates type/amount and rejects a duplicate payment_id (defence in
 * depth — the table's own unique constraint is the real guard against races). */
export async function addPayment(payment: Payment): Promise<void> {
  const validTypes = ['TRF', 'CDM', 'CHQ', 'CSH'];
  if (!validTypes.includes(payment.type)) {
    throw new Error(`Invalid payment type: ${payment.type}. Must be one of: ${validTypes.join(', ')}`);
  }
  if (payment.amount <= 0) {
    throw new Error(`Invalid payment amount: ${payment.amount}. Must be greater than 0`);
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from('renewal_payments').insert({
    payment_id: payment.payment_id,
    date: toISODate(payment.date),
    type: payment.type,
    reference: payment.reference,
    amount: payment.amount,
    status: payment.status,
    matched_users: payment.matched_users,
  });
  if (error) throw new Error(`Failed to add payment ${payment.payment_id}: ${error.message}`);
}

/** Add multiple payments in a single batch insert. */
export async function addPayments(payments: Payment[]): Promise<void> {
  if (payments.length === 0) return;

  const validTypes = ['TRF', 'CDM', 'CHQ', 'CSH'];
  for (const payment of payments) {
    if (!validTypes.includes(payment.type)) {
      throw new Error(`Invalid payment type: ${payment.type}. Must be one of: ${validTypes.join(', ')}`);
    }
    if (payment.amount <= 0) {
      throw new Error(`Invalid payment amount: ${payment.amount} for payment ${payment.payment_id}. Must be greater than 0`);
    }
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from('renewal_payments').insert(
    payments.map((p) => ({
      payment_id: p.payment_id,
      date: toISODate(p.date),
      type: p.type,
      reference: p.reference,
      amount: p.amount,
      status: p.status,
      matched_users: p.matched_users,
    }))
  );
  if (error) throw new Error(`Failed to add ${payments.length} payments: ${error.message}`);
}

export async function updatePayment(payment_id: string, updates: Partial<Payment>): Promise<void> {
  const supabase = getSupabaseClient();
  const columnUpdates: Record<string, unknown> = {};
  if (updates.date !== undefined) columnUpdates.date = toISODate(updates.date);
  if (updates.type !== undefined) columnUpdates.type = updates.type;
  if (updates.reference !== undefined) columnUpdates.reference = updates.reference;
  if (updates.amount !== undefined) columnUpdates.amount = updates.amount;
  if (updates.status !== undefined) columnUpdates.status = updates.status;
  if (updates.matched_users !== undefined) columnUpdates.matched_users = updates.matched_users;

  const { error, count } = await supabase
    .from('renewal_payments')
    .update(columnUpdates, { count: 'exact' })
    .eq('payment_id', payment_id);
  if (error) throw new Error(`Failed to update payment ${payment_id}: ${error.message}`);
  if (!count) throw new Error(`Payment ${payment_id} not found`);
}

export async function getPayment(payment_id: string): Promise<Payment | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('renewal_payments').select('*').eq('payment_id', payment_id).maybeSingle();
  if (error) throw new Error(`Failed to retrieve payment ${payment_id}: ${error.message}`);
  return data ? mapPaymentRow(data) : null;
}

// ============================================================================
// Renewal Operations (for Banking) — read/write the same `renewals` table
// renewals-supabase.ts owns, current season only.
// ============================================================================

/** Get renewals with outstanding > 0, for the current season. */
export async function getRenewalsWithOutstanding(): Promise<RenewalForBanking[]> {
  const supabase = getSupabaseClient();
  const seasonYear = getCurrentSeasonYear();

  const { data, error } = await supabase
    .from('renewals')
    .select('username, outstanding, banking, donations, difference, total_fee_due, bank_transfer, card_machine, cheque, cash, payment_ids, payment_notes, date_paid')
    .eq('season_year', seasonYear)
    .gt('outstanding', 0);
  if (error) throw new Error(`Failed to retrieve renewals with outstanding balances: ${error.message}`);

  const allUsers = await getAllUsers();
  const memberMap = new Map<string, { fullName: string; lastName: string; buddyUserName: string | null }>();
  for (const u of allUsers) {
    if (u.userName) {
      memberMap.set(u.userName.toLowerCase(), {
        fullName: u.fullName || u.userName,
        lastName: u.lastName || '',
        buddyUserName: u.buddyUserName || null,
      });
    }
  }

  return (data ?? []).map((row: any) => {
    const memberInfo = memberMap.get((row.username as string).toLowerCase());
    return {
      userName: row.username,
      fullName: memberInfo ? memberInfo.fullName : row.username,
      lastName: memberInfo ? memberInfo.lastName : '',
      buddyUserName: memberInfo ? memberInfo.buddyUserName : null,
      outstanding: Number(row.outstanding) || 0,
      banking: Number(row.banking) || 0,
      donations: Number(row.donations) || 0,
      difference: Number(row.difference) || 0,
      totalPayment: Number(row.total_fee_due) || 0,
      bank_transfer: Number(row.bank_transfer) || 0,
      card_machine: Number(row.card_machine) || 0,
      cheque: Number(row.cheque) || 0,
      cash: Number(row.cash) || 0,
      payment_ids: row.payment_ids ?? '',
      payment_notes: row.payment_notes ?? null,
      date_received: row.date_paid ?? null,
    };
  });
}

/** Update renewal payment/banking details for the current season. */
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
  const supabase = getSupabaseClient();
  const seasonYear = getCurrentSeasonYear();

  const columnUpdates: Record<string, unknown> = {
    outstanding: updates.outstanding,
    banking: updates.banking,
    donations: updates.donations,
    difference: updates.difference,
    bank_transfer: updates.typeAmounts.bank_transfer,
    card_machine: updates.typeAmounts.card_machine,
    cheque: updates.typeAmounts.cheque,
    cash: updates.typeAmounts.cash,
    payment_ids: updates.payment_ids,
    date_paid: toISODate(updates.date_received),
    updated_at: new Date().toISOString(),
  };
  if (updates.payment_notes) columnUpdates.payment_notes = updates.payment_notes;

  const { error, count } = await supabase
    .from('renewals')
    .update(columnUpdates, { count: 'exact' })
    .ilike('username', userName)
    .eq('season_year', seasonYear);
  if (error) throw new Error(`Failed to update renewal payment for ${userName}: ${error.message}`);
  if (!count) throw new Error(`Renewal for ${userName} not found`);
}

/**
 * Map payment type codes to renewals table columns: TRF -> bank_transfer,
 * CDM -> card_machine, CHQ -> cheque, CSH -> cash. Pure — ported unchanged.
 */
export function getPaymentTypeColumn(type: string): string {
  const normalizedType = type.toUpperCase();
  const mapping: Record<string, string> = {
    TRF: 'bank_transfer',
    CDM: 'card_machine',
    CHQ: 'cheque',
    CSH: 'cash',
  };
  const columnName = mapping[normalizedType];
  if (!columnName) {
    throw new Error(`Invalid payment type: "${type}". Must be one of: TRF, CDM, CHQ, CSH`);
  }
  return columnName;
}
