// app/api/banking/import/route.ts
// Import payments from CSV

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { generateNextPaymentId, addPaymentToSheet } from '@/lib/banking-sheets';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Check authorization: Admin OR Treasurer
    if (session?.user?.role !== 'Admin' && session?.user?.role !== 'T') {
      return NextResponse.json(
        { error: 'Forbidden - Admin or Treasurer access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { csvData, selectedType } = body;

    if (!csvData || !Array.isArray(csvData)) {
      return NextResponse.json(
        { error: 'Invalid CSV data' },
        { status: 400 }
      );
    }

    if (!selectedType) {
      return NextResponse.json(
        { error: 'Payment type required' },
        { status: 400 }
      );
    }

    // Filter for selected type
    const filteredData = csvData.filter(
      (row: any) => row.Type === selectedType
    );

    const paymentIds: string[] = [];

    // Add each payment
    for (const row of filteredData) {
      const payment_id = await generateNextPaymentId();

      await addPaymentToSheet({
        payment_id,
        date: row.Date,
        type: selectedType,
        reference: row.Reference || '',
        amount: parseFloat(row.Amount) || 0,
        status: 'Unmatched',
        matched_users: '',
      });

      paymentIds.push(payment_id);
    }

    return NextResponse.json({
      success: true,
      paymentIds,
      count: paymentIds.length,
    });
  } catch (error) {
    console.error('Error importing CSV:', error);
    return NextResponse.json(
      { error: 'Failed to import CSV' },
      { status: 500 }
    );
  }
}
