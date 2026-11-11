// app/api/banking/report/route.ts
// Banking Report API, for one year (?year=, default the current season):
//   Subs        — paid / unpaid renewals for that season, and the payments allocated to them
//   Rowland Cup — paid / owing club entries for that year, and their payments (bank + cash)
//   Unallocated — payments not yet matched to anything; they have no year until they are
// A payment's year comes from what it paid for: the renewal's season (renewal_transactions
// or renewals.payment_ids) or the Rowland Cup entry's year. Matched renewal payments with
// no year found are listed separately rather than guessed.

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
  stripe: number;
}

export interface PaymentReportRow {
  paymentId: string;
  date: string;
  type: 'TRF' | 'CDM' | 'CHQ' | 'CSH' | 'STR';
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
  stripe: number;
  count: number;
}

export interface PaymentTotals {
  TRF: { amount: number; count: number };
  CDM: { amount: number; count: number };
  CHQ: { amount: number; count: number };
  CSH: { amount: number; count: number };
  STR: { amount: number; count: number };
  total: { amount: number; count: number };
}

export interface RowlandReportRow {
  entryId: string;
  clubName: string;
  teams: number;
  due: number;         // pounds, like the rest of the report
  received: number;
  outstanding: number;
  status: 'Unpaid' | 'Partial' | 'Paid';
  paidAt: string | null;
}

export interface RowlandTotals {
  count: number;
  teams: number;
  due: number;
  received: number;
  outstanding: number;
}

