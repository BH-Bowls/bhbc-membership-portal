// app/api/availability/guest/[eventId]/respond/route.ts
// Public API endpoint for visitors to save their availability responses using a token
// Rate limit: 10 requests per 5 minutes per IP. No authentication required.
// Includes honeypot bot prevention.

import { NextRequest, NextResponse } from 'next/server';
import {
  getEventById,
  getSlotsForEvent,
  validateGroupMemberToken,
  upsertVisitorResponse,
  upsertMemberResponse,
  deleteMemberResponse,
  deleteVisitorResponse,
} from '@/lib/availability-events-sheets';
import { clearDiaryCache } from '@/lib/home-cache';
import type { AvailabilityResponse } from '@/types/availability';

// In-memory rate limit store — keyed by IP address.
// Stores timestamps of all submissions within the rate limit window.
const submissionTimes: Map<string, number[]> = new Map();
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX_REQUESTS = 10;

// POST /api/availability/guest/[eventId]/respond
// Save visitor responses for one or more slots. Body: GuestRespondPayload + optional honeypot.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  // Rate limiting by IP — 10 requests per 5 minutes
  const ip = request.headers.get('x-forwarded-for')
    || request.headers.get('x-real-ip')
    || 'unknown';

  const now = Date.now();

  // Get existing submission timestamps for this IP
  let timestamps = submissionTimes.get(ip);
  if (!timestamps) {
    timestamps = [];
  }

  // Remove timestamps outside the rate limit window
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recentTimestamps = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] > windowStart) {
      recentTimestamps.push(timestamps[i]);
    }
  }

  // Check if the rate limit has been exceeded
  if (recentTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes before trying again.' },
      { status: 429 }
    );
  }

  try {
    // Await the dynamic route param
    const { eventId } = await params;

    // Parse the request body
    const body = await request.json();

    // Honeypot check — bots fill hidden fields that humans never see.
    // Return silent success (not a 4xx) so bots don't know they were rejected.
    if (body.website) {
      console.log('[POST /api/availability/guest/[eventId]/respond] Honeypot triggered — rejecting bot submission');
      return NextResponse.json({ success: true });
    }

    // Record this legitimate request timestamp after honeypot check
    recentTimestamps.push(now);
    submissionTimes.set(ip, recentTimestamps);

    // Validate token is present in the body
    if (!body.token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    // Step 1: Validate the token and resolve the group member holding it
    const member = await validateGroupMemberToken(eventId, body.token);
    if (!member) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Step 2: Fetch the event to check status and expiry
    const event = await getEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Event must be open to accept responses
    if (event.status !== 'open') {
      return NextResponse.json({ error: 'This event is not accepting responses' }, { status: 400 });
    }

    // Check the event has not expired
    const expiresAt = new Date(event.expiresAt);
    if (expiresAt <= new Date()) {
      return NextResponse.json({ error: 'This event has expired' }, { status: 400 });
    }

    // Validate responses array is non-empty
    if (!body.responses || body.responses.length === 0) {
      return NextResponse.json({ error: 'At least one response is required' }, { status: 400 });
    }

    // Validate each response entry. 'none' is accepted as a special value meaning
    // "clear my saved response for this slot" (the matrix tap-to-cycle can clear a cell).
    const validResponses = ['yes', 'maybe', 'no', 'none'];
    for (let i = 0; i < body.responses.length; i++) {
      const r = body.responses[i];
      if (!r.slotId) {
        return NextResponse.json(
          { error: `Response at index ${i} is missing a slotId` },
          { status: 400 }
        );
      }
      if (!r.response || validResponses.indexOf(r.response) === -1) {
        return NextResponse.json(
          { error: `Response at index ${i} has an invalid response value` },
          { status: 400 }
        );
      }
    }

    // Step 3: Verify each slotId belongs to this event
    const eventSlots = await getSlotsForEvent(eventId);
    const validSlotIds: Record<string, boolean> = {};
    for (let i = 0; i < eventSlots.length; i++) {
      validSlotIds[eventSlots[i].slotId] = true;
    }

    for (let i = 0; i < body.responses.length; i++) {
      const r = body.responses[i];
      if (!validSlotIds[r.slotId]) {
        return NextResponse.json(
          { error: `Slot ${r.slotId} does not belong to this event` },
          { status: 400 }
        );
      }
    }

    // Step 4: Save each response. A member records a MEMBER response (keyed by userName, so
    // it merges with any logged-in reply and shows in their roster row); a visitor records a
    // visitor response (keyed by visitor email).
    const isMember = member.memberType === 'member';
    for (let i = 0; i < body.responses.length; i++) {
      const r = body.responses[i];
      if (isMember) {
        if (r.response === 'none') {
          await deleteMemberResponse(eventId, r.slotId, member.userName);
        } else {
          await upsertMemberResponse(
            eventId,
            r.slotId,
            member.userName,
            r.response as AvailabilityResponse
          );
        }
      } else {
        if (r.response === 'none') {
          await deleteVisitorResponse(eventId, r.slotId, member.visitorEmail);
        } else {
          await upsertVisitorResponse(
            eventId,
            r.slotId,
            member.visitorName,
            member.visitorEmail,
            r.response as AvailabilityResponse
          );
        }
      }
    }

    // A member responding by token may change their home-page diary items
    if (isMember && member.userName) {
      clearDiaryCache(member.userName);
    }

    // Step 5: If the event creator opted in to response notifications, send an email
    if (event.notifyCreatorOnResponse) {
      try {
        if (isMember) {
          const { sendResponseNotificationEmail } = await import('@/lib/email/availability');
          await sendResponseNotificationEmail(event.eventId, member.userName);
        } else {
          const { sendResponseNotificationEmailForVisitor } = await import('@/lib/email/availability');
          await sendResponseNotificationEmailForVisitor(event.eventId, member.visitorName);
        }
      } catch (emailError) {
        // Email failure must not block the response — log and continue
        console.error(
          `[POST /api/availability/guest/[eventId]/respond] Notification email failed for event ${eventId}:`,
          emailError
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/availability/guest/[eventId]/respond] Error:', error);
    return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 });
  }
}
