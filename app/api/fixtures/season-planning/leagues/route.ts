// app/api/fixtures/season-planning/leagues/route.ts
// GET ?seasonId=: list all 5 leagues' fixtures for a season together.
// POST: manually add a single league fixture (lands straight at Confirmed/
// Manually Added, same as Events/Friendlies manual adds) — for a one-off row
// outside the generated skeleton (see generate/route.ts for the bulk path).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { listPlanningLeagueFixtures, addManualFixture, SEASON_PLANNING_LEAGUE_TYPES, type LeagueType } from '@/lib/season-planning-supabase';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const seasonId = request.nextUrl.searchParams.get('seasonId');
    if (!seasonId) {
      return NextResponse.json({ error: 'seasonId is required' }, { status: 400 });
    }

    const leagues = await listPlanningLeagueFixtures(seasonId);

    return NextResponse.json({ leagues });
  } catch (error) {
    console.error('Error fetching planning league fixtures:', error);
    return NextResponse.json({ error: 'Failed to fetch planning league fixtures' }, { status: 500 });
  }
}

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
    const { seasonId, leagueType, date, time, description, clubName, clubSuffix, homeAway, format } = body;

    if (!seasonId || !date) {
      return NextResponse.json({ error: 'seasonId and date are required' }, { status: 400 });
    }
    if (!SEASON_PLANNING_LEAGUE_TYPES.includes(leagueType)) {
      return NextResponse.json({ error: 'leagueType must be one of ' + SEASON_PLANNING_LEAGUE_TYPES.join(', ') }, { status: 400 });
    }

    const fixture = await addManualFixture(seasonId, leagueType as LeagueType, {
      date, time, description, clubName, clubSuffix, homeAway, format,
    });

    return NextResponse.json({ fixture });
  } catch (error) {
    console.error('Error adding league fixture:', error);
    return NextResponse.json({ error: 'Failed to add league fixture' }, { status: 500 });
  }
}
