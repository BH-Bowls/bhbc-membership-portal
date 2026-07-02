// src/lib/diary-sheets.ts
// Data layer for the home-page Diary Panel.
// Aggregates upcoming duties and game entries for a single member across
// CleaningRota, SweepingRota, Games (tea duty + friendlies), competition
// match sheets, and Availability events.

import {
  getGoogleSheetsClient,
  getColumnMap,
  getSpreadsheetId,       // MEMBERS_SPREADSHEET_ID
  getCompetitionsSpreadsheetId,
  getAllUsers,
} from './sheets';
import { getFriendliesSpreadsheetId } from './friendlies-sheets';
import { COMP_SHEET_CONFIG } from './competitions-sheets';
import { parseUKDate } from './date-utils';
import { getSheetDataCache, setSheetDataCache } from './home-cache';
import { hasRole } from './role-utils';
import { getPendingApplicationsCount } from './applications-sheets';
import type { DiaryItem } from '@/types/diary';

// ─── Environment Variable Getter ─────────────────────────────────────────────

// Returns the Availability spreadsheet ID, throwing a helpful error if missing
function getAvailabilitySpreadsheetId(): string {
  const id = process.env.AVAILABILITY_SPREADSHEET_ID;
  if (!id) {
    throw new Error('AVAILABILITY_SPREADSHEET_ID environment variable is not set. Check your .env.local file.');
  }
  return id;
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

// Get today's date as a YYYY-MM-DD string, using local time (avoids UTC midnight drift)
function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Format a YYYY-MM-DD ISO date as "Sat 24 May" (abbreviated weekday + day + abbreviated month)
function formatDiaryDate(isoDate: string): string {
  // Split YYYY-MM-DD to avoid timezone offset issues with new Date()
  const parts = isoDate.split('-');
  if (parts.length !== 3) {
    return isoDate;
  }
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${weekdays[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

// Convert any date string (DD/MM/YYYY, YYYY-MM-DD, "Wed 29 Apr", etc.) to YYYY-MM-DD ISO format.
// Uses parseUKDate which handles all formats the Games sheet may return.
// Returns null if the input is empty or cannot be parsed.
function anyDateToIso(rawDate: string): string | null {
  if (!rawDate || !rawDate.trim()) {
    return null;
  }
  const d = parseUKDate(rawDate.trim());
  if (isNaN(d.getTime())) {
    return null;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parse a CleaningRota display date string like "Sat, 05 September" to YYYY-MM-DD.
// Because these strings have no year, this function picks the nearest upcoming
// occurrence: current year if the date is today or future, else next year.
function parseCleaningRotaDate(displayDate: string): string | null {
  if (!displayDate || !displayDate.trim()) {
    return null;
  }

  // Month name → 0-based month index
  const monthMap: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };

  // Pattern: optional "DayName, " then day number then month name (e.g. "Sat, 05 September")
  const match = displayDate.trim().match(/^(?:\w+,?\s+)?(\d{1,2})\s+(\w+)$/i);
  if (!match) {
    return null;
  }

  const day = parseInt(match[1], 10);
  const monthName = match[2].toLowerCase();
  const month = monthMap[monthName];

  // Unrecognised month name
  if (month === undefined) {
    return null;
  }

  const now = new Date();
  const todayStr = getTodayIso();

  // Build a candidate date for the current year
  let year = now.getFullYear();
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  let candidate = `${year}-${mm}-${dd}`;

  // If the candidate date is already in the past, advance to next year
  if (candidate < todayStr) {
    year += 1;
    candidate = `${year}-${mm}-${dd}`;
  }

  return candidate;
}

// Convert a Google Sheets date serial number (integer days since 30 Dec 1899) to YYYY-MM-DD
function sheetsSerialToIso(serial: number): string {
  // Google Sheets epoch is 30 December 1899
  const epoch = new Date(1899, 11, 30);
  const ms = epoch.getTime() + serial * 86400 * 1000;
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── User Display Name Helpers ────────────────────────────────────────────────

// Build a map from lowercase username → display name from the full users list
// Used to resolve competition opponent usernames to readable names
function buildNameMap(allUsers: Awaited<ReturnType<typeof getAllUsers>>): Map<string, string> {
  const nameMap = new Map<string, string>();
  for (let i = 0; i < allUsers.length; i++) {
    const u = allUsers[i];
    const key = u.userName ? u.userName.toLowerCase() : '';
    if (key) {
      // Prefer fullName, fall back to combining firstName + lastName, then userName
      let displayName = u.fullName;
      if (!displayName) {
        const first = u.firstName || '';
        const last = u.lastName || '';
        displayName = (first + ' ' + last).trim();
      }
      if (!displayName) {
        displayName = u.userName;
      }
      nameMap.set(key, displayName);
    }
  }
  return nameMap;
}

// ─── Source 1 & 2: MEMBERS spreadsheet — Cleaning + Sweeping Rota ────────────

type MembersRotaResult = {
  cleaningItems: DiaryItem[];
  sweepingItems: DiaryItem[];
};

// Fetch CleaningRota and SweepingRota data, serving from the 24-hour shared cache
// when available and falling back to a batchGet on a cache miss.
async function fetchMembersRotaItems(userName: string, todayStr: string): Promise<MembersRotaResult> {
  const spreadsheetId = getSpreadsheetId();

  // Cache keys for the two rota sheets
  const cleaningCacheKey = `members-cleaning:${spreadsheetId}`;
  const sweepingCacheKey = `members-sweeping:${spreadsheetId}`;

  // Try the shared cache first
  let cleaningRows = getSheetDataCache(cleaningCacheKey);
  let sweepingRows = getSheetDataCache(sweepingCacheKey);

  if (!cleaningRows || !sweepingRows) {
    // Cache miss — fetch both sheets in a single batchGet then cache the results
    const sheets = getGoogleSheetsClient();
    const batchResponse = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [
        'CleaningRota!A2:E',  // date (col A), lead (B), second (C), third (D), fourth (E)
        'SweepingRota!A2:C',  // date serial (col A), user_name (B), is_blocked (C)
      ],
    });

    const valueRanges = batchResponse.data.valueRanges;
    cleaningRows = (valueRanges && valueRanges[0] && valueRanges[0].values) ? valueRanges[0].values as string[][] : [];
    sweepingRows = (valueRanges && valueRanges[1] && valueRanges[1].values) ? valueRanges[1].values as string[][] : [];

    setSheetDataCache(cleaningCacheKey, cleaningRows);
    setSheetDataCache(sweepingCacheKey, sweepingRows);
  }

  const cleaningItems: DiaryItem[] = [];
  const sweepingItems: DiaryItem[] = [];

  // ── CleaningRota: columns are positional (A=date, B=lead, C=second, D=third, E=fourth) ──
  if (cleaningRows) {
    for (let i = 0; i < cleaningRows.length; i++) {
      const row = cleaningRows[i];
      const dateStr = row[0] ? String(row[0]).trim() : '';
      if (!dateStr) {
        continue;
      }

      // Parse the display date (e.g. "Sat, 05 September") to a sortable YYYY-MM-DD
      const isoDate = parseCleaningRotaDate(dateStr);
      if (!isoDate) {
        continue;
      }

      // Skip dates that are in the past
      if (isoDate < todayStr) {
        continue;
      }

      // Check if this member appears in any of the four cleaner columns (B, C, D, E)
      const lead = row[1] ? String(row[1]).trim() : '';
      const second = row[2] ? String(row[2]).trim() : '';
      const third = row[3] ? String(row[3]).trim() : '';
      const fourth = row[4] ? String(row[4]).trim() : '';

      // Only include the row if the member is one of the assigned cleaners
      const isCleaner = (lead === userName || second === userName || third === userName || fourth === userName);
      if (!isCleaner) {
        continue;
      }

      cleaningItems.push({
        type: 'cleaning',
        date: isoDate,
        displayDate: formatDiaryDate(isoDate),
        label: 'Cleaning Duty',
        subLabel: dateStr,
        linkUrl: '/cleaning-rota',
      });
    }
  }

  // ── SweepingRota: columns are positional (A=date serial, B=user_name, C=is_blocked) ──
  if (sweepingRows) {
    for (let i = 0; i < sweepingRows.length; i++) {
      const row = sweepingRows[i];
      const rawDate = row[0] ? String(row[0]).trim() : '';
      const rowUserName = row[1] ? String(row[1]).trim() : '';
      const isBlocked = row[2] ? String(row[2]).trim() : '';

      // Skip blocked dates — they are not assignable
      if (isBlocked === 'TRUE' || isBlocked === 'true') {
        continue;
      }

      // Skip rows not belonging to this member
      if (rowUserName !== userName) {
        continue;
      }

      // Skip empty dates
      if (!rawDate) {
        continue;
      }

      // The date may be a Google Sheets serial number (integer) or a formatted string
      let isoDate: string | null = null;
      const serialNum = Number(rawDate);
      if (!isNaN(serialNum) && serialNum > 1000) {
        // Google Sheets date serial — convert to ISO
        isoDate = sheetsSerialToIso(serialNum);
      } else {
        // Parse as any supported date format (DD/MM/YYYY, YYYY-MM-DD, etc.)
        isoDate = anyDateToIso(rawDate);
      }

      if (!isoDate) {
        continue;
      }

      // Skip dates in the past
      if (isoDate < todayStr) {
        continue;
      }

      sweepingItems.push({
        type: 'sweeping',
        date: isoDate,
        displayDate: formatDiaryDate(isoDate),
        label: 'Sweeping Duty',
        subLabel: '',
        linkUrl: '/sweeping-rota',
      });
    }
  }

  return { cleaningItems, sweepingItems };
}

// ─── Source 3 & 4: FRIENDLIES spreadsheet — Tea duty + Friendly entries ───────

type FriendliesResult = {
  teaItems: DiaryItem[];
  friendlyItems: DiaryItem[];
};

// Fetch Games and Players sheet data (from the 24-hour shared cache when available)
// then build tea-duty and friendly-entry diary items for this member.
async function fetchFriendliesItems(userName: string, todayStr: string): Promise<FriendliesResult> {
  const spreadsheetId = getFriendliesSpreadsheetId();

  // ── Step 1: Column maps (already cached by getColumnMap's own cache) ──
  const [gamesColMap, playersColMap] = await Promise.all([
    getColumnMap('Games', spreadsheetId),
    getColumnMap('Players', spreadsheetId),
  ]);

  // Determine which column index holds usernames in the Players sheet
  // (mirrors the priority used by getPlayerEntries in friendlies-sheets.ts)
  let playersUserNameColIdx = playersColMap['user_name'];
  if (playersUserNameColIdx === undefined) {
    playersUserNameColIdx = playersColMap['full_name'];
  }
  if (playersUserNameColIdx === undefined) {
    playersUserNameColIdx = playersColMap['name'];
  }
  if (playersUserNameColIdx === undefined) {
    playersUserNameColIdx = 0;
  }

  // ── Step 2: Fetch Games and full Players sheet, serving from shared cache ──
  const gamesCacheKey   = `friendlies-games:${spreadsheetId}`;
  const playersCacheKey = `friendlies-players:${spreadsheetId}`;

  let gamesRows   = getSheetDataCache(gamesCacheKey);
  let playersRows = getSheetDataCache(playersCacheKey);

  if (!gamesRows || !playersRows) {
    // Cache miss — fetch both sheets together in one batchGet then cache them
    const sheets = getGoogleSheetsClient();
    const batchResponse = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [
        'Games!A2:ZZ',   // all game rows (no header — positional via column map)
        'Players!A:ZZ',  // full Players sheet including header row
      ],
    });

    const valueRanges = batchResponse.data.valueRanges;
    gamesRows   = (valueRanges && valueRanges[0] && valueRanges[0].values) ? valueRanges[0].values as string[][] : [];
    playersRows = (valueRanges && valueRanges[1] && valueRanges[1].values) ? valueRanges[1].values as string[][] : [];

    setSheetDataCache(gamesCacheKey,   gamesRows);
    setSheetDataCache(playersCacheKey, playersRows);
  }

  const teaItems: DiaryItem[] = [];
  const friendlyItems: DiaryItem[] = [];

  // Helper to get a value from a Games row by column name
  function getGameCol(row: string[], field: string): string {
    const idx = gamesColMap[field];
    if (idx === undefined) {
      return '';
    }
    const val = row[idx];
    return val !== undefined && val !== null ? String(val).trim() : '';
  }

  // ── Step 3: Find the member's row in the cached Players data ──
  // playersRows[0] is the header row; data starts at index 1
  const playersHeaderRow: string[] = playersRows.length > 0 ? (playersRows[0] as string[]) : [];
  let memberPlayerRow: string[] = [];

  for (let i = 1; i < playersRows.length; i++) {
    const cellValue = playersRows[i][playersUserNameColIdx] ? String(playersRows[i][playersUserNameColIdx]).trim() : '';
    if (cellValue === userName) {
      memberPlayerRow = playersRows[i] as string[];
      break;
    }
  }

  // Build a map from game tab_name → member's entry status
  const playerEntryMap: Map<string, string> = new Map();
  if (memberPlayerRow.length > 0) {
    for (let i = 0; i < playersHeaderRow.length; i++) {
      const header = playersHeaderRow[i] ? String(playersHeaderRow[i]).trim() : '';
      const value  = memberPlayerRow[i]  ? String(memberPlayerRow[i]).trim()  : '';
      if (header && value) {
        playerEntryMap.set(header, value);
      }
    }
  }

  // ── Step 4: Process Games rows ──
  for (let i = 0; i < gamesRows.length; i++) {
    const row = gamesRows[i] as string[];

      // Get the game status — only process active games
      const status = getGameCol(row, 'status');
      if (status !== 'O' && status !== 'X' && status !== 'S') {
        continue;
      }

      // Parse the game date and skip past games
      const rawDate = getGameCol(row, 'date');
      const isoDate = anyDateToIso(rawDate);
      if (!isoDate || isoDate < todayStr) {
        continue;
      }

      // Get the game's unique tab_name and club name for display
      const tabName = getGameCol(row, 'tab_name');
      const clubName = getGameCol(row, 'club_name');
      const clubSuffix = getGameCol(row, 'club_suffix');
      const homeAway = getGameCol(row, 'h_a') || getGameCol(row, 'home_away');
      const needsPlayers = getGameCol(row, 'needs_players').toUpperCase() === 'Y';

      // Build the display club name (append suffix if present)
      let displayClub = clubName;
      if (clubSuffix) {
        displayClub = `${clubName} ${clubSuffix}`;
      }

      // Determine home/away label
      let haLabel = '';
      if (homeAway === 'H') {
        haLabel = 'Home';
      } else if (homeAway === 'A') {
        haLabel = 'Away';
      }

      const gameLabel = haLabel ? `vs ${displayClub} (${haLabel})` : `vs ${displayClub}`;

      // ── Tea duty check ──
      const teaLead = getGameCol(row, 'tea_lead');
      const teaFirst = getGameCol(row, 'tea_first');
      const teaSecond = getGameCol(row, 'tea_second');

      if (teaLead === userName || teaFirst === userName || teaSecond === userName) {
        let teaRole = 'Tea Duty';
        if (teaLead === userName) {
          teaRole = 'Tea Lead';
        } else {
          teaRole = 'Tea (Helper)';
        }

        teaItems.push({
          type: 'tea',
          date: isoDate,
          displayDate: formatDiaryDate(isoDate),
          label: gameLabel,
          subLabel: teaRole,
          linkUrl: '/friendlies',
        });
      }

      // ── Friendly entry check ──
      // Look up the member's entry status for this game in the player entry map
      if (tabName) {
        const entryStatus = playerEntryMap.get(tabName);
        if (entryStatus) {
          // Only include active entries — not withdrawn or absent
          // E = entered, M = manually added, D = down, P = picked, R = reserve, T = reserve team
          const isActiveEntry = (
            entryStatus === 'E' || entryStatus === 'M' || entryStatus === 'D' ||
            entryStatus === 'P' || entryStatus === 'R' || entryStatus === 'T'
          );
          if (isActiveEntry) {
            friendlyItems.push({
              type: 'friendly',
              date: isoDate,
              displayDate: formatDiaryDate(isoDate),
              label: gameLabel,
              subLabel: entryStatus === 'P' ? 'Selected' : entryStatus === 'R' || entryStatus === 'T' ? 'Reserve' : 'Entered',
              linkUrl: '/friendlies',
            });
          }
        } else if (needsPlayers && status === 'O') {
          // Captain has flagged this game as needing players, and this member hasn't entered yet
          friendlyItems.push({
            type: 'friendly-needs-players',
            date: isoDate,
            displayDate: formatDiaryDate(isoDate),
            label: gameLabel,
            subLabel: 'Players needed — please enter if you can!',
            linkUrl: `/friendlies/game/${encodeURIComponent(tabName)}`,
          });
        }
      }
    }

  return { teaItems, friendlyItems };
}

// ─── Sources 5 & 8: COMPETITIONS spreadsheet — Match + Marker items ───────────

type CompsResult = {
  competitionItems: DiaryItem[];
  markerItems: DiaryItem[];
};

// Read all competition match sheets in a single batchGet call (with shared 24-hour cache),
// then extract matches where the member is a player (pending, date set) or a marker
async function fetchCompetitionsItems(
  userName: string,
  todayStr: string,
  nameMap: Map<string, string>
): Promise<CompsResult> {
  const competitionsSpreadsheetId = getCompetitionsSpreadsheetId();

  // Build the list of comp IDs and their cache keys
  const compIds = Object.keys(COMP_SHEET_CONFIG);
  const compCacheKeys: string[] = [];
  for (let i = 0; i < compIds.length; i++) {
    const config = COMP_SHEET_CONFIG[compIds[i]];
    compCacheKeys.push(`comps-${config.sheetName}:${competitionsSpreadsheetId}`);
  }
  const controlCacheKey = `comps-control:${competitionsSpreadsheetId}`;

  // Try to serve all data from the shared 24-hour cache
  let allCached = true;
  const cachedCompRows: (string[][] | null)[] = [];
  for (let i = 0; i < compCacheKeys.length; i++) {
    const cached = getSheetDataCache(compCacheKeys[i]);
    cachedCompRows.push(cached);
    if (!cached) {
      allCached = false;
    }
  }
  let controlRows: string[][] | null = getSheetDataCache(controlCacheKey);
  if (!controlRows) {
    allCached = false;
  }

  if (!allCached) {
    // Cache miss — fetch all comp sheets plus CompetitionsControl in one batchGet
    const sheets = getGoogleSheetsClient();
    const ranges: string[] = [];
    for (let i = 0; i < compIds.length; i++) {
      const config = COMP_SHEET_CONFIG[compIds[i]];
      ranges.push(`${config.sheetName}!A2:N`);
    }
    // Append the control sheet as the last range
    ranges.push('CompetitionsControl!A2:Z');

    const batchResponse = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: competitionsSpreadsheetId,
      ranges,
    });

    const valueRanges = batchResponse.data.valueRanges;
    if (!valueRanges) {
      return { competitionItems: [], markerItems: [] };
    }

    // Cache each competition sheet's rows individually
    for (let i = 0; i < compIds.length; i++) {
      const rows = (valueRanges[i] && valueRanges[i].values) ? valueRanges[i].values as string[][] : [];
      cachedCompRows[i] = rows;
      setSheetDataCache(compCacheKeys[i], rows);
    }

    // Cache the control sheet rows (last entry in ranges)
    const controlIdx = compIds.length;
    controlRows = (valueRanges[controlIdx] && valueRanges[controlIdx].values) ? valueRanges[controlIdx].values as string[][] : [];
    setSheetDataCache(controlCacheKey, controlRows);
  }

  // Get the shared column map (getColumnMap has its own internal cache)
  // All competition sheets use the same column structure — use the first available
  let sharedColMap: Record<string, number> | null = null;
  for (let i = 0; i < compIds.length; i++) {
    const config = COMP_SHEET_CONFIG[compIds[i]];
    try {
      sharedColMap = await getColumnMap(config.sheetName, competitionsSpreadsheetId);
      break;
    } catch (_err) {
      // This sheet may not exist yet — try the next one
    }
  }

  if (!sharedColMap) {
    return { competitionItems: [], markerItems: [] };
  }

  const colMap = sharedColMap;

  const competitionItems: DiaryItem[] = [];
  const markerItems: DiaryItem[] = [];

  // Build comp display names from the cached control sheet rows
  const compDisplayNames: Record<string, string> = {};
  if (controlRows && controlRows.length > 0) {
    try {
      const controlColMap = await getColumnMap('CompetitionsControl', competitionsSpreadsheetId);
      const compIdIdx = controlColMap['comp_id'];
      const nameIdx = controlColMap['display_name'];
      for (let i = 0; i < controlRows.length; i++) {
        const row = controlRows[i];
        if (compIdIdx !== undefined && nameIdx !== undefined) {
          const cId = row[compIdIdx] ? String(row[compIdIdx]).trim() : '';
          const cName = row[nameIdx] ? String(row[nameIdx]).trim() : '';
          if (cId && cName) {
            compDisplayNames[cId] = cName;
          }
        }
      }
    } catch (_err) {
      // CompetitionsControl sheet might not exist — fall back to formatting compId
    }
  }

  // Helper to get a display name for a compId
  function getCompDisplayName(compId: string): string {
    // Use the sheet-sourced name if available
    if (compDisplayNames[compId]) {
      return compDisplayNames[compId];
    }
    // Fallback: format compId (e.g. "mens-championship" → "Mens Championship")
    const words = compId.split('-');
    const formatted: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (word.length > 0) {
        formatted.push(word.charAt(0).toUpperCase() + word.slice(1));
      }
    }
    return formatted.join(' ');
  }

  // Helper to get a cell value from a row using the shared column map
  function get(row: string[], field: string): string {
    const idx = colMap[field];
    if (idx === undefined) {
      return '';
    }
    const val = row[idx];
    return val !== undefined && val !== null ? String(val).trim() : '';
  }

  // Process each competition's cached match rows
  for (let ci = 0; ci < compIds.length; ci++) {
    const compId = compIds[ci];
    const compName = getCompDisplayName(compId);
    const rows = cachedCompRows[ci];

    if (!rows || rows.length === 0) {
      continue;
    }

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri] as string[];

      // Only look at Pending matches (not Complete, Walkover, or Bye)
      const status = get(row, 'status');
      if (status !== 'Pending') {
        continue;
      }

      // Only include matches where a date has been agreed
      const playedDate = get(row, 'played_date');
      if (!playedDate) {
        continue;
      }

      // Skip matches whose agreed date is in the past
      if (playedDate < todayStr) {
        continue;
      }

      const round = get(row, 'round');
      const side1Raw = get(row, 'side1');
      const side2Raw = get(row, 'side2');

      // Parse pipe-separated usernames from side1 and side2
      const side1Usernames: string[] = [];
      if (side1Raw) {
        const parts = side1Raw.split('|');
        for (let pi = 0; pi < parts.length; pi++) {
          const p = parts[pi].trim();
          if (p) {
            side1Usernames.push(p);
          }
        }
      }

      const side2Usernames: string[] = [];
      if (side2Raw) {
        const parts = side2Raw.split('|');
        for (let pi = 0; pi < parts.length; pi++) {
          const p = parts[pi].trim();
          if (p) {
            side2Usernames.push(p);
          }
        }
      }

      // ── Competition match diary item ──
      // Check if the member is in side1 or side2
      let memberInSide: 1 | 2 | 0 = 0;
      for (let pi = 0; pi < side1Usernames.length; pi++) {
        if (side1Usernames[pi].toLowerCase() === userName.toLowerCase()) {
          memberInSide = 1;
          break;
        }
      }
      if (memberInSide === 0) {
        for (let pi = 0; pi < side2Usernames.length; pi++) {
          if (side2Usernames[pi].toLowerCase() === userName.toLowerCase()) {
            memberInSide = 2;
            break;
          }
        }
      }

      if (memberInSide !== 0) {
        // Build the opponent display: the side the member is NOT on
        const opponentUsernames = memberInSide === 1 ? side2Usernames : side1Usernames;

        let opponentDisplay = 'TBD';
        if (opponentUsernames.length > 0) {
          // Resolve each opponent username to a display name
          const opponentNames: string[] = [];
          for (let pi = 0; pi < opponentUsernames.length; pi++) {
            const oppName = nameMap.get(opponentUsernames[pi].toLowerCase());
            if (oppName) {
              opponentNames.push(oppName);
            } else {
              // Username not found in Members — use the raw username as fallback
              opponentNames.push(opponentUsernames[pi]);
            }
          }
          opponentDisplay = opponentNames.join(' & ');
        }

        competitionItems.push({
          type: 'competition',
          date: playedDate,
          displayDate: formatDiaryDate(playedDate),
          label: `${compName} — ${round}`,
          subLabel: `vs ${opponentDisplay}`,
          linkUrl: `/competitions/${compId}`,
        });
      }

      // ── Marker diary item ──
      // Check if the member is the assigned marker for this match
      const markerUsername = get(row, 'marker');
      if (markerUsername && markerUsername.toLowerCase() === userName.toLowerCase()) {
        // Resolve the two players' names for the subLabel
        let side1Name = 'TBD';
        let side2Name = 'TBD';

        if (side1Usernames.length > 0) {
          const resolved = nameMap.get(side1Usernames[0].toLowerCase());
          side1Name = resolved ? resolved : side1Usernames[0];
        }
        if (side2Usernames.length > 0) {
          const resolved = nameMap.get(side2Usernames[0].toLowerCase());
          side2Name = resolved ? resolved : side2Usernames[0];
        }

        markerItems.push({
          type: 'marker',
          date: playedDate,
          displayDate: formatDiaryDate(playedDate),
          label: `${compName} — ${round}`,
          subLabel: `Marking: ${side1Name} vs ${side2Name}`,
          linkUrl: `/competitions/${compId}`,
        });
      }
    }
  }

  return { competitionItems, markerItems };
}

