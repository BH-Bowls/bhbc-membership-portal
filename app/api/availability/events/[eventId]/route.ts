// app/api/availability/events/[eventId]/route.ts
// API endpoints for reading, updating, and archiving a single availability event

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getEventById,
  getEventDetailForMember,
  updateEvent,
  archiveEvent,
} from '@/lib/availability-events-sheets';
import { isGroupMember } from '@/lib/availability-groups-sheets';

// GET /api/availability/events/[eventId]
// Returns full event detail for the member response page
export async function GET(
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

    // Fetch the event to check access
    const event = await getEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = event.createdByUsername === userName;

    // Access check depends on whether this is a group or public event
    if (event.groupId) {
      // Group event: must be group member, creator, or Admin
      if (!isCreator && !isAdmin) {
        const memberStatus = await isGroupMember(event.groupId, userName);
        if (!memberStatus) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    }
    // Public event (groupId blank): any authenticated member can view

    // Fetch full event detail with responses resolved for this caller
    const detail = await getEventDetailForMember(eventId, userName, userRole);
    if (!detail) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    console.error('[GET /api/availability/events/[eventId]] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch event' }, { status: 500 });
  }
}

// PUT /api/availability/events/[eventId]
// Update event fields (creator or Admin only)
export async function PUT(
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

    // Access check: only event creator or Admin can update
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Cannot update a concluded or archived event
    if (event.status === 'concluded' || event.status === 'archived') {
      return NextResponse.json(
        { error: 'Cannot update a concluded or archived event' },
        { status: 400 }
      );
    }

    // Parse the update body
    const body = await request.json();

    // Build update object — only include fields that were provided
    const updates: {
      title?: string;
      description?: string;
      type?: 'general' | 'fixture' | 'signup';
      showResponsesToRespondents?: boolean;
      notifyCreatorOnResponse?: boolean;
      expiresAt?: string;
      status?: 'open' | 'closed' | 'concluded' | 'archived';
    } = {};

    if (body.title !== undefined) {
      if (!body.title || body.title.trim() === '') {
        return NextResponse.json({ error: 'Event title cannot be empty' }, { status: 400 });
      }
      updates.title = body.title.trim();
    }

    if (body.description !== undefined) {
      updates.description = body.description;
    }

    if (body.type !== undefined) {
      const validTypes = ['general', 'fixture', 'signup'];
      if (validTypes.indexOf(body.type) === -1) {
        return NextResponse.json({ error: 'Invalid event type' }, { status: 400 });
      }
      updates.type = body.type;
    }

    if (body.showResponsesToRespondents !== undefined) {
      updates.showResponsesToRespondents = body.showResponsesToRespondents === true;
    }

    if (body.notifyCreatorOnResponse !== undefined) {
      updates.notifyCreatorOnResponse = body.notifyCreatorOnResponse === true;
    }

    if (body.expiresAt !== undefined) {
      const expiresDate = new Date(body.expiresAt);
      if (isNaN(expiresDate.getTime())) {
        return NextResponse.json({ error: 'Invalid expiry date format' }, { status: 400 });
      }
      updates.expiresAt = body.expiresAt;
    }

    if (body.status !== undefined) {
      const validStatuses = ['open', 'closed', 'concluded', 'archived'];
      if (validStatuses.indexOf(body.status) === -1) {
        return NextResponse.json({ error: 'Invalid event status' }, { status: 400 });
      }
      updates.status = body.status;
    }

    // Apply the updates to the event record
    await updateEvent(eventId, updates);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PUT /api/availability/events/[eventId]] Error:', error);
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}

// DELETE /api/availability/events/[eventId]
// Archive (soft-delete) an event
export async function DELETE(
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

    // Access check: only event creator or Admin can archive
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Archive the event (soft-delete — sets status to 'archived')
    await archiveEvent(eventId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/availability/events/[eventId]] Error:', error);
    return NextResponse.json({ error: 'Failed to archive event' }, { status: 500 });
  }
}
