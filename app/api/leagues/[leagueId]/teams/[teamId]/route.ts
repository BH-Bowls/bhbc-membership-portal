// app/api/leagues/[leagueId]/teams/[teamId]/route.ts
// DELETE (LeagueCaptain/Admin) — remove a team

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { deleteTeam } from '@/lib/leagues-sheets';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user?.role ?? '';
  if (!hasRole(role, 'LeagueCaptain', 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { leagueId, teamId } = await params;

  try {
    await deleteTeam(teamId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/leagues/${leagueId}/teams/${teamId} error:`, err);
    return NextResponse.json({ error: 'Failed to delete team' }, { status: 500 });
  }
}
