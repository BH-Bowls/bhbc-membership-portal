// app/api/availability/[eventId]/route.ts
// API endpoints for getting, updating, and archiving a single availability event

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getAvailabilityEventById,
  getEventDetailForMember,
  updateAvailabilityEvent,
  archiveAvailabilityEvent,
  isMemberInvited,
} from '@/lib/availability-sheets';
import { hasRole } from '@/lib/role-utils';

// GET /api/availability/[eventId]
// Returns full event detail for the member response page
export async function GET(
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

    // Fetch the event to check access
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

    // Fetch full detail including responses
    const detail = await getEventDetailForMember(eventId, session.user.userName);
    if (!detail) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    console.error('[GET /api/availability/[eventId]] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch event' }, { status: 500 });
  }
}

// PUT /api/availability/[eventId]
// Update event fields (title, description, expiry, visibility settings, status)
export async function PUT(
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

    // Fetch event to verify access
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Only creator or Admin can update
    const isCreator = event.createdByUsername === session.user.userName;
    const isAdmin = hasRole(session.user.role, 'Admin');
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Cannot edit concluded or archived events
    if (event.status === 'concluded' || event.status === 'archived') {
      return NextResponse.json(
        { error: 'Event cannot be edited in its current status' },
        { status: 400 }
      );
    }

    // Parse updates from body
    const body = await request.json();
    const updates: any = {};

    // Only include valid updatable fields
    if (body.title !== undefined) {
      updates.title = body.title;
    }
    if (body.description !== undefined) {
      updates.description = body.description;
    }
    if (body.showResponsesToRespondents !== undefined) {
      updates.showResponsesToRespondents = body.showResponsesToRespondents;
    }
    if (body.notifyCreatorOnResponse !== undefined) {
      updates.notifyCreatorOnResponse = body.notifyCreatorOnResponse;
    }
    if (body.expiresAt !== undefined) {
      updates.expiresAt = body.expiresAt;
    }
    if (body.status !== undefined) {
      updates.status = body.status;
    }

    // Apply updates to the sheet
    await updateAvailabilityEvent(eventId, updates);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PUT /api/availability/[eventId]] Error:', error);
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}

// DELETE /api/availability/[eventId]
// Archive (soft-delete) the event
export async function DELETE(
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

    // Fetch event to verify access
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Only creator or Admin can archive
    const isCreator = event.createdByUsername === session.user.userName;
    const isAdmin = hasRole(session.user.role, 'Admin');
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Archive the event
    await archiveAvailabilityEvent(eventId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/availability/[eventId]] Error:', error);
    return NextResponse.json({ error: 'Failed to archive event' }, { status: 500 });
  }
}
