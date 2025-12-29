// app/friendlies/manage/page.tsx
// Captain Management Home - list of all games with status management
// Captains can open/close games, publish selections, mark as played, and cancel games
// Shows table view with game details, player counts, and available actions based on status

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { Game, GameStatus } from '@/lib/types/friendlies';

// ============================================================================
// Main Component
// ============================================================================

/**
 * Manage Games Page Component
 * Captain-only page for managing friendly match lifecycle
 * Features:
 * - View all games in table format
 * - Filter by game status
 * - Change game status (Open, Close, Publish, Played, Cancel)
 * - View player entry and selection counts
 * - Navigate to team selection page
 */
export default function ManageGamesPage() {
  // Get current user session
  const { data: session } = useSession();

  // Router for navigation
  const router = useRouter();

  // State: List of all games
  const [games, setGames] = useState<Game[]>([]);

  // State: Current filter selection (all or specific status)
  const [filter, setFilter] = useState<'all' | GameStatus>('all');

  // State: Loading indicator while fetching games
  const [loading, setLoading] = useState(true);

  // State: Action loading indicator (stores tabName of game being updated)
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Effect: Fetch games when page loads
   * Runs once on component mount
   */
  useEffect(() => {
    // Fetch all games from API
    fetchGames();
  }, []);

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Fetch all games from captain management API
   * Gets games with entry and selection counts
   */
  async function fetchGames() {
    // Show loading spinner
    setLoading(true);

    try {
      // Call captain management API to get all games
      const response = await fetch('/api/friendlies/manage/games');
      const data = await response.json();

      // Check if request was successful
      if (response.ok) {
        // Update games list
        setGames(data.games);
      } else {
        // Show error alert
        alert(data.error || 'Failed to load games');
      }
    } catch (error) {
      // Network or other error
      console.error('Error fetching games:', error);
      alert('Failed to load games');
    } finally {
      // Hide loading spinner
      setLoading(false);
    }
  }

  /**
   * Change game status via API
   * Generic function for all status changes (open, close, publish, etc.)
   * @param tabName Game tab name identifier
   * @param action Action to perform (open, close, publish, played, cancel)
   * @param additionalData Optional data for action (e.g., scores for played)
   */
  async function changeStatus(tabName: string, action: string, additionalData?: any) {
    // Show loading indicator for this specific game
    setActionLoading(tabName);

    try {
      // Call status change API
      const response = await fetch('/api/friendlies/manage/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_name: tabName,
          action,
          ...additionalData,
        }),
      });

      const data = await response.json();

      // Check if status change was successful
      if (response.ok) {
        // Show success message with new status
        alert(`Game status updated to ${data.new_status}`);

        // Refresh games list to show updated status
        await fetchGames();
      } else {
        // Show error message
        alert(data.error || 'Failed to update status');
      }
    } catch (error) {
      // Network or other error
      console.error('Error changing status:', error);
      alert('Failed to update status');
    } finally {
      // Hide loading indicator
      setActionLoading(null);
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handle Open Game button click
   * Changes status from blank to 'O' (Open)
   * Allows players to start entering the game
   */
  function handleOpenGame(tabName: string) {
    // Show confirmation dialog
    if (!confirm('Open this game for player entry?')) return;

    // Call API to open game
    changeStatus(tabName, 'open');
  }

  /**
   * Handle Close Game button click
   * Changes status from 'O' (Open) to 'X' (Selecting)
   * Closes entries and creates game sheet for team selection
   */
  function handleCloseGame(tabName: string) {
    // Show confirmation dialog
    if (!confirm('Close this game and create team selection sheet?')) return;

    // Call API to close game
    changeStatus(tabName, 'close');
  }

  /**
   * Handle Publish Selection button click
   * Changes status from 'X' (Selecting) to 'S' (Selected)
   * Publishes team selection to all players
   */
  function handlePublishSelection(tabName: string) {
    // Show confirmation dialog
    if (!confirm('Publish team selection to players?')) return;

    // Call API to publish selection
    changeStatus(tabName, 'publish');
  }

  /**
   * Handle Mark Played button click
   * Changes status from 'S' (Selected) to 'P' (Played)
   * Prompts for scores and records game as completed
   */
  function handleMarkPlayed(tabName: string) {
    // Prompt for BHBC score
    const bhbcScore = prompt('Enter BHBC score:');

    // Prompt for opponent score
    const opponentScore = prompt('Enter opponent score:');

    // Check if user cancelled either prompt
    if (bhbcScore === null || opponentScore === null) return;

    // Call API to mark game as played with scores
    changeStatus(tabName, 'played', {
      bhbc_score: parseInt(bhbcScore),
      opponent_score: parseInt(opponentScore),
    });
  }

  /**
   * Handle Cancel Game button click
   * Changes status to 'C' (Cancelled)
   * Prompts for cancellation reason and who cancelled
   */
  function handleCancelGame(tabName: string) {
    // Prompt for cancellation reason
    const reason = prompt('Enter cancellation reason:');

    // Prompt for who cancelled (Us/Them)
    const who = prompt('Who cancelled? (Us/Them):');

    // Check if user cancelled either prompt or didn't enter values
    if (!reason || !who) return;

    // Call API to cancel game with reason
    changeStatus(tabName, 'cancel', { reason, who });
  }

  // ============================================================================
  // Filtering and Display Logic
  // ============================================================================

  /**
   * Filter games based on selected filter tab
   * Returns subset of games that match current filter
   */
  const filteredGames = games.filter(game => {
    // If 'all' filter selected, show all games
    if (filter === 'all') return true;

    // Otherwise, only show games with matching status
    return game.status === filter;
  });

  /**
   * Get status badge component for a game
   * Returns colored badge with label based on game status
   * @param status Game status code
   * @returns JSX element with colored badge
   */
  const getStatusBadge = (status: GameStatus) => {
    // Define badge labels and colors for each status
    const badges: { [key in GameStatus]: { label: string; color: string } } = {
      '': { label: 'Upcoming', color: 'bg-gray-500' },      // Blank = Not opened yet
      'O': { label: 'Open', color: 'bg-green-500' },        // Open for entries
      'X': { label: 'Selecting', color: 'bg-yellow-500' },  // Captain selecting team
      'S': { label: 'Selected', color: 'bg-blue-500' },     // Team selected
      'P': { label: 'Played', color: 'bg-purple-500' },     // Game completed
      'C': { label: 'Cancelled', color: 'bg-red-500' },     // Game cancelled
      'A': { label: 'Abandoned', color: 'bg-orange-500' },  // Game abandoned
    };

    // Get badge config for this status, default to gray if unknown
    const badge = badges[status] || { label: status || 'Unknown', color: 'bg-gray-500' };

    // Return badge component
    return (
      <span className={`inline-block px-2 py-1 text-xs font-semibold text-white rounded ${badge.color}`}>
        {badge.label}
      </span>
    );
  };

  // ============================================================================
  // Render UI
  // ============================================================================

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation bar */}
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Page header with title and link to player view */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Manage Friendly Matches</h1>

          {/* Link to player view of friendlies */}
          <Link
            href="/friendlies"
            className="text-blue-600 hover:text-blue-800"
          >
            Player View →
          </Link>
        </div>

        {/* Filter tabs - allow captain to filter by game status */}
        <div className="flex gap-2 mb-6 border-b border-gray-200 overflow-x-auto">
          {/* Loop through all possible status values */}
          {(['all', '', 'O', 'X', 'S', 'P', 'C', 'A'] as const).map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 font-medium border-b-2 whitespace-nowrap ${
                filter === status
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {/* Display friendly label for each status */}
              {status === 'all' ? 'All' : status === '' ? 'Upcoming' : status}
            </button>
          ))}
        </div>

        {/* Games table - show loading or table */}
        {loading ? (
          // Loading state - show spinner while fetching games
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading games...</p>
          </div>
        ) : (
          // Games table - show all filtered games
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              {/* Table header */}
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date/Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Club
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Players
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>

              {/* Table body - list of games */}
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredGames.map(game => (
                  <tr
                    key={game.tabName}
                    className={actionLoading === game.tabName ? 'opacity-50' : ''}
                  >
                    {/* Date and time column */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div>{new Date(game.date).toLocaleDateString('en-GB')}</div>
                      <div className="text-gray-500">{game.time}</div>
                    </td>

                    {/* Club name column */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {game.clubName}
                    </td>

                    {/* Game details column (venue and format) */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div>{game.homeAway === 'H' ? 'Home' : 'Away'}</div>
                      <div className="text-gray-500">{game.format}</div>
                    </td>

                    {/* Status badge column */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(game.status)}
                    </td>

                    {/* Player counts column */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div>Entered: {game.entered}</div>
                      <div className="text-gray-500">Selected: {game.selected}</div>
                    </td>

                    {/* Actions column - buttons vary based on game status */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                      {/* Upcoming games (blank status) - show Open button */}
                      {game.status === '' && (
                        <button
                          onClick={() => handleOpenGame(game.tabName)}
                          disabled={actionLoading === game.tabName}
                          className="text-green-600 hover:text-green-800 font-medium disabled:opacity-50"
                        >
                          Open
                        </button>
                      )}

                      {/* Open games - show Close button */}
                      {game.status === 'O' && (
                        <button
                          onClick={() => handleCloseGame(game.tabName)}
                          disabled={actionLoading === game.tabName}
                          className="text-yellow-600 hover:text-yellow-800 font-medium disabled:opacity-50"
                        >
                          Close
                        </button>
                      )}

                      {/* Selecting games - show Select Team link and Publish button */}
                      {game.status === 'X' && (
                        <>
                          <Link
                            href={`/friendlies/manage/game/${encodeURIComponent(game.tabName)}`}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Select Team
                          </Link>
                          <button
                            onClick={() => handlePublishSelection(game.tabName)}
                            disabled={actionLoading === game.tabName}
                            className="text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                          >
                            Publish
                          </button>
                        </>
                      )}

                      {/* Selected games - show Edit link and Mark Played button */}
                      {game.status === 'S' && (
                        <>
                          <Link
                            href={`/friendlies/manage/game/${encodeURIComponent(game.tabName)}`}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Edit
                          </Link>
                          <button
                            onClick={() => handleMarkPlayed(game.tabName)}
                            disabled={actionLoading === game.tabName}
                            className="text-purple-600 hover:text-purple-800 font-medium disabled:opacity-50"
                          >
                            Mark Played
                          </button>
                        </>
                      )}

                      {/* Cancel button - show for all active games (not Cancelled, Played, or Abandoned) */}
                      {!['C', 'P', 'A'].includes(game.status) && (
                        <button
                          onClick={() => handleCancelGame(game.tabName)}
                          disabled={actionLoading === game.tabName}
                          className="text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
