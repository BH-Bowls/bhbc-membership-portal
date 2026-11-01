// app/api/account/membership-card/route.ts
// GET  — the logged-in member's own data for the My Account membership card: full name,
//        whether they're Honorary, the most recent season they've confirmed renewing for
//        (the "valid until" date is derived from this on the client — see
//        app/account/page.tsx), their card code for the QR, and whether they have a bar PIN.
// POST — { action: 'reset_card' } gives them a new card code (every old card stops
//        working); { action: 'set_pin', pin } sets their 4-digit bar PIN.
//        See src/lib/bar-card.ts.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserByUsername } from '@/lib/members-supabase';
import { getLatestRenewedSeason } from '@/lib/renewals-supabase';
import { getCardCode, getPinStatus, isValidPin, resetCard, setPin } from '@/lib/bar-card';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const user = await getUserByUsername(session.user.userName);
    if (!user) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    const latestRenewedSeasonYear = await getLatestRenewedSeason(session.user.userName);

    // The card itself still shows if the QR or PIN details can't be loaded
    let cardCode: string | null = null;
    let pin = { hasPin: false, locked: false };
    try {
      cardCode = await getCardCode(session.user.userName);
      pin = await getPinStatus(session.user.userName);
    } catch (err) {
      console.error('[GET /api/account/membership-card] Card code unavailable:', err);
    }

    return NextResponse.json({
      fullName: user.fullName,
      honorary: user.honorary === 'Y',
      latestRenewedSeasonYear: latestRenewedSeasonYear,
      cardCode: cardCode,
      hasPin: pin.hasPin,
      pinLocked: pin.locked,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load membership card';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'reset_card') {
      const cardCode = await resetCard(session.user.userName);
      return NextResponse.json({ ok: true, cardCode: cardCode });
    }
    if (body.action === 'set_pin') {
      if (!isValidPin(body.pin)) return NextResponse.json({ error: 'The PIN must be 4 digits' }, { status: 400 });
      await setPin(session.user.userName, body.pin);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update your card';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
