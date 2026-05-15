// app/api/availability/guest/[eventId]/respond/route.ts
// Public API endpoint for visitors to submit their slot responses using their token
// No authentication required — stricter rate limiting applies

import { NextRequest, NextResponse } from 'next/server';
import {
  getAvailabilityEventById,
  getSlotsForEvent,
  validateVisitorToken,
  upsertVisitorResponse,
} from '@/lib/availability-sheets';
import { getUserByUsername } from '@/lib/sheets';
import { sendTemplateEmail } from '@/lib/email/mailer';
import type { GuestRespondPayload } from '@/types/availability';

// In-memory rate limiting: 10 requests per 5 minutes per IP (stricter for POST)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || record.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count += 1;
  return true;
}

// POST /api/availability/guest/[eventId]/respond
// Save a visitor's slot responses using their token
export async function POST(
  request: NextRequest,
  { params }: { params: { eventId: string } }
) {
  // Apply stricter rate limiting
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { eventId } = params;

    // Parse body
    const body: GuestRespondPayload = await request.json();

    // Honeypot check — bots fill the hidden 'website' field; return 200 silently
    const bodyAny = body as any;
    if (bodyAny.website) {
      return NextResponse.json({ success: true });
    }

    // Token is required in the body
    if (!body.token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 401 });
    }

    // Step 1: Validate the token
    const invitee = await validateVisitorToken(eventId, body.token);
    if (!invitee) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    // Step 2: Fetch the event and verify it is open and not expired
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (event.status !== 'open') {
      return NextResponse.json({ error: 'This event is not accepting responses' }, { status: 400 });
    }

    const expiryDate = new Date(event.expiresAt);
    if (expiryDate <= new Date()) {
      return NextResponse.json({ error: 'This event has expired' }, { status: 400 });
    }

    // Step 3: Validate responses array
    if (!body.responses || body.responses.length === 0) {
      return NextResponse.json({ error: 'At least one response is required' }, { status: 400 });
    }

    const validResponses = ['yes', 'maybe', 'no'];
    for (let i = 0; i < body.responses.length; i++) {
      const resp = body.responses[i];
      if (!resp.slotId) {
        return NextResponse.json({ error: `Response ${i + 1} is missing slotId` }, { status: 400 });
      }
      if (!resp.response || !validResponses.includes(resp.response)) {
        return NextResponse.json(
          { error: `Response ${i + 1} has an invalid response value` },
          { status: 400 }
        );
      }
    }

    // Step 4: Verify all slotIds belong to this event
    const eventSlots = await getSlotsForEvent(eventId);
    const validSlotIds = new Set<string>();
    for (const slot of eventSlots) {
      validSlotIds.add(slot.slotId);
    }

    for (let i = 0; i < body.responses.length; i++) {
      if (!validSlotIds.has(body.responses[i].slotId)) {
        return NextResponse.json(
          { error: `Slot ${body.responses[i].slotId} does not belong to this event` },
          { status: 400 }
        );
      }
    }

    // Step 5: Upsert each response
    for (const resp of body.responses) {
      await upsertVisitorResponse(
        eventId,
        resp.slotId,
        invitee.inviteeId,
        invitee.visitorName,
        invitee.visitorEmail,
        resp.response
      );
    }

    // Step 6: Send creator notification if opted in (failure must not block response)
    if (event.notifyCreatorOnResponse) {
      try {
        const creator = await getUserByUsername(event.createdByUsername);
        if (creator && creator.emailAddress) {
          const appUrl = process.env.NEXTAUTH_URL || '';
          const emailResult = await sendTemplateEmail(
            creator.emailAddress,
            `New response — ${event.title}`,
            'availability-response-notification',
            {
              creatorName: creator.fullKnownAs || creator.firstName,
              eventTitle: event.title,
              respondentName: invitee.visitorName,
              manageUrl: `${appUrl}/availability/${eventId}/manage`,
            }
          );

          if (!emailResult.success) {
            console.error('[guest/respond] Failed to send creator notification:', emailResult.error);
          }
        }
      } catch (emailError) {
        console.error('[guest/respond] Error sending creator notification:', emailError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/availability/guest/[eventId]/respond] Error:', error);
    return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 });
  }
}
