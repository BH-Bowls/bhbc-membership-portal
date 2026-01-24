// app/api/social-events/events/route.ts
// API endpoint to fetch all social events

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSocialEvents } from '@/lib/social-events-sheets';

// GET handler - Returns list of social events
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all social events
    const events = await getSocialEvents();

    return NextResponse.json({ events });
  } catch (error) {
    console.error('[Social Events API] Error fetching events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch events' },
      { status: 500 }
    );
  }
}
