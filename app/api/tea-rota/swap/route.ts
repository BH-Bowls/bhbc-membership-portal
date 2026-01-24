// app/api/tea-rota/swap/route.ts
// API route for swapping tea duty assignments
// Members can swap their own tea duties with another member

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { swapTeaAssignment, getTeaRotaEntry } from '@/lib/friendlies-sheets';
import { getUserByUsername } from '@/lib/sheets';
import { sendTemplateEmail } from '@/lib/email/mailer';

interface SwapRequest {
  rowNumber: number;
  position: 'teaLead' | 'teaFirst' | 'teaSecond';
  newUsername: string;
  // Target assignment (the other user's assignment to swap with)
  targetRowNumber?: number;
  targetPosition?: 'teaLead' | 'teaFirst' | 'teaSecond';
}

/**
 * POST /api/tea-rota/swap
 * Swaps a tea duty assignment with another member
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
    if (!['teaLead', 'teaFirst', 'teaSecond'].includes(position)) {
      return NextResponse.json(
        { error: 'Invalid position. Must be teaLead, teaFirst, or teaSecond' },
        { status: 400 }
      );
    }

    // Get the current tea rota entry to verify the current user is assigned
    const currentEntry = await getTeaRotaEntry(rowNumber);
    if (!currentEntry) {
      return NextResponse.json(
        { error: 'Tea rota entry not found' },
        { status: 404 }
      );
    }

    // Check if the current user is assigned to this position
    const currentUsername = session.user.userName;
    const currentAssigned = currentEntry[position];

    if (currentAssigned !== currentUsername) {
      return NextResponse.json(
        { error: 'You can only swap your own tea duty assignments' },
        { status: 403 }
      );
    }

    // Get the target entry details before the swap (if recipient had an assignment)
    let targetEntry = null;
    if (targetRowNumber) {
      targetEntry = await getTeaRotaEntry(targetRowNumber);
    }

    // Perform the swap
    const updatedEntry = await swapTeaAssignment(
      rowNumber,
      position,
      currentUsername,
      newUsername,
      targetRowNumber,
      targetPosition
    );

    // Get the new assignee's details for email notification
    const newUser = await getUserByUsername(newUsername);
    const currentUser = await getUserByUsername(currentUsername);

    // Send email notification to the new assignee
    if (newUser?.emailAddress) {
      const positionNames: Record<string, string> = {
        teaLead: 'Tea Lead',
        teaFirst: 'Tea First',
        teaSecond: 'Tea Second',
      };

      // Build email template data
      // Note: Handlebars treats empty strings as falsy, so we use '' for false
      const emailData: Record<string, string> = {
        recipientName: newUser.fullKnownAs || newUser.fullName,
        senderName: currentUser?.fullName || currentUsername,
        // New assignment (what they're taking on - was the sender's)
        toPosition: positionNames[position],
        toGameDate: currentEntry.displayDate,
        toGameTime: currentEntry.time,
        toOpponent: currentEntry.clubName,
        toFormat: currentEntry.format,
        // Previous assignment (what they're giving up) - empty string if no previous assignment
        hasFromAssignment: targetEntry ? 'true' : '',
        fromPosition: targetPosition ? positionNames[targetPosition] : '',
        fromGameDate: targetEntry?.displayDate || '',
        fromGameTime: targetEntry?.time || '',
        fromOpponent: targetEntry?.clubName || '',
        fromFormat: targetEntry?.format || '',
      };

      await sendTemplateEmail(
        newUser.emailAddress,
        `Tea Duty Swap - ${currentEntry.displayDate}`,
        'tea-duty-swap',
        emailData
      );
    }

    return NextResponse.json({
      success: true,
      entry: updatedEntry,
      emailSent: !!newUser?.emailAddress,
    });
  } catch (error) {
    console.error('[POST /api/tea-rota/swap] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to swap tea duty' },
      { status: 500 }
    );
  }
}
