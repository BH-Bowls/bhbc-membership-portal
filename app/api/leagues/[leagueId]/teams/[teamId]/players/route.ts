// app/api/leagues/[leagueId]/teams/[teamId]/players/route.ts
// PUT (LeagueOrganiser/Admin) — bulk-save all players for a team

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { setTeamPlayers } from '@/lib/leagues-sheets';

export async function PUT(
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

  let players: { username: string; position: string }[];
  try {
    const body = await req.json();
    players = body.players;
    if (!Array.isArray(players)) throw new Error('players must be an array');
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    await setTeamPlayers(leagueId, teamId, players);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`PUT /api/leagues/${leagueId}/teams/${teamId}/players error:`, err);
    return NextResponse.json({ error: 'Failed to save team players' }, { status: 500 });
  }
}
