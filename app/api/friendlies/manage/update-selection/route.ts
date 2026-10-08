// app/api/friendlies/manage/update-selection/route.ts
// API endpoint for captains to update player selections, teams, positions, and driving assignments
// Handles the team selection process including validation and count updates in Games sheet
// Returns sorted player list for immediate UI update

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGameSheet, saveSelections, appendManageLog } from '@/lib/fixture-groups-supabase';
import { getFixtureByTabName, updateFixture } from '@/lib/fixtures-supabase';
import { UpdateSelectionRequest, UpdateSelectionResponse } from '@/lib/types/friendlies';
import { canManageGame, getSquadForFixture, setSquadFixtureTeas } from '@/lib/squads-supabase';

// POST handler - Updates player selections and team assignments for a game
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    // Captain/Admin, or — for a league / Club Team game — the squad's organisers
    if (!(await canManageGame(game, session.user.userName, session.user.role))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

    // Reconcile the save against a FRESH read of the roster, keyed by player name. The
    // captain's page may have been open while things changed underneath it:
    //   - Player no longer in the group (removed) → skipped; never recreated.
    //   - Withdrawal is on the entry, not the selection, so a save can never
    //     un-withdraw anyone (that's what Re-join is for).
    //   - Picking someone (Y/O) creates their selection for this game; Reserve (R) or
    //     blank deletes it, which clears team/position/driving with it.
    //   - A reserve just picked for ANOTHER game in the group comes back as a conflict.
    // Players added after the page loaded aren't in the payload, so they're untouched.
    const livePlayers = await getGameSheet(game.tabName);
    const liveByRow = new Map(livePlayers.map(p => [p.rowNumber, p]));

    const changes = [];
    for (const s of selections) {
      // Prefer name; fall back to row number for an older client.
      const byRow = liveByRow.get(s.row_number);
      const userName = s.user_name || (byRow ? byRow.name : '');
      if (!userName) continue;
      changes.push({
        username: userName,
        selected: s.selected === 'T' ? 'R' : s.selected, // reserve teams are separate games now
        team: s.team,
        position: s.position,
        driving: s.driving,
        carNumber: s.car_number,
      });
    }

    const { conflicts } = await saveSelections(game, changes);

    // League / Club Team home game: the two tea people (any squad members, playing or not)
    const teas = (body as { teas?: { lead?: string; first?: string } }).teas;
    if (teas && (await getSquadForFixture(game))) {
      await setSquadFixtureTeas(game.id, teas.lead || '', teas.first || '');
    }
    await appendManageLog({ username: session.user.userName, action: 'save-selection', tabName: game.tabName, fixtureId: game.id, groupId: game.groupId, details: { changes: changes.length, conflicts } });

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

    // Counts are live (fixture_live_counts) — nothing to write back.
    const response: UpdateSelectionResponse & { conflicts?: typeof conflicts } = {
      success: true,
      sorted_players: sortedPlayers, // Sorted list ready for display
      ...(conflicts.length > 0 ? { conflicts } : {}),
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
