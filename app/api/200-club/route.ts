// app/api/200-club/route.ts
// GET — 200 Club data (entries, settings, winners) for a season. Any logged-in member.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllUsers } from '@/lib/sheets';
import { getEntries, getWinners, getAllSettings, getCurrentSeason } from '@/lib/two-hundred-club-sheets';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const requested = request.nextUrl.searchParams.get('season') || undefined;
    const currentSeason = await getCurrentSeason();
    const season = requested || currentSeason;

    const [allSettings, allWinners, entries] = await Promise.all([
      getAllSettings(),
      getWinners(),
      getEntries(season),
    ]);

    const settings = allSettings.find(s => s.season === season) || null;
    const winners = allWinners.filter(w => w.season === season);
    const seasons = [...new Set([...allSettings.map(s => s.season), ...allWinners.map(w => w.season), season].filter(Boolean))]
      .sort().reverse();

    // Member list for the assign picker — only GMC/Admin can edit, so only they need it.
    let members: { username: string; name: string }[] = [];
    if (hasRole(session.user.role, 'GMC', 'Admin')) {
      const users = await getAllUsers();
      members = users
        .filter(u => u.userName)
        .map(u => ({
          username: u.userName,
          name: u.fullName || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.userName,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    return NextResponse.json({ season, seasons, settings, entries, winners, members });
  } catch (error) {
    console.error('[GET /api/200-club]', error);
    return NextResponse.json({ error: 'Failed to load 200 Club data' }, { status: 500 });
  }
}
