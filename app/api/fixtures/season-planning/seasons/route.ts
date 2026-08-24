// app/api/fixtures/season-planning/seasons/route.ts
// GET: active season + draft (next, not-yet-active) season, if one exists,
// plus the full season list (including archived past years) for the
// planning pages' read-only "view another year's clashes" picker.
// POST: create the draft season.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getActiveSeason, getDraftSeason, createDraftSeason } from '@/lib/season-planning-supabase';
import { getAllSeasons } from '@/lib/fixtures-supabase';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const activeSeason = await getActiveSeason();
    const draftSeason = await getDraftSeason();
    // Every season, including archived past years — lets the planning pages
    // offer a read-only year picker for viewing past clashes, not just the draft.
    const allSeasons = await getAllSeasons();

    return NextResponse.json({ activeSeason, draftSeason, allSeasons });
  } catch (error) {
    console.error('Error fetching seasons:', error);
    return NextResponse.json({ error: 'Failed to fetch seasons' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { year, startDate, endDate } = body;

    if (!year || !startDate || !endDate) {
      return NextResponse.json({ error: 'Year, start date, and end date are required' }, { status: 400 });
    }

    const draftSeason = await createDraftSeason(parseInt(year), startDate, endDate);

    return NextResponse.json({ draftSeason });
  } catch (error) {
    console.error('Error creating draft season:', error);
    return NextResponse.json({ error: 'Failed to create draft season' }, { status: 500 });
  }
}
