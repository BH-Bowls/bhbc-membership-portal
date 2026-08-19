// app/api/friendlies/manage/lock/route.ts
// GET   — read current lock status (no modification)
// POST  — acquire selection lock for a game
// DELETE — release selection lock for a game
//
// Accepts either `id` (preferred — the fixture's UUID, always present) or `tab_name`
// (fallback, resolved to an id via a lookup) — the still-Sheets-backed selection page
// (manage/game/[tabDate]) only has tabName available, since its own game data hasn't
// been cut over to Postgres yet.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { acquireFixtureLock, releaseFixtureLock, getFixtures } from '@/lib/fixtures-supabase';
import { hasRole } from '@/lib/role-utils';

async function resolveId(id: string, tabName: string): Promise<string | null> {
  if (id) return id;
  if (!tabName) return null;
  const games = await getFixtures();
  const game = games.find(g => g.tabName === tabName);
  return game?.id ?? null;
}

// GET /api/friendlies/manage/lock?id=... or ?tab_name=...
// Returns the current lock state for a game without acquiring or releasing.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasRole(session.user.role, 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const idParam = req.nextUrl.searchParams.get('id') ?? '';
  const tabName = req.nextUrl.searchParams.get('tab_name') ?? '';
  if (!idParam && !tabName) {
    return NextResponse.json({ error: 'id or tab_name is required' }, { status: 400 });
  }

  try {
    // Postgres reads are always fresh — no cache layer to bypass here (unlike the old
    // Sheets version, which needed forceFresh to skip its up-to-90s in-memory cache).
    const games = await getFixtures();
    const game = idParam ? games.find(g => g.id === idParam) : games.find(g => g.tabName === tabName);
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
// Body: { id?: string, tab_name?: string, force?: boolean }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasRole(session.user.role, 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const force: boolean = body.force === true;

  try {
    const id = await resolveId(body.id ?? '', body.tab_name ?? '');
    if (!id) {
      return NextResponse.json({ error: 'id or tab_name required' }, { status: 400 });
    }

    const result = await acquireFixtureLock(id, session.user.userName, force);
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
// Body: { id?: string, tab_name?: string }
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasRole(session.user.role, 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();

  try {
    const id = await resolveId(body.id ?? '', body.tab_name ?? '');
    if (!id) {
      return NextResponse.json({ released: true }); // nothing to release
    }

    await releaseFixtureLock(id, session.user.userName);
    return NextResponse.json({ released: true });
  } catch (err: any) {
    console.error('[lock] DELETE error:', err);
    return NextResponse.json({ error: err.message || 'Failed to release lock' }, { status: 500 });
  }
}
