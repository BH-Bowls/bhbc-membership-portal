// app/api/friendlies/manage/update-selection/route.ts
// API endpoint for captains to update player selections, teams, positions, and driving assignments
// Handles the team selection process including validation and count updates in Games sheet
// Returns sorted player list for immediate UI update

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGameSheet, updateGameSheet } from '@/lib/friendlies-sheets';
import { getFixtureByTabName, updateFixture } from '@/lib/fixtures-supabase';
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

    // Fetch the fixture. Postgres reads are always fresh — the lock guard below checks
    // game.lockedBy, which must be current so a stale cache can't let a captain save
    // selections for a game another captain now holds the lock on.
    const game = await getFixtureByTabName(tab_name);

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

    // Reconcile the save against a FRESH read of the game sheet. The captain's page
    // may have been open while things changed underneath it — a player withdrew, or
    // the captain used the manage-users tools to add/remove/withdraw someone. We key
    // by player name (not the client's row_number, which shifts when a row is deleted):
    //   - Player no longer on the sheet (removed via manage-users) → skip; don't recreate.
    //   - Player now Withdrawn ('W') → keep them withdrawn (FORCE status='W'; a save can
    //     never un-withdraw them). A withdrawn Reserve ('R') is cleared to blank (they no
    //     longer hold a reserve slot); a withdrawn Playing player keeps 'Y' so the captain
    //     still sees the vacancy to fill.
    //   - Otherwise apply the captain's change at the player's CURRENT row number.
    // Players added via manage-users after the page loaded aren't in the payload, so
    // they're simply left untouched.
    const livePlayers = await getGameSheet(game.tabName);
    const liveByName = new Map(livePlayers.map(p => [p.name.toLowerCase(), p]));

    const mappedSelections: Array<{
      rowNumber: number;
      selected?: string;
      team?: number | null;
      position?: string;
      driving?: string;
      carNumber?: string;
      status?: string;
    }> = [];
    for (const s of selections) {
      // Prefer name (robust to row shifts); fall back to row number for an older client.
      const live = s.user_name
        ? liveByName.get(s.user_name.toLowerCase())
        : livePlayers.find(p => p.rowNumber === s.row_number);
      if (!live) continue;              // removed via manage-users — don't recreate
      const isWithdrawn = live.status === 'W';
      mappedSelections.push({
        rowNumber: live.rowNumber,       // current row (survives deletes shifting rows up)
        // A withdrawn Reserve is cleared to blank; a withdrawn Playing player keeps 'Y'
        // so the captain still sees the vacancy to fill.
        selected: (isWithdrawn && s.selected === 'R') ? '' : s.selected,
        team: s.team,
        position: s.position,
        driving: s.driving,
        carNumber: s.car_number,
        // A withdrawn player stays withdrawn — a selection save can never un-withdraw
        // them (that's what the player's Re-join action is for).
        status: isWithdrawn ? 'W' : s.status,
      });
    }

    // Update the game sheet with all reconciled selection changes in a single batch
    await updateGameSheet(game.tabName, mappedSelections);

    // Write captain of the day to the fixture (captain_username = '' clears the field)
    if (captain_username !== undefined) {
      await updateFixture(game.id, { captain: captain_username });
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

    // Calculate updated counts for Games sheet summary columns. Withdrawn players keep
    // their role now, so exclude status 'W' from both counts.
    // Count players marked as 'Y' (selected to play)
    const selectedCount = allPlayers.filter(p => p.selected === 'Y' && p.status !== 'W').length;

    // Count players marked as 'R' (reserve) or 'T' (reserve team)
    const reservesCount = allPlayers.filter(p => ['R', 'T'].includes(p.selected) && p.status !== 'W').length;

    // Update the selected and reserves counts on the fixture
    await updateFixture(game.id, {
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
