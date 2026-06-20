// app/api/admin/applications/[id]/reject/route.ts
// PATCH — reject a listed application, recording decision notes. Sends no email
// (rejection is communicated manually). Auth: Admin role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { clearDiaryCache } from '@/lib/home-cache';
import { getApplicationByRow, updateApplicationFields } from '@/lib/applications-sheets';

// PATCH handler — sets status -> Rejected with notes
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admins may reject applications
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse and validate the application row number
    const { id } = await params;
    const rowNumber = parseInt(id, 10);
    if (isNaN(rowNumber)) {
      return NextResponse.json({ error: 'Invalid application id' }, { status: 400 });
    }

    const body = await request.json();

    // Confirm the application exists and is currently Listed
    const application = await getApplicationByRow(rowNumber);
    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }
    if (application.status !== 'Listed') {
      return NextResponse.json(
        { error: `Cannot reject an application with status "${application.status}"` },
        { status: 409 }
      );
    }

    // Decision notes are optional but recorded when supplied
    let notes = '';
    if (typeof body.notes === 'string') {
      notes = body.notes.trim();
    }

    await updateApplicationFields(rowNumber, {
      status: 'Rejected',
      decisionNotes: notes,
    });

    // A rejected application no longer counts as pending action
    clearDiaryCache(session.user.userName);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH reject] Error:', error);
    return NextResponse.json({ error: 'Failed to reject application' }, { status: 500 });
  }
}
