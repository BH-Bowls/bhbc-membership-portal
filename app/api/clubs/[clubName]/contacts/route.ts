// app/api/clubs/[clubName]/contacts/route.ts
// API route for adding a contact to a club - POST
// Only non-members (Captains, Admins, etc.) can add contacts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { addContact } from '@/lib/clubs-sheets';
import { CreateContactRequest } from '@/lib/types/clubs';

interface RouteParams {
  params: Promise<{ clubName: string }>;
}

/**
 * POST /api/clubs/[clubName]/contacts
 * Add a new contact to a club
 * Authorization: Non-members only (role !== "Member")
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is non-member
    const role = session.user.role || 'Member';
    if (role === 'Member') {
      return NextResponse.json(
        { error: 'Only committee members can add contacts' },
        { status: 403 }
      );
    }

    const { clubName } = await params;
    const decodedClubName = decodeURIComponent(clubName);
    const body = await request.json();

    const contactData: CreateContactRequest = {
      clubName: decodedClubName,
      role: body.role,
      firstName: body.firstName,
      lastName: body.lastName,
      phoneNumber: body.phoneNumber,
      mobileNumber: body.mobileNumber,
      notes: body.notes,
      email: body.email,
    };

    const contact = await addContact(contactData);

    return NextResponse.json({
      success: true,
      contact,
    });
  } catch (error) {
    console.error('[POST /api/clubs/[clubName]/contacts] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to add contact';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
