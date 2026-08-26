// src/lib/diary-sheets.ts
// Data layer for the home-page Diary Panel.
// Aggregates upcoming duties and game entries for a single member across
// CleaningRota, SweepingRota, Fixtures/Postgres (tea duty + friendlies) +
// the still-Sheets-native Players roster, competition match sheets, and
// Availability events.

import {
  getGoogleSheetsClient,
  getColumnMap,
} from './sheets';
import { getFriendliesSpreadsheetId } from './friendlies-sheets';
import { getActiveSeasonId } from './fixtures-supabase';
import { getAllUsers } from './members-supabase';
import { getCleaningRotaList } from './cleaning-rota-supabase';
import { getSweepingRotaList } from './sweeping-rota-supabase';
import { parseUKDate } from './date-utils';
import { getSheetDataCache, setSheetDataCache } from './home-cache';
import { hasRole } from './role-utils';
import { getPendingApplicationsCount } from './applications-supabase';
import { getCommitments } from './member-availability';
import { getSupabaseClient } from './supabase';
import type { DiaryItem } from '@/types/diary';

// ─── Date Helpers ─────────────────────────────────────────────────────────────

// Get today's date as a YYYY-MM-DD string, using local time (avoids UTC midnight drift)
export function getTodayIso(): string {
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
// These strings have no year, so we interpret them as the current calendar year.
// The caller filters out past dates, so a duty drops off "Coming Up" once its date
// passes — we deliberately do NOT roll a passed date forward to next year (the rota
// is seasonal and regenerated each year, so a rolled-forward date would wrongly keep
// showing a duty that has already happened).
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

  // Interpret the date as the current calendar year. The caller drops past dates.
  const year = new Date().getFullYear();
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
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

// ─── Source 1 & 2: Postgres — Cleaning + Sweeping Rota ───────────────────────

type MembersRotaResult = {
  cleaningItems: DiaryItem[];
  sweepingItems: DiaryItem[];
};

// Fetch CleaningRota and SweepingRota data from Postgres.
async function fetchMembersRotaItems(userName: string, todayStr: string): Promise<MembersRotaResult> {
  const [cleaningEntries, sweepingEntries] = await Promise.all([
    getCleaningRotaList(),
    getSweepingRotaList(),
  ]);

  const cleaningItems: DiaryItem[] = [];
  const sweepingItems: DiaryItem[] = [];

  for (const entry of cleaningEntries) {
    // Parse the display date (e.g. "Sat, 05 September") to a sortable YYYY-MM-DD
    const isoDate = parseCleaningRotaDate(entry.date);
    if (!isoDate) {
      continue;
    }

    // Skip dates that are in the past
    if (isoDate < todayStr) {
      continue;
    }

    // Only include the row if the member is one of the assigned cleaners
    const isCleaner = (entry.lead === userName || entry.second === userName || entry.third === userName || entry.fourth === userName);
    if (!isCleaner) {
      continue;
    }

    cleaningItems.push({
      type: 'cleaning',
      date: isoDate,
      displayDate: formatDiaryDate(isoDate),
      label: 'Cleaning Duty',
      subLabel: entry.date,
      linkUrl: '/cleaning-rota',
    });
  }

  for (const entry of sweepingEntries) {
    // Skip blocked dates — they are not assignable
    if (entry.isBlocked) {
      continue;
    }

    // Skip rows not belonging to this member
    if (entry.userName !== userName) {
      continue;
    }

    const isoDate = anyDateToIso(entry.date);
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

  return { cleaningItems, sweepingItems };
}

// ─── Source 3 & 4: Fixtures (Postgres) + Players spreadsheet — Tea duty + Friendly entries ───

type FriendliesResult = {
  teaItems: DiaryItem[];
  friendlyItems: DiaryItem[];
};

interface DiaryFixtureRow {
  date: string; // ISO YYYY-MM-DD, direct from Postgres
  tabName: string;
  clubName: string;
  clubSuffix: string;
  homeAway: string;
  status: string;
  needsPlayers: boolean;
  teaLead: string;
  teaFirst: string;
  teaSecond: string;
}

// Active-season Friendly fixtures, straight from Postgres — the live source of
// truth for game status/tab_name since the Games/Fixtures Postgres cutover
// (2026-08-19). The Games Google Sheet tab was frozen at that migration and
// nothing writes to it anymore (see project memory: diary-sheets.ts was found
// to be the sheet's only remaining reader, which is exactly why a member's
// newly-opened/progressed games could go permanently invisible in their diary
// — the sheet never caught up). Postgres reads are always fresh, no caching
// needed here, unlike the Players sheet below (still genuinely Sheets-native).
async function fetchDiaryFixtures(): Promise<DiaryFixtureRow[]> {
  const supabase = getSupabaseClient();
  const seasonId = await getActiveSeasonId();
  const { data, error } = await supabase
    .from('fixtures')
    .select('date, tab_name, club_name, club_suffix, home_away, game_status, needs_players, tea_lead_username, tea_first_username, tea_second_username')
    .eq('season_id', seasonId)
    .eq('fixture_type', 'Friendly');
  if (error) throw new Error(`Failed to fetch fixtures: ${error.message}`);
  return (data ?? []).map((row: any) => ({
    date: row.date || '',
    tabName: row.tab_name || '',
    clubName: row.club_name || '',
    clubSuffix: row.club_suffix || '',
    homeAway: row.home_away || '',
    status: row.game_status || '',
    needsPlayers: (row.needs_players || '').toString().toUpperCase() === 'Y',
    teaLead: row.tea_lead_username || '',
    teaFirst: row.tea_first_username || '',
    teaSecond: row.tea_second_username || '',
  }));
}

// Fetch this member's Players-sheet entry row (still genuinely Sheets-native —
// unlike Games, nothing has moved this to Postgres) from the 24-hour shared
// cache when available, then build tea-duty and friendly-entry diary items by
// cross-referencing against the fixtures fetched from Postgres above.
async function fetchFriendliesItems(userName: string, todayStr: string): Promise<FriendliesResult> {
  const spreadsheetId = getFriendliesSpreadsheetId();

  const [fixtures, playersColMap] = await Promise.all([
    fetchDiaryFixtures(),
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

  const playersCacheKey = `friendlies-players:${spreadsheetId}`;
  let playersRows = getSheetDataCache(playersCacheKey);
  if (!playersRows) {
    const sheets = getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Players!A:ZZ',
    });
    playersRows = (response.data.values ?? []) as string[][];
    setSheetDataCache(playersCacheKey, playersRows);
  }

  const teaItems: DiaryItem[] = [];
  const friendlyItems: DiaryItem[] = [];

  // ── Find the member's row in the cached Players data ──
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

  // ── Process fixtures ──
  for (const fx of fixtures) {
    // Only process active games
    if (fx.status !== 'O' && fx.status !== 'X' && fx.status !== 'S') {
      continue;
    }

    // Skip past games — fx.date is already ISO from Postgres, no parsing needed
    if (!fx.date || fx.date < todayStr) {
      continue;
    }

    const tabName = fx.tabName;
    const homeAway = fx.homeAway.trim().toUpperCase() === 'A' ? 'A' : 'H';

    // Build the display club name (append suffix if present)
    let displayClub = fx.clubName;
    if (fx.clubSuffix) {
      displayClub = `${fx.clubName} ${fx.clubSuffix}`;
    }

    const haLabel = homeAway === 'A' ? 'Away' : 'Home';
    const gameLabel = `vs ${displayClub} (${haLabel})`;

    // ── Tea duty check ──
    if (fx.teaLead === userName || fx.teaFirst === userName || fx.teaSecond === userName) {
      const teaRole = fx.teaLead === userName ? 'Tea Lead' : 'Tea (Helper)';

      teaItems.push({
        type: 'tea',
        date: fx.date,
        displayDate: formatDiaryDate(fx.date),
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
            date: fx.date,
            displayDate: formatDiaryDate(fx.date),
            label: gameLabel,
            subLabel: entryStatus === 'P' ? 'Selected' : entryStatus === 'R' || entryStatus === 'T' ? 'Reserve' : 'Entered',
            linkUrl: '/friendlies',
          });
        }
      } else if (fx.needsPlayers && fx.status === 'O') {
        // Captain has flagged this game as needing players, and this member hasn't entered yet
        friendlyItems.push({
          type: 'friendly-needs-players',
          date: fx.date,
          displayDate: formatDiaryDate(fx.date),
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

// Find Pending matches with an agreed (future) played date where the member is a
// player or the assigned marker. Straight Postgres query — the old Sheets version's
// batchGet-plus-24h-cache dance existed purely to stay under the Sheets API's per-minute
// quota; that concern doesn't apply here.
async function fetchCompetitionsItems(
  userName: string,
  todayStr: string,
  nameMap: Map<string, string>
): Promise<CompsResult> {
  const supabase = getSupabaseClient();

  const [matchesResp, compsResp] = await Promise.all([
    supabase
      .from('competition_matches')
      .select('comp_id, round, side1_usernames, side2_usernames, marker_username, played_date')
      .eq('status', 'Pending')
      .gte('played_date', todayStr),
    supabase.from('competitions').select('comp_id, display_name'),
  ]);
  if (matchesResp.error) throw new Error(`Failed to fetch competition matches: ${matchesResp.error.message}`);
  if (compsResp.error) throw new Error(`Failed to fetch competitions: ${compsResp.error.message}`);

  const compDisplayNames: Record<string, string> = {};
  for (const c of compsResp.data ?? []) {
    if (c.comp_id && c.display_name) compDisplayNames[c.comp_id] = c.display_name;
  }

  // Fallback: format compId (e.g. "mens-championship" → "Mens Championship") for a
  // competition somehow missing from the control table
  function getCompDisplayName(compId: string): string {
    if (compDisplayNames[compId]) return compDisplayNames[compId];
    return compId.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  const competitionItems: DiaryItem[] = [];
  const markerItems: DiaryItem[] = [];

  for (const row of matchesResp.data ?? []) {
    const compId = row.comp_id as string;
    const compName = getCompDisplayName(compId);
    const round = row.round as string;
    const playedDate = row.played_date as string;
    const side1Usernames: string[] = row.side1_usernames ?? [];
    const side2Usernames: string[] = row.side2_usernames ?? [];

    // ── Competition match diary item ──
    let memberInSide: 1 | 2 | 0 = 0;
    if (side1Usernames.some((u) => u.toLowerCase() === userName.toLowerCase())) {
      memberInSide = 1;
    } else if (side2Usernames.some((u) => u.toLowerCase() === userName.toLowerCase())) {
      memberInSide = 2;
    }

    if (memberInSide !== 0) {
      const opponentUsernames = memberInSide === 1 ? side2Usernames : side1Usernames;
      let opponentDisplay = 'TBD';
      if (opponentUsernames.length > 0) {
        opponentDisplay = opponentUsernames
          .map((u) => nameMap.get(u.toLowerCase()) || u)
          .join(' & ');
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
    const markerUsername = row.marker_username as string | null;
    if (markerUsername && markerUsername.toLowerCase() === userName.toLowerCase()) {
      const side1Name = side1Usernames.length > 0 ? (nameMap.get(side1Usernames[0].toLowerCase()) || side1Usernames[0]) : 'TBD';
      const side2Name = side2Usernames.length > 0 ? (nameMap.get(side2Usernames[0].toLowerCase()) || side2Usernames[0]) : 'TBD';

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

  return { competitionItems, markerItems };
}

// Find Scheduled league matches the member has specifically been named as playing
// (league_match_players) — being on the team's overall squad is not enough on its
// own. Uses a resolved date (the real arranged scheduledDate, falling back to the
// pairs-league playByDate deadline if no real date has been arranged yet) that's
// today or later.
async function fetchLeagueItems(
  userName: string,
  todayStr: string
): Promise<DiaryItem[]> {
  const supabase = getSupabaseClient();

  const [{ data: lineupRows, error: lineupError }, { data: squadRows, error: squadError }] = await Promise.all([
    supabase.from('league_match_players').select('match_id').eq('username', userName),
    supabase.from('league_squad').select('team_id').eq('username', userName),
  ]);
  if (lineupError) throw new Error(`Failed to fetch league match lineup: ${lineupError.message}`);
  if (squadError) throw new Error(`Failed to fetch league squad membership: ${squadError.message}`);

  const myMatchIds = (lineupRows ?? []).map((r) => r.match_id as string);
  if (myMatchIds.length === 0) return [];
  const myTeamIds = new Set((squadRows ?? []).map((r) => r.team_id).filter(Boolean));

  const [matchesResp, leaguesResp, teamsResp] = await Promise.all([
    supabase
      .from('league_matches')
      .select('match_id, league_id, home_team_id, away_team_id, scheduled_date, scheduled_time, play_by_date, status')
      .in('match_id', myMatchIds),
    supabase.from('leagues').select('league_id, name'),
    supabase.from('league_teams').select('team_id, team_name'),
  ]);
  if (matchesResp.error) throw new Error(`Failed to fetch league matches: ${matchesResp.error.message}`);
  if (leaguesResp.error) throw new Error(`Failed to fetch leagues: ${leaguesResp.error.message}`);
  if (teamsResp.error) throw new Error(`Failed to fetch league teams: ${teamsResp.error.message}`);

  const leagueNames: Record<string, string> = {};
  for (const l of leaguesResp.data ?? []) leagueNames[l.league_id] = l.name;
  const teamNames: Record<string, string> = {};
  for (const t of teamsResp.data ?? []) teamNames[t.team_id] = t.team_name;

  const items: DiaryItem[] = [];
  for (const row of matchesResp.data ?? []) {
    if (row.status !== 'Scheduled') continue;

    const date = (row.scheduled_date as string | null) ?? (row.play_by_date as string | null);
    if (!date || date < todayStr) continue;

    const opponentTeamId = myTeamIds.has(row.home_team_id) ? row.away_team_id : row.home_team_id;
    const opponentName = teamNames[opponentTeamId] ?? 'TBD';
    const leagueName = leagueNames[row.league_id] ?? row.league_id;
    const time = row.scheduled_time ? ` at ${row.scheduled_time}` : '';

    items.push({
      type: 'league',
      date,
      displayDate: formatDiaryDate(date),
      label: leagueName,
      subLabel: `vs ${opponentName}${time}`,
      linkUrl: `/leagues/${row.league_id}`,
    });
  }

  return items;
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

  // ── Availability nudge: open events in a group this member belongs to, where they
  // haven't yet responded. The roster is the group's members (there is no invitees
  // table), so we read availability_group_members to find the member's groups.
  const supabase = getSupabaseClient();

  const [eventsResp, responsesResp, membersResp] = await Promise.all([
    supabase.from('availability_events').select('id, title, status, group_id, created_at').eq('status', 'open'),
    supabase.from('availability_responses').select('event_id, username').eq('respondent_type', 'member'),
    supabase.from('availability_group_members').select('group_id, username').eq('member_type', 'member'),
  ]);
  if (eventsResp.error) throw new Error(`Failed to fetch open availability events: ${eventsResp.error.message}`);
  if (responsesResp.error) throw new Error(`Failed to fetch availability responses: ${responsesResp.error.message}`);
  if (membersResp.error) throw new Error(`Failed to fetch availability group members: ${membersResp.error.message}`);

  // Build the set of groupIds this member belongs to (the roster = group members)
  const callerGroupIds = new Set<string>();
  for (const row of membersResp.data || []) {
    if (row.username && row.username.toLowerCase() === userName.toLowerCase() && row.group_id) {
      callerGroupIds.add(row.group_id);
    }
  }

  // Events this member has already responded to (any slot)
  const respondedEventIds = new Set<string>();
  for (const row of responsesResp.data || []) {
    if (row.username && row.username.toLowerCase() === userName.toLowerCase() && row.event_id) {
      respondedEventIds.add(row.event_id);
    }
  }

  // Process each open event row
  for (const row of eventsResp.data || []) {
    const eventId = row.id;
    const groupId = row.group_id; // null = public event

    if (!eventId) {
      continue;
    }

    // The member is invited when they belong to the event's group (polls are group-only)
    if (!groupId || !callerGroupIds.has(groupId)) {
      continue;
    }

    if (respondedEventIds.has(eventId)) {
      continue;
    }

    // Use createdAt as the sort date — nudges sort by event creation date
    // Extract just the YYYY-MM-DD portion from the ISO timestamp
    let nudgeDate = todayStr;
    if (row.created_at && row.created_at.length >= 10) {
      nudgeDate = row.created_at.substring(0, 10);
    }

    nudgeItems.push({
      type: 'availability_nudge',
      date: nudgeDate,
      displayDate: formatDiaryDate(nudgeDate),
      label: row.title || 'Availability Event',
      subLabel: 'Awaiting your response',
      linkUrl: `/availability/${eventId}`,
    });
  }

  // ── Availability confirmed: read from the member-availability commitments table.
  // These are written by the conclude route's writeback (source='availability') — one
  // row per member who said Yes to the winning slot — so this is now a straight
  // Postgres read instead of re-deriving from Sheets events/slots/responses.
  try {
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 365);
    const [y, m, d] = todayStr.split('-');
    const todayUK = `${d}/${m}/${y}`;
    const farFutureUK = `${farFuture.getDate().toString().padStart(2, '0')}/${(farFuture.getMonth() + 1).toString().padStart(2, '0')}/${farFuture.getFullYear()}`;

    const commitments = await getCommitments([userName], todayUK, farFutureUK);
    for (const c of commitments) {
      if (c.source !== 'availability') continue;
      const [cd, cm, cy] = c.date.split('/');
      const isoDate = `${cy}-${cm}-${cd}`;
      confirmedItems.push({
        type: 'availability_confirmed',
        date: isoDate,
        displayDate: formatDiaryDate(isoDate),
        label: c.label || 'Availability Event',
        subLabel: c.subLabel || 'Confirmed',
        linkUrl: c.linkUrl || '',
      });
    }
  } catch (commitmentsError) {
    // Commitments are a convenience layer here — never fail the whole diary over it.
    console.error('[fetchAvailabilityItems] Failed to read commitments:', commitmentsError);
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

  // Run all data-source fetches in parallel, capturing results and errors separately
  const [membersResult, friendliesResult, compsResult, leaguesResult, availabilityResult] = await Promise.allSettled([
    fetchMembersRotaItems(userName, todayStr),
    fetchFriendliesItems(userName, todayStr),
    fetchCompetitionsItems(userName, todayStr, nameMap),
    fetchLeagueItems(userName, todayStr),
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

  // Collect items from LEAGUES (upcoming fixtures for teams the member is on)
  if (leaguesResult.status === 'fulfilled') {
    for (let i = 0; i < leaguesResult.value.length; i++) {
      items.push(leaguesResult.value[i]);
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
