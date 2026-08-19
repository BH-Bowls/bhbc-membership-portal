// app/api/rowland/entries/[entryId]/payment/route.ts
// PATCH { status: 'Paid' | 'Unpaid' } — manually mark a club's combined Rowland Cup
// payment received (or undo a mistaken mark). Committee only. No bank-rec matching
// yet (Specs/ROWLAND_TEAM_ENTRY_SPEC.md §7, deferred) — this is the manual stand-in.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember, hasRole } from '@/lib/role-utils';
import { markEntryPaid, markEntryUnpaid } from '@/lib/rowland-entries-supabase';

function isCommittee(role: string) {
  return isCommitteeMember(role) || hasRole(role, 'RowlandOrganiser');
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isCommittee(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { entryId } = await params;
    const body = await req.json();

    if (body.status === 'Paid') {
      await markEntryPaid(entryId);
    } else if (body.status === 'Unpaid') {
      await markEntryUnpaid(entryId);
    } else {
      return NextResponse.json({ error: 'status must be "Paid" or "Unpaid"' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[rowland/entries/payment] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update payment status' }, { status: 500 });
  }
}
