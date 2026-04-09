// app/api/leagues/my-entries/route.ts
// GET — return league IDs the logged-in user is entered in

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getEnteredLeagueIds } from '@/lib/leagues-sheets';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.userName) {
    return NextResponse.json({ leagueIds: [] });
  }

  try {
    const leagueIds = await getEnteredLeagueIds(session.user.userName);
    return NextResponse.json({ leagueIds });
  } catch (err) {
    console.error('[GET /api/leagues/my-entries] Error:', err);
    return NextResponse.json({ leagueIds: [] });
  }
}
