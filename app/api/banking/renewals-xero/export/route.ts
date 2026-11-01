// app/api/banking/renewals-xero/export/route.ts
// POST — export everything pending: builds the Manual Journal CSV, records the export and
// stamps every event so it's never exported twice. Returns the CSV for download.

import { NextResponse } from 'next/server';
import { createExport } from '@/lib/renewals-xero';
import { getRenewalsXeroUser } from '../guard';

export async function POST() {
  const user = await getRenewalsXeroUser();
  if (!user) return NextResponse.json({ error: 'Admin or Treasurer access required' }, { status: 403 });
  try {
    const result = await createExport(user);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[POST /api/banking/renewals-xero/export] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Export failed' }, { status: 400 });
  }
}
