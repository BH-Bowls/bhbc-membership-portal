// app/api/bar/report/route.ts
// GET — bar totals for everything not yet linked to a Day End (committee) — see
// getReport() in src/lib/bar-supabase.ts for why this is "since the last cash-up"
// rather than a calendar date range.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { getReport } from '@/lib/bar-supabase';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    return NextResponse.json({ report: await getReport() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load report' }, { status: 500 });
  }
}
