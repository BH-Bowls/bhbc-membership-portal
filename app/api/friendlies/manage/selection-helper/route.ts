// app/api/friendlies/manage/selection-helper/route.ts
// Returns selection-helper analysis for a game: bar/driver availability, reserve priority,
// first-timers, buddy pairs, and % played outliers.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, getFriendliesSpreadsheetId } from '@/lib/friendlies-sheets';
import { getAllUsers } from '@/lib/sheets';
import { hasRole } from '@/lib/role-utils';

export interface SelectionHelperPlayer {
  userName: string;
  fullName: string;
  driverBar: string;         // 'D', 'B', 'DB', or ''
  selected: string;          // '', 'Y', 'R', 'T'
  nameDown: number;
  picked: number;
  percentPlayed: number;     // decimal 0–1
  consecutiveReserves: number; // how many of the most recent games were R or T
  isFirstTimer: boolean;     // picked === 0
  last6Games: string[];
}

export interface BuddyPair {
  player1: string;          // fullName
  player1Selected: string;  // '', 'Y', 'R', 'T'
  player2: string;          // fullName
  player2Selected: string;  // '', 'Y', 'R', 'T'
}

export interface PercentOutlier extends SelectionHelperPlayer {
  direction: 'above' | 'below';
}

export interface SelectionHelperResult {
  homeAway: 'H' | 'A';
  format: string;
  totalEntered: number;
  // Bar (home games)
  barVolunteers: SelectionHelperPlayer[];
  barVolunteersSelected: number;  // how many bar people are already marked Y/R/T
  // Driving (away games)
  drivers: SelectionHelperPlayer[];
  carsNeeded: number;
  driversSelected: number;  // drivers already marked Y/R/T
  // Reserve priority ordered list (only unselected players)
  reservePriority: SelectionHelperPlayer[];
  // First-timers (among entered players)
  firstTimers: SelectionHelperPlayer[];
  // Buddy / couple pairs where both players entered
  buddyPairs: BuddyPair[];
  // Players more than 10pp above or below the group average
  percentOutliers: PercentOutlier[];
  // Average % played across entered players who have history (nameDown > 0)
  avgPercentPlayed: number;
  // Whether any history data exists to compute an average
  hasPercentData: boolean;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const tabName = request.nextUrl.searchParams.get('tab_name');
    if (!tabName) {
      return NextResponse.json({ error: 'tab_name required' }, { status: 400 });
    }

    // Load game metadata + game-sheet players in parallel with Members data
    const [games, gamePlayers, allUsers] = await Promise.all([
      getGames(),
      getGameSheet(tabName),
      getAllUsers(),
    ]);

    const game = games.find(g => g.tabName === tabName);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Build lookups from Members sheet
    const memberMap = new Map<string, typeof allUsers[0]>();
    for (const u of allUsers) {
      if (u.userName) memberMap.set(u.userName.toLowerCase(), u);
    }

    // -------------------------------------------------------------------------
    // Build rich player list
    // -------------------------------------------------------------------------
    const players: SelectionHelperPlayer[] = gamePlayers.map(p => {
      const member = memberMap.get(p.name.toLowerCase());

      // Count consecutive trailing reserves from last6Games (newest first in array)
      let consecutiveReserves = 0;
      const games6 = p.last8Games ?? [];
      // last8Games is newest-first (built by backward scan in getPlayerStatsFromCache)
      for (const entry of games6) {
        const sep = entry.indexOf('    ');
        const status = sep !== -1 ? entry.substring(sep + 4).trim().toUpperCase() : '';
        if (status === 'R' || status === 'T' || status === 'RW' || status === 'TW') {
          consecutiveReserves++;
        } else {
          break; // streak broken
        }
      }

      const percentPlayed = p.percentPlayed > 1 ? p.percentPlayed / 100 : p.percentPlayed;

      return {
        userName: p.name,
        fullName: p.fullName || p.name,
        driverBar: p.driverBar || '',
        selected: p.selected || '',
        nameDown: p.nameDown,
        picked: p.picked,
        percentPlayed,
        consecutiveReserves,
        isFirstTimer: p.picked === 0,
        last6Games: p.last8Games ?? [],
      };
    });

    const homeAway = game.homeAway as 'H' | 'A';

    // -------------------------------------------------------------------------
    // Bar volunteers (home games)
    // -------------------------------------------------------------------------
    const barVolunteers = players.filter(p => p.driverBar.includes('B'));
    const barVolunteersSelected = barVolunteers.filter(p => ['Y', 'R', 'T'].includes(p.selected)).length;

