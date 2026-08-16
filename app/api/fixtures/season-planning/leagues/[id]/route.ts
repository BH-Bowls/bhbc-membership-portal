// app/api/fixtures/season-planning/leagues/[id]/route.ts
// PATCH: plain field edit (date/time/club/H-A/format/description) — fills
// in a generated "No Game" placeholder as the real fixture becomes known, or
// corrects any league fixture. No Confirm/Un-confirm here — league rows are
// always Confirmed, there's no Projected state to protect against.
// DELETE: remove the fixture entirely.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { updatePlanningFixtureFields, deletePlanningFixture } from '@/lib/season-planning-supabase';

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
    const { date, time, description, clubName, clubSuffix, homeAway, format } = body;

    await updatePlanningFixtureFields(id, {
      date, time, description, clubName, clubSuffix, homeAway, format,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating league fixture:', error);
    return NextResponse.json({ error: 'Failed to update league fixture' }, { status: 500 });
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
    console.error('Error deleting league fixture:', error);
    return NextResponse.json({ error: 'Failed to delete league fixture' }, { status: 500 });
  }
}
