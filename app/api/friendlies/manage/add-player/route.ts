// app/api/friendlies/manage/add-player/route.ts
// API endpoint to add an offline player to a game sheet (captain function)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, addPlayerToGameSheet, updatePlayerEntry } from '@/lib/friendlies-sheets';
import { AddPlayerRequest } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';

// POST handler - Adds an offline player to a game sheet
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can add players
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body
    const body: AddPlayerRequest = await request.json();
    const { tab_name, user_name } = body;

    // Validate required fields
    if (!tab_name || !user_name) {
      return NextResponse.json(
        { error: 'Missing tab_name or user_name' },
        { status: 400 }
      );
    }

    // Fetch all games from Games sheet
    const games = await getGames();

    // Search for the game by tabName
    let game = null;
    for (const g of games) {
      if (g.tabName === tab_name) {
        game = g;
        break;
      }
    }

    // Return 404 if game doesn't exist
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Allow adding players to Open (O), Selecting (X), or Selected (S) games
    if (!['O', 'X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Can only add players to Open, Selecting, or Selected games' },
        { status: 400 }
      );
    }

    // Add player to game sheet with Selected='R' (deduplication handled inside)
    // This silently skips if they're already in the sheet
    await addPlayerToGameSheet(game.tabName, user_name, 'R');

    // Add 'M' (manually added) to Players column for this player
    // updatePlayerEntry skips if they already have a status in that column
    await updatePlayerEntry(user_name, game.tabName, 'M');

    // Return success response
    return NextResponse.json({
      success: true,
      message: `Player ${user_name} added to game`,
    });
  } catch (error) {
    // Log error and return 500 response
    return NextResponse.json(
      { error: 'Failed to add player' },
      { status: 500 }
    );
  }
}
