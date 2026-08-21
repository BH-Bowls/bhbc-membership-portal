// app/friendlies/page.tsx
// Main Friendlies page - displays list of friendly matches with entry/withdrawal functionality
// Players can view all games, filter by status, and enter/withdraw from open games
// Captains and Admins also see a "Manage Games" button to access team selection

'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// useLayoutEffect runs synchronously after DOM update but before paint — used to
// restore cached state without a flash of the loading spinner on back-navigation.
// On the server (SSR) it falls back to useEffect to avoid React warnings.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import { useSession } from 'next-auth/react';
import { GameWithUserStatus, FriendliesBuddy } from '@/lib/types/friendlies';
import { useNavbarConfig } from '@/lib/navbar-config';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import Link from 'next/link';
import { getButtonClasses } from '@/config/theme-helpers';
import { canEnterGame, type GameGender } from '@/lib/member-type-utils';
import { calculateCapacity, formatCapacity, getCapacityBadgeColor } from '@/lib/game-management/capacity';
import { EnteredPlayersModal } from '@/components/game-management/EnteredPlayersModal';
import { parseUKDate } from '@/lib/date-utils';
import { groupPairedGames, isPairedGame, type GameOrPair } from '@/lib/friendlies-utils';
import { hasRole } from '@/lib/role-utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Filter options for displaying games
 * 'all' - Show all games regardless of status
 * 'O' - Show only Open games (available for entry)
 * 'entered' - Show only games the user has entered that haven't been played or cancelled
 * 'played'  - Show only games the user entered that have been played, cancelled, or abandoned
 */
// Two-level tab model:
//   Primary tab: All Games | My Games | My Stats
//   All Games sub-filter:  Upcoming | Open | Selecting | Played
//   My Games sub-filter:   Not played | Played
type PrimaryTab = 'all' | 'mine' | 'stats';
type AllSub = 'upcoming' | 'open' | 'selecting' | 'played';
type MineSub = 'notplayed' | 'played';

// ── Stats types ───────────────────────────────────────────────────────────────

interface StatsDetailEntry {
  tabName: string;
  date: string;
  clubName: string;
  format: string;
  homeAway: string;
  gameStatus: string;
  playerStatus: string;
  displayStatus: string;
}

interface StatsSummary {
  selected: number;
  reserve: number;
  reserveTeam: number;
  opposition: number;
  withdrawn: number;
  cancelled: number;
  abandoned: number;
  entered: number;
}

interface StatsData {
  detail: StatsDetailEntry[];
  summary: StatsSummary;
  targetUser: string;
  playerList: { userName: string; fullName: string }[] | null;
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Friendlies Page Component
 * Main page for players to view and enter friendly matches
 * Features:
 * - View all games with status badges (Open, Selecting, Selected, Played, etc.)
 * - Filter games by status or user's participation
 * - Enter/withdraw from open games using checkboxes
 * - Floating action button shows when there are pending changes
 * - Batch update of entries with error handling
 */
export default function FriendliesPage() {
  // Get current user session for authentication and role checking
  const { data: session, status } = useSession();
  const isGuest = status === 'unauthenticated';
  const isKiosk = (session?.user?.role || '') === 'Kiosk';
  // Guests and kiosk users see read-only friendlies (no entry, no My Entries/My Played)
  const isLimitedView = isGuest || isKiosk;

  // State: List of all games with user's entry status for each
  const [games, setGames] = useState<GameWithUserStatus[]>([]);

  // State: Two-level tab selection (restored from sessionStorage in layout effect below).
  // Defaults to All Games → Open so the page opens on games available to enter.
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>('all');
  const [allSub, setAllSub] = useState<AllSub>('open');
  const [mineSub, setMineSub] = useState<MineSub>('notplayed');

  // State: Buddies the current user can enter alongside themselves (from games API)
  const [buddies, setBuddies] = useState<FriendliesBuddy[]>([]);

  // State: Enter-game confirm dialog. When set, the dialog is open for this game.
  // For a paired-game card this is game 1 of the pair (entry always goes into game 1).
  const [enterDialogGame, setEnterDialogGame] = useState<GameWithUserStatus | null>(null);
  // Buddy usernames ticked inside the enter dialog (opt-in, cleared each open)
  const [enterBuddySelected, setEnterBuddySelected] = useState<Set<string>>(new Set());
  // Whether "Making my own way" is ticked inside the enter dialog (away games only)
  const [enterOwnTransport, setEnterOwnTransport] = useState(false);

  // State: Remove confirm dialog — the open game the user is removing themselves from.
  // (Removal from an open game is distinct from a post-selection "withdrawal".)
  const [removeDialogGame, setRemoveDialogGame] = useState<GameWithUserStatus | null>(null);
  // Buddy usernames ticked inside the remove dialog (opt-in, cleared each open)
  const [removeBuddySelected, setRemoveBuddySelected] = useState<Set<string>>(new Set());

  // State: Loading indicator while fetching games from API
  const [loading, setLoading] = useState(true);

  // Ref to prevent React 18 strict-mode double-invocation of the init effect
  const initDoneRef = useRef(false);

  // State: Explicit reload in progress (shows spinner on reload button)
  const [reloading, setReloading] = useState(false);

  // State: Entering/updating indicator while submitting changes
  const [entering, setEntering] = useState(false);

  // State: User's member type for filtering eligible games
  const [memberType, setMemberType] = useState<string>('');

  // State: Special instructions popup
  const [instructionsMessage, setInstructionsMessage] = useState<string | null>(null);

  // State: Modal for viewing and managing entered players
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedGameForModal, setSelectedGameForModal] = useState<GameWithUserStatus | null>(null);
  const [modalGameName, setModalGameName] = useState('');

