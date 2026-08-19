// app/api/bar/report/route.ts
// GET ?from=ISO&to=ISO — bar totals for a date range (committee). Defaults to today.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember } from '@/lib/role-utils';
import { getReport } from '@/lib/bar-supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isCommitteeMember(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const from = req.nextUrl.searchParams.get('from') || startOfToday;
  const to = req.nextUrl.searchParams.get('to') || now.toISOString();
  try {
    return NextResponse.json({ report: await getReport(from, to) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load report' }, { status: 500 });
  }
}
