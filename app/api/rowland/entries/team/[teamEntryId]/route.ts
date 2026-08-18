// app/api/rowland/entries/team/[teamEntryId]/route.ts
// PATCH { status: 'Entered' | 'Withdrawn' } — withdraw/reinstate a single team-entry
// (e.g. payment never arrives). Committee only.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember, hasRole } from '@/lib/role-utils';
import { withdrawTeamEntry, reinstateTeamEntry } from '@/lib/rowland-entries-supabase';

function isCommittee(role: string) {
  return isCommitteeMember(role) || hasRole(role, 'RowlandOrganiser');
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ teamEntryId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isCommittee(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { teamEntryId } = await params;
    const body = await req.json();

    if (body.status === 'Withdrawn') {
      await withdrawTeamEntry(teamEntryId);
    } else if (body.status === 'Entered') {
      await reinstateTeamEntry(teamEntryId);
    } else {
      return NextResponse.json({ error: 'status must be "Entered" or "Withdrawn"' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[rowland/entries/team] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update team entry status' }, { status: 500 });
  }
}
