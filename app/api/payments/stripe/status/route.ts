// app/api/payments/stripe/status/route.ts
// GET ?session=cs_... — has this Checkout payment been recorded yet? Polled by the page
// the member returns to from Stripe (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §11.3). If the
// webhook hasn't arrived, it asks Stripe directly (reconcileCheckoutSession).
// Returns { status: 'recorded' | 'waiting' | 'expired' }.
//
// POST { action: 'cancel', userName? } — the member left "Submit and pay online" without
// paying: close the payment page holding their draft and release it (§11.3a step 5).
// userName defaults to the session user; anyone else needs canManageUser.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canManageUser } from '@/lib/buddies-supabase';
import { getCheckoutStatus, cancelHeldCheckoutForMember } from '@/lib/stripe-payments';

function validSessionId(id: unknown): id is string {
  return typeof id === 'string' && /^cs_[A-Za-z0-9_]+$/.test(id);
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sessionId = new URL(request.url).searchParams.get('session');
  if (!validSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 400 });
  }
  try {
    const status = await getCheckoutStatus(sessionId);
    return NextResponse.json({ status });
  } catch (err) {
    console.error('Stripe status check failed:', err);
    return NextResponse.json({ error: 'Could not check the payment' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (body.action !== 'cancel') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  let userName = session.user.userName;
  if (typeof body.userName === 'string' && body.userName.trim() !== '') {
    userName = body.userName.trim();
  }
  const allowed = await canManageUser(session.user.userName, session.user.role, userName);
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const outcome = await cancelHeldCheckoutForMember(userName);
    return NextResponse.json({ success: true, outcome });
  } catch (err) {
    console.error('Cancelling Stripe checkout failed:', err);
    return NextResponse.json({ error: 'Could not cancel the payment page' }, { status: 500 });
  }
}
