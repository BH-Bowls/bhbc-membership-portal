// app/api/availability/[eventId]/reopen/route.ts
// API endpoint for reopening a closed or concluded availability event

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getAvailabilityEventById,
  updateAvailabilityEvent,
  clearConclusionFields,
} from '@/lib/availability-sheets';
import { hasRole } from '@/lib/role-utils';

// POST /api/availability/[eventId]/reopen
// Reopen a closed or concluded event, clearing any conclusion data
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { eventId } = await params;

    // Fetch event to check access and current status
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Only creator or Admin can reopen
    const isCreator = event.createdByUsername === session.user.userName;
    const isAdmin = hasRole(session.user.role, 'Admin');
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only closed or concluded events can be reopened (not archived)
    if (event.status !== 'closed' && event.status !== 'concluded') {
      return NextResponse.json(
        { error: 'Only closed or concluded events can be reopened' },
        { status: 400 }
      );
    }

    // Set status back to open
    await updateAvailabilityEvent(eventId, { status: 'open' });

    // If event was concluded, clear all conclusion fields
    if (event.status === 'concluded') {
      await clearConclusionFields(eventId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/availability/[eventId]/reopen] Error:', error);
    return NextResponse.json({ error: 'Failed to reopen event' }, { status: 500 });
  }
}
