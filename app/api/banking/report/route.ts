// app/api/banking/report/route.ts
// Banking Report API - fetches data for Paid/Unpaid Subs and Allocated/Unallocated Payments

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseClient } from '@/lib/supabase';
import { getCurrentSeasonYear } from '@/lib/renewals-supabase';
import { getAllUsers } from '@/lib/members-supabase';
import { hasRole } from '@/lib/role-utils';

export interface RenewalReportRow {
  userName: string;
  fullName: string;
  renewingMembership: string;
  playingFee: number;
  socialFee: number;
  competitionsFee: number;
  club200Fee: number;
  totalFeeDue: number;
  outstanding: number;
  banking: number;
  difference: number;
  donations: number;
  cardMachine: number;
  bankTransfer: number;
  cheque: number;
  cash: number;
}

export interface PaymentReportRow {
  paymentId: string;
  date: string;
  type: 'TRF' | 'CDM' | 'CHQ' | 'CSH';
  reference: string;
  amount: number;
  status: string;
  matchedUsers: string;
}

export interface ReportTotals {
  playingFee: number;
  socialFee: number;
  competitionsFee: number;
  club200Fee: number;
  totalFeeDue: number;
  outstanding: number;
  banking: number;
  difference: number;
  donations: number;
  cardMachine: number;
  bankTransfer: number;
  cheque: number;
  cash: number;
  count: number;
}

export interface PaymentTotals {
  TRF: { amount: number; count: number };
  CDM: { amount: number; count: number };
  CHQ: { amount: number; count: number };
  CSH: { amount: number; count: number };
  total: { amount: number; count: number };
}

