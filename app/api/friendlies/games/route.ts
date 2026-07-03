// app/api/friendlies/games/route.ts
// API endpoint to fetch all games with optional status filtering and user's entry status
// Used by the main Friendlies page to display available games to players

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getPlayerEntries, getGameSheet, getTeaRotaList } from '@/lib/friendlies-sheets';
import { getClubs } from '@/lib/clubs-sheets';
import { GameStatus, GameType } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';

// GET handler - Returns list of games with user's entry status for each
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    // Extract query parameters from URL
    const { searchParams } = new URL(request.url);

    // Get optional status filter (e.g., ?status=O for Open games only)
    const statusFilter = searchParams.get('status') as GameStatus | null;

    // Admins also see Test games; all other roles see Friendly only
    const isAdmin = hasRole(session?.user?.role, 'Admin');
    const typeFilter: GameType[] = isAdmin ? ['Friendly', 'Test'] : ['Friendly'];

    // Fetch games and club details in parallel
    const [games, clubs] = await Promise.all([
      getGames(statusFilter ?? undefined, typeFilter),
      getClubs().catch(() => []),   // petrol cost is non-critical; don't fail if clubs sheet absent
    ]);

    // Build club-name → petrolCost lookup for away game display
    const petrolMap = new Map<string, number>(
      clubs.filter(c => c.petrolCost > 0).map(c => [c.clubName, c.petrolCost])
    );

    // Tea rota is derived from the same Games sheet. The getGames call above already
    // warmed the 90s Games cache, so this reuses it (no extra read) — merged here so the
    // friendlies page gets its tea-duty info in this response instead of a separate
    // /api/tea-rota call (which was a second, un-shareable Games read per page load).
    const userName = session?.user?.userName ?? '';
    const teaDutyDates: string[] = [];
    if (userName) {
      const teaEntries = await getTeaRotaList({ includeCancelled: true });
      const seen = new Set<string>();
      for (const e of teaEntries) {
        const onDuty = e.teaLead === userName || e.teaFirst === userName || e.teaSecond === userName;
        if (onDuty && !seen.has(e.date)) {
          seen.add(e.date);
          teaDutyDates.push(e.date);
        }
      }
    }

    // For guests (no session) return games without user entry status
    if (!session?.user?.userName) {
      const gamesWithUserStatus = games.map(game => ({
        ...game,
        petrolCost: game.homeAway === 'A' ? (petrolMap.get(game.clubName) ?? null) : null,
        userEntered: false,
        userStatus: null,
        userConfirmed: null,
      }));
      return NextResponse.json({ games: gamesWithUserStatus, teaDutyDates });
    }

    // Fetch all entries for this user from Players sheet
    const userEntries = await getPlayerEntries(session.user.userName);

    // Combine game data with user's entry status
    const gamesWithEntry = games.map(game => {
      let entry = null;
      for (const e of userEntries) {
        if (e.tabName === game.tabName) { entry = e; break; }
      }
      return { game, entry };
    });

    // For S-status games where user is selected (P/R/T), read the game sheet to check confirmation
    const confirmationMap = new Map<string, boolean>();
    const selectedStatusGames = gamesWithEntry.filter(
      ({ game, entry }) => game.status === 'S' && entry && ['P', 'R', 'T'].includes(entry.status)
    );
    await Promise.all(selectedStatusGames.map(async ({ game }) => {
      try {
        const gameSheet = await getGameSheet(game.tabName);
        const userPlayer = gameSheet.find(p => p.name === session.user.userName);
        confirmationMap.set(game.tabName, userPlayer?.status === 'Y' || false);
      } catch {
        // If game sheet read fails, leave confirmation as null
      }
    }));

    const gamesWithUserStatus = gamesWithEntry.map(({ game, entry }) => ({
      ...game,
      petrolCost: game.homeAway === 'A' ? (petrolMap.get(game.clubName) ?? null) : null,
      userEntered: !!entry,
      userStatus: entry?.status ?? null,
      userConfirmed: confirmationMap.has(game.tabName) ? confirmationMap.get(game.tabName)! : null,
    }));

    // Return success response with games array + the user's tea-duty dates
    return NextResponse.json({ games: gamesWithUserStatus, teaDutyDates });
  } catch (error) {
    // Log error and return 500 response
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
