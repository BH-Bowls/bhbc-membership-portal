// app/api/banking/submit/route.ts
// Submit matched payments

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  updatePaymentInSheet,
  updateRenewalPayment,
  getPaymentTypeColumn,
} from '@/lib/banking-sheets';

interface MatchedRenewal {
  userName: string;
  outstanding: number;
  banking: number;
  donations: number;
  difference: number;
  matched_banking: number;
  matched_donations: number;
  matched_difference: number;
  payment_ids: string;
  payment_notes?: string;
  paymentType: string; // TRF, CDM, etc.
  paymentTypeAmount: number; // Current amount in that column
}

interface MatchedPayment {
  payment_id: string;
  matched_users: string; // Comma-separated usernames
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Check authorization: Admin OR Treasurer
    if (session?.user?.role !== 'Admin' && session?.user?.role !== 'T') {
      return NextResponse.json(
        { error: 'Forbidden - Admin or Treasurer access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { matchedRenewals, matchedPayments } = body;

    if (!matchedRenewals || !matchedPayments) {
      return NextResponse.json(
        { error: 'Missing matched renewals or payments' },
        { status: 400 }
      );
    }

    // Update Renewal Payments sheet
    for (const payment of matchedPayments as MatchedPayment[]) {
      await updatePaymentInSheet(payment.payment_id, {
        status: 'Matched',
        matched_users: payment.matched_users,
      });
    }

    // Update Renewals sheet
    for (const renewal of matchedRenewals as MatchedRenewal[]) {
      const paymentTypeColumn = getPaymentTypeColumn(renewal.paymentType);

      await updateRenewalPayment(renewal.userName, {
        outstanding: renewal.outstanding - renewal.matched_banking,
        banking: renewal.banking + renewal.matched_banking,
        donations: renewal.donations + renewal.matched_donations,
        difference: renewal.difference + renewal.matched_difference,
        paymentTypeColumn,
        paymentTypeAmount: renewal.paymentTypeAmount + renewal.matched_banking,
        payment_ids: renewal.payment_ids,
        payment_notes: renewal.payment_notes,
        date_received: new Date().toISOString(),
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error submitting matches:', error);
    return NextResponse.json(
      { error: 'Failed to submit matches' },
      { status: 500 }
    );
  }
}
