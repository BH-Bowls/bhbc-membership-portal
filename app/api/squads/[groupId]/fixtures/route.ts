// app/api/squads/[groupId]/fixtures/route.ts
// POST — a Club Team organiser adds a fixture as a round comes up:
//   { date ('' until agreed), time, clubName (directory) or opponentText, homeAway, format, ladiesMen }

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSquadGroup, canManageSquad, addClubTeamFixture, readClubTeamFixtureInput } from '@/lib/squads-supabase';
import { appendManageLog } from '@/lib/fixture-groups-supabase';

export async function POST(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
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
    if (group.squadType !== 'club_team') {
      return NextResponse.json({ error: 'League fixtures come from Season Planning' }, { status: 400 });
    }
    const input = readClubTeamFixtureInput(await request.json());
    const id = await addClubTeamFixture(group, input, session.user.userName);
    await appendManageLog({ username: session.user.userName, action: 'club-team-add-fixture', fixtureId: id, groupId });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[POST /api/squads/[groupId]/fixtures] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to add fixture' }, { status: 500 });
  }
}
