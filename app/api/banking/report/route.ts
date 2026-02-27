// app/api/banking/report/route.ts
// Banking Report API - fetches data for Paid/Unpaid Subs and Allocated/Unallocated Payments

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getGoogleSheetsClient, getSpreadsheetId, getColumnMap } from '@/lib/sheets';
import { createRowFieldGetter, createRowNumberGetter } from '@/lib/banking-sheets';

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

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Check authorization: Admin OR Treasurer
    if (session?.user?.role !== 'Admin' && session?.user?.role !== 'T') {
      return NextResponse.json(
        { error: 'Forbidden - Admin or Treasurer access required' },
        { status: 403 }
      );
    }

    const sheets = getGoogleSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    // Fetch Renewals data
    const renewalsColMap = await getColumnMap('Renewals');
    const renewalsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Renewals!A2:AP',
    });
    const renewalsRows = renewalsResponse.data.values || [];

    // Fetch Members data for full names
    const membersColMap = await getColumnMap('Members');
    const membersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Members!A2:AZ',
    });
    const membersRows = membersResponse.data.values || [];

    // Build member name lookup
    const memberNames = new Map<string, string>();
    const userNameCol = membersColMap['user_name'];
    const fullNameCol = membersColMap['full_name'] ?? membersColMap['full_known_as'] ?? membersColMap['name'];
    for (const row of membersRows) {
      const userName = row[userNameCol];
      if (userName) {
        const fullName = (fullNameCol !== undefined ? row[fullNameCol] : '') || userName;
        memberNames.set(userName.toLowerCase(), fullName);
      }
    }

    // Parse renewals
    const paidSubs: RenewalReportRow[] = [];
    const unpaidSubs: RenewalReportRow[] = [];

    for (const row of renewalsRows) {
      const get = createRowFieldGetter(row, renewalsColMap);
      const getNumber = createRowNumberGetter(get);

      const userName = get('user_name');
      if (!userName) continue;

      const outstanding = getNumber('outstanding');
      const fullName = memberNames.get(userName.toLowerCase()) || userName;

      const renewalRow: RenewalReportRow = {
        userName,
        fullName,
        renewingMembership: get('renewing_membership'),
        playingFee: getNumber('playing_fee'),
        socialFee: getNumber('social_fee'),
        competitionsFee: getNumber('competitions_fee'),
        club200Fee: getNumber('club_200_fee'),
        totalFeeDue: getNumber('total_fee_due'),
        outstanding,
        banking: getNumber('banking'),
        difference: getNumber('difference'),
        donations: getNumber('donations'),
        cardMachine: getNumber('card_machine'),
        bankTransfer: getNumber('bank_transfer'),
        cheque: getNumber('cheque'),
        cash: getNumber('cash'),
      };

      // Check if outstanding field has a value (not null/empty)
      const outstandingStr = get('outstanding');
      const hasOutstanding = outstandingStr !== '';

      if (hasOutstanding && outstanding === 0) {
        paidSubs.push(renewalRow);
      } else if (hasOutstanding && outstanding > 0) {
        unpaidSubs.push(renewalRow);
      }
    }

    // Calculate paid subs totals
    const paidTotals: ReportTotals = {
      playingFee: 0,
      socialFee: 0,
      competitionsFee: 0,
      club200Fee: 0,
      totalFeeDue: 0,
      outstanding: 0,
      banking: 0,
      difference: 0,
      donations: 0,
      cardMachine: 0,
      bankTransfer: 0,
      cheque: 0,
      cash: 0,
      count: paidSubs.length,
    };

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
    const unpaidTotals: ReportTotals = {
      playingFee: 0,
      socialFee: 0,
      competitionsFee: 0,
      club200Fee: 0,
      totalFeeDue: 0,
      outstanding: 0,
      banking: 0,
      difference: 0,
      donations: 0,
      cardMachine: 0,
      bankTransfer: 0,
      cheque: 0,
      cash: 0,
      count: unpaidSubs.length,
    };

    for (const row of unpaidSubs) {
      unpaidTotals.playingFee += row.playingFee;
      unpaidTotals.socialFee += row.socialFee;
      unpaidTotals.competitionsFee += row.competitionsFee;
      unpaidTotals.club200Fee += row.club200Fee;
      unpaidTotals.totalFeeDue += row.totalFeeDue;
      unpaidTotals.outstanding += row.outstanding;
    }

    // Fetch Payments data
    const paymentsColMap = await getColumnMap('RenewalPayments');
    const paymentsResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'RenewalPayments!A2:G',
    });
    const paymentsRows = paymentsResponse.data.values || [];

    // Parse payments
    const allocatedPayments: PaymentReportRow[] = [];
    const unallocatedPayments: PaymentReportRow[] = [];

    for (const row of paymentsRows) {
      const get = createRowFieldGetter(row, paymentsColMap);
      const getNumber = createRowNumberGetter(get);

      const paymentId = get('payment_id');
      if (!paymentId) continue;

      const status = get('status');
      if (status === 'Deleted') continue; // Skip deleted payments

      const paymentRow: PaymentReportRow = {
        paymentId,
        date: get('date'),
        type: get('type') as PaymentReportRow['type'],
        reference: get('reference'),
        amount: getNumber('amount'),
        status,
        matchedUsers: get('matched_users'),
      };

      if (status === 'Matched') {
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
