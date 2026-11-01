// app/api/banking/renewals-xero/export/[id]/route.ts
// GET — download a past export again (the identical stored CSV).

import { NextRequest, NextResponse } from 'next/server';
import { getExportCsv } from '@/lib/renewals-xero';
import { getRenewalsXeroUser } from '../../guard';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getRenewalsXeroUser();
  if (!user) return NextResponse.json({ error: 'Admin or Treasurer access required' }, { status: 403 });
  try {
    const { id } = await params;
    const result = await getExportCsv(id);
    if (!result) return NextResponse.json({ error: 'Export not found' }, { status: 404 });
    return new NextResponse(result.csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
      },
    });
  } catch (error) {
    console.error('[GET /api/banking/renewals-xero/export/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to load export' }, { status: 500 });
  }
}
