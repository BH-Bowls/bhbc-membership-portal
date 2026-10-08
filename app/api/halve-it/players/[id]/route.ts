// app/api/halve-it/players/[id]/route.ts
// Halve It team (Darts role / Admin).
// PATCH  — make a player active / inactive.
// DELETE — remove a player who has no scores.

import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/halveit-auth';
import { removePlayer, setPlayerActive } from '@/lib/halveit-supabase';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireManager();
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = (await request.json()) as { active: boolean };
    if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'active is required' }, { status: 400 });
    await setPlayerActive(id, body.active);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/halve-it/players/[id]]', error);
    return NextResponse.json({ error: 'Failed to update player' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireManager();
  if (denied) return denied;
  try {
    const { id } = await params;
    const result = await removePlayer(id);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/halve-it/players/[id]]', error);
    return NextResponse.json({ error: 'Failed to remove player' }, { status: 500 });
  }
}
