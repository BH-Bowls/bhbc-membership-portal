// app/api/banking/import/route.ts
// Import payments from CSV

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { generateNextPaymentId, addPaymentsToSheet } from '@/lib/banking-sheets';

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
    const { csvData } = body;

    if (!csvData || !Array.isArray(csvData)) {
      return NextResponse.json(
        { error: 'Invalid CSV data' },
        { status: 400 }
      );
    }

    // Valid payment types
    const validTypes = ['TRF', 'CDM', 'CHQ', 'CSH'];

    // Filter out header rows (where Date is "Date") and empty rows
    // Expected CSV columns: Date, Type, Description, Amount, Balance (ignored)
    const filteredData = csvData.filter((row: any) => {
      const date = row.Date || '';
      // Skip header row and empty rows
      if (!date || date === 'Date') return false;
      return true;
    });

    if (filteredData.length === 0) {
      return NextResponse.json({
        success: true,
        paymentIds: [],
        count: 0,
        message: 'No transactions found to import',
      });
    }

    // Generate starting payment ID once (avoids API quota issues)
    const startingPaymentId = await generateNextPaymentId();
    const prefix = 'P';
    const startingNumber = parseInt(startingPaymentId.substring(1), 10);

    // Build array of all payments to add in batch
    // Generate subsequent IDs locally to avoid hitting API quota
    const paymentsToAdd = [];
    const paymentIds: string[] = [];

    for (let i = 0; i < filteredData.length; i++) {
      const row = filteredData[i];
      const paymentNumber = startingNumber + i;
      const payment_id = `${prefix}${String(paymentNumber).padStart(3, '0')}`;

      // Use type from CSV, validate it, default to TRF if invalid
      const rawType = (row.Type || 'TRF').toUpperCase();
      const type = validTypes.includes(rawType) ? rawType : 'TRF';

      paymentsToAdd.push({
        payment_id,
        date: row.Date,
        type: type as 'TRF' | 'CDM' | 'CHQ' | 'CSH',
        reference: row.Description || '',
        amount: parseFloat(row.Amount) || 0,
        status: 'Unmatched' as const,
        matched_users: '',
      });

      paymentIds.push(payment_id);
    }

    // Add all payments in a single batch operation (avoids write quota limit)
    await addPaymentsToSheet(paymentsToAdd);

    return NextResponse.json({
      success: true,
      paymentIds,
      count: paymentIds.length,
      message: `Imported ${paymentIds.length} transactions`,
    });
  } catch (error) {
    console.error('Error importing CSV:', error);
    return NextResponse.json(
      { error: 'Failed to import CSV' },
      { status: 500 }
    );
  }
}
