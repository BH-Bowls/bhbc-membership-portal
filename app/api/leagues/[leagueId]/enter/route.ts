// app/api/leagues/[leagueId]/enter/route.ts
// POST — enter the league (authenticated member or LeagueOrganiser adding someone)
// DELETE — withdraw from the league

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getLeague,
  enterLeague,
  withdrawFromLeague,
  isInLeagueSquad,
} from '@/lib/leagues-sheets';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user?.role ?? '';
  const sessionUsername = session.user?.userName ?? '';
  const { leagueId } = await params;

  const body = await req.json();
  const isCommittee = hasRole(role, 'LeagueOrganiser', 'Captain', 'Admin');
  const username: string = isCommittee && body.username ? body.username : sessionUsername;
  const position = body.position ?? '';

  if (!username) return NextResponse.json({ error: 'No username' }, { status: 400 });

  try {
    const league = await getLeague(leagueId);
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });

    if (league.status !== 'Entries Open' && !isCommittee) {
      return NextResponse.json({ error: 'Entries are not open' }, { status: 400 });
    }

    const alreadyIn = await isInLeagueSquad(leagueId, username);
    if (alreadyIn) return NextResponse.json({ error: 'Already entered' }, { status: 409 });

    const today = new Date().toISOString().slice(0, 10);
    await enterLeague({ leagueId, username, position, enteredDate: today });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/leagues/${leagueId}/enter error:`, err);
    return NextResponse.json({ error: 'Failed to enter league' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user?.role ?? '';
  const sessionUsername = session.user?.userName ?? '';
  const { leagueId } = await params;

  const body = await req.json().catch(() => ({}));
  const isCommittee = hasRole(role, 'LeagueOrganiser', 'Captain', 'Admin');
  const username: string = isCommittee && body.username ? body.username : sessionUsername;

  try {
    await withdrawFromLeague(leagueId, username);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/leagues/${leagueId}/enter error:`, err);
    return NextResponse.json({ error: 'Failed to withdraw' }, { status: 500 });
  }
}
