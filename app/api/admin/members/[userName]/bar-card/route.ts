// app/api/admin/members/[userName]/bar-card/route.ts
// A member's bar card and bar PIN, for the Admin member page (src/lib/bar-card.ts).
// GET  — { hasPin, pinLocked, cardIssuedAt, cardIssuedBy, cardIssuedByName }
// POST — { action: 'reset_card' }  new card code; every old card stops working
//        { action: 'clear_pin' }   removes the PIN and any lockout
//        { action: 'assign_card', code } gives the member a blank bar card; their
//          previous card stops working. Records when, and that this admin did it.
// Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { assignCard, clearPin, getCardIssued, getPinStatus, memberName, resetCard } from '@/lib/bar-card';

type Params = { params: Promise<{ userName: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasRole(session.user.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { userName } = await params;
  try {
    const status = await getPinStatus(userName);
    const issued = await getCardIssued(userName);
    return NextResponse.json({
      hasPin: status.hasPin,
      pinLocked: status.locked,
      cardIssuedAt: issued.issuedAt,
      cardIssuedBy: issued.issuedBy,
      cardIssuedByName: issued.issuedBy ? await memberName(issued.issuedBy) : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load the card';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasRole(session.user.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { userName } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'reset_card') {
      await resetCard(userName);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'clear_pin') {
      await clearPin(userName);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'assign_card') {
      if (typeof body.code !== 'string') return NextResponse.json({ error: 'code is required' }, { status: 400 });
      try {
        const issued = await assignCard(userName, body.code, session.user.userName);
        return NextResponse.json({
          ok: true,
          cardIssuedAt: issued.issuedAt,
          cardIssuedBy: issued.issuedBy,
          cardIssuedByName: await memberName(session.user.userName),
        });
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to assign the card' }, { status: 400 });
      }
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update the card';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
