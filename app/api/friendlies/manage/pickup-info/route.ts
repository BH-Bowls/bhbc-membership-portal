// app/api/friendlies/manage/pickup-info/route.ts
// PUT — update pickup information for a game (Captain/Admin only)
//
// Accepts either `id` (preferred — the fixture's UUID, always present) or `tab_name`
// (fallback, resolved to an id) — the still-Sheets-backed selection page doesn't have
// an id available yet.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { updateFixturePickupInfo, getFixtures } from '@/lib/fixtures-supabase';
import { hasRole } from '@/lib/role-utils';

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user?.role ?? '';
  if (!hasRole(role, 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  let id = typeof body.id === 'string' ? body.id : '';
  const tabName = typeof body.tab_name === 'string' ? body.tab_name : '';
  const pickupInfo = typeof body.pickup_info === 'string' ? body.pickup_info : '';

  if (!id && !tabName) {
    return NextResponse.json({ error: 'id or tab_name is required' }, { status: 400 });
  }

  try {
    if (!id) {
      const games = await getFixtures();
      const game = games.find(g => g.tabName === tabName);
      if (!game) return NextResponse.json({ error: 'Fixture not found' }, { status: 404 });
      id = game.id;
    }

    await updateFixturePickupInfo(id, pickupInfo);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('PUT /api/friendlies/manage/pickup-info error:', err);
    return NextResponse.json({ error: err.message || 'Failed to save pickup info' }, { status: 500 });
  }
}
