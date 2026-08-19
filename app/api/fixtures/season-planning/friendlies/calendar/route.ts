// app/api/fixtures/season-planning/friendlies/calendar/route.ts
// GET: the draft season plus all of its Friendlies (any status), for the
// month-by-month calendar popup. Deliberately resolves the draft season
// itself server-side rather than taking a seasonId — the calendar button is
// mounted on several pages, some of which (Events, Clubs list) never load a
// season at all, so it needs to be fully self-contained.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getDraftSeason, listPlanningFixtures } from '@/lib/season-planning-supabase';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const draftSeason = await getDraftSeason();
    if (!draftSeason) {
      return NextResponse.json({ season: null, fixtures: [] });
    }

    const fixtures = await listPlanningFixtures(draftSeason.id, 'Friendly');

    return NextResponse.json({ season: draftSeason, fixtures });
  } catch (error) {
    console.error('Error fetching calendar data:', error);
    return NextResponse.json({ error: 'Failed to fetch calendar data' }, { status: 500 });
  }
}
