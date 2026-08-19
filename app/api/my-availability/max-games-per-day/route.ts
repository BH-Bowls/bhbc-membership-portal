// app/api/my-availability/max-games-per-day/route.ts
// PUT — set the caller's own max games per day preference (1 or 2)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { setMaxGamesPerDay } from '@/lib/members-supabase';

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const maxGamesPerDay = body.maxGamesPerDay;
    if (maxGamesPerDay !== 1 && maxGamesPerDay !== 2) {
      return NextResponse.json({ error: 'maxGamesPerDay must be 1 or 2' }, { status: 400 });
    }

    await setMaxGamesPerDay(session.user.userName, maxGamesPerDay);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('PUT /api/my-availability/max-games-per-day error:', error);
    return NextResponse.json({ error: 'Failed to save preference' }, { status: 500 });
  }
}
