// app/api/bar/topup/route.ts
// POST — add credit to a member's wallet. { userName, amountPence, staff, note?, paymentMethod? }
// paymentMethod is 'cash' or 'card' (defaults to 'cash'). proof — card scan or PIN token,
// when the member needs one (src/lib/bar-card.ts).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { topUp } from '@/lib/bar-supabase';
import { checkAccountProof } from '@/lib/bar-card';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const amountPence = Math.round(Number(body.amountPence));
  if (!body.userName || !Number.isFinite(amountPence) || amountPence <= 0) {
    return NextResponse.json({ error: 'userName and a positive amount are required' }, { status: 400 });
  }
  const paymentMethod = body.paymentMethod === 'card' ? 'card' : 'cash';
  try {
    const proofError = await checkAccountProof(body.userName, body.proof);
    if (proofError) return NextResponse.json({ error: proofError, proofRequired: true }, { status: 403 });
    const balancePence = await topUp(body.userName, amountPence, body.staff || '', body.note, paymentMethod);
    return NextResponse.json({ ok: true, balancePence });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Top-up failed' }, { status: 400 });
  }
}
