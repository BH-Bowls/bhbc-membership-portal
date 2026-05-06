// GET /api/friendlies/stats
// Returns per-game detail and summary stats for a player.
// Any logged-in user can fetch their own stats.
// Captains and Admins can query any player (?userName=xxx)
// and also receive a playerList for the dropdown selector.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getGames,
  getPlayerEntries,
  getColumnMap,
  getSheetsClient,
  getFriendliesSpreadsheetId,
  getMembersSpreadsheetId,
} from '@/lib/friendlies-sheets';
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a human-readable status label for a (playerStatus, gameStatus) pair */
function getDisplayStatus(playerStatus: string, gameStatus: string): DisplayStatus {
  if (gameStatus === 'C') return 'Cancelled';
  if (gameStatus === 'A') return 'Abandoned';
  if (playerStatus.endsWith('W')) return 'Withdrawn';
  if (playerStatus === 'P') return 'Selected';
  if (playerStatus === 'R') return 'Reserve';
  if (playerStatus === 'T') return 'Reserve Team';
  if (playerStatus === 'O') return 'Opposition';
  return 'Entered'; // E, M, D, or any other code
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

    // Fetch player entries and games in parallel
    const [entries, games] = await Promise.all([
      getPlayerEntries(targetUser),
      getGames(),
    ]);

    // Build a fast tabName → game lookup
    const gameMap = new Map(games.map(g => [g.tabName, g]));

    // Build the per-game detail list
    const detail = entries
      .map(entry => {
        const game = gameMap.get(entry.tabName);
        if (!game) return null; // orphaned column (game deleted from sheet)
        return {
          tabName: entry.tabName,
          date: game.date,
          clubName: game.clubName,
          format: game.format,
          homeAway: game.homeAway as string,
          gameStatus: game.status,
          playerStatus: entry.status as string,
          displayStatus: getDisplayStatus(entry.status, game.status),
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

    // For Captain/Admin: also return a list of all players who have entries
    // so the UI can render a player selector dropdown
    let playerList: { userName: string; fullName: string }[] | null = null;

    if (isCaptainOrAdmin) {
      playerList = await buildPlayerList();
    }

    return NextResponse.json({ detail, summary, targetUser, playerList });
  } catch (error) {
    console.error('GET /api/friendlies/stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}

// ── Helper: build player list from Players sheet ──────────────────────────────

/**
 * Return { userName, fullName } for every player who has at least one entry
 * in the Players sheet, sorted by fullName.
 */
async function buildPlayerList(): Promise<{ userName: string; fullName: string }[]> {
  const spreadsheetId = getFriendliesSpreadsheetId();
  const sheets = getSheetsClient();
  const colMap = await getColumnMap(spreadsheetId, 'Players');

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Players!A:ZZ',
  });

  const rows = response.data.values || [];

  const userNameColIndex = colMap['user_name'] ?? colMap['full_name'] ?? colMap['name'] ?? 0;
  const usesUserName = colMap['user_name'] !== undefined;

  // Build fullName lookup from Members sheet when Players sheet uses userName
  const fullNameLookup = new Map<string, string>();
  if (usesUserName) {
    const membersId = getMembersSpreadsheetId();
    const membersColMap = await getColumnMap(membersId, 'Members');
    const membersResp = await sheets.spreadsheets.values.get({
      spreadsheetId: membersId,
      range: 'Members!A:ZZ',
    });
    const membersRows = membersResp.data.values || [];
    const uCol = membersColMap['user_name'] ?? 0;
    const fCol = membersColMap['full_name'] ?? membersColMap['name'] ?? 1;
    for (let i = 1; i < membersRows.length; i++) {
      const r = membersRows[i];
      if (r[uCol] && r[fCol]) fullNameLookup.set(r[uCol], r[fCol]);
    }
  }

  const result: { userName: string; fullName: string }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const identifier = row[userNameColIndex];
    if (!identifier) continue;

    const userName = identifier;
    const fullName = usesUserName
      ? (fullNameLookup.get(identifier) || identifier)
      : identifier;

    result.push({ userName, fullName });
  }

  result.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return result;
}
