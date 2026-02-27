// app/api/fixtures/manage/games/route.ts
// Captain-only fixtures management — GET all games, POST new fixture

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, createFixture } from '@/lib/friendlies-sheets';
import { GameType } from '@/lib/types/friendlies';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const games = await getGames();

    const sortedGames = games.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
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

    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const {
      date, time, type, clubName, clubSuffix,
      homeAway, format, ladiesMen, dress, paired, maxPlayers,
    } = body;

    if (!date || !clubName) {
      return NextResponse.json(
        { error: 'Date and club name are required' },
        { status: 400 }
      );
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
      tabDate,
      tabName,
      status: '',
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
