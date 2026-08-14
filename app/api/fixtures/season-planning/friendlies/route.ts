// app/api/fixtures/season-planning/friendlies/route.ts
// GET ?seasonId=: list planning friendlies for a season.
// POST: manually add a new Friendly (lands straight at Confirmed/Manually Added).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { listPlanningFixtures, addManualFixture } from '@/lib/season-planning-supabase';

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

    const friendlies = await listPlanningFixtures(seasonId, 'Friendly');

    return NextResponse.json({ friendlies });
  } catch (error) {
    console.error('Error fetching planning friendlies:', error);
    return NextResponse.json({ error: 'Failed to fetch planning friendlies' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let clubName: string | undefined;
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { seasonId, date, time, clubSuffix, homeAway, format, ladiesMen, dress, description } = body;
    clubName = body.clubName;

    // Most Friendlies are against a real club, but ad-hoc opponents (touring
    // teams, representative matches — e.g. "Sussex County BA Under 25's")
    // have no club_profiles row to reference, so they go through description
    // instead. Either is acceptable, but at least one is required.
    if (!seasonId || !date || (!clubName && !description)) {
      return NextResponse.json({ error: 'seasonId, date, and either a club or a description are required' }, { status: 400 });
    }

    const friendly = await addManualFixture(seasonId, 'Friendly', {
      date, time, clubName, clubSuffix, homeAway, format, ladiesMen, dress, description,
    });

    return NextResponse.json({ friendly });
  } catch (error) {
    console.error('Error adding friendly:', error);
    // club_name is foreign-keyed to club_profiles — a typo or made-up club
    // hits this constraint, which is worth surfacing plainly rather than a
    // generic 500, since it's a plausible everyday mistake here (unlike
    // Events, where club is usually blank).
    const message = error instanceof Error && error.message.includes('club_name')
      ? `Unknown club "${clubName}" — check the spelling matches an existing club.`
      : 'Failed to add friendly';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
