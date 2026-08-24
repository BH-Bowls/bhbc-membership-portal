// app/api/fixtures/manage/games/route.ts
// Captain-only fixtures management — GET all games, POST new fixture

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getFixtures, createFixture, getAllSeasons } from '@/lib/fixtures-supabase';
import { GameType } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';
import { parseNormalizedDate } from '@/lib/date-utils';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Optional ?year= to manage a season other than the active one (e.g. the
    // Season Planning draft) — this page is already Captain/Admin-only, so no
    // extra draft-visibility gate is needed here unlike /api/fixtures/games.
    let seasonId: string | undefined;
    const yearParam = request.nextUrl.searchParams.get('year');
    if (yearParam) {
      const allSeasons = await getAllSeasons();
      const requested = allSeasons.find((s) => s.year === parseInt(yearParam, 10));
      if (!requested) {
        return NextResponse.json({ error: 'Unknown season year' }, { status: 400 });
      }
      seasonId = requested.id;
    }

    const games = await getFixtures(undefined, undefined, seasonId);

    // game.date is DD/MM/YYYY — must use parseNormalizedDate, not new Date()
    const sortedGames = games.sort((a, b) => {
      const dateA = parseNormalizedDate(a.date).getTime();
      const dateB = parseNormalizedDate(b.date).getTime();
      return dateA - dateB;
    });

    return NextResponse.json({ games: sortedGames });
  } catch (error) {
    console.error('Error fetching fixtures for manage:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fixtures' },
      { status: 500 }
    );
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
    const {
      date, time, type, clubName, clubSuffix,
      homeAway, format, ladiesMen, dress, paired, maxPlayers, message, pickupInfo,
      year,
    } = body;

    if (!date || !clubName) {
      return NextResponse.json(
        { error: 'Date and club name are required' },
        { status: 400 }
      );
    }

    // Optional year — add the fixture into a season other than the active one
    // (e.g. manually adding a Season Planning draft fixture).
    let seasonId: string | undefined;
    if (year) {
      const allSeasons = await getAllSeasons();
      const requested = allSeasons.find((s) => s.year === parseInt(year, 10));
      if (!requested) {
        return NextResponse.json({ error: 'Unknown season year' }, { status: 400 });
      }
      seasonId = requested.id;
    }

    // Auto-generate tabDate from date (e.g., "25 Apr 26")
    const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let tabDate = '';
    // Try HTML date input format YYYY-MM-DD
    const isoMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const d = new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
      const day = String(d.getDate()).padStart(2, '0');
      const month = monthNamesShort[d.getMonth()];
      const year = String(d.getFullYear()).slice(-2);
      tabDate = `${day} ${month} ${year}`;
    }

    const tabName = tabDate ? `${clubName} ${tabDate}` : clubName;

    await createFixture({
      date,
      time,
      type: (type as GameType) || 'Friendly',
      clubName,
      clubSuffix,
      homeAway,
      format,
      ladiesMen,
      dress,
      paired,
      maxPlayers: maxPlayers ? parseInt(maxPlayers) : undefined,
      message,
      pickupInfo,
      tabName,
      status: '',
      seasonId,
    });

    return NextResponse.json({ success: true, tabName });
  } catch (error) {
    console.error('Error creating fixture:', error);
    return NextResponse.json(
      { error: 'Failed to create fixture' },
      { status: 500 }
    );
  }
}
