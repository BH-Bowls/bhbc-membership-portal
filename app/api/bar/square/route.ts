// app/api/bar/square/route.ts
// Square Terminal card payments from the till (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §10).
// GET  — is the Terminal set up, and is it still working on a payment (so a refreshed
//        till can pick it back up)?
// POST — send a card payment to the Terminal.
//        { kind: 'sale' | 'topup' | 'membership', expectedPence, staff, userName?, items? }
//        expectedPence is what the till showed; the server works the amount out itself
//        and refuses if it differs. 409 + { checkout } if the Terminal is already busy.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { getTerminalSetup, getOpenCheckout, startTerminalCheckout, TerminalBusyError } from '@/lib/bar-square';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const setup = await getTerminalSetup();
    let open = null;
    if (setup.enabled) open = await getOpenCheckout();
    return NextResponse.json({
      enabled: setup.enabled,
      sandbox: setup.sandbox,
      deviceName: setup.deviceName,
      open: open,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to check the Terminal';
    return NextResponse.json({ enabled: false, error: message });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (body.kind !== 'sale' && body.kind !== 'topup' && body.kind !== 'membership') {
    return NextResponse.json({ error: 'Unknown payment type' }, { status: 400 });
  }
  const expectedPence = Math.round(Number(body.expectedPence));
  if (!Number.isFinite(expectedPence) || expectedPence <= 0) {
    return NextResponse.json({ error: 'A positive amount is required' }, { status: 400 });
  }
  const staff = typeof body.staff === 'string' ? body.staff.trim() : '';
  if ((body.kind === 'topup' || body.kind === 'membership') && staff === '') {
    return NextResponse.json({ error: "Select who's serving first" }, { status: 400 });
  }

  try {
    const checkout = await startTerminalCheckout({
      kind: body.kind,
      expectedPence: expectedPence,
      staff: staff,
      userName: typeof body.userName === 'string' && body.userName.trim() !== '' ? body.userName.trim() : undefined,
      items: Array.isArray(body.items) ? body.items : undefined,
      createdBy: session.user.userName || 'till',
    });
    return NextResponse.json({ checkout });
  } catch (err) {
    if (err instanceof TerminalBusyError) {
      return NextResponse.json({ error: err.message, checkout: err.checkout }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : 'Could not send the payment to the Terminal';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
