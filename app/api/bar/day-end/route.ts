// app/api/bar/day-end/route.ts
// POST — cash up: aggregates everything not yet linked to a Day End into one
// durable record and links it (see createDayEnd()/bar_create_day_end() in
// src/lib/bar-supabase.ts). { staff, cashRemovedPence, carryForward, reason?, staffProof? }
// staffProof — the bar person serving's card or PIN, when they must confirm (src/lib/bar-card.ts).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { createDayEnd } from '@/lib/bar-supabase';
import { checkStaffProof, logApproval } from '@/lib/bar-card';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const cashRemovedPence = Math.round(Number(body.cashRemovedPence));
  if (!body.staff || !Number.isFinite(cashRemovedPence) || cashRemovedPence < 0) {
    return NextResponse.json({ error: 'staff and a non-negative cashRemovedPence are required' }, { status: 400 });
  }
  try {
    const staffCheck = await checkStaffProof(body.staff, body.staffProof);
    if (staffCheck.error) return NextResponse.json({ error: staffCheck.error, staffProofRequired: true }, { status: 403 });
    const dayEnd = await createDayEnd(body.staff, cashRemovedPence, !!body.carryForward, body.reason || undefined);
    if (staffCheck.method) {
      await logApproval({ kind: 'day_end', staff: body.staff, method: staffCheck.method, amountPence: cashRemovedPence, note: 'Cash removed' });
    }
    return NextResponse.json({ ok: true, dayEnd });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to record day end' }, { status: 500 });
  }
}
