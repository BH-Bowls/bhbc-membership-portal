// app/api/clubs/[clubName]/contacts/[rowNumber]/route.ts
// PUT, DELETE — update or remove a contact (committee or own Club role)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateContact, deleteContact, getClubWithContacts } from '@/lib/clubs-sheets';
import { UpdateContactRequest } from '@/lib/types/clubs';
import { isMember } from '@/lib/role-utils';
import { sendClubChangeNotification } from '@/lib/email/club-change-notifier';

interface RouteParams {
  params: Promise<{ clubName: string; rowNumber: string }>;
}

function isOwnClub(session: any, clubName: string): boolean {
  return (
    session?.user?.role === 'Club' &&
    (session?.user?.name ?? '').toLowerCase() === clubName.toLowerCase()
  );
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clubName, rowNumber } = await params;
    const decodedClubName = decodeURIComponent(clubName);
    const role = session.user.role ?? '';
    const rowNum = parseInt(rowNumber, 10);

    if (role === 'Club') {
      if (!isOwnClub(session, decodedClubName)) {
        return NextResponse.json({ error: 'You can only edit your own club' }, { status: 403 });
      }
    } else if (isMember(role)) {
      return NextResponse.json({ error: 'Only committee members can update contacts' }, { status: 403 });
    }

    if (isNaN(rowNum)) {
      return NextResponse.json({ error: 'Invalid row number' }, { status: 400 });
    }

    const body: UpdateContactRequest = await request.json();

    // Fetch before-state for change diff
    const before = await getClubWithContacts(decodedClubName);
    const beforeContact = before?.contacts.find((c) => c._rowNumber === rowNum);

    const contact = await updateContact(rowNum, body);

    // Build change diff
    const fieldLabels: Record<string, string> = {
      role: 'Role', firstName: 'First name', lastName: 'Last name',
      phoneNumber: 'Phone', mobileNumber: 'Mobile', email: 'Email', notes: 'Notes',
    };
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    if (beforeContact) {
      for (const [key, label] of Object.entries(fieldLabels)) {
        const from = String((beforeContact as any)[key] ?? '');
        const to = String((body as any)[key] ?? (beforeContact as any)[key] ?? '');
        if (from !== to) changes[label] = { from, to };
      }
    }
    if (Object.keys(changes).length > 0) {
      sendClubChangeNotification(
        { type: 'contact_updated', clubName: decodedClubName, changes },
        { name: session.user.name ?? session.user.userName, userName: session.user.userName, role },
      );
    }

    return NextResponse.json({ success: true, contact });
  } catch (error) {
    console.error('[PUT /api/clubs/[clubName]/contacts/[rowNumber]] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update contact';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clubName, rowNumber } = await params;
    const decodedClubName = decodeURIComponent(clubName);
    const role = session.user.role ?? '';
    const rowNum = parseInt(rowNumber, 10);

    if (role === 'Club') {
      if (!isOwnClub(session, decodedClubName)) {
        return NextResponse.json({ error: 'You can only edit your own club' }, { status: 403 });
      }
    } else if (isMember(role)) {
      return NextResponse.json({ error: 'Only committee members can delete contacts' }, { status: 403 });
    }

    if (isNaN(rowNum)) {
      return NextResponse.json({ error: 'Invalid row number' }, { status: 400 });
    }

    // Fetch contact details before deleting for notification
    const before = await getClubWithContacts(decodedClubName);
    const beforeContact = before?.contacts.find((c) => c._rowNumber === rowNum);

    await deleteContact(decodedClubName, rowNum);

    if (beforeContact) {
      sendClubChangeNotification(
        {
          type: 'contact_deleted',
          clubName: decodedClubName,
          contact: {
            Role: beforeContact.role ?? '',
            Name: `${beforeContact.firstName} ${beforeContact.lastName}`.trim(),
            Phone: beforeContact.phoneNumber ?? '',
            Mobile: beforeContact.mobileNumber ?? '',
            Email: beforeContact.email ?? '',
            Notes: beforeContact.notes ?? '',
          },
        },
        { name: session.user.name ?? session.user.userName, userName: session.user.userName, role },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/clubs/[clubName]/contacts/[rowNumber]] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete contact';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
