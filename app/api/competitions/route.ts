// app/api/competitions/route.ts
// GET /api/competitions — the current year's competitions
// GET /api/competitions?year=2025 — another year's competitions (read only)
//
// Always returns years (for the year picker), currentYear (the latest year, the one
// being played) and nextYear (what Competitions Admin's "Set up next year" would create).

import { NextRequest, NextResponse } from 'next/server';
import {
  getAllCompetitions,
  getCompetitionYears,
  getCurrentCompetitionYear,
} from '@/lib/competitions-supabase';

export async function GET(request: NextRequest) {
  try {
    const [years, currentYear] = await Promise.all([
      getCompetitionYears(),
      getCurrentCompetitionYear(),
    ]);

    const yearParam = parseInt(request.nextUrl.searchParams.get('year') || '', 10);
    const year = !isNaN(yearParam) ? yearParam : currentYear;
    const competitions = await getAllCompetitions(year);

    return NextResponse.json({
      competitions,
      year,
      isPast: year !== currentYear,
      years,
      currentYear,
      nextYear: currentYear + 1,
    });
  } catch (error) {
    console.error('[GET /api/competitions] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch competitions' }, { status: 500 });
  }
}
