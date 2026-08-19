// app/api/friendlies/games/route.ts
// API endpoint to fetch all games with optional status filtering and user's entry status
// Used by the main Friendlies page to display available games to players

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getPlayerEntries, getGameSheet } from '@/lib/friendlies-sheets';
import { getFixtures, getTeaRotaList } from '@/lib/fixtures-supabase';
import { getClubs } from '@/lib/clubs-supabase';
import { GameStatus, GameType, FriendliesBuddy } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';
import { getAllUsers } from '@/lib/members-supabase';
import { canManageUser } from '@/lib/buddies-supabase';

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

    // Fetch games and club details in parallel. Postgres reads are always fresh —
    // no cache layer to bypass here (unlike the old Sheets Games cache, which the
    // ?fresh=1 param used to force past after an enter/withdraw).
    const [games, clubs] = await Promise.all([
      getFixtures(statusFilter ?? undefined, typeFilter),
      getClubs().catch(() => []),   // petrol cost is non-critical; don't fail if clubs sheet absent
    ]);

    // Build club-name → petrolCost lookup for away game display
    const petrolMap = new Map<string, number>(
      clubs.filter(c => c.petrolCost > 0).map(c => [c.clubName, c.petrolCost])
    );

    // Tea rota is merged into this response so the friendlies page gets its tea-duty
    // info here instead of a separate /api/tea-rota call.
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

    // Build the list of buddies the current user may enter on their behalf, so the
    // enter dialog can offer "Enter {{name}} too?". A buddy is anyone who lists the
    // current user as their buddy and who the user is authorised to manage (same rule
    // the confirm flow uses). Each buddy carries their member type (for gender
    // eligibility) and the games they are already in (so those are not re-offered).
    const buddies: FriendliesBuddy[] = [];
    try {
      const allUsers = await getAllUsers();
      const candidates = allUsers.filter(
        (u) => u.buddyUserName === session.user.userName && u.userName !== session.user.userName
      );
      for (const cand of candidates) {
        const allowed = await canManageUser(session.user.userName, session.user.role ?? '', cand.userName);
        if (!allowed) continue;
        const buddyEntries = await getPlayerEntries(cand.userName);
        const enteredTabNames = buddyEntries
          .filter((e) => e.status && !e.status.endsWith('W'))
          .map((e) => e.tabName);
        buddies.push({
          userName: cand.userName,
          name: cand.fullKnownAs || `${cand.firstName ?? ''} ${cand.lastName ?? ''}`.trim() || cand.userName,
          memberType: cand.memberType ?? '',
          enteredTabNames,
        });
      }
    } catch (buddyErr) {
      // Buddy info is a convenience — never fail the games list over it
      console.error('Error building friendlies buddy list:', buddyErr);
    }

    // Return success response with games array + the user's tea-duty dates + buddies
    return NextResponse.json({ games: gamesWithUserStatus, teaDutyDates, buddies });
  } catch (error) {
    // Log error and return 500 response
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
