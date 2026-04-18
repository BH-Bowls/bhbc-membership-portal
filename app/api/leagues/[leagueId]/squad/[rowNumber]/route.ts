// app/api/leagues/[leagueId]/squad/[rowNumber]/route.ts
// PATCH (LeagueOrganiser/Admin) — assign squad member to a team and/or update position

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { assignSquadMemberToTeam, updateSquadMemberPosition } from '@/lib/leagues-sheets';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; rowNumber: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user?.role ?? '';
  if (!hasRole(role, 'LeagueOrganiser', 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { leagueId, rowNumber: rowNumberStr } = await params;
  const rowNumber = parseInt(rowNumberStr, 10);
  if (isNaN(rowNumber)) return NextResponse.json({ error: 'Invalid rowNumber' }, { status: 400 });

  const body = await req.json();

  try {
    if (body.teamId !== undefined) {
      await assignSquadMemberToTeam(rowNumber, body.teamId);
    }
    if (body.position !== undefined) {
      await updateSquadMemberPosition(rowNumber, body.position);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`PATCH /api/leagues/${leagueId}/squad/${rowNumber} error:`, err);
    return NextResponse.json({ error: 'Failed to update squad member' }, { status: 500 });
  }
}
