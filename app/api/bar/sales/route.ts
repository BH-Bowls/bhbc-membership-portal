// app/api/bar/sales/route.ts
// GET — recent sales (for the void screen), each marked if the bar person serving
// approved it for a member without their card or PIN. Committee-gated.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { getRecentSales } from '@/lib/bar-supabase';
import { getApprovedSaleIds } from '@/lib/bar-card';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '40', 10) || 40));
  try {
    const sales = await getRecentSales(limit);
    // Marks Pay by Account sales the bar person serving approved (src/lib/bar-card.ts)
    const approved = await getApprovedSaleIds(sales.map((s) => s.id));
    for (const s of sales) s.serverApproved = approved.has(s.id);
    return NextResponse.json({ sales: sales });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load sales' }, { status: 500 });
  }
}
