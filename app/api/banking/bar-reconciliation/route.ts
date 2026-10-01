// app/api/banking/bar-reconciliation/route.ts
// GET — everything the Treasurer Bar Reconciliation page needs in one call:
// Day Ends awaiting confirmation, confirmed Day Ends (any banked/exported
// status — the page decides what to hide), and Banking batches (?allBankings=1
// for exported ones too).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getUnconfirmedDayEnds, getConfirmedDayEnds, getBankings } from '@/lib/bar-supabase';

function canAccess(role: string | undefined | null): boolean {
  return hasRole(role, 'Admin', 'Treasurer', 'T');
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccess(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const includeExportedBankings = req.nextUrl.searchParams.get('allBankings') === '1';
  try {
    const [unconfirmed, confirmed, bankings] = await Promise.all([
      getUnconfirmedDayEnds(),
      getConfirmedDayEnds(),
      getBankings(includeExportedBankings),
    ]);
    return NextResponse.json({ unconfirmed, confirmed, bankings });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load reconciliation data' }, { status: 500 });
  }
}
