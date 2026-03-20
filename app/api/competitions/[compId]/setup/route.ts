// app/api/competitions/[compId]/setup/route.ts
// POST /api/competitions/[compId]/setup
// Saves the bracket draw (committee only).
// Clears existing matches and writes all supplied matches fresh.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCompetitionById, saveCompetitionSetup } from '@/lib/competitions-sheets';
import type { CompMatch } from '@/types/competitions';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ compId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role || 'Member';
    if (role === 'Member' || role === '') {
      return NextResponse.json({ error: 'Committee access required' }, { status: 403 });
    }

    const { compId } = await params;
    const comp = await getCompetitionById(compId);
    if (!comp) {
      return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
    }

    const body = await request.json();
    const matches: CompMatch[] = body.matches;

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
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/competitions/[compId]/setup] Error:', error);
    return NextResponse.json({ error: 'Failed to save bracket setup' }, { status: 500 });
  }
}
