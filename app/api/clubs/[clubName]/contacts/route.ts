// app/api/clubs/[clubName]/contacts/route.ts
// POST — add a contact to a club (committee only)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { addContact, CreateContactRequest } from '@/lib/clubs-supabase';
import { isMember } from '@/lib/role-utils';
import { sendClubChangeNotification } from '@/lib/email/club-change-notifier';

interface RouteParams {
  params: Promise<{ clubName: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clubName } = await params;
    const decodedClubName = decodeURIComponent(clubName);
    const role = session.user.role ?? '';

    if (isMember(role)) {
      return NextResponse.json({ error: 'Only committee members can add contacts' }, { status: 403 });
    }

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

    sendClubChangeNotification(
      {
        type: 'contact_added',
        clubName: decodedClubName,
        contact: {
          Role: body.role ?? '',
          Name: `${body.firstName ?? ''} ${body.lastName ?? ''}`.trim(),
          Phone: body.phoneNumber ?? '',
          Mobile: body.mobileNumber ?? '',
          Email: body.email ?? '',
          Notes: body.notes ?? '',
        },
      },
      { name: session.user.name ?? session.user.userName, userName: session.user.userName, role },
    );

    return NextResponse.json({ success: true, contact });
  } catch (error) {
    console.error('[POST /api/clubs/[clubName]/contacts] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to add contact';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
