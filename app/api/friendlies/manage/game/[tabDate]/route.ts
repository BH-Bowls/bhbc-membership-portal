// GET /api/friendlies/manage/game/[tabDate] - Get game for team selection
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGameSheet, getGroupFixtures, fixtureDisplayName } from '@/lib/fixture-groups-supabase';
import { getFixtureByTabName } from '@/lib/fixtures-supabase';
import { hasRole } from '@/lib/role-utils';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tabDate: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    // Check if user is logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user is Captain or Admin
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { tabDate } = await params;
    // Note: Despite the param name, this is actually the tabName (sheet name)
    const tabName = decodeURIComponent(tabDate);

    // Get fixture details
    const game = await getFixtureByTabName(tabName);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Verify game status is X, S, or C (Selecting, Selected, or Cancelled)
    if (!['X', 'S', 'C'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Game must be in Selecting, Selected, or Cancelled status' },
        { status: 400 }
      );
    }

    const players = await getGameSheet(game.tabName);

    // Entries live in one table now, so the old Players-sheet vs game-sheet orphan
    // check can't find anything — kept in the response shape for the page.
    const orphanedEntries: { userName: string; fullName: string }[] = [];

    // Mark captain from Games sheet (game.captain = userName).
    // If the Games sheet has no captain yet, fall back to game sheet captain field (legacy data).
    if (game.captain) {
      for (const p of players) {
        p.captain = p.name === game.captain ? 'Y' : '';
      }
    }
    // (If game.captain is empty, getGameSheet() has already populated captain from the game sheet row)

    // Sort players: Selected status (Y, R, T, then blank) → Team number → Position → Surname.
    const selectedOrder: Record<string, number> = { 'Y': 1, 'R': 2, 'T': 3, '': 4 };
    const positionOrder: Record<string, number> = { 'S': 1, '1': 2, '2': 3, '3': 4, '': 5 };

    players.sort((a, b) => {
      // Selected status
      const selA = selectedOrder[a.selected] ?? 4;
      const selB = selectedOrder[b.selected] ?? 4;
      if (selA !== selB) return selA - selB;

      // Team number (nulls last)
      const teamA = a.team ?? 999;
      const teamB = b.team ?? 999;
      if (teamA !== teamB) return teamA - teamB;

      // Position
      const posA = positionOrder[a.position] ?? 5;
      const posB = positionOrder[b.position] ?? 5;
      if (posA !== posB) return posA - posB;

      // Final tiebreaker: surname then full name
      const lastNameCompare = (a.lastName || a.fullName).localeCompare(b.lastName || b.fullName);
      if (lastNameCompare !== 0) return lastNameCompare;
      return a.fullName.localeCompare(b.fullName);
    });

    // The other games in this game's group (linked games / reserve games). Their
    // reserves are this game's reserves — one shared pool — so there's nothing to move
    // between them: a reserve picked here simply drops off the other games' lists.
    const groupGames = game.groupId
      ? (await getGroupFixtures(game.groupId))
          .filter(g => g.id !== game.id)
          .map(g => ({
            tabName: g.tabName,
            name: fixtureDisplayName(g),
            status: g.status,
            selected: g.selected,
            isReserve: !!g.reserveOf,
          }))
      : [];

    return NextResponse.json({
      orphanedEntries,
      game: {
        tabDate: game.tabDate,
        date: game.date,
        time: game.time,
        clubName: game.clubName,
        description: game.description,
        homeAway: game.homeAway,
        format: game.format,
        ladiesMen: game.ladiesMen,
        dress: game.dress,
        status: game.status,
        tabName: game.tabName,
        entered: game.entered,
        selected: game.selected,
        reserves: game.reserves,
        groupGames,
        isReserve: game.isReserve, // a reserve game supplies both sides: teams × 2
        pickupInfo: game.pickupInfo || '',
        specialInstructions: game.specialInstructions || '',
      },
      players,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch game' },
      { status: 500 }
    );
  }
}
