// app/api/banking/bar-reconciliation/manual-entry/route.ts
// POST { countedBy, productId, amountPence, note? } — records cash that never
// went through the till (raffle, teas, ...) as its own standalone Day End. See
// bar_create_manual_day_end() and specs/BAR_BANKING_XERO_SPEC.md §4.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { createManualDayEnd } from '@/lib/bar-supabase';

function canAccess(role: string | undefined | null): boolean {
  return hasRole(role, 'Admin', 'Treasurer', 'T');
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccess(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const amountPence = Math.round(Number(body.amountPence));
  if (!body.countedBy || !body.productId || !Number.isFinite(amountPence) || amountPence <= 0) {
    return NextResponse.json({ error: 'countedBy, productId and a positive amountPence are required' }, { status: 400 });
  }

  try {
    const dayEnd = await createManualDayEnd(body.countedBy, body.productId, amountPence, body.note || undefined);
    return NextResponse.json({ ok: true, dayEnd });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to record entry' }, { status: 500 });
  }
}
