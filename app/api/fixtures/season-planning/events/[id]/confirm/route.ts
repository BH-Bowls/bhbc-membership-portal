// app/api/fixtures/season-planning/events/[id]/confirm/route.ts
// POST: mark an event Confirmed. The only status transition Stage 1 has —
// date/time corrections (including moving an already-decided date) go
// through the plain PATCH edit instead, and removal is a real DELETE.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { confirmPlanningEvent } from '@/lib/season-planning-supabase';

export async function POST(
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
    await confirmPlanningEvent(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error confirming event:', error);
    return NextResponse.json({ error: 'Failed to confirm event' }, { status: 500 });
  }
}
