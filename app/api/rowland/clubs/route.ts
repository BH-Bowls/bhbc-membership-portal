// app/api/rowland/clubs/route.ts
// GET — return list of clubs from the Match Day Contacts spreadsheet

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllClubsForImpersonation } from '@/lib/clubs-sheets';

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clubs = await getAllClubsForImpersonation();

    return NextResponse.json({ clubs });
  } catch (error) {
    console.error('[rowland/clubs] GET error:', error);
    return NextResponse.json({ error: 'Failed to load clubs' }, { status: 500 });
  }
}
