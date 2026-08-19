// app/api/fixtures/season-planning/events/[id]/unconfirm/route.ts
// POST: revert an accidentally-confirmed event back to Projected. Lives
// alongside /confirm, only ever called from within the Edit form.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { unconfirmPlanningFixture } from '@/lib/season-planning-supabase';

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
    await unconfirmPlanningFixture(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error un-confirming event:', error);
    return NextResponse.json({ error: 'Failed to un-confirm event' }, { status: 500 });
  }
}
