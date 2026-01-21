// app/api/social-events/remove-player/route.ts
// API endpoint to remove manually added attendees (M status) from a social event

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getSocialEvents,
  updatePlayerEntry,
  getPlayerEntryStatus,
  getEnteredPlayers,
  updateEventCounts,
} from '@/lib/social-events-sheets';

// POST handler - Remove a manually added attendee from a social event
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body - gameId is the tabName for consistency with modal
    const { gameId, playerUserName } = await request.json();

    if (!gameId || !playerUserName) {
      return NextResponse.json(
        { error: 'gameId and playerUserName are required' },
        { status: 400 }
      );
    }

    // Fetch all events and find by tabName
    const allEvents = await getSocialEvents();
    const event = allEvents.find(e => e.tabName === gameId);

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Check if event is still open for changes
    if (event.status !== 'O') {
      return NextResponse.json(
        { error: 'Can only remove attendees from open events' },
        { status: 400 }
      );
    }

    // Check attendee's current status
    const playerStatus = await getPlayerEntryStatus(playerUserName, event.tabName);

    // Only allow removing manually added attendees (M status)
    if (playerStatus !== 'M') {
      return NextResponse.json(
        { error: 'Can only remove manually added attendees' },
        { status: 403 }
      );
    }

    // Remove the attendee by clearing their entry status
    await updatePlayerEntry(playerUserName, event.tabName, '');

    // Update the entered count in Events sheet
    try {
      const enteredPlayers = await getEnteredPlayers(event.tabName);
      await updateEventCounts(event.tabName, { entered: enteredPlayers.length });
    } catch (countError) {
      console.error('[Social Events API] Error updating entered count:', countError);
      // Don't fail the request, attendee was removed successfully
    }

    return NextResponse.json({
      success: true,
      removed_player: playerUserName,
    });
  } catch (error) {
    console.error('[Social Events API] Error removing attendee:', error);
    return NextResponse.json(
      { error: 'Failed to remove attendee' },
      { status: 500 }
    );
  }
}
