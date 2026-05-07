// app/api/social-events/enter/route.ts
// API endpoint for members to enter one or more social events
// Updates Members sheet with 'E' status and recalculates entered counts in Events sheet

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSocialEvents, updatePlayerEntry, updateEventCounts } from '@/lib/social-events-sheets';
import { SocialEventsConfig, getSpreadsheetId } from '@/lib/game-management/config';
import { getGoogleSheetsClient } from '@/lib/sheets';
import { canEnterGame } from '@/lib/game-management/capacity';

interface EnterEventsRequest {
  event_ids: string[];
}

interface EnterEventResult {
  event_id: string;
  entered: boolean;
  error?: string;
}

interface EnterEventsResponse {
  success: boolean;
  results: EnterEventResult[];
}

// POST handler - Enters user into one or more events
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: EnterEventsRequest = await request.json();
    const { event_ids } = body;

    // Validate event_ids is a non-empty array
    if (!Array.isArray(event_ids) || event_ids.length === 0) {
      return NextResponse.json(
        { error: 'Invalid event_ids' },
        { status: 400 }
      );
    }

    // Get current user's username
    const userName = session.user.userName;

    // Fetch all events to verify each event exists and is open
    const allEvents = await getSocialEvents();

    // Initialize results array
    const results: EnterEventResult[] = [];

    // Process each event entry request
    for (const tabName of event_ids) {
      try {
        // Find the event in our events list
        const event = allEvents.find(e => e.tabName === tabName);

        // Skip if event doesn't exist
        if (!event) {
          results.push({ event_id: tabName, entered: false, error: 'Event not found' });
          continue;
        }

        // Only allow entry if event status is 'O' (Open)
        if (event.status !== 'O') {
          results.push({ event_id: tabName, entered: false, error: 'Event not open for entry' });
          continue;
        }

        // Check capacity limits (if maxPlayers is set)
        // Social events can have waitlist functionality
        if (event.maxPlayers && event.maxPlayers > 0) {
          const capacityCheck = canEnterGame(event, true); // Social events allow waitlist
          if (!capacityCheck.canEnter) {
            results.push({
              event_id: tabName,
              entered: false,
              error: capacityCheck.reason || 'Cannot enter event'
            });
            continue;
          }
        }

        // Update this user's entry in Members sheet to 'E' (Entered)
        try {
          await updatePlayerEntry(userName, event.tabName, 'E');
          results.push({ event_id: tabName, entered: true });
        } catch (updateError: any) {
          results.push({
            event_id: tabName,
            entered: false,
            error: updateError.message || 'Update failed'
          });
        }
      } catch (error) {
        results.push({ event_id: tabName, entered: false, error: 'Processing failed' });
      }
    }

    // Update entered counts in Events sheet for successfully entered events
    const successfulEntries = results.filter(r => r.entered);

    if (successfulEntries.length > 0) {
      const sheets = getGoogleSheetsClient();
      const spreadsheetId = getSpreadsheetId(SocialEventsConfig);

      // Fetch all Members sheet data once for efficiency
      const membersResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SocialEventsConfig.membersSheetName}!A:ZZ`,
      });

      const rows = membersResponse.data.values || [];
      const headers = rows[0] || [];

      // Compute all counts first (CPU-only, no I/O), then write in parallel
      const countUpdates: { event_id: string; count: number }[] = [];
      for (const result of successfulEntries) {
        const event = allEvents.find(e => e.tabName === result.event_id);
        if (!event) continue;
        const eventColIndex = headers.indexOf(event.tabName);
        if (eventColIndex === -1) continue;
        let enteredCount = 0;
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][eventColIndex]) enteredCount++;
        }
        countUpdates.push({ event_id: result.event_id, count: enteredCount });
      }

      await Promise.all(
        countUpdates.map(({ event_id, count }) => updateEventCounts(event_id, { entered: count }))
      );
    }

    // Return success response with results for each event
    const response: EnterEventsResponse = { success: true, results };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error entering events:', error);
    return NextResponse.json(
      { error: 'Failed to enter events' },
      { status: 500 }
    );
  }
}
