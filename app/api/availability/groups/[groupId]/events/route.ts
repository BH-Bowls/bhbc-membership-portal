// app/api/availability/groups/[groupId]/events/route.ts
// API endpoints for listing and creating events within an availability group

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getGroupById,
  getGroupMembers,
  isGroupMember,
} from '@/lib/availability-groups-sheets';
import {
  getGroupEvents,
  createEvent,
  addSlot,
  createInviteesFromGroupMembers,
} from '@/lib/availability-events-sheets';
import type { CreateEventPayload } from '@/types/availability';

// GET /api/availability/groups/[groupId]/events
// Returns all events for a group (newest first, non-archived)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    // Verify the user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await the dynamic route param
    const { groupId } = await params;

    // Fetch the group to check it exists
    const group = await getGroupById(groupId);
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = group.createdByUsername === userName;

    // Access check: must be member, creator, or Admin
    if (!isCreator && !isAdmin) {
      const memberStatus = await isGroupMember(groupId, userName);
      if (!memberStatus) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Fetch all group events with response metadata resolved for the caller
    const events = await getGroupEvents(groupId, userName);

    return NextResponse.json({ events });
  } catch (error) {
    console.error('[GET /api/availability/groups/[groupId]/events] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

// POST /api/availability/groups/[groupId]/events
// Create a new event within the group and invite all current group members
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    // Verify the user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await the dynamic route param
    const { groupId } = await params;

    // Fetch the group to check it exists and is active
    const group = await getGroupById(groupId);
    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // Group must be active to create events
    if (group.status === 'archived') {
      return NextResponse.json({ error: 'Cannot create events in an archived group' }, { status: 400 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = group.createdByUsername === userName;

    // Access check: any group member, creator, or Admin can create events
    if (!isCreator && !isAdmin) {
      const memberStatus = await isGroupMember(groupId, userName);
      if (!memberStatus) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Parse the request body
    const body: CreateEventPayload = await request.json();

    // Validate required fields
    if (!body.title || body.title.trim() === '') {
      return NextResponse.json({ error: 'Event title is required' }, { status: 400 });
    }

    if (!body.expiresAt) {
      return NextResponse.json({ error: 'Expiry date is required' }, { status: 400 });
    }

    // Validate expiresAt is a valid ISO string and is in the future
    const expiresDate = new Date(body.expiresAt);
    if (isNaN(expiresDate.getTime())) {
      return NextResponse.json({ error: 'Invalid expiry date format' }, { status: 400 });
    }
    if (expiresDate <= new Date()) {
      return NextResponse.json({ error: 'Expiry date must be in the future' }, { status: 400 });
    }

    // Validate event type
    const validTypes = ['general', 'fixture', 'signup'];
    if (!body.type || validTypes.indexOf(body.type) === -1) {
      return NextResponse.json({ error: 'Event type must be general, fixture, or signup' }, { status: 400 });
    }

    // Validate slots — at least one slot is required
    if (!body.slots || body.slots.length === 0) {
      return NextResponse.json({ error: 'At least one slot is required' }, { status: 400 });
    }

    // Validate each slot has a valid slotDatetime
    for (let i = 0; i < body.slots.length; i++) {
      const slot = body.slots[i];
      if (!slot.slotDatetime) {
        return NextResponse.json(
          { error: `Slot at index ${i} is missing a datetime` },
          { status: 400 }
        );
      }
      const slotDate = new Date(slot.slotDatetime);
      if (isNaN(slotDate.getTime())) {
        return NextResponse.json(
          { error: `Slot at index ${i} has an invalid datetime format` },
          { status: 400 }
        );
      }
    }

    // Step 1: Create the event record
    const eventId = await createEvent({
      title: body.title.trim(),
      description: body.description ? body.description.trim() : '',
      createdByUsername: userName,
      groupId: groupId,
      type: body.type,
      showResponsesToRespondents: body.showResponsesToRespondents === true,
      notifyCreatorOnResponse: body.notifyCreatorOnResponse === true,
      expiresAt: body.expiresAt,
    });

    // Step 2: Add all slots with 1-based display order
    for (let i = 0; i < body.slots.length; i++) {
      const slot = body.slots[i];
      await addSlot(eventId, slot.slotDatetime, slot.slotLabel || '', i + 1);
    }

    // Step 3: Fetch all group members to create invitee records
    const groupMembers = await getGroupMembers(groupId);

    // Step 4: Create invitee records — visitors get tokens, members do not
    const invitees = await createInviteesFromGroupMembers(eventId, body.expiresAt, groupMembers);

    // Step 5: Send invite emails to all group members
    if (invitees.length > 0) {
      try {
        const { sendEventInviteEmails } = await import('@/lib/email/availability');
        await sendEventInviteEmails(eventId, groupId, invitees, userName);
      } catch (emailError) {
        // Email failure must not block the event creation — log and continue
        console.error(
          `[POST /api/availability/groups/[groupId]/events] Invite email failed for event ${eventId}:`,
          emailError
        );
      }
    }

    return NextResponse.json({ success: true, eventId });
  } catch (error) {
    console.error('[POST /api/availability/groups/[groupId]/events] Error:', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
