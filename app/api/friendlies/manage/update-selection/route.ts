// app/api/friendlies/manage/update-selection/route.ts
// API endpoint for captains to update player selections, teams, positions, and driving assignments
// Handles the team selection process including validation and count updates in Games sheet
// Returns sorted player list for immediate UI update

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, updateGameSheet, updateGameCounts, updateCaptain } from '@/lib/friendlies-sheets';
import { UpdateSelectionRequest, UpdateSelectionResponse } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';

// POST handler - Updates player selections and team assignments for a game
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can update team selections
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body to get game identifier and selection updates
    const body: UpdateSelectionRequest = await request.json();
    const { tab_name, captain_username, selections } = body;

    // Fetch all games from Games sheet. Fresh read — the lock guard below checks
    // game.lockedBy, which must be current so a stale cache can't let a captain save
    // selections for a game another captain now holds the lock on.
    const games = await getGames(undefined, undefined, true);

    // Search for the game matching the provided tab_name
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

    // Lock guard: only the captain who holds the lock may save selections.
    // If the game has no lock columns yet (lockedBy is always ''), we skip the check.
    if (game.lockedBy && game.lockedBy !== session.user.userName) {
      return NextResponse.json(
        { error: 'locked', lockedBy: game.lockedBy, lockedAt: game.lockedAt },
        { status: 409 },
      );
    }

    // Validate that game is in a status that allows selection updates
    // X = Selecting (captain is picking team), S = Selected (team published, can still adjust)
    if (!['X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Can only update selection for Selecting or Selected games' },
        { status: 400 }
      );
    }

    // Transform request data from snake_case to camelCase for updateGameSheet function
    // This maps the API contract (snake_case) to internal function parameters (camelCase)
    const mappedSelections = selections.map(s => ({
      rowNumber: s.row_number,       // Row number in game sheet
      selected: s.selected,           // Selection status: Y=Playing, R=Reserve, T=Reserve Team
      team: s.team,                   // Team number (1-4 typically)
      position: s.position,           // Position code: S=Skip, 1=Lead, 2=Two, 3=Three
      driving: s.driving,             // Driving status: D=Driver, B=Bar, blank=neither
      carNumber: s.car_number,        // Car number for drivers
      status: s.status,               // Confirmation status: Y=Confirmed, W=Withdrawn
    }));

    // Update the game sheet with all selection changes in a single batch operation
    await updateGameSheet(game.tabName, mappedSelections);

    // Write captain of the day to the Games sheet (captain_username = '' clears the field)
    if (captain_username !== undefined) {
      await updateCaptain(game.tabName, captain_username);
    }

    // Fetch the updated player list from the game sheet to return to client
    const allPlayers = await getGameSheet(game.tabName);

    // Mark the captain on the returned player list (captain is now in Games sheet, not game sheet)
    if (captain_username !== undefined) {
      for (const p of allPlayers) {
        p.captain = captain_username && p.name === captain_username ? 'Y' : '';
      }
    }

    // Define sort priority orders for logical team display
    // Selection status priority: Playing first, then Reserves, then Reserve Team, then unselected
    const selectionOrder: Record<string, number> = { 'Y': 0, 'R': 1, 'T': 2, '': 3, 'O': 4 };

    // Position priority: Skip first, then Lead, Two, Three, then unassigned
    const positionOrder = { 'S': 0, '1': 1, '2': 2, '3': 3, '': 4 };

    // Sort players for display: Selected status → Team number → Position → Surname
    const sortedPlayers = [...allPlayers].sort((a, b) => {
      let selA = selectionOrder[a.selected];
      if (selA === undefined) selA = 3;

      let selB = selectionOrder[b.selected];
      if (selB === undefined) selB = 3;

      if (selA !== selB) return selA - selB;

      let teamA = a.team;
      if (teamA === undefined || teamA === null) teamA = 999;

      let teamB = b.team;
      if (teamB === undefined || teamB === null) teamB = 999;

      if (teamA !== teamB) return teamA - teamB;

      let posA = positionOrder[a.position];
      if (posA === undefined) posA = 4;

      let posB = positionOrder[b.position];
      if (posB === undefined) posB = 4;

      if (posA !== posB) return posA - posB;

      // Final tiebreaker: surname then full name
      const lastNameCompare = (a.lastName || a.fullName).localeCompare(b.lastName || b.fullName);
      if (lastNameCompare !== 0) return lastNameCompare;
      return a.fullName.localeCompare(b.fullName);
    });

    // Calculate updated counts for Games sheet summary columns
    // Count players marked as 'Y' (selected to play)
    const selectedCount = allPlayers.filter(p => p.selected === 'Y').length;

    // Count players marked as 'R' (reserve) or 'T' (reserve team)
    const reservesCount = allPlayers.filter(p => ['R', 'T'].includes(p.selected)).length;

    // Update the selected and reserves count columns in Games sheet
    await updateGameCounts(game.tabName, {
      selected: selectedCount,
      reserves: reservesCount,
    });

    // Build success response with sorted player list for immediate UI update
    const response: UpdateSelectionResponse = {
      success: true,
      sorted_players: sortedPlayers, // Sorted list ready for display
    };

    // Return success response to client
    return NextResponse.json(response);
  } catch (error) {
    // Log error details for debugging
    console.error('Error updating selection:', error);

    // Return 500 error response to client
    return NextResponse.json(
      { error: 'Failed to update selection' },
      { status: 500 }
    );
  }
}
