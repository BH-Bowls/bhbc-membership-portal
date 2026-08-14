// app/api/fixtures/season-planning/friendlies/[id]/route.ts
// PATCH: plain field edit (date/time/club/H-A/format/etc) — no status
// side-effect. Used to refine a still-Projected row, correct a manual add,
// or move an already-decided date (there's no separate "Rearrange"
// transition — Edit covers date changes at any point).
// DELETE: remove the friendly entirely. Real delete, not a soft-delete flag
// — deleted rows can be re-added manually if needed.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { updatePlanningFixtureFields, deletePlanningFixture } from '@/lib/season-planning-supabase';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let clubName: string | undefined;
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
    clubName = body.clubName;
    const { date, time, clubSuffix, homeAway, format, ladiesMen, dress, description } = body;

    await updatePlanningFixtureFields(id, {
      date, time, clubName, clubSuffix, homeAway, format, ladiesMen, dress, description,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating friendly:', error);
    // Same club_name FK gotcha as the POST route — see its comment.
    const message = error instanceof Error && error.message.includes('club_name')
      ? `Unknown club "${clubName}" — check the spelling matches an existing club.`
      : 'Failed to update friendly';
    return NextResponse.json({ error: message }, { status: 500 });
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
    await deletePlanningFixture(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting friendly:', error);
    return NextResponse.json({ error: 'Failed to delete friendly' }, { status: 500 });
  }
}
