// app/api/bar/topup/route.ts
// POST — add cash credit to a member's wallet. { userName, amountPence, staff, note? }

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember } from '@/lib/role-utils';
import { topUp } from '@/lib/bar-supabase';

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
    const balancePence = await topUp(body.userName, amountPence, body.staff || '', body.note);
    return NextResponse.json({ ok: true, balancePence });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Top-up failed' }, { status: 400 });
  }
}
