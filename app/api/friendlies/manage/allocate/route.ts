// app/api/friendlies/manage/allocate/route.ts
// API endpoint for captains to allocate players between two paired games
// NEW FLOW: Games are in status 'L' (Allocating) — game sheets do NOT exist yet.
// GET: reads entered players from the Players sheet (both game columns)
// POST: creates game sheets with only allocated players, clears unallocated entries,
//   and transitions both games from L → X

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getEnteredPlayers,
  updatePlayerEntry,
  createGameSheet,
  updateGameStatus,
} from '@/lib/friendlies-sheets';

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
    if (!['Captain', 'Admin'].includes(session.user.role)) {
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
    if (!['Captain', 'Admin'].includes(session.user.role)) {
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

    // Clear Players sheet entries for players NOT allocated to each game
    // Run sequentially to avoid quota limits (each call makes multiple Sheets API reads)
    for (const p of allPlayersA) {
      if (!gameAPlayerSet.has(p.userName.toLowerCase())) {
        await updatePlayerEntry(p.userName, game_a_tab_name, '');
      }
    }
    for (const p of allPlayersB) {
      if (!gameBPlayerSet.has(p.userName.toLowerCase())) {
        await updatePlayerEntry(p.userName, game_b_tab_name, '');
      }
    }

    // Create game sheets with only the allocated players (sequentially)
    const resultA = await createGameSheet(game_a_tab_name, game_a_players);
    const resultB = await createGameSheet(game_b_tab_name, game_b_players);

    // Transition both games from L (Allocating) to X (Selecting)
    await updateGameStatus(game_a_tab_name, 'X', { modifiedBy: session.user.userName });
    await updateGameStatus(game_b_tab_name, 'X', { modifiedBy: session.user.userName });

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
