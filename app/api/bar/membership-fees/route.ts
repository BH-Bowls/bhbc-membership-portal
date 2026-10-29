// app/api/bar/membership-fees/route.ts
// Membership fees at the bar till (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §8).
// GET  — renewals that can be paid now (submitted, not voided, something owed).
// POST — take the full amount due by card or cash.
//        { userName, method: 'card' | 'cash', amountPence, staff, confirmed: true }
//        amountPence must be what the till showed; if the amount due has changed since,
//        it's refused and the till looks the member up again.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { getTillRenewalsDue, recordTillRenewalPayment } from '@/lib/renewals-till';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    return NextResponse.json({ renewals: await getTillRenewalsDue() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load membership fees';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const amountPence = Math.round(Number(body.amountPence));
  if (typeof body.userName !== 'string' || body.userName.trim() === '') {
    return NextResponse.json({ error: 'Choose a member' }, { status: 400 });
  }
  if (body.method !== 'card' && body.method !== 'cash') {
    return NextResponse.json({ error: 'Choose card or cash' }, { status: 400 });
  }
  if (!Number.isFinite(amountPence) || amountPence <= 0) {
    return NextResponse.json({ error: 'A positive amount is required' }, { status: 400 });
  }
  if (body.confirmed !== true) {
    return NextResponse.json({ error: 'Please confirm the payment has been taken' }, { status: 400 });
  }
  if (typeof body.staff !== 'string' || body.staff.trim() === '') {
    return NextResponse.json({ error: "Select who's serving first" }, { status: 400 });
  }

  try {
    const paymentId = await recordTillRenewalPayment({
      userName: body.userName.trim(),
      method: body.method,
      amount: amountPence / 100,
      staff: body.staff.trim(),
      recordedBy: session.user.userName || 'till',
    });
    return NextResponse.json({ ok: true, paymentId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to record the payment';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
