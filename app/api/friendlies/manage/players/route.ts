// app/api/friendlies/manage/players/route.ts
// API endpoint to get list of all players from Players sheet for captain team selection

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAllPlayers } from '@/lib/friendlies-sheets';

// GET handler - Returns sorted list of all players for dropdown selection
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can access player list
    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch all players from Players sheet (sorted by full name)
    const players = await getAllPlayers();

    // Return success response with player list
    return NextResponse.json({
      success: true,
      players,
    });
  } catch (error) {
    // Log error and return 500 response
    console.error('Error in get players route:', error);
    return NextResponse.json(
      { error: 'Failed to get players' },
      { status: 500 }
    );
  }
}