  // State: Dates (YYYY-MM-DD) where the current user has tea duty
  const [teaDutyDates, setTeaDutyDates] = useState<Set<string>>(new Set());

  // State: My Stats tab
  const [statsSubView, setStatsSubView] = useState<'summary' | 'detail'>('summary');
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [statsPlayer, setStatsPlayer] = useState<string>(''); // userName of viewed player

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Effect: Fetch user's member type when page loads
   * Needed to filter games by eligibility (member type + game gender)
   */
  useEffect(() => {
    // Fetch user's profile to get member type
    async function fetchMemberType() {
      try {
        const response = await fetch('/api/profile');
        if (response.ok) {
          const data = await response.json();
          setMemberType(data.profile.memberType);
        }
      } catch (error) {
        console.error('Failed to fetch member type:', error);
      }
    }

    fetchMemberType();
  }, []);

  /**
   * Layout effect: restore client-side state from sessionStorage before first paint.
   * Runs synchronously after hydration so the browser never paints the loading spinner
   * or wrong filter tab when returning from a game.
   * Both reads MUST live here (not in useState) to avoid SSR/client hydration mismatches.
   */
  useIsomorphicLayoutEffect(() => {
    // Refs persist across React 18 strict-mode double-invocation; this ensures
    // we only run the init logic once so the back-nav flag isn't consumed twice.
    if (initDoneRef.current) return;
    initDoneRef.current = true;

    // Restore saved tab selection (with one-time migration from the old single filter)
    const savedPrimary = sessionStorage.getItem('friendlies_primary_tab') as PrimaryTab | null;
    const savedAllSub = sessionStorage.getItem('friendlies_all_sub') as AllSub | null;
    const savedMineSub = sessionStorage.getItem('friendlies_mine_sub') as MineSub | null;
    if (savedPrimary === 'all' || savedPrimary === 'mine' || savedPrimary === 'stats') {
      setPrimaryTab(savedPrimary);
    } else {
      // Migrate old 'friendlies_filter' values to the new two-level model
      const old = sessionStorage.getItem('friendlies_filter');
      if (old === 'entered') { setPrimaryTab('mine'); setMineSub('notplayed'); }
      else if (old === 'played') { setPrimaryTab('mine'); setMineSub('played'); }
      else if (old === 'stats') { setPrimaryTab('stats'); }
      else if (old === 'all') { setPrimaryTab('all'); setAllSub('upcoming'); }
      // 'O' (or unset) keeps the default: All Games → Open
    }
    if (savedAllSub === 'upcoming' || savedAllSub === 'open' || savedAllSub === 'selecting' || savedAllSub === 'played') {
      setAllSub(savedAllSub);
    }
    if (savedMineSub === 'notplayed' || savedMineSub === 'played') {
      setMineSub(savedMineSub);
    }

    // Restore game list from cache for instant display, then background-refresh
    const CACHE_KEY = 'friendlies_games_cache';
    const BACK_FLAG = 'friendlies_back_nav';

    sessionStorage.removeItem(BACK_FLAG); // consume back-nav flag (no longer used for cache gating)

    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        setGames(JSON.parse(cached));
        setLoading(false);
        fetchGames({ silent: true }); // refresh in background
        return;
      } catch {
        // Bad cache — fall through to fresh fetch
      }
    }

