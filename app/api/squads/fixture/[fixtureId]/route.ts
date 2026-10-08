// app/api/squads/fixture/[fixtureId]/route.ts
// One Club Team fixture's details. (Teams are picked on the friendlies selection page.)
// PATCH — edit details; DELETE — remove the fixture

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  canManageSquad,
  getFixtureSquad,
  updateClubTeamFixture,
  deleteClubTeamFixture,
  readClubTeamFixtureInput,
} from '@/lib/squads-supabase';
import { appendManageLog } from '@/lib/fixture-groups-supabase';

// PATCH — a Club Team organiser edits a fixture's details (date agreed, opponent, venue…)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ fixtureId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { fixtureId } = await params;
    const squad = await getFixtureSquad(fixtureId);
    if (!squad || squad.fixtureType !== 'Club Team') {
      return NextResponse.json({ error: 'Fixture not found' }, { status: 404 });
    }
    if (!(await canManageSquad(squad.groupId, session.user.userName, session.user.role))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await updateClubTeamFixture(fixtureId, readClubTeamFixtureInput(await request.json()), session.user.userName);
    await appendManageLog({ username: session.user.userName, action: 'club-team-edit-fixture', fixtureId, groupId: squad.groupId });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/squads/fixture] Error:', error);
    return NextResponse.json({ error: 'Failed to update fixture' }, { status: 500 });
  }
}

// DELETE — a Club Team organiser removes a fixture (its team selections go with it)
export async function DELETE(_request: Request, { params }: { params: Promise<{ fixtureId: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { fixtureId } = await params;
    const squad = await getFixtureSquad(fixtureId);
    if (!squad || squad.fixtureType !== 'Club Team') {
      return NextResponse.json({ error: 'Fixture not found' }, { status: 404 });
    }
    if (!(await canManageSquad(squad.groupId, session.user.userName, session.user.role))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await deleteClubTeamFixture(fixtureId);
    await appendManageLog({ username: session.user.userName, action: 'club-team-delete-fixture', groupId: squad.groupId, details: { fixtureId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/squads/fixture] Error:', error);
    return NextResponse.json({ error: 'Failed to delete fixture' }, { status: 500 });
  }
}
