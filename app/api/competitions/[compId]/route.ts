// app/api/competitions/[compId]/route.ts
// GET  /api/competitions/[compId] — competition + matches (the current year)
// GET  /api/competitions/[compId]?year=2025 — another year's competition + matches (read only)
// PATCH /api/competitions/[compId] — update the current year's competition metadata (committee)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getCompetitionById,
  getCompetitionMatches,
  getCurrentCompetitionYear,
  updateCompetition,
} from '@/lib/competitions-supabase';
import type { Competition } from '@/types/competitions';
import { isMember } from '@/lib/role-utils';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ compId: string }> }
) {
  try {
    const { compId } = await params;

    const currentYear = await getCurrentCompetitionYear();
    const yearParam = parseInt(request.nextUrl.searchParams.get('year') || '', 10);
    const year = !isNaN(yearParam) ? yearParam : currentYear;

    const [competition, matches] = await Promise.all([
      getCompetitionById(compId, year),
      getCompetitionMatches(compId, year),
    ]);

    if (!competition) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }

    return NextResponse.json({ competition, matches, isPast: year !== currentYear });
  } catch (error) {
    console.error('[GET /api/competitions/[compId]] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch competition' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ compId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (isMember(session.user.role)) {
      return NextResponse.json({ error: 'Committee access required' }, { status: 403 });
    }

    const { compId } = await params;
    const existing = await getCompetitionById(compId);
    if (!existing) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }

    const body = await request.json();
    const updated: Competition = {
      ...existing,
      ...body,
      compId, // Prevent changing the ID
      year: existing.year, // ...or the year — only the current year's row is ever updated
    };

    await updateCompetition(updated);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/competitions/[compId]] Error:', error);
    return NextResponse.json({ error: 'Failed to update competition' }, { status: 500 });
  }
}
