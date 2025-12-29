// app/api/friendlies/manage/status/route.ts
// API endpoint for captains to change game status through the full lifecycle
// Status flow: blank → O (Open) → X (Selecting) → S (Selected) → P (Played)
// Alternative endings: C (Cancelled) or A (Abandoned)
// Each transition creates necessary Google Sheets structures and enforces business rules

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getGames,
  updateGameStatus,
  createGameColumn,
  createGameSheet,
} from '@/lib/friendlies-sheets';
import { ChangeStatusRequest, ChangeStatusResponse, GameStatus } from '@/lib/types/friendlies';

// POST handler - Changes game status with validation and sheet creation
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can change game status
    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body
    const body: ChangeStatusRequest = await request.json();
    const { tab_name, action, bhbc_score, opponent_score, reason, who } = body;

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

    // Get current status (empty string if not set)
    let currentStatus = game.status;
    if (!currentStatus) {
      currentStatus = '';
    }

    // Track new status and whether game sheet was created
    let newStatus: GameStatus = currentStatus;
    let gameSheetCreated = false;

    // Handle different status transition actions with validation and sheet operations
    switch (action) {
      // OPEN: Transition from blank to 'O' (Open for player entries)
      case 'open':
        // Validate that game is currently blank (not already opened or in later stage)
        if (currentStatus !== '') {
          return NextResponse.json(
            { error: 'Can only open games with blank status' },
            { status: 400 }
          );
        }

        // Set new status to Open
        newStatus = 'O';

        // Create a new column in Players sheet for this game
        // Players will use this column to mark their entry status (E, P, R, etc.)
        await createGameColumn(game.tabName);
        break;

      // CLOSE: Transition from 'O' (Open) to 'X' (Selecting/Closed for entries)
      case 'close':
        // Validate that game is currently Open
        if (currentStatus !== 'O') {
          return NextResponse.json(
            { error: 'Can only close games with Open status' },
            { status: 400 }
          );
        }

        // Set new status to Selecting (closed for new entries)
        newStatus = 'X';

        // Create dedicated game sheet (tab) for team selection
        // This sheet will hold all entered players with teams, positions, etc.
        await createGameSheet(game.tabName);
        gameSheetCreated = true;
        break;

      // PUBLISH: Transition from 'X' (Selecting) to 'S' (Selected/Published team)
      case 'publish':
        // Validate that game is currently in Selecting status
        if (currentStatus !== 'X') {
          return NextResponse.json(
            { error: 'Can only publish games with Selecting status' },
            { status: 400 }
          );
        }

        // Set new status to Selected (team has been picked and published)
        newStatus = 'S';
        break;

      // PLAYED: Transition from 'S' (Selected) to 'P' (Played/Completed)
      case 'played':
        // Validate that game is currently Selected (team was published)
        if (currentStatus !== 'S') {
          return NextResponse.json(
            { error: 'Can only mark Selected games as played' },
            { status: 400 }
          );
        }

        // Validate that both scores are provided (required for completed games)
        if (bhbc_score === undefined || opponent_score === undefined) {
          return NextResponse.json(
            { error: 'Scores required for played status' },
            { status: 400 }
          );
        }

        // Set new status to Played
        newStatus = 'P';
        break;

      // CANCEL: Transition to 'C' (Cancelled) - can happen from any status
      case 'cancel':
        // Validate that cancellation reason and who cancelled are provided
        if (!reason || !who) {
          return NextResponse.json(
            { error: 'Reason and who required for cancelled status' },
            { status: 400 }
          );
        }

        // Set new status to Cancelled
        newStatus = 'C';
        break;

      // ABANDON: Transition from 'S' (Selected) to 'A' (Abandoned)
      case 'abandon':
        // Validate that game is currently Selected (was being played)
        if (currentStatus !== 'S') {
          return NextResponse.json(
            { error: 'Can only abandon Selected games' },
            { status: 400 }
          );
        }

        // Validate that abandonment reason and partial scores are provided
        // Abandoned games had started but didn't finish (weather, injury, etc.)
        if (!reason || bhbc_score === undefined || opponent_score === undefined) {
          return NextResponse.json(
            { error: 'Reason and partial scores required for abandoned status' },
            { status: 400 }
          );
        }

        // Set new status to Abandoned
        newStatus = 'A';
        break;

      // Reject invalid action names
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Update the game status in the Games sheet along with any additional data
    await updateGameStatus(game.tabName, newStatus, {
      bhbcScore: bhbc_score,        // Our score (for played/abandoned games)
      opponentScore: opponent_score, // Opponent score (for played/abandoned games)
      reason,                        // Reason for cancellation/abandonment
      who,                          // Who initiated cancellation
      modifiedBy: session.user.userName, // Track who made this status change
    });

    // Build success response with new status and whether game sheet was created
    const response: ChangeStatusResponse = {
      success: true,
      new_status: newStatus,            // The new status code (O, X, S, P, C, or A)
      game_sheet_created: gameSheetCreated, // True if game sheet was created (close action)
    };

    // Return success response to client
    return NextResponse.json(response);
  } catch (error) {
    // Log error details for debugging
    console.error('Error updating game status:', error);

    // Return 500 error response to client
    return NextResponse.json(
      { error: 'Failed to update game status' },
      { status: 500 }
    );
  }
}
