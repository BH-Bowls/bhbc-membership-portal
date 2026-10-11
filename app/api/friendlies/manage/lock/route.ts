// app/api/friendlies/manage/lock/route.ts
// GET   — read current lock status (no modification)
// POST  — acquire selection lock for a game
// DELETE — release selection lock for a game
//
// Accepts either `id` (preferred — the fixture's UUID) or `tab_name`. Allowed for
// Captain/Admin, or — for a league / Club Team game — that squad's organisers.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { acquireFixtureLock, releaseFixtureLock, getGameByIdOrTab, type Fixture } from '@/lib/fixtures-supabase';
import { canManageGame } from '@/lib/squads-supabase';

/** The game, if it exists and the caller may manage it; otherwise an error response. */
async function resolveGame(id: string, tabName: string, userName: string, role: string): Promise<{ game: Fixture } | { response: NextResponse }> {
  if (!id && !tabName) {
    return { response: NextResponse.json({ error: 'id or tab_name is required' }, { status: 400 }) };
  }
  const game = await getGameByIdOrTab(id, tabName);
  if (!game) {
    return { response: NextResponse.json({ error: 'Game not found' }, { status: 404 }) };
  }
  if (!(await canManageGame(game, userName, role))) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { game };
}

// GET /api/friendlies/manage/lock?id=... or ?tab_name=...
// Returns the current lock state for a game without acquiring or releasing.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const resolved = await resolveGame(
      req.nextUrl.searchParams.get('id') || '',
      req.nextUrl.searchParams.get('tab_name') || '',
      session.user.userName,
      session.user.role || ''
    );
    if ('response' in resolved) return resolved.response;
    return NextResponse.json({ lockedBy: resolved.game.lockedBy, lockedAt: resolved.game.lockedAt });
  } catch (err) {
    console.error('[lock] GET error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to check lock' }, { status: 500 });
  }
}

// POST /api/friendlies/manage/lock
// Body: { id?: string, tab_name?: string, force?: boolean }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  try {
    const resolved = await resolveGame(body.id || '', body.tab_name || '', session.user.userName, session.user.role || '');
    if ('response' in resolved) return resolved.response;

    const result = await acquireFixtureLock(resolved.game.id, session.user.userName, body.force === true);
    if (!result.acquired) {
      return NextResponse.json(
        { error: 'locked', lockedBy: result.lockedBy, lockedAt: result.lockedAt },
        { status: 409 },
      );
    }
    return NextResponse.json({ acquired: true, lockedBy: result.lockedBy, lockedAt: result.lockedAt });
  } catch (err) {
    console.error('[lock] POST error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to acquire lock' }, { status: 500 });
  }
}

// DELETE /api/friendlies/manage/lock
// Body: { id?: string, tab_name?: string }
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  try {
    if (!body.id && !body.tab_name) {
      return NextResponse.json({ released: true }); // nothing to release
    }
    const resolved = await resolveGame(body.id || '', body.tab_name || '', session.user.userName, session.user.role || '');
    if ('response' in resolved) return resolved.response;

    await releaseFixtureLock(resolved.game.id, session.user.userName);
    return NextResponse.json({ released: true });
  } catch (err) {
    console.error('[lock] DELETE error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to release lock' }, { status: 500 });
  }
}
