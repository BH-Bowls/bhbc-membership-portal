// app/api/fixtures/season-planning/events/project/route.ts
// POST { draftSeasonId }: run the Nth-weekday-of-month projection, carrying
// forward the active season's Event-type fixtures into the draft season.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { runEventsProjection } from '@/lib/season-planning-supabase';

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
    const { draftSeasonId } = body;

    if (!draftSeasonId) {
      return NextResponse.json({ error: 'draftSeasonId is required' }, { status: 400 });
    }

    const result = await runEventsProjection(draftSeasonId);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error running events projection:', error);
    const message = error instanceof Error ? error.message : 'Failed to run events projection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
