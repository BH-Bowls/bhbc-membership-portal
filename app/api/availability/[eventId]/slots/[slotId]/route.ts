// app/api/availability/[eventId]/slots/[slotId]/route.ts
// API endpoint for removing a slot from an availability event

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getAvailabilityEventById,
  getSlotsForEvent,
  deleteAvailabilitySlot,
} from '@/lib/availability-sheets';
import { hasRole } from '@/lib/role-utils';

// DELETE /api/availability/[eventId]/slots/[slotId]
// Remove a slot and cascade-delete its responses
export async function DELETE(
  request: NextRequest,
  { params }: { params: { eventId: string; slotId: string } }
) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { eventId, slotId } = params;

    // Fetch event to check access and status
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Only creator or Admin can remove slots
    const isCreator = event.createdByUsername === session.user.userName;
    const isAdmin = hasRole(session.user.role, 'Admin');
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Cannot delete slots from closed/concluded/archived events
    if (event.status !== 'open') {
      return NextResponse.json(
        { error: 'Slots can only be removed from open events' },
        { status: 400 }
      );
    }

    // Verify the slot belongs to this event
    const slots = await getSlotsForEvent(eventId);
    let slotFound = false;
    for (const slot of slots) {
      if (slot.slotId === slotId) {
        slotFound = true;
        break;
      }
    }

    if (!slotFound) {
      return NextResponse.json({ error: 'Slot not found on this event' }, { status: 404 });
    }

    // Delete slot and cascade-delete its responses
    await deleteAvailabilitySlot(slotId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/availability/[eventId]/slots/[slotId]] Error:', error);
    return NextResponse.json({ error: 'Failed to delete slot' }, { status: 500 });
  }
}
