// app/api/banking/bar-reconciliation/edit/route.ts
// POST { dayEndId, cashRemovedPence, carryForward, reason? } — corrects an
// unconfirmed Day End's cash-count outcome. See bar_edit_day_end() for the
// carry-forward chain guard (blocks changing the amount once a later Day End
// has already consumed what this one carried forward).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { editDayEnd } from '@/lib/bar-supabase';

function canAccess(role: string | undefined | null): boolean {
  return hasRole(role, 'Admin', 'Treasurer', 'T');
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccess(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const cashRemovedPence = Math.round(Number(body.cashRemovedPence));
  if (!body.dayEndId || !Number.isFinite(cashRemovedPence) || cashRemovedPence < 0) {
    return NextResponse.json({ error: 'dayEndId and a non-negative cashRemovedPence are required' }, { status: 400 });
  }

  try {
    const dayEnd = await editDayEnd(body.dayEndId, cashRemovedPence, !!body.carryForward, body.reason || undefined);
    return NextResponse.json({ ok: true, dayEnd });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to edit day end' }, { status: 500 });
  }
}
