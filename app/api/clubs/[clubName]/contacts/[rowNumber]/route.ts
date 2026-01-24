// app/api/clubs/[clubName]/contacts/[rowNumber]/route.ts
// API routes for a single contact - PUT, DELETE
// Only non-members (Captains, Admins, etc.) can modify contacts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateContact, deleteContact } from '@/lib/clubs-sheets';
import { UpdateContactRequest } from '@/lib/types/clubs';

interface RouteParams {
  params: Promise<{ clubName: string; rowNumber: string }>;
}

/**
 * PUT /api/clubs/[clubName]/contacts/[rowNumber]
 * Update a contact
 * Authorization: Non-members only (role !== "Member")
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is non-member
    const role = session.user.role || 'Member';
    if (role === 'Member') {
      return NextResponse.json(
        { error: 'Only committee members can update contacts' },
        { status: 403 }
      );
    }

    const { rowNumber } = await params;
    const rowNum = parseInt(rowNumber, 10);

    if (isNaN(rowNum)) {
      return NextResponse.json(
        { error: 'Invalid row number' },
        { status: 400 }
      );
    }

    const body: UpdateContactRequest = await request.json();

    const contact = await updateContact(rowNum, body);

    return NextResponse.json({
      success: true,
      contact,
    });
  } catch (error) {
    console.error('[PUT /api/clubs/[clubName]/contacts/[rowNumber]] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update contact';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/clubs/[clubName]/contacts/[rowNumber]
 * Delete a contact
 * Authorization: Non-members only (role !== "Member")
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is non-member
    const role = session.user.role || 'Member';
    if (role === 'Member') {
      return NextResponse.json(
        { error: 'Only committee members can delete contacts' },
        { status: 403 }
      );
    }

    const { clubName, rowNumber } = await params;
    const decodedClubName = decodeURIComponent(clubName);
    const rowNum = parseInt(rowNumber, 10);

    if (isNaN(rowNum)) {
      return NextResponse.json(
        { error: 'Invalid row number' },
        { status: 400 }
      );
    }

    await deleteContact(decodedClubName, rowNum);

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('[DELETE /api/clubs/[clubName]/contacts/[rowNumber]] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete contact';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
