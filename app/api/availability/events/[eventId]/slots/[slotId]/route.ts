// app/api/availability/events/[eventId]/slots/[slotId]/route.ts
// API endpoint for deleting a slot from an availability event (cascades to responses)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getEventById, deleteSlot, updateSlot } from '@/lib/availability-events-sheets';
import type { AvailabilitySlotType } from '@/types/availability';

// PATCH /api/availability/events/[eventId]/slots/[slotId]
// Update a slot's datetime and/or label
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string; slotId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { eventId, slotId } = await params;

    const event = await getEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = event.createdByUsername === userName;

    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (event.status !== 'open') {
      return NextResponse.json(
        { error: 'Can only edit slots on an open event' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const pollSlotType: AvailabilitySlotType = event.slotType || 'datetime';
    let slotDatetime: string | null = null;

    if (pollSlotType === 'datetime') {
      if (!body.slotDatetime) {
        return NextResponse.json({ error: 'Slot datetime is required' }, { status: 400 });
      }
      const d = new Date(body.slotDatetime);
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Invalid slot datetime format' }, { status: 400 });
      }
      slotDatetime = body.slotDatetime;
    } else {
      if (!body.slotLabel || !body.slotLabel.trim()) {
        return NextResponse.json({ error: 'Option text is required' }, { status: 400 });
      }
    }

    await updateSlot(slotId, slotDatetime, body.slotLabel || '');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/availability/events/[eventId]/slots/[slotId]] Error:', error);
    return NextResponse.json({ error: 'Failed to update slot' }, { status: 500 });
  }
}

// DELETE /api/availability/events/[eventId]/slots/[slotId]
// Remove a slot and cascade-delete all responses to that slot
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string; slotId: string }> }
) {
  try {
    // Verify the user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await the dynamic route params
    const { eventId, slotId } = await params;

    // Fetch the event to check it exists and check creator
    const event = await getEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = event.createdByUsername === userName;

    // Access check: only event creator or Admin can delete slots
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Event must be open for slot management
    if (event.status !== 'open') {
      return NextResponse.json(
        { error: 'Can only remove slots from an open event' },
        { status: 400 }
      );
    }

    // Delete the slot and cascade to all response records for this slot
    await deleteSlot(slotId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/availability/events/[eventId]/slots/[slotId]] Error:', error);
    return NextResponse.json({ error: 'Failed to delete slot' }, { status: 500 });
  }
}
