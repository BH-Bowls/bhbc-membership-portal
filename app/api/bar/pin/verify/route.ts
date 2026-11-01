// app/api/bar/pin/verify/route.ts
// POST — check a member's bar PIN when it's typed at the till. { userName, pin }
// Right: { ok } — the till then sends the PIN with each payment while the member's
// basket is open, and it's checked again then. Wrong: counts towards the 5-attempt
// lockout (see src/lib/bar-card.ts).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { verifyPin } from '@/lib/bar-card';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (!body.userName || typeof body.pin !== 'string') {
    return NextResponse.json({ error: 'userName and pin are required' }, { status: 400 });
  }
  try {
    const result = await verifyPin(body.userName, body.pin);
    if (result.ok) return NextResponse.json({ ok: true });
    if (result.reason === 'no_pin') {
      return NextResponse.json({ error: 'This member hasn’t set a PIN. Scan their card instead.', reason: result.reason }, { status: 400 });
    }
    if (result.reason === 'locked') {
      return NextResponse.json({ error: 'Too many wrong PINs — the PIN is locked. Scan the member’s card instead.', reason: result.reason }, { status: 400 });
    }
    const left = result.attemptsLeft ?? 0;
    return NextResponse.json({ error: `Wrong PIN — ${left} ${left === 1 ? 'try' : 'tries'} left.`, reason: result.reason }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'PIN check failed' }, { status: 500 });
  }
}
