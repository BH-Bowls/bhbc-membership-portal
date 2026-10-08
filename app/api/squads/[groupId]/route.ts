// app/api/squads/[groupId]/route.ts
// GET — one squad: members, managers, the season's fixtures (published teams; managers
// also see teams still being picked), and the viewer's own place. Managers also get the
// member list for "add to squad".

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSquadDetail } from '@/lib/squads-supabase';
import { getAllPlayers } from '@/lib/fixture-groups-supabase';
import { getClubs } from '@/lib/clubs-supabase';

export async function GET(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { groupId } = await params;
    const detail = await getSquadDetail(groupId, session.user.userName, session.user.role);
    if (!detail) {
      return NextResponse.json({ error: 'Squad not found' }, { status: 404 });
    }
    const players = detail.canManage ? await getAllPlayers(true) : [];
    // Club Team organisers pick opponents from the club directory
    const clubNames = detail.canManage && detail.group.squadType === 'club_team'
      ? (await getClubs()).map(c => c.clubName).sort((a, b) => a.localeCompare(b))
      : [];
    return NextResponse.json({ ...detail, players, clubNames, viewer: session.user.userName });
  } catch (error) {
    console.error('[GET /api/squads/[groupId]] Error:', error);
    return NextResponse.json({ error: 'Failed to load squad' }, { status: 500 });
  }
}
