// app/api/leagues/[leagueId]/route.ts
// GET (public) — get league, teams, squad, matches and table
// PATCH (Admin/LeagueCaptain) — update league metadata/status

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getLeague,
  getLeagueTeams,
  getLeagueSquad,
  getLeagueMatches,
  updateLeague,
} from '@/lib/leagues-sheets';
import { calculateTable } from '@/types/leagues';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params;
  try {
    const [league, teams, squad, matches] = await Promise.all([
      getLeague(leagueId),
      getLeagueTeams(leagueId),
      getLeagueSquad(leagueId),
      getLeagueMatches(leagueId),
    ]);

    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });

    const table = calculateTable(teams, matches);
    return NextResponse.json({ league, teams, squad, matches, table });
  } catch (err) {
    console.error(`GET /api/leagues/${leagueId} error:`, err);
    return NextResponse.json({ error: 'Failed to load league' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user?.role ?? '';
  if (!hasRole(role, 'LeagueCaptain', 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { leagueId } = await params;
  const body = await req.json();

  try {
    await updateLeague(leagueId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`PATCH /api/leagues/${leagueId} error:`, err);
    return NextResponse.json({ error: 'Failed to update league' }, { status: 500 });
  }
}
