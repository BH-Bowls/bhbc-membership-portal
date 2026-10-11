// app/api/squads/route.ts
// GET  — the active season's squads (external leagues), with the viewer's place in each
//        and which leagues don't have a squad yet (for Captain/Admin to create).
// POST — create a league squad (Captain/Admin): { leagueType, managers[] }
//        or a Club Team (any member, who organises it): { kind: 'club_team', label, managers[] }

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getSquadSummaries, createLeagueSquad, createClubTeam, LEAGUES } from '@/lib/squads-supabase';
import { getAllUsers } from '@/lib/members-supabase';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const squads = await getSquadSummaries(session.user.userName, session.user.role);
    const canCreate = hasRole(session.user.role, 'Captain', 'Admin');
    const missingLeagues = canCreate
      ? LEAGUES.filter(l => !squads.some(s => s.squadType === 'league' && s.leagueType === l.leagueType)).map(l => l.leagueType)
      : [];
    // Names only (no contact details) — for choosing organisers by name
    const members = (await getAllUsers())
      .filter(u => u.userName && u.fullName)
      .map(u => ({ userName: u.userName, fullName: u.fullName }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    return NextResponse.json({ squads, canCreate, missingLeagues, members });
  } catch (error) {
    console.error('[GET /api/squads] Error:', error);
    return NextResponse.json({ error: 'Failed to load squads' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await request.json();
    const managers: string[] = Array.isArray(body.managers) ? body.managers.filter((m: unknown) => typeof m === 'string' && m) : [];

    // Club Team: any member can start one and becomes its organiser
    if (body.kind === 'club_team') {
      const label = typeof body.label === 'string' ? body.label : '';
      const team = await createClubTeam(label, session.user.userName, managers);
      return NextResponse.json({ success: true, id: team.id });
    }

    // League squad: Captain/Admin only
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const leagueType = typeof body.leagueType === 'string' ? body.leagueType : '';
    const group = await createLeagueSquad(leagueType, session.user.userName, managers);
    return NextResponse.json({ success: true, id: group.id });
  } catch (error) {
    console.error('[POST /api/squads] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create squad';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
