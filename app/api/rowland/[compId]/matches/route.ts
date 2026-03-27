// app/api/rowland/[compId]/matches/route.ts
// GET all matches for a competition

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRowlandMatches } from '@/lib/rowland-sheets';
import type { RowlandCompId } from '@/types/rowland';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ compId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { compId } = await params;
    const matches = await getRowlandMatches(compId as RowlandCompId);
    return NextResponse.json({ matches });
  } catch (error) {
    console.error('[rowland/matches] GET error:', error);
    return NextResponse.json({ error: 'Failed to load matches' }, { status: 500 });
  }
}
