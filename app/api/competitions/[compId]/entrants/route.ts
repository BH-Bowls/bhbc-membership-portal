// app/api/competitions/[compId]/entrants/route.ts
// GET /api/competitions/[compId]/entrants
// Returns usernames (+ basic info) of members who entered this competition.
// Also returns sub lists for pairs/triples.
// Committee only.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getEntrantsFromRenewals, getMemberInfoMap } from '@/lib/competitions-sheets';
import { hasRole } from '@/lib/role-utils';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ compId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Captain access required' }, { status: 403 });
    }

    const { compId } = await params;
    const [{ entrants, subs }, memberMap] = await Promise.all([
      getEntrantsFromRenewals(compId),
      getMemberInfoMap(),
    ]);

    const enrich = (username: string) =>
      memberMap.get(username.toLowerCase()) ?? {
        username,
        fullName: username,
        handicap: null,
        memberType: '',
      };

    return NextResponse.json({
      entrants: entrants.map(enrich),
      subs: subs.map(enrich),
    });
  } catch (error) {
    console.error('[GET /api/competitions/[compId]/entrants] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch entrants' }, { status: 500 });
  }
}
