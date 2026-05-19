// app/api/availability/events/route.ts
// API endpoints for listing and creating public availability events

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getPublicEvents, createEvent, addSlot } from '@/lib/availability-events-sheets';
import type { CreateEventPayload } from '@/types/availability';

// GET /api/availability/events
// Returns all public events (group_id blank) visible to the caller
export async function GET(request: NextRequest) {
  try {
    // Verify the user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all public events, resolving hasResponded for this user
    const events = await getPublicEvents(session.user.userName);

    return NextResponse.json({ events });
  } catch (error) {
    console.error('[GET /api/availability/events] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

// POST /api/availability/events
// Create a new public event (no group — all members can see and respond)
export async function POST(request: NextRequest) {
  try {
    // Verify the user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    // Step 1: Create the public event record (groupId = '' for public events)
    const eventId = await createEvent({
      title: body.title.trim(),
      description: body.description ? body.description.trim() : '',
      createdByUsername: session.user.userName,
      groupId: '',
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

    // No invitees or emails for public events — all members see it automatically

    return NextResponse.json({ success: true, eventId });
  } catch (error) {
    console.error('[POST /api/availability/events] Error:', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
