// app/api/availability/events/[eventId]/offered/route.ts
// Save the organiser's selected "offered" dates for a match-finder event (creator or Admin only)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getEventById,
  getSlotsForEvent,
  setOfferedSlots,
} from '@/lib/availability-events-sheets';

// POST /api/availability/events/[eventId]/offered
// Body: { slotIds: string[] }  — up to 3 slotIds that belong to this event
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { eventId } = await params;

    const event = await getEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = event.createdByUsername === userName;

    // Only the creator or an Admin may record the offered dates
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const slotIds: string[] = Array.isArray(body.slotIds) ? body.slotIds : [];

    if (slotIds.length > 3) {
      return NextResponse.json({ error: 'You can offer at most 3 dates' }, { status: 400 });
    }

    // Verify each slotId belongs to this event
    const eventSlots = await getSlotsForEvent(eventId);
    const validSlotIds: Record<string, boolean> = {};
    for (let i = 0; i < eventSlots.length; i++) {
      validSlotIds[eventSlots[i].slotId] = true;
    }
    for (let i = 0; i < slotIds.length; i++) {
      if (!validSlotIds[slotIds[i]]) {
        return NextResponse.json(
          { error: `Slot ${slotIds[i]} does not belong to this event` },
          { status: 400 }
        );
      }
    }

    await setOfferedSlots(eventId, slotIds);

    return NextResponse.json({ success: true, slotIds });
  } catch (error) {
    console.error('[POST /api/availability/events/[eventId]/offered] Error:', error);
    return NextResponse.json({ error: 'Failed to save offered dates' }, { status: 500 });
  }
}
