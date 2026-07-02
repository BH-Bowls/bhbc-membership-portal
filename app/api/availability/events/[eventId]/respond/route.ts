// app/api/availability/events/[eventId]/respond/route.ts
// API endpoint for a member to save their availability responses

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getEventById,
  getSlotsForEvent,
  upsertMemberResponse,
  deleteMemberResponse,
} from '@/lib/availability-events-sheets';
import { clearDiaryCache } from '@/lib/home-cache';
import { isGroupMember, getGroupById, canManageGroupMembers } from '@/lib/availability-groups-sheets';
import type { MemberRespondPayload, AvailabilityResponse } from '@/types/availability';

// POST /api/availability/events/[eventId]/respond
// Save the calling member's responses for one or more slots
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

    // Fetch the event to check access and status
    const event = await getEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = event.createdByUsername === userName;

    // Access check: same rules as GET — group events require membership
    if (event.groupId) {
      if (!isCreator && !isAdmin) {
        const memberStatus = await isGroupMember(event.groupId, userName);
        if (!memberStatus) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    }

    // Parse the request body once — used both for the proxy target and the responses
    const body: MemberRespondPayload & { onBehalfOf?: string } = await request.json();

    // Resolve the target respondent. By default a member responds for themselves; a group
    // manager may submit on behalf of another group member via `onBehalfOf`.
    const onBehalfOf: string = (body.onBehalfOf ? String(body.onBehalfOf) : '').trim();
    let targetUserName = userName;

    if (onBehalfOf && onBehalfOf !== userName) {
      // Proxy responses are only valid for group events
      if (!event.groupId) {
        return NextResponse.json(
          { error: 'Responding on behalf of others is only allowed for group polls' },
          { status: 400 }
        );
      }
      // Caller must be able to manage the group
      const group = await getGroupById(event.groupId);
      if (!group) {
        return NextResponse.json({ error: 'Group not found' }, { status: 404 });
      }
      const canManage = await canManageGroupMembers(group, userName, userRole);
      if (!canManage) {
        return NextResponse.json(
          { error: 'You do not have permission to respond for other members' },
          { status: 403 }
        );
      }
      // The target must be a current member of this event's group (the roster = group members)
      const targetIsMember = await isGroupMember(event.groupId, onBehalfOf);
      if (!targetIsMember) {
        return NextResponse.json(
          { error: 'That member is not part of this poll' },
          { status: 400 }
        );
      }
      targetUserName = onBehalfOf;
    }

    // Event must be open to accept responses
    if (event.status !== 'open') {
      return NextResponse.json(
        { error: 'This event is not accepting responses' },
        { status: 400 }
      );
    }

    // Check the event has not expired
    const now = new Date();
    const expiresAt = new Date(event.expiresAt);
    if (expiresAt <= now) {
      return NextResponse.json({ error: 'This event has expired' }, { status: 400 });
    }

    // Validate responses array is non-empty
    if (!body.responses || body.responses.length === 0) {
      return NextResponse.json({ error: 'At least one response is required' }, { status: 400 });
    }

    // Validate each response entry. 'none' is accepted as a special value meaning
    // "clear my previously-saved response for this slot" (used by the match-finder matrix).
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

    // Verify each slotId belongs to this event (prevent cross-event response injection)
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

    // Save each response — upsert (insert new or update existing), or clear when 'none'.
    // targetUserName is the caller unless a manager is responding on behalf of someone.
    for (let i = 0; i < body.responses.length; i++) {
      const r = body.responses[i];
      if (r.response === 'none') {
        await deleteMemberResponse(eventId, r.slotId, targetUserName);
      } else {
        await upsertMemberResponse(eventId, r.slotId, targetUserName, r.response as AvailabilityResponse);
      }
    }

    // If the event creator has opted in to response notifications, send an email
    if (event.notifyCreatorOnResponse) {
      try {
        const { sendResponseNotificationEmail } = await import('@/lib/email/availability');
        await sendResponseNotificationEmail(event.eventId, targetUserName);
      } catch (emailError) {
        // Email failure must not block the 200 response — log and continue
        console.error(
          `[POST /api/availability/events/[eventId]/respond] Notification email failed for event ${eventId}:`,
          emailError
        );
      }
    }

    // Invalidate the diary cache for whoever the response belongs to — responding may
    // change nudge/confirmed items on their home page
    clearDiaryCache(targetUserName);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/availability/events/[eventId]/respond] Error:', error);
    return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 });
  }
}
