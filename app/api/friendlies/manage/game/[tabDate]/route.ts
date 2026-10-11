// GET /api/friendlies/manage/game/[tabDate] - Get game for team selection
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGameSheet, getGroupFixtures, fixtureDisplayName } from '@/lib/fixture-groups-supabase';
import { getFixtureByTabName, getTeaRotaEntry } from '@/lib/fixtures-supabase';
import { canManageGame, getSquadForFixture } from '@/lib/squads-supabase';

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

    const { tabDate } = await params;
    // Note: Despite the param name, this is actually the tabName (sheet name)
    const tabName = decodeURIComponent(tabDate);

    // Get fixture details
    const game = await getFixtureByTabName(tabName);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Captain/Admin, or — for a league / Club Team game — the squad's organisers
    if (!(await canManageGame(game, session.user.userName, session.user.role))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const squad = await getSquadForFixture(game);

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
    // (A squad's other fixtures are separate games, not linked ones — nothing shared.)
    const groupGames = game.groupId && !squad
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
        // League / Club Team game: the squad, and its teas (home games — any two squad members)
        squad: squad ? { id: squad.id, label: squad.label, squadType: squad.squadType } : null,
        teas: squad && game.homeAway === 'H' ? await squadTeas(game.id) : null,
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

/** League teas for a home squad game: the two tea usernames ('' when not set). */
async function squadTeas(fixtureId: string): Promise<{ lead: string; first: string }> {
  const entry = await getTeaRotaEntry(fixtureId);
  return { lead: entry ? entry.teaLead : '', first: entry ? entry.teaFirst : '' };
}
