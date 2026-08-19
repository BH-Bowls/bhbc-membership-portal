// app/api/bar/void/route.ts
// POST — void a sale (refunds the wallet if it was a wallet sale). { saleId, staff }

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember } from '@/lib/role-utils';
import { voidSale } from '@/lib/bar-supabase';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isCommitteeMember(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json();
  if (!body.saleId) return NextResponse.json({ error: 'saleId required' }, { status: 400 });
  try {
    await voidSale(body.saleId, body.staff || '');
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Void failed' }, { status: 400 });
  }
}
