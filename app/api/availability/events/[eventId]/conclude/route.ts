// app/api/availability/events/[eventId]/conclude/route.ts
// API endpoint for the event creator to conclude an event by choosing a winning slot

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getEventById,
  getSlotsForEvent,
  getResponsesForEvent,
  concludeEvent,
} from '@/lib/availability-events-supabase';
import { upsertCommitment } from '@/lib/member-availability';
import type { ConcludeEventPayload } from '@/types/availability';

/** UTC-safe: derive a game session from a slot's ISO datetime (AVAILABILITY_SLOT_TIME_TZ_FIX). */
function sessionFromSlotDatetime(iso: string): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date(iso).getUTCHours();
  if (hour < 12) return 'morning';
  if (hour < 16) return 'afternoon';
  return 'evening';
}

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

    // Step 1b: member-availability substrate writeback — emit a commitment for every
    // member who said Yes to the winning slot, so the resolver and diary know they're
    // busy that date/session. Best-effort: a failure here must not undo the conclusion
    // that already happened in step 1. Only real datetime slots produce a commitment —
    // text-type slots have nothing to schedule against.
    const winningSlot = slots.find((s) => s.slotId === body.concludedSlotId);
    if (winningSlot && winningSlot.slotDatetime) {
      try {
        const responses = await getResponsesForEvent(eventId);
        const date = winningSlot.slotDatetime.slice(0, 10);
        const [y, m, d] = date.split('-');
        const dateUK = `${d}/${m}/${y}`;
        const sessionName = sessionFromSlotDatetime(winningSlot.slotDatetime);

        const confirmedMembers = responses.filter(
          (r) => r.respondentType === 'member' && r.slotId === body.concludedSlotId && r.response === 'yes'
        );
        for (const r of confirmedMembers) {
          await upsertCommitment({
            username: r.userName,
            date: dateUK,
            session: sessionName,
            source: 'availability',
            sourceRef: eventId,
            status: 'committed',
            type: 'availability_confirmed',
            label: event.title || 'Availability Event',
            subLabel: 'Confirmed — you said Yes',
            linkUrl: `/availability/events/${eventId}`,
          });
        }
      } catch (writebackError) {
        console.error(
          `[POST /api/availability/events/[eventId]/conclude] Commitment writeback failed for event ${eventId}:`,
          writebackError
        );
      }
    }

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
