// app/api/rowland/[compId]/setup/route.ts
// POST — create the initial bracket for a competition

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { setupRowlandBracket, updateRowlandComp } from '@/lib/rowland-sheets';
import type { RowlandCompId, RowlandTeamRef } from '@/types/rowland';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ compId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role;
    const isCommittee = role !== 'Member' && role !== 'Club' && role !== '';
    if (!isCommittee) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json() as { teams: RowlandTeamRef[] };
    if (!Array.isArray(body.teams) || body.teams.length < 2) {
      return NextResponse.json({ error: 'At least 2 teams required' }, { status: 400 });
    }

    const { compId: rawCompId } = await params;
    const compId = rawCompId as RowlandCompId;
    await setupRowlandBracket(compId, body.teams);
    await updateRowlandComp(compId, {
      numTeams: body.teams.length,
      status: 'Draw Done',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[rowland/setup] POST error:', error);
    return NextResponse.json({ error: 'Failed to set up bracket' }, { status: 500 });
  }
}
