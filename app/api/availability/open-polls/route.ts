// app/api/availability/open-polls/route.ts
// GET /api/availability/open-polls
// Returns all open polls (public + group) visible to the logged-in member.
// Used by the home-page Open Polls panel.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOpenPollsForMember } from '@/lib/availability-events-sheets';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const polls = await getOpenPollsForMember(session.user.userName);
    return NextResponse.json({ polls });
  } catch (error) {
    console.error('[GET /api/availability/open-polls] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch open polls' }, { status: 500 });
  }
}
