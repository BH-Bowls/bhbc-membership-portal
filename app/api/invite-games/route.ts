// app/api/invite-games/route.ts
// API routes for Invite Games list — GET all + POST create

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllInviteGames, createInviteGame } from '@/lib/invite-games-sheets';
import { hasRole } from '@/lib/role-utils';

/**
 * GET /api/invite-games
 * Return all invite games (accessible to all logged-in members)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const games = await getAllInviteGames();
    return NextResponse.json({ games });
  } catch (error) {
    console.error('[GET /api/invite-games] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch invite games' }, { status: 500 });
  }
}

/**
 * POST /api/invite-games
 * Create a new invite game (committee only)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'GMC', 'Admin')) {
      return NextResponse.json(
        { error: 'Only committee members can create invite games' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { title, description, closingDate, gameDate } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const result = await createInviteGame({
      title: title.trim(),
      description: (description || '').trim(),
      closingDate: closingDate || null,
      gameDate: gameDate || null,
      createdByUsername: session.user.userName,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to create invite game' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, inviteGameId: result.inviteGameId });
  } catch (error) {
    console.error('[POST /api/invite-games] Error:', error);
    return NextResponse.json({ error: 'Failed to create invite game' }, { status: 500 });
  }
}
