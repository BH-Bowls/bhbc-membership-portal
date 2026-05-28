// app/api/availability/events/[eventId]/slots/route.ts
// API endpoint for adding a new slot to an availability event

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getEventById,
  addSlot,
  getSlotsForEvent,
} from '@/lib/availability-events-sheets';
import type { AvailabilitySlotType } from '@/types/availability';

// POST /api/availability/events/[eventId]/slots
// Add a new date/time slot to an event
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

    // Access check: only event creator or Admin can add slots
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Event must be open to add new slots
    if (event.status !== 'open') {
      return NextResponse.json(
        { error: 'Can only add slots to an open event' },
        { status: 400 }
      );
    }

    // Parse the request body
    const body = await request.json();

    const pollSlotType: AvailabilitySlotType = event.slotType || 'datetime';
    let slotDatetime: string | null = null;

    if (pollSlotType === 'datetime') {
      // Date/time poll: slotDatetime is required
      if (!body.slotDatetime) {
        return NextResponse.json({ error: 'Slot datetime is required' }, { status: 400 });
      }
      const slotDate = new Date(body.slotDatetime);
      if (isNaN(slotDate.getTime())) {
        return NextResponse.json({ error: 'Invalid slot datetime format' }, { status: 400 });
      }
      slotDatetime = body.slotDatetime;
    } else {
      // Text poll: slotLabel is required
      if (!body.slotLabel || !body.slotLabel.trim()) {
        return NextResponse.json({ error: 'Option text is required' }, { status: 400 });
      }
    }

    // Fetch existing slots to determine the next display order
    const existingSlots = await getSlotsForEvent(eventId);

    // Calculate next display order as max + 1 (or 1 if no slots yet)
    let maxOrder = 0;
    for (let i = 0; i < existingSlots.length; i++) {
      if (existingSlots[i].displayOrder > maxOrder) {
        maxOrder = existingSlots[i].displayOrder;
      }
    }
    const nextOrder = maxOrder + 1;

    // Add the new slot with the calculated display order
    const slotId = await addSlot(eventId, slotDatetime, body.slotLabel || '', nextOrder);

    return NextResponse.json({ success: true, slotId });
  } catch (error) {
    console.error('[POST /api/availability/events/[eventId]/slots] Error:', error);
    return NextResponse.json({ error: 'Failed to add slot' }, { status: 500 });
  }
}
