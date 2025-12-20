// POST /api/friendlies/manage/update-selection - Update team selections (Captain/Admin only)
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, updateGameSheet, updateGameCounts } from '@/lib/friendlies-sheets';
import { UpdateSelectionRequest, UpdateSelectionResponse } from '@/lib/types/friendlies';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is Captain or Admin
    if (!['Captain', 'Admin'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body: UpdateSelectionRequest = await request.json();
    const { tab_date, selections } = body;

    // Get game details
    const games = await getGames();
    const game = games.find(g => g.tabDate === tab_date);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Verify game status is X or S
    if (!['X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Can only update selection for Selecting or Selected games' },
        { status: 400 }
      );
    }

    // Validate captain selection (only one player can have captain = "Y")
    const captains = selections.filter(s => s.captain === 'Y');
    if (captains.length > 1) {
      return NextResponse.json(
        { error: 'Only one player can be designated as captain of the day' },
        { status: 400 }
      );
    }

    // Map snake_case to camelCase for updateGameSheet
    const mappedSelections = selections.map(s => ({
      rowNumber: s.row_number,
      selected: s.selected,
      team: s.team,
      position: s.position,
      driving: s.driving,
      carNumber: s.car_number,
      captain: s.captain,
    }));

    // Update game sheet
    await updateGameSheet(game.tabName, mappedSelections);

    // Get updated players and sort them
    const allPlayers = await getGameSheet(game.tabName);

    // Sort by: Selected (Y/R/T/blank), Team, Position
    const selectionOrder = { 'Y': 0, 'R': 1, 'T': 2, '': 3 };
    const positionOrder = { 'S': 0, '1': 1, '2': 2, '3': 3, '': 4 };

    const sortedPlayers = [...allPlayers].sort((a, b) => {
      // First sort by selection status
      const selA = selectionOrder[a.selected] ?? 3;
      const selB = selectionOrder[b.selected] ?? 3;
      if (selA !== selB) return selA - selB;

      // Then by team number
      const teamA = a.team ?? 999;
      const teamB = b.team ?? 999;
      if (teamA !== teamB) return teamA - teamB;

      // Then by position
      const posA = positionOrder[a.position] ?? 4;
      const posB = positionOrder[b.position] ?? 4;
      return posA - posB;
    });

    // Update counts in Games sheet
    const selectedCount = allPlayers.filter(p => p.selected === 'Y').length;
    const reservesCount = allPlayers.filter(p => ['R', 'T'].includes(p.selected)).length;

    await updateGameCounts(tab_date, {
      selected: selectedCount,
      reserves: reservesCount,
    });

    const response: UpdateSelectionResponse = {
      success: true,
      sorted_players: sortedPlayers,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error updating selection:', error);
    return NextResponse.json(
      { error: 'Failed to update selection' },
      { status: 500 }
    );
  }
}
