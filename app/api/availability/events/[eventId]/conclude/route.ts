// app/api/availability/events/[eventId]/conclude/route.ts
// API endpoint for the event creator to conclude an event by choosing a winning slot

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getEventById,
  getSlotsForEvent,
  concludeEvent,
} from '@/lib/availability-events-sheets';
import type { ConcludeEventPayload } from '@/types/availability';

// POST /api/availability/events/[eventId]/conclude
// Mark the event as concluded and optionally notify all respondents
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

    // Access check: only event creator or Admin can conclude
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Event must be open or closed (not already concluded or archived)
    if (event.status !== 'open' && event.status !== 'closed') {
      return NextResponse.json(
        { error: 'Event must be open or closed to conclude it' },
        { status: 400 }
      );
    }

    // Parse the request body
    const body: ConcludeEventPayload = await request.json();

    // Validate concludedSlotId is provided
    if (!body.concludedSlotId) {
      return NextResponse.json({ error: 'A winning slot must be selected' }, { status: 400 });
    }

    // Verify the chosen slot belongs to this event
    const slots = await getSlotsForEvent(eventId);
    let slotFound = false;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].slotId === body.concludedSlotId) {
        slotFound = true;
        break;
      }
    }
    if (!slotFound) {
      return NextResponse.json(
        { error: 'The selected slot does not belong to this event' },
        { status: 400 }
      );
    }

    // Step 1: Mark the event as concluded with the chosen slot
    await concludeEvent(
      eventId,
      body.concludedSlotId,
      body.conclusionNote || '',
      userName
    );

    // Step 2: If requested, send conclusion notification emails to all respondents
    if (body.notifyRespondents === true) {
      try {
        const { sendConclusionEmails } = await import('@/lib/email/availability');
        await sendConclusionEmails(eventId);
      } catch (emailError) {
        // Email failure must not block the conclusion — log and continue
        console.error(
          `[POST /api/availability/events/[eventId]/conclude] Conclusion email failed for event ${eventId}:`,
          emailError
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/availability/events/[eventId]/conclude] Error:', error);
    return NextResponse.json({ error: 'Failed to conclude event' }, { status: 500 });
  }
}
