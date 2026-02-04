// app/friendlies/game/[tabDate]/page.tsx
// Game Details page - shows selected teams, reserves, and allows players to confirm/withdraw
// Players can view their team assignment, position, and captain
// Selected players can confirm participation or withdraw (notifies captains)

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import Link from 'next/link';
import { parseUKDate } from '@/lib/date-utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Game details with team selections
 * Includes all teams, reserves, reserve teams, and user's status
 */
interface GameDetails {
  // Basic game information
  game: {
    tabDate: string;              // Game sheet name (e.g., "13 Jan 25")
    date: string;                 // Game date (DD/MM/YYYY)
    time: string;                 // Game time (HH:MM)
    clubName: string;             // Opponent club name
    homeAway: 'H' | 'A';          // Home or Away venue
    format: string;               // Game format (Triples, Pairs, etc.)
    status: string;               // Game status (O, X, S, P, C, A)
    userStatus: string | null;    // Current user's status (Y, R, T, etc.)
    userTeam: number | null;      // Team number user is in (1, 2, etc.)
    userPosition: string | null;  // Position user is playing (S, 1, 2, 3)
    userConfirmed: boolean;       // Whether user has confirmed participation
    userName: string;             // Current user's userName for highlighting
  };

  // Main teams (playing teams)
  teams: Array<{
    team: number;                 // Team number (1, 2, etc.)
    players: Array<{
      name: string;               // Player full name
      userName: string;           // Player userName for highlighting
      position: string;           // Position (S, 1, 2, 3)
      status: string;             // Player status code
      isCaptain: boolean;         // Whether this player is captain of day
    }>;
  }>;

  // Reserve players (backup for main teams)
  reserves: Array<{
    name: string;                 // Player full name
    userName: string;             // Player userName for highlighting
    team: number | null;          // Team number if assigned
    position: string;             // Position if assigned
    status: string;               // Player status code
  }>;

  // Reserve teams (additional full teams if needed)
  reserveTeams: Array<{
    team: number;                 // Reserve team number
    players: Array<{
      name: string;               // Player full name
      userName: string;           // Player userName for highlighting
      position: string;           // Position (S, 1, 2, 3)
      status: string;             // Player status code
    }>;
  }>;

  // Captain of the Day
  captainOfDay: string;           // Full name of captain
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Game Details Page Component
 * Shows selected teams, reserves, and reserve teams for a specific game
 * Features:
 * - View all teams and player positions
 * - See user's own status (Playing, Reserve, Reserve Team)
 * - Confirm participation (if selected but not yet confirmed)
 * - Withdraw from game (notifies captain)
 * - View match card with detailed information
 */
export default function GameDetailsPage() {
  // Get current user session
  const { data: session } = useSession();

  // Get route parameters (tabDate from URL)
  const params = useParams();

  // Router for navigation
  const router = useRouter();

  // Extract tabDate from URL parameter
  const tabDate = params.tabDate as string;

  // State: Game details including teams and user status
  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);

  // State: Loading indicator while fetching game details
  const [loading, setLoading] = useState(true);

  // State: Action loading indicator for confirm/withdraw buttons
  const [actionLoading, setActionLoading] = useState(false);

