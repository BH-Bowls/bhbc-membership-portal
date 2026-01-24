// app/friendlies/manage/game/[tabDate]/page.tsx
// Team selection page for captains to select players, assign teams/positions, and manage game day logistics
// Allows viewing player stats, adding offline players, selecting teams, and generating match cards

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SearchableSelect } from '@/components/SearchableSelect';
import Link from 'next/link';
import { GameSheetPlayer } from '@/lib/types/friendlies';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Game data structure returned from API
 * Includes game details and list of all players with their stats
 */
interface GameData {
  // Game information
  game: {
    tabDate: string;        // Game sheet identifier (e.g., "13 Jan 25")
    date: string;           // Game date (DD/MM/YYYY)
    time: string;           // Game time (HH:MM)
    clubName: string;       // Opponent club name
    homeAway: 'H' | 'A';    // Home or Away venue
    format: string;         // Game format (Triples, Pairs, etc.)
    ladiesMen: string;      // Ladies/Men/Mixed
    dress: string;          // Dress code
    status: string;         // Game status (O, X, S, P, C, A)
    tabName: string;        // Tab name in Google Sheets
    entered: number;        // Number of players entered
    selected: number;       // Number of players selected
    reserves: number;       // Number of reserves
  };

  // List of players with stats and selection info
  players: GameSheetPlayer[];
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Team Selection Page Component
 * Captain-only page for selecting players and building teams
 * Features:
 * - View all entered players with stats (name down, picked, percent played)
 * - Add offline players who didn't enter online
 * - Select players as Playing/Reserve/Reserve Team
 * - Assign team numbers and positions (Skip, Lead, Second, Third)
 * - Select captain of the day
 * - For away games: mark drivers and assign car numbers
 * - Update selection and sync back to Players sheet
 * - Generate match card for printing
 */
export default function TeamSelectionPage() {
  // Get user session for authentication
  const { data: session } = useSession();

  // Get route parameters and navigation
  const params = useParams();
  const router = useRouter();

  // Extract tabDate from URL parameter
  const tabDate = params.tabDate as string;

  // State: Game data including game details and all players
  const [gameData, setGameData] = useState<GameData | null>(null);

  // State: Players list (separate from gameData for easier updates)
  const [players, setPlayers] = useState<GameSheetPlayer[]>([]);

  // State: Loading indicator while fetching game data
  const [loading, setLoading] = useState(true);

  // State: Saving indicator while updating selection
  const [saving, setSaving] = useState(false);

  // State: Getting stats indicator while fetching from Players sheet
  const [gettingStats, setGettingStats] = useState(false);

  // State: Player name selected in add player dropdown
  const [addPlayerName, setAddPlayerName] = useState('');

  // State: List of all available players for add player dropdown
  const [availablePlayers, setAvailablePlayers] = useState<{ userName: string; fullName: string }[]>([]);

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

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Effect: Fetch game data and available players when page loads or tabDate changes
   * Runs whenever tabDate parameter changes
   */
  useEffect(() => {
    // Fetch game details and player list for this game
    fetchGameData();

    // Fetch list of all players for add player dropdown
    fetchAvailablePlayers();
  }, [tabDate]);

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Fetch list of all players from Players sheet
   * Used to populate the add player dropdown
   * Filters out players already in the game
   */
  async function fetchAvailablePlayers() {
    try {
      // Call API to get all players from Players sheet
      const response = await fetch('/api/friendlies/manage/players');
      const data = await response.json();

      // Update state with player list if successful
      if (response.ok) {
        setAvailablePlayers(data.players || []);
      }
    } catch (error) {
      // Log error but don't show to user (non-critical failure)
      console.error('Error fetching players:', error);
    }
  }

  /**
   * Fetch game data including all players and their stats
   * Gets data from game sheet created when captain closed the game
   * Redirects to manage page if game not found
   */
  async function fetchGameData() {
    // Show loading spinner
    setLoading(true);

    try {
      // Call API to get game details and players
      const response = await fetch(`/api/friendlies/manage/game/${tabDate}`);
      const data = await response.json();

      // Check if request was successful
      if (response.ok) {
        // Update game data state
        setGameData(data);

        // Update players list (separate state for easier manipulation)
        setPlayers(data.players);
      } else {
        // Show error and redirect to manage page
        alert(data.error || 'Failed to load game');
        router.push('/friendlies/manage');
      }
    } catch (error) {
      // Network or other error
      console.error('Error fetching game:', error);
      alert('Failed to load game');
      router.push('/friendlies/manage');
    } finally {
      // Hide loading spinner
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
   * Handle Get Stats button click
   * Fetches latest stats from Players sheet for all players
   * Updates name down, picked, percent played, driver/bar, and last 6 games
   */
  async function handleGetStats() {
    if (!gameData) return;

    // Show loading indicator
    setGettingStats(true);

    try {
      // Call API to update stats for all players
      const response = await fetch('/api/friendlies/manage/get-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_name: gameData.game.tabName }),
      });

      const data = await response.json();

      if (response.ok) {
        // Refresh game data to show updated stats
        await fetchGameData();
      } else {
        // Only show alert on error
        alert(data.error || 'Failed to update stats');
      }
    } catch (error) {
      console.error('Error updating stats:', error);
      alert('Failed to update stats');
    } finally {
      setGettingStats(false);
    }
  }

  /**
   * Handle Update Selection button click
   * Saves all selection changes to game sheet
   * Updates selected status, team numbers, positions, driving info, and captain
   * Sorts players by selection status and team number
   */
  async function handleUpdateSelection() {
    // Check if game data is loaded
    if (!gameData) return;

    // Show saving indicator
    setSaving(true);

    try {
      // Build array of selection updates for all players
      // Loop through players and extract selection fields
      const selections = players.map(p => ({
        row_number: p.rowNumber,      // Row in game sheet
        selected: p.selected,          // Y/R/T or blank
        team: p.team,                  // Team number (1, 2, etc.)
        position: p.position,          // Position code (S, 1, 2, 3)
        driving: p.driving,            // Y or blank (away games only)
        car_number: p.carNumber,       // Car number (away games only)
        captain: p.captain,            // Y or blank (only one can be Y)
      }));

      // Call API to update selection
      const response = await fetch('/api/friendlies/manage/update-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_name: gameData.game.tabName,
          selections,
        }),
      });

      const data = await response.json();

      // Check if update was successful
      if (response.ok) {
        // Show success message
        alert('Selection updated and sorted');

        // Update players with sorted list from API
        setPlayers(data.sorted_players);
      } else {
        // Show error message
        alert(data.error || 'Failed to update selection');
      }
    } catch (error) {
      // Network or other error
      console.error('Error updating selection:', error);
      alert('Failed to update selection');
    } finally {
      // Hide saving indicator
      setSaving(false);
    }
  }

  /**
   * Handle Update Stats to Players Sheet button click
   * Syncs current selections back to Players sheet
   * Updates player entry status codes (P, R, T, PW, RW, TW)
   */
  async function handleUpdateStats() {
    // Check if game data is loaded
    if (!gameData) return;

    // Show confirmation dialog
    setConfirmDialog({
      isOpen: true,
      title: 'Update Player Stats',
      message: 'Update the Players sheet with current selections?',
      onConfirm: () => {
        closeConfirmDialog();
        performUpdateStats();
      },
    });
  }

  /**
   * Perform the actual update stats operation
   */
  async function performUpdateStats() {
    if (!gameData) return;

    try {
      // Call API to update Players sheet
      const response = await fetch('/api/friendlies/manage/update-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_name: gameData.game.tabName }),
      });

      const data = await response.json();

      // Check if update was successful
      if (response.ok) {
        // Show success message with count
        alert(`Players sheet updated for ${data.stats_updated} players`);
      } else {
        // Show error message
        alert(data.error || 'Failed to update stats');
      }
    } catch (error) {
      // Network or other error
      console.error('Error updating stats:', error);
      alert('Failed to update stats');
    }
  }

  /**
   * Handle Add Player button click
   * Adds a player who didn't enter online (offline player)
   * Useful for adding players who called/texted to enter
   */
  async function handleAddPlayer() {
    // Check if player name is selected
    if (!addPlayerName.trim()) return;

    // Check if game data is loaded
    if (!gameData) return;

    try {
      // Call API to add player to game sheet
      const response = await fetch('/api/friendlies/manage/add-player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_name: gameData.game.tabName,
          user_name: addPlayerName.trim(),
        }),
      });

      const data = await response.json();

      // Check if add was successful
      if (response.ok) {
        // Show success message
        alert(`Player ${addPlayerName} added`);

        // Clear dropdown selection
        setAddPlayerName('');

        // Refresh game data to show new player
        await fetchGameData();
      } else {
        // Show error message
        alert(data.error || 'Failed to add player');
      }
    } catch (error) {
      // Network or other error
      console.error('Error adding player:', error);
      alert('Failed to add player');
    }
  }

  // ============================================================================
  // Local State Update Functions
  // ============================================================================

  /**
   * Update a single field for a single player
   * Updates local state only - doesn't save to server until Update Selection clicked
   * Special handling for captain field - only one player can be captain
   * @param rowNumber Row number in game sheet to identify player
   * @param field Field name to update
   * @param value New value for field
   */
  function updatePlayer(rowNumber: number, field: string, value: any) {
    // Update players state
    setPlayers(prev =>
      prev.map(p =>
        // Check if this is the player being updated
        p.rowNumber === rowNumber
          ? { ...p, [field]: value }              // Update this player's field
          : field === 'captain' && value === 'Y'   // If setting someone as captain
          ? { ...p, captain: '' }                  // Clear captain for all other players
          : p                                      // Otherwise leave player unchanged
      )
    );
  }

  // ============================================================================
  // Loading State
  // ============================================================================

  // Show loading spinner while fetching game data
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="container mx-auto px-4 py-8 max-w-7xl">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading game...</p>
          </div>
        </div>
      </div>
    );
  }

  // Return null if no game data (should redirect in fetchGameData)
  if (!gameData) return null;

  // Destructure game details for easier access
  const { game } = gameData;

  // Check if this is an away game (need driving/car number columns)
  const isAway = game.homeAway === 'A';

  // ============================================================================
  // Render UI
  // ============================================================================

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation bar */}
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header with back link and game details */}
        <div className="mb-6">
          {/* Back to Manage Games link */}
          <Link href="/friendlies/manage" className="text-blue-600 hover:text-blue-800 mb-2 inline-block">
            ← Back to Manage Games
          </Link>

          {/* Page title with opponent name */}
          <h1 className="text-3xl font-bold">{game.clubName} - Team Selection</h1>

          {/* Game details (date, time, venue, format) */}
          <div className="text-gray-600 mt-2">
            {new Date(game.date).toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            {' at '}
            {game.time}
            {' - '}
            {game.homeAway === 'H' ? 'Home' : 'Away'}
            {' - '}
            {game.format}
          </div>
        </div>

        {/* Action buttons panel */}
        <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-3">
          {/* Get Stats button - refresh player stats from Players sheet */}
          <button
            onClick={handleGetStats}
            disabled={gettingStats}
            className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {gettingStats && (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            {gettingStats ? 'Updating Stats...' : 'Get Stats'}
          </button>

          {/* Update Selection button - save changes to game sheet */}
          <button
            onClick={handleUpdateSelection}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Update Selection'}
          </button>

          {/* Update Stats button - sync selections back to Players sheet */}
          <button
            onClick={handleUpdateStats}
            className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 transition-colors"
          >
            Update Stats to Players Sheet
          </button>

          {/* Print Match Card link - navigate to match card page */}
          <Link
            href={`/friendlies/match-card/${tabDate}`}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors"
          >
            Print Match Card
          </Link>
        </div>

        {/* Add offline player panel */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <h3 className="font-semibold mb-3">Add Offline Player</h3>

          <div className="flex gap-2">
            {/* Searchable dropdown of all players */}
            {/* Filters out players already in the game */}
            <SearchableSelect
              options={availablePlayers
                .filter(player => !players.some(p => p.name === player.fullName || p.name === player.userName))
                .map(player => ({
                  value: player.userName,
                  label: player.fullName,
                }))}
              value={addPlayerName}
              onChange={setAddPlayerName}
              placeholder="Type to search players..."
              className="flex-1"
            />

            {/* Add Player button */}
            <button
              onClick={handleAddPlayer}
              disabled={!addPlayerName}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Player
            </button>
          </div>
        </div>

        {/* Selection table - main UI for selecting players and assigning teams */}
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            {/* Table header */}
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stats</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">D/B</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Selected</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Position</th>

                {/* Driving and Car Number columns only for away games */}
                {isAway && (
                  <>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Driving</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Car #</th>
                  </>
                )}

                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Captain</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>

            {/* Table body - list of all players */}
            <tbody className="bg-white divide-y divide-gray-200">
              {players.map(player => (
                <tr
                  key={player.rowNumber}
                  className={player.status === 'W' ? 'bg-red-50' : ''}  // Highlight withdrawn players
                >
                  {/* Player name column with tooltip showing last 8 games */}
                  <td className="px-4 py-3 text-sm font-medium">
                    <span
                      className="cursor-help"
                      title={player.last8Games && player.last8Games.length > 0 ? player.last8Games.join('\n') : 'No recent games'}
                    >
                      {player.fullName}
                    </span>
                  </td>

                  {/* Stats column (name down / picked (percent played)) */}
                  <td className="px-4 py-3 text-sm text-gray-600">
                    <div className="text-xs">
                      {player.nameDown}/{player.picked} ({player.percentPlayed}%)
                    </div>
                  </td>

                  {/* Driver/Bar code column */}
                  <td className="px-4 py-3 text-sm">
                    <span className="text-xs bg-gray-100 px-2 py-1 rounded">{player.driverBar}</span>
                  </td>

                  {/* Selected dropdown (Y = Playing, R = Reserve, T = Reserve Team) */}
                  <td className="px-4 py-3">
                    <select
                      value={player.selected}
                      onChange={e => updatePlayer(player.rowNumber, 'selected', e.target.value)}
                      className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-</option>
                      <option value="Y">Y (Playing)</option>
                      <option value="R">R (Reserve)</option>
                      <option value="T">T (Reserve Team)</option>
                    </select>
                  </td>

                  {/* Team number input */}
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      value={player.team || ''}
                      onChange={e => updatePlayer(player.rowNumber, 'team', e.target.value ? parseInt(e.target.value) : null)}
                      min="1"
                      className="w-16 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </td>

                  {/* Position dropdown (Skip, Lead, Second, Third) */}
                  <td className="px-4 py-3">
                    <select
                      value={player.position}
                      onChange={e => updatePlayer(player.rowNumber, 'position', e.target.value)}
                      className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-</option>
                      <option value="S">Skip</option>
                      <option value="1">Lead</option>
                      <option value="2">Second</option>
                      <option value="3">Third</option>
                    </select>
                  </td>

                  {/* Driving checkbox and Car Number input - only for away games */}
                  {isAway && (
                    <>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={player.driving === 'Y'}
                          onChange={e => updatePlayer(player.rowNumber, 'driving', e.target.checked ? 'Y' : '')}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={player.carNumber || ''}
                          onChange={e => updatePlayer(player.rowNumber, 'carNumber', e.target.value)}
                          className="w-12 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                    </>
                  )}

                  {/* Captain radio button (only one can be selected) */}
                  <td className="px-4 py-3">
                    <input
                      type="radio"
                      name="captain"
                      checked={player.captain === 'Y'}
                      onChange={() => updatePlayer(player.rowNumber, 'captain', 'Y')}
                      className="w-4 h-4"
                    />
                  </td>

                  {/* Status column (Confirmed or Withdrawn) */}
                  <td className="px-4 py-3 text-sm">
                    {player.status === 'Y' && <span className="text-green-600">✓ Confirmed</span>}
                    {player.status === 'W' && <span className="text-red-600">Withdrawn</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Instructions panel */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-semibold mb-2">Instructions:</h4>
          <ul className="text-sm space-y-1 list-disc list-inside">
            <li>Use "Get Stats" to refresh player statistics from the Players sheet</li>
            <li>Select players as Y (Playing), R (Reserve), or T (Reserve Team)</li>
            <li>Assign team numbers and positions for selected players</li>
            <li>Select ONE captain of the day (radio button)</li>
            <li>For away games, mark drivers and assign car numbers</li>
            <li>Click "Update Selection" to save and sort the table</li>
            <li>Use "Update Stats to Players Sheet" to sync final selections back to the Players sheet</li>
          </ul>
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
