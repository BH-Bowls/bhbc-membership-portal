// app/api/competitions/start-year/route.ts
// POST /api/competitions/start-year — Admin only. Body: { year } — the year being set up.
//
// Creates next year's competitions: one Not Started row per competition, carrying over
// name, type and rules text (see startNextCompetitionYear). The current year's draws and
// results stay as they are and become a past year on the /competitions year picker.
//
// The body's year must be the one the server would create. That stops a double click,
// or a page left open from before, setting up two years at once.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getCurrentCompetitionYear, startNextCompetitionYear } from '@/lib/competitions-supabase';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const nextYear = (await getCurrentCompetitionYear()) + 1;
    if (Number(body.year) !== nextYear) {
      return NextResponse.json(
        { error: `The competitions have already moved on — the next year is ${nextYear}. Reload the page.` },
        { status: 409 }
      );
    }

    const result = await startNextCompetitionYear();
    return NextResponse.json({ success: true, year: result.year, created: result.created });
  } catch (error) {
    console.error('[POST /api/competitions/start-year] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to set up the new year';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
