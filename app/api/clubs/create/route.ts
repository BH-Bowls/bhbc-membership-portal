// app/api/clubs/create/route.ts
// API route for creating a new club - POST
// Only non-members (Captains, Admins, etc.) can create clubs

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createClub } from '@/lib/clubs-sheets';
import { CreateClubRequest } from '@/lib/types/clubs';

/**
 * POST /api/clubs/create
 * Create a new club
 * Authorization: Non-members only (role !== "Member")
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is non-member (role !== "Member")
    const role = session.user.role || 'Member';
    if (role === 'Member') {
      return NextResponse.json(
        { error: 'Only committee members can create clubs' },
        { status: 403 }
      );
    }

    const body: CreateClubRequest = await request.json();

    // Validate required field
    if (!body.clubName || body.clubName.trim() === '') {
      return NextResponse.json(
        { error: 'Club name is required' },
        { status: 400 }
      );
    }

    const club = await createClub(body);

    return NextResponse.json({
      success: true,
      club,
    });
  } catch (error) {
    console.error('[POST /api/clubs/create] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create club';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
