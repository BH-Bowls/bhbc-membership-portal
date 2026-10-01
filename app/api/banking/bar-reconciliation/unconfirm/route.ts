// app/api/banking/bar-reconciliation/unconfirm/route.ts
// POST { dayEndId } — reopens a confirmed Day End for correction. Blocked
// server-side (bar_unconfirm_day_end()) once it's already banked or exported.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { unconfirmDayEnd } from '@/lib/bar-supabase';

function canAccess(role: string | undefined | null): boolean {
  return hasRole(role, 'Admin', 'Treasurer', 'T');
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccess(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  if (!body.dayEndId) return NextResponse.json({ error: 'dayEndId is required' }, { status: 400 });

  try {
    const dayEnd = await unconfirmDayEnd(body.dayEndId);
    return NextResponse.json({ ok: true, dayEnd });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to unconfirm day end' }, { status: 500 });
  }
}
