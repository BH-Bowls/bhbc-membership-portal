// app/api/rowland/[compId]/matches/route.ts
// GET all matches for a competition (the current year, or ?year=2025 for another year)

import { NextRequest, NextResponse } from 'next/server';
import { getRowlandMatches } from '@/lib/rowland-supabase';
import type { RowlandCompId } from '@/types/rowland';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ compId: string }> }
) {
  try {
    const { compId } = await params;
    const yearParam = parseInt(req.nextUrl.searchParams.get('year') || '', 10);
    const matches = await getRowlandMatches(compId as RowlandCompId, !isNaN(yearParam) ? yearParam : undefined);
    return NextResponse.json({ matches });
  } catch (error) {
    console.error('[rowland/matches] GET error:', error);
    return NextResponse.json({ error: 'Failed to load matches' }, { status: 500 });
  }
}
