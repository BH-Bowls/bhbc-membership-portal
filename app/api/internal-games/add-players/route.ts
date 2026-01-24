// app/api/internal-games/add-players/route.ts
// API endpoint to manually add players to an internal game with 'M' status

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getInternalGames,
  batchUpdatePlayerEntries,
  getEnteredPlayers,
  getInternalGameMembers,
  updateGameCounts,
} from '@/lib/internal-games-sheets';

// POST handler - Manually add players to an internal game
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const { gameId, playerUserNames } = await request.json();

    if (!gameId || !Array.isArray(playerUserNames) || playerUserNames.length === 0) {
      return NextResponse.json(
        { error: 'gameId and playerUserNames array are required' },
        { status: 400 }
      );
    }

    // Fetch all games and find by tabName
    const allGames = await getInternalGames();
    const game = allGames.find(g => g.tabName === gameId);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Check if game is open for entries
    if (game.status !== 'O') {
      return NextResponse.json(
        { error: 'Can only add players to open games' },
        { status: 400 }
      );
    }

    // Check capacity restrictions (regular players only)
    const isUnrestricted = ['Captain', 'Admin'].includes(session.user.role);

    if (!isUnrestricted) {
      const maxPlayers = game.maxPlayers || 0;
      if (maxPlayers > 0) {
        const enteredPlayers = await getEnteredPlayers(game.tabName);
        const currentCount = enteredPlayers.length;
        const newCount = currentCount + playerUserNames.length;

        if (newCount > maxPlayers) {
          return NextResponse.json(
            {
              error: `Cannot add ${playerUserNames.length} player(s). Game capacity: ${maxPlayers}, current: ${currentCount}`,
            },
            { status: 400 }
          );
        }
      }
    }

    // Check gender eligibility if game has restrictions
    // Skip check for Mixed/Both games - all playing members allowed
    if (game.ladiesMen && !['Mixed', 'Both'].includes(game.ladiesMen)) {
      const allMembers = await getInternalGameMembers();
      for (const userName of playerUserNames) {
        const member = allMembers.find(m => m.userName === userName);
        if (member && member.memberType) {
          const memberType = member.memberType.toUpperCase();
          // Member types: PL=Playing Lady, PM=Playing Man, SL=Social Lady, SM=Social Man
          const isEligible =
            (game.ladiesMen === 'Ladies' && (memberType.endsWith('L') || memberType === 'FULL')) ||
            (game.ladiesMen === 'Men' && (memberType.endsWith('M') || memberType === 'FULL'));

          if (!isEligible) {
            return NextResponse.json(
              { error: `Player ${userName} is not eligible for this ${game.ladiesMen} game` },
              { status: 400 }
            );
          }
        }
      }
    }

    // Add all players with 'M' status in a single batch
    const entries = playerUserNames.map(userName => ({ userName, status: 'M' }));
    await batchUpdatePlayerEntries(game.tabName, entries);

    // Update the entered count in Games sheet
    try {
      const enteredPlayers = await getEnteredPlayers(game.tabName);
      await updateGameCounts(game.tabName, { entered: enteredPlayers.length });
    } catch (countError) {
      console.error('[Internal Games API] Error updating entered count:', countError);
      // Don't fail the request, players were added successfully
    }

    return NextResponse.json({
      success: true,
      added_count: playerUserNames.length,
    });
  } catch (error) {
    console.error('[Internal Games API] Error adding players:', error);
    return NextResponse.json(
      { error: 'Failed to add players' },
      { status: 500 }
    );
  }
}
