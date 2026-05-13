// app/api/friendlies/manage/lock/route.ts
// GET   — read current lock status (no modification)
// POST  — acquire selection lock for a game
// DELETE — release selection lock for a game

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { acquireGameLock, releaseGameLock, getGames } from '@/lib/friendlies-sheets';
import { hasRole } from '@/lib/role-utils';

// GET /api/friendlies/manage/lock?tab_name=...
// Returns the current lock state for a game without acquiring or releasing.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasRole(session.user.role, 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const tabName = req.nextUrl.searchParams.get('tab_name') ?? '';
  if (!tabName) {
    return NextResponse.json({ error: 'tab_name is required' }, { status: 400 });
  }

  try {
    const games = await getGames();
    const game = games.find(g => g.tabName === tabName);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    return NextResponse.json({ lockedBy: game.lockedBy, lockedAt: game.lockedAt });
  } catch (err: any) {
    console.error('[lock] GET error:', err);
    return NextResponse.json({ error: err.message || 'Failed to check lock' }, { status: 500 });
  }
}

// POST /api/friendlies/manage/lock
// Body: { tab_name: string, row_number?: number, force?: boolean }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasRole(session.user.role, 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const tabName: string = body.tab_name ?? '';
  const rowNumber: number | undefined = body.row_number ?? undefined;
  const force: boolean = body.force === true;

  if (!tabName && !rowNumber) {
    return NextResponse.json({ error: 'tab_name or row_number required' }, { status: 400 });
  }

  try {
    const result = await acquireGameLock(tabName, session.user.userName, rowNumber, force);
    if (!result.acquired) {
      return NextResponse.json(
        { error: 'locked', lockedBy: result.lockedBy, lockedAt: result.lockedAt },
        { status: 409 },
      );
    }
    return NextResponse.json({ acquired: true, lockedBy: result.lockedBy, lockedAt: result.lockedAt });
  } catch (err: any) {
    console.error('[lock] POST error:', err);
    return NextResponse.json({ error: err.message || 'Failed to acquire lock' }, { status: 500 });
  }
}

// DELETE /api/friendlies/manage/lock
// Body: { tab_name: string, row_number?: number }
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasRole(session.user.role, 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const tabName: string = body.tab_name ?? '';
  const rowNumber: number | undefined = body.row_number ?? undefined;

  try {
    await releaseGameLock(tabName, session.user.userName, rowNumber);
    return NextResponse.json({ released: true });
  } catch (err: any) {
    console.error('[lock] DELETE error:', err);
    return NextResponse.json({ error: err.message || 'Failed to release lock' }, { status: 500 });
  }
}
