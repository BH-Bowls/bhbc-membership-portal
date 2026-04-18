// app/api/social-events/manage/status/route.ts
// API endpoint for admins to change social event status through the lifecycle
// Status flow: blank → O (Open) → X (Closed) → A (Completed)
// Alternative endings: C (Cancelled)
// Note: Social events use simple attendance (Y/N/M/W) instead of team selection

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getSocialEvents,
  updateEventStatus,
  createEventColumn,
} from '@/lib/social-events-sheets';
import type { GameStatus } from '@/lib/game-management/types';
import { hasRole } from '@/lib/role-utils';

interface ChangeStatusRequest {
  tab_name?: string;
  row_number?: number;
  action: 'open' | 'close' | 'complete' | 'cancel';
  reason?: string;
  who?: string;
}

interface ChangeStatusResponse {
  success: boolean;
  new_status: GameStatus;
}

// POST handler - Changes event status with validation
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can change event status
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body
    const body: ChangeStatusRequest = await request.json();
    const { tab_name, row_number, action, reason, who } = body;

    // Fetch all events from Events sheet
    const events = await getSocialEvents();

    // Search for the event by tabName or rowNumber
    let event = null;

    // First try to find by tabName if provided
    if (tab_name && tab_name.trim() !== '') {
      event = events.find(e => e.tabName === tab_name) || null;
    }

    // If not found and rowNumber provided, find by rowNumber
    if (!event && row_number) {
      event = events.find(e => e._rowNumber === row_number) || null;
    }

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Generate effectiveTabName
    // Format: "EventName DD MMM YY" (e.g., "Quiz Night 13 Jan 25")
    let tabDatePart = event.tabDate || '';

    if (!tabDatePart || tabDatePart.trim() === '') {
      // Parse date from DD/MM/YYYY format
      const formatTabDate = (dateStr: string): string => {
        if (!dateStr) return '';

        const parts = dateStr.split('/');
        if (parts.length === 3) {
          const day = parts[0].padStart(2, '0');
          const month = parts[1];
          let year = parts[2];
          if (year.length === 4) {
            year = year.slice(-2);
          }
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const monthIndex = parseInt(month, 10) - 1;
          const monthName = monthNames[monthIndex] || month;
          return `${day} ${monthName} ${year}`;
        }

        return '';
      };

      tabDatePart = formatTabDate(event.date);
    }

    const effectiveTabName = `${event.eventName} ${tabDatePart}`.trim();

    // Get current status
    let currentStatus = event.status;
    if (!currentStatus) {
      currentStatus = '';
    }

    // Track new status
    let newStatus: GameStatus = currentStatus;

    // Handle status transitions
    switch (action) {
      case 'open':
        if (currentStatus !== '') {
          return NextResponse.json(
            { error: 'Can only open events with blank status' },
            { status: 400 }
          );
        }
        newStatus = 'O';
        await createEventColumn(effectiveTabName);
        break;

      case 'close':
        if (currentStatus !== 'O') {
          return NextResponse.json(
            { error: 'Can only close events with Open status' },
            { status: 400 }
          );
        }
        newStatus = 'X';
        break;

      case 'complete':
        if (currentStatus !== 'X') {
          return NextResponse.json(
            { error: 'Can only complete Closed events' },
            { status: 400 }
          );
        }
        newStatus = 'A';
        break;

      case 'cancel':
        if (!reason || !who) {
          return NextResponse.json(
            { error: 'Reason and who required for cancelled status' },
            { status: 400 }
          );
        }
        newStatus = 'C';
        break;

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Update the event status
    await updateEventStatus(effectiveTabName, newStatus, {
      reason,
      who,
      modifiedBy: session.user.userName,
      rowNumber: event._rowNumber,
    });

    const response: ChangeStatusResponse = {
      success: true,
      new_status: newStatus,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error updating event status:', error);
    return NextResponse.json(
      { error: 'Failed to update event status' },
      { status: 500 }
    );
  }
}
