// app/api/banking/bar-reconciliation/route.ts
// GET — list bar Day End records for the Treasurer Bar Reconciliation page
// (un-exported only by default, ?all=1 for every record ever recorded).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getDayEnds } from '@/lib/bar-supabase';

function canAccess(role: string | undefined | null): boolean {
  return hasRole(role, 'Admin', 'Treasurer', 'T');
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccess(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const includeExported = req.nextUrl.searchParams.get('all') === '1';
  try {
    return NextResponse.json({ dayEnds: await getDayEnds(includeExported) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load day ends' }, { status: 500 });
  }
}
