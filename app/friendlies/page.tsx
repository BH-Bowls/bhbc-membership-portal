// app/friendlies/page.tsx
// Main Friendlies page - displays list of friendly matches with entry/withdrawal functionality
// Players can view all games, filter by status, and enter/withdraw from open games
// Captains and Admins also see a "Manage Games" button to access team selection

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { GameWithUserStatus } from '@/lib/types/friendlies';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';
import { getButtonClasses } from '@/config/theme-helpers';
import { canEnterGame, type GameGender } from '@/lib/member-type-utils';
import { calculateCapacity, formatCapacity, getCapacityBadgeColor } from '@/lib/game-management/capacity';
import { EnteredPlayersModal } from '@/components/game-management/EnteredPlayersModal';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Filter options for displaying games
 * 'all' - Show all games regardless of status
 * 'O' - Show only Open games (available for entry)
 * 'entered' - Show only games the user has entered
 * 'selected' - Show only games where user is picked (P, R, T status)
 */
type FilterType = 'all' | 'O' | 'entered' | 'selected';

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
  const { data: session } = useSession();

  // State: List of all games with user's entry status for each
  const [games, setGames] = useState<GameWithUserStatus[]>([]);

  // State: Current filter selection (defaults to 'O' - Open games)
  const [filter, setFilter] = useState<FilterType>('O');

  // State: Set of game tab names that user has checked/selected
  // Uses Set for efficient add/remove operations
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());

  // State: Loading indicator while fetching games from API
  const [loading, setLoading] = useState(true);

  // State: Entering/updating indicator while submitting changes
  const [entering, setEntering] = useState(false);

  // State: User's member type for filtering eligible games
  const [memberType, setMemberType] = useState<string>('');

  // State: Modal for viewing and managing entered players
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedGameForModal, setSelectedGameForModal] = useState<GameWithUserStatus | null>(null);

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
   * Effect: Fetch games when page first loads
   * Runs once on component mount (empty dependency array)
   */
  useEffect(() => {
    // Fetch all games from API
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
   * Fetch all games from API with user's entry status
   * Called on page load and after updating entries
   * Updates games state with response data
   */
  async function fetchGames() {
    // Show loading spinner
    setLoading(true);

    try {
      // Call API to get all games with user's status for each
      const response = await fetch('/api/friendlies/games');
      const data = await response.json();

      // Update games state if API returned data
      if (data.games) {
        setGames(data.games);
      }
    } catch (error) {
      // Show error alert if API call fails
      alert('Failed to load games. Please refresh the page.');
    } finally {
      // Hide loading spinner whether success or failure
      setLoading(false);
    }
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
        // Show only Open games that user is eligible to enter
        // Check game status is Open
        if (game.status !== 'O') return false;

        // Check if user can enter based on member type and game gender
        // If member type not loaded yet, show all games temporarily
        if (!memberType) return true;

        // Use canEnterGame helper to check eligibility
        return canEnterGame(memberType, game.ladiesMen as GameGender);

      case 'entered':
        // Show only games user has entered
        return game.userEntered;

      case 'selected':
        // Show games where user is picked for team
        // P = Picked, R = Reserve, T = Reserve Team
        // PW/RW/TW = Picked/Reserve/Reserve Team but Withdrawn
        return game.userStatus && ['P', 'R', 'T', 'PW', 'RW', 'TW'].includes(game.userStatus);

      default:
        // 'all' filter - show everything (don't filter by eligibility here)
        return true;
    }
  }).sort((a, b) => {
    // Sort by date (ascending) - earliest dates first
    const parseDate = (dateStr: string) => {
      if (!dateStr) return new Date(0);

      // Try format: "Day, DD Month" (e.g., "Sun, 26 April")
      const dayMonthMatch = dateStr.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(\d{1,2})\s+(\w+)/i);
      if (dayMonthMatch) {
        const day = parseInt(dayMonthMatch[1], 10);
        const monthName = dayMonthMatch[2];
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const monthIndex = monthNames.findIndex(m => m.startsWith(monthName.toLowerCase()));

        if (monthIndex === -1) return new Date(0);

        // Determine year based on current month
        const now = new Date();
        const currentMonth = now.getMonth();
        let year = now.getFullYear();

        // If the month has passed, assume next year
        if (monthIndex < currentMonth - 1) {
          year++;
        }

        return new Date(year, monthIndex, day);
      }

      // Try format: "DD/MM/YYYY" or "DD/MM/YY"
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        if (isNaN(day) || isNaN(month) || isNaN(year)) return new Date(0);
        return new Date(year, month - 1, day);
      }

      return new Date(0);
    };

    const dateA = parseDate(a.date);
    const dateB = parseDate(b.date);

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

  // ============================================================================
  // Render UI
  // ============================================================================

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation bar with user info and role */}
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Page header with title and optional Manage button for Captains/Admins */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Friendly Matches</h1>

          {/* Show Manage Games button only for Captains and Admins */}
          {session?.user.role && ['Captain', 'Admin'].includes(session.user.role) && (
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
            onClick={() => setFilter('all')}
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
            onClick={() => setFilter('O')}
            className={`px-4 py-2 font-medium border-b-2 ${
              filter === 'O'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Open for Entry
          </button>

          {/* My Entries tab - shows games user has entered */}
          <button
            onClick={() => setFilter('entered')}
            className={`px-4 py-2 font-medium border-b-2 ${
              filter === 'entered'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            My Entries
          </button>

          {/* I'm Selected tab - shows games where user is picked for team */}
          <button
            onClick={() => setFilter('selected')}
            className={`px-4 py-2 font-medium border-b-2 ${
              filter === 'selected'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            I'm Selected
          </button>
        </div>

        {/* Games list - show loading, empty state, or game cards */}
        {loading ? (
          // Loading state - show spinner while fetching games
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading games...</p>
          </div>
        ) : filteredGames.length === 0 ? (
          // Empty state - no games match current filter
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <p className="text-gray-600">No games found for this filter.</p>
          </div>
        ) : (
          // Game cards grid - show all filtered games
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredGames.map((game, index) => (
              <div
                key={game.tabName && game.tabName.trim() ? game.tabName : `${game.date}-${game.clubName}-${game.time}-${index}`}
                className={`bg-white rounded-lg shadow border ${
                  game.userEntered ? 'border-blue-200' : 'border-gray-200'
                } p-4`}
              >
                {/* Game card header - club name, date, and status badge */}
                <div className="flex justify-between items-start mb-3">
                  <div>
                    {/* Opponent club name */}
                    <h3 className="font-bold text-lg">{game.clubName}</h3>

                    {/* Game date and time formatted for display */}
                    <p className="text-sm text-gray-600">
                      {new Date(game.date).toLocaleDateString('en-GB', {
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
                <div className="space-y-1 text-sm mb-4">
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

                  {/* For open games, show capacity information */}
                  {game.status === 'O' && game.maxPlayers != null && game.maxPlayers > 0 && (() => {
                    const capacity = calculateCapacity(game);
                    const badgeColor = getCapacityBadgeColor(capacity);
                    return (
                      <p>
                        <span className="font-medium">Capacity:</span>{' '}
                        <button
                          onClick={() => {
                            setSelectedGameForModal(game);
                            setIsModalOpen(true);
                          }}
                          className={`inline-block px-2 py-0.5 text-xs font-semibold text-white rounded ${badgeColor} hover:opacity-80 cursor-pointer`}
                        >
                          {formatCapacity(capacity)}
                        </button>
                      </p>
                    );
                  })()}

                  {/* For open games without capacity limit, show simple player count */}
                  {game.status === 'O' && (!game.maxPlayers || game.maxPlayers === 0) && (
                    <button
                      onClick={() => {
                        setSelectedGameForModal(game);
                        setIsModalOpen(true);
                      }}
                      className="text-green-600 hover:text-green-700 hover:underline cursor-pointer"
                    >
                      <span className="font-medium">{game.entered}</span> players entered
                    </button>
                  )}

                  {/* For played games, show final score */}
                  {game.status === 'P' && game.bhbcScore !== undefined && game.opponentScore !== undefined && (
                    <p className="text-lg font-bold">
                      Score: <span className="text-blue-500">{game.bhbcScore}</span> - <span className="text-gray-600">{game.opponentScore}</span>
                    </p>
                  )}
                </div>

                {/* For open games, show checkbox to enter/withdraw (only if eligible) */}
                {game.status === 'O' && memberType && canEnterGame(memberType, game.ladiesMen as GameGender) && (() => {
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
                      <span className={`text-sm font-medium ${isFull ? 'text-gray-400' : 'text-blue-500'}`}>
                        {isFull ? 'Game is full' : (game.userEntered ? 'Entered' : 'Enter this game')}
                      </span>
                    </label>
                  );
                })()}

                {/* For Selected or Played games, show View Details button */}
                {['S', 'P'].includes(game.status) && game.userEntered && (
                  <Link
                    href={`/friendlies/game/${game.tabName}`}
                    className={`block w-full text-center ${getButtonClasses('primary', 'md')}`}
                  >
                    View Details
                  </Link>
                )}
              </div>
            ))}
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

        {/* Modal for viewing and managing entered players */}
        {selectedGameForModal && (
          <EnteredPlayersModal
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false);
              setSelectedGameForModal(null);
            }}
            gameId={selectedGameForModal.tabName}
            gameType="friendlies"
            gameName={`${selectedGameForModal.clubName} - ${selectedGameForModal.date}`}
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
