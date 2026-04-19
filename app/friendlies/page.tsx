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
import { GameWithUserStatus } from '@/lib/types/friendlies';
import { Navbar } from '@/components/Navbar';
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
type FilterType = 'all' | 'O' | 'entered' | 'played';

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

  // State: Current filter selection (restored from sessionStorage in layout effect below)
  const [filter, setFilter] = useState<FilterType>('O');

  // State: Set of game tab names that user has checked/selected
  // Uses Set for efficient add/remove operations
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());

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
  const [pairedGameIdsForModal, setPairedGameIdsForModal] = useState<string[]>([]);
  const [modalGameName, setModalGameName] = useState('');

  // State: Dates (YYYY-MM-DD) where the current user has tea duty
  const [teaDutyDates, setTeaDutyDates] = useState<Set<string>>(new Set());

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
   * Effect: Fetch tea rota to determine if user has tea duty on any game days
   */
  useEffect(() => {
    if (isLimitedView) return;
    async function fetchTeaDuty() {
      try {
        const response = await fetch('/api/tea-rota');
        if (response.ok) {
          const data = await response.json();
          const userName: string = data.currentUser;
          const dates = new Set<string>(
            (data.entries as any[])
              .filter(e => e.teaLead === userName || e.teaFirst === userName || e.teaSecond === userName)
              .map(e => e.date as string) // DD/MM/YYYY — same format as game.date
          );
          setTeaDutyDates(dates);
        }
      } catch (error) {
        console.error('Failed to fetch tea rota:', error);
      }
    }
    fetchTeaDuty();
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

    // Restore saved filter tab
    const savedFilter = sessionStorage.getItem('friendlies_filter') as FilterType | null;
    if (savedFilter === 'all' || savedFilter === 'O' || savedFilter === 'entered' || savedFilter === 'played') {
      setFilter(savedFilter);
    }

    // Restore game list from cache only on back-navigation
    const CACHE_KEY = 'friendlies_games_cache';
    const BACK_FLAG = 'friendlies_back_nav';

    const isBackNav = sessionStorage.getItem(BACK_FLAG) === 'true';
    sessionStorage.removeItem(BACK_FLAG); // consume immediately — only fires once

    if (isBackNav) {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        try {
          setGames(JSON.parse(cached));
          setLoading(false);
          return;
        } catch {
          // Bad cache — fall through to fresh fetch
        }
      }
    }

    // Fresh navigation (or cache miss) — clear stale cache and fetch from server
    sessionStorage.removeItem(CACHE_KEY);
    fetchGames();
  }, []);

  /**
   * Effect: Initialize selected games checkboxes when games load
   * Pre-checks games that user has already entered
   * Runs whenever games list changes
   */
  useEffect(() => {
    // Only initialize if we have games loaded
    if (games.length > 0) {
      // Find all open games that user has already entered
      // Filter for status='O' (Open) and userEntered=true
      const enteredTabNames = new Set(
        games.filter(g => g.status === 'O' && g.userEntered).map(g => g.tabName)
      );

      // Pre-check these games in the UI
      setSelectedGames(enteredTabNames);
    }
  }, [games]);

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Fetch all games from API with user's entry status.
   * Saves result to sessionStorage so the next visit is instant.
   * Pass { silent: true } to skip the loading spinner (background refresh).
   */
  async function fetchGames({ silent = false }: { silent?: boolean } = {}) {
    const CACHE_KEY = 'friendlies_games_cache';
    if (!silent) setLoading(true);

    try {
      const response = await fetch('/api/friendlies/games');
      const data = await response.json();

      if (data.games) {
        setGames(data.games);
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(data.games));
      }
    } catch (error) {
      if (!silent) alert('Failed to load games. Please refresh the page.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  /** Force a fresh fetch, bypassing the cache. */
  async function handleReload() {
    sessionStorage.removeItem('friendlies_games_cache');
    setReloading(true);
    await fetchGames();
    setReloading(false);
  }

  /**
   * Update game entries based on checkbox changes
   * Compares selected games vs currently entered games
   * Enters new games and withdraws from unchecked games
   * Shows errors if any updates fail
   * Refreshes game list after all updates complete
   */
  async function handleUpdateGames() {
    // Show updating indicator on button
    setEntering(true);

    try {
      // Get all open games (only these can be entered/withdrawn)
      const openGames = games.filter(g => g.status === 'O');

      // Build set of games user is currently entered in
      const currentlyEntered = new Set(openGames.filter(g => g.userEntered).map(g => g.tabName));

      // Calculate changes needed:
      // Games to enter: checked but not currently entered
      const toEnter = Array.from(selectedGames).filter(id => !currentlyEntered.has(id));

      // Games to withdraw: currently entered but not checked
      const toRemove = openGames.filter(g => currentlyEntered.has(g.tabName) && !selectedGames.has(g.tabName)).map(g => g.tabName);

      // Array to collect any error messages
      let errors: string[] = [];

      // Enter new games if any
      if (toEnter.length > 0) {
        // Call batch enter API with array of game IDs
        const enterResponse = await fetch('/api/friendlies/enter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ game_ids: toEnter }),
        });

        const enterData = await enterResponse.json();

        // Check if enter was successful
        if (enterData.success) {
          // Check for individual game failures in batch
          const failed = enterData.results?.filter((r: any) => !r.entered) || [];

          // Add error message for each failed game
          if (failed.length > 0) {
            errors.push(...failed.map((f: any) => `Enter ${f.game_id}: ${f.error}`));
          }
        } else {
          // Entire enter request failed
          errors.push(`Enter failed: ${enterData.error}`);
        }
      }

      // Withdraw from unchecked games
      // Loop through each game to remove
      for (const tabName of toRemove) {
        try {
          // Call withdraw API for this game
          const removeResponse = await fetch('/api/friendlies/withdraw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tab_name: tabName }),
          });

          // Check if withdraw was successful
          if (!removeResponse.ok) {
            errors.push(`Remove ${tabName}: Failed`);
          }
        } catch (error) {
          // Network or other error during withdraw
          errors.push(`Remove ${tabName}: Error`);
        }
      }

      // Show error alert if any updates failed
      if (errors.length > 0) {
        alert(`Some updates failed:\n\n${errors.join('\n')}`);
      }

      // Refresh games list to show updated entry statuses
      await fetchGames();
    } catch (error) {
      // Show error alert if entire update process fails
      alert('An error occurred while updating games.');
    } finally {
      // Hide updating indicator whether success or failure
      setEntering(false);
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
    // Check which filter is active
    switch (filter) {
      case 'O':
        // Show all Open games regardless of gender eligibility
        // Ineligible members see the card but cannot enter (no checkbox shown)
        return game.status === 'O';

      case 'entered':
        // Games the user has entered that haven't been played or cancelled yet
        return !!game.userEntered && !['P', 'C', 'A'].includes(game.status);

      case 'played':
        // Games the user entered that have been played, cancelled, or abandoned
        return !!game.userEntered && ['P', 'C', 'A'].includes(game.status);

      default:
        // 'all' filter - show everything (don't filter by eligibility here)
        return true;
    }
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
      'L': { label: 'Allocating', color: 'bg-amber-500' },  // Paired games: entries closed, allocating players
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

  // ============================================================================
  // Render UI
  // ============================================================================

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation bar with user info and role */}
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} showLogoOnly={isGuest} />

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

        {/* Filter tabs - allow user to switch between different views */}
        <div className="flex gap-2 mb-6 border-b border-gray-200">
          {/* All Games tab */}
          <button
            onClick={() => { setFilter('all'); sessionStorage.setItem('friendlies_filter', 'all'); }}
            className={`px-4 py-2 font-medium border-b-2 ${
              filter === 'all'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            All Games
          </button>

          {/* Open for Entry tab - shows games with status='O' */}
          <button
            onClick={() => { setFilter('O'); sessionStorage.setItem('friendlies_filter', 'O'); }}
            className={`px-4 py-2 font-medium border-b-2 ${
              filter === 'O'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Open for Entry
          </button>

          {/* My Entries / My Played — hidden for guests and kiosk */}
          {!isLimitedView && (
            <>
              <button
                onClick={() => { setFilter('entered'); sessionStorage.setItem('friendlies_filter', 'entered'); }}
                className={`px-4 py-2 font-medium border-b-2 ${
                  filter === 'entered'
                    ? 'border-blue-500 text-blue-500'
                    : 'border-transparent text-gray-600 hover:text-gray-800'
                }`}
              >
                My Entries
              </button>
              <button
                onClick={() => { setFilter('played'); sessionStorage.setItem('friendlies_filter', 'played'); }}
                className={`px-4 py-2 font-medium border-b-2 ${
                  filter === 'played'
                    ? 'border-blue-500 text-blue-500'
                    : 'border-transparent text-gray-600 hover:text-gray-800'
                }`}
              >
                My Played
              </button>
            </>
          )}
        </div>

        {/* Games list - show loading, empty state, or game cards */}
        {loading ? (
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
                const bothTabNames = [gameA.tabName, gameB.tabName];
                const userEnteredBoth = gameA.userEntered && gameB.userEntered;
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
                            {combinedEntered} Player{combinedEntered !== 1 ? 's' : ''} Entered
                          </p>
                          {!isLimitedView && (
                            <button
                              onClick={() => {
                                setSelectedGameForModal(gameA);
                                setPairedGameIdsForModal([gameB.tabName]);
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

                      {/* For allocating paired games, show closed message */}
                      {gameA.status === 'L' && (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <p className="font-medium text-gray-900">
                            {combinedEntered} Player{combinedEntered !== 1 ? 's' : ''} Entered
                          </p>
                          <p className="text-sm text-amber-700 mt-1">
                            Entries closed — players being allocated between games
                          </p>
                        </div>
                      )}

                      {/* Special instructions link */}
                      {gameA.message && (
                        <div className="mt-3 pt-2 border-t border-gray-100">
                          <button
                            onClick={() => setInstructionsMessage(gameA.message)}
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

                    {/* Single checkbox enters BOTH games — hidden for guests and kiosk */}
                    {!isLimitedView && gameA.status === 'O' && memberType && !pairedIsOnTeaDuty && (
                      canEnterGame(memberType, gameA.ladiesMen as GameGender) ||
                      canEnterGame(memberType, gameB.ladiesMen as GameGender)
                    ) && (() => {
                      return (
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedGames.has(gameA.tabName) && selectedGames.has(gameB.tabName)}
                            onChange={e => {
                              const newSelected = new Set(selectedGames);
                              if (e.target.checked) {
                                newSelected.add(gameA.tabName);
                                newSelected.add(gameB.tabName);
                              } else {
                                newSelected.delete(gameA.tabName);
                                newSelected.delete(gameB.tabName);
                              }
                              setSelectedGames(newSelected);
                            }}
                            className="w-4 h-4 text-blue-500 rounded focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium text-blue-500">
                            {userEnteredBoth ? 'Entered' : 'Enter both games'}
                          </span>
                        </label>
                      );
                    })()}
                  </div>
                );
              }

              // Standard single game card
              const game = item as GameWithUserStatus;
              const isOnTeaDuty = teaDutyDates.has(game.date);
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
                    </p>

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

                      return (
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <p className="font-medium text-gray-900">
                            {game.entered} Player{game.entered !== 1 ? 's' : ''} Entered
                          </p>
                          {hasCapacity && (
                            <p className="text-gray-700">
                              Capacity: {game.maxPlayers}
                            </p>
                          )}
                          {!isLimitedView && (
                            <button
                              onClick={() => {
                                setSelectedGameForModal(game);
                                setPairedGameIdsForModal([]);
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
                    {game.message && (
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <button
                          onClick={() => setInstructionsMessage(game.message)}
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

                  {/* For open games, show checkbox to enter/withdraw — hidden for guests and kiosk */}
                  {!isLimitedView && game.status === 'O' && memberType && canEnterGame(memberType, game.ladiesMen as GameGender) && !isOnTeaDuty && (() => {
                    // Check if game is full and user hasn't already entered
                    const capacity = calculateCapacity(game);
                    const isFull = capacity.isFull && !game.userEntered;

                    return (
                      <label className={`flex items-center space-x-2 ${isFull ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={selectedGames.has(game.tabName)}
                          disabled={isFull}
                          onChange={e => {
                            // Create new Set to trigger state update
                            const newSelected = new Set(selectedGames);

                            // Add or remove game from selected set
                            if (e.target.checked) {
                              newSelected.add(game.tabName);
                            } else {
                              newSelected.delete(game.tabName);
                            }

                            // Update selected games state
                            setSelectedGames(newSelected);
                          }}
                          className="w-4 h-4 text-blue-500 rounded focus:ring-blue-500 disabled:cursor-not-allowed"
                        />

                        {/* Label shows current entry status or full message */}
                        <span className={`text-sm font-medium ${isFull ? 'text-gray-700' : 'text-blue-500'}`}>
                          {isFull ? 'Game is full' : (game.userEntered ? 'Entered' : 'Enter this game')}
                        </span>
                      </label>
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

                  {/* Selection status badge — shown when team has been published */}
                  {['S', 'P'].includes(game.status) && (() => {
                    if (!game.userEntered) return <p className="text-sm text-gray-700">Not entered</p>;
                    if (!game.userStatus) return null;
                    const s = game.userStatus.replace('W', ''); // strip withdrawal suffix
                    if (s === 'P') return <p className="text-sm font-semibold text-green-700">You are Selected to play</p>;
                    if (s === 'R') return <p className="text-sm font-semibold text-amber-700">You are a Reserve</p>;
                    if (s === 'T') return <p className="text-sm font-semibold text-purple-700">Playing — Reserve Rink</p>;
                    if (s === 'D') return <p className="text-sm text-gray-700">Not selected for this game</p>;
                    return null;
                  })()}
                </div>
              );
            })}
          </div>
        )}

        {/* Floating action button - only show when there are pending changes */}
        {(() => {
          // Get all open games
          const openGames = games.filter(g => g.status === 'O');

          // Get set of games user is currently entered in
          const currentlyEntered = new Set(openGames.filter(g => g.userEntered).map(g => g.tabName));

          // Calculate number of changes
          // Games to enter: checked but not currently entered
          const toEnter = Array.from(selectedGames).filter(id => !currentlyEntered.has(id));

          // Games to withdraw: currently entered but not checked
          const toRemove = openGames.filter(g => currentlyEntered.has(g.tabName) && !selectedGames.has(g.tabName));

          // Total number of changes
          const changeCount = toEnter.length + toRemove.length;

          // Only show button if there are pending changes
          const hasChanges = changeCount > 0;

          return hasChanges && (
            <div className="fixed bottom-8 right-8 z-50">
              <button
                onClick={handleUpdateGames}
                disabled={entering}
                className="bg-green-600 text-white px-6 py-3 rounded-full shadow-lg hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-50"
              >
                {/* Show spinner and "Updating..." text while submitting */}
                {entering ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Updating...</span>
                  </>
                ) : (
                  // Show number of changes and checkmark icon
                  <>
                    <span>Update {changeCount} Game{changeCount !== 1 ? 's' : ''}</span>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </>
                )}
              </button>
            </div>
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
              setPairedGameIdsForModal([]);
              setModalGameName('');
            }}
            gameId={selectedGameForModal.tabName}
            pairedGameIds={pairedGameIdsForModal}
            gameType="friendlies"
            gameName={modalGameName}
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
