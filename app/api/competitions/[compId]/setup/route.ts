// app/api/competitions/[compId]/setup/route.ts
// POST /api/competitions/[compId]/setup
// Saves the bracket draw (committee only).
// Clears existing matches and writes all supplied matches fresh.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompetitionById, saveCompetitionSetup, updateDrawSideCount } from '@/lib/competitions-sheets';
import type { CompMatch } from '@/types/competitions';
import { hasRole } from '@/lib/role-utils';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ compId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Captain access required' }, { status: 403 });
    }

    const { compId } = await params;
    const comp = await getCompetitionById(compId);
    if (!comp) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }

    const body = await request.json();
    const matches: CompMatch[] = body.matches;
    const drawSideCount: number | undefined = body.drawSideCount;

    if (!Array.isArray(matches) || matches.length === 0) {
      return NextResponse.json({ error: 'matches array is required' }, { status: 400 });
    }

    // Basic validation
    for (const m of matches) {
      if (!m.matchId || !m.round || !m.position) {
        return NextResponse.json(
          { error: 'Each match must have matchId, round, and position' },
          { status: 400 }
        );
      }
    }

    await saveCompetitionSetup(compId, matches);

    // Record the side count used for this draw so we can detect future entrant changes.
    // Use a targeted single-cell update to avoid rewriting (and potentially corrupting) the whole row.
    if (drawSideCount != null) {
      await updateDrawSideCount(compId, drawSideCount);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/competitions/[compId]/setup] Error:', error);
    return NextResponse.json({ error: 'Failed to save bracket setup' }, { status: 500 });
  }
}
