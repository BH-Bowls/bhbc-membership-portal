// app/api/fixtures/games/route.ts
// Public fixtures endpoint — returns all game types, sorted by date ascending
// Available to any authenticated user
//
// Accepts an optional ?year= to view a season other than the active one.
// Past/archived years are open to everyone; a not-yet-active season with a
// later year than the active one is a Season Planning draft and is
// Captain/Admin-only — matches the gate in app/api/fixtures/seasons/route.ts,
// which is what populates the year picker in the first place, so this is a
// defence against a hand-crafted URL rather than something the UI can hit.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getFixtures, getAllSeasons } from '@/lib/fixtures-supabase';
import { hasRole } from '@/lib/role-utils';
import { parseNormalizedDate } from '@/lib/date-utils';

export async function GET(request: NextRequest) {
  try {
    // Check session to determine if user is Admin (Test games are Admin-only)
    const session = await getServerSession(authOptions);
    const isAdmin = hasRole(session?.user?.role, 'Admin');

    let seasonId: string | undefined;
    const yearParam = request.nextUrl.searchParams.get('year');
    if (yearParam) {
      const allSeasons = await getAllSeasons();
      const activeYear = allSeasons.find((s) => s.isActive)?.year;
      const requested = allSeasons.find((s) => s.year === parseInt(yearParam, 10));
      if (!requested) {
        return NextResponse.json({ error: 'Unknown season year' }, { status: 400 });
      }
      const isDraft = !requested.isActive && activeYear !== undefined && requested.year > activeYear;
      if (isDraft && !hasRole(session?.user?.role, 'Captain', 'Admin')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      seasonId = requested.id;
    }

    // Return all game types (no type filter), then exclude Test games for non-admins
    const allGames = await getFixtures(undefined, undefined, seasonId);
    const games = isAdmin ? allGames : allGames.filter(g => g.gameType !== 'Test');

    // Sort by date ascending (upcoming first). game.date is DD/MM/YYYY —
    // must use parseNormalizedDate, not new Date(), which misreads it as
    // MM/DD/YYYY (or NaN) and silently scrambles the order.
    const sortedGames = games.sort((a, b) => {
      const dateA = parseNormalizedDate(a.date).getTime();
      const dateB = parseNormalizedDate(b.date).getTime();
      return dateA - dateB;
    });

    return NextResponse.json({ games: sortedGames });
  } catch (error) {
    console.error('Error fetching fixtures:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fixtures' },
      { status: 500 }
    );
  }
}
