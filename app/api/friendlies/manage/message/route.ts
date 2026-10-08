// app/api/friendlies/manage/message/route.ts
// PUT — update special instructions message for a game (Captain/Admin only)
//
// Accepts either `id` (preferred — the fixture's UUID, always present) or `tab_name`
// (fallback, resolved to an id) — the still-Sheets-backed selection page doesn't have
// an id available yet.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { updateFixtureMessage, getGameByIdOrTab } from '@/lib/fixtures-supabase';
import { canManageGame } from '@/lib/squads-supabase';

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user && session.user.role ? session.user.role : '';
  const userName = session.user && session.user.userName ? session.user.userName : '';

  const body = await req.json();
  let id = typeof body.id === 'string' ? body.id : '';
  const tabName = typeof body.tab_name === 'string' ? body.tab_name : '';
  const message = typeof body.message === 'string' ? body.message : '';

  if (!id && !tabName) {
    return NextResponse.json({ error: 'id or tab_name is required' }, { status: 400 });
  }

  try {
    // Captain/Admin, or — for a league / Club Team game — the squad's organisers
    const game = await getGameByIdOrTab(id, tabName);
    if (!game) return NextResponse.json({ error: 'Fixture not found' }, { status: 404 });
    if (!(await canManageGame(game, userName, role))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    id = game.id;

    await updateFixtureMessage(id, message);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('PUT /api/friendlies/manage/message error:', err);
    return NextResponse.json({ error: err.message || 'Failed to save message' }, { status: 500 });
  }
}
