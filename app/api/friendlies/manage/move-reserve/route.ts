// app/api/friendlies/manage/move-reserve/route.ts
// POST — move a Reserve player from one paired game to the other.
// Only reserves can be moved, so picked teams are never disturbed.
// Auth: Captain or Admin.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { moveReservePlayers } from '@/lib/friendlies-sheets';

// POST handler — moves one or more reserves to the paired game in one batch
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
    const { from_tab, to_tab } = body;

    // Accept an array of usernames (user_names); fall back to a single user_name
    let userNames: string[] = [];
    if (Array.isArray(body.user_names)) {
      userNames = body.user_names.filter((u: unknown) => typeof u === 'string' && u);
    } else if (typeof body.user_name === 'string' && body.user_name) {
      userNames = [body.user_name];
    }

    if (!from_tab || !to_tab || userNames.length === 0) {
      return NextResponse.json(
        { error: 'from_tab, to_tab and at least one username are required' },
        { status: 400 }
      );
    }

    const result = await moveReservePlayers(from_tab, to_tab, userNames);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, moved: result.moved });
  } catch (error) {
    console.error('[POST /api/friendlies/manage/move-reserve] Error:', error);
    return NextResponse.json({ error: 'Failed to move reserves' }, { status: 500 });
  }
}
