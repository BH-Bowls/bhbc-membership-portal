// app/api/account/membership-card/route.ts
// GET — the logged-in member's own data for the My Account membership card:
// full name, whether they're Honorary, and the most recent season they've
// confirmed renewing for (the "valid until" date is derived from this on the
// client — see app/account/page.tsx).

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserByUsername } from '@/lib/members-supabase';
import { getLatestRenewedSeason } from '@/lib/renewals-supabase';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const user = await getUserByUsername(session.user.userName);
    if (!user) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    const latestRenewedSeasonYear = await getLatestRenewedSeason(session.user.userName);
    return NextResponse.json({
      fullName: user.fullName,
      honorary: user.honorary === 'Y',
      latestRenewedSeasonYear: latestRenewedSeasonYear,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load membership card';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
