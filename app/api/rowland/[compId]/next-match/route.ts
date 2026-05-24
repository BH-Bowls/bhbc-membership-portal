// app/api/rowland/[compId]/next-match/route.ts
// GET ?clubId=xxx[&contactName=xxx] — returns the club's next pending match + opponent contacts
// For unauthenticated guests, contactName is verified against the requesting club's own contacts
// before opponent contact details are returned.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
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
    const contactName = req.nextUrl.searchParams.get('contactName');
    if (!clubId) return NextResponse.json({ error: 'clubId required' }, { status: 400 });

    const session = await getServerSession(authOptions);
    const isAuthenticated = !!session?.user;

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
    const opponentTeam =
      next.homeTeam?.clubId === clubId ? next.awayTeam : next.homeTeam;

    if (!opponentTeam) {
      return NextResponse.json({ match: next, opponentContacts: [] });
    }

    // For unauthenticated guests, verify contactName against the requesting club's own contacts.
    // Authenticated sessions (Club, Member, Captain, etc.) skip verification.
    if (!isAuthenticated) {
      if (!contactName?.trim()) {
        return NextResponse.json({ match: next, opponentContacts: [] });
      }
      // Find the requesting club's name from match data
      const requestingTeam = clubMatches[0].homeTeam?.clubId === clubId
        ? clubMatches[0].homeTeam
        : clubMatches[0].awayTeam;

      if (requestingTeam?.clubName) {
        const requestingContacts = await getContactsForClub(requestingTeam.clubName);
        const normalised = contactName.trim().toLowerCase();
        const nameMatches = requestingContacts.some((c) => {
          const full = (c.name || `${c.firstName ?? ''} ${c.lastName ?? ''}`).trim().toLowerCase();
          return full === normalised;
        });
        if (!nameMatches) {
          return NextResponse.json({ match: next, opponentContacts: [] });
        }
      } else {
        return NextResponse.json({ match: next, opponentContacts: [] });
      }
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
      const basePrefix = rolePrefix.replace(/ [AB]$/, '');
      if (basePrefix !== rolePrefix) {
        rowlandContacts = allContacts.filter((c) => c.role.startsWith(basePrefix));
      }
    }

    if (rowlandContacts.length === 0) {
      rowlandContacts = allContacts.filter((c) => c.role.includes('Rowland'));
    }

    return NextResponse.json({ match: next, opponentContacts: rowlandContacts });
  } catch (error) {
    console.error('[rowland/next-match] GET error:', error);
    return NextResponse.json({ error: 'Failed to load next match' }, { status: 500 });
  }
}
