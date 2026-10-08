// app/api/squads/[groupId]/ask/route.ts
// POST — "Ask squad": get the squad's availability group, creating it on first use and
// bringing its members in step with the squad every time (new members added, leavers
// marked inactive, rejoiners reactivated). Returns its id so the page can open it in the
// availability planner, where the organiser creates a poll with the dates to offer.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSquadGroup, canManageSquad, getActiveSquadUsernames } from '@/lib/squads-supabase';
import { syncSquadAvailabilityGroup } from '@/lib/availability-groups-supabase';

export async function POST(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { groupId } = await params;
    const group = await getSquadGroup(groupId);
    if (!group) {
      return NextResponse.json({ error: 'Squad not found' }, { status: 404 });
    }
    if (!(await canManageSquad(groupId, session.user.userName, session.user.role))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const members = await getActiveSquadUsernames(groupId);
    const availabilityGroupId = await syncSquadAvailabilityGroup(groupId, group.label, members, session.user.userName);
    return NextResponse.json({ success: true, availabilityGroupId });
  } catch (error) {
    console.error('[POST /api/squads/[groupId]/ask] Error:', error);
    return NextResponse.json({ error: 'Failed to open the squad in the availability planner' }, { status: 500 });
  }
}
