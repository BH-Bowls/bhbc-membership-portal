// app/api/leagues/[leagueId]/matches/[matchId]/players/route.ts
// POST   — name a player as playing this specific match.
// DELETE — remove a player from this match's lineup.
//
// Committee (LeagueOrganiser/Captain/Admin) can add/remove anyone in the squad of
// either team in this match. A regular squad member can add/remove ANY member of
// their OWN team's squad (not the opponent's, and not just themselves) — and only
// while the match has no recorded result yet.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getLeagueMatches,
  getTeamSquad,
  addMatchPlayer,
  removeMatchPlayer,
} from '@/lib/leagues-supabase';

async function resolveTargetUsername(
  req: NextRequest,
  leagueId: string,
  matchId: string
): Promise<
  | { error: NextResponse }
  | { username: string; addedByUsername: string }
> {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const role = session.user?.role ?? '';
  const callerUsername = session.user?.userName ?? '';
  const isCommittee = hasRole(role, 'LeagueOrganiser', 'Captain', 'Admin');

  const matches = await getLeagueMatches(leagueId);
  const match = matches.find((m) => m.matchId === matchId);
  if (!match) return { error: NextResponse.json({ error: 'Match not found' }, { status: 404 }) };

  const body = await req.json().catch(() => ({}));
  const requestedUsername: string = body.username || callerUsername;

  const [homeSquad, awaySquad] = await Promise.all([
    getTeamSquad(match.homeTeamId),
    getTeamSquad(match.awayTeamId),
  ]);
  const targetInHome = homeSquad.some((m) => m.username === requestedUsername);
  const targetInAway = awaySquad.some((m) => m.username === requestedUsername);
  if (!targetInHome && !targetInAway) {
    return { error: NextResponse.json({ error: `${requestedUsername} is not in either team's squad for this match` }, { status: 400 }) };
  }

  if (!isCommittee) {
    if (match.status === 'Played' || match.status === 'Walkover') {
      return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    const callerInHome = homeSquad.some((m) => m.username === callerUsername);
    const callerInAway = awaySquad.some((m) => m.username === callerUsername);
    if (!callerInHome && !callerInAway) {
      return { error: NextResponse.json({ error: 'You are not in either team\'s squad for this match' }, { status: 403 }) };
    }
    // Non-committee can only manage players on their OWN team, not the opponent's
    const sameTeam = (callerInHome && targetInHome) || (callerInAway && targetInAway);
    if (!sameTeam) {
      return { error: NextResponse.json({ error: 'You can only manage your own team\'s players' }, { status: 403 }) };
    }
  }

  return { username: requestedUsername, addedByUsername: callerUsername };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; matchId: string }> }
) {
  const { leagueId, matchId } = await params;
  try {
    const resolved = await resolveTargetUsername(req, leagueId, matchId);
    if ('error' in resolved) return resolved.error;
    await addMatchPlayer(matchId, resolved.username, resolved.addedByUsername);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/leagues/${leagueId}/matches/${matchId}/players error:`, err);
    return NextResponse.json({ error: 'Failed to add player' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; matchId: string }> }
) {
  const { leagueId, matchId } = await params;
  try {
    const resolved = await resolveTargetUsername(req, leagueId, matchId);
    if ('error' in resolved) return resolved.error;
    await removeMatchPlayer(matchId, resolved.username);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/leagues/${leagueId}/matches/${matchId}/players error:`, err);
    return NextResponse.json({ error: 'Failed to remove player' }, { status: 500 });
  }
}
