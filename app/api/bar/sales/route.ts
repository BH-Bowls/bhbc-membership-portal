// app/api/bar/sales/route.ts
// GET — recent sales (for the void screen). Committee-gated.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember } from '@/lib/role-utils';
import { getRecentSales } from '@/lib/bar-supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isCommitteeMember(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '40', 10) || 40));
  try {
    return NextResponse.json({ sales: await getRecentSales(limit) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load sales' }, { status: 500 });
  }
}
