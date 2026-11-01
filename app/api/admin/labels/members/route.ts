// app/api/admin/labels/members/route.ts
// GET → return members with fields needed for label printing

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllUsers } from '@/lib/members-supabase';
import { getLatestRenewedSeasonsByUser } from '@/lib/renewals-supabase';
import { getCardCodes } from '@/lib/bar-card';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(session.user?.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [users, renewedSeasons] = await Promise.all([getAllUsers(), getLatestRenewedSeasonsByUser()]);
    // Card labels print the same QR as My Account (src/lib/bar-card.ts). The other label
    // types still work if the codes can't be loaded.
    let cardCodes = new Map<string, string>();
    try {
      cardCodes = await getCardCodes();
    } catch (err) {
      console.error('[GET /api/admin/labels/members] Card codes unavailable:', err);
    }
    const members = users
      .filter((u) => u.memberType && u.memberType !== 'Cancelled')
      .map((u) => ({
        fullName: u.fullName,
        address1: u.address1,
        address2: u.address2,
        address3: u.address3,
        postCode: u.postCode,
        memberType: u.memberType,
        include: u.include,
        // Membership card labels
        userName: u.userName,
        honorary: u.honorary === 'Y',
        latestRenewedSeasonYear: renewedSeasons.get(u.userName.toLowerCase()) ?? null,
        cardCode: cardCodes.get(u.userName.toLowerCase()) ?? null,
      }));

    return NextResponse.json({ members });
  } catch (error) {
    console.error('[GET /api/admin/labels/members]', error);
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }
}
