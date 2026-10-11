// app/api/halve-it/nights/[id]/route.ts
// Halve It nights (Darts role / Admin).
// PUT    — save a night: number of games, status (draft/final), notes, and its
//          full set of scores (replaces what was there).
// DELETE — delete a night and its scores.

import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/halveit-auth';
import { deleteNight, saveNight } from '@/lib/halveit-supabase';
import type { NightUpdate } from '@/lib/halveit-supabase';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireManager();
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = (await request.json()) as NightUpdate;
    if (!Array.isArray(body.scores)) return NextResponse.json({ error: 'Scores are required' }, { status: 400 });
    const result = await saveNight(id, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ night: result.night });
  } catch (error) {
    console.error('[PUT /api/halve-it/nights/[id]]', error);
    return NextResponse.json({ error: 'Failed to save night' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireManager();
  if (denied) return denied;
  try {
    const { id } = await params;
    await deleteNight(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/halve-it/nights/[id]]', error);
    return NextResponse.json({ error: 'Failed to delete night' }, { status: 500 });
  }
}
