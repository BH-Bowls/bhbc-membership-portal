// app/api/admin/members/[userName]/bar-card/route.ts
// A member's membership card and bar PIN, for the Admin member page (src/lib/bar-card.ts).
// GET  — { hasPin, pinLocked }
// POST — { action: 'reset_card' }  new card code; every old card stops working
//        { action: 'clear_pin' }   removes the PIN and any lockout
//        { action: 'check_card', code } what a scanned card is — before restoring it
//        { action: 'restore_card', code } makes a found card the current one again
// Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { checkCard, clearPin, getPinStatus, resetCard, restoreCard } from '@/lib/bar-card';

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
    return NextResponse.json({ hasPin: status.hasPin, pinLocked: status.locked });
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
    if (body.action === 'check_card' || body.action === 'restore_card') {
      if (typeof body.code !== 'string') return NextResponse.json({ error: 'code is required' }, { status: 400 });
      const card = await checkCard(body.code);
      if (card.status === 'invalid') {
        return NextResponse.json({ error: 'That isn’t a membership card.' }, { status: 400 });
      }
      if (card.userName !== userName) {
        return NextResponse.json({ error: `That card belongs to ${card.userName}, not ${userName}.` }, { status: 400 });
      }
      if (body.action === 'check_card') return NextResponse.json({ status: card.status });
      await restoreCard(userName, body.code);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update the card';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
