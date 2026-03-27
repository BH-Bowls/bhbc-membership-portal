// app/api/clubs/[clubName]/route.ts
// API routes for a single club - GET, PUT, DELETE
// GET: All users, PUT/DELETE: Non-members only

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getClubWithContacts, updateClub, deleteClub } from '@/lib/clubs-sheets';
import { UpdateClubRequest } from '@/lib/types/clubs';
import { isMember } from '@/lib/role-utils';

interface RouteParams {
  params: Promise<{ clubName: string }>;
}

/**
 * GET /api/clubs/[clubName]
 * Get a single club with its contacts
 * Authorization: Any logged-in user
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clubName } = await params;
    const decodedClubName = decodeURIComponent(clubName);

    const result = await getClubWithContacts(decodedClubName);

    if (!result) {
      return NextResponse.json(
        { error: 'Club not found' },
        { status: 404 }
      );
    }

    // Check if user is non-member for edit permissions
    const role = session.user.role || 'Member';
    const canEdit = role !== 'Member';

    return NextResponse.json({
      ...result,
      canEdit,
    });
  } catch (error) {
    console.error('[GET /api/clubs/[clubName]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch club' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/clubs/[clubName]
 * Update a club's details
 * Authorization: Non-members only (role !== "Member")
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is non-member
    if (isMember(session.user.role)) {
      return NextResponse.json(
        { error: 'Only committee members can update clubs' },
        { status: 403 }
      );
    }

    const { clubName } = await params;
    const decodedClubName = decodeURIComponent(clubName);
    const body: UpdateClubRequest = await request.json();

    const club = await updateClub(decodedClubName, body);

    return NextResponse.json({
      success: true,
      club,
    });
  } catch (error) {
    console.error('[PUT /api/clubs/[clubName]] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update club';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/clubs/[clubName]
 * Delete a club and all its contacts
 * Authorization: Non-members only (role !== "Member")
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is non-member
    if (isMember(session.user.role)) {
      return NextResponse.json(
        { error: 'Only committee members can delete clubs' },
        { status: 403 }
      );
    }

    const { clubName } = await params;
    const decodedClubName = decodeURIComponent(clubName);

    await deleteClub(decodedClubName);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('[DELETE /api/clubs/[clubName]] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete club';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
