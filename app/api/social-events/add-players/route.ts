// app/api/social-events/add-players/route.ts
// API endpoint to manually add attendees to a social event with 'M' status

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getSocialEvents,
  updatePlayerEntry,
  getEnteredPlayers,
  updateEventCounts,
} from '@/lib/social-events-sheets';
import { hasRole } from '@/lib/role-utils';

// POST handler - Manually add attendees to a social event
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body - gameId is the tabName for consistency with modal
    const { gameId, playerUserNames } = await request.json();

    if (!gameId || !Array.isArray(playerUserNames) || playerUserNames.length === 0) {
      return NextResponse.json(
        { error: 'gameId and playerUserNames array are required' },
        { status: 400 }
      );
    }

    // Fetch all events and find by tabName
    const allEvents = await getSocialEvents();
    const event = allEvents.find(e => e.tabName === gameId);

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Check if event is open for entries
    if (event.status !== 'O') {
      return NextResponse.json(
        { error: 'Can only add attendees to open events' },
        { status: 400 }
      );
    }

    // Check capacity restrictions (regular users only)
    const isUnrestricted = hasRole(session.user.role, 'Captain', 'Admin');

    if (!isUnrestricted) {
      const maxCapacity = event.maxPlayers || 0;
      if (maxCapacity > 0) {
        const enteredPlayers = await getEnteredPlayers(event.tabName);
        const currentCount = enteredPlayers.length;
        const newCount = currentCount + playerUserNames.length;

        if (newCount > maxCapacity) {
          return NextResponse.json(
            {
              error: `Cannot add ${playerUserNames.length} attendee(s). Event capacity: ${maxCapacity}, current: ${currentCount}`,
            },
            { status: 400 }
          );
        }
      }
    }

    // Add all attendees with 'M' status
    for (const userName of playerUserNames) {
      await updatePlayerEntry(userName, event.tabName, 'M');
    }

    // Update the entered count in Events sheet
    try {
      const enteredPlayers = await getEnteredPlayers(event.tabName);
      await updateEventCounts(event.tabName, { entered: enteredPlayers.length });
    } catch (countError) {
      console.error('[Social Events API] Error updating entered count:', countError);
      // Don't fail the request, attendees were added successfully
    }

    return NextResponse.json({
      success: true,
      added_count: playerUserNames.length,
    });
  } catch (error) {
    console.error('[Social Events API] Error adding attendees:', error);
    return NextResponse.json(
      { error: 'Failed to add attendees' },
      { status: 500 }
    );
  }
}
