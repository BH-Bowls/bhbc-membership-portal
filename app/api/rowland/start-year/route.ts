// app/api/rowland/start-year/route.ts
// POST /api/rowland/start-year — Admin or the Rowland organiser. Body: { year } — the year
// being set up.
//
// Creates next year's four Rowland competitions, Not Started with no teams (see
// startNextRowlandYear). The current year's draws and results stay as they are and become
// a past year on the /rowland year picker. Entries aren't touched.
//
// The body's year must be the one the server would create, so a double click or a page
// left open from before can't set up two years at once.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getCurrentRowlandYear, startNextRowlandYear } from '@/lib/rowland-supabase';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'RowlandOrganiser')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const nextYear = (await getCurrentRowlandYear()) + 1;
    if (Number(body.year) !== nextYear) {
      return NextResponse.json(
        { error: `The Rowland Cup has already moved on — the next year is ${nextYear}. Reload the page.` },
        { status: 409 }
      );
    }

    const result = await startNextRowlandYear();
    return NextResponse.json({ success: true, year: result.year, created: result.created });
  } catch (error) {
    console.error('[POST /api/rowland/start-year] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to set up the new year';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
