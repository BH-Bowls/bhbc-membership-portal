// app/api/members/lookup/route.ts
// API route for member lookup — every member's name, plus their contact details.
//
// This route is public (proxy.ts), because the public rota pages use it to turn
// usernames into names. Phone numbers and email addresses are only included for a
// logged-in member: never for a visitor (with or without the public access PIN), the
// shared clubhouse tablet (Kiosk) or the bar till (Bar).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUsers } from '@/lib/members-supabase';
import { hasRole } from '@/lib/role-utils';

export interface MemberLookupResult {
  fullName: string;
  userName: string;
  memberType: string;
  mobile: string | null;
  landline: string | null;
  emailAddress: string | null;
  greenMaintenance: string | null;
  drivingAwayMatches: string | null;
  barDuty: string | null;
  gmc: string | null;
}

/**
 * GET /api/members/lookup
 * Returns list of members with contact information
 * Query params:
 *   - filter: 'none' | 'greenMaintenance' | 'drivingAway' | 'barDuty' | 'gmc'
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filter = searchParams.get('filter') || 'none';

    const session = await getServerSession(authOptions);
    const showContacts = !!session?.user && !hasRole(session.user.role, 'Kiosk', 'Bar');

    const users = await getAllUsers();

    // Map to lookup result format and apply filters
    let members: MemberLookupResult[] = users
      .filter(user => {
        // Only include active members (not empty usernames)
        if (!user.userName || !user.fullName) return false;

        // Apply filter
        switch (filter) {
          case 'greenMaintenance':
            return user.greenMaintenance === 'Y';
          case 'drivingAway':
            return user.drivingAwayMatches === 'Y';
          case 'barDuty':
            return user.barDuty === 'Y';
          case 'gmc':
            // GMC = General Management Committee
            return user.gmc === 'GMC';
          default:
            return true;
        }
      })
      .map(user => ({
        fullName: user.fullName,
        userName: user.userName,
        memberType: user.memberType,
        mobile: showContacts ? user.mobile : null,
        landline: showContacts ? user.landline : null,
        emailAddress: showContacts ? user.emailAddress : null,
        greenMaintenance: user.greenMaintenance,
        drivingAwayMatches: user.drivingAwayMatches,
        barDuty: user.barDuty,
        gmc: user.gmc,
      }));

    // Sort by full name
    members.sort((a, b) => a.fullName.localeCompare(b.fullName));

    return NextResponse.json({
      members,
      total: members.length,
    });
  } catch (error) {
    console.error('[GET /api/members/lookup] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch members' },
      { status: 500 }
    );
  }
}
