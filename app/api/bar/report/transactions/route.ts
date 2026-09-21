// app/api/bar/report/transactions/route.ts
// GET ?kind=... — the underlying bar_sales/bar_ledger rows behind one line of
// the till's live Dayend screen (drill-down into whatever hasn't yet been
// linked to a Day End record — see getReport()/getDayEndSales()/getDayEndLedger()
// in src/lib/bar-supabase.ts).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { getDayEndSales, getDayEndLedger } from '@/lib/bar-supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const kind = req.nextUrl.searchParams.get('kind');
  if (!kind) return NextResponse.json({ error: 'kind is required' }, { status: 400 });

  try {
    switch (kind) {
      case 'wallet_sales':
        return NextResponse.json({ sales: await getDayEndSales(null, 'wallet') });
      case 'card_sales':
        return NextResponse.json({ sales: await getDayEndSales(null, 'card') });
      case 'cash_sales':
        return NextResponse.json({ sales: await getDayEndSales(null, 'cash') });
      case 'cash_topups':
        return NextResponse.json({ ledger: await getDayEndLedger(null, 'topup', 'cash') });
      case 'card_topups':
        return NextResponse.json({ ledger: await getDayEndLedger(null, 'topup', 'card') });
      case 'refunds':
        return NextResponse.json({ ledger: await getDayEndLedger(null, 'refund') });
      default:
        return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load transactions' }, { status: 500 });
  }
}
