// app/api/admin/website/rowland-winners/route.ts
// GET /api/admin/website/rowland-winners — all seasons' Rowland Cup winners for the admin UI.
// POST /api/admin/website/rowland-winners — creates a new season's record.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllRowlandWinners, createRowlandWinners } from '@/lib/website-rowland-winners-supabase';
import { revalidateWebsitePath } from '@/lib/revalidate-website';

function cleanWinner(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rows = await getAllRowlandWinners();
    return NextResponse.json({ rows });
  } catch (error) {
    console.error('[GET /api/admin/website/rowland-winners] Error:', error);
    return NextResponse.json({ error: 'Failed to load rowland_winners' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const yearNum = Number(body.year);
    if (!Number.isInteger(yearNum) || yearNum <= 0) {
      return NextResponse.json({ error: 'year must be a positive whole number' }, { status: 400 });
    }

    let row;
    try {
      row = await createRowlandWinners(yearNum, {
        edward_winner: cleanWinner(body.edward_winner),
        gladys_winner: cleanWinner(body.gladys_winner),
      });
    } catch (err) {
      // Most likely cause: a row for this year already exists (primary key conflict)
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 409 });
    }

    await revalidateWebsitePath('/rowland');
    return NextResponse.json({ success: true, row });
  } catch (error) {
    console.error('[POST /api/admin/website/rowland-winners] Error:', error);
    return NextResponse.json({ error: 'Failed to create rowland_winners row' }, { status: 500 });
  }
}
