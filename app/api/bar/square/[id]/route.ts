// app/api/bar/square/[id]/route.ts
// One Square Terminal payment (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §10).
// GET  — the latest status from Square; once it's paid, the sale / top-up / fee is
//        recorded (exactly once — the webhook may get there first).
// POST — { action: 'cancel' } — staff cancelled it on the till.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { refreshTerminalCheckout, cancelCheckout } from '@/lib/bar-square';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    return NextResponse.json({ checkout: await refreshTerminalCheckout(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not check the Terminal';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body.action !== 'cancel') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  try {
    return NextResponse.json({ checkout: await cancelCheckout(id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not cancel the Terminal payment';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
