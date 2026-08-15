// app/api/fixtures/season-planning/friendlies/outreach/route.ts
// GET ?seasonId=: club-grouped outreach list — each club's pending
// (not-yet-Confirmed) friendlies with its resolved Match Secretary/Captain
// contact, for drafting Gmail outreach emails.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getClubOutreachGroups } from '@/lib/season-planning-supabase';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const seasonId = request.nextUrl.searchParams.get('seasonId');
    if (!seasonId) {
      return NextResponse.json({ error: 'seasonId is required' }, { status: 400 });
    }

    const groups = await getClubOutreachGroups(seasonId);

    return NextResponse.json({ groups });
  } catch (error) {
    console.error('Error fetching outreach groups:', error);
    return NextResponse.json({ error: 'Failed to fetch outreach groups' }, { status: 500 });
  }
}
