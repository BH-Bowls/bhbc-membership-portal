// app/api/internal-games/manage/update-player/route.ts
// API endpoint to update a single player's selection in an internal game

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { updateInternalGamePlayer } from '@/lib/internal-games-sheets';

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can update selections
    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body
    const { tabName, rowNumber, updates } = await request.json();

    if (!tabName || !rowNumber) {
      return NextResponse.json(
        { error: 'tabName and rowNumber are required' },
        { status: 400 }
      );
    }

    // Update the player
    const result = await updateInternalGamePlayer(tabName, rowNumber, updates);

    if (result.success) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { error: result.error || 'Failed to update player' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[Internal Games API] Error updating player:', error);
    return NextResponse.json(
      { error: 'Failed to update player' },
      { status: 500 }
    );
  }
}
