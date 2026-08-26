// app/api/fixtures/season-planning/clear-projected/route.ts
// POST { seasonId, fixtureType: 'Event' | 'Friendly' }: delete every
// still-Projected, Carried-Forward fixture of that type in the given season,
// so a projection run using the wrong date method can be cleared and
// re-run. Events and Friendlies are cleared independently — see
// clearProjectedFixtures in season-planning-supabase.ts for exact scope.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { clearProjectedFixtures } from '@/lib/season-planning-supabase';
import type { PlanningFixtureType } from '@/lib/season-planning-supabase';

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
    const { seasonId, fixtureType } = body;

    if (!seasonId) {
      return NextResponse.json({ error: 'seasonId is required' }, { status: 400 });
    }
    if (fixtureType !== 'Event' && fixtureType !== 'Friendly') {
      return NextResponse.json({ error: "fixtureType must be 'Event' or 'Friendly'" }, { status: 400 });
    }

    const result = await clearProjectedFixtures(seasonId, fixtureType as PlanningFixtureType);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error clearing projected fixtures:', error);
    const message = error instanceof Error ? error.message : 'Failed to clear projected fixtures';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
