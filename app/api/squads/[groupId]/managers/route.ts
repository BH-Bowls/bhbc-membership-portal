// app/api/squads/[groupId]/managers/route.ts
// PUT { usernames: string[] } — set the squad's managers (any current manager, or
// Captain/Admin). Captain and Admin can always manage every squad regardless.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSquadGroup, canManageSquad, setSquadManagers } from '@/lib/squads-supabase';
import { appendManageLog } from '@/lib/fixture-groups-supabase';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
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
    const body = await request.json();
    const usernames: string[] = Array.isArray(body.usernames) ? body.usernames.filter((u: unknown) => typeof u === 'string' && u) : [];
    await setSquadManagers(groupId, usernames, session.user.userName);
    await appendManageLog({ username: session.user.userName, action: 'squad-managers', groupId, details: { managers: usernames } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PUT /api/squads/[groupId]/managers] Error:', error);
    return NextResponse.json({ error: 'Failed to update managers' }, { status: 500 });
  }
}