function zeroTotals(count: number): ReportTotals {
  return {
    playingFee: 0, socialFee: 0, competitionsFee: 0, club200Fee: 0, totalFeeDue: 0,
    outstanding: 0, banking: 0, difference: 0, donations: 0,
    cardMachine: 0, bankTransfer: 0, cheque: 0, cash: 0, stripe: 0, count,
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
    const currentYear = getCurrentSeasonYear();
    const yearParam = parseInt(request.nextUrl.searchParams.get('year') || '', 10);
    const seasonYear = yearParam >= 2000 && yearParam <= 2100 ? yearParam : currentYear;

    // Which years there are to pick from: renewal seasons and Rowland Cup years
    const { data: yearRows, error: yearError } = await supabase
      .from('renewals')
      .select('season_year')
      .not('submitted_at', 'is', null);
    if (yearError) throw new Error(yearError.message);
    const { data: rowlandYearRows, error: rowlandYearError } = await supabase
      .from('rowland_entries')
      .select('season');
    if (rowlandYearError) throw new Error(rowlandYearError.message);
    const years: number[] = [currentYear];
    for (const r of yearRows || []) {
      const y = Number(r.season_year);
      if (y && !years.includes(y)) years.push(y);
    }
    for (const r of rowlandYearRows || []) {
      const y = parseInt(r.season, 10);
      if (y && !years.includes(y)) years.push(y);
    }
    if (!years.includes(seasonYear)) years.push(seasonYear);
    years.sort((a, b) => b - a);

    // Fetch Renewals data for the chosen season
    const { data: renewalsRows, error: renewalsError } = await supabase
      .from('renewals')
      .select('username, renewing_membership, playing_fee, social_fee, competitions_fee, club_200_fee, total_fee_due, outstanding, banking, difference, donations, card_machine, bank_transfer, cheque, cash, stripe')
      .eq('season_year', seasonYear)
      .not('submitted_at', 'is', null) // drafts aren't owed (spec §3.9)
      .is('voided_at', null);          // nor are voided renewals (§5)
    if (renewalsError) throw new Error(renewalsError.message);

    // Which season each renewal payment paid for (P### ids → season)
    const paymentSeason = new Map<string, number>();
    const addIds = (ids: string | null, year: number) => {
      if (!ids) return;
      for (const id of ids.split(',')) {
        const trimmed = id.trim();
        if (trimmed && !paymentSeason.has(trimmed)) paymentSeason.set(trimmed, year);
      }
    };
    const { data: txnRows, error: txnError } = await supabase
      .from('renewal_transactions')
      .select('season_year, payment_ids')
      .eq('kind', 'payment')
      .not('payment_ids', 'is', null);
    if (txnError) throw new Error(txnError.message);
    for (const t of txnRows || []) addIds(t.payment_ids, Number(t.season_year));
    const { data: renewalIdRows, error: renewalIdError } = await supabase
      .from('renewals')
      .select('season_year, payment_ids')
      .not('payment_ids', 'is', null);
    if (renewalIdError) throw new Error(renewalIdError.message);
    for (const r of renewalIdRows || []) addIds(r.payment_ids, Number(r.season_year));

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
        stripe: Number(row.stripe) || 0,
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
      paidTotals.stripe += row.stripe;
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
      .select('payment_id, date, type, reference, amount, status, matched_users, rowland_entry_id')
      .neq('status', 'Deleted');
    if (paymentsError) throw new Error(paymentsError.message);

    // Rowland Cup entries — every year, to name the club on a payment; this year's for the tab
    const { data: rowlandRows, error: rowlandError } = await supabase
      .from('rowland_entries')
      .select('id, club_name, season, amount_due_pence, amount_received_pence, payment_status, payment_received_at');
    if (rowlandError) throw new Error(rowlandError.message);
    const rowlandClubs = new Map<string, { club: string; year: number }>();
    const thisYearEntries: NonNullable<typeof rowlandRows> = [];
    for (const r of rowlandRows || []) {
      const year = parseInt(r.season, 10);
      rowlandClubs.set(r.id, { club: r.club_name, year });
      if (year === seasonYear) thisYearEntries.push(r);
    }

    // Parse payments: each matched one goes to its own year and tab
    const allocatedPayments: PaymentReportRow[] = [];
    const allocatedUnknownYear: PaymentReportRow[] = [];
    const rowlandPayments: PaymentReportRow[] = [];
    const unallocatedPayments: PaymentReportRow[] = [];

    for (const row of paymentsRows ?? []) {
      const rowland = row.rowland_entry_id ? rowlandClubs.get(row.rowland_entry_id) : undefined;
      const paymentRow: PaymentReportRow = {
        paymentId: row.payment_id,
        date: row.date,
        type: row.type as PaymentReportRow['type'],
        reference: row.reference ?? '',
        amount: Number(row.amount) || 0,
        status: row.status,
        matchedUsers: rowland ? rowland.club : (row.matched_users ?? ''),
      };

      if (row.status !== 'Matched') {
        unallocatedPayments.push(paymentRow);
      } else if (row.rowland_entry_id) {
        if (rowland && rowland.year === seasonYear) rowlandPayments.push(paymentRow);
      } else {
        const year = paymentSeason.get(row.payment_id);
        if (year === seasonYear) allocatedPayments.push(paymentRow);
        else if (year === undefined) allocatedUnknownYear.push(paymentRow);
      }
    }

    // Rowland Cup: cash recorded in Rowland Admin never reaches Banking — add it too
    const { data: cashRows, error: cashError } = await supabase
      .from('rowland_transactions')
      .select('id, rowland_entry_id, txn_date, amount_pence, club_name')
      .eq('kind', 'payment')
      .eq('source', 'cash')
      .eq('season_year', seasonYear);
    if (cashError) throw new Error(cashError.message);
    for (const c of cashRows || []) {
      rowlandPayments.push({
        paymentId: '',
        date: c.txn_date,
        type: 'CSH',
        reference: 'Cash recorded in Rowland Admin',
        amount: (c.amount_pence || 0) / 100,
        status: 'Matched',
        matchedUsers: c.club_name,
      });
    }

    // Rowland Cup entries for the year: teams entered (withdrawn teams still pay)
    const teamCounts = new Map<string, number>();
    if (thisYearEntries.length > 0) {
      const entryIds: string[] = [];
      for (const e of thisYearEntries) entryIds.push(e.id);
      const { data: teamRows, error: teamError } = await supabase
        .from('rowland_team_entries')
        .select('rowland_entry_id')
        .in('rowland_entry_id', entryIds);
      if (teamError) throw new Error(teamError.message);
      for (const t of teamRows || []) {
        teamCounts.set(t.rowland_entry_id, (teamCounts.get(t.rowland_entry_id) || 0) + 1);
      }
    }
    const rowlandPaid: RowlandReportRow[] = [];
    const rowlandOwing: RowlandReportRow[] = [];
    for (const e of thisYearEntries) {
      const due = (e.amount_due_pence || 0) / 100;
      const received = (e.amount_received_pence || 0) / 100;
      const rowlandRow: RowlandReportRow = {
        entryId: e.id,
        clubName: e.club_name,
        teams: teamCounts.get(e.id) || 0,
        due,
        received,
        outstanding: due - received,
        status: e.payment_status,
        paidAt: e.payment_received_at,
      };
      if (e.payment_status === 'Paid') rowlandPaid.push(rowlandRow);
      else rowlandOwing.push(rowlandRow);
    }
    const rowlandTotals = (rows: RowlandReportRow[]): RowlandTotals => {
      const totals: RowlandTotals = { count: rows.length, teams: 0, due: 0, received: 0, outstanding: 0 };
      for (const r of rows) {
        totals.teams += r.teams;
        totals.due += r.due;
        totals.received += r.received;
        totals.outstanding += r.outstanding;
      }
      return totals;
    };
    rowlandPaid.sort((a, b) => a.clubName.localeCompare(b.clubName));
    rowlandOwing.sort((a, b) => a.clubName.localeCompare(b.clubName));

    // Calculate payment totals by type
    const calculatePaymentTotals = (payments: PaymentReportRow[]): PaymentTotals => {
      const totals: PaymentTotals = {
        TRF: { amount: 0, count: 0 },
        CDM: { amount: 0, count: 0 },
        CHQ: { amount: 0, count: 0 },
        CSH: { amount: 0, count: 0 },
        STR: { amount: 0, count: 0 },
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
    allocatedUnknownYear.sort((a, b) => a.date.localeCompare(b.date));
    rowlandPayments.sort((a, b) => a.date.localeCompare(b.date));
    unallocatedPayments.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      year: seasonYear,
      currentYear,
      years,
      allocatedUnknownYear: {
        rows: allocatedUnknownYear,
        totals: calculatePaymentTotals(allocatedUnknownYear),
      },
      rowland: {
        paid: { rows: rowlandPaid, totals: rowlandTotals(rowlandPaid) },
        owing: { rows: rowlandOwing, totals: rowlandTotals(rowlandOwing) },
        payments: { rows: rowlandPayments, totals: calculatePaymentTotals(rowlandPayments) },
      },
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