    fetchGames();
  }, []);

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Fetch all games from API with user's entry status.
   * Saves result to sessionStorage so the next visit is instant.
   * Pass { silent: true } to skip the loading spinner (background refresh).
   */
  async function fetchGames({ silent = false, fresh = false }: { silent?: boolean; fresh?: boolean } = {}) {
    const CACHE_KEY = 'friendlies_games_cache';
    if (!silent) setLoading(true);

    try {
      // fresh=true bypasses the server's Games cache so the entered count is current
      // right after an enter/withdraw (see the games route).
      const response = await fetch(`/api/friendlies/games${fresh ? '?fresh=1' : ''}`);
      const data = await response.json();

      if (data.games) {
        setGames(data.games);
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(data.games));
      }
      // Tea-duty dates now come back with the games response (same Games read), so
      // there's no separate /api/tea-rota fetch on this page.
      if (Array.isArray(data.teaDutyDates)) {
        setTeaDutyDates(new Set<string>(data.teaDutyDates));
      }
      // Buddies the user may enter alongside themselves (drives the enter dialog option)
      if (Array.isArray(data.buddies)) {
        setBuddies(data.buddies as FriendliesBuddy[]);
      }
    } catch (error) {
      if (!silent) alert('Failed to load games. Please refresh the page.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  /** Force a fresh fetch, bypassing both the client and server Games caches. */
  async function handleReload() {
    sessionStorage.removeItem('friendlies_games_cache');
    setReloading(true);
    await fetchGames({ fresh: true });
    setReloading(false);
  }

  /**
   * Buddies eligible to be entered into a specific game alongside the user.
   * A buddy is eligible when their member type is allowed for the game's Ladies/Men
   * classification and they are not already entered in that game.
   */
  function eligibleBuddiesForGame(game: GameWithUserStatus): FriendliesBuddy[] {
    return buddies.filter(b =>
      canEnterGame(b.memberType, game.ladiesMen as GameGender) &&
      !b.enteredTabNames.includes(game.tabName)
    );
  }

  /** Buddies already entered in a game — offered for removal alongside the user. */
  function enteredBuddiesForGame(game: GameWithUserStatus): FriendliesBuddy[] {
    return buddies.filter(b => b.enteredTabNames.includes(game.tabName));
  }

  /** Open the enter-game confirm dialog for a single game (game 1 for a pair). */
  function openEnterDialog(game: GameWithUserStatus) {
    setEnterBuddySelected(new Set());   // buddy is opt-in each time
    setEnterOwnTransport(false);
    setEnterDialogGame(game);
  }

  /** Open the remove-from-game confirm dialog for a single game. */
  function openRemoveDialog(game: GameWithUserStatus) {
    setRemoveBuddySelected(new Set());  // buddy removal is opt-in each time
    setRemoveDialogGame(game);
  }

  /**
   * Confirm entry for exactly one game (plus any ticked buddies). One write path —
   * this deliberately replaces the old batch "update all selected games" flow.
   */
  async function handleEnterConfirm() {
    const game = enterDialogGame;
    if (!game) return;

    setEntering(true);
    try {
      const onBehalfOf = Array.from(enterBuddySelected);
      const carNumbers = (game.homeAway === 'A' && enterOwnTransport)
        ? { [game.tabName]: 'O' }
        : undefined;

      const response = await fetch('/api/friendlies/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_ids: [game.tabName],
          ...(onBehalfOf.length > 0 ? { on_behalf_of: onBehalfOf } : {}),
          ...(carNumbers ? { car_numbers: carNumbers } : {}),
        }),
      });

      const data = await response.json();
      if (!response.ok || data.success === false) {
        alert(data.error || 'Failed to enter game.');
      } else {
        const failed = (data.results || []).filter((r: any) => !r.entered);
        if (failed.length > 0) {
          alert(`Could not enter:\n\n${failed.map((f: any) => `${f.user_name ?? 'You'}: ${f.error}`).join('\n')}`);
        }
      }

      setEnterDialogGame(null);
      sessionStorage.removeItem('friendlies_games_cache');
      await fetchGames({ fresh: true }); // bypass server cache so the entered count is current
    } catch (error) {
      alert('An error occurred while entering the game.');
    } finally {
      setEntering(false);
    }
  }

  /** Confirm removal from a single open game (plus any ticked entered buddies). */
  async function handleRemoveConfirm() {
    const game = removeDialogGame;
    if (!game) return;

    setEntering(true);
    try {
      const onBehalfOf = Array.from(removeBuddySelected);
      const response = await fetch('/api/friendlies/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_name: game.tabName,
          ...(onBehalfOf.length > 0 ? { on_behalf_of: onBehalfOf } : {}),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        alert(data.error || 'Failed to remove you from the game.');
      }
      setRemoveDialogGame(null);
      sessionStorage.removeItem('friendlies_games_cache');
      await fetchGames({ fresh: true }); // bypass server cache so the entered count is current
    } catch (error) {
      alert('An error occurred while removing you from the game.');
    } finally {
      setEntering(false);
    }
  }

  // ============================================================================
  // Stats Functions
  // ============================================================================

  /** Fetch stats for the given userName (or own if omitted) */
  async function fetchStats(userName?: string) {
    setStatsLoading(true);
    try {
      const qs = userName ? `?userName=${encodeURIComponent(userName)}` : '';
      const res = await fetch(`/api/friendlies/stats${qs}`);
      const data = await res.json();
      if (res.ok) {
        setStatsData(data as StatsData);
        setStatsPlayer(data.targetUser);
      } else {
        console.error('Stats error:', data.error);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setStatsLoading(false);
    }
  }

  // ============================================================================
  // Filtering and Display Logic
  // ============================================================================

  /**
   * Filter games based on selected filter tab
   * Returns subset of games array that match current filter
   * For "Open for entry" tab, also filters by member type and game gender eligibility
   */
  const filteredGames = games.filter(game => {
    if (primaryTab === 'all') {
      // All Games → filter by game status (mirrors /manage)
      switch (allSub) {
        case 'upcoming':  return game.status === '';
        case 'open':      return game.status === 'O';
        case 'selecting': return ['X', 'S'].includes(game.status);
        case 'played':    return ['P', 'C', 'A'].includes(game.status);
        default:          return false;
      }
    }

    if (primaryTab === 'mine') {
      // My Games → games the user is in. Paired entry only lands on game 1, so also
      // include a game whose paired partner is entered, otherwise the pair can't
      // render together here.
      const partnerEntered = game.paired === 'Y' && games.some(g =>
        g.paired === 'Y' && g.date === game.date && g.tabName !== game.tabName && g.userEntered
      );
      const isMine = !!game.userEntered || partnerEntered;
      if (!isMine) return false;
      return mineSub === 'played'
        ? ['P', 'C', 'A'].includes(game.status)   // Played (incl. cancelled/abandoned)
        : !['P', 'C', 'A'].includes(game.status); // Not played yet
    }

    return false; // stats view renders separately
  }).sort((a, b) => {
    // Sort by date (ascending) - earliest dates first using parseUKDate
    const dateA = parseUKDate(a.date);
    const dateB = parseUKDate(b.date);

    // Ascending order: earlier dates first
    return dateA.getTime() - dateB.getTime();
  });

  /**
   * Get status badge component for a game
   * Returns colored badge with label based on game status
   * @param status Game status code (O, X, S, P, C, A)
   * @returns JSX element with colored badge
   */
  function getStatusBadge(status: string) {
    // Define badge labels and colors for each status
    const badges: { [key: string]: { label: string; color: string } } = {
      '': { label: 'Upcoming', color: 'bg-gray-500' },      // Blank = Not opened yet
      'O': { label: 'Open', color: 'bg-green-500' },        // Open for entries
      'X': { label: 'Selecting', color: 'bg-yellow-500' },  // Captain selecting team
      'S': { label: 'Selected', color: 'bg-blue-500' },     // Team selected/published
      'P': { label: 'Played', color: 'bg-purple-500' },     // Game completed
      'C': { label: 'Cancelled', color: 'bg-red-500' },     // Game cancelled
      'A': { label: 'Abandoned', color: 'bg-orange-500' },  // Game abandoned
    };

    // Get badge config for this status, default to blank if unknown
    const badge = badges[status] || badges[''];

    // Return badge component
    return (
      <span className={`inline-block px-2 py-1 text-xs font-semibold text-white rounded ${badge.color}`}>
        {badge.label}
      </span>
    );
  }

  /**
   * Parse the number of players required from a format string
   * e.g. "4 Triples" → 12, "3 Pairs" → 6, "5 Fours" → 20
   */
  function parseNumberRequired(format: string): number | null {
    if (!format) return null;
    const sizeMap: Record<string, number> = {
      singles: 1, single: 1,
      pairs: 2, pair: 2,
      triples: 3, triple: 3,
      fours: 4, four: 4, rinks: 4, rink: 4,
      fives: 5, five: 5,
    };
    // Support compound formats e.g. "3 Triples, 4 Rinks"
    const parts = format.split(',').map(s => s.trim());
    let total = 0;
    for (const part of parts) {
      const match = part.match(/^(\d+)\s+(\w+)$/i);
      if (!match) return null; // any unrecognised segment → can't calculate
      const count = parseInt(match[1], 10);
      const size = sizeMap[match[2].toLowerCase()];
      if (!size) return null;
      total += count * size;
    }
    return total > 0 ? total : null;
  }

  // ============================================================================
  // Render UI
  // ============================================================================

  useNavbarConfig({ showLogoOnly: isGuest });

  return (
    <div className="min-h-screen bg-gray-50">

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Page header with title and optional Manage button for Captains/Admins */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">Friendly Matches</h1>
            <button
              onClick={handleReload}
              disabled={reloading || loading}
              title="Reload games"
              className="text-gray-500 hover:text-blue-600 disabled:opacity-40 transition-colors"
            >
              <svg
                className={`w-5 h-5 ${reloading ? 'animate-spin' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          {/* Show Manage Games button only for Captains and Admins */}
          {hasRole(session?.user?.role, 'Captain', 'Admin') && (
            <Link
              href="/friendlies/manage"
              className={getButtonClasses('primary', 'md')}
            >
              Manage Games
            </Link>
          )}
        </div>

        {/* Primary tabs: All Games | My Games | My Stats */}
        <div className="flex gap-2 mb-3 border-b border-gray-200">
          <button
            onClick={() => { setPrimaryTab('all'); sessionStorage.setItem('friendlies_primary_tab', 'all'); }}
            className={`px-4 py-2 font-medium border-b-2 ${
              primaryTab === 'all'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            All Games
          </button>

          {/* My Games / My Stats — hidden for guests and kiosk */}
          {!isLimitedView && (
            <>
              <button
                onClick={() => { setPrimaryTab('mine'); sessionStorage.setItem('friendlies_primary_tab', 'mine'); }}
                className={`px-4 py-2 font-medium border-b-2 ${
                  primaryTab === 'mine'
                    ? 'border-blue-500 text-blue-500'
                    : 'border-transparent text-gray-600 hover:text-gray-800'
                }`}
              >
                My Games
              </button>
              <button
                onClick={() => {
                  setPrimaryTab('stats');
                  sessionStorage.setItem('friendlies_primary_tab', 'stats');
                  if (!statsData) fetchStats();
                }}
                className={`px-4 py-2 font-medium border-b-2 ${
                  primaryTab === 'stats'
                    ? 'border-blue-500 text-blue-500'
                    : 'border-transparent text-gray-600 hover:text-gray-800'
                }`}
              >
                My Stats
              </button>
            </>
          )}
        </div>

        {/* Sub-filter row — status filters for All Games, played state for My Games */}
        {primaryTab === 'all' && (
          <div className="flex flex-wrap gap-2 mb-6">
            {([
              { value: 'upcoming',  label: 'Upcoming' },
              { value: 'open',      label: 'Open' },
              { value: 'selecting', label: 'Selecting' },
              { value: 'played',    label: 'Played' },
            ] as const).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => { setAllSub(value); sessionStorage.setItem('friendlies_all_sub', value); }}
                className={`px-3 py-1.5 text-sm rounded-full font-medium ${
                  allSub === value
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {primaryTab === 'mine' && (
          <div className="flex flex-wrap gap-2 mb-6">
            {([
              { value: 'notplayed', label: 'Not played' },
              { value: 'played',    label: 'Played' },
            ] as const).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => { setMineSub(value); sessionStorage.setItem('friendlies_mine_sub', value); }}
                className={`px-3 py-1.5 text-sm rounded-full font-medium ${
                  mineSub === value
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* ── My Stats view ─────────────────────────────────────────────────── */}
        {primaryTab === 'stats' ? (
          <div>
            {/* Captain / Admin: player selector */}
            {hasRole(session?.user?.role, 'Captain', 'Admin') && (
              <div className="mb-4 flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700">Player:</label>
                <select
                  value={statsPlayer}
                  onChange={e => {
                    setStatsPlayer(e.target.value);
                    fetchStats(e.target.value);
                  }}
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {/* Show own name first, then others */}
                  {statsData?.playerList
                    ? statsData.playerList.map(p => (
                        <option key={p.userName} value={p.userName}>{p.fullName}</option>
                      ))
                    : statsPlayer && (
                        <option value={statsPlayer}>{statsPlayer}</option>
                      )}
                </select>
              </div>
            )}

            {/* Loading spinner */}
            {statsLoading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="mt-2 text-gray-700">Loading stats...</p>
              </div>
            ) : !statsData ? (
              <div className="text-center py-12 text-gray-500">No stats available.</div>
            ) : (
              <>
                {/* Summary / Detail sub-tabs */}
                <div className="flex gap-1 mb-6">
                  {(['summary', 'detail'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setStatsSubView(v)}
                      className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                        statsSubView === v
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {v === 'summary' ? 'Summary' : 'Detail'}
                    </button>
                  ))}
                </div>

                {/* ── Summary ───────────────────────────────────────────────── */}
                {statsSubView === 'summary' && (() => {
                  const s = statsData.summary;
                  // Withdrawals are excluded from the total (shown separately at the end)
                  const total = s.selected + s.reserve + s.reserveTeam + s.opposition + s.cancelled + s.abandoned + s.entered;
                  const rows: { label: string; count: number; color: string }[] = [
                    { label: 'Selected',     count: s.selected,     color: 'bg-green-100 text-green-800 border-green-200' },
                    { label: 'Reserve',      count: s.reserve,      color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
                    { label: 'Reserve Team', count: s.reserveTeam,  color: 'bg-orange-100 text-orange-800 border-orange-200' },
                    { label: 'Opposition',   count: s.opposition,   color: 'bg-blue-100 text-blue-800 border-blue-200' },
                    { label: 'Cancelled',    count: s.cancelled,    color: 'bg-red-100 text-red-700 border-red-200' },
                    { label: 'Abandoned',    count: s.abandoned,    color: 'bg-orange-100 text-orange-700 border-orange-200' },
                    { label: 'Entered',      count: s.entered,      color: 'bg-gray-50 text-gray-600 border-gray-200' },
                  ].filter(r => r.count > 0);

                  return (
                    <div>
                      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                        {rows.map(r => (
                          <div key={r.label} className={`border rounded-lg p-4 ${r.color}`}>
                            <div className="text-2xl font-bold">{r.count}</div>
                            <div className="text-sm font-medium mt-1">{r.label}</div>
                          </div>
                        ))}
                        <div className="border rounded-lg p-4 bg-gray-800 text-white border-gray-800">
                          <div className="text-2xl font-bold">{total}</div>
                          <div className="text-sm font-medium mt-1">Total</div>
                        </div>
                        {/* Withdrawn shown last, separate from (and excluded from) the total */}
                        {s.withdrawn > 0 && (
                          <div className="border rounded-lg p-4 bg-gray-100 text-gray-700 border-gray-200">
                            <div className="text-2xl font-bold">{s.withdrawn}</div>
                            <div className="text-sm font-medium mt-1">Withdrawn</div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* ── Detail ────────────────────────────────────────────────── */}
                {statsSubView === 'detail' && (() => {
                  const STATUS_COLOR: Record<string, string> = {
                    'Selected':     'bg-green-100 text-green-800',
                    'Reserve':      'bg-yellow-100 text-yellow-800',
                    'Reserve Team': 'bg-orange-100 text-orange-800',
                    'Opposition':   'bg-blue-100 text-blue-800',
                    'Withdrawn':    'bg-gray-200 text-gray-600',
                    'Cancelled':    'bg-red-100 text-red-700',
                    'Abandoned':    'bg-orange-100 text-orange-700',
                    'Entered':      'bg-gray-100 text-gray-600',
                  };

                  if (statsData.detail.length === 0) {
                    return <p className="text-center py-8 text-gray-500">No game entries found.</p>;
                  }

                  return (
                    <div className="bg-white rounded-lg shadow overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">Date</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">Opponent</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">Format</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">Status</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                          {statsData.detail.map((entry, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-gray-900 whitespace-nowrap">{entry.date}</td>
                              <td className="px-4 py-3 text-gray-900">
                                {entry.clubName}
                                {entry.homeAway === 'A' && <span className="ml-1 text-xs text-gray-500">(Away)</span>}
                              </td>
                              <td className="px-4 py-3 text-gray-700">{entry.format}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[entry.displayStatus] || 'bg-gray-100 text-gray-600'}`}>
                                  {entry.displayStatus}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        ) : loading ? (
          // Loading state - show spinner while fetching games
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-700">Loading games...</p>
          </div>
        ) : filteredGames.length === 0 ? (
          // Empty state - no games match current filter
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <p className="text-gray-700">No games found for this filter.</p>
          </div>
        ) : (
          // Game cards grid - group paired games then render
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {groupPairedGames(filteredGames as GameWithUserStatus[]).map((item, index) => {
              // Paired game card — combined view for two games on the same date
              if (isPairedGame(item)) {
                const [gameA, gameB] = item as [GameWithUserStatus, GameWithUserStatus];
                const userEnteredEither = gameA.userEntered || gameB.userEntered;
                const combinedEntered = Math.max(gameA.entered, gameB.entered);
                const pairedIsOnTeaDuty = teaDutyDates.has(gameA.date);

                return (
                  <div
                    key={`paired-${index}-${gameA.tabName}-${gameB.tabName}`}
                    className={`bg-white rounded-lg shadow border ${
                      userEnteredEither ? 'border-blue-200' : 'border-gray-200'
                    } p-4`}
                  >
                    {/* Paired badge */}
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-bold text-lg text-gray-900">
                          <Link
                            href={`/clubs/${encodeURIComponent(gameA.clubName)}?from=friendlies`}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {gameA.clubName}
                          </Link>
                          {gameA.clubName !== gameB.clubName && (
                            <>
                              {' + '}
                              <Link
                                href={`/clubs/${encodeURIComponent(gameB.clubName)}?from=friendlies`}
                                className="text-blue-600 hover:text-blue-800 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {gameB.clubName}
                              </Link>
                            </>
                          )}
                        </h3>
                        <p className="text-xs text-gray-700 mt-0.5">
                          {gameA.ladiesMen} + {gameB.ladiesMen}
                        </p>
                        <p className="text-sm text-gray-700">
                          {parseUKDate(gameA.date).toLocaleDateString('en-GB', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                          {' at '}
                          {gameA.time}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {getStatusBadge(gameA.status)}
                        <span className="inline-block px-2 py-0.5 text-xs font-medium text-purple-700 bg-purple-100 rounded">
                          Paired
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1 text-sm text-gray-900 mb-4">
                      <p>
                        <span className="font-medium">Venue:</span>{' '}
                        {gameA.homeAway === gameB.homeAway
                          ? (gameA.homeAway === 'H' ? 'Home' : 'Away')
                          : `${gameA.clubName}: ${gameA.homeAway === 'H' ? 'Home' : 'Away'} / ${gameB.clubName}: ${gameB.homeAway === 'H' ? 'Home' : 'Away'}`
                        }
                      </p>
                      <p>
                        <span className="font-medium">Format:</span> {gameA.format} ({gameA.ladiesMen}) / {gameB.format} ({gameB.ladiesMen})
                      </p>

                      {/* For open paired games, show combined player count */}
                      {gameA.status === 'O' && (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <p className="font-medium text-gray-900">
                            {combinedEntered} Player{combinedEntered !== 1 ? 's' : ''} Entered{(() => {
                              const reqA = parseNumberRequired(gameA.format);
                              const reqB = parseNumberRequired(gameB.format);
                              const combinedReq = reqA != null && reqB != null ? reqA + reqB : null;
                              return combinedReq != null ? ` / ${combinedReq} Required` : '';
                            })()}
                          </p>
                          {!isGuest && (
                            <button
                              onClick={() => {
                                setSelectedGameForModal(gameA);
                                setModalGameName(
                                  gameA.clubName !== gameB.clubName
                                    ? `${gameA.clubName} + ${gameB.clubName} - ${gameA.date}`
                                    : `${gameA.clubName} - ${gameA.date}`
                                );
                                setIsModalOpen(true);
                              }}
                              className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white rounded bg-green-500 hover:opacity-90 transition-opacity"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              View / Add
                            </button>
                          )}
                        </div>
                      )}

                      {/* Special instructions link */}
                      {gameA.specialInstructions && (
                        <div className="mt-3 pt-2 border-t border-gray-100">
                          <button
                            onClick={() => setInstructionsMessage(gameA.specialInstructions)}
                            className="text-sm text-amber-700 font-medium hover:text-amber-900 hover:underline"
                          >
                            See Special Instructions
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Tea duty note for paired games */}
                    {!isLimitedView && gameA.status === 'O' && memberType && pairedIsOnTeaDuty && (
                      canEnterGame(memberType, gameA.ladiesMen as GameGender) ||
                      canEnterGame(memberType, gameB.ladiesMen as GameGender)
                    ) && (
                      <p className="text-sm text-gray-700 italic">
                        You are on tea duty for this game — not eligible to play
                      </p>
                    )}

                    {/* Single button enters game 1 of the pair (captain moves overflow into
                        game 2 during selection). Opens the same confirm dialog as single games. */}
                    {!isLimitedView && gameA.status === 'O' && memberType && !pairedIsOnTeaDuty && (
                      canEnterGame(memberType, gameA.ladiesMen as GameGender) ||
                      canEnterGame(memberType, gameB.ladiesMen as GameGender)
                    ) && (
                      gameA.userEntered ? (
                        <button
                          type="button"
                          onClick={() => openRemoveDialog(gameA)}
                          className="text-sm font-medium text-green-700 hover:text-red-600"
                        >
                          Entered <span className="text-gray-400">— tap to remove</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openEnterDialog(gameA)}
                          className={`${getButtonClasses('primary', 'sm')}`}
                        >
                          Enter this game
                        </button>
                      )
                    )}
                  </div>
                );
              }

              // Standard single game card
              const game = item as GameWithUserStatus;
              const isOnTeaDuty = teaDutyDates.has(game.date);
              const cardPickupInfo = game.homeAway === 'A' ? (game.pickupInfo || '') : '';
              return (
                <div
                  key={game.tabName && game.tabName.trim() ? game.tabName : `${game.date}-${game.clubName}-${game.time}-${index}`}
                  className={`bg-white rounded-lg shadow border ${
                    game.userEntered ? 'border-blue-200' : 'border-gray-200'
                  } p-4`}
                >
                  {/* Game card header - club name, date, and status badge */}
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      {/* Opponent club name - links to club details */}
                      <h3 className="font-bold text-lg text-gray-900">
                        <Link
                          href={`/clubs/${encodeURIComponent(game.clubName)}?from=friendlies`}
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {game.clubName}
                        </Link>
                      </h3>

                      {/* Game date and time formatted for display */}
                      <p className="text-sm text-gray-700">
                        {parseUKDate(game.date).toLocaleDateString('en-GB', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                        })}
                        {' at '}
                        {game.time}
                      </p>
                    </div>

                    {/* Status badge (Open, Selecting, Selected, etc.) */}
                    {getStatusBadge(game.status)}
                  </div>

                  {/* Game details - venue, format, type, player count, score */}
                  <div className="space-y-1 text-sm text-gray-900 mb-4">
                    {/* Home or Away venue */}
                    <p>
                      <span className="font-medium">Venue:</span> {game.homeAway === 'H' ? 'Home' : 'Away'}
                      {game.homeAway === 'A' && game.petrolCost ? ` — Petrol: £${game.petrolCost.toFixed(2)}` : ''}
                    </p>
                    {game.homeAway === 'A' && cardPickupInfo && (
                      <p className="text-gray-600 italic text-sm">{cardPickupInfo}</p>
                    )}

                    {/* Game format (e.g., "Triples", "Pairs") */}
                    <p>
                      <span className="font-medium">Format:</span> {game.format}
                    </p>

                    {/* Ladies/Men/Mixed */}
                    <p>
                      <span className="font-medium">Type:</span> {game.ladiesMen}
                    </p>

                    {/* For open games, show player count and capacity with View/Add button */}
                    {game.status === 'O' && (() => {
                      const hasCapacity = game.maxPlayers != null && game.maxPlayers > 0;
                      const capacity = calculateCapacity(game);
                      const badgeColor = hasCapacity ? getCapacityBadgeColor(capacity) : 'bg-green-500';
                      const numberRequired = parseNumberRequired(game.format);

                      return (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <p className="font-medium text-gray-900">
                            {game.entered} Player{game.entered !== 1 ? 's' : ''} Entered{numberRequired != null ? `, ${numberRequired} Required` : ''}
                          </p>
                          {hasCapacity && (
                            <p className="text-gray-700">
                              Capacity: {game.maxPlayers}
                            </p>
                          )}
                          {!isGuest && (
                            <button
                              onClick={() => {
                                setSelectedGameForModal(game);
                                setModalGameName(`${game.clubName} - ${game.date}`);
                                setIsModalOpen(true);
                              }}
                              className={`mt-2 inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white rounded ${badgeColor} hover:opacity-90 transition-opacity`}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              View / Add
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {/* For played/abandoned games, show final score */}
                    {(game.status === 'P' || game.status === 'A') && game.bhbcScore !== undefined && game.opponentScore !== undefined && (
                      <p className="text-lg font-bold">
                        BH: <span className="text-blue-600">{game.bhbcScore}</span> - {game.clubName}: <span className="text-gray-700">{game.opponentScore}</span>
                      </p>
                    )}

                    {/* Special instructions link */}
                    {game.specialInstructions && (
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <button
                          onClick={() => setInstructionsMessage(game.specialInstructions)}
                          className="text-sm text-amber-700 font-medium hover:text-amber-900 hover:underline"
                        >
                          See Special Instructions
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Gender ineligibility note */}
                  {!isLimitedView && game.status === 'O' && memberType && !canEnterGame(memberType, game.ladiesMen as GameGender) && (
                    game.ladiesMen === 'Ladies' || game.ladiesMen === 'Men'
                  ) && (
                    <p className="text-sm text-gray-700 italic">
                      {game.ladiesMen === 'Ladies' ? 'Ladies only' : 'Men only'} — you are not eligible to enter
                    </p>
                  )}

                  {/* Tea duty note */}
                  {!isLimitedView && game.status === 'O' && memberType && canEnterGame(memberType, game.ladiesMen as GameGender) && isOnTeaDuty && (
                    <p className="text-sm text-gray-600 italic">
                      You are on tea duty for this game — not eligible to play
                    </p>
                  )}

                  {/* For open games, show a single-action button that opens a confirm dialog.
                      Entering one game per action keeps writes low and removes the old
                      multi-select + floating "Update" button that confused people. */}
                  {!isLimitedView && game.status === 'O' && memberType && canEnterGame(memberType, game.ladiesMen as GameGender) && !isOnTeaDuty && (() => {
                    // Check if game is full and user hasn't already entered
                    const capacity = calculateCapacity(game);
                    const isFull = capacity.isFull && !game.userEntered;

                    if (game.userEntered) {
                      // Already entered — clicking opens the remove confirm dialog
                      return (
                        <button
                          type="button"
                          onClick={() => openRemoveDialog(game)}
                          className="text-sm font-medium text-green-700 hover:text-red-600"
                        >
                          Entered <span className="text-gray-400">— tap to remove</span>
                        </button>
                      );
                    }

                    if (isFull) {
                      return <span className="text-sm font-medium text-gray-700">Game is full</span>;
                    }

                    return (
                      <button
                        type="button"
                        onClick={() => openEnterDialog(game)}
                        className={`${getButtonClasses('primary', 'sm')}`}
                      >
                        Enter this game
                      </button>
                    );
                  })()}

                  {/* For Selected, Played, Cancelled, or Abandoned games, show View Details button */}
                  {['S', 'P', 'C', 'A'].includes(game.status) && (
                    <Link
                      href={`/friendlies/game/${game.tabName}`}
                      className={`block w-full text-center ${getButtonClasses('primary', 'md')}`}
                      onClick={() => sessionStorage.setItem('friendlies_back_nav', 'true')}
                    >
                      View Details
                    </Link>
                  )}

                  {/* Cancellation / abandonment reason and who */}
                  {['C', 'A'].includes(game.status) && (game.who || game.reason) && (
                    <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                      {game.who && <div>By: {game.who}</div>}
                      {game.reason && <div>Reason: {game.reason}</div>}
                    </div>
                  )}

                  {/* Selection status badge — shown when team has been published */}
                  {['S', 'P'].includes(game.status) && (() => {
                    if (!game.userEntered) return <p className="text-sm text-gray-700">Not entered</p>;
                    if (!game.userStatus) return null;
                    // Check for withdrawal before anything else
                    if (game.userStatus.endsWith('W')) return <p className="text-sm font-semibold text-red-600">✗ Withdrawn</p>;
                    const isSelected = ['P', 'R', 'T'].includes(game.userStatus);
                    const confirmedSuffix = game.status === 'S' && isSelected
                      ? game.userConfirmed
                        ? <span className="font-semibold text-green-600"> — ✓ Confirmed</span>
                        : <span className="font-semibold text-red-600"> — ✗ Not Confirmed</span>
                      : null;
                    return (
                      <div>
                        {game.userStatus === 'P' && <p className="text-sm font-semibold text-green-700">You are Selected to play{confirmedSuffix}</p>}
                        {game.userStatus === 'R' && <p className="text-sm font-semibold text-amber-700">You are a Reserve{confirmedSuffix}</p>}
                        {game.userStatus === 'T' && <p className="text-sm font-semibold text-purple-700">Playing — Reserve Rink{confirmedSuffix}</p>}
                        {game.userStatus === 'D' && <p className="text-sm text-gray-700">Not selected for this game</p>}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}

        {/* Enter-game confirm dialog — enters exactly one game, with opt-in buddy + own-transport */}
        {enterDialogGame && (() => {
          const g = enterDialogGame;
          const eligibleBuddies = eligibleBuddiesForGame(g);
          const isAway = g.homeAway === 'A';
          return (
            <ConfirmDialog
              isOpen={true}
              title="Enter this game"
              message={`Enter ${g.clubName} on ${g.date}?`}
              confirmLabel={entering ? 'Entering…' : 'Enter'}
              cancelLabel="Cancel"
              confirmVariant="primary"
              confirmDisabled={entering}
              onConfirm={handleEnterConfirm}
              onCancel={() => { if (!entering) setEnterDialogGame(null); }}
            >
              <div className="mb-6 space-y-2 text-left">
                {/* Buddy opt-in — only eligible buddies for this game */}
                {eligibleBuddies.map((b) => (
                  <label key={b.userName} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enterBuddySelected.has(b.userName)}
                      onChange={(e) => {
                        const next = new Set(enterBuddySelected);
                        if (e.target.checked) next.add(b.userName); else next.delete(b.userName);
                        setEnterBuddySelected(next);
                      }}
                      className="w-4 h-4 text-blue-500 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Enter {b.name} too?</span>
                  </label>
                ))}

                {/* Own transport — away games only */}
                {isAway && (
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enterOwnTransport}
                      onChange={(e) => setEnterOwnTransport(e.target.checked)}
                      className="w-4 h-4 text-gray-500 rounded focus:ring-gray-500"
                    />
                    <span className="text-sm text-gray-600">
                      Making my own way <span className="text-gray-500">— not car sharing</span>
                    </span>
                  </label>
                )}
              </div>
            </ConfirmDialog>
          );
        })()}

        {/* Remove confirm dialog — removes the user from one open game, with opt-in buddy removal */}
        {removeDialogGame && (() => {
          const g = removeDialogGame;
          const enteredBuddies = enteredBuddiesForGame(g);
          return (
            <ConfirmDialog
              isOpen={true}
              title="Remove from this game"
              message={`Remove yourself from ${g.clubName} on ${g.date}?`}
              confirmLabel={entering ? 'Removing…' : 'Remove'}
              cancelLabel="Cancel"
              confirmVariant="danger"
              confirmDisabled={entering}
              onConfirm={handleRemoveConfirm}
              onCancel={() => { if (!entering) setRemoveDialogGame(null); }}
            >
              {enteredBuddies.length > 0 && (
                <div className="mb-6 space-y-2 text-left">
                  {enteredBuddies.map((b) => (
                    <label key={b.userName} className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={removeBuddySelected.has(b.userName)}
                        onChange={(e) => {
                          const next = new Set(removeBuddySelected);
                          if (e.target.checked) next.add(b.userName); else next.delete(b.userName);
                          setRemoveBuddySelected(next);
                        }}
                        className="w-4 h-4 text-red-500 rounded focus:ring-red-500"
                      />
                      <span className="text-sm text-gray-700">Remove {b.name} too?</span>
                    </label>
                  ))}
                </div>
              )}
            </ConfirmDialog>
          );
        })()}

        {/* Special instructions popup */}
        {instructionsMessage !== null && (
          <>
            <div
              className="fixed inset-0 bg-black bg-opacity-50 z-40"
              onClick={() => setInstructionsMessage(null)}
            />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-3">Special Instructions</h2>
                <p className="text-gray-700 whitespace-pre-wrap">{instructionsMessage}</p>
                <div className="flex justify-end mt-5">
                  <button
                    onClick={() => setInstructionsMessage(null)}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Modal for viewing and managing entered players */}
        {selectedGameForModal && (
          <EnteredPlayersModal
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false);
              setSelectedGameForModal(null);
              setModalGameName('');
            }}
            gameId={selectedGameForModal.tabName}
            gameType="friendlies"
            gameName={modalGameName}
            gameStatus={selectedGameForModal.status}
            ladiesMen={selectedGameForModal.ladiesMen}
            currentUserRole={session?.user?.role}
            maxPlayers={selectedGameForModal.maxPlayers}
            onPlayersChanged={() => {
              // Refresh games list when players are added/removed
              fetchGames();
            }}
          />
        )}
      </div>
    </div>
  );
}
