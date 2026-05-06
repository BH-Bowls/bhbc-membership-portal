// app/api/rowland/[compId]/next-match/route.ts
// GET ?clubId=xxx — returns the club's next pending match + opponent contacts

import { NextRequest, NextResponse } from 'next/server';
import { getRowlandMatches } from '@/lib/rowland-sheets';
import { getContactsForClub } from '@/lib/clubs-sheets';
import type { RowlandCompId } from '@/types/rowland';

/** Maps compId to the Rowland contact role prefix stored in the Contacts sheet */
const CONTACT_ROLE_PREFIX: Record<string, string> = {
  'gladys-a':  'GRowland A',
  'gladys-b':  'GRowland B',
  'edward-a':  'ERowland A',
  'edward-b':  'ERowland B',
};

const ROUND_ORDER = ['Prelim', 'R1', 'R2', 'QF', 'SF', 'F'];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ compId: string }> }
) {
  try {
    const { compId } = await params;
    const clubId = req.nextUrl.searchParams.get('clubId');
    if (!clubId) return NextResponse.json({ error: 'clubId required' }, { status: 400 });

    const matches = await getRowlandMatches(compId as RowlandCompId);

    // Find the club's next pending match (earliest in bracket order)
    const clubMatches = matches.filter(
      (m) => m.homeTeam?.clubId === clubId || m.awayTeam?.clubId === clubId
    );
    const pending = clubMatches
      .filter((m) => m.status === 'Pending')
      .sort((a, b) => {
        const ra = ROUND_ORDER.indexOf(a.round);
        const rb = ROUND_ORDER.indexOf(b.round);
        return ra !== rb ? ra - rb : a.position - b.position;
      });

    if (pending.length === 0) {
      return NextResponse.json({ match: null, opponentContacts: [] });
    }

    const next = pending[0];
    const myClubId = clubId;
    const opponentTeam =
      next.homeTeam?.clubId === myClubId ? next.awayTeam : next.homeTeam;

    if (!opponentTeam) {
      return NextResponse.json({ match: next, opponentContacts: [] });
    }

    // Fetch contacts for the opponent club, filter to Rowland-specific roles.
    // Fallback chain:
    //   1. Exact bracket prefix  e.g. "ERowland A" → "ERowland A Organiser"
    //   2. Base bracket prefix   e.g. "ERowland"   → "ERowland Organiser"
    //   3. Any Rowland contact   e.g. any role containing "Rowland"
    const rolePrefix = CONTACT_ROLE_PREFIX[compId] ?? '';
    const allContacts = await getContactsForClub(opponentTeam.clubName);

    let rowlandContacts = rolePrefix
      ? allContacts.filter((c) => c.role.startsWith(rolePrefix))
      : [];

    if (rowlandContacts.length === 0 && rolePrefix) {
      // Step 2: strip the bracket letter suffix (e.g. "ERowland A" → "ERowland")
      const basePrefix = rolePrefix.replace(/ [AB]$/, '');
      if (basePrefix !== rolePrefix) {
        rowlandContacts = allContacts.filter((c) => c.role.startsWith(basePrefix));
      }
    }

    if (rowlandContacts.length === 0) {
      // Step 3: any contact with "Rowland" in the role
      rowlandContacts = allContacts.filter((c) => c.role.includes('Rowland'));
    }

    return NextResponse.json({ match: next, opponentContacts: rowlandContacts });
  } catch (error) {
    console.error('[rowland/next-match] GET error:', error);
    return NextResponse.json({ error: 'Failed to load next match' }, { status: 500 });
  }
}
