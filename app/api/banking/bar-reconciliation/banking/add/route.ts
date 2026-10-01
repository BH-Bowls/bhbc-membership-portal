// app/api/banking/bar-reconciliation/banking/add/route.ts
// POST { bankingId, dayEndId } — adds one more confirmed Day End to an existing,
// not-yet-exported Banking record, recomputing its total.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { addDayEndToBanking } from '@/lib/bar-supabase';

function canAccess(role: string | undefined | null): boolean {
  return hasRole(role, 'Admin', 'Treasurer', 'T');
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccess(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  if (!body.bankingId || !body.dayEndId) {
    return NextResponse.json({ error: 'bankingId and dayEndId are required' }, { status: 400 });
  }

  try {
    const banking = await addDayEndToBanking(body.bankingId, body.dayEndId);
    return NextResponse.json({ ok: true, banking });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to add to banking' }, { status: 500 });
  }
}
