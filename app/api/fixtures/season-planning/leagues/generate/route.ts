// app/api/fixtures/season-planning/leagues/generate/route.ts
// POST: bulk-generate one blank "No Game" placeholder row per weekly
// occurrence of a single league between two explicit dates — the skeleton
// the committee fills in via Edit as the county's real schedule arrives.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { generateLeagueSlots, SEASON_PLANNING_LEAGUE_TYPES } from '@/lib/season-planning-supabase';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { seasonId, leagueType, weekday, time, startDate, endDate } = body;

    if (!seasonId || weekday === undefined || !startDate || !endDate) {
      return NextResponse.json({ error: 'seasonId, weekday, startDate, and endDate are required' }, { status: 400 });
    }
    if (!SEASON_PLANNING_LEAGUE_TYPES.includes(leagueType)) {
      return NextResponse.json({ error: 'leagueType must be one of ' + SEASON_PLANNING_LEAGUE_TYPES.join(', ') }, { status: 400 });
    }

    const result = await generateLeagueSlots(seasonId, { leagueType, weekday, time, startDate, endDate });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error generating league slots:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate league slots';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
