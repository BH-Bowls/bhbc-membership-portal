// app/api/fixtures/season-planning/friendlies/clubs/[clubName]/route.ts
// GET: everything the Club Info page needs in one call — club details,
// contacts, resolved Match Secretary, multi-season fixture history, and
// same-day clashes against other clubs' draft-season fixtures.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getClubInfo } from '@/lib/season-planning-supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clubName: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { clubName: encodedClubName } = await params;
    const clubName = decodeURIComponent(encodedClubName);

    const info = await getClubInfo(clubName);

    return NextResponse.json(info);
  } catch (error) {
    console.error('Error fetching club info:', error);
    return NextResponse.json({ error: 'Failed to fetch club info' }, { status: 500 });
  }
}
