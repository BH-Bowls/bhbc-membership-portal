// app/api/bar/sale/[saleId]/items/route.ts
// GET — line items for a single sale. Used by the member History panel to
// expand a purchase entry on demand (recent-sales lookups already carry
// items inline; this covers older ledger entries that don't). Committee-gated.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember } from '@/lib/role-utils';
import { getSaleItems } from '@/lib/bar-supabase';

export async function GET(req: NextRequest, { params }: { params: Promise<{ saleId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isCommitteeMember(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { saleId } = await params;
  try {
    return NextResponse.json({ items: await getSaleItems(saleId) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load sale items' }, { status: 500 });
  }
}