  // State: Confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // State: Flash message for success/error feedback
  const [flashMessage, setFlashMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Effect: Fetch game details when page loads or tabDate changes
   * Runs when tabDate parameter changes
   */
  useEffect(() => {
    // Fetch game details from API
    fetchGameDetails();
  }, [tabDate]);

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Fetch game details from API
   * Gets team selections, reserves, and user's status
   * Redirects to friendlies list if game not found or error occurs
   */
  async function fetchGameDetails() {
    // Show loading spinner
    setLoading(true);

    try {
      // Call API to get game details for this tabDate
      const response = await fetch(`/api/friendlies/game/${tabDate}`);
      const data = await response.json();

      // Check if request was successful
      if (response.ok) {
        // Update game details state
        setGameDetails(data);
      } else {
        // Log error and show alert
        console.error('Error:', data.error);
        alert(data.error || 'Failed to load game details');

        // Redirect back to friendlies list
        router.push('/friendlies');
      }
    } catch (error) {
      // Network or other error
      console.error('Error fetching game details:', error);
      alert('Failed to load game details');

      // Redirect back to friendlies list
      router.push('/friendlies');
    } finally {
      // Hide loading spinner whether success or failure
      setLoading(false);
    }
  }

  /**
   * Helper to close confirmation dialog
   */
  const closeConfirmDialog = () => {
    setConfirmDialog({
      isOpen: false,
      title: '',
      message: '',
      onConfirm: () => {},
    });
  };

  /**
   * Handle confirm participation button click
   * Updates user's status to confirmed in Google Sheets
   * Only available for selected players who haven't confirmed yet
   */
  async function handleConfirm() {
    // Show confirmation dialog to user
    setConfirmDialog({
      isOpen: true,
      title: 'Confirm Participation',
      message: 'Confirm your participation in this game?',
      onConfirm: () => {
        closeConfirmDialog();
        performConfirm();
      },
    });
  }

  /**
   * Perform the actual confirm operation
   */
  async function performConfirm() {
    // Show action loading indicator
    setActionLoading(true);
    setFlashMessage(null);

    try {
      // Call API to confirm participation
      const response = await fetch('/api/friendlies/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_name: tabDate,
          action: 'confirm',
        }),
      });

      const data = await response.json();

