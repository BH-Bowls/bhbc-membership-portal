// app/api/clubs/[clubName]/fixtures/route.ts
// GET — return all friendly fixtures against a specific club

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getGames } from '@/lib/friendlies-sheets';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clubName: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clubName: encodedClubName } = await params;
    const clubName = decodeURIComponent(encodedClubName).toLowerCase();

    const allGames = await getGames();

    const fixtures = allGames
      .filter((g) => g.clubName.toLowerCase() === clubName)
      .map((g) => ({
        tabName: g.tabName,
        date: g.date,
        time: g.time,
        homeAway: g.homeAway,
        clubName: g.clubName,
        clubSuffix: g.clubSuffix || '',
        format: g.format,
        ladiesMen: g.ladiesMen,
        league: g.league || '',
        gameType: g.gameType || 'Friendly',
        status: g.status,
        reason: g.reason || '',
        bhbcScore: g.bhbcScore,
        opponentScore: g.opponentScore,
      }))
      .sort((a, b) => {
        // Sort by date ascending (DD/MM/YYYY → compare as date objects)
        return parseUKDate(a.date).getTime() - parseUKDate(b.date).getTime();
      });

    return NextResponse.json({ fixtures });
  } catch (error) {
    console.error('[clubs/fixtures] GET error:', error);
    return NextResponse.json({ error: 'Failed to load fixtures' }, { status: 500 });
  }
}

function parseUKDate(dateStr: string): Date {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  }
  return new Date(dateStr);
}
