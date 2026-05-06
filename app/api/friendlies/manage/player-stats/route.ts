// GET /api/friendlies/manage/player-stats
// Returns summary stats for every player who has entered at least one friendly.
// Captain / Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getGames,
  getColumnMap,
  getSheetsClient,
  getFriendliesSpreadsheetId,
  getMembersSpreadsheetId,
} from '@/lib/friendlies-sheets';
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

    const spreadsheetId = getFriendliesSpreadsheetId();
    const sheets = getSheetsClient();

    // Read Players sheet and Games sheet in parallel
    const [playersResponse, games, colMap] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: 'Players!A:ZZ' }),
      getGames(),
      getColumnMap(spreadsheetId, 'Players'),
    ]);

    const rows = playersResponse.data.values || [];
    const headers = rows[0] || [];

    // Build sets for quick game-status lookup
    const cancelledTabNames = new Set(games.filter(g => g.status === 'C').map(g => g.tabName));
    const abandonedTabNames = new Set(games.filter(g => g.status === 'A').map(g => g.tabName));

    // Build a set of all known game tab names — only these columns are game entries.
    // Any column whose header is NOT a game tab name (e.g. Name Down, Picked, %) is ignored.
    const gameTabNames = new Set(games.map(g => g.tabName));

    // Determine identifier column
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

    const playerStats: PlayerStatRow[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const identifier = row[userNameColIndex];
      if (!identifier) continue;

      const userName = identifier;
      const fullName = usesUserName
        ? (fullNameLookup.get(identifier) || identifier)
        : identifier;

      const stats: PlayerStatRow = {
        userName,
        fullName,
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

      let hasAnyEntry = false;

      for (let j = 0; j < headers.length; j++) {
        const tabName = headers[j];
        if (!tabName || !gameTabNames.has(tabName)) continue;  // only count known game columns
        const cellValue = row[j];
        if (!cellValue) continue;

        hasAnyEntry = true;
        stats.total++;

        if (cancelledTabNames.has(tabName)) {
          stats.cancelled++;
        } else if (abandonedTabNames.has(tabName)) {
          stats.abandoned++;
        } else if ((cellValue as string).endsWith('W')) {
          stats.withdrawn++;
        } else {
          switch (cellValue) {
            case 'P': stats.selected++;    break;
            case 'R': stats.reserve++;     break;
            case 'T': stats.reserveTeam++; break;
            case 'O': stats.opposition++;  break;
            default:  stats.entered++;     break; // E, M, D, etc.
          }
        }
      }

      if (hasAnyEntry) {
        playerStats.push(stats);
      }
    }

    // Default sort: alphabetical by fullName
    playerStats.sort((a, b) => a.fullName.localeCompare(b.fullName));

    return NextResponse.json({ players: playerStats });
  } catch (error) {
    console.error('GET /api/friendlies/manage/player-stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch player stats' }, { status: 500 });
  }
}
