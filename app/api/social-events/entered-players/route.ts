// app/api/social-events/entered-players/route.ts
// API endpoint to get list of attendees who have entered a social event

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getEnteredPlayers } from '@/lib/social-events-sheets';

// GET handler - Returns list of entered attendees with their status
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get eventId from query params
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');

    if (!eventId) {
      return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
    }

    // Fetch entered attendees
    const players = await getEnteredPlayers(eventId);

    return NextResponse.json({ success: true, players });
  } catch (error) {
    console.error('[Social Events API] Error fetching entered players:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entered players' },
      { status: 500 }
    );
  }
}
