// app/api/leagues/route.ts
// GET (public) — list all leagues
// POST (Admin only) — create a new league

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllLeagues, createLeague } from '@/lib/leagues-sheets';
import type { LeagueType } from '@/types/leagues';

export async function GET() {
  try {
    const leagues = await getAllLeagues();
    return NextResponse.json({ leagues });
  } catch (err) {
    console.error('GET /api/leagues error:', err);
    return NextResponse.json({ error: 'Failed to load leagues' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user?.role ?? '';
  if (role !== 'Admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { name, type, season } = body;
  if (!name || !type || !season) {
    return NextResponse.json({ error: 'name, type and season are required' }, { status: 400 });
  }

  const leagueType = type as LeagueType;
  const squadSize = leagueType === 'triples' ? 6 : 4;
  const playersPerMatch = leagueType === 'triples' ? 3 : 2;

  try {
    const leagueId = await createLeague({
      name,
      type: leagueType,
      season,
      status: 'Not Started',
      squadSize,
      playersPerMatch,
    });
    return NextResponse.json({ leagueId });
  } catch (err) {
    console.error('POST /api/leagues error:', err);
    return NextResponse.json({ error: 'Failed to create league' }, { status: 500 });
  }
}
