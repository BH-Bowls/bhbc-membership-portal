// app/api/leagues/[leagueId]/matches/[matchId]/route.ts
// PATCH — update a match (score/status: squad members of either team + LeagueOrganiser/Admin)
//         date/time fields: LeagueOrganiser/Admin only
// DELETE (LeagueOrganiser/Admin) — delete a single match

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getLeagueMatches,
  getTeamSquad,
  updateLeagueMatch,
  deleteLeagueMatch,
} from '@/lib/leagues-sheets';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; matchId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user?.role ?? '';
  const username = session.user?.userName ?? '';
  const { leagueId, matchId } = await params;

  const isCommittee = hasRole(role, 'LeagueOrganiser', 'Captain', 'Admin');

  try {
    const matches = await getLeagueMatches(leagueId);
    const match = matches.find((m) => m.matchId === matchId);
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

    const body = await req.json();

    const isScoreUpdate = body.homeScore !== undefined || body.awayScore !== undefined || body.status !== undefined;
    const isSchedulingUpdate = body.scheduledDate !== undefined || body.scheduledTime !== undefined ||
      body.playByDate !== undefined || body.matchday !== undefined;

    if (isSchedulingUpdate && !isCommittee) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (isScoreUpdate && !isCommittee) {
      // Once a result is recorded, only committee can change it
      if (match.status === 'Played' || match.status === 'Walkover') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const [homeSquad, awaySquad] = await Promise.all([
        getTeamSquad(match.homeTeamId),
        getTeamSquad(match.awayTeamId),
      ]);
      const inSquad = [...homeSquad, ...awaySquad].some((m) => m.username === username);
      if (!inSquad) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await updateLeagueMatch(matchId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`PATCH /api/leagues/${leagueId}/matches/${matchId} error:`, err);
    return NextResponse.json({ error: 'Failed to update match' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; matchId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user?.role ?? '';
  if (!hasRole(role, 'LeagueOrganiser', 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { leagueId, matchId } = await params;

  try {
    await deleteLeagueMatch(matchId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/leagues/${leagueId}/matches/${matchId} error:`, err);
    return NextResponse.json({ error: 'Failed to delete match' }, { status: 500 });
  }
}
