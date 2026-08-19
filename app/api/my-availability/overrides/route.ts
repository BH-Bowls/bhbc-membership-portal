// app/api/my-availability/overrides/route.ts
// POST — add an override for a single date or a date range (e.g. "away this fortnight")

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { addOverride, OverrideSession } from '@/lib/member-availability';

function parseUKDate(dateStr: string): Date {
  const [day, month, year] = dateStr.split('/').map(Number);
  return new Date(year, month - 1, day);
}

function formatUKDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { startDate, endDate, session: overrideSession, status, label } = body as {
      startDate?: string;
      endDate?: string;
      session?: OverrideSession;
      status?: 'free' | 'busy';
      label?: string;
    };

    if (!startDate || !overrideSession || !status) {
      return NextResponse.json({ error: 'startDate, session, and status are required' }, { status: 400 });
    }
    if (!['morning', 'afternoon', 'evening', 'all'].includes(overrideSession)) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 400 });
    }
    if (!['free', 'busy'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const start = parseUKDate(startDate);
    const end = endDate ? parseUKDate(endDate) : start;
    if (end < start) {
      return NextResponse.json({ error: 'endDate must not be before startDate' }, { status: 400 });
    }

    const dates: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      dates.push(formatUKDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    // A generous but real cap — this is a form for personal overrides, not a bulk tool.
    if (dates.length > 90) {
      return NextResponse.json({ error: 'Date range too large (max 90 days)' }, { status: 400 });
    }

    for (const date of dates) {
      await addOverride(session.user.userName, date, overrideSession, status, label);
    }

    return NextResponse.json({ success: true, count: dates.length });
  } catch (error) {
    console.error('POST /api/my-availability/overrides error:', error);
    return NextResponse.json({ error: 'Failed to save override' }, { status: 500 });
  }
}