// ─── Sources 6 & 7: AVAILABILITY spreadsheet — Nudges + Confirmed ─────────────

type AvailabilityResult = {
  nudgeItems: DiaryItem[];
  confirmedItems: DiaryItem[];
};

// Fetch availability events, slots, responses, and invitees in one batchGet call
// Build diary items for: open events needing a response (nudge) and concluded
// events where the member said Yes to the winning slot
async function fetchAvailabilityItems(
  userName: string,
  todayStr: string
): Promise<AvailabilityResult> {
  const nudgeItems: DiaryItem[] = [];
  const confirmedItems: DiaryItem[] = [];

  let availabilitySpreadsheetId: string;
  try {
    availabilitySpreadsheetId = getAvailabilitySpreadsheetId();
  } catch (_err) {
    // AVAILABILITY_SPREADSHEET_ID not configured — skip availability items
    return { nudgeItems, confirmedItems };
  }

  const sheets = getGoogleSheetsClient();

  // Fetch the availability sheets in one batchGet call. The roster is the group's members
  // (there is no invitees sheet), so we read AvailabilityGroupMembers to find the member's
  // groups.
  const batchResponse = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: availabilitySpreadsheetId,
    ranges: [
      'AvailabilityEvents!A2:P',
      'AvailabilitySlots!A2:F',
      'AvailabilityResponses!A2:K',
      'AvailabilityGroupMembers!A2:N',
    ],
  });

  const valueRanges = batchResponse.data.valueRanges;
  if (!valueRanges || valueRanges.length < 4) {
    return { nudgeItems, confirmedItems };
  }

  // Get column maps for each sheet so we access by name
  const [eventsColMap, slotsColMap, responsesColMap, membersColMap] = await Promise.all([
    getColumnMap('AvailabilityEvents', availabilitySpreadsheetId),
    getColumnMap('AvailabilitySlots', availabilitySpreadsheetId),
    getColumnMap('AvailabilityResponses', availabilitySpreadsheetId),
    getColumnMap('AvailabilityGroupMembers', availabilitySpreadsheetId),
  ]);

  // Build safe cell accessor for a given column map
  function makeGetter(colMap: Record<string, number>) {
    return function get(row: string[], field: string): string {
      const idx = colMap[field];
      if (idx === undefined) {
        return '';
      }
      const val = row[idx];
      return val !== undefined && val !== null ? String(val).trim() : '';
    };
  }

  const getEvent = makeGetter(eventsColMap);
  const getSlot = makeGetter(slotsColMap);
  const getResponse = makeGetter(responsesColMap);
  const getMember = makeGetter(membersColMap);

  const eventsRows = valueRanges[0].values || [];
  const slotsRows = valueRanges[1].values || [];
  const responsesRows = valueRanges[2].values || [];
  const memberRows = valueRanges[3].values || [];

  // Build a map from eventId → member's response record(s) for quick lookups
  // Map: eventId → slotId → response value ('yes' | 'maybe' | 'no')
  const memberResponseMap: Map<string, Map<string, string>> = new Map();
  for (let i = 0; i < responsesRows.length; i++) {
    const row = responsesRows[i] as string[];
    const respUserName = getResponse(row, 'user_name');
    if (respUserName.toLowerCase() !== userName.toLowerCase()) {
      continue;
    }
    const eventId = getResponse(row, 'event_id');
    const slotId = getResponse(row, 'slot_id');
    const response = getResponse(row, 'response');
    if (!eventId || !slotId) {
      continue;
    }
    if (!memberResponseMap.has(eventId)) {
      memberResponseMap.set(eventId, new Map());
    }
    const slotMap = memberResponseMap.get(eventId);
    if (slotMap) {
      slotMap.set(slotId, response);
    }
  }

  // Build the set of groupIds this member belongs to (the roster = group members)
  const callerGroupIds = new Set<string>();
  for (let i = 0; i < memberRows.length; i++) {
    const row = memberRows[i] as string[];
    const memberUserName = getMember(row, 'user_name');
    if (memberUserName.toLowerCase() === userName.toLowerCase()) {
      const groupId = getMember(row, 'group_id');
      if (groupId) {
        callerGroupIds.add(groupId);
      }
    }
  }

  // Build a map from slotId → slot object for quick concluded-slot lookups
  const slotMap: Map<string, string[]> = new Map();
  for (let i = 0; i < slotsRows.length; i++) {
    const row = slotsRows[i] as string[];
    const slotId = getSlot(row, 'slot_id');
    if (slotId) {
      slotMap.set(slotId, row as string[]);
    }
  }

  // Process each event row
  for (let i = 0; i < eventsRows.length; i++) {
    const row = eventsRows[i] as string[];
    const eventId = getEvent(row, 'event_id');
    const title = getEvent(row, 'title');
    const status = getEvent(row, 'status');       // 'open' | 'closed' | 'concluded' | 'archived'
    const groupId = getEvent(row, 'group_id');    // blank = public event
    const concludedSlotId = getEvent(row, 'concluded_slot_id');
    const createdAt = getEvent(row, 'created_at');

    if (!eventId) {
      continue;
    }

    // The member is invited when they belong to the event's group (polls are group-only)
    if (!groupId || !callerGroupIds.has(groupId)) {
      continue;
    }

    // ── Availability nudge: open event, member has not responded ──
    if (status === 'open') {
      const memberResponses = memberResponseMap.get(eventId);
      const hasResponded = memberResponses !== undefined && memberResponses.size > 0;

      if (!hasResponded) {
        // Use createdAt as the sort date — nudges sort by event creation date
        // Extract just the YYYY-MM-DD portion from the ISO timestamp
        let nudgeDate = todayStr;
        if (createdAt && createdAt.length >= 10) {
          nudgeDate = createdAt.substring(0, 10);
        }

        nudgeItems.push({
          type: 'availability_nudge',
          date: nudgeDate,
          displayDate: formatDiaryDate(nudgeDate),
          label: title || 'Availability Event',
          subLabel: 'Awaiting your response',
          linkUrl: `/availability/${eventId}`,
        });
      }
    }

    // ── Availability confirmed: concluded event, member said Yes to winning slot ──
    if (status === 'concluded' && concludedSlotId) {
      // Check if the member responded 'yes' to the winning slot
      const memberResponses = memberResponseMap.get(eventId);
      let respondedYes = false;
      if (memberResponses) {
        const slotResponse = memberResponses.get(concludedSlotId);
        if (slotResponse === 'yes') {
          respondedYes = true;
        }
      }

      if (respondedYes) {
        // Get the winning slot to extract its datetime
        const winningSlotRow = slotMap.get(concludedSlotId);
        if (winningSlotRow) {
          const slotDatetime = getSlot(winningSlotRow, 'slot_datetime');
          if (slotDatetime) {
            // Extract just the date portion (YYYY-MM-DD) from the ISO timestamp
            const slotDate = slotDatetime.length >= 10 ? slotDatetime.substring(0, 10) : '';
            if (slotDate && slotDate >= todayStr) {
              confirmedItems.push({
                type: 'availability_confirmed',
                date: slotDate,
                displayDate: formatDiaryDate(slotDate),
                label: title || 'Availability Event',
                subLabel: 'Confirmed — you said Yes',
                linkUrl: `/availability/events/${eventId}`,
              });
            }
          }
        }
      }
    }
  }

  return { nudgeItems, confirmedItems };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

