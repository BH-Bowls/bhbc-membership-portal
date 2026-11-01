// app/api/banking/renewals-xero/reports/route.ts
// GET ?asAt=YYYY-MM-DD — the two checks against Xero (spec §6.6): members' debtors
// balances as at a date, and receipts that should be sitting in transfers clearing.

import { NextRequest, NextResponse } from 'next/server';
import { getDebtorsReport, getUnmatchedReceiptsReport, toUkDate } from '@/lib/renewals-xero';
import { getRenewalsXeroUser } from '../guard';

export async function GET(request: NextRequest) {
  const user = await getRenewalsXeroUser();
  if (!user) return NextResponse.json({ error: 'Admin or Treasurer access required' }, { status: 403 });
  try {
    let asAt = request.nextUrl.searchParams.get('asAt') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asAt)) asAt = toUkDate(new Date().toISOString());
    const [debtors, unmatched] = await Promise.all([getDebtorsReport(asAt), getUnmatchedReceiptsReport()]);
    return NextResponse.json({ debtors, unmatched });
  } catch (error) {
    console.error('[GET /api/banking/renewals-xero/reports] Error:', error);
    return NextResponse.json({ error: 'Failed to build the reports' }, { status: 500 });
  }
}
