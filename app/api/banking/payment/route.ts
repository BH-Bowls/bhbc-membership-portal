// app/api/banking/payment/route.ts
// Add, amend, or delete payment

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  generateNextPaymentId,
  addPaymentToSheet,
  updatePaymentInSheet,
  getPayment,
} from '@/lib/banking-sheets';
import { hasRole } from '@/lib/role-utils';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Check authorization: Admin OR Treasurer
    if (!hasRole(session?.user?.role, 'Admin', 'Treasurer')) {
      return NextResponse.json(
        { error: 'Forbidden - Admin or Treasurer access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action, payment_id, date, type, reference, amount } = body;

    // ADD PAYMENT
    if (action === 'add') {
      if (!date || !type || !reference || amount === undefined) {
        return NextResponse.json(
          { error: 'Missing required fields' },
          { status: 400 }
        );
      }

      const newId = await generateNextPaymentId();

      await addPaymentToSheet({
        payment_id: newId,
        date,
        type,
        reference,
        amount: parseFloat(amount),
        status: 'Unmatched',
        matched_users: '',
      });

      return NextResponse.json({ payment_id: newId, success: true });
    }

    // AMEND PAYMENT
    if (action === 'amend') {
      if (!payment_id) {
        return NextResponse.json(
          { error: 'payment_id required' },
          { status: 400 }
        );
      }

      // Check if matched
      const payment = await getPayment(payment_id);
      if (!payment) {
        return NextResponse.json(
          { error: 'Payment not found' },
          { status: 404 }
        );
      }

      if (payment.status === 'Matched') {
        return NextResponse.json(
          { error: 'Cannot amend matched payment' },
          { status: 400 }
        );
      }

      await updatePaymentInSheet(payment_id, {
        date,
        type,
        reference,
        amount: parseFloat(amount),
      });

      return NextResponse.json({ success: true });
    }

    // DELETE PAYMENT
    if (action === 'delete') {
      if (!payment_id) {
        return NextResponse.json(
          { error: 'payment_id required' },
          { status: 400 }
        );
      }

      // Check if matched
      const payment = await getPayment(payment_id);
      if (!payment) {
        return NextResponse.json(
          { error: 'Payment not found' },
          { status: 404 }
        );
      }

      if (payment.status === 'Matched') {
        return NextResponse.json(
          { error: 'Cannot delete matched payment. Unmatch first.' },
          { status: 400 }
        );
      }

      // Soft delete
      await updatePaymentInSheet(payment_id, { status: 'Deleted' });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use: add, amend, or delete' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error processing payment:', error);
    return NextResponse.json(
      { error: 'Failed to process payment' },
      { status: 500 }
    );
  }
}
