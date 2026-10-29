// app/api/banking/submit/route.ts
// Submit matched payments

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getPayment,
  updatePayment,
  updateRenewalPayment,
} from '@/lib/banking-supabase';
import { hasRole } from '@/lib/role-utils';
import { recordBankingPaymentTransaction } from '@/lib/renewals-xero';

interface MatchedRenewal {
  userName: string;
  totalPayment: number;
  outstanding: number;
  banking: number;
  donations: number;
  difference: number;
  matched_banking: number;
  matched_donations: number;
  matched_difference: number;
  payment_ids: string;
  payment_notes?: string;
  // All type amounts (already includes existing + new matched amounts)
  typeAmounts: {
    bank_transfer: number;
    card_machine: number;
    cheque: number;
    cash: number;
  };
}

interface MatchedPayment {
  payment_id: string;
  matched_users: string; // Comma-separated usernames
}

export async function POST(request: NextRequest) {
  // Track what we've updated for error reporting
  const updatedPayments: string[] = [];
  const updatedRenewals: string[] = [];
  const errors: string[] = [];

  try {
    const session = await getServerSession(authOptions);

    // Check authorization: Admin OR Treasurer
    if (!hasRole(session?.user?.role, 'Admin', 'Treasurer')) {
      return NextResponse.json(
        { error: 'Forbidden - Admin or Treasurer access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { matchedRenewals, matchedPayments } = body;

    // Validation: Check required fields
    if (!matchedRenewals || !matchedPayments) {
      return NextResponse.json(
        { error: 'Missing matched renewals or payments' },
        { status: 400 }
      );
    }

    if (!Array.isArray(matchedRenewals) || !Array.isArray(matchedPayments)) {
      return NextResponse.json(
        { error: 'Invalid data format: matchedRenewals and matchedPayments must be arrays' },
        { status: 400 }
      );
    }

    // Update RenewalPayments sheet
    // Track successes and failures for better error reporting
    for (const payment of matchedPayments as MatchedPayment[]) {
      try {
        await updatePayment(payment.payment_id, {
          status: 'Matched',
          matched_users: payment.matched_users,
        });
        updatedPayments.push(payment.payment_id);
      } catch (error) {
        const errorMsg = `Failed to update payment ${payment.payment_id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMsg);
        errors.push(errorMsg);
        // Continue processing other payments despite failure
      }
    }

    // Which payments went to which member, and their bank dates — each member's share is
    // recorded as a renewal transaction for the Xero journal (spec §6.2), dated with the
    // latest bank date of the payments matched to them.
    const paymentsByUser = new Map<string, { ids: string[]; latestDate: string }>();
    for (const payment of matchedPayments as MatchedPayment[]) {
      let paymentDate = '';
      try {
        const stored = await getPayment(payment.payment_id);
        if (stored) paymentDate = String(stored.date).substring(0, 10);
      } catch (error) {
        console.error(`Failed to read payment ${payment.payment_id}:`, error);
      }
      for (const raw of String(payment.matched_users || '').split(',')) {
        const user = raw.trim().toLowerCase();
        if (!user) continue;
        const entry = paymentsByUser.get(user) || { ids: [], latestDate: '' };
        entry.ids.push(payment.payment_id);
        if (paymentDate > entry.latestDate) entry.latestDate = paymentDate;
        paymentsByUser.set(user, entry);
      }
    }
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // Update Renewals sheet
    for (const renewal of matchedRenewals as MatchedRenewal[]) {
      // Calculate new cumulative values by adding matched amounts to existing amounts
      const newBanking = renewal.banking + renewal.matched_banking;
      const newDonations = renewal.donations + renewal.matched_donations;
      const newDifference = renewal.difference + renewal.matched_difference;

      // Calculate new outstanding balance
      // Formula: outstanding = totalPayment - banking + donations + difference
      // - totalPayment: Total membership fee due
      // - banking: Total amount paid via bank/card/cash (reduces outstanding)
      // - donations: Total allocated to donations (increases outstanding)
      // - difference: Total adjustments (positive = increase outstanding, negative = decrease)
      const newOutstanding = renewal.totalPayment - newBanking + newDonations + newDifference;

      // Validation: Ensure outstanding is never negative (can't overpay)
      if (newOutstanding < 0) {
        console.warn(
          `Outstanding calculation resulted in negative value for ${renewal.userName}: ${newOutstanding}. ` +
          `This may indicate overpayment or incorrect formula. Setting to 0.`
        );
      }
      const validatedOutstanding = Math.max(0, newOutstanding);

      try {
        // date_paid is a real Postgres date column now — ISO format, not the old dd/mm/yyyy
        const now = new Date();
        const dateReceived = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        await updateRenewalPayment(renewal.userName, {
          outstanding: validatedOutstanding,
          banking: newBanking,
          donations: newDonations,
          difference: newDifference,
          typeAmounts: renewal.typeAmounts,
          payment_ids: renewal.payment_ids,
          payment_notes: renewal.payment_notes,
          date_received: dateReceived,
        });
        updatedRenewals.push(renewal.userName);
      } catch (error) {
        const errorMsg = `Failed to update renewal for ${renewal.userName}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMsg);
        errors.push(errorMsg);
        continue;
      }

      try {
        const matched = paymentsByUser.get(renewal.userName.toLowerCase());
        await recordBankingPaymentTransaction({
          userName: renewal.userName,
          amount: renewal.matched_banking,
          donation: renewal.matched_donations,
          writeOff: renewal.matched_difference,
          paymentIds: matched ? matched.ids.join(',') : '',
          txnDate: matched && matched.latestDate ? matched.latestDate : todayIso,
          createdBy: session && session.user ? session.user.userName : 'unknown',
        });
      } catch (error) {
        const errorMsg = `${renewal.userName}'s payment was matched, but not recorded for the Xero export: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMsg);
        errors.push(errorMsg);
        // Continue processing other renewals despite failure
      }
    }

    // Return detailed result with partial success information
    if (errors.length > 0) {
      console.warn(`Submission completed with ${errors.length} error(s)`);
      return NextResponse.json({
        success: false,
        partialSuccess: true,
        updatedPayments,
        updatedRenewals,
        errors,
        message: `Completed with ${errors.length} error(s). ${updatedPayments.length} payments and ${updatedRenewals.length} renewals updated successfully.`
      }, { status: 207 }); // 207 Multi-Status indicates partial success
    }

    return NextResponse.json({
      success: true,
      updatedPayments,
      updatedRenewals,
      message: `Successfully updated ${updatedPayments.length} payments and ${updatedRenewals.length} renewals.`
    });
  } catch (error) {
    console.error('Error submitting matches:', error);

    // Provide detailed error information including what was successfully updated
    return NextResponse.json({
      success: false,
      error: 'Failed to submit matches',
      details: error instanceof Error ? error.message : 'Unknown error',
      updatedPayments,
      updatedRenewals,
      message: errors.length > 0
        ? `Fatal error occurred. ${updatedPayments.length} payments and ${updatedRenewals.length} renewals were updated before failure.`
        : 'Fatal error occurred before any updates could be made.'
    }, { status: 500 });
  }
}
