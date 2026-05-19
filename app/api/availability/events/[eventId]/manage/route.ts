// app/api/availability/events/[eventId]/manage/route.ts
// API endpoint for the event management page — returns full response detail to the creator

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getEventById, getEventManageDetail } from '@/lib/availability-events-sheets';

// GET /api/availability/events/[eventId]/manage
// Returns full manage detail (all responses, invitees, summary counts)
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

    // Fetch the event to perform access check
    const event = await getEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = event.createdByUsername === userName;

    // Access check: only event creator or Admin can view manage detail
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch full manage detail — always includes all responses regardless of settings
    const detail = await getEventManageDetail(eventId);
    if (!detail) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    console.error('[GET /api/availability/events/[eventId]/manage] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch manage detail' }, { status: 500 });
  }
}
