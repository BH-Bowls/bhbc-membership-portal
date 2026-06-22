// app/api/friendlies/manage/allocate/route.ts
// API endpoint for captains to allocate players between two paired games
// FLOW: Games are in status 'L' (Allocating) — game sheets EXIST (created at open time).
// GET: reads entered players from the Players sheet (both game columns)
// POST: removes unallocated players from game sheets, clears their Players sheet entries,
//   and transitions both games from L → X

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getEnteredPlayers,
  batchUpdatePlayerEntries,
  createGameSheet,
  updateGameStatus,
  batchRemovePlayersFromGameSheet,
  updateGameSheetStats,
} from '@/lib/friendlies-sheets';
import { hasRole } from '@/lib/role-utils';

interface AllocateRequest {
  game_a_tab_name: string;
  game_b_tab_name: string;
  game_a_players: string[];  // userNames allocated to game A
  game_b_players: string[];  // userNames allocated to game B
}

// GET handler - fetch entered players from the Players sheet for both paired games
// Game sheets do not exist yet at status L, so we read from Players sheet columns
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const gameATab = searchParams.get('game_a');
    const gameBTab = searchParams.get('game_b');

    if (!gameATab || !gameBTab) {
      return NextResponse.json({ error: 'Both game_a and game_b tab names are required' }, { status: 400 });
    }

    // Read entered players from Players sheet for both games
    const [playersA, playersB] = await Promise.all([
      getEnteredPlayers(gameATab),
      getEnteredPlayers(gameBTab),
    ]);

    // Build a combined unique player list (players enter both paired games)
    const allPlayerNames = new Set<string>();
    const playerMap: Record<string, { name: string; fullName: string }> = {};

    for (const p of playersA) {
      allPlayerNames.add(p.userName);
      playerMap[p.userName] = { name: p.userName, fullName: p.fullName };
    }
    for (const p of playersB) {
      allPlayerNames.add(p.userName);
      if (!playerMap[p.userName]) {
        playerMap[p.userName] = { name: p.userName, fullName: p.fullName };
      }
    }

    const players = Array.from(allPlayerNames).map(name => playerMap[name]);

    return NextResponse.json({
      success: true,
      players,
      game_a_tab_name: gameATab,
      game_b_tab_name: gameBTab,
    });
  } catch (error) {
    console.error('Error fetching allocation data:', error);
    return NextResponse.json({ error: 'Failed to fetch allocation data' }, { status: 500 });
  }
}

// POST handler - save allocation, create game sheets, transition L → X
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body: AllocateRequest = await request.json();
    const { game_a_tab_name, game_b_tab_name, game_a_players, game_b_players } = body;

    if (!game_a_tab_name || !game_b_tab_name) {
      return NextResponse.json({ error: 'Both game tab names are required' }, { status: 400 });
    }

    // Get the full list of entered players for both games so we can clear unallocated ones
    // Run sequentially to avoid Google Sheets API quota limits
    const allPlayersA = await getEnteredPlayers(game_a_tab_name);
    const allPlayersB = await getEnteredPlayers(game_b_tab_name);

    const gameAPlayerSet = new Set(game_a_players.map(p => p.toLowerCase()));
    const gameBPlayerSet = new Set(game_b_players.map(p => p.toLowerCase()));

    // Work out who entered but was NOT allocated to each game
    const unallocatedA = allPlayersA.filter(p => !gameAPlayerSet.has(p.userName.toLowerCase()));
    const unallocatedB = allPlayersB.filter(p => !gameBPlayerSet.has(p.userName.toLowerCase()));

    // Clear their Players-sheet entries — one batched write per game instead of a
    // per-player read+write loop (the old loop exceeded the Sheets read quota)
    if (unallocatedA.length > 0) {
      await batchUpdatePlayerEntries(
        game_a_tab_name,
        unallocatedA.map(p => ({ userName: p.userName, status: '' as const })),
      );
    }
    if (unallocatedB.length > 0) {
      await batchUpdatePlayerEntries(
        game_b_tab_name,
        unallocatedB.map(p => ({ userName: p.userName, status: '' as const })),
      );
    }

    // Remove them from the game sheets — one read + one batched delete per game
    await batchRemovePlayersFromGameSheet(game_a_tab_name, unallocatedA.map(p => p.userName));
    await batchRemovePlayersFromGameSheet(game_b_tab_name, unallocatedB.map(p => p.userName));

    // Ensure all allocated players are in the game sheets (adds any missing entries).
    // Skip stats here — they're snapshotted for both games at close, just below.
    const resultA = await createGameSheet(game_a_tab_name, game_a_players, true);
    const resultB = await createGameSheet(game_b_tab_name, game_b_players, true);

    // Transition both games from L (Allocating) to X (Selecting)
    await updateGameStatus(game_a_tab_name, 'X', { modifiedBy: session.user.userName });
    await updateGameStatus(game_b_tab_name, 'X', { modifiedBy: session.user.userName });

    // Snapshot each game's display stats + hover notes now, at close (frozen after)
    await updateGameSheetStats(game_a_tab_name);
    await updateGameSheetStats(game_b_tab_name);

    return NextResponse.json({
      success: true,
      game_a_count: resultA.enteredCount,
      game_b_count: resultB.enteredCount,
    });
  } catch (error) {
    console.error('Error saving allocation:', error);
    return NextResponse.json({ error: 'Failed to save allocation' }, { status: 500 });
  }
}
