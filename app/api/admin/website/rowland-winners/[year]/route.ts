// app/api/admin/website/rowland-winners/[year]/route.ts
// PATCH /api/admin/website/rowland-winners/[year] — updates an existing season's record.
// DELETE /api/admin/website/rowland-winners/[year] — permanently deletes a season's record.
// Auth: Admin, Captain, or GMC role required. Keyed by year (the table's primary key).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { updateRowlandWinners, deleteRowlandWinners } from '@/lib/website-rowland-winners-supabase';

function cleanWinner(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { year } = await params;
    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum <= 0) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }

    const body = await request.json();

    try {
      await updateRowlandWinners(yearNum, {
        edward_winner: cleanWinner(body.edward_winner),
        gladys_winner: cleanWinner(body.gladys_winner),
      });
    } catch {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/admin/website/rowland-winners/[year]] Error:', error);
    return NextResponse.json({ error: 'Failed to update rowland_winners row' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { year } = await params;
    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum <= 0) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }

    try {
      await deleteRowlandWinners(yearNum);
    } catch {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/admin/website/rowland-winners/[year]] Error:', error);
    return NextResponse.json({ error: 'Failed to delete rowland_winners row' }, { status: 500 });
  }
}
