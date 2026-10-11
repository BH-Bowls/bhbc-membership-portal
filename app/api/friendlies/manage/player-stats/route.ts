// GET /api/friendlies/manage/player-stats
// Returns summary stats for every player who has entered at least one friendly.
// Captain / Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getSeasonEntryCodes } from '@/lib/fixture-groups-supabase';
import { getAllUsers } from '@/lib/members-supabase';
import { hasRole } from '@/lib/role-utils';

export interface PlayerStatRow {
  userName: string;
  fullName: string;
  selected: number;
  reserve: number;
  reserveTeam: number;
  opposition: number;
  withdrawn: number;
  cancelled: number;
  abandoned: number;
  entered: number;   // E / M / other not-yet-resolved
  total: number;
}

export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Every season entry (one per entry, anchored to the game it sits on)
    const seasonEntries = await getSeasonEntryCodes();

    // All playing members (PL / PM) — used to find who hasn't played
    const fullNameLookup = new Map<string, string>();
    const playingMembers: { userName: string; fullName: string }[] = [];
    {
      const allUsers = await getAllUsers();
      for (const u of allUsers) {
        if (!u.userName || !u.fullName) continue;
        fullNameLookup.set(u.userName.toLowerCase(), u.fullName);
        if (u.memberType === 'Playing Lady' || u.memberType === 'Playing Man') {
          playingMembers.push({ userName: u.userName, fullName: u.fullName });
        }
      }
    }

    const byUser = new Map<string, PlayerStatRow>();
    for (const e of seasonEntries) {
      const key = e.username.toLowerCase();
      let stats = byUser.get(key);
      if (!stats) {
        stats = {
          userName: e.username,
          fullName: fullNameLookup.get(key) || e.username,
          selected: 0,
          reserve: 0,
          reserveTeam: 0,
          opposition: 0,
          withdrawn: 0,
          cancelled: 0,
          abandoned: 0,
          entered: 0,
          total: 0,
        };
        byUser.set(key, stats);
      }

      if (e.status === 'C') {
        stats.cancelled++;
        stats.total++;
      } else if (e.status === 'A') {
        stats.abandoned++;
        stats.total++;
      } else if (e.withdrawn) {
        // Withdrawals are tracked but excluded from the total
        stats.withdrawn++;
      } else {
        if (e.status === 'O' || e.status === '') stats.entered++;        // entries still open
        else if (e.selection === 'Y') stats.selected++;
        else if (e.selection === 'O') stats.opposition++;
        else stats.reserve++;                                              // unselected after close = reserve
        stats.total++;
      }
    }
    const playerStats = Array.from(byUser.values());

    // Default sort: alphabetical by fullName
    playerStats.sort((a, b) => a.fullName.localeCompare(b.fullName));

    // Playing members with no entry in the Players sheet
    const playedUserNames = new Set(playerStats.map(p => p.userName));
    const notPlayed = playingMembers
      .filter(m => !playedUserNames.has(m.userName))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    return NextResponse.json({ players: playerStats, notPlayed });
  } catch (error) {
    console.error('GET /api/friendlies/manage/player-stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch player stats' }, { status: 500 });
  }
}
