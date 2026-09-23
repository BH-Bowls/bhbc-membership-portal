// app/api/banking/bar-reconciliation/banking/remove/route.ts
// POST { bankingId, dayEndId } — removes a Day End from a not-yet-exported
// Banking record, recomputing its total.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { removeDayEndFromBanking } from '@/lib/bar-supabase';

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
    const banking = await removeDayEndFromBanking(body.bankingId, body.dayEndId);
    return NextResponse.json({ ok: true, banking });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to remove from banking' }, { status: 500 });
  }
}
