// app/api/friendlies/manage/update-selection/route.ts
// API endpoint for captains to update player selections, teams, positions, and driving assignments
// Handles the team selection process including validation and count updates in Games sheet
// Returns sorted player list for immediate UI update

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, updateGameSheet, updateGameCounts } from '@/lib/friendlies-sheets';
import { UpdateSelectionRequest, UpdateSelectionResponse } from '@/lib/types/friendlies';

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
    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body to get game identifier and selection updates
    const body: UpdateSelectionRequest = await request.json();
    const { tab_name, selections } = body;

    // Fetch all games from Games sheet
    const games = await getGames();

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

    // Validate that game is in a status that allows selection updates
    // X = Selecting (captain is picking team), S = Selected (team published, can still adjust)
    if (!['X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Can only update selection for Selecting or Selected games' },
        { status: 400 }
      );
    }

    // Validate captain of the day assignment (business rule: only one captain per game)
    // Filter selections to find players marked as captain
    const captains = selections.filter(s => s.captain === 'Y');

    // Reject if multiple players are marked as captain
    if (captains.length > 1) {
      return NextResponse.json(
        { error: 'Only one player can be designated as captain of the day' },
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
      captain: s.captain,             // Captain of day: Y or blank
    }));

    // Update the game sheet with all selection changes in a single batch operation
    await updateGameSheet(game.tabName, mappedSelections);

    // Fetch the updated player list from the game sheet to return to client
    const allPlayers = await getGameSheet(game.tabName);

    // Define sort priority orders for logical team display
    // Selection status priority: Playing first, then Reserves, then Reserve Team, then unselected
    const selectionOrder = { 'Y': 0, 'R': 1, 'T': 2, '': 3 };

    // Position priority: Skip first, then Lead, Two, Three, then unassigned
    const positionOrder = { 'S': 0, '1': 1, '2': 2, '3': 3, '': 4 };

    // Sort players for display: Selected status → Team number → Position
    // This groups playing team first, then reserves, organized by team and position
    const sortedPlayers = [...allPlayers].sort((a, b) => {
      // Primary sort: Selection status (playing vs reserve vs unselected)
      let selA = selectionOrder[a.selected];
      // Default to 3 (unselected) if status not in our order map
      if (selA === undefined) selA = 3;

      let selB = selectionOrder[b.selected];
      if (selB === undefined) selB = 3;

      // If selection status differs, sort by that
      if (selA !== selB) return selA - selB;

      // Secondary sort: Team number (groups players by their team)
      let teamA = a.team;
      // Use 999 for unassigned teams to sort them last
      if (teamA === undefined || teamA === null) teamA = 999;

      let teamB = b.team;
      if (teamB === undefined || teamB === null) teamB = 999;

      // If team differs, sort by team number
      if (teamA !== teamB) return teamA - teamB;

      // Tertiary sort: Position within team (Skip, Lead, Two, Three)
      let posA = positionOrder[a.position];
      // Default to 4 (unassigned) if position not in our order map
      if (posA === undefined) posA = 4;

      let posB = positionOrder[b.position];
      if (posB === undefined) posB = 4;

      // Final sort by position
      return posA - posB;
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
