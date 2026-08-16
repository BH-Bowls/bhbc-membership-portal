// app/api/rowland/clubs/route.ts
// GET — return the club list for Rowland's team pickers.
//
// clubId here is a legacy value (see supabase/migrations/0047_club_id_legacy.sql) —
// Rowland's own match/bracket data is still Sheets-based (ROWLAND_SPREADSHEET_ID, not yet
// migrated) and stores teams by that id, so clubs without one (anything created directly
// in Postgres since the Clubs migration) are excluded rather than handed a made-up id.

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
    const clubs = allClubs
      .filter((c) => c.clubId)
      .map((c) => ({ clubId: c.clubId as string, clubName: c.clubName }));

    return NextResponse.json({ clubs });
  } catch (error) {
    console.error('[rowland/clubs] GET error:', error);
    return NextResponse.json({ error: 'Failed to load clubs' }, { status: 500 });
  }
}