      // Check if confirmation was successful
      if (response.ok) {
        // Show success message
        setFlashMessage({ type: 'success', text: 'Participation confirmed!' });

        // Refresh game details to show updated status
        await fetchGameDetails();
      } else {
        // Show error message
        setFlashMessage({ type: 'error', text: data.error || 'Failed to confirm participation' });
      }
    } catch (error) {
      // Network or other error
      console.error('Error confirming:', error);
      setFlashMessage({ type: 'error', text: 'Failed to confirm participation' });
    } finally {
      // Hide action loading indicator
      setActionLoading(false);
    }
  }

  /**
   * Handle withdraw button click
   * Removes user from game and notifies captain
   * Available for selected players (status S)
   */
  async function handleWithdraw() {
    // Show confirmation dialog with warning about captain notification
    setConfirmDialog({
      isOpen: true,
      title: 'Withdraw from Game',
      message: 'Are you sure you want to withdraw from this game? The captains will be notified.',
      onConfirm: () => {
        closeConfirmDialog();
        performWithdraw();
      },
    });
  }

  /**
   * Perform the actual withdraw operation
   */
  async function performWithdraw() {
    // Show action loading indicator
    setActionLoading(true);
    setFlashMessage(null);

    try {
      // Call API to withdraw from game
      const response = await fetch('/api/friendlies/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_name: tabDate,
        }),
      });

      const data = await response.json();

      // Check if withdrawal was successful
      if (response.ok) {
        // Show success message briefly before redirecting
        setFlashMessage({ type: 'success', text: 'You have withdrawn from this game. Captains have been notified.' });

        // Redirect back to friendlies list after a short delay
        setTimeout(() => router.push('/friendlies'), 1500);
      } else {
        // Show error message
        setFlashMessage({ type: 'error', text: data.error || 'Failed to withdraw' });
      }
    } catch (error) {
      // Network or other error
      console.error('Error withdrawing:', error);
      setFlashMessage({ type: 'error', text: 'Failed to withdraw' });
    } finally {
      // Hide action loading indicator
      setActionLoading(false);
    }
  }

  // ============================================================================
  // Display Helper Functions
  // ============================================================================

  /**
   * Convert position code to display label
   * @param pos Position code (S, 1, 2, 3)
   * @returns Position label (Skip, Lead, Second, Third)
   */
  const getPositionLabel = (pos: string) => {
    // Map position codes to labels
    const labels: { [key: string]: string } = {
      'S': 'Skip',       // S = Skip (team captain on rink)
      '1': 'Lead',       // 1 = Lead (first player)
      '2': 'Second',     // 2 = Second player
      '3': 'Third',      // 3 = Third player
    };

    // Return label or original code if not found
    return labels[pos] || pos;
  };

  /**
   * Get user status badge component
   * Shows whether user is Playing, Reserve, or Reserve Team
   * Includes team number and position if assigned
   * @returns JSX element with colored badge or null
   */
  const getUserStatusBadge = () => {
    // Check if user has a status for this game
    if (!game.userStatus) return null;

    // Define badge labels and colors for each status
    const badges: { [key: string]: { label: string; color: string } } = {
      'Y': { label: 'Playing', color: 'bg-green-500' },         // Y = Playing (same as P)
      'R': { label: 'Reserve', color: 'bg-yellow-500' },        // R = Reserve
      'T': { label: 'Reserve Team', color: 'bg-orange-500' },   // T = Reserve Team
    };

    // Get badge config for this status
    const badge = badges[game.userStatus];

    // Return null if status not recognized
    if (!badge) return null;

    // Return badge component with team and position info
    return (
      <span className={`inline-block px-3 py-1 text-sm font-semibold text-white rounded ${badge.color}`}>
        {badge.label}
        {/* Show team number if assigned */}
        {game.userTeam && ` - Team ${game.userTeam}`}
        {/* Show position if assigned */}
        {game.userPosition && ` (${getPositionLabel(game.userPosition)})`}
      </span>
    );
  };

  // ============================================================================
  // Loading and Error States
  // ============================================================================

  // Show loading spinner while fetching game details
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading game details...</p>
          </div>
        </div>
      </div>
    );
  }

  // Return null if no game details (should redirect in fetchGameDetails)
  if (!gameDetails) {
    return null;
  }

  // Destructure game details for easier access
  const { game, teams, reserves, reserveTeams, captainOfDay } = gameDetails;

  // ============================================================================
  // Render UI
  // ============================================================================

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation bar */}
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Flash message for success/error feedback */}
        {flashMessage && (
          <div className={`mb-4 p-4 rounded-lg flex items-center justify-between ${
            flashMessage.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}>
            <span>{flashMessage.text}</span>
            <button
              onClick={() => setFlashMessage(null)}
              className="text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          </div>
        )}

        {/* Cancelled/Abandoned game notice */}
        {game.status === 'C' && (
          <div className="mb-4 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800">
            <span className="font-semibold">This game has been cancelled.</span>
          </div>
        )}
        {game.status === 'A' && (
          <div className="mb-4 p-4 rounded-lg bg-orange-50 border border-orange-200 text-orange-800">
            <span className="font-semibold">This game has been abandoned.</span>
          </div>
        )}

        {/* Header with back button and game info */}
        <div className="mb-6">
          {/* Back to Games link */}
          <Link href="/friendlies" className="text-blue-600 hover:text-blue-800 mb-2 inline-block">
            ← Back to Games
          </Link>

          {/* Game title (opponent club name) */}
          <h1 className="text-3xl font-bold">{game.clubName}</h1>

          {/* Game date and time */}
          <div className="text-gray-600 mt-2">
            {parseUKDate(game.date).toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            {' at '}
            {game.time}
          </div>

          {/* Game venue and format */}
          <div className="mt-2 space-y-1">
            <p>
              <span className="font-medium">Venue:</span> {game.homeAway === 'H' ? 'Home' : 'Away'}
            </p>
            <p>
              <span className="font-medium">Format:</span> {game.format}
            </p>
          </div>
        </div>

        {/* User Status section - show if user is selected for this game */}
        {game.userStatus && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                {/* Section title */}
                <h3 className="font-semibold text-lg mb-2">Your Status</h3>

                {/* User status badge (Playing/Reserve/Reserve Team) */}
                {getUserStatusBadge()}

                {/* Show confirmation status if confirmed */}
                {game.userConfirmed && (
                  <div className="mt-2 text-green-600 text-sm">
                    ✓ Participation confirmed
                  </div>
                )}
              </div>

              {/* Action buttons (Confirm and Withdraw) */}
              <div className="flex gap-2">
                {/* Confirm button - only show if game is Selected and user hasn't confirmed yet */}
                {game.status === 'S' && !game.userConfirmed && ['Y', 'R', 'T'].includes(game.userStatus) && (
                  <button
                    onClick={handleConfirm}
                    disabled={actionLoading}
                    className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    {actionLoading ? 'Processing...' : 'Confirm Participation'}
                  </button>
                )}

                {/* Withdraw button - show if game is Selected */}
                {game.status === 'S' && (
                  <button
                    onClick={handleWithdraw}
                    disabled={actionLoading}
                    className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {actionLoading ? 'Processing...' : 'Withdraw'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Captain of Day section */}
        {captainOfDay && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
            <h3 className="font-semibold">Captain of the Day</h3>
            <p className="text-lg">{captainOfDay}</p>
          </div>
        )}

        {/* Teams section - show all playing teams */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4">Teams</h2>

          {/* Grid of teams (2 columns on desktop) */}
          <div className="grid gap-6 md:grid-cols-2">
            {teams.map(team => (
              <div key={team.team} className="border rounded-lg p-4">
                {/* Team number */}
                <h3 className="font-bold text-xl mb-3">Team {team.team}</h3>

                {/* List of players in this team */}
                <div className="space-y-2">
                  {team.players.map((player, idx) => {
                    const isCurrentUser = player.userName === game.userName;
                    return (
                    <div
                      key={idx}
                      className={`flex justify-between items-center p-2 rounded ${
                        isCurrentUser ? 'bg-blue-100 ring-2 ring-blue-400' :
                        player.isCaptain ? 'bg-purple-100' : 'bg-gray-50'
                      }`}
                    >
                      <div>
                        {/* Player name */}
                        <span className="font-medium">{player.name}</span>

                        {/* You badge if this is the current user */}
                        {isCurrentUser && (
                          <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-1 rounded">
                            You
                          </span>
                        )}

                        {/* Captain badge if this player is captain of day */}
                        {player.isCaptain && (
                          <span className="ml-2 text-xs bg-purple-600 text-white px-2 py-1 rounded">
                            Captain
                          </span>
                        )}
                      </div>

                      {/* Player position (Skip, Lead, Second, Third) */}
                      <span className="text-gray-600">{getPositionLabel(player.position)}</span>
                    </div>
                  );})}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reserves section - show if there are any reserves */}
        {reserves.length > 0 && (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6 mb-6">
            <h2 className="text-2xl font-bold mb-4">Reserves</h2>

            {/* List of reserve players */}
            <div className="space-y-2">
              {reserves.map((reserve, idx) => {
                const isCurrentUser = reserve.userName === game.userName;
                return (
                <div key={idx} className={`flex justify-between items-center p-2 rounded ${
                  isCurrentUser ? 'bg-blue-100 ring-2 ring-blue-400' : 'bg-yellow-50'
                }`}>
                  {/* Reserve player name */}
                  <span className="font-medium">
                    {reserve.name}
                    {isCurrentUser && (
                      <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-1 rounded">
                        You
                      </span>
                    )}
                  </span>

                  {/* Reserve position if assigned */}
                  {reserve.position && (
                    <span className="text-gray-600">{getPositionLabel(reserve.position)}</span>
                  )}
                </div>
              );})}
            </div>
          </div>
        )}

        {/* Reserve Teams section - show if there are any reserve teams */}
        {reserveTeams.length > 0 && (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-6 mb-6">
            <h2 className="text-2xl font-bold mb-4">Reserve Teams</h2>

            {/* Grid of reserve teams (2 columns on desktop) */}
            <div className="grid gap-6 md:grid-cols-2">
              {reserveTeams.map(team => (
                <div key={team.team} className="border border-orange-300 rounded-lg p-4 bg-orange-50">
                  {/* Reserve team number */}
                  <h3 className="font-bold text-xl mb-3">Reserve Team {team.team}</h3>

                  {/* List of players in this reserve team */}
                  <div className="space-y-2">
                    {team.players.map((player, idx) => {
                      const isCurrentUser = player.userName === game.userName;
                      return (
                      <div key={idx} className={`flex justify-between items-center p-2 rounded ${
                        isCurrentUser ? 'bg-blue-100 ring-2 ring-blue-400' : 'bg-white'
                      }`}>
                        {/* Player name */}
                        <span className="font-medium">
                          {player.name}
                          {isCurrentUser && (
                            <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-1 rounded">
                              You
                            </span>
                          )}
                        </span>

                        {/* Player position */}
                        <span className="text-gray-600">{getPositionLabel(player.position)}</span>
                      </div>
                    );})}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Match Card Link - button to view detailed match card */}
        <div className="text-center">
          <Link
            href={`/friendlies/match-card/${tabDate}`}
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
          >
            View Match Card
          </Link>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirmDialog}
      />
    </div>
  );
}
