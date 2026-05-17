// app/api/availability/[eventId]/manage/route.ts
// API endpoint for the event management page — full response grid and admin detail

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getAvailabilityEventById,
  getEventManageDetail,
} from '@/lib/availability-sheets';
import { hasRole } from '@/lib/role-utils';

// GET /api/availability/[eventId]/manage
// Returns full event manage detail including all responses and invitee list
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { eventId } = await params;

    // Fetch event for access check
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Only creator or Admin can access the manage view
    const isCreator = event.createdByUsername === session.user.userName;
    const isAdmin = hasRole(session.user.role, 'Admin');
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch full manage detail
    const detail = await getEventManageDetail(eventId);
    if (!detail) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    console.error('[GET /api/availability/[eventId]/manage] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch manage detail' }, { status: 500 });
  }
}
