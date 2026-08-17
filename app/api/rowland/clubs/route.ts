// app/api/rowland/clubs/route.ts
// GET — return the club list for Rowland's team pickers.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getClubs } from '@/lib/clubs-supabase';

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allClubs = await getClubs();
    const clubs = allClubs.map((c) => ({ clubName: c.clubName }));

    return NextResponse.json({ clubs });
  } catch (error) {
    console.error('[rowland/clubs] GET error:', error);
    return NextResponse.json({ error: 'Failed to load clubs' }, { status: 500 });
  }
}
