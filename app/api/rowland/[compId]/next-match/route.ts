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

    // Fetch contacts for the opponent club, filter to Rowland-specific roles
    const rolePrefix = CONTACT_ROLE_PREFIX[compId] ?? '';
    const allContacts = await getContactsForClub(opponentTeam.clubName);
    const rowlandContacts = rolePrefix
      ? allContacts.filter((c) => c.role.startsWith(rolePrefix))
      : [];

    return NextResponse.json({ match: next, opponentContacts: rowlandContacts });
  } catch (error) {
    console.error('[rowland/next-match] GET error:', error);
    return NextResponse.json({ error: 'Failed to load next match' }, { status: 500 });
  }
}