    // -------------------------------------------------------------------------
    // Drivers (away games)
    // -------------------------------------------------------------------------
    const drivers = players.filter(p => p.driverBar.includes('D'));
    const driversSelected = drivers.filter(p => ['Y', 'R', 'T'].includes(p.selected)).length;

    // Parse number of players expected from format (e.g. "4 Triples" → 4×3 = 12)
    const formatLower = (game.format || '').toLowerCase();
    const teamCountMatch = (game.format || '').match(/^(\d+)/);
    const teamCount = teamCountMatch ? parseInt(teamCountMatch[1], 10) : 4;
    const playersPerTeam = formatLower.includes('pair') ? 2
      : formatLower.includes('triple') ? 3
      : 4; // rinks/fours
    const totalPlayers = teamCount * playersPerTeam;
    const carsNeeded = Math.ceil(totalPlayers / 4);

    // -------------------------------------------------------------------------
    // Reserve priority — all players whose most recent closed game was a reserve,
    // sorted by streak length desc, then % played asc as tie-break.
    // Includes already-selected players so the captain can see the full picture.
    // -------------------------------------------------------------------------
    const reservePriority = players
      .filter(p => p.consecutiveReserves > 0)
      .sort((a, b) => {
        if (b.consecutiveReserves !== a.consecutiveReserves) {
          return b.consecutiveReserves - a.consecutiveReserves;
        }
        return a.percentPlayed - b.percentPlayed;
      });

    // -------------------------------------------------------------------------
    // First-timers (never picked, among entered players)
    // -------------------------------------------------------------------------
    const firstTimers = players.filter(p => p.isFirstTimer);

    // -------------------------------------------------------------------------
    // Buddy pairs (both players in the game)
    // -------------------------------------------------------------------------
    const enteredUserNames = new Set(players.map(p => p.userName.toLowerCase()));
    const seenPairs = new Set<string>();
    const buddyPairs: BuddyPair[] = [];

    for (const player of players) {
      const member = memberMap.get(player.userName.toLowerCase());
      if (!member?.buddyUserName) continue;

      const buddyKey = player.userName.toLowerCase();
      const buddyUserName = member.buddyUserName.toLowerCase();

      // Only include if the buddy is also in the game
      if (!enteredUserNames.has(buddyUserName)) continue;

      // Deduplicate — each pair appears only once
      const pairKey = [buddyKey, buddyUserName].sort().join('|');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const buddyMember = memberMap.get(buddyUserName);
      const buddyFullName = buddyMember?.fullName || buddyMember?.userName || member.buddyUserName;
      const buddyPlayer = players.find(p => p.userName.toLowerCase() === buddyUserName);

      buddyPairs.push({
        player1: player.fullName,
        player1Selected: player.selected,
        player2: buddyFullName,
        player2Selected: buddyPlayer?.selected ?? '',
      });
    }

    // -------------------------------------------------------------------------
    // % played outliers — players more than 10pp above or below the group average
    // -------------------------------------------------------------------------
    // Average is computed over all entered players who have at least one closed
    // game (nameDown > 0). This correctly includes 0% players (reserves who were
    // never picked) rather than excluding them with a > 0 filter.
    const playersWithHistory = players.filter(p => p.nameDown > 0);
    const hasPercentData = playersWithHistory.length > 0;
    const avgPercentPlayed = hasPercentData
      ? playersWithHistory.reduce((sum, p) => sum + p.percentPlayed, 0) / playersWithHistory.length
      : 0;

    const THRESHOLD = 0.10; // 10 percentage points
    const percentOutliers: PercentOutlier[] = playersWithHistory
      .filter(p => !p.isFirstTimer && Math.abs(p.percentPlayed - avgPercentPlayed) > THRESHOLD)
      .sort((a, b) => a.percentPlayed - b.percentPlayed) // low → high
      .map(p => ({
        ...p,
        direction: p.percentPlayed < avgPercentPlayed ? 'below' : 'above',
      }));

    const result: SelectionHelperResult = {
      homeAway,
      format: game.format || '',
      totalEntered: players.length,
      barVolunteers,
      barVolunteersSelected,
      drivers,
      carsNeeded,
      driversSelected,
      reservePriority,
      firstTimers,
      buddyPairs,
      percentOutliers,
      avgPercentPlayed,
      hasPercentData,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error building selection helper:', error);
    return NextResponse.json({ error: 'Failed to build selection helper' }, { status: 500 });
  }
}
