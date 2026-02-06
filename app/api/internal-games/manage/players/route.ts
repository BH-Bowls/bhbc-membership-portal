// app/api/internal-games/manage/players/route.ts
// API endpoint to get list of playing members for internal game player selection

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getInternalGameMembers } from '@/lib/internal-games-sheets';

// GET handler - Returns sorted list of playing members for dropdown selection
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // All authenticated users can access member list (for adding players to games)

    // Fetch all members
    const allMembers = await getInternalGameMembers();

    // Filter to only playing members (PL=Playing Lady, PM=Playing Man)
    const playingMembers = allMembers.filter(member => {
      if (!member.memberType) return true; // Include if no member type specified
      return member.memberType.startsWith('P') || member.memberType === 'Full';
    });

    // Return success response with player list
    return NextResponse.json({
      success: true,
      players: playingMembers,
    });
  } catch (error) {
    // Log error and return 500 response
    console.error('Error in get internal game members route:', error);
    return NextResponse.json(
      { error: 'Failed to get members' },
      { status: 500 }
    );
  }
}
