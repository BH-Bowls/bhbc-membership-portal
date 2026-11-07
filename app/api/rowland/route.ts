// app/api/rowland/route.ts
// GET the current year's Rowland Cup competitions
// GET ?year=2025 — another year's competitions (read only)
//
// Always returns years (for the year picker), currentYear (the latest year, the one being
// played) and nextYear (what Rowland Admin's "Set up next year" would create).

import { NextRequest, NextResponse } from 'next/server';
import { getAllRowlandComps, getCurrentRowlandYear, getRowlandYears } from '@/lib/rowland-supabase';

export async function GET(request: NextRequest) {
  try {
    const [years, currentYear] = await Promise.all([getRowlandYears(), getCurrentRowlandYear()]);

    const yearParam = parseInt(request.nextUrl.searchParams.get('year') || '', 10);
    const year = !isNaN(yearParam) ? yearParam : currentYear;
    const comps = await getAllRowlandComps(year);

    return NextResponse.json({
      comps,
      year,
      isPast: year !== currentYear,
      years,
      currentYear,
      nextYear: currentYear + 1,
    });
  } catch (error) {
    console.error('[rowland] GET error:', error);
    return NextResponse.json({ error: 'Failed to load competitions' }, { status: 500 });
  }
}
