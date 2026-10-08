// GET /api/friendlies/stats
// Returns per-game detail and summary stats for a player.
// Any logged-in user can fetch their own stats.
// Captains and Admins can query any player (?userName=xxx)
// and also receive a playerList for the dropdown selector.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSeasonEntryCodes } from '@/lib/fixture-groups-supabase';
import { getFixtures } from '@/lib/fixtures-supabase';
import { getAllUsers } from '@/lib/members-supabase';
import { hasRole } from '@/lib/role-utils';
// ── Types ─────────────────────────────────────────────────────────────────────

type DisplayStatus =
  | 'Selected'
  | 'Reserve'
  | 'Reserve Team'
  | 'Opposition'
  | 'Withdrawn'
  | 'Cancelled'
  | 'Abandoned'
  | 'Entered';

type SeasonEntry = Awaited<ReturnType<typeof getSeasonEntryCodes>>[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Human-readable status for one entry. Selection outcomes only show once the team is
 * published (S/P) — before that a player is just "Entered", as before.
 */
function getDisplayStatus(e: SeasonEntry): DisplayStatus {
  if (e.status === 'C') return 'Cancelled';
  if (e.status === 'A') return 'Abandoned';
  if (e.withdrawn) return 'Withdrawn';
  if (e.status !== 'S' && e.status !== 'P') return 'Entered';
  if (e.selection === 'Y') return 'Selected';
  if (e.selection === 'O') return 'Opposition';
  return 'Reserve';
}

/** Parse DD/MM/YYYY → timestamp for sorting */
function ukDateTs(d: string): number {
  const [dd, mm, yyyy] = d.split('/');
  return new Date(`${yyyy}-${mm}-${dd}`).getTime();
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isCaptainOrAdmin = hasRole(session.user.role, 'Captain', 'Admin');
    const { searchParams } = new URL(request.url);
    const requestedUser = searchParams.get('userName');

    // Determine whose stats to fetch
    let targetUser = session.user.userName;
    if (requestedUser && requestedUser !== targetUser) {
      if (!isCaptainOrAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      targetUser = requestedUser;
    }

    // Every season entry (one per entry, anchored to its game) and the fixtures
    const [seasonEntries, games] = await Promise.all([getSeasonEntryCodes(), getFixtures()]);
    const gameById = new Map(games.map(g => [g.id, g]));
    const target = targetUser.toLowerCase();

    // Build the per-game detail list
    const detail = seasonEntries
      .filter(e => e.username.toLowerCase() === target)
      .map(e => {
        const game = gameById.get(e.fixtureId);
        if (!game) return null;
        return {
          tabName: e.tabName,
          date: game.date,
          clubName: game.clubName,
          format: game.format,
          homeAway: game.homeAway as string,
          gameStatus: game.status,
          playerStatus: e.code as string,
          displayStatus: getDisplayStatus(e),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => ukDateTs(b.date) - ukDateTs(a.date)); // newest first

    // Build the summary
    const summary = {
      selected: 0,
      reserve: 0,
      reserveTeam: 0,
      opposition: 0,
      withdrawn: 0,
      cancelled: 0,
      abandoned: 0,
      entered: 0,
    };
    for (const d of detail) {
      switch (d.displayStatus) {
        case 'Selected':     summary.selected++;     break;
        case 'Reserve':      summary.reserve++;      break;
        case 'Reserve Team': summary.reserveTeam++;  break;
        case 'Opposition':   summary.opposition++;   break;
        case 'Withdrawn':    summary.withdrawn++;    break;
        case 'Cancelled':    summary.cancelled++;    break;
        case 'Abandoned':    summary.abandoned++;    break;
        case 'Entered':      summary.entered++;      break;
      }
    }

    // For Captain/Admin: also return everyone with at least one entry this season so
    // the UI can render a player selector dropdown
    let playerList: { userName: string; fullName: string }[] | null = null;
    if (isCaptainOrAdmin) {
      const allUsers = await getAllUsers();
      const fullNames = new Map(allUsers.filter(u => u.userName).map(u => [u.userName.toLowerCase(), u.fullName || u.userName]));
      const seen = new Map<string, string>();
      for (const e of seasonEntries) seen.set(e.username.toLowerCase(), e.username);
      playerList = Array.from(seen.values())
        .map(userName => ({ userName, fullName: fullNames.get(userName.toLowerCase()) || userName }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
    }

    return NextResponse.json({ detail, summary, targetUser, playerList });
  } catch (error) {
    console.error('GET /api/friendlies/stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
