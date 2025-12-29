// app/api/friendlies/confirm/route.ts
// API endpoint for players to confirm their participation after being selected for a game
// Updates the confirmation status column in the game sheet from blank to 'Y' (confirmed)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, updateGameSheet } from '@/lib/friendlies-sheets';
import { ConfirmParticipationRequest } from '@/lib/types/friendlies';

// POST handler - Confirms player's participation in a selected game
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: ConfirmParticipationRequest = await request.json();
    const { tab_name } = body;

    // Get current user's username
    const userName = session.user.userName;

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

    // Only allow confirmation for games in Selected (S) status
    if (game.status !== 'S') {
      return NextResponse.json(
        { error: 'Can only confirm participation for selected games' },
        { status: 400 }
      );
    }

    // Fetch all players from the game sheet
    const players = await getGameSheet(game.tabName);

    // Find this user in the game sheet
    let userPlayer = null;
    for (const p of players) {
      if (p.name === userName) {
        userPlayer = p;
        break;
      }
    }

    // Return 404 if user is not in this game
    if (!userPlayer) {
      return NextResponse.json(
        { error: 'You are not in this game' },
        { status: 404 }
      );
    }

    // Verify user has been selected to play (Y=Playing, R=Reserve, T=Reserve Team)
    if (!['Y', 'R', 'T'].includes(userPlayer.selected)) {
      return NextResponse.json(
        { error: 'You have not been selected for this game' },
        { status: 400 }
      );
    }

    // Update confirmation status to 'Y' (confirmed) in game sheet
    await updateGameSheet(game.tabName, [
      {
        rowNumber: userPlayer.rowNumber,
        status: 'Y',
      },
    ]);

    // Return success response
    return NextResponse.json({
      success: true,
      message: 'Participation confirmed',
    });
  } catch (error) {
    // Log error and return 500 response
    return NextResponse.json(
      { error: 'Failed to confirm participation' },
      { status: 500 }
    );
  }
}
