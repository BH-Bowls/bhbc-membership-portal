// app/api/admin/applications/[id]/resend-payment-email/route.ts
// PATCH — resend the payment-request email for an already-approved application.
// Auth: Admin role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getApplicationByRow } from '@/lib/applications-sheets';
import { sendApplicationPaymentEmail } from '@/lib/email/application-mailer';

// PATCH handler — resends the payment email using the recorded fee
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

    // Only Admins may resend payment emails
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse and validate the application row number
    const { id } = await params;
    const rowNumber = parseInt(id, 10);
    if (isNaN(rowNumber)) {
      return NextResponse.json({ error: 'Invalid application id' }, { status: 400 });
    }

    // Confirm the application exists and is currently Approved
    const application = await getApplicationByRow(rowNumber);
    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }
    if (application.status !== 'Approved') {
      return NextResponse.json(
        { error: `Can only resend the payment email for Approved applications (status is "${application.status}")` },
        { status: 409 }
      );
    }

    // A recorded fee is required to resend
    if (application.feeDue === null) {
      return NextResponse.json({ error: 'No fee is recorded on this application' }, { status: 400 });
    }

    // Resend the payment-request email
    const emailResult = await sendApplicationPaymentEmail(application, application.feeDue);
    if (!emailResult.success) {
      return NextResponse.json({ error: emailResult.error || 'Failed to send email' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH resend-payment-email] Error:', error);
    return NextResponse.json({ error: 'Failed to resend payment email' }, { status: 500 });
  }
}