// Aggregate all diary items for the given member across all data sources.
// Each source is fetched with graceful error handling so a single failure
// does not prevent the rest of the diary from loading.
export async function getDiaryItems(userName: string): Promise<DiaryItem[]> {
  const todayStr = getTodayIso();

  // Fetch all users once for name resolution in competition items
  let allUsers: Awaited<ReturnType<typeof getAllUsers>> = [];
  try {
    allUsers = await getAllUsers();
  } catch (_err) {
    // Non-fatal: competition items will fall back to using usernames as names
  }
  const nameMap = buildNameMap(allUsers);

  // Run all four data-source fetches in parallel, capturing results and errors separately
  const [membersResult, friendliesResult, compsResult, availabilityResult] = await Promise.allSettled([
    fetchMembersRotaItems(userName, todayStr),
    fetchFriendliesItems(userName, todayStr),
    fetchCompetitionsItems(userName, todayStr, nameMap),
    fetchAvailabilityItems(userName, todayStr),
  ]);

  const items: DiaryItem[] = [];

  // Collect items from MEMBERS rota (cleaning + sweeping)
  if (membersResult.status === 'fulfilled') {
    for (let i = 0; i < membersResult.value.cleaningItems.length; i++) {
      items.push(membersResult.value.cleaningItems[i]);
    }
    for (let i = 0; i < membersResult.value.sweepingItems.length; i++) {
      items.push(membersResult.value.sweepingItems[i]);
    }
  }

  // Collect items from FRIENDLIES (tea duty + friendly entries)
  if (friendliesResult.status === 'fulfilled') {
    for (let i = 0; i < friendliesResult.value.teaItems.length; i++) {
      items.push(friendliesResult.value.teaItems[i]);
    }
    for (let i = 0; i < friendliesResult.value.friendlyItems.length; i++) {
      items.push(friendliesResult.value.friendlyItems[i]);
    }
  }

  // Collect items from COMPETITIONS (match dates + marker duties)
  if (compsResult.status === 'fulfilled') {
    for (let i = 0; i < compsResult.value.competitionItems.length; i++) {
      items.push(compsResult.value.competitionItems[i]);
    }
    for (let i = 0; i < compsResult.value.markerItems.length; i++) {
      items.push(compsResult.value.markerItems[i]);
    }
  }

  // Collect items from AVAILABILITY (confirmed concluded events only — open polls
  // are shown in the separate OpenPollsPanel on the home page, not in "Coming Up")
  if (availabilityResult.status === 'fulfilled') {
    for (let i = 0; i < availabilityResult.value.confirmedItems.length; i++) {
      items.push(availabilityResult.value.confirmedItems[i]);
    }
  }

  // Sort all items ascending by ISO date (lexicographic sort works for YYYY-MM-DD)
  items.sort((a, b) => {
    if (a.date < b.date) {
      return -1;
    }
    if (a.date > b.date) {
      return 1;
    }
    return 0;
  });

  // Admin-only: surface membership applications awaiting review at the very top
  // of the diary (added after the sort so it stays pinned above dated items).
  // Find the current user in the already-fetched member list to read their role.
  let currentUserRole = '';
  for (let i = 0; i < allUsers.length; i++) {
    if (allUsers[i].userName && allUsers[i].userName.toLowerCase() === userName.toLowerCase()) {
      currentUserRole = allUsers[i].role;
      break;
    }
  }

  if (hasRole(currentUserRole, 'Admin')) {
    try {
      const pendingCount = await getPendingApplicationsCount();
      if (pendingCount > 0) {
        // Pluralise "application(s)" correctly
        const noun = pendingCount === 1 ? 'application' : 'applications';
        items.unshift({
          type: 'applications_pending',
          date: todayStr,
          displayDate: '',
          label: `${pendingCount} membership ${noun} ready for review`,
          subLabel: '',
          linkUrl: '/admin/members/applications',
        });
      }
    } catch (_err) {
      // Non-fatal: if the Applications sheet can't be read, just omit this item
    }
  }

  return items;
}
