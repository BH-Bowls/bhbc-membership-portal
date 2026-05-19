// app/api/availability/events/[eventId]/reopen/route.ts
// API endpoint for reopening a closed or concluded availability event

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getEventById, updateEvent, clearConclusionFields } from '@/lib/availability-events-sheets';

// POST /api/availability/events/[eventId]/reopen
// Reopen a closed or concluded event (sets status back to open, clears conclusion data)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    // Verify the user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await the dynamic route param
    const { eventId } = await params;

    // Fetch the event to check it exists and check creator
    const event = await getEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = event.createdByUsername === userName;

    // Access check: only event creator or Admin can reopen
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Event must be closed or concluded — cannot reopen an archived event
    if (event.status !== 'closed' && event.status !== 'concluded') {
      return NextResponse.json(
        { error: 'Only closed or concluded events can be reopened' },
        { status: 400 }
      );
    }

    // Set status back to open
    await updateEvent(eventId, { status: 'open' });

    // If the event was concluded, clear the conclusion fields
    if (event.status === 'concluded') {
      await clearConclusionFields(eventId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/availability/events/[eventId]/reopen] Error:', error);
    return NextResponse.json({ error: 'Failed to reopen event' }, { status: 500 });
  }
}
