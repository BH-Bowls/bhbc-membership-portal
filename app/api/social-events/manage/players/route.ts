// app/api/social-events/manage/players/route.ts
// API endpoint to get list of all members for social event attendee selection

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSocialEventMembers } from '@/lib/social-events-sheets';
import { hasRole } from '@/lib/role-utils';

// GET handler - Returns sorted list of all members for dropdown selection
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can access member list
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch all members (social events include all member types)
    const players = await getSocialEventMembers();

    // Return success response with player list
    return NextResponse.json({
      success: true,
      players,
    });
  } catch (error) {
    // Log error and return 500 response
    console.error('Error in get social event members route:', error);
    return NextResponse.json(
      { error: 'Failed to get members' },
      { status: 500 }
    );
  }
}
