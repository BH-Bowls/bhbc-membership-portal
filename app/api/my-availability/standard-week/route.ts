// app/api/my-availability/standard-week/route.ts
// PUT — replace the caller's entire standard week (the editor always saves full grid state)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { setStandardWeek, Session } from '@/lib/member-availability';

interface StandardWeekEntryInput {
  weekday: number;
  session: Session;
  status: 'free' | 'busy';
  label?: string;
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const entries: StandardWeekEntryInput[] = Array.isArray(body.entries) ? body.entries : [];

    for (const entry of entries) {
      if (entry.weekday < 0 || entry.weekday > 6) {
        return NextResponse.json({ error: 'Invalid weekday' }, { status: 400 });
      }
      if (!['morning', 'afternoon', 'evening'].includes(entry.session)) {
        return NextResponse.json({ error: 'Invalid session' }, { status: 400 });
      }
      if (!['free', 'busy'].includes(entry.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
    }

    await setStandardWeek(session.user.userName, entries);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('PUT /api/my-availability/standard-week error:', error);
    return NextResponse.json({ error: 'Failed to save standard week' }, { status: 500 });
  }
}
