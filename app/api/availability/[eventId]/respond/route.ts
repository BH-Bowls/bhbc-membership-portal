// app/api/availability/[eventId]/respond/route.ts
// API endpoint for a logged-in member to submit their slot responses

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getAvailabilityEventById,
  getSlotsForEvent,
  upsertMemberResponse,
  isMemberInvited,
} from '@/lib/availability-sheets';
import { getUserByUsername } from '@/lib/sheets';
import { sendTemplateEmail } from '@/lib/email/mailer';
import { hasRole } from '@/lib/role-utils';
import type { MemberRespondPayload } from '@/types/availability';

// POST /api/availability/[eventId]/respond
// Save the current member's responses for one or more slots
export async function POST(
  request: NextRequest,
  { params }: { params: { eventId: string } }
) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { eventId } = params;

    // Fetch the event
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Access check for private events
    if (event.visibility === 'private') {
      const isCreator = event.createdByUsername === session.user.userName;
      const isAdmin = hasRole(session.user.role, 'Admin');
      const isInvited = await isMemberInvited(eventId, session.user.userName);

      if (!isCreator && !isAdmin && !isInvited) {
        return NextResponse.json({ error: 'You have not been invited to this event' }, { status: 403 });
      }
    }

    // Event must be open and not expired
    if (event.status !== 'open') {
      return NextResponse.json({ error: 'This event is not accepting responses' }, { status: 400 });
    }

    const expiryDate = new Date(event.expiresAt);
    if (expiryDate <= new Date()) {
      return NextResponse.json({ error: 'This event has expired' }, { status: 400 });
    }

    // Parse and validate body
    const body: MemberRespondPayload = await request.json();

    if (!body.responses || body.responses.length === 0) {
      return NextResponse.json({ error: 'At least one response is required' }, { status: 400 });
    }

    // Validate each response has slotId and a valid response value
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

    // Verify all slotIds belong to this event
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

    // Upsert each response
    for (const resp of body.responses) {
      await upsertMemberResponse(eventId, resp.slotId, session.user.userName, resp.response);
    }

    // Send notification to creator if they opted in (email failure must not block response)
    if (event.notifyCreatorOnResponse) {
      try {
        const creator = await getUserByUsername(event.createdByUsername);
        if (creator && creator.emailAddress) {
          // Resolve respondent display name
          const respondentUser = await getUserByUsername(session.user.userName);
          const respondentName = respondentUser
            ? (respondentUser.fullName || session.user.userName)
            : session.user.userName;

          const appUrl = process.env.NEXTAUTH_URL || '';
          const emailResult = await sendTemplateEmail(
            creator.emailAddress,
            `New response — ${event.title}`,
            'availability-response-notification',
            {
              creatorName: creator.fullKnownAs || creator.firstName,
              eventTitle: event.title,
              respondentName,
              manageUrl: `${appUrl}/availability/${eventId}/manage`,
            }
          );

          if (!emailResult.success) {
            console.error('[respond] Failed to send creator notification:', emailResult.error);
          }
        }
      } catch (emailError) {
        // Log but do not block the response
        console.error('[respond] Error sending creator notification:', emailError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/availability/[eventId]/respond] Error:', error);
    return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 });
  }
}
