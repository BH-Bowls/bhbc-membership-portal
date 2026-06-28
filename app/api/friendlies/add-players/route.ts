// app/api/friendlies/add-players/route.ts
// API endpoint for players to manually add other players to a game
// Optimized to add players to both Players sheet AND game sheet in one call

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAppUrl } from '@/lib/app-url';
import { getGames, batchUpdatePlayerEntries, addPlayersToGameSheetDirect, updateGameCounts, getActiveEnteredCount } from '@/lib/friendlies-sheets';
import { canEnterGame } from '@/lib/game-management/capacity';
import { hasRole } from '@/lib/role-utils';
import { getAllUsers } from '@/lib/sheets';
import { sendEntryConfirmedEmail } from '@/lib/email/friendlies';

// POST handler - Adds players with M (manually added) status
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { gameId, playerUserNames } = body;

    // Validate input
    if (!gameId || !Array.isArray(playerUserNames) || playerUserNames.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }

    // Fetch all games to verify game exists and is open
    const allGames = await getGames();
    const game = allGames.find(g => g.tabName === gameId);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Check capacity limits (captains/admins bypass capacity)
    const isCaptainOrAdmin = hasRole(session.user.role, 'Captain', 'Admin');

    // Only allow adding to open games, or Selecting/Selected games for captains/admins
    if (game.status !== 'O') {
      if (!isCaptainOrAdmin || !['X', 'S'].includes(game.status)) {
        return NextResponse.json({ error: 'Game is not open for entry' }, { status: 400 });
      }
    }

    if (!isCaptainOrAdmin && game.maxPlayers && game.maxPlayers > 0) {
      const capacityCheck = canEnterGame(game, false);
      if (!capacityCheck.canEnter) {
        // Check if adding these players would exceed capacity significantly
        const availableSpots = game.maxPlayers - game.entered;
        if (playerUserNames.length > availableSpots && availableSpots > 0) {
          return NextResponse.json({
            error: `Only ${availableSpots} spot${availableSpots === 1 ? '' : 's'} available`
          }, { status: 400 });
        }
      }
    }

    // Add all players with M (manually added) status to Players sheet
    const entries = playerUserNames.map(userName => ({ userName, status: 'M' as const }));
    const batchResults = await batchUpdatePlayerEntries(game.tabName, entries);
    const results = batchResults.map(r => ({
      userName: r.userName,
      added: r.success,
      error: r.error,
    }));

    // Check if any failed
    const failed = results.filter(r => !r.added);
    if (failed.length > 0 && failed.length === results.length) {
      // All failed
      return NextResponse.json({
        success: false,
        error: 'Failed to add players',
        results
      }, { status: 500 });
    }

    // For Open/Selecting/Selected games, also add players to the individual game sheet
    if (['O', 'X', 'S'].includes(game.status)) {
      try {
        const successfulPlayers = results.filter(r => r.added).map(r => r.userName);
        await addPlayersToGameSheetDirect(game.tabName, successfulPlayers);
      } catch (gameSheetError) {
        console.error('[Friendlies API] Error adding to game sheet:', gameSheetError);
        // Don't fail - players were added to Players sheet
      }
    }

    // Recalculate entered count from the Players sheet (excludes any withdrawn
    // entries) rather than adding a delta onto the possibly-stale prior count
    const addedCount = results.filter(r => r.added).length;
    if (addedCount > 0) {
      try {
        const activeCount = await getActiveEnteredCount(game.tabName);
        await updateGameCounts(game.tabName, { entered: activeCount });
      } catch (countError) {
        console.error('[Friendlies API] Error updating entered count:', countError);
      }
    }

    // Send entry confirmation emails to each successfully added player (fire-and-forget)
    if (addedCount > 0) {
      (async () => {
        try {
          const addedUserNames = results.filter(r => r.added).map(r => r.userName);
          const allUsers = await getAllUsers();
          const appUrl = await getAppUrl();
          for (const userName of addedUserNames) {
            const user = allUsers.find(u => u.userName.toLowerCase() === userName.toLowerCase());
            if (!user?.emailAddress) continue;
            const fullName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : userName);
            await sendEntryConfirmedEmail(user.emailAddress, userName, fullName, game, appUrl, true);
          }
        } catch (emailError) {
          console.error('[add-players] Error sending entry confirmation emails:', emailError);
        }
      })();
    }

    return NextResponse.json({ success: true, results, addedToGameSheet: ['O', 'X', 'S'].includes(game.status) });
  } catch (error) {
    console.error('[Friendlies API] Error adding players:', error);
    return NextResponse.json(
      { error: 'Failed to add players' },
      { status: 500 }
    );
  }
}
