// app/api/banking/payments/route.ts
// Get unmatched payments

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUnmatchedPayments } from '@/lib/banking-sheets';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Check authorization: Admin OR Treasurer
    if (session?.user?.role !== 'Admin' && session?.user?.role !== 'T') {
      return NextResponse.json(
        { error: 'Forbidden - Admin or Treasurer access required' },
        { status: 403 }
      );
    }

    const payments = await getUnmatchedPayments();

    return NextResponse.json({ payments });
  } catch (error) {
    console.error('Error getting payments:', error);
    return NextResponse.json(
      { error: 'Failed to get payments' },
      { status: 500 }
    );
  }
}
