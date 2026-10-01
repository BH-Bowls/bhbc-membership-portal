// app/api/bar/cash-movement/route.ts
// POST — record cash added to or removed from the till for a non-sale reason
// (see cashMovement()/bar_cash_movement() in src/lib/bar-supabase.ts and
// 0064_bar_cash_movements.sql). { productId, amountPence, direction, reason, staff }

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { cashMovement } from '@/lib/bar-supabase';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const amountPence = Math.round(Number(body.amountPence));
  if (!body.productId || !Number.isFinite(amountPence) || amountPence <= 0) {
    return NextResponse.json({ error: 'productId and a positive amountPence are required' }, { status: 400 });
  }
  if (body.direction !== 'in' && body.direction !== 'out') {
    return NextResponse.json({ error: "direction must be 'in' or 'out'" }, { status: 400 });
  }
  if (!body.reason || !body.reason.trim()) {
    return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
  }
  if (!body.staff) {
    return NextResponse.json({ error: 'staff is required' }, { status: 400 });
  }

  try {
    const result = await cashMovement(body.productId, amountPence, body.direction, body.reason.trim(), body.staff);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to record cash movement' }, { status: 500 });
  }
}
