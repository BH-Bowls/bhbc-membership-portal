// app/api/fixtures/season-planning/events/[id]/route.ts
// PATCH: plain field edit (date/time/description/etc) — no status side-effect.
// Used to refine a still-Projected row, correct a manual add, or move an
// already-decided date (there's no separate "Rearrange" transition — Edit
// covers date changes at any point).
// DELETE: remove the event entirely. Real delete, not a soft-delete flag —
// deleted events can be re-added manually if needed.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { updatePlanningEventFields, deletePlanningEvent } from '@/lib/season-planning-supabase';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { date, time, description, clubName, format, ladiesMen, dress, hardBlock } = body;

    await updatePlanningEventFields(id, {
      date, time, description, clubName, format, ladiesMen, dress, hardBlock,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating event:', error);
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    await deletePlanningEvent(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting event:', error);
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 });
  }
}
