// app/api/friendlies/manage/add-reserve-game/route.ts
// POST — create a same-club "reserve game" (<tab>-2) for an oversubscribed
// standalone game, so the captain can move overflow reserves into it.
// Auth: Captain or Admin.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getGames, createReserveGame } from '@/lib/friendlies-sheets';
import { parseNumberRequired } from '@/lib/friendlies-utils';

// Minimum overflow (players beyond a full team) before a reserve game is offered
const RESERVE_GAME_THRESHOLD = 8;

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
    const tabName = body.tab_name;
    if (!tabName || typeof tabName !== 'string') {
      return NextResponse.json({ error: 'tab_name is required' }, { status: 400 });
    }

    const games = await getGames();
    const game = games.find(g => g.tabName === tabName);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    if (game.paired) {
      return NextResponse.json({ error: 'Game is already part of a pair' }, { status: 400 });
    }
    if (game.status !== 'X') {
      return NextResponse.json(
        { error: 'A reserve game can only be added while selecting (closed for entries)' },
        { status: 400 }
      );
    }

    // Require genuine oversubscription: entered must exceed a full team by the threshold.
    // (If the format can't be parsed we skip the check rather than block.)
    const needed = parseNumberRequired(game.format);
    if (needed != null && game.entered < needed + RESERVE_GAME_THRESHOLD) {
      return NextResponse.json(
        { error: `Not oversubscribed enough — need at least ${needed + RESERVE_GAME_THRESHOLD} entered to add a reserve game` },
        { status: 400 }
      );
    }

    const result = await createReserveGame(tabName);
    return NextResponse.json({ success: true, tabName: result.tabName });
  } catch (error) {
    console.error('[POST /api/friendlies/manage/add-reserve-game] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to add reserve game';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
