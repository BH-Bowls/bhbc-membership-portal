// app/api/leagues/[leagueId]/teams/[teamId]/route.ts
// DELETE (LeagueOrganiser/Admin) — remove a team
// PATCH  (LeagueOrganiser/Admin) — rename a team

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { deleteTeam, renameTeam } from '@/lib/leagues-sheets';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user?.role ?? '';
  if (!hasRole(role, 'LeagueOrganiser', 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { leagueId, teamId } = await params;

  let name: string;
  try {
    const body = await req.json();
    name = body.name?.trim();
    if (!name) throw new Error('name required');
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    await renameTeam(teamId, name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`PATCH /api/leagues/${leagueId}/teams/${teamId} error:`, err);
    return NextResponse.json({ error: 'Failed to rename team' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; teamId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user?.role ?? '';
  if (!hasRole(role, 'LeagueOrganiser', 'Captain', 'Admin')) {
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
