// app/api/banking/bar-reconciliation/confirm/route.ts
// POST { dayEndId } — reviews and locks a Day End (specs/BAR_BANKING_XERO_SPEC.md
// §3). Staff is the logged-in treasurer, not a picker — this page has real
// per-user logins, unlike the till's shared login.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { confirmDayEnd } from '@/lib/bar-supabase';

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
    const dayEnd = await confirmDayEnd(body.dayEndId, session.user.userName);
    return NextResponse.json({ ok: true, dayEnd });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to confirm day end' }, { status: 500 });
  }
}
