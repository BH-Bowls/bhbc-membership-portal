// app/api/admin/applications/[id]/convert/route.ts
// POST — convert a paid application into an active member: create the Members row,
// mark the application Converted, and send the welcome/credentials email.
// Auth: Admin role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { clearDiaryCache } from '@/lib/home-cache';
import { getApplicationByRow, convertApplicationToMember } from '@/lib/applications-sheets';
import { sendApplicationWelcomeEmail } from '@/lib/email/application-mailer';

// POST handler — runs the full conversion to member
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admins may convert applications
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse and validate the application row number
    const { id } = await params;
    const rowNumber = parseInt(id, 10);
    if (isNaN(rowNumber)) {
      return NextResponse.json({ error: 'Invalid application id' }, { status: 400 });
    }

    // Confirm the application exists and is currently Paid
    const application = await getApplicationByRow(rowNumber);
    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }
    if (application.status !== 'Paid') {
      return NextResponse.json(
        { error: `Cannot convert an application with status "${application.status}"` },
        { status: 409 }
      );
    }

    // Run the conversion (creates the member, updates the application)
    const result = await convertApplicationToMember(application);
    if (!result.success || !result.userName || !result.tempPassword) {
      return NextResponse.json(
        { error: result.error || 'Failed to convert application' },
        { status: 500 }
      );
    }

    // Send the welcome / credentials email. A failure here does not undo the
    // conversion — report it so the admin can pass the login details on manually.
    const emailResult = await sendApplicationWelcomeEmail(
      application,
      result.userName,
      result.tempPassword
    );

    // The converted application no longer counts as pending action
    clearDiaryCache(session.user.userName);

    return NextResponse.json({
      success: true,
      userName: result.userName,
      emailSent: emailResult.success,
      emailError: emailResult.error,
    });
  } catch (error) {
    console.error('[POST convert] Error:', error);
    return NextResponse.json({ error: 'Failed to convert application' }, { status: 500 });
  }
}
