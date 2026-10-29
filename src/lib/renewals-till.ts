// src/lib/renewals-till.ts
// Membership fees at the bar till, by card or cash (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §8).
//
// The till lists renewals that are submitted, not voided and still owe something, and
// takes the full amount due. Recording is one database function
// (renewals_record_till_payment() in 0087): a matched Banking payment (source 'till'), the
// renewal's paid columns, and a renewal_transactions row for the renewals journal.
// The next Day End sweeps these payments in (cash counts towards expected cash) but the
// bar journal never posts them — see bar_create_day_end() in 0087.

import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';
import { getCurrentSeasonYear } from './renewals-supabase';
import type { BarDayEndLedgerRow } from './bar-supabase';

export interface TillRenewalDue {
  userName: string;
  fullName: string;
  membershipFee: number;   // pounds
  competitionsFee: number;
  club200Fee: number;
  totalFee: number;
  outstanding: number;     // the amount due now — what the till takes
}

/** Renewals the till can take payment for this season, by name. */
export async function getTillRenewalsDue(): Promise<TillRenewalDue[]> {
  const supabase = getSupabaseClient();
  const [{ data, error }, users] = await Promise.all([
    supabase.from('renewals')
      .select('username, playing_fee, social_fee, competitions_fee, club_200_fee, total_fee_due, outstanding')
      .eq('season_year', getCurrentSeasonYear())
      .eq('renewing_membership', true)
      .not('submitted_at', 'is', null) // drafts can't be paid (§3.9)
      .is('voided_at', null)
      .gt('outstanding', 0),
    getAllUsers(),
  ]);
  if (error) throw new Error(`Failed to load renewals due: ${error.message}`);

  const names = new Map<string, string>();
  for (const u of users) {
    if (u.userName) names.set(u.userName.toLowerCase(), u.fullName || u.userName);
  }

  const due: TillRenewalDue[] = [];
  for (const row of data || []) {
    const userName = String(row.username);
    due.push({
      userName: userName,
      fullName: names.get(userName.toLowerCase()) || userName,
      membershipFee: (Number(row.playing_fee) || 0) + (Number(row.social_fee) || 0),
      competitionsFee: Number(row.competitions_fee) || 0,
      club200Fee: Number(row.club_200_fee) || 0,
      totalFee: Number(row.total_fee_due) || 0,
      outstanding: Number(row.outstanding) || 0,
    });
  }
  due.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return due;
}

/**
 * Record a membership fee taken at the till. amount must be the full amount due, as
 * shown on the till — if it has changed since (e.g. a bank transfer was matched), the
 * database refuses it. Returns the new P### payment id.
 */
export async function recordTillRenewalPayment(opts: {
  userName: string;
  method: 'card' | 'cash';
  amount: number;
  staff: string;
  recordedBy: string;
}): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('renewals_record_till_payment', {
    p_username: opts.userName,
    p_season_year: getCurrentSeasonYear(),
    p_method: opts.method,
    p_amount: opts.amount,
    p_staff: opts.staff,
    p_recorded_by: opts.recordedBy,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export interface TillRenewalPayment {
  paymentId: string;
  userName: string;
  memberName: string;
  method: 'card' | 'cash';
  amountPence: number;
  staff: string | null;
  createdAt: string;
}

/**
 * Till renewal payments in a Day End — or, with dayEndId null, those not yet in one
 * (the till's live Dayend screen).
 */
export async function getTillRenewalPayments(dayEndId: string | null, method?: 'card' | 'cash'): Promise<TillRenewalPayment[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from('renewal_payments')
    .select('payment_id, type, amount, matched_users, staff, created_at')
    .eq('source', 'till')
    .neq('status', 'Deleted');
  if (dayEndId === null) query = query.is('day_end_id', null);
  else query = query.eq('day_end_id', dayEndId);
  if (method === 'card') query = query.eq('type', 'CDM');
  if (method === 'cash') query = query.eq('type', 'CSH');
  const [{ data, error }, users] = await Promise.all([query.order('created_at', { ascending: true }), getAllUsers()]);
  if (error) throw new Error(`Failed to load till renewal payments: ${error.message}`);

  const names = new Map<string, string>();
  for (const u of users) {
    if (u.userName) names.set(u.userName.toLowerCase(), u.fullName || u.userName);
  }
  const payments: TillRenewalPayment[] = [];
  for (const row of data || []) {
    const userName = String(row.matched_users || '');
    payments.push({
      paymentId: String(row.payment_id),
      userName: userName,
      memberName: names.get(userName.toLowerCase()) || userName,
      method: row.type === 'CDM' ? 'card' : 'cash',
      amountPence: Math.round((Number(row.amount) || 0) * 100),
      staff: row.staff ? String(row.staff) : null,
      createdAt: String(row.created_at),
    });
  }
  return payments;
}

/** The same payments shaped as Day End ledger rows, for the Dayend and Bar Reconciliation drill-downs. */
export async function getTillRenewalLedgerRows(dayEndId: string | null, method: 'card' | 'cash'): Promise<BarDayEndLedgerRow[]> {
  const rows: BarDayEndLedgerRow[] = [];
  for (const p of await getTillRenewalPayments(dayEndId, method)) {
    rows.push({
      id: p.paymentId, type: 'renewal', amountPence: p.amountPence, paymentMethod: p.method,
      userName: p.userName, memberName: p.memberName, staff: p.staff, note: null, createdAt: p.createdAt,
    });
  }
  return rows;
}
