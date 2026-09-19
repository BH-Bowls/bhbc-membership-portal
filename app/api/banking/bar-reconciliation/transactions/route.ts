// app/api/banking/bar-reconciliation/transactions/route.ts
// GET — the underlying bar_sales/bar_ledger rows behind one line of a Day End
// record (drill-down from the Treasurer Bar Reconciliation page).
// ?dayEndId=<id>&kind=wallet_sales|card_sales|cash_sales|cash_topups|card_topups|refunds

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getDayEndSales, getDayEndLedger } from '@/lib/bar-supabase';

function canAccess(role: string | undefined | null): boolean {
  return hasRole(role, 'Admin', 'Treasurer', 'T');
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccess(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const dayEndId = req.nextUrl.searchParams.get('dayEndId');
  const kind = req.nextUrl.searchParams.get('kind');
  if (!dayEndId || !kind) return NextResponse.json({ error: 'dayEndId and kind are required' }, { status: 400 });

  try {
    switch (kind) {
      case 'wallet_sales':
        return NextResponse.json({ sales: await getDayEndSales(dayEndId, 'wallet') });
      case 'card_sales':
        return NextResponse.json({ sales: await getDayEndSales(dayEndId, 'card') });
      case 'cash_sales':
        return NextResponse.json({ sales: await getDayEndSales(dayEndId, 'cash') });
      case 'cash_topups':
        return NextResponse.json({ ledger: await getDayEndLedger(dayEndId, 'topup', 'cash') });
      case 'card_topups':
        return NextResponse.json({ ledger: await getDayEndLedger(dayEndId, 'topup', 'card') });
      case 'refunds':
        return NextResponse.json({ ledger: await getDayEndLedger(dayEndId, 'refund') });
      default:
        return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load transactions' }, { status: 500 });
  }
}
