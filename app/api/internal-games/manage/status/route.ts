// app/api/internal-games/manage/status/route.ts
// API endpoint for captains to change internal game status through the lifecycle
// Status flow: blank → O (Open) → X (Selecting) → S (Selected) → P (Played)
// Alternative endings: C (Cancelled) or A (Abandoned)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getInternalGames,
  updateGameStatus,
  createGameColumn,
  createGameSheet,
} from '@/lib/internal-games-sheets';
import type { GameStatus } from '@/lib/game-management/types';

interface ChangeStatusRequest {
  tab_name?: string;
  row_number?: number;
  action: 'open' | 'close' | 'publish' | 'played' | 'cancel' | 'abandon';
  reason?: string;
  who?: string;
}

interface ChangeStatusResponse {
  success: boolean;
  new_status: GameStatus;
  game_sheet_created: boolean;
}

// POST handler - Changes game status with validation and sheet creation
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can change game status
    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body
    const body: ChangeStatusRequest = await request.json();
    const { tab_name, row_number, action, reason, who } = body;

    // Fetch all games from Games sheet
    const games = await getInternalGames();

    // Search for the game by tabName or rowNumber
    let game = null;

    // First try to find by tabName if provided
    if (tab_name && tab_name.trim() !== '') {
      game = games.find(g => g.tabName === tab_name) || null;
    }

    // If not found and rowNumber provided, find by rowNumber
    if (!game && row_number) {
      game = games.find(g => g._rowNumber === row_number) || null;
    }

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Generate effectiveTabName
    // Format: "GameName DD MMM YY" (e.g., "Club Championship 13 Jan 25")
    let tabDatePart = game.tabDate || '';

    if (!tabDatePart || tabDatePart.trim() === '') {
      // Parse date from DD/MM/YYYY format
      const formatTabDate = (dateStr: string): string => {
        if (!dateStr) return '';

        const parts = dateStr.split('/');
        if (parts.length === 3) {
          const day = parts[0].padStart(2, '0');
          const month = parts[1];
          let year = parts[2];
          if (year.length === 4) {
            year = year.slice(-2);
          }
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const monthIndex = parseInt(month, 10) - 1;
          const monthName = monthNames[monthIndex] || month;
          return `${day} ${monthName} ${year}`;
        }

        return '';
      };

      tabDatePart = formatTabDate(game.date);
    }

    const effectiveTabName = `${game.gameName} ${tabDatePart}`.trim();

    // Get current status
    let currentStatus = game.status;
    if (!currentStatus) {
      currentStatus = '';
    }

    // Track new status and whether game sheet was created
    let newStatus: GameStatus = currentStatus;
    let gameSheetCreated = false;

    // Handle status transitions
    switch (action) {
      case 'open':
        if (currentStatus !== '') {
          return NextResponse.json(
            { error: 'Can only open games with blank status' },
            { status: 400 }
          );
        }
        newStatus = 'O';
        await createGameColumn(effectiveTabName);
        break;

      case 'close':
        if (currentStatus !== 'O') {
          return NextResponse.json(
            { error: 'Can only close games with Open status' },
            { status: 400 }
          );
        }
        newStatus = 'X';
        await createGameSheet(effectiveTabName);
        gameSheetCreated = true;
        break;

      case 'publish':
        if (currentStatus !== 'X') {
          return NextResponse.json(
            { error: 'Can only publish games with Selecting status' },
            { status: 400 }
          );
        }
        newStatus = 'S';
        break;

      case 'played':
        if (currentStatus !== 'S') {
          return NextResponse.json(
            { error: 'Can only mark Selected games as played' },
            { status: 400 }
          );
        }
        newStatus = 'P';
        break;

      case 'cancel':
        if (!reason || !who) {
          return NextResponse.json(
            { error: 'Reason and who required for cancelled status' },
            { status: 400 }
          );
        }
        newStatus = 'C';
        break;

      case 'abandon':
        if (currentStatus !== 'S') {
          return NextResponse.json(
            { error: 'Can only abandon Selected games' },
            { status: 400 }
          );
        }
        if (!reason) {
          return NextResponse.json(
            { error: 'Reason required for abandoned status' },
            { status: 400 }
          );
        }
        newStatus = 'A';
        break;

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Update the game status
    await updateGameStatus(effectiveTabName, newStatus, {
      reason,
      who,
      modifiedBy: session.user.userName,
      rowNumber: game._rowNumber,
    });

    const response: ChangeStatusResponse = {
      success: true,
      new_status: newStatus,
      game_sheet_created: gameSheetCreated,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error updating game status:', error);
    return NextResponse.json(
      { error: 'Failed to update game status' },
      { status: 500 }
    );
  }
}
