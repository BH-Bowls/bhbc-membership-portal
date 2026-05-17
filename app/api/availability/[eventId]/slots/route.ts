// app/api/availability/[eventId]/slots/route.ts
// API endpoint for adding a new slot to an existing availability event

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getAvailabilityEventById,
  getSlotsForEvent,
  addAvailabilitySlot,
} from '@/lib/availability-sheets';
import { hasRole } from '@/lib/role-utils';

// POST /api/availability/[eventId]/slots
// Add a new candidate date/time slot to an event
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

    // Fetch event to check access and status
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Only creator or Admin can add slots
    const isCreator = event.createdByUsername === session.user.userName;
    const isAdmin = hasRole(session.user.role, 'Admin');
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Event must be open to add slots
    if (event.status !== 'open') {
      return NextResponse.json(
        { error: 'Slots can only be added to open events' },
        { status: 400 }
      );
    }

    // Parse and validate body
    const body = await request.json();

    if (!body.slotDatetime) {
      return NextResponse.json({ error: 'slotDatetime is required' }, { status: 400 });
    }

    const slotDate = new Date(body.slotDatetime);
    if (isNaN(slotDate.getTime())) {
      return NextResponse.json({ error: 'slotDatetime is not a valid ISO date' }, { status: 400 });
    }

    if (slotDate <= new Date()) {
      return NextResponse.json({ error: 'slotDatetime must be in the future' }, { status: 400 });
    }

    // Determine next display order (max existing + 1)
    const existingSlots = await getSlotsForEvent(eventId);
    let maxOrder = 0;
    for (const slot of existingSlots) {
      if (slot.displayOrder > maxOrder) {
        maxOrder = slot.displayOrder;
      }
    }
    const displayOrder = maxOrder + 1;

    // Add the slot
    const slotId = await addAvailabilitySlot(
      eventId,
      body.slotDatetime,
      body.slotLabel || '',
      displayOrder
    );

    return NextResponse.json({ success: true, slotId });
  } catch (error) {
    console.error('[POST /api/availability/[eventId]/slots] Error:', error);
    return NextResponse.json({ error: 'Failed to add slot' }, { status: 500 });
  }
}
