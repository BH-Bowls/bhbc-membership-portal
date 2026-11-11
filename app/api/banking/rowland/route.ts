// app/api/banking/rowland/route.ts
// The Rowland Cup tab on /banking. Admin or Treasurer.
// GET  — Rowland Cup entries with money still owed (any season).
// POST { entryId, paymentIds } — match Unmatched Banking payments to a club's entry,
//      for their total (a part payment leaves it Partial). Recorded for the Xero journal
//      with renewals (0098). Once it's paid in full, the payment-received email goes to
//      the team contacts.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getRowlandEntriesOwing, recordRowlandPayment } from '@/lib/rowland-entries-supabase';
import { sendRowlandPaymentReceivedEmail } from '@/lib/email/rowland-payment';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !hasRole(session.user.role, 'Admin', 'Treasurer')) {
    return NextResponse.json({ error: 'Forbidden - Admin or Treasurer access required' }, { status: 403 });
  }
  try {
    const entries = await getRowlandEntriesOwing();
    return NextResponse.json({ entries });
  } catch (error) {
    console.error('[GET /api/banking/rowland] Error:', error);
    return NextResponse.json({ error: 'Failed to load Rowland Cup entries' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !hasRole(session.user.role, 'Admin', 'Treasurer')) {
    return NextResponse.json({ error: 'Forbidden - Admin or Treasurer access required' }, { status: 403 });
  }

  const body = await request.json();
  const entryId = typeof body.entryId === 'string' ? body.entryId : '';
  const paymentIds: string[] = [];
  if (Array.isArray(body.paymentIds)) {
    for (const id of body.paymentIds) {
      if (typeof id === 'string' && id.trim()) paymentIds.push(id.trim());
    }
  }
  if (!entryId || paymentIds.length === 0) {
    return NextResponse.json({ error: 'Choose an entry and at least one payment' }, { status: 400 });
  }

  try {
    const result = await recordRowlandPayment({
      entryId,
      source: 'banking',
      paymentIds,
      amountPence: 0,
      createdBy: session.user.userName,
    });
    let emailsSent = 0;
    if (result.becamePaid) emailsSent = await sendRowlandPaymentReceivedEmail(entryId);
    return NextResponse.json({ success: true, paymentStatus: result.paymentStatus, emailsSent });
  } catch (error) {
    console.error('[POST /api/banking/rowland] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to match the payment' }, { status: 400 });
  }
}
