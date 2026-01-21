// app/api/social-events/event/[tabDate]/route.ts
// API endpoint to fetch a single social event with attendees

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSocialEventByTabDate, getSocialEventAttendees } from '@/lib/social-events-sheets';

// GET handler - Returns event details with attendees
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tabDate: string }> }
) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tabDate } = await params;

    // Fetch event details
    const event = await getSocialEventByTabDate(tabDate);

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Fetch attendees for this event
    const attendees = await getSocialEventAttendees(event.tabName);

    return NextResponse.json({ event, attendees });
  } catch (error) {
    console.error('[Social Events API] Error fetching event:', error);
    return NextResponse.json(
      { error: 'Failed to fetch event' },
      { status: 500 }
    );
  }
}
