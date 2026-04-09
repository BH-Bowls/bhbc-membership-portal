// app/api/leagues/[leagueId]/matches/route.ts
// POST — generate (or replace) fixtures via double round-robin
// PUT  — add a single manual fixture

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getLeague,
  getLeagueTeams,
  getLeagueMatches,
  clearLeagueMatches,
  createLeagueMatches,
} from '@/lib/leagues-sheets';
import { generateRoundRobin } from '@/types/leagues';

export async function POST(
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

  try {
    const [league, teams] = await Promise.all([
      getLeague(leagueId),
      getLeagueTeams(leagueId),
    ]);
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });
    if (teams.length < 2) return NextResponse.json({ error: 'Need at least 2 teams' }, { status: 400 });

    const fixtures = generateRoundRobin(teams.map((t) => t.teamId));

    const matches = fixtures.map((f, i) => ({
      matchId: `${leagueId}-md${f.matchday}-${i + 1}`,
      leagueId,
      matchday: f.matchday,
      homeTeamId: f.homeTeamId,
      awayTeamId: f.awayTeamId,
      scheduledDate: null,
      scheduledTime: null,
      playByDate: null,
    }));

    await clearLeagueMatches(leagueId);
    await createLeagueMatches(matches);

    return NextResponse.json({ count: matches.length });
  } catch (err) {
    console.error(`POST /api/leagues/${leagueId}/matches error:`, err);
    return NextResponse.json({ error: 'Failed to generate fixtures' }, { status: 500 });
  }
}

export async function PUT(
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

  let homeTeamId: string, awayTeamId: string;
  try {
    const body = await req.json();
    homeTeamId = body.homeTeamId;
    awayTeamId = body.awayTeamId;
    if (!homeTeamId || !awayTeamId) throw new Error('homeTeamId and awayTeamId required');
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const existing = await getLeagueMatches(leagueId);
    const matchId = `${leagueId}-manual-${Date.now()}`;
    await createLeagueMatches([{
      matchId,
      leagueId,
      matchday: existing.length + 1,
      homeTeamId,
      awayTeamId,
      scheduledDate: null,
      scheduledTime: null,
      playByDate: null,
    }]);
    return NextResponse.json({ matchId });
  } catch (err) {
    console.error(`PUT /api/leagues/${leagueId}/matches error:`, err);
    return NextResponse.json({ error: 'Failed to add fixture' }, { status: 500 });
  }
}
