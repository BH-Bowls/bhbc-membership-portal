// app/api/payments/stripe/checkout/route.ts
// POST { userNames: [...] } — start a Stripe Checkout payment for the outstanding amount
// on those renewals, from My Account (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §11.3).
// Returns { url } for the browser to go to. Amounts are read from the database.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canManageUser } from '@/lib/buddies-supabase';
import { isStripePaymentsEnabled } from '@/lib/stripe';
import { createOutstandingCheckout } from '@/lib/stripe-payments';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await isStripePaymentsEnabled())) {
    return NextResponse.json({ error: 'Online payments are not available.' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const userNames: string[] = [];
  if (Array.isArray(body.userNames)) {
    for (const u of body.userNames) {
      if (typeof u === 'string' && u.trim() !== '') userNames.push(u.trim());
    }
  }
  if (userNames.length === 0) {
    return NextResponse.json({ error: 'Choose at least one renewal to pay.' }, { status: 400 });
  }

  for (const userName of userNames) {
    const allowed = await canManageUser(session.user.userName, session.user.role, userName);
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // The real person paying — the Admin when impersonating
  let payer = session.user.userName;
  if (session.user.isImpersonating && session.user.originalAdmin && session.user.originalAdmin.userName) {
    payer = session.user.originalAdmin.userName;
  }

  try {
    const url = await createOutstandingCheckout(payer, userNames);
    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not start the payment.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
