// app/api/banking/renewals-xero/member/route.ts
// GET            — members with a submitted renewal this season (for the picker)
// GET ?userName= — that member's renewal, payments and adjustments

import { NextRequest, NextResponse } from 'next/server';
import { getMemberAccount, getSubmittedRenewalMembers } from '@/lib/renewals-xero';
import { getRenewalsXeroUser } from '../guard';

export async function GET(request: NextRequest) {
  const user = await getRenewalsXeroUser();
  if (!user) return NextResponse.json({ error: 'Admin or Treasurer access required' }, { status: 403 });
  try {
    const userName = request.nextUrl.searchParams.get('userName');
    if (!userName) {
      return NextResponse.json({ members: await getSubmittedRenewalMembers() });
    }
    const account = await getMemberAccount(userName);
    if (!account) return NextResponse.json({ error: 'No renewal this season for that member' }, { status: 404 });
    return NextResponse.json({ account });
  } catch (error) {
    console.error('[GET /api/banking/renewals-xero/member] Error:', error);
    return NextResponse.json({ error: 'Failed to load member' }, { status: 500 });
  }
}
