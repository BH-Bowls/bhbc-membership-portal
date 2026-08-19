// app/api/rowland/entries/route.ts
// GET — list every club's Rowland Cup entry + teams for the current entry season.
// Committee only.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember, hasRole } from '@/lib/role-utils';
import { getAllRowlandEntries, getRowlandEntrySeason } from '@/lib/rowland-entries-supabase';

function isCommittee(role: string) {
  return isCommitteeMember(role) || hasRole(role, 'RowlandOrganiser');
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isCommittee(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const season = await getRowlandEntrySeason();
    const entries = await getAllRowlandEntries(season);

    return NextResponse.json({ season, entries });
  } catch (error) {
    console.error('[rowland/entries] GET error:', error);
    return NextResponse.json({ error: 'Failed to load entries' }, { status: 500 });
  }
}
