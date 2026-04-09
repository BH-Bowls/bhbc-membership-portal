// app/api/clubs/[clubName]/route.ts
// API routes for a single club - GET, PUT, DELETE

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getClubWithContacts, updateClub, deleteClub } from '@/lib/clubs-sheets';
import { UpdateClubRequest } from '@/lib/types/clubs';
import { isMember, hasRole } from '@/lib/role-utils';
import { sendClubChangeNotification } from '@/lib/email/club-change-notifier';

/** Returns true if a Club-role user is viewing their own club. */
function isOwnClub(session: any, clubName: string): boolean {
  return (
    session?.user?.role === 'Club' &&
    (session?.user?.name ?? '').toLowerCase() === clubName.toLowerCase()
  );
}

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

    const { clubName } = await params;
    const decodedClubName = decodeURIComponent(clubName);

    const result = await getClubWithContacts(decodedClubName);

    if (!result) {
      return NextResponse.json(
        { error: 'Club not found' },
        { status: 404 }
      );
    }

    const role = session?.user?.role || 'Member';
    // Committee/special roles can edit any club; Club role can only edit their own
    const canEdit = !!session && (
      (!isMember(role) && role !== 'Club') ||
      isOwnClub(session, decodedClubName)
    );
    // Only committee/admin can delete — Club role cannot delete their own club
    const canDelete = !!session && !isMember(role) && role !== 'Club';

    return NextResponse.json({
      ...result,
      canEdit,
      canDelete,
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

    const { clubName } = await params;
    const decodedClubName = decodeURIComponent(clubName);
    const role = session.user.role ?? '';

    // Club role: only allowed to edit their own club
    if (role === 'Club') {
      if (!isOwnClub(session, decodedClubName)) {
        return NextResponse.json({ error: 'You can only edit your own club' }, { status: 403 });
      }
    } else if (isMember(role)) {
      return NextResponse.json({ error: 'Only committee members can update clubs' }, { status: 403 });
    }

    const body: UpdateClubRequest = await request.json();

    // Fetch before-state for change summary
    const before = await getClubWithContacts(decodedClubName);
    const club = await updateClub(decodedClubName, body);

    // Build change diff for notification
    const fieldLabels: Record<string, string> = {
      clubNumber: 'Phone', clubMobile: 'Mobile', clubEmailAddress: 'Email',
      clubEmailNote: 'Email note', generalInformation: 'General info',
      drivingBand: 'Driving band', address1: 'Address 1', address2: 'Address 2',
      address3: 'Town', address4: 'County', postCode: 'Post code',
      website: 'Website', latitude: 'Latitude', longitude: 'Longitude',
    };
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    if (before) {
      for (const [key, label] of Object.entries(fieldLabels)) {
        const from = String((before.club as any)[key] ?? '');
        const to = String((body as any)[key] ?? (before.club as any)[key] ?? '');
        if (from !== to) changes[label] = { from, to };
      }
    }
    if (Object.keys(changes).length > 0) {
      sendClubChangeNotification(
        { type: 'club_updated', clubName: decodedClubName, changes },
        { name: session.user.name ?? session.user.userName, userName: session.user.userName, role },
      );
    }

    return NextResponse.json({ success: true, club });
  } catch (error) {
    console.error('[PUT /api/clubs/[clubName]] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update club';
    return NextResponse.json({ error: message }, { status: 500 });
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

    const role = session.user.role ?? '';
    if (isMember(role) || role === 'Club') {
      return NextResponse.json({ error: 'Only committee members can delete clubs' }, { status: 403 });
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
