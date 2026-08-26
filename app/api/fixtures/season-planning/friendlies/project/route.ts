// app/api/fixtures/season-planning/friendlies/project/route.ts
// POST { draftSeasonId, method? }: carry the active season's Friendly-type
// fixtures forward into the draft season, using the given date-projection
// method (defaults to 'back-1-day' — see season-planning-dates.ts).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { runFixtureProjection } from '@/lib/season-planning-supabase';
import type { ProjectionMethod } from '@/lib/season-planning-dates';

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
    const { draftSeasonId, method } = body;

    if (!draftSeasonId) {
      return NextResponse.json({ error: 'draftSeasonId is required' }, { status: 400 });
    }

    const result = await runFixtureProjection(draftSeasonId, 'Friendly', method as ProjectionMethod | undefined);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error running friendlies projection:', error);
    const message = error instanceof Error ? error.message : 'Failed to run friendlies projection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
