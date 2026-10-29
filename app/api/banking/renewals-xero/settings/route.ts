// app/api/banking/renewals-xero/settings/route.ts
// GET / POST — the renewals Xero account codes, tax rate and first season. Only the
// renewals_* keys can be written here (the bar's own codes are shown, set on Admin config).

import { NextRequest, NextResponse } from 'next/server';
import { getRenewalsXeroSettings, saveRenewalsXeroSettings } from '@/lib/renewals-xero';
import { getRenewalsXeroUser } from '../guard';

export async function GET() {
  const user = await getRenewalsXeroUser();
  if (!user) return NextResponse.json({ error: 'Admin or Treasurer access required' }, { status: 403 });
  try {
    return NextResponse.json({ settings: await getRenewalsXeroSettings() });
  } catch (error) {
    console.error('[GET /api/banking/renewals-xero/settings] Error:', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getRenewalsXeroUser();
  if (!user) return NextResponse.json({ error: 'Admin or Treasurer access required' }, { status: 403 });
  try {
    const body = await request.json();
    await saveRenewalsXeroSettings(body && typeof body === 'object' ? body : {});
    return NextResponse.json({ settings: await getRenewalsXeroSettings() });
  } catch (error) {
    console.error('[POST /api/banking/renewals-xero/settings] Error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save settings' }, { status: 400 });
  }
}
