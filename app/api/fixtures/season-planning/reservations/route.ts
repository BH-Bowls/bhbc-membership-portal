// app/api/fixtures/season-planning/reservations/route.ts
// GET: list all reservations (a standing list, not season-scoped).
// POST: create a reservation — either evergreen (no dates) or a one-off
// (startDate + endDate both set).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getReservations, createReservation } from '@/lib/reservations-supabase';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const reservations = await getReservations();

    return NextResponse.json({ reservations });
  } catch (error) {
    console.error('Error fetching reservations:', error);
    return NextResponse.json({ error: 'Failed to fetch reservations' }, { status: 500 });
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
    const { name, weekday, time, rinksReserved, startDate, endDate } = body;

    if (!name || weekday === undefined || !time || rinksReserved === undefined) {
      return NextResponse.json({ error: 'name, weekday, time, and rinksReserved are required' }, { status: 400 });
    }

    const reservation = await createReservation({ name, weekday, time, rinksReserved, startDate, endDate });

    return NextResponse.json({ reservation });
  } catch (error) {
    console.error('Error creating reservation:', error);
    return NextResponse.json({ error: 'Failed to create reservation' }, { status: 500 });
  }
}
