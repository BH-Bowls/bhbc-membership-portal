// app/api/sweeping-rota/[date]/route.ts
// API route for canceling a sweeping rota entry

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { removeSweepingAssignment, getSweepingRotaEntry } from '@/lib/sweeping-sheets';
import { parseDate } from '@/lib/sweeping-patterns';

interface RouteContext {
  params: Promise<{ date: string }>;
}

/**
 * DELETE /api/sweeping-rota/[date]
 * Cancel a sweeping assignment for a specific date
 * User can only delete own entries (or admin any)
 * Cannot delete past entries
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { date } = await context.params;

    // Decode the date parameter (it may be URL encoded)
    const decodedDate = decodeURIComponent(date);

    // Validate date format (DD/MM/YYYY)
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(decodedDate)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use DD/MM/YYYY' },
        { status: 400 }
      );
    }

    // Check if date is in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const entryDate = parseDate(decodedDate);

    if (entryDate < today) {
      return NextResponse.json(
        { error: 'Cannot cancel past entries' },
        { status: 400 }
      );
    }

    // Non-members can cancel any assignment
    const isNonMember = session.user.role !== 'Member';

    const result = await removeSweepingAssignment(
      decodedDate,
      session.user.userName,
      isNonMember
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.reason || 'Failed to cancel assignment' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/sweeping-rota/[date]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to cancel sweeping assignment' },
      { status: 500 }
    );
  }
}
