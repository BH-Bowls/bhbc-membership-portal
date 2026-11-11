// app/api/rowland/entries/[entryId]/payment/route.ts
// POST   { amountPence } — record a cash payment towards a club's Rowland Cup entry
//        (money that never reaches the bank statement; bank payments and cheques are
//        matched on /banking's Rowland Cup tab). Part payments are fine.
// DELETE ?txnId= — undo a payment that hasn't been exported to Xero yet. A Banking
//        payment goes back to Unmatched.
// Committee or Rowland organiser. Once the entry is paid in full, the payment-received
// email goes to the team contacts.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember, hasRole } from '@/lib/role-utils';
import { recordRowlandPayment, removeRowlandPayment } from '@/lib/rowland-entries-supabase';
import { sendRowlandPaymentReceivedEmail } from '@/lib/email/rowland-payment';

function isCommittee(role: string) {
  return isCommitteeMember(role) || hasRole(role, 'RowlandOrganiser');
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isCommittee(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { entryId } = await params;
  const body = await req.json();
  const amountPence = Math.round(Number(body.amountPence));
  if (!Number.isFinite(amountPence) || amountPence <= 0) {
    return NextResponse.json({ error: 'Enter an amount more than £0' }, { status: 400 });
  }

  try {
    const result = await recordRowlandPayment({
      entryId,
      source: 'cash',
      paymentIds: [],
      amountPence,
      createdBy: session.user.userName,
    });
    let emailsSent = 0;
    if (result.becamePaid) emailsSent = await sendRowlandPaymentReceivedEmail(entryId);
    return NextResponse.json({ success: true, paymentStatus: result.paymentStatus, emailsSent });
  } catch (error) {
    console.error('[rowland/entries/payment] POST error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to record the payment' }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isCommittee(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await params;
  const txnId = req.nextUrl.searchParams.get('txnId') || '';
  if (!txnId) return NextResponse.json({ error: 'txnId is required' }, { status: 400 });

  try {
    await removeRowlandPayment(txnId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[rowland/entries/payment] DELETE error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to undo the payment' }, { status: 400 });
  }
}
