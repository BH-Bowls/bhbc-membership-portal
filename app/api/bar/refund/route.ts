// app/api/bar/refund/route.ts
// POST — refund cash from a member's wallet (they take notes back). Committee only.
// { userName, amountPence, staff, note? }

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember } from '@/lib/role-utils';
import { refund } from '@/lib/bar-supabase';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isCommitteeMember(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const amountPence = Math.round(Number(body.amountPence));
  if (!body.userName || !Number.isFinite(amountPence) || amountPence <= 0) {
    return NextResponse.json({ error: 'userName and a positive amount are required' }, { status: 400 });
  }
  try {
    const balancePence = await refund(body.userName, amountPence, body.staff || '', body.note);
    return NextResponse.json({ ok: true, balancePence });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Refund failed' }, { status: 400 });
  }
}
