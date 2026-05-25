// app/api/friendlies/manage/repair-entries/route.ts
// Repairs orphaned entries — players who have 'E' in the Players sheet but are
// missing from the game sheet tab (caused by a concurrent-entry race condition).
// Adds them to the game sheet without altering their Players sheet status.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, addPlayerToGameSheet } from '@/lib/friendlies-sheets';
import { hasRole } from '@/lib/role-utils';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { tab_name, user_names } = body as { tab_name: string; user_names: string[] };

    if (!tab_name || !Array.isArray(user_names) || user_names.length === 0) {
      return NextResponse.json({ error: 'Missing tab_name or user_names' }, { status: 400 });
    }

    const games = await getGames();
    const game = games.find(g => g.tabName === tab_name);
    if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    if (!['X', 'S'].includes(game.status)) {
      return NextResponse.json({ error: 'Game must be in Selecting or Selected status' }, { status: 400 });
    }

    // Add each orphaned player to the game sheet with default 'R' (Reserve) status.
    // Their Players sheet entry stays as 'E' — this is purely a game-sheet repair.
    const results: { userName: string; success: boolean; error?: string }[] = [];
    for (const userName of user_names) {
      try {
        await addPlayerToGameSheet(tab_name, userName, 'R');
        results.push({ userName, success: true });
      } catch (err) {
        results.push({
          userName,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('[repair-entries] POST error:', error);
    return NextResponse.json({ error: 'Failed to repair entries' }, { status: 500 });
  }
}
