// app/api/fixtures/season-planning/free-dates/route.ts
// GET: the draft season plus the date/time of every fixture in it (Friendlies,
// Events and all League types, any status, Home or Away) — for the "Free
// Dates" popup, which works out the afternoons with nothing on client-side so
// its weekday/month filters stay instant. Resolves the draft season itself,
// same as the calendar route, since it's mounted on pages that never load one.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getDraftSeason, listPlanningFixtures, listPlanningLeagueFixtures } from '@/lib/season-planning-supabase';

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

    const [friendlies, events, leagues] = await Promise.all([
      listPlanningFixtures(draftSeason.id, 'Friendly'),
      listPlanningFixtures(draftSeason.id, 'Event'),
      listPlanningLeagueFixtures(draftSeason.id),
    ]);

    const fixtures = [...friendlies, ...events, ...leagues].map((f) => ({ date: f.date, time: f.time }));
    return NextResponse.json({ season: draftSeason, fixtures });
  } catch (error) {
    console.error('Error fetching free dates data:', error);
    return NextResponse.json({ error: 'Failed to fetch free dates data' }, { status: 500 });
  }
}
