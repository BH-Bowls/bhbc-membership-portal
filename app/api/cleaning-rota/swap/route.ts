// app/api/cleaning-rota/swap/route.ts
// API route for swapping cleaning duty assignments

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { swapCleaningAssignment, getCleaningRotaEntry } from '@/lib/cleaning-sheets';
import { getUserByUsername } from '@/lib/sheets';
import { sendTemplateEmail } from '@/lib/email/mailer';
import { CleaningPosition } from '@/lib/types/cleaning';

interface SwapRequest {
  rowNumber: number;
  position: CleaningPosition;
  newUsername: string;
  targetRowNumber?: number;
  targetPosition?: CleaningPosition;
}

/**
 * POST /api/cleaning-rota/swap
 * Swaps a cleaning duty assignment with another member
 * Sends email notification to the new assignee
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: SwapRequest = await request.json();
    const { rowNumber, position, newUsername, targetRowNumber, targetPosition } = body;

    if (!rowNumber || !position || !newUsername) {
      return NextResponse.json(
        { error: 'Missing required fields: rowNumber, position, newUsername' },
        { status: 400 }
      );
    }

    // Validate position
    if (!['lead', 'second', 'third', 'fourth'].includes(position)) {
      return NextResponse.json(
        { error: 'Invalid position. Must be lead, second, third, or fourth' },
        { status: 400 }
      );
    }

    // Get the current cleaning rota entry to verify the current user is assigned
    const currentEntry = await getCleaningRotaEntry(rowNumber);
    if (!currentEntry) {
      return NextResponse.json(
        { error: 'Cleaning rota entry not found' },
        { status: 404 }
      );
    }

    // Check if the current user is assigned to this position
    const currentUsername = session.user.userName;
    const currentAssigned = currentEntry[position];

    if (currentAssigned !== currentUsername) {
      return NextResponse.json(
        { error: 'You can only swap your own cleaning duty assignments' },
        { status: 403 }
      );
    }

    // Get the target entry details before the swap (if recipient had an assignment)
    let targetEntry = null;
    if (targetRowNumber) {
      targetEntry = await getCleaningRotaEntry(targetRowNumber);
    }

    // Perform the swap
    const updatedEntry = await swapCleaningAssignment(
      rowNumber,
      position,
      currentUsername,
      newUsername,
      targetRowNumber,
      targetPosition
    );

    // Get user details for email notification
    const newUser = await getUserByUsername(newUsername);
    const currentUser = await getUserByUsername(currentUsername);

    // Send email notification to the new assignee
    if (newUser?.emailAddress) {
      const positionNames: Record<CleaningPosition, string> = {
        lead: 'Lead',
        second: 'Second',
        third: 'Third',
        fourth: 'Fourth',
      };

      // Build email template data
      const emailData: Record<string, string> = {
        recipientName: newUser.fullKnownAs || newUser.fullName,
        senderName: currentUser?.fullName || currentUsername,
        // New assignment (what they're taking on)
        toPosition: positionNames[position],
        toDate: currentEntry.displayDate,
        // Previous assignment (what they're giving up)
        hasFromAssignment: targetEntry ? 'true' : '',
        fromPosition: targetPosition ? positionNames[targetPosition] : '',
        fromDate: targetEntry?.displayDate || '',
      };

      await sendTemplateEmail(
        newUser.emailAddress,
        `Cleaning Duty Swap - ${currentEntry.displayDate}`,
        'cleaning-duty-swap',
        emailData
      );
    }

    return NextResponse.json({
      success: true,
      entry: updatedEntry,
      emailSent: !!newUser?.emailAddress,
    });
  } catch (error) {
    console.error('[POST /api/cleaning-rota/swap] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to swap cleaning duty' },
      { status: 500 }
    );
  }
}
