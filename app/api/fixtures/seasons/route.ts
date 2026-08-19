// app/api/fixtures/seasons/route.ts
// Public fixtures-page year picker — lists seasons available to the current
// user. Any not-yet-active season with a later year than the active one is a
// Season Planning draft (still Projected/unconfirmed) and is hidden from
// ordinary members — only Captain/Admin can see and select it, so they can
// preview next year's plan before it's rolled over.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAllSeasons } from '@/lib/fixtures-supabase';
import { hasRole } from '@/lib/role-utils';

export async function GET(request: NextRequest) {
  try {
    // Guests can view /fixtures without logging in (see proxy.ts's public
    // route list) — no session at all just means "not Captain/Admin", same
    // as /api/fixtures/games's existing tolerance of a missing session.
    const session = await getServerSession(authOptions);
    const canSeeDraft = hasRole(session?.user?.role, 'Captain', 'Admin');
    const allSeasons = await getAllSeasons();
    const activeYear = allSeasons.find((s) => s.isActive)?.year;

    const seasons = allSeasons.filter((s) => {
      const isDraft = !s.isActive && activeYear !== undefined && s.year > activeYear;
      return !isDraft || canSeeDraft;
    });

    return NextResponse.json({ seasons: seasons.map((s) => ({ year: s.year, isActive: s.isActive })) });
  } catch (error) {
    console.error('Error fetching seasons:', error);
    return NextResponse.json({ error: 'Failed to fetch seasons' }, { status: 500 });
  }
}
