// app/api/availability/groups/[groupId]/events/route.ts
// API endpoints for listing and creating events within an availability group

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getGroupById,
  isGroupMember,
  ensureGroupMemberTokens,
} from '@/lib/availability-groups-sheets';
import {
  getGroupEvents,
  createEvent,
  addSlots,
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

    // Date-finder ("find best date") mode renders the date×time matrix + ranked results.
    // It always uses datetime slots.
    const isMatchFinder = body.matchFinder === true;

    // Match-finder forces datetime slots; otherwise honour the requested slot type
    const pollSlotType = isMatchFinder ? 'datetime' : (body.slotType === 'text' ? 'text' : 'datetime');

    // Validate slots — at least one slot is required
    if (!body.slots || body.slots.length === 0) {
      return NextResponse.json({ error: 'At least one option is required' }, { status: 400 });
    }

    // Validate each slot per its type
    for (let i = 0; i < body.slots.length; i++) {
      const slot = body.slots[i];
      if (pollSlotType === 'datetime') {
        if (!slot.slotDatetime) {
          return NextResponse.json(
            { error: `Option at index ${i} is missing a datetime` },
            { status: 400 }
          );
        }
        const slotDate = new Date(slot.slotDatetime);
        if (isNaN(slotDate.getTime())) {
          return NextResponse.json(
            { error: `Option at index ${i} has an invalid datetime format` },
            { status: 400 }
          );
        }
      } else {
        if (!slot.slotLabel || !slot.slotLabel.trim()) {
          return NextResponse.json(
            { error: `Option at index ${i} is missing text` },
            { status: 400 }
          );
        }
      }
    }

    // Step 1: Create the event record.
    // Match-finder events store the matchFinder flag so the response page renders the
    // date×time matrix and the ranked results panel.
    const eventId = await createEvent({
      title: body.title.trim(),
      description: body.description ? body.description.trim() : '',
      createdByUsername: userName,
      groupId: groupId,
      type: body.type,
      slotType: pollSlotType,
      showResponsesToRespondents: body.showResponsesToRespondents === true,
      notifyCreatorOnResponse: body.notifyCreatorOnResponse === true,
      expiresAt: body.expiresAt,
      matchFinder: isMatchFinder,
    });

    // Step 2: Add all slots in a single batched write (1-based display order)
    const slotsToAdd = body.slots.map((slot, i) => ({
      slotDatetime: slot.slotDatetime || null,
      slotLabel: slot.slotLabel || '',
      displayOrder: i + 1,
    }));
    await addSlots(eventId, slotsToAdd);

    // Step 3: Send invite emails. There is no invitee sheet — the group members ARE the
    // roster, each carrying a per-member response token (ensured here). The organiser can opt
    // out of sending, target a subset of members, and add a message (like /friendlies publish).
    const b = body as CreateEventPayload & {
      sendEmail?: boolean;
      emailMessage?: string;
      emailRecipientUsernames?: string[];
    };
    const sendEmailNow = b.sendEmail !== false; // default true
    const emailMessage = typeof b.emailMessage === 'string' ? b.emailMessage.trim() : '';
    const recipientUsernames: string[] = Array.isArray(b.emailRecipientUsernames)
      ? b.emailRecipientUsernames.filter((u) => typeof u === 'string' && u)
      : [];

    let emailsSent = 0;
    if (sendEmailNow) {
      // Ensure every member has a token, then filter to the chosen recipients. Visitors are
      // always emailed; a member subset can be selected.
      const membersWithTokens = await ensureGroupMemberTokens(groupId);
      let recipients = membersWithTokens;
      if (recipientUsernames.length > 0) {
        const recipientSet = new Set(recipientUsernames);
        recipients = membersWithTokens.filter((m) =>
          m.memberType === 'visitor' || (m.userName !== '' && recipientSet.has(m.userName))
        );
      }

      if (recipients.length > 0) {
        try {
          const { sendEventInviteEmails } = await import('@/lib/email/availability');
          emailsSent = await sendEventInviteEmails(eventId, groupId, recipients, userName, { customMessage: emailMessage });
        } catch (emailError) {
          // Email failure must not block the event creation — log and continue
          console.error(
            `[POST /api/availability/groups/[groupId]/events] Invite email failed for event ${eventId}:`,
            emailError
          );
        }
      }
    }

    // emailAttempted tells the client whether we tried to send (so "0 sent" can be
    // distinguished from "you chose not to send now").
    return NextResponse.json({
      success: true,
      eventId,
      emailsSent,
      emailAttempted: sendEmailNow,
    });
  } catch (error) {
    console.error('[POST /api/availability/groups/[groupId]/events] Error:', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
