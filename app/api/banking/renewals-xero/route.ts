// app/api/banking/renewals-xero/route.ts
// GET — what's waiting to be exported (one journal per date) and the export history.

import { NextResponse } from 'next/server';
import { getExportPreview, getExportHistory } from '@/lib/renewals-xero';
import { getRenewalsXeroUser } from './guard';

export async function GET() {
  const user = await getRenewalsXeroUser();
  if (!user) return NextResponse.json({ error: 'Admin or Treasurer access required' }, { status: 403 });
  try {
    const [preview, history] = await Promise.all([getExportPreview(), getExportHistory()]);
    return NextResponse.json({ preview, history });
  } catch (error) {
    console.error('[GET /api/banking/renewals-xero] Error:', error);
    return NextResponse.json({ error: 'Failed to load the renewals export' }, { status: 500 });
  }
}