function zeroTotals(count: number): ReportTotals {
  return {
    playingFee: 0, socialFee: 0, competitionsFee: 0, club200Fee: 0, totalFeeDue: 0,
    outstanding: 0, banking: 0, difference: 0, donations: 0,
    cardMachine: 0, bankTransfer: 0, cheque: 0, cash: 0, count,
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Check authorization: Admin OR Treasurer
    if (!hasRole(session?.user?.role, 'Admin', 'Treasurer')) {
      return NextResponse.json(
        { error: 'Forbidden - Admin or Treasurer access required' },
        { status: 403 }
      );
    }

    const supabase = getSupabaseClient();
    const seasonYear = getCurrentSeasonYear();

    // Fetch Renewals data (current season only — this table is real multi-year history now)
    const { data: renewalsRows, error: renewalsError } = await supabase
      .from('renewals')
      .select('username, renewing_membership, playing_fee, social_fee, competitions_fee, club_200_fee, total_fee_due, outstanding, banking, difference, donations, card_machine, bank_transfer, cheque, cash')
      .eq('season_year', seasonYear);
    if (renewalsError) throw new Error(renewalsError.message);

    // Fetch Postgres members for full names
    const allUsers = await getAllUsers();
    const memberNames = new Map<string, string>();
    for (const u of allUsers) {
      if (u.userName) memberNames.set(u.userName.toLowerCase(), u.fullName || u.userName);
    }

    // Parse renewals
    const paidSubs: RenewalReportRow[] = [];
    const unpaidSubs: RenewalReportRow[] = [];

    for (const row of renewalsRows ?? []) {
      const userName = row.username as string;
      if (!userName) continue;

      const outstanding = row.outstanding === null ? null : Number(row.outstanding) || 0;
      const fullName = memberNames.get(userName.toLowerCase()) || userName;

      const renewalRow: RenewalReportRow = {
        userName,
        fullName,
        renewingMembership: row.renewing_membership === true ? 'Y' : row.renewing_membership === false ? 'N' : '',
        playingFee: Number(row.playing_fee) || 0,
        socialFee: Number(row.social_fee) || 0,
        competitionsFee: Number(row.competitions_fee) || 0,
        club200Fee: Number(row.club_200_fee) || 0,
        totalFeeDue: Number(row.total_fee_due) || 0,
        outstanding: outstanding ?? 0,
        banking: Number(row.banking) || 0,
        difference: Number(row.difference) || 0,
        donations: Number(row.donations) || 0,
        cardMachine: Number(row.card_machine) || 0,
        bankTransfer: Number(row.bank_transfer) || 0,
        cheque: Number(row.cheque) || 0,
        cash: Number(row.cash) || 0,
      };

      // Only rows where outstanding has actually been set (not null) count as paid/unpaid
      const hasOutstanding = outstanding !== null;

      if (hasOutstanding && outstanding === 0) {
        paidSubs.push(renewalRow);
      } else if (hasOutstanding && outstanding! > 0) {
        unpaidSubs.push(renewalRow);
      }
    }

    // Calculate paid subs totals
    const paidTotals = zeroTotals(paidSubs.length);
    for (const row of paidSubs) {
      paidTotals.playingFee += row.playingFee;
      paidTotals.socialFee += row.socialFee;
      paidTotals.competitionsFee += row.competitionsFee;
      paidTotals.club200Fee += row.club200Fee;
      paidTotals.totalFeeDue += row.totalFeeDue;
      paidTotals.outstanding += row.outstanding;
      paidTotals.banking += row.banking;
      paidTotals.difference += row.difference;
      paidTotals.donations += row.donations;
      paidTotals.cardMachine += row.cardMachine;
      paidTotals.bankTransfer += row.bankTransfer;
      paidTotals.cheque += row.cheque;
      paidTotals.cash += row.cash;
    }

    // Calculate unpaid subs totals
    const unpaidTotals = zeroTotals(unpaidSubs.length);
    for (const row of unpaidSubs) {
      unpaidTotals.playingFee += row.playingFee;
      unpaidTotals.socialFee += row.socialFee;
      unpaidTotals.competitionsFee += row.competitionsFee;
      unpaidTotals.club200Fee += row.club200Fee;
      unpaidTotals.totalFeeDue += row.totalFeeDue;
      unpaidTotals.outstanding += row.outstanding;
    }

    // Fetch Payments data
    const { data: paymentsRows, error: paymentsError } = await supabase
      .from('renewal_payments')
      .select('payment_id, date, type, reference, amount, status, matched_users')
      .neq('status', 'Deleted');
    if (paymentsError) throw new Error(paymentsError.message);

    // Parse payments
    const allocatedPayments: PaymentReportRow[] = [];
    const unallocatedPayments: PaymentReportRow[] = [];

    for (const row of paymentsRows ?? []) {
      const paymentRow: PaymentReportRow = {
        paymentId: row.payment_id,
        date: row.date,
        type: row.type as PaymentReportRow['type'],
        reference: row.reference ?? '',
        amount: Number(row.amount) || 0,
        status: row.status,
        matchedUsers: row.matched_users ?? '',
      };

      if (row.status === 'Matched') {
        allocatedPayments.push(paymentRow);
      } else {
        unallocatedPayments.push(paymentRow);
      }
    }

    // Calculate payment totals by type
    const calculatePaymentTotals = (payments: PaymentReportRow[]): PaymentTotals => {
      const totals: PaymentTotals = {
        TRF: { amount: 0, count: 0 },
        CDM: { amount: 0, count: 0 },
        CHQ: { amount: 0, count: 0 },
        CSH: { amount: 0, count: 0 },
        total: { amount: 0, count: 0 },
      };

      for (const payment of payments) {
        const type = payment.type as keyof Omit<PaymentTotals, 'total'>;
        if (totals[type]) {
          totals[type].amount += payment.amount;
          totals[type].count += 1;
        }
        totals.total.amount += payment.amount;
        totals.total.count += 1;
      }

      return totals;
    };

    const allocatedTotals = calculatePaymentTotals(allocatedPayments);
    const unallocatedTotals = calculatePaymentTotals(unallocatedPayments);

    // Sort arrays by name/reference for display
    paidSubs.sort((a, b) => a.fullName.localeCompare(b.fullName));
    unpaidSubs.sort((a, b) => a.fullName.localeCompare(b.fullName));
    allocatedPayments.sort((a, b) => a.date.localeCompare(b.date));
    unallocatedPayments.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      paidSubs: {
        rows: paidSubs,
        totals: paidTotals,
      },
      unpaidSubs: {
        rows: unpaidSubs,
        totals: unpaidTotals,
      },
      allocatedPayments: {
        rows: allocatedPayments,
        totals: allocatedTotals,
      },
      unallocatedPayments: {
        rows: unallocatedPayments,
        totals: unallocatedTotals,
      },
    });
  } catch (error) {
    console.error('Error generating banking report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
