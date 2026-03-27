// app/api/competitions/handicaps/route.ts
// GET  /api/competitions/handicaps — list Playing members with their handicap
// PATCH /api/competitions/handicaps — update one member's handicap (committee only)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllUsers, batchUpdateMemberHandicaps } from '@/lib/sheets';
import { hasRole } from '@/lib/role-utils';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Captain access required' }, { status: 403 });
    }

    const users = await getAllUsers();

    // Playing members only, sorted: Playing Men first then Playing Ladies, then by surname
    const playing = users
      .filter((u) => u.memberType === 'Playing Man' || u.memberType === 'Playing Lady')
      .sort((a, b) => {
        const typeOrder = (t: string) => (t === 'Playing Man' ? 1 : 2);
        const byType = typeOrder(a.memberType) - typeOrder(b.memberType);
        if (byType !== 0) return byType;
        return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
      });

    const members = playing.map((u) => ({
      username: u.userName,
      fullName: u.fullName || `${u.firstName} ${u.lastName}`.trim(),
      memberType: u.memberType,
      handicap: u.handicap,
    }));

    return NextResponse.json({ members });
  } catch (error) {
    console.error('[GET /api/competitions/handicaps] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch handicap data' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Captain access required' }, { status: 403 });
    }

    const body = await request.json();

    // Accept either a single { username, handicap } or a batch { updates: [...] }
    const updates: { username: string; handicap: number | null }[] =
      Array.isArray(body.updates)
        ? body.updates
        : [{ username: body.username, handicap: body.handicap }];

    for (const { username, handicap } of updates) {
      if (!username) {
        return NextResponse.json({ error: 'username is required' }, { status: 400 });
      }
      if (handicap !== null && (typeof handicap !== 'number' || !Number.isInteger(handicap) || handicap < 0 || handicap > 10)) {
        return NextResponse.json({ error: `handicap for ${username} must be an integer 0-10 or null` }, { status: 400 });
      }
    }

    await batchUpdateMemberHandicaps(
      updates.map(({ username, handicap }) => ({ userName: username, handicap }))
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[PATCH /api/competitions/handicaps] Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to update handicap' }, { status: 500 });
  }
}
