// GET /api/friendlies/manage/game/[tabDate] - Get game for team selection
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, getEnteredPlayers } from '@/lib/friendlies-sheets';
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

    // Get game details
    const games = await getGames();

    // Find the game with this tabName
    let game = null;
    for (const g of games) {
      if (g.tabName === tabName) {
        game = g;
        break;
      }
    }

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Verify game status is X or S (Selecting or Selected)
    if (!['X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Game must be in Selecting or Selected status' },
        { status: 400 }
      );
    }

    // Get all players from game sheet
    const players = await getGameSheet(game.tabName);

    // Cross-check: players with 'E' in Players sheet who are missing from the game sheet.
    // This detects race-condition entries where updatePlayerEntry succeeded but
    // addPlayerToGameSheet was overwritten by a concurrent entry at the same instant.
    let orphanedEntries: { userName: string; fullName: string }[] = [];
    try {
      const playersSheetEntries = await getEnteredPlayers(game.tabName);
      const gameSheetNames = new Set(players.map(p => p.name.toLowerCase()));
      orphanedEntries = playersSheetEntries
        .filter(p => p.status === 'E' && !gameSheetNames.has(p.userName.toLowerCase()))
        .map(p => ({ userName: p.userName, fullName: p.fullName }));
    } catch {
      // Non-critical — proceed without orphan detection if this fails
    }

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

    return NextResponse.json({
      orphanedEntries,
      game: {
        tabDate: game.tabDate,
        date: game.date,
        time: game.time,
        clubName: game.clubName,
        homeAway: game.homeAway,
        format: game.format,
        ladiesMen: game.ladiesMen,
        dress: game.dress,
        status: game.status,
        tabName: game.tabName,
        entered: game.entered,
        selected: game.selected,
        reserves: game.reserves,
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
