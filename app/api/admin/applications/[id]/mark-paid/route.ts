// app/api/admin/applications/[id]/mark-paid/route.ts
// PATCH — record payment details for an approved application and move it to Paid.
// Auth: Admin role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { normalizeToUKDate } from '@/lib/date-utils';
import { getApplicationByRow, updateApplicationFields } from '@/lib/applications-sheets';

// Allowed payment methods for the Payment Method column
const VALID_PAYMENT_METHODS = ['Bank Transfer', 'Card', 'Cash', 'Cheque'];

// PATCH handler — records payment fields and status -> Paid
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

    // Only Admins may record payment
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

    // Validate fee paid
    const feePaid = parseFloat(String(body.feePaid));
    if (isNaN(feePaid) || feePaid < 0) {
      return NextResponse.json({ error: 'feePaid must be a non-negative number' }, { status: 400 });
    }

    // Validate payment method
    if (!VALID_PAYMENT_METHODS.includes(body.paymentMethod)) {
      return NextResponse.json(
        { error: `paymentMethod must be one of: ${VALID_PAYMENT_METHODS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate payment date
    if (!body.paymentDate || typeof body.paymentDate !== 'string') {
      return NextResponse.json({ error: 'paymentDate is required' }, { status: 400 });
    }

    // Confirm the application exists and is currently Approved
    const application = await getApplicationByRow(rowNumber);
    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }
    if (application.status !== 'Approved') {
      return NextResponse.json(
        { error: `Cannot mark paid an application with status "${application.status}"` },
        { status: 409 }
      );
    }

    // Normalize the payment date to DD/MM/YYYY and write the update
    await updateApplicationFields(rowNumber, {
      feePaid,
      paymentMethod: body.paymentMethod,
      paymentDate: normalizeToUKDate(body.paymentDate),
      status: 'Paid',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH mark-paid] Error:', error);
    return NextResponse.json({ error: 'Failed to mark application as paid' }, { status: 500 });
  }
}
