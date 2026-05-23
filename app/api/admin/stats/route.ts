// app/api/admin/stats/route.ts
// API endpoint — reads Members sheet, computes membership statistics, returns JSON

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUsers } from '@/lib/sheets';
import { hasRole } from '@/lib/role-utils';

/**
 * GET /api/admin/stats
 * Returns membership counts broken down by type, age demographic,
 * and two operational indicators (no email, new this year).
 * Authorization: Admin or Committee
 */
export async function GET() {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user has Admin, Captain, or GMC role (Treasurer excluded)
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch all member rows from the Members sheet
    const allUsers = await getAllUsers();

    // Determine the current calendar year for the "new this year" count
    const currentYear = new Date().getFullYear();

    // Member type counters — initialised to zero before looping
    let playingLadies = 0;
    let playingMen = 0;
    let socialLadies = 0;
    let socialMen = 0;

    // Age demographic counters — initialised to zero before looping
    let ageU18 = 0;
    let age18to24 = 0;
    let age25to59 = 0;
    let age60plus = 0;
    let age80plus = 0;
    let ageUnknown = 0;

    // Operational indicator counters
    let noEmail = 0;
    let newThisYear = 0;

    // Loop through every member row and accumulate the counts
    for (let i = 0; i < allUsers.length; i++) {
      const user = allUsers[i];

      // Skip rows with no memberType or Cancelled members — same filter used by labels route
      if (!user.memberType || user.memberType === 'Cancelled') {
        continue;
      }

      // ── Member type count ──────────────────────────────────────────────────
      // memberType stores the full name as it appears in the sheet
      if (user.memberType === 'Playing Lady') {
        playingLadies = playingLadies + 1;
      } else if (user.memberType === 'Playing Man') {
        playingMen = playingMen + 1;
      } else if (user.memberType === 'Social Lady') {
        socialLadies = socialLadies + 1;
      } else if (user.memberType === 'Social Man') {
        socialMen = socialMen + 1;
      }

      // ── Age demographic count ──────────────────────────────────────────────
      // ageDemographic stores the exact band string from the sheet
      if (user.ageDemographic === 'U18') {
        ageU18 = ageU18 + 1;
      } else if (user.ageDemographic === '18-24') {
        age18to24 = age18to24 + 1;
      } else if (user.ageDemographic === '25-59') {
        age25to59 = age25to59 + 1;
      } else if (user.ageDemographic === '60+') {
        age60plus = age60plus + 1;
      } else if (user.ageDemographic === '80+') {
        age80plus = age80plus + 1;
      } else {
        // Blank or unrecognised value — count as unknown so admins can identify
        // profiles that need updating
        ageUnknown = ageUnknown + 1;
      }

      // ── No email indicator ─────────────────────────────────────────────────
      // emailAddress is null or empty string when not provided
      if (!user.emailAddress || user.emailAddress.trim() === '') {
        noEmail = noEmail + 1;
      }

      // ── New this year indicator ────────────────────────────────────────────
      // yearStarted is an integer stored directly in the sheet — compare directly
      // without constructing a Date object to avoid date-parsing issues
      if (user.yearStarted === currentYear) {
        newThisYear = newThisYear + 1;
      }
    }

    // Compute rollup totals from the individual type counts
    const totalPlaying = playingLadies + playingMen;
    const totalSocial = socialLadies + socialMen;
    const totalMembers = totalPlaying + totalSocial;

    // Return all computed stats as a single flat JSON object
    return NextResponse.json({
      // Member type counts
      playingLadies,
      playingMen,
      socialLadies,
      socialMen,
      totalPlaying,
      totalSocial,
      totalMembers,

      // Age demographics
      ageU18,
      age18to24,
      age25to59,
      age60plus,
      age80plus,
      ageUnknown,

      // Operational indicators
      noEmail,
      newThisYear,
      currentYear,
    });
  } catch (error) {
    console.error('[api/admin/stats]', error);
    return NextResponse.json(
      { error: 'Failed to load membership stats' },
      { status: 500 }
    );
  }
}
