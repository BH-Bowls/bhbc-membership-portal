// app/api/admin/applications/[id]/set-listed-date/route.ts
// PATCH — record the date a name was listed on the clubhouse board and move the
// application from Submitted to Listed. Sends no email. Auth: Admin role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { clearDiaryCache } from '@/lib/home-cache';
import { normalizeToUKDate } from '@/lib/date-utils';
import { getApplicationByRow, updateApplicationFields } from '@/lib/applications-sheets';

// PATCH handler — sets Listed Date and status -> Listed
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

    // Only Admins may progress applications
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse and validate the application row number from the route
    const { id } = await params;
    const rowNumber = parseInt(id, 10);
    if (isNaN(rowNumber)) {
      return NextResponse.json({ error: 'Invalid application id' }, { status: 400 });
    }

    // Validate the listed date from the request body
    const body = await request.json();
    const listedDateRaw = body.listedDate;
    if (!listedDateRaw || typeof listedDateRaw !== 'string') {
      return NextResponse.json({ error: 'listedDate is required' }, { status: 400 });
    }

    // Confirm the application exists and is in the right state
    const application = await getApplicationByRow(rowNumber);
    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }
    if (application.status !== 'Submitted') {
      return NextResponse.json(
        { error: `Cannot set listed date on an application with status "${application.status}"` },
        { status: 409 }
      );
    }

    // Normalize the date to DD/MM/YYYY and write the update
    const listedDate = normalizeToUKDate(listedDateRaw);
    await updateApplicationFields(rowNumber, {
      listedDate,
      status: 'Listed',
    });

    // The pending-applications count for the admin may have changed
    clearDiaryCache(session.user.userName);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH set-listed-date] Error:', error);
    return NextResponse.json({ error: 'Failed to set listed date' }, { status: 500 });
  }
}
