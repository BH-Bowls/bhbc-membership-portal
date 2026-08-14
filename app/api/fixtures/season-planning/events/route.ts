// app/api/fixtures/season-planning/events/route.ts
// GET ?seasonId=: list planning events for a season.
// POST: manually add a new Event (lands straight at Confirmed/Manually Added).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { listPlanningEvents, addManualEvent } from '@/lib/season-planning-supabase';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const seasonId = request.nextUrl.searchParams.get('seasonId');
    if (!seasonId) {
      return NextResponse.json({ error: 'seasonId is required' }, { status: 400 });
    }

    const events = await listPlanningEvents(seasonId);

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error fetching planning events:', error);
    return NextResponse.json({ error: 'Failed to fetch planning events' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { seasonId, date, time, description, clubName, format, ladiesMen, dress, hardBlock } = body;

    if (!seasonId || !date || !description) {
      return NextResponse.json({ error: 'seasonId, date, and description are required' }, { status: 400 });
    }

    const event = await addManualEvent(seasonId, {
      date, time, description, clubName, format, ladiesMen, dress, hardBlock,
    });

    return NextResponse.json({ event });
  } catch (error) {
    console.error('Error adding event:', error);
    return NextResponse.json({ error: 'Failed to add event' }, { status: 500 });
  }
}
