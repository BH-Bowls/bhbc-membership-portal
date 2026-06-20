// app/api/admin/applications/[id]/approve/route.ts
// PATCH — approve a listed application: optionally override the fee, set status to
// Approved, and send the payment-request email. Auth: Admin role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { clearDiaryCache } from '@/lib/home-cache';
import { getApplicationByRow, updateApplicationFields } from '@/lib/applications-sheets';
import { sendApplicationPaymentEmail } from '@/lib/email/application-mailer';

// PATCH handler — sets fee/status -> Approved and sends the payment email
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

    // Only Admins may approve applications
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
        { error: `Cannot approve an application with status "${application.status}"` },
        { status: 409 }
      );
    }

    // Determine the fee to record and email. Use the override when supplied,
    // otherwise keep the fee already calculated on the application.
    let feeDue = application.feeDue;
    if (body.feeDue !== undefined && body.feeDue !== null && body.feeDue !== '') {
      const parsedFee = parseFloat(String(body.feeDue));
      if (isNaN(parsedFee) || parsedFee < 0) {
        return NextResponse.json({ error: 'feeDue must be a non-negative number' }, { status: 400 });
      }
      feeDue = parsedFee;
    }

    // A fee value is required to send the payment email
    if (feeDue === null) {
      return NextResponse.json({ error: 'A fee amount is required to approve' }, { status: 400 });
    }

    // Build the fields to update (notes are optional)
    const updates: { feeDue: number; status: string; approvedAt: string; decisionNotes?: string } = {
      feeDue,
      status: 'Approved',
      approvedAt: new Date().toISOString(),
    };
    if (typeof body.notes === 'string' && body.notes.trim() !== '') {
      updates.decisionNotes = body.notes.trim();
    }

    await updateApplicationFields(rowNumber, updates);

    // Send the payment-request email (with the recorded fee). Email failure does
    // not undo the approval — report it back so the admin can resend.
    const emailResult = await sendApplicationPaymentEmail(
      { ...application, feeDue },
      feeDue
    );

    // The objection-passed application is no longer "pending action" for the admin
    clearDiaryCache(session.user.userName);

    return NextResponse.json({ success: true, emailSent: emailResult.success, emailError: emailResult.error });
  } catch (error) {
    console.error('[PATCH approve] Error:', error);
    return NextResponse.json({ error: 'Failed to approve application' }, { status: 500 });
  }
}
