// app/api/bar/pin/set/route.ts
// POST — set a member's bar PIN at the till. { userName, cardCode, pin }
// Only with their current card scanned — the card is the proof it's really them.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { checkCard, isValidPin, setPin } from '@/lib/bar-card';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (!body.userName || typeof body.cardCode !== 'string') {
    return NextResponse.json({ error: 'userName and cardCode are required' }, { status: 400 });
  }
  if (!isValidPin(body.pin)) return NextResponse.json({ error: 'The PIN must be 4 digits' }, { status: 400 });
  try {
    const card = await checkCard(body.cardCode);
    if (card.status !== 'current' || card.userName !== body.userName) {
      return NextResponse.json({ error: 'Scan the member’s current card to set their PIN.' }, { status: 403 });
    }
    await setPin(body.userName, body.pin);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to set the PIN' }, { status: 500 });
  }
}
