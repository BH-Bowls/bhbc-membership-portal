// app/api/leagues/[leagueId]/teams/route.ts
// POST (LeagueCaptain/Admin) — create a new team in this league

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { createTeam } from '@/lib/leagues-sheets';

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
  const body = await req.json();
  const teamName = body.teamName?.trim();
  if (!teamName) return NextResponse.json({ error: 'teamName is required' }, { status: 400 });

  try {
    const teamId = await createTeam(leagueId, teamName);
    return NextResponse.json({ teamId });
  } catch (err) {
    console.error(`POST /api/leagues/${leagueId}/teams error:`, err);
    return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
  }
}
